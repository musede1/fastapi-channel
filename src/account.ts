import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { ResolvedFastApiAccount, FastApiConfig } from "./types.js";
import { FastApiConfigSchema } from "./config-schema.js";

const CHANNEL_KEY = "fastapi";
const DEFAULT_ACCOUNT_ID = "default";

/**
 * Read and validate the FastAPI channel config from the global ClawdbotConfig.
 */
function readFastApiConfig(cfg: ClawdbotConfig): FastApiConfig | undefined {
  const raw = (cfg.channels as Record<string, unknown> | undefined)?.[CHANNEL_KEY];
  if (!raw || typeof raw !== "object") return undefined;

  const parsed = FastApiConfigSchema.safeParse(raw);
  if (!parsed.success) return undefined;

  return parsed.data;
}

/**
 * Resolve the FastAPI account from the global config.
 */
export function resolveAccount(cfg: ClawdbotConfig): ResolvedFastApiAccount {
  const fastapiCfg = readFastApiConfig(cfg);

  const configured = Boolean(fastapiCfg?.callbackUrl?.trim());
  const enabled = Boolean(fastapiCfg?.enabled !== false && configured);

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    enabled,
    configured,
    callbackUrl: fastapiCfg?.callbackUrl,
    apiKey: fastapiCfg?.apiKey,
    webhookSecret: fastapiCfg?.webhookSecret,
    config: fastapiCfg ?? ({} as FastApiConfig),
  };
}
