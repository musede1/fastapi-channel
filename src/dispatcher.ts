import { createHash } from "node:crypto";
import type { FastApiConfig } from "./types.js";

const DEFAULT_WORKER_AGENT = "xiaoneng";

export type DispatchStrategy = "round_robin";

export type DispatchSelection = {
  agentId: string;
  strategy: DispatchStrategy;
  workers: string[];
};

function hashTaskId(taskId: string): number {
  const digest = createHash("sha1").update(taskId).digest();
  return digest.readUInt32BE(0);
}

/**
 * Pick a worker agent for an inbound task.
 *
 * Uses hash(task_id) % workers.length so retries of the same task land on the
 * same agent and survive gateway restarts (no in-memory counter).
 *
 * Falls back to ["xiaoneng"] when workerAgents is unset, preserving the
 * previous single-agent behavior.
 */
export function selectWorkerAgent(params: {
  fastapiCfg: FastApiConfig;
  taskId: string;
}): DispatchSelection {
  const { fastapiCfg, taskId } = params;

  const configured =
    fastapiCfg.workerAgents?.map((s) => s.trim()).filter((s) => s.length > 0) ?? [];
  const workers = configured.length > 0 ? configured : [DEFAULT_WORKER_AGENT];

  const strategy: DispatchStrategy = fastapiCfg.dispatchStrategy ?? "round_robin";

  const index = hashTaskId(taskId) % workers.length;
  const agentId = workers[index]!;

  return { agentId, strategy, workers };
}
