import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { NestFactory } from "@nestjs/core";

process.env.NODE_ENV ??= "test";
process.env.PERSISTENCE_DRIVER ??= "memory";
process.env.QUEUE_METRICS_ENABLED ??= "false";
process.env.LOGIN_ATTEMPT_LIMITER_STORE ??= "memory";
process.env.LOG_ENABLED ??= "false";
process.env.REPORT_PDF_RENDERER ??= "memory";
process.env.OPENAPI_UI_ENABLED = "false";

const outputPath = process.env.OPENAPI_OUTPUT || "artifacts/openapi.json";

let app;
try {
  const [{ AppModule }, { configureApiApp }, { createOpenApiDocument }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/http/configure-api-app.js"),
    import("../apps/api/dist/openapi.js"),
  ]);

  app = await NestFactory.create(AppModule, { logger: false });
  configureApiApp(app);
  await app.init();

  const document = createOpenApiDocument(app);
  validateOpenApiDocument(document);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);

  console.log(`OpenAPI JSON yazıldı: ${outputPath} (${Object.keys(document.paths).length} path).`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Cannot find module") && message.includes("apps/api/dist")) {
    console.error("OpenAPI üretimi için önce API build çıktısı gerekli: pnpm --filter @uzman-hocam/api build");
  }
  console.error(`OpenAPI üretimi başarısız: ${message}`);
  process.exitCode = 1;
} finally {
  await app?.close();
}

function validateOpenApiDocument(document) {
  const failures = [];
  const pathKeys = Object.keys(document.paths ?? {});
  if (pathKeys.length < 40) {
    failures.push(`OpenAPI path sayısı beklenenden düşük: ${pathKeys.length}`);
  }

  for (const expectedPath of [
    "/api/v1/auth/login",
    "/api/v1/students",
    "/api/v1/exams",
    "/api/v1/payment-plans",
    "/api/v1/metrics",
  ]) {
    if (!document.paths?.[expectedPath]) {
      failures.push(`OpenAPI eksik path: ${expectedPath}`);
    }
  }

  if (document.openapi !== "3.0.0") {
    failures.push(`OpenAPI versiyonu beklenmiyor: ${document.openapi}`);
  }

  if (!document.components?.securitySchemes?.["access-token"]) {
    failures.push("OpenAPI access-token bearer security scheme eksik.");
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}
