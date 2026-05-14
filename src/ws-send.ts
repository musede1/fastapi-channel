import type { createWsClient } from "./ws-client.js";
import { getTaskBackend } from "./task-map.js";

type WsClient = ReturnType<typeof createWsClient>;

/**
 * Active WS clients keyed by backendId. Multi-backend mode keeps one entry per
 * configured backend (e.g. "prod", "dev"); legacy single-backend mode keys
 * "default".
 */
const clients = new Map<string, WsClient>();

export function setWsClient(backendId: string, client: WsClient) {
  clients.set(backendId, client);
}

export function getWsClient(backendId: string): WsClient | undefined {
  return clients.get(backendId);
}

export function removeWsClient(backendId: string) {
  clients.delete(backendId);
}

export function listBackendIds(): string[] {
  return Array.from(clients.keys());
}

/**
 * Route a result message back to the backend that originated the task.
 *
 * Returns `true` on successful send. Returns `false` (and logs ERROR via
 * `params.log` if provided) when:
 *   - there is no taskId → backendId mapping (task unknown or restart-evicted),
 *   - the target backend has no live WS client,
 *   - the underlying client could not send (not connected).
 *
 * Callers should NOT broadcast on failure — that would risk cross-environment
 * leakage. Drop and log instead.
 */
export function sendResultForTask(params: {
  taskId: string;
  status: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  log?: (msg: string) => void;
}): boolean {
  const { taskId, status, content, timestamp, metadata, log } = params;

  const backendId = getTaskBackend(taskId);
  if (!backendId) {
    log?.(
      `fastapi: ERROR cannot route result for task_id=${taskId} — no backend mapping (dropped)`,
    );
    return false;
  }

  const client = clients.get(backendId);
  if (!client) {
    log?.(
      `fastapi: ERROR cannot send result for task_id=${taskId} — backend=${backendId} has no live client (dropped)`,
    );
    return false;
  }

  return client.sendResult({
    task_id: taskId,
    status,
    content,
    timestamp,
    metadata,
  });
}
