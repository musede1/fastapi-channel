import type { InboundFileRef, OutboundResultPayload } from "./types.js";

// ============ HTTP helpers ============

/**
 * Download a file from a URL (FastAPI-hosted) and return its buffer.
 * Respects maxBytes and timeoutMs limits.
 */
export async function downloadFile(params: {
  url: string;
  filename: string;
  maxBytes: number;
  timeoutMs: number;
}): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const { url, filename, maxBytes, timeoutMs } = params;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new Error(
      `Failed to download file "${filename}" from ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `Failed to download file "${filename}": HTTP ${response.status} ${response.statusText}`,
    );
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error(
      `File "${filename}" is too large (${contentLength} bytes, max ${maxBytes})`,
    );
  }

  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/octet-stream";

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.byteLength > maxBytes) {
    throw new Error(
      `File "${filename}" exceeded max size (${buffer.byteLength} bytes, max ${maxBytes})`,
    );
  }

  return { buffer, contentType, filename };
}

/**
 * Resolve a filename from a file reference, falling back to the URL path.
 */
export function resolveFilename(ref: InboundFileRef): string {
  if (ref.filename) return ref.filename;
  try {
    const pathname = new URL(ref.url).pathname;
    const base = pathname.split("/").pop();
    if (base && base.length > 0) return base;
  } catch {
    // ignore
  }
  return "attachment";
}

/**
 * Infer a media placeholder string from a MIME type or filename.
 */
export function inferPlaceholder(contentType: string, filename: string): string {
  if (contentType.startsWith("image/")) return "<media:image>";
  if (contentType.startsWith("video/")) return "<media:video>";
  if (contentType.startsWith("audio/")) return "<media:audio>";
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "<media:pdf>";
  return "<media:file>";
}

// ============ Outbound callback ============

/**
 * POST an AI result payload to the FastAPI callback URL.
 */
export async function postResultToFastApi(params: {
  callbackUrl: string;
  apiKey?: string;
  payload: OutboundResultPayload;
  timeoutMs: number;
}): Promise<void> {
  const { callbackUrl, apiKey, payload, timeoutMs } = params;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `FastAPI callback failed: HTTP ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}
