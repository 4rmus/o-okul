import type { INestApplication } from "@nestjs/common";
import { ApiResponseInterceptor } from "./api-response.interceptor.js";

export const apiPrefix = "api/v1";

export function configureApiApp(app: INestApplication): void {
  app.setGlobalPrefix(apiPrefix, {
    exclude: ["health", "health/ready"],
  });
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.enableCors({
    origin: process.env.WEB_URL ?? "http://localhost:3000",
    credentials: true,
  });
}
