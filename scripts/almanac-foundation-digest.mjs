import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const almanacFoundationSourceRoots = [
  "apps/web/app",
  "apps/web/features",
  "apps/web/src",
  "apps/web/public",
  "apps/web/e2e-next/helpers",
  "packages/shared-types/src",
  "packages/ui/src",
];
export const almanacFoundationRequiredFiles = [
  "apps/web/e2e-next/route-architecture-manifest.js",
  "apps/web/e2e-next/route-architecture-manifest.d.ts",
  "apps/web/e2e-next/ui-route-family-smoke-next.spec.ts",
  "apps/web/instrumentation-client.ts",
  "apps/web/instrumentation.ts",
  "apps/web/next.config.mjs",
  "apps/web/package.json",
  "apps/web/playwright.next.config.ts",
  "apps/web/proxy.ts",
  "apps/web/sentry.edge.config.ts",
  "apps/web/sentry.server.config.ts",
  "apps/web/tsconfig.json",
  "package.json",
  "packages/config/tsconfig/base.json",
  "packages/shared-types/package.json",
  "packages/shared-types/tsconfig.json",
  "packages/ui/package.json",
  "packages/ui/tsconfig.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/almanac-foundation-digest.mjs",
  "scripts/check-ui-measurement-baseline.mjs",
  "scripts/collect-ui-measurement-baseline.mjs",
  "scripts/prepare-ui-measurement-baseline.mjs",
];
export const almanacFoundationSourceFiles = [
  ...almanacFoundationSourceRoots.flatMap(listFiles),
  ...almanacFoundationRequiredFiles,
].sort();

export function almanacFoundationSourceDigest() {
  assertAlmanacFoundationSourceContract(almanacFoundationSourceFiles, almanacFoundationSourceRoots);
  const hash = createHash("sha256");
  for (const file of almanacFoundationSourceFiles) {
    hash.update(relative(".", file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function almanacFoundationSourceDirty() {
  assertAlmanacFoundationSourceContract(almanacFoundationSourceFiles, almanacFoundationSourceRoots);
  return execFileSync("git", ["status", "--porcelain", "--", ...almanacFoundationSourceRoots, ...almanacFoundationRequiredFiles], {
    encoding: "utf8",
  }).trim().length > 0;
}

export function assertAlmanacFoundationSourceContract(files, roots = almanacFoundationSourceRoots) {
  const fileSet = new Set(files);
  for (const requiredFile of almanacFoundationRequiredFiles) {
    if (!fileSet.has(requiredFile)) throw new Error("ALMANAC_MEASUREMENT_SOURCE_INPUT_MISSING:" + requiredFile);
  }
  const rootSet = new Set(roots);
  for (const requiredRoot of almanacFoundationSourceRoots) {
    if (!rootSet.has(requiredRoot)) throw new Error("ALMANAC_MEASUREMENT_SOURCE_ROOT_MISSING:" + requiredRoot);
  }
}

function listFiles(root) {
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
