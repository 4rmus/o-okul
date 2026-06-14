import { randomUUID } from "node:crypto";
import type { LoggerService } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";
import pinoHttp from "pino-http";
import { getApiLogContext, runWithApiLogContext } from "./log-context.js";

const filtered = "[Filtered]";

export function createPinoLogger(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
  stream?: DestinationStream,
): Logger {
  const options = createPinoLoggerOptions(service, env);
  return stream ? pino(options, stream) : pino(options);
}

export function createPinoLoggerOptions(service: string, env: NodeJS.ProcessEnv = process.env): LoggerOptions {
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

export function createApiHttpLoggerMiddleware(logger: Logger = apiLogger): (request: Request, response: Response, next: NextFunction) => void {
  const httpLogger = pinoHttp<Request, Response>({
    logger,
    wrapSerializers: false,
    customAttributeKeys: {
      req: "httpRequest",
      res: "httpResponse",
      err: "error",
      reqId: "requestId",
      responseTime: "durationMs",
    },
    genReqId: (request, response) => {
      const requestId = getApiLogContext()?.requestId ?? readRequestId(request.headers["x-request-id"]) ?? randomUUID();
      response.setHeader("x-request-id", requestId);
      return requestId;
    },
    customProps: (request) => compactLogRecord({
      requestId: String(request.id),
      tenantId: getApiLogContext()?.tenantId ?? undefined,
      userId: getApiLogContext()?.userId,
    }),
    customSuccessMessage: () => "http_request_completed",
    customErrorMessage: () => "http_request_failed",
    customSuccessObject: (request, response, value) => ({
      ...value,
      httpRequest: httpRequestFields(request),
      httpResponse: httpResponseFields(response),
    }),
    customErrorObject: (request, response, error, value) => ({
      ...value,
      httpRequest: httpRequestFields(request),
      httpResponse: httpResponseFields(response),
      error: redactLogValue(pino.stdSerializers.err(error), "err"),
    }),
    serializers: {
      req: httpRequestFields,
      res: httpResponseFields,
      err: (error) => redactLogValue(pino.stdSerializers.err(error), "err"),
    },
  });

  return (request, response, next) => {
    const requestId = readRequestId(request.headers["x-request-id"]) ?? randomUUID();
    runWithApiLogContext({ requestId }, () => httpLogger(request, response, next));
  };
}

export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger = apiLogger) {}

  log(message: unknown, context?: string): void {
    this.logger.info(this.fields(context), this.message(message));
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error(compactLogRecord({ ...this.fields(context), trace: trace ? sanitizeString(trace) : undefined }), this.message(message));
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn(this.fields(context), this.message(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug(this.fields(context), this.message(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace(this.fields(context), this.message(message));
  }

  private fields(context?: string): Record<string, unknown> {
    const logContext = getApiLogContext();
    return compactLogRecord({
      context,
      requestId: logContext?.requestId,
      tenantId: logContext?.tenantId ?? undefined,
      userId: logContext?.userId,
    });
  }

  private message(message: unknown): string {
    const redacted = redactLogValue(message);
    if (typeof redacted === "string") return redacted;
    if (redacted instanceof Error) return sanitizeString(redacted.message);
    return sanitizeString(JSON.stringify(redacted));
  }
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

function compactLogRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function readRequestId(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return undefined;
  const trimmed = candidate.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(trimmed)) return undefined;
  return trimmed;
}

function pathWithoutQuery(url: string | undefined): string {
  if (!url) return "/";
  return url.split("?")[0] || "/";
}

function httpRequestFields(request: Request): Record<string, unknown> {
  return compactLogRecord({
    id: String(request.id),
    method: request.method,
    path: pathWithoutQuery(request.url),
    remoteAddress: request.socket?.remoteAddress,
  });
}

function httpResponseFields(response: Response): Record<string, unknown> {
  return {
    statusCode: response.statusCode,
  };
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
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
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

export const apiLogger = createPinoLogger("api");
