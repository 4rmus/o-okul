import type { INestApplication } from "@nestjs/common";
import { createApiHttpLoggerMiddleware } from "../observability/logging.js";
import { ApiResponseInterceptor } from "./api-response.interceptor.js";
import { createApiRateLimitMiddleware } from "./rate-limit.js";

export const apiPrefix = "api/v1";
const defaultWebUrl = "http://localhost:3000";

export function getAllowedCorsOrigins(env: NodeJS.ProcessEnv = process.env): string | string[] {
  const origins = [
    env.WEB_URL,
    ...(env.CORS_ORIGINS ?? "").split(","),
  ].map((origin) => origin?.trim()).filter((origin): origin is string => Boolean(origin));

  if (origins.length === 0) {
    return defaultWebUrl;
  }

  const uniqueOrigins = [...new Set(origins)];
  return uniqueOrigins.length === 1 ? uniqueOrigins[0]! : uniqueOrigins;
}

export function configureApiApp(app: INestApplication): void {
  app.use(createApiHttpLoggerMiddleware());
  app.use(createApiRateLimitMiddleware());
  app.setGlobalPrefix(apiPrefix, {
    exclude: ["health", "health/ready"],
  });
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.enableCors({
    origin: getAllowedCorsOrigins(),
    credentials: true,
    exposedHeaders: ["content-disposition"],
  });
}
