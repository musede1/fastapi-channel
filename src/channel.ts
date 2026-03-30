import type { ChannelMeta, ChannelPlugin, ClawdbotConfig } from "openclaw/plugin-sdk";
import {
  createDefaultChannelRuntimeState,
  buildBaseChannelStatusSummary,
  DEFAULT_ACCOUNT_ID,
} from "openclaw/plugin-sdk";
import { resolveAccount } from "./account.js";
import { sendResultToFastApi } from "./send.js";
import type { ResolvedFastApiAccount } from "./types.js";

const meta: ChannelMeta = {
  id: "fastapi",
  label: "FastAPI",
  selectionLabel: "FastAPI Channel",
  blurb: "Dispatch tasks from a FastAPI/Fastify service to OpenClaw via HTTP webhooks.",
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
        callbackUrl: { type: "string" },
        apiKey: { type: "string" },
        webhookSecret: { type: "string" },
        webhookPath: { type: "string" },
        dmPolicy: { type: "string", enum: ["open", "allowlist"] },
        allowFrom: { type: "array", items: { type: "string" } },
        mediaMaxMb: { type: "number", minimum: 1 },
        downloadTimeoutMs: { type: "integer", minimum: 1000 },
        callbackTimeoutMs: { type: "integer", minimum: 1000 },
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
      callbackUrl: account.callbackUrl ?? "not set",
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

      await sendResultToFastApi({
        api: params.api,
        taskId,
        content: params.text,
        status: "completed",
        metadata,
      });

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
      ctx.log?.info(`fastapi channel started for account ${ctx.accountId}`);
      // Keep alive until gateway signals abort
      await new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  },
};
