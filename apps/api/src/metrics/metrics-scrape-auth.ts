import { createHash, timingSafeEqual } from "node:crypto";

// DEC-20260930-02: platform metrikleri yalnız Prometheus'a açılır. Token yoksa production fail-closed.
export function isMetricsScrapeAuthorized(authorization: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const token = env.METRICS_SCRAPE_TOKEN?.trim();
  if (!token) return env.NODE_ENV !== "production";
  const match = /^Bearer (\S+)$/.exec(authorization ?? "");
  if (!match) return false;
  return timingSafeEqual(digest(match[1] ?? ""), digest(token));
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}
