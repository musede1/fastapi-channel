import type { z } from "zod";
import type { FastApiConfigSchema } from "./config-schema.js";

// ============ Config Types ============

export type FastApiConfig = z.infer<typeof FastApiConfigSchema>;

export type ResolvedFastApiAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  /** Callback URL to POST AI results back to FastAPI */
  callbackUrl?: string;
  apiKey?: string;
  webhookSecret?: string;
  config: FastApiConfig;
};

// ============ Inbound Message Types ============

/** File attachment in an inbound task */
export type InboundFileRef = {
  url: string;
  filename?: string;
  mime_type?: string;
};

/** Event types for inbound messages from FastAPI */
export type InboundEventType = "task" | "file_task" | "heartbeat";

/** Inbound webhook payload from FastAPI */
export type InboundWebhookPayload = {
  event_type: InboundEventType;
  task_id: string;
  content: string;
  user_id?: string;
  user_name?: string;
  file_urls?: InboundFileRef[];
  metadata?: Record<string, unknown>;
  reply_to_task_id?: string | null;
};

/** Parsed inbound task context (after file download) */
export type FastApiTaskContext = {
  taskId: string;
  userId: string;
  userName?: string;
  content: string;
  /** Paths to locally-downloaded files */
  localFiles: DownloadedFile[];
  metadata?: Record<string, unknown>;
  replyToTaskId?: string | null;
};

/** A file that has been downloaded from FastAPI and saved locally */
export type DownloadedFile = {
  path: string;
  contentType: string;
  filename: string;
  placeholder: string;
};

// ============ Outbound Result Types ============

/** Event types for outbound results to FastAPI */
export type OutboundEventType = "task_result" | "reply" | "error";

/** Status values for outbound results */
export type TaskStatus = "completed" | "failed" | "partial";

/** Outbound payload sent back to FastAPI */
export type OutboundResultPayload = {
  event_type: OutboundEventType;
  task_id: string;
  status: TaskStatus;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
};
