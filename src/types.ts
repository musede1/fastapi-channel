import type { z } from "zod";
import type { FastApiConfigSchema } from "./config-schema.js";

export type FastApiConfig = z.infer<typeof FastApiConfigSchema>;

export type ResolvedFastApiAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  config: FastApiConfig;
};

/** Inbound webhook payload */
export type InboundWebhookPayload = {
  event_type: "task" | "file_task" | "heartbeat";
  task_id: string;
  content: string;
  user_id?: string;
  user_name?: string;
  file_urls?: { url: string; filename?: string; mime_type?: string }[];
  metadata?: Record<string, unknown>;
  reply_to_task_id?: string | null;
};

export type FastApiTaskContext = {
  taskId: string;
  userId: string;
  userName?: string;
  content: string;
  localFiles: DownloadedFile[];
  metadata?: Record<string, unknown>;
  replyToTaskId?: string | null;
};

export type DownloadedFile = {
  path: string;
  contentType: string;
  filename: string;
  placeholder: string;
};
