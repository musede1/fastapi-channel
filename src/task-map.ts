/**
 * Maps "to" targets to the most recent task_id.
 * Used by outbound.sendText to know which task_id to include in the WS result.
 */
const taskMap = new Map<string, string>();

export function setTaskId(to: string, taskId: string) {
  taskMap.set(to, taskId);
}

export function getTaskId(to: string): string | undefined {
  return taskMap.get(to);
}

/**
 * Maps task_id to the backend it originated from.
 * Used so results route back to the same backend that dispatched the task —
 * prevents prod results from leaking into dev and vice versa.
 */
const backendMap = new Map<string, string>();

export function setTaskBackend(taskId: string, backendId: string) {
  backendMap.set(taskId, backendId);
}

export function getTaskBackend(taskId: string): string | undefined {
  return backendMap.get(taskId);
}
