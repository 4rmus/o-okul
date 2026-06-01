import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { MetricsService } from "./metrics.service.js";

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    response.on("finish", () => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      this.metrics.recordRequest({
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationSeconds,
      });
    });
    next();
  }
}
