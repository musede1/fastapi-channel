import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { fastApiPlugin } from "./src/channel.js";
import { parseWebhookPayload, validateWebhookSecret, handleFastApiMessage } from "./src/bot.js";
import { resolveAccount } from "./src/account.js";

export default defineChannelPluginEntry({
  id: "fastapi",
  name: "FastAPI Channel",
  description:
    "Dispatch tasks from a FastAPI service to OpenClaw via HTTP webhooks. " +
    "FastAPI sends tasks (with optional file URLs); OpenClaw processes them and POSTs results back.",
  plugin: fastApiPlugin,

  registerFull(api) {
    const fastapiCfg = api.config ? resolveAccount(api.config).config : null;
    const webhookPath = fastapiCfg?.webhookPath ?? "/fastapi-channel/webhook";

    /**
     * Inbound webhook: FastAPI → OpenClaw
     *
     * FastAPI POSTs task payloads here. The handler:
     * 1. Validates the webhook secret (if configured)
     * 2. Parses the payload
     * 3. Downloads any file attachments
     * 4. Dispatches the task to the OpenClaw agent (fire-and-forget)
     * 5. Returns 200 immediately (does NOT wait for AI)
     */
    api.registerHttpRoute({
      path: webhookPath,
      auth: "plugin",
      handler: async (req, res) => {
        const log = api.logger?.info?.bind(api.logger) ?? console.log;
        const logErr = api.logger?.error?.bind(api.logger) ?? console.error;

        // Only allow POST
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
          return true;
        }

        // Validate webhook secret
        const cfg = api.config;
        const account = cfg ? resolveAccount(cfg) : null;
        const expectedSecret = account?.webhookSecret;
        const providedSecret = req.headers["x-webhook-secret"] as string | undefined;

        if (!validateWebhookSecret(expectedSecret, providedSecret)) {
          log(`fastapi: rejected webhook — invalid X-Webhook-Secret`);
          res.statusCode = 401;
          res.end(JSON.stringify({ ok: false, error: "Invalid webhook secret" }));
          return true;
        }

        // Parse JSON body
        let body: unknown;
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const raw = Buffer.concat(chunks).toString("utf-8");
          body = JSON.parse(raw);
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
          return true;
        }

        // Parse payload
        const payload = parseWebhookPayload(body);
        if (!payload) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              ok: false,
              error: "Invalid payload: missing required fields (event_type, task_id, content)",
            }),
          );
          return true;
        }

        // Respond immediately — do not wait for AI processing
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, task_id: payload.task_id }));

        // Process task asynchronously (fire-and-forget)
        handleFastApiMessage({ api, payload, log })
          .catch((err) => {
            logErr(`fastapi: error handling task_id=${payload.task_id}: ${String(err)}`);
          });

        return true;
      },
    });

    log(`fastapi: webhook registered at ${webhookPath}`);

    function log(msg: string) {
      (api.logger?.info ?? console.log)(msg);
    }
  },
});
