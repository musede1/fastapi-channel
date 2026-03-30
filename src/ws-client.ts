import WebSocket from "ws";

export type WsMessageHandler = (msg: {
  type: string;
  task_id: string;
  content: string;
  user_id?: string;
  user_name?: string;
  metadata?: Record<string, unknown>;
}) => void;

export type WsClientOptions = {
  url: string;
  onMessage: WsMessageHandler;
  log: (msg: string) => void;
  abortSignal: AbortSignal;
};

/**
 * WebSocket client with auto-reconnect.
 * Connects to Fastify WS server, receives task messages, sends result messages.
 */
export function createWsClient(opts: WsClientOptions) {
  const { url, onMessage, log, abortSignal } = opts;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let attempt = 0;

  function connect() {
    if (abortSignal.aborted) return;

    log(`fastapi-ws: connecting to ${url}`);
    ws = new WebSocket(url);

    ws.on("open", () => {
      attempt = 0;
      log(`fastapi-ws: connected to ${url}`);
      // Heartbeat every 30s to keep nginx from closing the connection
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.ping();
      }, 30_000);
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "task") {
          onMessage(msg);
        }
      } catch (err) {
        log(`fastapi-ws: invalid message: ${String(err)}`);
      }
    });

    ws.on("close", () => {
      log(`fastapi-ws: disconnected`);
      ws = null;
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      log(`fastapi-ws: error: ${String(err)}`);
      ws?.close();
    });
  }

  function scheduleReconnect() {
    if (abortSignal.aborted) return;
    const delay = Math.min(3000 * Math.pow(2, attempt), 60000);
    attempt++;
    log(`fastapi-ws: reconnecting in ${Math.round(delay / 1000)}s (attempt ${attempt})`);
    reconnectTimer = setTimeout(connect, delay);
  }

  function sendResult(payload: {
    task_id: string;
    status: string;
    content: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
  }) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log(`fastapi-ws: cannot send result, not connected`);
      return false;
    }
    ws.send(JSON.stringify({ type: "result", ...payload }));
    return true;
  }

  // Start connection
  connect();

  // Cleanup on abort
  abortSignal.addEventListener("abort", () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  }, { once: true });

  return { sendResult };
}
