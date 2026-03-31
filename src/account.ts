import type { ClawdbotConfig } from "openclaw/plugin-sdk/core";
import type { ResolvedFastApiAccount, FastApiConfig } from "./types.js";
import { FastApiConfigSchema } from "./config-schema.js";

const CHANNEL_KEY = "fastapi";
const DEFAULT_ACCOUNT_ID = "default";

function readFastApiConfig(cfg: ClawdbotConfig): FastApiConfig | undefined {
  const raw = (cfg.channels as Record<string, unknown> | undefined)?.[CHANNEL_KEY];
  if (!raw || typeof raw !== "object") return undefined;

  const parsed = FastApiConfigSchema.safeParse(raw);
  if (!parsed.success) return undefined;

  return parsed.data;
}

export function resolveAccount(cfg: ClawdbotConfig): ResolvedFastApiAccount {
  const fastapiCfg = readFastApiConfig(cfg);

  const configured = Boolean(fastapiCfg?.wsUrl?.trim());
  const enabled = Boolean(fastapiCfg?.enabled !== false && configured);

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    enabled,
    configured,
    config: fastapiCfg ?? ({} as FastApiConfig),
  };
}
