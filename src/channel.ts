import type { ChannelMeta, ChannelPlugin } from "openclaw/plugin-sdk";
import {
  createDefaultChannelRuntimeState,
  buildBaseChannelStatusSummary,
  DEFAULT_ACCOUNT_ID,
} from "openclaw/plugin-sdk";
import { resolveAccount } from "./account.js";
import { createWsClient } from "./ws-client.js";
import { setWsClient, getWsClient } from "./ws-send.js";
import { setFastApiRuntime } from "./runtime.js";
import { handleFastApiMessage } from "./bot.js";
import type { ResolvedFastApiAccount } from "./types.js";

const meta: ChannelMeta = {
  id: "fastapi",
  label: "FastAPI",
  selectionLabel: "FastAPI Channel",
  blurb: "Connect to a Fastify/FastAPI service via WebSocket.",
  order: 90,
};

export const fastApiPlugin: ChannelPlugin<ResolvedFastApiAccount> = {
  id: "fastapi",
  meta,
  pairing: undefined,
  capabilities: {
    chatTypes: ["direct"],
    polls: false,
    threads: false,
    media: true,
    reactions: false,
    edit: false,
    reply: false,
  },
  reload: { configPrefixes: ["channels.fastapi"] },
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        wsUrl: { type: "string" },
        dmPolicy: { type: "string", enum: ["open", "allowlist"] },
        allowFrom: { type: "array", items: { type: "string" } },
        mediaMaxMb: { type: "number", minimum: 1 },
        downloadTimeoutMs: { type: "integer", minimum: 1000 },
      },
    },
  },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg) => resolveAccount(cfg),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      wsUrl: account.config?.wsUrl ?? "not set",
    }),
    resolveAllowFrom: ({ cfg }) => {
      const account = resolveAccount(cfg);
      return account.config?.allowFrom ?? [];
    },
    formatAllowFrom: ({ allowFrom }) => allowFrom.map((e) => e.trim()).filter(Boolean),
  },
  security: {
    collectWarnings: () => [],
  },
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        fastapi: {
          ...(cfg.channels as Record<string, unknown> | undefined)?.fastapi as Record<string, unknown> | undefined,
          enabled: true,
        },
      },
    }),
  },
  messaging: {
    normalizeTarget: (raw) => raw ?? undefined,
  },
  outbound: {
    sendText: async (params) => {
      const taskIdMatch = params.body?.match(/\[task_id:\s*([^\]]+)\]/);
      const taskId = taskIdMatch?.[1]?.trim() ?? "unknown";

      const metaMatch = params.body?.match(/\[metadata:\s*({[^}]+})\]/);
      let metadata: Record<string, unknown> | undefined;
      if (metaMatch) {
        try {
          metadata = JSON.parse(metaMatch[1]);
        } catch {
          // ignore
        }
      }

      const client = getWsClient();
      if (client) {
        client.sendResult({
          task_id: taskId,
          status: "completed",
          content: params.text,
          timestamp: Math.floor(Date.now() / 1000),
          metadata,
        });
      }

      return { messageId: `fastapi-reply-${Date.now()}` };
    },
  },
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID, {}),
    buildChannelSummary: ({ snapshot }) => buildBaseChannelStatusSummary(snapshot),
    probeAccount: async () => ({ ok: true }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = resolveAccount(ctx.cfg);
      const wsUrl = account.config?.wsUrl;

      if (!wsUrl) {
        ctx.log?.info(`fastapi: no wsUrl configured, channel idle`);
        await new Promise<void>((resolve) => {
          ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }

      const client = createWsClient({
        url: wsUrl,
        log: (msg) => ctx.log?.info(msg),
        abortSignal: ctx.abortSignal,
        onMessage: (msg) => {
          handleFastApiMessage({
            cfg: ctx.cfg,
            payload: {
              event_type: "task",
              task_id: msg.task_id,
              content: msg.content,
              user_id: msg.user_id ?? "system",
              user_name: msg.user_name,
              metadata: msg.metadata,
              reply_to_task_id: null,
            },
            log: (m) => ctx.log?.info(m),
          }).catch((err) => {
            ctx.log?.error(`fastapi: error handling task_id=${msg.task_id}: ${String(err)}`);
          });
        },
      });

      setWsClient(client);
      ctx.log?.info(`fastapi: WebSocket channel started, connecting to ${wsUrl}`);

      // Keep alive until abort
      await new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  },
};
