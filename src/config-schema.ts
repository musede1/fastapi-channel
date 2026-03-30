import { z } from "zod";

export const FastApiConfigSchema = z
  .object({
    enabled: z.boolean().optional(),

    /** WebSocket URL to connect to the Fastify server */
    wsUrl: z.string().optional(),

    /** Direct Message policy */
    dmPolicy: z.enum(["open", "allowlist"]).optional().default("open"),

    /** Allowlisted user_ids (only used when dmPolicy = "allowlist") */
    allowFrom: z.array(z.string()).optional(),

    /** Max file size for downloading attachments (MB) */
    mediaMaxMb: z.number().positive().optional().default(20),

    /** Timeout for downloading files (ms) */
    downloadTimeoutMs: z.number().int().positive().optional().default(30_000),
  })
  .strict();
