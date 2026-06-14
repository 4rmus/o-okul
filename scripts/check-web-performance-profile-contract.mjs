import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const failures = [];
const root = resolve("artifacts/web-performance-profile-contract");

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

try {
  expectProfileOutputFailure(
    "/tmp/web-performance-profile-output-negative.json",
    "WEB_PERFORMANCE_PROFILE_OUT lokal temp path olmamalı.",
    "web performance profile output temp path negative",
  );

  const realFile = join(root, "real-profile.json");
  const symlinkFile = join(root, "symlink-profile.json");
  writeFileSync(realFile, "{}\n");
  symlinkSync(realFile, symlinkFile);
  expectProfileOutputFailure(
    symlinkFile,
    "WEB_PERFORMANCE_PROFILE_OUT symlink olmayan file artifact olmalı.",
    "web performance profile output symlink file negative",
  );

  const realDirectory = join(root, "real-parent");
  const symlinkDirectory = join(root, "symlink-parent");
  mkdirSync(realDirectory, { recursive: true });
  symlinkSync(realDirectory, symlinkDirectory, "dir");
  expectProfileOutputFailure(
    join(symlinkDirectory, "profile.json"),
    "WEB_PERFORMANCE_PROFILE_OUT parent dizini symlink olmayan dizin olmalı.",
    "web performance profile output symlink parent negative",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("Web performance profile contract kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Web performance profile contract kontrolü geçti.");

function expectProfileOutputFailure(target, expectedMessage, label) {
  const result = spawnSync(process.execPath, ["scripts/profile-web-performance.mjs"], {
    env: {
      ...process.env,
      WEB_PERFORMANCE_BUDGET: "0",
      WEB_PERFORMANCE_PROFILE_OUT: target,
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
