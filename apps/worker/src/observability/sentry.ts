import * as Sentry from "@sentry/node";
import type { ErrorEvent, EventHint, NodeOptions } from "@sentry/node";

interface SentryScopeLike {
  setContext(name: string, context: Record<string, unknown> | null): void;
  setTag(key: string, value: string): void;
}

export interface SentryClientLike {
  captureException(exception: unknown): string;
  flush(timeout?: number): Promise<boolean>;
  init(options?: NodeOptions): unknown;
  isEnabled(): boolean;
  withScope(callback: (scope: SentryScopeLike) => void): void;
}

export interface WorkerJobExceptionMetadata {
  contentHash?: string;
  entityId?: string;
  jobId?: string;
  queueName: string;
  tenantId?: string;
}

const defaultSentryClient = Sentry as unknown as SentryClientLike;

export function initWorkerSentry(
  env: NodeJS.ProcessEnv = process.env,
  client: SentryClientLike = defaultSentryClient,
): boolean {
  const options = createSentryOptions("worker", env);
  if (!options) return false;
  client.init(options);
  return true;
}

export async function flushWorkerSentry(
  timeoutMs = 2000,
  client: SentryClientLike = defaultSentryClient,
): Promise<boolean> {
  if (!client.isEnabled()) return true;
  return client.flush(timeoutMs);
}

export function captureWorkerJobException(
  exception: unknown,
  metadata: WorkerJobExceptionMetadata,
  client: SentryClientLike = defaultSentryClient,
): void {
  if (!client.isEnabled()) return;

  client.withScope((scope) => {
    scope.setTag("runtime", "worker");
    scope.setTag("queue", metadata.queueName);
    if (metadata.tenantId) scope.setTag("tenantId", metadata.tenantId);
    scope.setContext("queueJob", redactRecord({
      queueName: metadata.queueName,
      jobId: metadata.jobId,
      tenantId: metadata.tenantId,
      entityId: metadata.entityId,
      contentHash: metadata.contentHash,
    }));

    client.captureException(exception);
  });
}

export function createSentryOptions(runtime: "api" | "worker" | "smoke", env: NodeJS.ProcessEnv): NodeOptions | undefined {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return undefined;

  assertDefaultPiiDisabled(env);
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? "unknown",
    release: env.SENTRY_RELEASE || env.RELEASE || undefined,
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
    registerEsmLoaderHooks: false,
    tracesSampleRate: 0,
    beforeSend: (event: ErrorEvent, hint: EventHint) => scrubSentryErrorEvent({ ...event, tags: { ...event.tags, runtime } }, hint),
  };
}

export function scrubSentryErrorEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
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

function assertDefaultPiiDisabled(env: NodeJS.ProcessEnv): void {
  if (env.SENTRY_SEND_DEFAULT_PII && env.SENTRY_SEND_DEFAULT_PII !== "false") {
    throw new Error("SENTRY_SEND_DEFAULT_PII_MUST_BE_FALSE");
  }
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
