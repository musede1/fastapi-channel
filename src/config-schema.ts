import { z } from "zod";

const DmPolicySchema = z.enum(["open", "allowlist"]);

export const FastApiConfigSchema = z
  .object({
    enabled: z.boolean().optional(),

    /**
     * URL where OpenClaw will POST task results.
     * Example: "https://your-api.example.com/api/openclaw/result"
     */
    callbackUrl: z.string().url().optional(),

    /**
     * API key sent in X-API-Key header when calling FastAPI.
     * FastAPI side should validate this header to authenticate requests from OpenClaw.
     */
    apiKey: z.string().optional(),

    /**
     * Secret used to validate incoming webhook requests from FastAPI.
     * FastAPI must send this in the X-Webhook-Secret header.
     */
    webhookSecret: z.string().optional(),

    /**
     * Path for the inbound webhook endpoint.
     * Default: "/fastapi-channel/webhook"
     */
    webhookPath: z.string().optional().default("/fastapi-channel/webhook"),

    /**
     * Direct Message policy.
     * "open" — accept messages from any user_id (FastAPI handles auth)
     * "allowlist" — only accept user_ids in allowFrom
     */
    dmPolicy: DmPolicySchema.optional().default("open"),

    /**
     * Allowlisted user_ids (only used when dmPolicy = "allowlist").
     */
    allowFrom: z.array(z.string()).optional(),

    /**
     * Max file size for downloading attachments from FastAPI (MB).
     * Default: 20 MB
     */
    mediaMaxMb: z.number().positive().optional().default(20),

    /**
     * Timeout for downloading files from FastAPI (ms).
     * Default: 30 000 ms
     */
    downloadTimeoutMs: z.number().int().positive().optional().default(30_000),

    /**
     * Timeout for POSTing results back to FastAPI (ms).
     * Default: 15 000 ms
     */
    callbackTimeoutMs: z.number().int().positive().optional().default(15_000),
  })
  .strict();
