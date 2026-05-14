import type { ChannelMeta, ChannelPlugin } from "openclaw/plugin-sdk/core";
import { createDefaultChannelRuntimeState, buildBaseChannelStatusSummary } from "openclaw/plugin-sdk/status-helpers";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import { resolveAccount, resolveBackends } from "./account.js";
import { createWsClient } from "./ws-client.js";
import { setWsClient, sendResultForTask } from "./ws-send.js";
import { setFastApiRuntime } from "./runtime.js";
import { handleFastApiMessage } from "./bot.js";
import { getTaskId } from "./task-map.js";
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
        backends: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              wsUrl: { type: "string", minLength: 1 },
              enabled: { type: "boolean" },
            },
            required: ["id", "wsUrl"],
          },
        },
        dmPolicy: { type: "string", enum: ["open", "allowlist"] },
        allowFrom: { type: "array", items: { type: "string" } },
        mediaMaxMb: { type: "number", minimum: 1 },
        downloadTimeoutMs: { type: "integer", minimum: 1000 },
        workerAgents: {
          type: "array",
          items: { type: "string" },
        },
        dispatchStrategy: {
          type: "string",
          enum: ["round_robin"],
        },
      },
    },
  },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg) => resolveAccount(cfg),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => account.configured,
    describeAccount: (account) => {
      const backends = resolveBackends(account.config);
      return {
        accountId: account.accountId,
        enabled: account.enabled,
        configured: account.configured,
        backends: backends.length
          ? backends.map((b) => ({ id: b.id, wsUrl: b.wsUrl, enabled: b.enabled }))
          : "not set",
      };
    },
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
    deliveryMode: "direct",
    textChunkLimit: 100000,
    sendText: async ({ to, text }) => {
      const taskId = getTaskId(to ?? "");
      if (taskId) {
        sendResultForTask({
          taskId,
          status: "completed",
          content: text,
          timestamp: Math.floor(Date.now() / 1000),
          log: (m) => console.error(m),
        });
      }
      return { channel: "fastapi", messageId: `fastapi-reply-${Date.now()}` };
    },
  },
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID, {}),
    buildChannelSummary: ({ snapshot }) => buildBaseChannelStatusSummary(snapshot),
    probeAccount: async () => ({ ok: true }),
    buildAccountSnapshot: ({ account, runtime }) => {
      const backends = resolveBackends(account.config);
      return {
        accountId: account.accountId,
        enabled: account.enabled,
        configured: account.configured,
        running: runtime?.running ?? false,
        backends: backends.map((b) => ({
          id: b.id,
          wsUrl: b.wsUrl,
          enabled: b.enabled,
        })),
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = resolveAccount(ctx.cfg);
      const backends = resolveBackends(account.config, (m) => ctx.log?.info(m));
      const enabledBackends = backends.filter((b) => b.enabled);

      if (enabledBackends.length === 0) {
        ctx.log?.info(`fastapi: no enabled backends configured, channel idle`);
        await new Promise<void>((resolve) => {
          ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }

      for (const backend of enabledBackends) {
        const tag = `[backend=${backend.id}]`;
        const log = (msg: string) => ctx.log?.info(`${tag} ${msg}`);

        const client = createWsClient({
          url: backend.wsUrl,
          log,
          abortSignal: ctx.abortSignal,
          onMessage: (msg) => {
            handleFastApiMessage({
              cfg: ctx.cfg,
              backendId: backend.id,
              payload: {
                event_type: "task",
                task_id: msg.task_id,
                content: msg.content,
                user_id: msg.user_id ?? "system",
                user_name: msg.user_name,
                metadata: msg.metadata,
                reply_to_task_id: null,
              },
              log,
            }).catch((err) => {
              ctx.log?.error(
                `${tag} fastapi: error handling task_id=${msg.task_id}: ${String(err)}`,
              );
            });
          },
        });

        setWsClient(backend.id, client);
        ctx.log?.info(
          `${tag} fastapi: WebSocket channel started, connecting to ${backend.wsUrl}`,
        );
      }

      ctx.log?.info(
        `fastapi: started ${enabledBackends.length} backend(s): ${enabledBackends.map((b) => b.id).join(", ")}`,
      );

      // Keep alive until abort
      await new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  },
};
