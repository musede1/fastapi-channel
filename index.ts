import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { fastApiPlugin } from "./src/channel.js";
import { parseWebhookPayload, validateWebhookSecret, handleFastApiMessage } from "./src/bot.js";
import { resolveAccount } from "./src/account.js";
import { setFastApiRuntime } from "./src/runtime.js";

const plugin = {
  id: "fastapi",
  name: "FastAPI Channel",
  description:
    "Dispatch tasks from a FastAPI/Fastify service to OpenClaw via HTTP webhooks.",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setFastApiRuntime(api.runtime);
    api.registerChannel({ plugin: fastApiPlugin });

    const fastapiCfg = api.config ? resolveAccount(api.config).config : null;
    const webhookPath = fastapiCfg?.webhookPath ?? "/fastapi-channel/webhook";

    api.registerHttpRoute({
      path: webhookPath,
      auth: "plugin",
      handler: async (req, res) => {
        const log = api.logger?.info?.bind(api.logger) ?? console.log;
        const logErr = api.logger?.error?.bind(api.logger) ?? console.error;

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST");
          res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
          return true;
        }

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

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, task_id: payload.task_id }));

        if (!cfg) {
          log("fastapi: no config available, dropping message");
          return true;
        }

        handleFastApiMessage({ cfg, payload, log }).catch((err) => {
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
};

export default plugin;
