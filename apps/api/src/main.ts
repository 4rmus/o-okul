import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { assertPersistenceConfig } from "./config/persistence.js";
import { configureApiApp } from "./http/configure-api-app.js";
import { apiLogger, PinoNestLogger } from "./observability/logging.js";
import { flushApiSentry, initApiSentry } from "./observability/sentry.js";
import { mountOpenApi } from "./openapi.js";

async function bootstrap() {
  initApiSentry();
  assertPersistenceConfig();
  const app = await NestFactory.create(AppModule, {
    logger: new PinoNestLogger(apiLogger),
  });
  configureApiApp(app);
  mountOpenApi(app);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3100);

  process.once("SIGTERM", () => {
    void flushApiSentry();
  });
}

void bootstrap();
