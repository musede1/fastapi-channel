import { postResultToFastApi } from "./client.js";
import { resolveAccount } from "./account.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { OutboundResultPayload, TaskStatus } from "./types.js";

/**
 * Send an AI-generated result back to the FastAPI callback endpoint.
 */
export async function sendResultToFastApi(params: {
  api: OpenClawPluginApi;
  taskId: string;
  content: string;
  status: TaskStatus;
  metadata?: Record<string, unknown>;
  log?: (msg: string) => void;
}): Promise<void> {
  const { api, taskId, content, status, metadata, log = console.log } = params;

  const cfg = api.config;
  if (!cfg) {
    log("fastapi: no config, cannot send result");
    return;
  }

  const account = resolveAccount(cfg);
  const fastapiCfg = account.config;

  if (!fastapiCfg.callbackUrl) {
    log(`fastapi: no callbackUrl configured, dropping result for task_id=${taskId}`);
    return;
  }

  const payload: OutboundResultPayload = {
    event_type: "task_result",
    task_id: taskId,
    status,
    content,
    timestamp: Math.floor(Date.now() / 1000),
    ...(metadata ? { metadata } : {}),
  };

  try {
    await postResultToFastApi({
      callbackUrl: fastapiCfg.callbackUrl,
      apiKey: fastapiCfg.apiKey,
      payload,
      timeoutMs: fastapiCfg.callbackTimeoutMs ?? 15_000,
    });
    log(`fastapi: sent ${status} result for task_id=${taskId} to ${fastapiCfg.callbackUrl}`);
  } catch (err) {
    log(`fastapi: failed to send result for task_id=${taskId}: ${String(err)}`);
    throw err;
  }
}

/**
 * Send an error result to FastAPI (convenience wrapper).
 */
export async function sendErrorToFastApi(params: {
  api: OpenClawPluginApi;
  taskId: string;
  errorMessage: string;
  metadata?: Record<string, unknown>;
  log?: (msg: string) => void;
}): Promise<void> {
  return sendResultToFastApi({
    ...params,
    content: params.errorMessage,
    status: "failed",
  });
}
