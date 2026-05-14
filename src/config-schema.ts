import { z } from "zod";

export const BackendSchema = z
  .object({
    id: z.string().min(1),
    wsUrl: z.string().min(1),
    enabled: z.boolean().optional().default(true),
  })
  .strict();

export const FastApiConfigSchema = z
  .object({
    enabled: z.boolean().optional(),

    /** Legacy single-backend WebSocket URL. Synthesized into backends[0] when `backends` is unset. */
    wsUrl: z.string().optional(),

    /** Multiple backends (e.g. prod / dev). Each runs its own WS client; results route back to the originating backend. */
    backends: z.array(BackendSchema).optional(),

    /** Direct Message policy */
    dmPolicy: z.enum(["open", "allowlist"]).optional().default("open"),

    /** Allowlisted user_ids (only used when dmPolicy = "allowlist") */
    allowFrom: z.array(z.string()).optional(),

    /** Max file size for downloading attachments (MB) */
    mediaMaxMb: z.number().positive().optional().default(20),

    /** Timeout for downloading files (ms) */
    downloadTimeoutMs: z.number().int().positive().optional().default(30_000),

    /** Worker agent IDs to dispatch tasks across. Defaults to ["xiaoneng"] when omitted. */
    workerAgents: z.array(z.string()).optional(),

    /** Strategy used to pick a worker agent for an inbound task. */
    dispatchStrategy: z.enum(["round_robin"]).optional().default("round_robin"),
  })
  .strict();
