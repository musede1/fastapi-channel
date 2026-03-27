import { describe, it, expect } from "vitest";
import { parseWebhookPayload, validateWebhookSecret, isSenderAllowed, buildAgentBody } from "./bot.js";
import type { FastApiTaskContext } from "./types.js";

// ============ parseWebhookPayload ============

describe("parseWebhookPayload", () => {
  it("parses a valid text task", () => {
    const payload = parseWebhookPayload({
      event_type: "task",
      task_id: "t001",
      content: "Hello",
    });
    expect(payload).not.toBeNull();
    expect(payload?.task_id).toBe("t001");
    expect(payload?.event_type).toBe("task");
    expect(payload?.user_id).toBe("system"); // default
  });

  it("parses a file_task with file_urls", () => {
    const payload = parseWebhookPayload({
      event_type: "file_task",
      task_id: "t002",
      content: "Analyze this image",
      user_id: "auto_worker",
      file_urls: [
        { url: "https://example.com/img.jpg", filename: "img.jpg", mime_type: "image/jpeg" },
      ],
    });
    expect(payload).not.toBeNull();
    expect(payload?.file_urls).toHaveLength(1);
    expect(payload?.file_urls?.[0].url).toBe("https://example.com/img.jpg");
  });

  it("parses a heartbeat event", () => {
    const payload = parseWebhookPayload({
      event_type: "heartbeat",
      task_id: "hb_001",
      content: "",
    });
    expect(payload).not.toBeNull();
    expect(payload?.event_type).toBe("heartbeat");
  });

  it("returns null for unknown event_type", () => {
    expect(parseWebhookPayload({ event_type: "unknown", task_id: "t", content: "x" })).toBeNull();
  });

  it("returns null for missing task_id", () => {
    expect(parseWebhookPayload({ event_type: "task", content: "x" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseWebhookPayload(null)).toBeNull();
    expect(parseWebhookPayload("string")).toBeNull();
    expect(parseWebhookPayload(42)).toBeNull();
  });

  it("passes through metadata", () => {
    const payload = parseWebhookPayload({
      event_type: "task",
      task_id: "t003",
      content: "test",
      metadata: { source: "pipeline", priority: "high" },
    });
    expect(payload?.metadata).toEqual({ source: "pipeline", priority: "high" });
  });

  it("strips invalid file_urls entries (missing url)", () => {
    const payload = parseWebhookPayload({
      event_type: "file_task",
      task_id: "t004",
      content: "test",
      file_urls: [
        { url: "https://example.com/ok.jpg" },
        { filename: "no-url.jpg" }, // invalid
      ],
    });
    expect(payload?.file_urls).toHaveLength(1);
  });
});

// ============ validateWebhookSecret ============

describe("validateWebhookSecret", () => {
  it("returns true when no secret is configured", () => {
    expect(validateWebhookSecret(undefined, undefined)).toBe(true);
    expect(validateWebhookSecret(undefined, "random")).toBe(true);
  });

  it("returns false when secret configured but not provided", () => {
    expect(validateWebhookSecret("mysecret", undefined)).toBe(false);
  });

  it("returns true when secret matches", () => {
    expect(validateWebhookSecret("mysecret", "mysecret")).toBe(true);
  });

  it("returns false when secret does not match", () => {
    expect(validateWebhookSecret("mysecret", "wrong")).toBe(false);
  });
});

// ============ isSenderAllowed ============

describe("isSenderAllowed", () => {
  it("allows everyone when dmPolicy is open", () => {
    expect(isSenderAllowed({ userId: "anyone", dmPolicy: "open", allowFrom: [] })).toBe(true);
  });

  it("allows wildcard in allowlist", () => {
    expect(isSenderAllowed({ userId: "u1", dmPolicy: "allowlist", allowFrom: ["*"] })).toBe(true);
  });

  it("allows specific user in allowlist", () => {
    expect(
      isSenderAllowed({ userId: "user_42", dmPolicy: "allowlist", allowFrom: ["user_42"] }),
    ).toBe(true);
  });

  it("blocks user not in allowlist", () => {
    expect(
      isSenderAllowed({ userId: "user_99", dmPolicy: "allowlist", allowFrom: ["user_42"] }),
    ).toBe(false);
  });

  it("blocks when allowlist is empty", () => {
    expect(isSenderAllowed({ userId: "u1", dmPolicy: "allowlist", allowFrom: [] })).toBe(false);
  });
});

// ============ buildAgentBody ============

describe("buildAgentBody", () => {
  it("builds body with task_id and sender", () => {
    const ctx: FastApiTaskContext = {
      taskId: "t001",
      userId: "auto_worker",
      content: "Analyze this data",
      localFiles: [],
    };
    const body = buildAgentBody(ctx);
    expect(body).toContain("[task_id: t001]");
    expect(body).toContain("auto_worker: Analyze this data");
  });

  it("uses userName when available", () => {
    const ctx: FastApiTaskContext = {
      taskId: "t002",
      userId: "u1",
      userName: "Automation Bot",
      content: "Do something",
      localFiles: [],
    };
    const body = buildAgentBody(ctx);
    expect(body).toContain("Automation Bot: Do something");
  });

  it("appends file placeholders", () => {
    const ctx: FastApiTaskContext = {
      taskId: "t003",
      userId: "u1",
      content: "Look at these",
      localFiles: [
        { path: "/tmp/a.jpg", contentType: "image/jpeg", filename: "a.jpg", placeholder: "<media:image>" },
        { path: "/tmp/b.pdf", contentType: "application/pdf", filename: "b.pdf", placeholder: "<media:file>" },
      ],
    };
    const body = buildAgentBody(ctx);
    expect(body).toContain("<media:image>");
    expect(body).toContain("<media:file>");
  });
});
