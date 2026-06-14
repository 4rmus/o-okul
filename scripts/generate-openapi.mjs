import { existsSync, lstatSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";

process.env.NODE_ENV ??= "test";
process.env.PERSISTENCE_DRIVER ??= "memory";
process.env.QUEUE_METRICS_ENABLED ??= "false";
process.env.LOGIN_ATTEMPT_LIMITER_STORE ??= "memory";
process.env.LOG_ENABLED ??= "false";
process.env.REPORT_PDF_RENDERER ??= "memory";
process.env.OPENAPI_UI_ENABLED = "false";

const outputTempPathError = "OPENAPI_OUTPUT lokal temp path olmamalı.";
const outputFileSymlinkError = "OPENAPI_OUTPUT symlink olmayan file artifact olmalı.";
const outputParentSymlinkError = "OPENAPI_OUTPUT parent dizini symlink olmayan dizin olmalı.";
const outputPath = validateOutputTarget(process.env.OPENAPI_OUTPUT || "artifacts/openapi.json");

let app;
try {
  const [{ NestFactory }, { AppModule }, { configureApiApp }, { createOpenApiDocument }] = await Promise.all([
    import("@nestjs/core"),
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
  assertParentPathAllowed(dirname(outputPath));
  assertExistingFileArtifact(outputPath);
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  assertExistingFileArtifact(outputPath);

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

function validateOutputTarget(target) {
  const file = resolve(target);
  if (isLocalTempPath(file)) {
    fail(outputTempPathError);
  }

  assertParentPathAllowed(dirname(file));
  assertExistingFileArtifact(file);
  return file;
}

function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(outputParentSymlinkError);
    }
  }
}

function assertExistingFileArtifact(file) {
  if (!existsSync(file)) return;

  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(outputFileSymlinkError);
  }
}

function isLocalTempPath(path) {
  const normalized = path.replace(/\/+$/g, "") || "/";
  return normalized === "/tmp" || normalized.startsWith("/tmp/") || normalized === "/var/tmp" || normalized.startsWith("/var/tmp/");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
