import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { fastApiPlugin } from "./src/channel.js";
import { setFastApiRuntime } from "./src/runtime.js";

const plugin = {
  id: "fastapi",
  name: "FastAPI Channel",
  description:
    "Connect to a Fastify/FastAPI service via WebSocket for bidirectional task dispatch.",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setFastApiRuntime(api.runtime);
    api.registerChannel({ plugin: fastApiPlugin });
  },
};

export default plugin;
