import pino, { type DestinationStream } from "pino";
import { describe, expect, it } from "vitest";
import { runWithJobContext } from "../context/job-context.js";
import {
  createWorkerPinoLoggerOptions,
  logWorkerJobCompleted,
  logWorkerJobFailed,
  redactLogValue,
} from "./logging.js";

describe("worker structured logging", () => {
  it("redacts PII keys and string values", () => {
    expect(redactLogValue({
      email: "veli@example.test",
      profile: {
        lastName: "Yilmaz",
        phone: "0500 123 45 67",
        note: "TC 12345678901",
      },
    })).toEqual({
      email: "[Filtered]",
      profile: {
        lastName: "[Filtered]",
        phone: "[Filtered]",
        note: "TC [FilteredNationalId]",
      },
    });
  });

  it("logs completed jobs with queue and tenant correlation", () => {
    const lines: string[] = [];
    const logger = pino(
      createWorkerPinoLoggerOptions("worker", { NODE_ENV: "production", LOG_LEVEL: "info" }),
      collectLines(lines),
    );

    runWithJobContext(
      { tenantId: "tenant-a", userId: "user-a", jobId: "job-a" },
      () => logWorkerJobCompleted(logger, {
        queueName: "exam-evaluation",
        durationMs: 17,
      }),
    );

    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "info",
      msg: "worker_job_completed",
      status: "completed",
      queueName: "exam-evaluation",
      tenantId: "tenant-a",
      userId: "user-a",
      jobId: "job-a",
      durationMs: 17,
    });
  });

  it("logs failed jobs with sanitized errors", () => {
    const lines: string[] = [];
    const logger = pino(
      createWorkerPinoLoggerOptions("worker", { NODE_ENV: "production", LOG_LEVEL: "info" }),
      collectLines(lines),
    );

    logWorkerJobFailed(logger, {
      queueName: "sms-batch",
      jobId: "job-b",
      tenantId: "tenant-b",
      userId: "user-b",
      durationMs: 5,
    }, new Error("failed for veli@example.test"));

    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "error",
      msg: "worker_job_failed",
      status: "failed",
      queueName: "sms-batch",
      tenantId: "tenant-b",
      userId: "user-b",
      jobId: "job-b",
      durationMs: 5,
    });
    expect(JSON.stringify(entry)).not.toContain("veli@example.test");
  });
});

function collectLines(lines: string[]): DestinationStream {
  return {
    write: (line: string) => {
      lines.push(line);
    },
  };
}
