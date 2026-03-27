import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { fastApiPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(fastApiPlugin);
