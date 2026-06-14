import { describe, expect, it, vi } from "vitest";
import { captureWorkerJobException, createSentryOptions, type SentryClientLike } from "./sentry.js";

describe("worker Sentry reporting", () => {
  it("keeps PII collection disabled in SDK options", () => {
    const options = createSentryOptions("worker", {
      SENTRY_DSN: "https://public@example.test/1",
      SENTRY_ENVIRONMENT: "test",
      SENTRY_SEND_DEFAULT_PII: "false",
    });

    expect(options).toMatchObject({
      dsn: "https://public@example.test/1",
      environment: "test",
      sendDefaultPii: false,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        queryParams: false,
        genAI: { inputs: false, outputs: false },
        stackFrameVariables: false,
      },
    });
  });

  it("captures failed jobs with tenant and queue metadata only", () => {
    const client = createFakeSentryClient();
    const error = new Error("REPORT_GENERATION_FAILED");

    captureWorkerJobException(error, {
      queueName: "report-generation",
      tenantId: "tenant-a",
      jobId: "exam-a_hash-a",
      entityId: "exam-a",
      contentHash: "hash-a",
    }, client);

    expect(client.tags).toEqual({
      runtime: "worker",
      queue: "report-generation",
      tenantId: "tenant-a",
    });
    expect(client.contexts.queueJob).toEqual({
      queueName: "report-generation",
      tenantId: "tenant-a",
      jobId: "exam-a_hash-a",
      entityId: "exam-a",
      contentHash: "hash-a",
    });
    expect(client.captured).toEqual([error]);
  });
});

function createFakeSentryClient(): SentryClientLike & {
  captured: unknown[];
  contexts: Record<string, Record<string, unknown> | null>;
  tags: Record<string, string>;
} {
  const tags: Record<string, string> = {};
  const contexts: Record<string, Record<string, unknown> | null> = {};
  const captured: unknown[] = [];

  return {
    captured,
    contexts,
    tags,
    captureException: vi.fn((exception: unknown) => {
      captured.push(exception);
      return "event-id";
    }),
    flush: vi.fn(async () => true),
    init: vi.fn(),
    isEnabled: vi.fn(() => true),
    withScope: vi.fn((callback) => {
      callback({
        setContext: (name: string, context: Record<string, unknown> | null) => {
          contexts[name] = context;
        },
        setTag: (key: string, value: string) => {
          tags[key] = value;
        },
      });
    }),
  };
}
