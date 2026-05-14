import type { ClawdbotConfig } from "openclaw/plugin-sdk/core";
import type { ResolvedFastApiAccount, FastApiConfig, ResolvedBackend } from "./types.js";
import { FastApiConfigSchema } from "./config-schema.js";

const CHANNEL_KEY = "fastapi";
const DEFAULT_ACCOUNT_ID = "default";
const LEGACY_BACKEND_ID = "default";

function readFastApiConfig(cfg: ClawdbotConfig): FastApiConfig | undefined {
  const raw = (cfg.channels as Record<string, unknown> | undefined)?.[CHANNEL_KEY];
  if (!raw || typeof raw !== "object") return undefined;

  const parsed = FastApiConfigSchema.safeParse(raw);
  if (!parsed.success) return undefined;

  return parsed.data;
}

/**
 * Resolve the list of backends from config.
 *
 * - If `backends` is set: use it. Warn (via log) if legacy `wsUrl` is also set — it is ignored.
 * - If only `wsUrl` is set: synthesize a single backend with id "default" (back-compat path).
 * - If neither is set: returns [].
 */
export function resolveBackends(
  cfg: FastApiConfig,
  log?: (msg: string) => void,
): ResolvedBackend[] {
  const backends = cfg.backends?.filter((b) => b.wsUrl.trim().length > 0) ?? [];
  if (backends.length > 0) {
    if (cfg.wsUrl?.trim()) {
      log?.(
        `fastapi: both 'wsUrl' and 'backends' configured — legacy 'wsUrl' is ignored`,
      );
    }
    return backends.map((b) => ({
      id: b.id,
      wsUrl: b.wsUrl,
      enabled: b.enabled !== false,
    }));
  }
  const legacy = cfg.wsUrl?.trim();
  if (legacy) {
    return [{ id: LEGACY_BACKEND_ID, wsUrl: legacy, enabled: true }];
  }
  return [];
}

export function resolveAccount(cfg: ClawdbotConfig): ResolvedFastApiAccount {
  const fastapiCfg = readFastApiConfig(cfg);

  const backends = fastapiCfg ? resolveBackends(fastapiCfg) : [];
  const configured = backends.length > 0;
  const enabled = Boolean(fastapiCfg?.enabled !== false && configured);

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    enabled,
    configured,
    config: fastapiCfg ?? ({} as FastApiConfig),
  };
}
