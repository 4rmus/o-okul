import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";
import { getJobContext } from "../context/job-context.js";

const filtered = "[Filtered]";

export interface WorkerJobLogMetadata {
  contentHash?: string;
  durationMs: number;
  entityId?: string;
  jobId?: string;
  queueName: string;
  tenantId?: string;
  userId?: string;
}

export function createWorkerPinoLogger(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
  stream?: DestinationStream,
): Logger {
  const options = createWorkerPinoLoggerOptions(service, env);
  return stream ? pino(options, stream) : pino(options);
}

export function createWorkerPinoLoggerOptions(service: string, env: NodeJS.ProcessEnv = process.env): LoggerOptions {
  return {
    enabled: isLoggingEnabled(env),
    level: env.LOG_LEVEL ?? "info",
    base: {
      service,
      environment: env.LOG_ENVIRONMENT ?? env.NODE_ENV ?? "unknown",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: sensitiveRedactionPaths,
      censor: filtered,
    },
    serializers: {
      err: (error) => redactLogValue(pino.stdSerializers.err(error), "err"),
    },
  };
}

export function logWorkerJobCompleted(logger: Logger, metadata: WorkerJobLogMetadata): void {
  logger.info(jobFields(metadata, "completed"), "worker_job_completed");
}

export function logWorkerJobFailed(logger: Logger, metadata: WorkerJobLogMetadata, error: unknown): void {
  logger.error({ ...jobFields(metadata, "failed"), err: error }, "worker_job_failed");
}

export function redactLogValue(value: unknown, key = "", depth = 0, seen = new WeakSet<object>()): unknown {
  if (sensitiveKeyPattern.test(key)) return filtered;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth > 5) return "[Truncated]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Error) {
    return {
      type: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, key, depth + 1, seen));

  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    output[entryKey] = redactLogValue(entryValue, entryKey, depth + 1, seen);
  }
  return output;
}

function jobFields(metadata: WorkerJobLogMetadata, status: "completed" | "failed"): Record<string, unknown> {
  const context = readJobContext();
  return compactLogRecord({
    status,
    queueName: metadata.queueName,
    jobId: metadata.jobId ?? context?.jobId,
    tenantId: metadata.tenantId ?? context?.tenantId,
    userId: metadata.userId ?? context?.userId,
    entityId: metadata.entityId,
    contentHash: metadata.contentHash,
    durationMs: metadata.durationMs,
  });
}

function readJobContext(): { tenantId: string; userId: string; jobId: string } | undefined {
  try {
    return getJobContext();
  } catch {
    return undefined;
  }
}

function compactLogRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function isLoggingEnabled(env: NodeJS.ProcessEnv): boolean {
  if (env.LOG_ENABLED === "true") return true;
  if (env.LOG_ENABLED === "false") return false;
  return env.NODE_ENV !== "test";
}

function sanitizeString(value: string): string {
  return value
    .replace(emailPattern, "[FilteredEmail]")
    .replace(turkishPhonePattern, "[FilteredPhone]")
    .replace(turkishNationalIdPattern, "[FilteredNationalId]");
}

const sensitiveRedactionPaths = [
  "authorization",
  "cookie",
  "password",
  "token",
  "secret",
  "jwt",
  "email",
  "phone",
  "nationalId",
  "headers.authorization",
  "headers.cookie",
  "body.password",
  "body.token",
  "body.email",
  "body.phone",
];

const sensitiveKeyPattern =
  /authorization|cookie|password|passwd|secret|token|jwt|email|e-mail|phone|mobile|gsm|national|kimlik|tckn|birth|dob|firstName|lastName|fullName|displayName|studentName|guardianName|teacherName|institutionName|address|iban|card|cvv/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const turkishPhonePattern = /\b(?:\+?90[\s.-]?)?0?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g;
const turkishNationalIdPattern = /\b[1-9]\d{10}\b/g;

export const workerLogger = createWorkerPinoLogger("worker");
