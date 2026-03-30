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
