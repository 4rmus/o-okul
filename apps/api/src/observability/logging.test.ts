import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pino, { type DestinationStream } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { setApiLogContext } from "./log-context.js";
import {
  createApiHttpLoggerMiddleware,
  createPinoLoggerOptions,
  PinoNestLogger,
  redactLogValue,
} from "./logging.js";

describe("api structured logging", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    const currentServer = server;
    server = undefined;
    currentServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      currentServer.close((error) => error ? reject(error) : resolve());
    });
  });

  it("redacts PII keys and string values", () => {
    expect(redactLogValue({
      email: "veli@example.test",
      profile: {
        firstName: "Ada",
        phone: "0500 123 45 67",
        note: "TC 12345678901",
      },
    })).toEqual({
      email: "[Filtered]",
      profile: {
        firstName: "[Filtered]",
        phone: "[Filtered]",
        note: "TC [FilteredNationalId]",
      },
    });
  });

  it("logs safe request metadata with request and tenant correlation", async () => {
    const lines: string[] = [];
    const logger = pino(
      createPinoLoggerOptions("api", { NODE_ENV: "production", LOG_LEVEL: "info" }),
      collectLines(lines),
    );
    const middleware = createApiHttpLoggerMiddleware(logger);

    server = createServer((request, response) => {
      middleware(request as never, response as never, () => {
        setApiLogContext({ tenantId: "tenant-a", userId: "user-a" });
        response.statusCode = 204;
        response.end();
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/students?email=veli@example.test`, {
      headers: {
        "x-request-id": "req-test-1",
        authorization: "Bearer secret",
      },
    });
    expect(response.headers.get("x-request-id")).toBe("req-test-1");
    await waitFor(() => lines.length > 0);

    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "info",
      msg: "http_request_completed",
      requestId: "req-test-1",
      tenantId: "tenant-a",
      userId: "user-a",
      httpRequest: {
        id: "req-test-1",
        method: "GET",
        path: "/students",
      },
      httpResponse: {
        statusCode: 204,
      },
    });
    expect(entry.durationMs).toEqual(expect.any(Number));
    expect(JSON.stringify(entry)).not.toContain("veli@example.test");
    expect(JSON.stringify(entry)).not.toContain("Bearer secret");
  });

  it("bridges Nest logs through pino with context and string redaction", () => {
    const lines: string[] = [];
    const logger = pino(
      createPinoLoggerOptions("api", { NODE_ENV: "production", LOG_LEVEL: "info" }),
      collectLines(lines),
    );
    const nestLogger = new PinoNestLogger(logger);

    nestLogger.warn("login failed for admin@example.test", "AuthService");

    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "warn",
      context: "AuthService",
      msg: "login failed for [FilteredEmail]",
    });
  });
});

function collectLines(lines: string[]): DestinationStream {
  return {
    write: (line: string) => {
      lines.push(line);
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("WAIT_TIMEOUT");
}
