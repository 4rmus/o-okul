import { ArgumentsHost, BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ApiErrorFilter } from "./api-error.filter.js";
import type { ApiExceptionMetadata } from "../observability/sentry.js";

class TestApiErrorFilter extends ApiErrorFilter {
  readonly reports: Array<{ exception: unknown; metadata: ApiExceptionMetadata }> = [];

  protected override reportException(exception: unknown, metadata: ApiExceptionMetadata): void {
    this.reports.push({ exception, metadata });
  }
}

describe("ApiErrorFilter Sentry reporting", () => {
  it("reports unexpected 5xx exceptions with sanitized metadata", () => {
    const response = createResponse();
    const host = createHost(response, { method: "POST", path: "/api/v1/students" });
    const filter = new TestApiErrorFilter();
    const exception = new Error("DATABASE_DOWN");

    filter.catch(exception, host);

    expect(filter.reports).toEqual([{
      exception,
      metadata: {
        method: "POST",
        path: "/api/v1/students",
        status: 500,
      },
    }]);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Beklenmeyen bir hata oluştu.",
      },
    });
  });

  it("does not report expected 4xx HTTP exceptions", () => {
    const response = createResponse();
    const host = createHost(response, { method: "POST", path: "/api/v1/auth/login" });
    const filter = new TestApiErrorFilter();

    filter.catch(new BadRequestException("BAD_BODY"), host);

    expect(filter.reports).toEqual([]);
    expect(response.status).toHaveBeenCalledWith(400);
  });
});

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

function createHost(response: ReturnType<typeof createResponse>, request: { method: string; path: string }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}
