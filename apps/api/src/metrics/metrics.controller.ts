import { Controller, Get, Header, Headers, UnauthorizedException } from "@nestjs/common";
import { isMetricsScrapeAuthorized } from "./metrics-scrape-auth.js";
import { MetricsService } from "./metrics.service.js";

@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  getMetrics(@Headers("authorization") authorization?: string): Promise<string> {
    if (!isMetricsScrapeAuthorized(authorization)) throw new UnauthorizedException("METRICS_SCRAPE_TOKEN_REQUIRED");
    return this.metrics.render();
  }
}
