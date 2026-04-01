import type { ClawdbotConfig } from "openclaw/plugin-sdk/core";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createReplyPrefixContext } from "openclaw/plugin-sdk/channel-runtime";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { InboundWebhookPayload, FastApiTaskContext, DownloadedFile } from "./types.js";
import { downloadFile, resolveFilename, inferPlaceholder } from "./client.js";
import { resolveAccount } from "./account.js";
import { getFastApiRuntime } from "./runtime.js";
import { setTaskId } from "./task-map.js";
import { getWsClient } from "./ws-send.js";

/**
 * Parse and validate an inbound webhook payload from FastAPI.
 */
export function parseWebhookPayload(body: unknown): InboundWebhookPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const event_type = b["event_type"];
  if (event_type !== "task" && event_type !== "file_task" && event_type !== "heartbeat") {
    return null;
  }

  const task_id = b["task_id"];
  if (!task_id || typeof task_id !== "string") return null;

  const content = b["content"];
  if (typeof content !== "string") return null;

  const file_urls = Array.isArray(b["file_urls"])
    ? b["file_urls"].filter(
        (f): f is { url: string; filename?: string; mime_type?: string } =>
          typeof f === "object" && f !== null && typeof (f as Record<string, unknown>)["url"] === "string",
      )
    : undefined;

  return {
    event_type,
    task_id,
    content,
    user_id: typeof b["user_id"] === "string" ? b["user_id"] : "system",
    user_name: typeof b["user_name"] === "string" ? b["user_name"] : undefined,
    file_urls: file_urls?.length ? file_urls : undefined,
    metadata:
      typeof b["metadata"] === "object" && b["metadata"] !== null
        ? (b["metadata"] as Record<string, unknown>)
        : undefined,
    reply_to_task_id:
      typeof b["reply_to_task_id"] === "string" ? b["reply_to_task_id"] : null,
  };
}

/**
 * Validate the inbound webhook secret.
 */
export function validateWebhookSecret(
  expectedSecret: string | undefined,
  providedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return true;
  if (!providedSecret) return false;
  return expectedSecret === providedSecret;
}

/**
 * Check if the sender is allowed.
 */
export function isSenderAllowed(params: {
  userId: string;
  dmPolicy: string;
  allowFrom: string[];
}): boolean {
  const { userId, dmPolicy, allowFrom } = params;
  if (dmPolicy === "open") return true;
  if (allowFrom.length === 0) return false;
  return allowFrom.includes(userId) || allowFrom.includes("*");
}

/**
 * Download all files referenced in the payload.
 */
async function downloadAllFiles(params: {
  core: PluginRuntime;
  fileRefs: InboundWebhookPayload["file_urls"];
  maxBytes: number;
  timeoutMs: number;
  log: (msg: string) => void;
}): Promise<DownloadedFile[]> {
  const { core, fileRefs, maxBytes, timeoutMs, log } = params;
  if (!fileRefs || fileRefs.length === 0) return [];

  const results: DownloadedFile[] = [];

  for (const ref of fileRefs) {
    const filename = resolveFilename(ref);
    try {
      const { buffer, contentType } = await downloadFile({
        url: ref.url,
        filename,
        maxBytes,
        timeoutMs,
      });

      const saved = await core.channel.media.saveMediaBuffer(
        buffer,
        contentType,
        "inbound",
        maxBytes,
        filename,
      );

      const placeholder = inferPlaceholder(contentType, filename);
      results.push({
        path: saved.path,
        contentType: saved.contentType,
        filename,
        placeholder,
      });

      log(`fastapi: downloaded "${filename}" → ${saved.path}`);
    } catch (err) {
      log(`fastapi: failed to download "${filename}" from ${ref.url}: ${String(err)}`);
    }
  }

  return results;
}

/**
 * Build the agent body text from the task context.
 */
export function buildAgentBody(ctx: FastApiTaskContext): string {
  const sender = ctx.userName ?? ctx.userId;
  let body = `[task_id: ${ctx.taskId}]\n${sender}: ${ctx.content}`;

  if (ctx.localFiles.length > 0) {
    const fileParts = ctx.localFiles.map((f) => f.placeholder).join(" ");
    body += `\n${fileParts}`;
  }

  return body;
}

/**
 * Handle a parsed inbound payload: download files, build context, dispatch to agent.
 */
export async function handleFastApiMessage(params: {
  cfg: ClawdbotConfig;
  payload: InboundWebhookPayload;
  log?: (msg: string) => void;
}): Promise<void> {
  const { cfg, payload, log = console.log } = params;

  if (payload.event_type === "heartbeat") {
    log(`fastapi: heartbeat received, task_id=${payload.task_id}`);
    return;
  }

  const core = getFastApiRuntime();
  const account = resolveAccount(cfg);
  const fastapiCfg = account.config;

  const userId = payload.user_id ?? "system";
  if (
    !isSenderAllowed({
      userId,
      dmPolicy: fastapiCfg.dmPolicy ?? "open",
      allowFrom: fastapiCfg.allowFrom ?? [],
    })
  ) {
    log(`fastapi: blocked sender "${userId}" (dmPolicy=${fastapiCfg.dmPolicy})`);
    return;
  }

  log(`fastapi: handling task_id=${payload.task_id} from user=${userId}`);

  const maxBytes = (fastapiCfg.mediaMaxMb ?? 20) * 1024 * 1024;
  const downloadTimeoutMs = fastapiCfg.downloadTimeoutMs ?? 30_000;

  const localFiles = await downloadAllFiles({
    core,
    fileRefs: payload.file_urls,
    maxBytes,
    timeoutMs: downloadTimeoutMs,
    log,
  });

  const ctx: FastApiTaskContext = {
    taskId: payload.task_id,
    userId,
    userName: payload.user_name,
    content: payload.content,
    localFiles,
    metadata: payload.metadata,
    replyToTaskId: payload.reply_to_task_id,
  };

  const messageBody = buildAgentBody(ctx);
  const fastapiFrom = `fastapi:task:${payload.task_id}`;
  const fastapiTo = `task:${payload.task_id}`;

  // Store task_id mapping so outbound.sendText can find it
  setTaskId(fastapiTo, payload.task_id);

  // Resolve agent route, then override session key to ensure isolation
  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel: "fastapi",
    accountId: DEFAULT_ACCOUNT_ID,
    from: fastapiFrom,
    to: fastapiTo,
    chatType: "direct",
  });

  // Force unique session per task
  const sessionKey = `agent:${route.agentId}:fastapi:direct:${payload.task_id}`;

  // Format message envelope
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "FastAPI",
    from: fastapiFrom,
    timestamp: new Date(),
    body: messageBody,
    ...envelopeOptions,
  });

  // Finalize inbound context
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: messageBody,
    RawBody: payload.content,
    CommandBody: payload.content,
    From: fastapiFrom,
    To: fastapiTo,
    SessionKey: sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    SenderName: ctx.userName ?? userId,
    SenderId: userId,
    Provider: "fastapi" as const,
    Surface: "fastapi" as const,
    MessageSid: payload.task_id,
    Timestamp: Date.now(),
    WasMentioned: true,
    CommandAuthorized: true,
    OriginatingChannel: "fastapi" as const,
    OriginatingTo: fastapiTo,
  });

  // Create a simple reply dispatcher
  let accumulatedText = "";
  const prefixContext = createReplyPrefixContext({ cfg, agentId: route.agentId });
  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
      deliver: async (replyPayload, info) => {
        const text = replyPayload?.text ?? String(replyPayload ?? "");
        if (!text.trim()) return;

        // Accumulate text chunks, only send on final
        if (!accumulatedText) accumulatedText = "";
        accumulatedText += text;

        if (info?.kind === "final" || !info?.kind) {
          const client = getWsClient();
          if (client) {
            client.sendResult({
              task_id: payload.task_id,
              status: "completed",
              content: accumulatedText,
              timestamp: Math.floor(Date.now() / 1000),
            });
          }
          accumulatedText = "";
        }
      },
      onError: async (error) => {
        log(`fastapi: reply error: ${String(error)}`);
        accumulatedText = "";
      },
      onIdle: async () => {},
      onCleanup: () => {},
    });

  log(`fastapi: dispatching to agent (session=${sessionKey})`);
  const { queuedFinal, counts } = await core.channel.reply.withReplyDispatcher({
    dispatcher,
    onSettled: () => {
      markDispatchIdle();
    },
    run: () =>
      core.channel.reply.dispatchReplyFromConfig({
        ctx: ctxPayload,
        cfg,
        dispatcher,
        replyOptions: {
          ...replyOptions,
          onModelSelected: prefixContext.onModelSelected,
        },
      }),
  });

  log(
    `fastapi: dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`,
  );
}
