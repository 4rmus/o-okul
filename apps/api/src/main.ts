import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { assertPersistenceConfig } from "./config/persistence.js";
import { configureApiApp } from "./http/configure-api-app.js";

async function bootstrap() {
  assertPersistenceConfig();
  const app = await NestFactory.create(AppModule);
  configureApiApp(app);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3100);
}

void bootstrap();
