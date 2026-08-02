import type { INestApplication } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { configureApiApp, getAllowedCorsOrigins } from "./configure-api-app.js";

describe("getAllowedCorsOrigins", () => {
  it("falls back to the local web origin when no env is configured", () => {
    expect(getAllowedCorsOrigins({})).toBe("http://localhost:3000");
  });

  it("keeps WEB_URL as the single allowed origin by default", () => {
    expect(getAllowedCorsOrigins({ WEB_URL: "https://212.108.107.190" })).toBe("https://212.108.107.190");
  });

  it("allows additional exact origins from CORS_ORIGINS", () => {
    expect(getAllowedCorsOrigins({
      WEB_URL: "https://212.108.107.190",
      CORS_ORIGINS: "http://212.108.107.190:3001, https://pilot.o-okul.com ",
    })).toEqual([
      "https://212.108.107.190",
      "http://212.108.107.190:3001",
      "https://pilot.o-okul.com",
    ]);
  });

  it("deduplicates repeated origins", () => {
    expect(getAllowedCorsOrigins({
      WEB_URL: "https://212.108.107.190",
      CORS_ORIGINS: "https://212.108.107.190,http://212.108.107.190:3001",
    })).toEqual([
      "https://212.108.107.190",
      "http://212.108.107.190:3001",
    ]);
  });

  it("Express'e yalnız allowlist'teki proxy'leri tanıtır", () => {
    const express = { disable: vi.fn(), set: vi.fn() };
    const app = {
      enableCors: vi.fn(),
      getHttpAdapter: () => ({ getInstance: () => express }),
      setGlobalPrefix: vi.fn(),
      use: vi.fn(),
      useGlobalInterceptors: vi.fn(),
    } as unknown as INestApplication;

    configureApiApp(app, { TRUSTED_PROXY_CIDRS: "172.30.0.2/32" });

    const predicate = express.set.mock.calls.find(([setting]) => setting === "trust proxy")?.[1] as (address: string) => boolean;
    expect(predicate("172.30.0.2")).toBe(true);
    expect(predicate("172.30.0.3")).toBe(false);
  });

  it("trust proxy ayarı yapılamıyorsa uygulamayı başlatmaz", () => {
    const app = {
      getHttpAdapter: () => ({ getInstance: () => ({ disable: vi.fn() }) }),
    } as unknown as INestApplication;

    expect(() => configureApiApp(app, { TRUSTED_PROXY_CIDRS: "172.30.0.2/32" })).toThrow(
      "EXPRESS_TRUST_PROXY_UNAVAILABLE",
    );
  });
});
