import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { InboundWebhookPayload, FastApiTaskContext, DownloadedFile } from "./types.js";
import { downloadFile, resolveFilename, inferPlaceholder } from "./client.js";
import { resolveAccount } from "./account.js";

/**
 * Parse and validate an inbound webhook payload from FastAPI.
 * Returns null if the payload is invalid.
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
 * Returns true if no secret is configured (disabled) or if the secret matches.
 */
export function validateWebhookSecret(
  expectedSecret: string | undefined,
  providedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return true; // no validation configured
  if (!providedSecret) return false;
  return expectedSecret === providedSecret;
}

/**
 * Check if the sender is allowed based on the dmPolicy and allowFrom list.
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
 * Download all files referenced in the payload and save them locally.
 * Skips files that fail to download (logs error, continues).
 */
async function downloadAllFiles(params: {
  api: OpenClawPluginApi;
  fileRefs: InboundWebhookPayload["file_urls"];
  maxBytes: number;
  timeoutMs: number;
  log: (msg: string) => void;
}): Promise<DownloadedFile[]> {
  const { api, fileRefs, maxBytes, timeoutMs, log } = params;
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

      // Save to OpenClaw's media store
      const saved = await api.runtime.channel.media.saveMediaBuffer(
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
 * Includes sender attribution, file placeholders, and quoted task description.
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
  api: OpenClawPluginApi;
  payload: InboundWebhookPayload;
  log?: (msg: string) => void;
}): Promise<void> {
  const { api, payload, log = console.log } = params;

  // Heartbeats are no-ops
  if (payload.event_type === "heartbeat") {
    log(`fastapi: heartbeat received, task_id=${payload.task_id}`);
    return;
  }

  const cfg = api.config;
  if (!cfg) {
    log("fastapi: no config available, dropping message");
    return;
  }

  const account = resolveAccount(cfg);
  const fastapiCfg = account.config;

  // Sender allowlist check
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

  // Download file attachments
  const maxBytes = (fastapiCfg.mediaMaxMb ?? 20) * 1024 * 1024;
  const downloadTimeoutMs = fastapiCfg.downloadTimeoutMs ?? 30_000;

  const localFiles = await downloadAllFiles({
    api,
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

  const agentBody = buildAgentBody(ctx);

  // Build media payload for attached files
  const mediaPayload =
    localFiles.length > 0
      ? localFiles.map((f) => ({
          path: f.path,
          contentType: f.contentType,
          placeholder: f.placeholder,
        }))
      : undefined;

  // Dispatch to OpenClaw agent
  // user_id becomes the "from" peer so each user gets their own session
  await api.runtime.channel.messaging.dispatch({
    channel: "fastapi",
    accountId: account.accountId,
    from: `fastapi:${userId}`,
    to: `user:${userId}`,
    body: agentBody,
    media: mediaPayload,
  });
}
