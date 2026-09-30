import { describe, expect, it } from "vitest";
import { isMetricsScrapeAuthorized } from "./metrics-scrape-auth.js";

const token = "t".repeat(48);

describe("isMetricsScrapeAuthorized", () => {
  it("production'da token yapılandırılmamışsa kapalı kalır", () => {
    expect(isMetricsScrapeAuthorized(undefined, { NODE_ENV: "production" })).toBe(false);
    expect(isMetricsScrapeAuthorized(`Bearer ${token}`, { NODE_ENV: "production", METRICS_SCRAPE_TOKEN: " " })).toBe(false);
  });

  it("yerel geliştirmede token yoksa açık kalır", () => {
    expect(isMetricsScrapeAuthorized(undefined, { NODE_ENV: "test" })).toBe(true);
  });

  it("token yapılandırıldığında yalnız eşleşen bearer değerini kabul eder", () => {
    const env = { NODE_ENV: "test", METRICS_SCRAPE_TOKEN: token };
    expect(isMetricsScrapeAuthorized(`Bearer ${token}`, env)).toBe(true);
    expect(isMetricsScrapeAuthorized(undefined, env)).toBe(false);
    expect(isMetricsScrapeAuthorized(`Bearer ${token}x`, env)).toBe(false);
    expect(isMetricsScrapeAuthorized(`Basic ${token}`, env)).toBe(false);
    expect(isMetricsScrapeAuthorized(token, env)).toBe(false);
  });
});
