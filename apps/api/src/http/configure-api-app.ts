import type { INestApplication } from "@nestjs/common";
import { createApiHttpLoggerMiddleware } from "../observability/logging.js";
import { ApiResponseInterceptor } from "./api-response.interceptor.js";
import { createApiRateLimitMiddleware } from "./rate-limit.js";

export const apiPrefix = "api/v1";

export function configureApiApp(app: INestApplication): void {
  app.use(createApiHttpLoggerMiddleware());
  app.use(createApiRateLimitMiddleware());
  app.setGlobalPrefix(apiPrefix, {
    exclude: ["health", "health/ready"],
  });
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.enableCors({
    origin: process.env.WEB_URL ?? "http://localhost:3000",
    credentials: true,
  });
}
