import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { fastApiPlugin } from "./src/channel.js";
import { setFastApiRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "fastapi",
  name: "FastAPI Channel",
  description:
    "Connect to a Fastify/FastAPI service via WebSocket for bidirectional task dispatch.",
  plugin: fastApiPlugin,
  setRuntime: setFastApiRuntime,
});
