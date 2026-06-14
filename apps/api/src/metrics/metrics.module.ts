import { Module } from "@nestjs/common";
import { MetricsController } from "./metrics.controller.js";
import { MetricsMiddleware } from "./metrics.middleware.js";
import { MetricsService } from "./metrics.service.js";
import { createQueueMetricsCollector, queueMetricsCollectorToken } from "./queue-metrics.js";

@Module({
  controllers: [MetricsController],
  providers: [
    MetricsMiddleware,
    MetricsService,
    {
      provide: queueMetricsCollectorToken,
      useFactory: createQueueMetricsCollector,
    },
  ],
  exports: [MetricsMiddleware, MetricsService],
})
export class MetricsModule {}
