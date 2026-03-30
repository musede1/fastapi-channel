import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setFastApiRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getFastApiRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("FastAPI runtime not initialized");
  }
  return runtime;
}
