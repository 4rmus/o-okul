import { describe, expect, it, vi } from "vitest";
import { createSentryOptions, scrubSentryErrorEvent, type SentryClientLike } from "./sentry.js";

describe("API Sentry configuration", () => {
  it("Sentry SDK options keep default PII collection disabled", () => {
    const options = createSentryOptions("api", {
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

  it("PII collection cannot be enabled by env drift", () => {
    expect(() =>
      createSentryOptions("api", {
        SENTRY_DSN: "https://public@example.test/1",
        SENTRY_SEND_DEFAULT_PII: "true",
      }),
    ).toThrow("SENTRY_SEND_DEFAULT_PII_MUST_BE_FALSE");
  });

  it("scrubs explicit event payload fields before send", () => {
    const event = scrubSentryErrorEvent({
      type: undefined,
      message: "failed for veli@example.test and 5321234567",
      request: {
        url: "https://app.example.test/api?email=veli@example.test",
        headers: { authorization: "Bearer secret" },
      },
      user: { email: "veli@example.test" },
      tags: { tenantId: "tenant-a" },
      extra: {
        password: "secret",
        nested: { studentName: "Ada Yilmaz", note: "TC 12345678901" },
      },
      exception: {
        values: [{ value: "student veli@example.test failed" }],
      },
    });

    expect(event.user).toBeUndefined();
    expect(event.message).toBe("failed for [FilteredEmail] and [FilteredPhone]");
    expect(event.request).toEqual({ url: "https://app.example.test/api", method: undefined });
    expect(event.tags).toEqual({ tenantId: "tenant-a" });
    expect(event.extra).toEqual({
      password: "[Filtered]",
      nested: { studentName: "[Filtered]", note: "TC [FilteredNationalId]" },
    });
    expect(event.exception?.values?.[0]?.value).toBe("student [FilteredEmail] failed");
  });
});

export function createFakeSentryClient(enabled = true): SentryClientLike & {
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
    isEnabled: vi.fn(() => enabled),
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
