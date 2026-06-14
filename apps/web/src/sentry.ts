import type { ErrorEvent, EventHint } from "@sentry/nextjs";

type WebSentryRuntime = "web-client" | "web-edge" | "web-server";

export function createWebSentryOptions(runtime: WebSentryRuntime, env: NodeJS.ProcessEnv = process.env) {
  const dsn = readDsn(runtime, env);
  if (!dsn) return undefined;

  assertDefaultPiiDisabled(env);
  return {
    dsn,
    environment: env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? "unknown",
    release: env.NEXT_PUBLIC_SENTRY_RELEASE ?? env.SENTRY_RELEASE ?? env.RELEASE ?? undefined,
    sendDefaultPii: false,
    tracesSampleRate: readSampleRate(env),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend: (event: ErrorEvent, hint: EventHint) => scrubWebSentryEvent({ ...event, tags: { ...event.tags, runtime } }, hint),
  };
}

export function scrubWebSentryEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  const cleaned: ErrorEvent = {
    ...event,
    tags: event.tags ? redactRecord(event.tags) as ErrorEvent["tags"] : undefined,
  };

  delete cleaned.user;

  if (cleaned.message) cleaned.message = sanitizeString(cleaned.message);
  if (cleaned.logentry?.message) {
    cleaned.logentry = { ...cleaned.logentry, message: sanitizeString(cleaned.logentry.message) };
  }
  if (cleaned.request) {
    cleaned.request = {
      method: cleaned.request.method,
      url: cleaned.request.url ? stripQuery(sanitizeString(cleaned.request.url)) : undefined,
    };
  }
  if (cleaned.exception?.values) {
    cleaned.exception = {
      ...cleaned.exception,
      values: cleaned.exception.values.map((value) => ({
        ...value,
        value: value.value ? sanitizeString(value.value) : value.value,
      })),
    };
  }
  if (cleaned.breadcrumbs) {
    cleaned.breadcrumbs = cleaned.breadcrumbs.map((breadcrumb) => ({
      ...breadcrumb,
      message: breadcrumb.message ? sanitizeString(breadcrumb.message) : breadcrumb.message,
      data: breadcrumb.data ? redactRecord(breadcrumb.data) : breadcrumb.data,
    }));
  }
  if (cleaned.contexts) cleaned.contexts = redactRecord(cleaned.contexts) as ErrorEvent["contexts"];
  if (cleaned.extra) cleaned.extra = redactRecord(cleaned.extra) as ErrorEvent["extra"];

  return cleaned;
}

function readDsn(runtime: WebSentryRuntime, env: NodeJS.ProcessEnv): string | undefined {
  const publicDsn = env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (publicDsn) return publicDsn;
  if (runtime !== "web-client") return env.SENTRY_DSN?.trim() || undefined;
  return undefined;
}

function assertDefaultPiiDisabled(env: NodeJS.ProcessEnv): void {
  if (env.SENTRY_SEND_DEFAULT_PII && env.SENTRY_SEND_DEFAULT_PII !== "false") {
    throw new Error("SENTRY_SEND_DEFAULT_PII_MUST_BE_FALSE");
  }
}

function readSampleRate(env: NodeJS.ProcessEnv): number {
  const raw = env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? env.SENTRY_TRACES_SAMPLE_RATE;
  if (!raw) return env.NODE_ENV === "production" ? 0.05 : 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("SENTRY_TRACES_SAMPLE_RATE_INVALID");
  }
  return parsed;
}

function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return redactValue(value) as Record<string, unknown>;
}

function redactValue(value: unknown, key = "", depth = 0): unknown {
  if (sensitiveKeyPattern.test(key)) return "[Filtered]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value !== "object") return value;
  if (depth > 5) return "[Truncated]";
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    output[entryKey] = redactValue(entryValue, entryKey, depth + 1);
  }
  return output;
}

function sanitizeString(value: string): string {
  return value
    .replace(emailPattern, "[FilteredEmail]")
    .replace(turkishPhonePattern, "[FilteredPhone]")
    .replace(turkishNationalIdPattern, "[FilteredNationalId]");
}

function stripQuery(value: string): string {
  return value.split("?")[0] ?? value;
}

const sensitiveKeyPattern =
  /authorization|cookie|password|passwd|secret|token|jwt|email|e-mail|phone|mobile|gsm|national|kimlik|tckn|birth|dob|firstName|lastName|fullName|displayName|studentName|guardianName|teacherName|institutionName|address|iban|card|cvv/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const turkishPhonePattern = /\b(?:\+?90[\s.-]?)?0?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g;
const turkishNationalIdPattern = /\b[1-9]\d{10}\b/g;
