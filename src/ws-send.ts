import type { createWsClient } from "./ws-client.js";

let wsClient: ReturnType<typeof createWsClient> | null = null;

export function setWsClient(client: ReturnType<typeof createWsClient>) {
  wsClient = client;
}

export function getWsClient() {
  return wsClient;
}
