import { describe, expect, it } from "vitest";
import { getAllowedCorsOrigins } from "./configure-api-app.js";

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
});
