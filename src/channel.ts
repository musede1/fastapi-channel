import {
  createChatChannelPlugin,
  createChannelPluginBase,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/core";
import { resolveAccount } from "./account.js";
import { sendResultToFastApi } from "./send.js";
import type { ResolvedFastApiAccount } from "./types.js";

export const fastApiPlugin = createChatChannelPlugin<ResolvedFastApiAccount>({
  base: createChannelPluginBase({
    id: "fastapi",

    setup: {
      resolveAccount(cfg: OpenClawConfig, _accountId?: string | null): ResolvedFastApiAccount {
        return resolveAccount(cfg as Parameters<typeof resolveAccount>[0]);
      },

      inspectAccount(cfg: OpenClawConfig, _accountId?: string | null) {
        const account = resolveAccount(cfg as Parameters<typeof resolveAccount>[0]);
        return {
          enabled: account.enabled,
          configured: account.configured,
          callbackUrl: account.callbackUrl ?? "not set",
        };
      },
    },
  }),

  // Security: who can send tasks to OpenClaw from FastAPI
  security: {
    dm: {
      channelKey: "fastapi",
      resolvePolicy: (account) => account.config?.dmPolicy ?? "open",
      resolveAllowFrom: (account) => account.config?.allowFrom ?? [],
      defaultPolicy: "open",
    },
  },

  // Pairing not needed — FastAPI handles its own auth
  pairing: undefined,

  // Threading: top-level messages do not need to be replies
  threading: {
    topLevelReplyToMode: "none",
  },

  // Outbound: send AI text results back to FastAPI via callback
  outbound: {
    attachedResults: {
      sendText: async (params) => {
        // Extract task_id from the inbound body (we embedded it as "[task_id: xxx]")
        const taskIdMatch = params.body?.match(/\[task_id:\s*([^\]]+)\]/);
        const taskId = taskIdMatch?.[1]?.trim() ?? "unknown";

        // Extract metadata if embedded
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

        // Return a fake message ID (FastAPI doesn't issue message IDs)
        return { messageId: `fastapi-reply-${Date.now()}` };
      },
    },
    base: {
      // Media sending not needed: FastAPI receives text results only
      sendMedia: undefined,
    },
  },
});
