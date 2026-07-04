import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const failures = [];
const root = resolve("artifacts/openapi-output-contract");

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

try {
  expectOpenApiOutputFailure(
    "/tmp/openapi-output-negative.json",
    "OPENAPI_OUTPUT lokal temp path olmamalı.",
    "OpenAPI output temp path negative",
  );

  const realFile = join(root, "openapi.json");
  const symlinkFile = join(root, "openapi-symlink.json");
  writeFileSync(realFile, "{}\n");
  symlinkSync(realFile, symlinkFile);
  expectOpenApiOutputFailure(
    symlinkFile,
    "OPENAPI_OUTPUT symlink olmayan file artifact olmalı.",
    "OpenAPI output symlink file negative",
  );

  const realDirectory = join(root, "real-parent");
  const symlinkDirectory = join(root, "symlink-parent");
  const realNestedDirectory = join(realDirectory, "nested");
  mkdirSync(realNestedDirectory, { recursive: true });
  symlinkSync(realDirectory, symlinkDirectory, "dir");
  expectOpenApiOutputFailure(
    join(symlinkDirectory, "nested", "openapi.json"),
    "OPENAPI_OUTPUT parent dizini symlink olmayan dizin olmalı.",
    "OpenAPI output symlink parent negative",
  );

  const driftDomain = join(root, "domain-drift.ts");
  writeFileSync(
    driftDomain,
    readFileSync("packages/shared-types/src/domain.ts", "utf8").replace(
      "export interface TenantRecord {\n  id: string;",
      "export interface TenantRecord {\n  id: string;\n  driftRequiredField: string;",
    ),
  );
  expectOpenApiOutputFailure(
    join(root, "openapi-drift.json"),
    "OpenAPI/shared-types drift: TenantRecord.driftRequiredField",
    "OpenAPI shared-types drift negative",
    { OPENAPI_SHARED_TYPES_DOMAIN_PATH: driftDomain },
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("OpenAPI output contract kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("OpenAPI output contract kontrolü geçti.");

function expectOpenApiOutputFailure(target, expectedMessage, label, env = {}) {
  const result = spawnSync(process.execPath, ["scripts/generate-openapi.mjs"], {
    env: {
      ...process.env,
      ...env,
      OPENAPI_OUTPUT: target,
    },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status === 0) {
    failures.push(`${label}: negatif senaryo hata üretmedi.`);
    return;
  }

  if (!output.includes(expectedMessage)) {
    failures.push(`${label}: beklenen hata yok (${expectedMessage}); alınan: ${output.trim()}`);
  }
}
