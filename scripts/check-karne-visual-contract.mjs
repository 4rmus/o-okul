import { readFileSync } from "node:fs";
import { readCssWithLocalImports } from "./read-css-with-local-imports.mjs";

const files = {
  decisions: readFileSync("docs/DECISIONS.md", "utf8"),
  diffScript: readFileSync("scripts/compare-karne-visual-evidence.mjs", "utf8"),
  globals: readCssWithLocalImports("apps/web/app/globals.css"),
  playwrightConfig: readFileSync("apps/web/playwright.next.config.ts", "utf8"),
  targetScript: readFileSync("scripts/check-adiguzel-pdf-visual-targets.mjs", "utf8"),
  visualSpec: readFileSync("apps/web/e2e-next/ui-visual-qa-next.spec.ts", "utf8"),
  packageJson: JSON.parse(readFileSync("package.json", "utf8")),
};
const visualBaselines = [
  "apps/web/e2e-next/__screenshots__/ui-visual-qa-next.spec.ts/student-report-card-1024-darwin.png",
  "apps/web/e2e-next/__screenshots__/ui-visual-qa-next.spec.ts/student-report-card-1024-linux.png",
];
const expectedSize = { height: 842, width: 595 };

const failures = [];
const decisionTokens = [
  "DEC-20260613-04",
  "V1 karne g\u00f6rsel kabul e\u015fi\u011fi",
  "Durum: Onayl\u0131",
  "pnpm karne:visual-targets",
  "pnpm karne:visual-diff -- --target iSEM --ui <png> --max-diff-ratio 0.53 --max-mean-channel-delta 36",
  "Ger\u00e7ek kurum logosu",
  "\u00fcr\u00fcn sahibi",
];
const diffScriptTokens = [
  "--max-diff-ratio",
  "--max-mean-channel-delta",
  "KARNE_VISUAL_DIFF_TOO_HIGH",
  "KARNE_VISUAL_MEAN_DELTA_TOO_HIGH",
  "meanChannelDelta",
  "expectedSize = { height: 842, width: 595 }",
  "UI_SIZE_CHANGED",
  "meanChannelDelta=${result.meanChannelDelta} ui=provided",
];
const diffScriptForbiddenTokens = [
  '["-z", String(expectedSize.height), String(expectedSize.width)',
  "UI_BMP_FAILED:${options.ui}",
  "result.stderr || result.stdout",
  "BMP_SIGNATURE_INVALID:${path}",
  "ui=${basename(result.uiScreenshot)}",
];
const targetScriptTokens = [
  "d3a54d78fb9850b2c99e0de478d98ee025526c41677632291c302313602dfe0a",
  "e7663415dec99701151b20ac9af2d6861cd1a365f00d921a563d642f89b08494",
  "7fc8740c2453145358806b9310373fbacde0829bae28f8d61952dfa0e89830ac",
  "expectedSize = { height: 842, width: 595 }",
];

requireTokens("docs/DECISIONS.md", files.decisions, decisionTokens, failures);
requireTokens("scripts/compare-karne-visual-evidence.mjs", files.diffScript, diffScriptTokens, failures);
forbidTokens("scripts/compare-karne-visual-evidence.mjs", files.diffScript, diffScriptForbiddenTokens, failures);
requireTokens("scripts/check-adiguzel-pdf-visual-targets.mjs", files.targetScript, targetScriptTokens, failures);
requireTokens("apps/web/playwright.next.config.ts", files.playwrightConfig, [
  'snapshotPathTemplate: `{testDir}/__screenshots__/{testFilePath}/{arg}-${process.platform}{ext}`',
], failures);
requireTokens("apps/web/e2e-next/ui-visual-qa-next.spec.ts", files.visualSpec, [
  'toHaveScreenshot("student-report-card-1024.png"',
  'karneSheet.scrollIntoViewIfNeeded()',
  'expect(karneBox?.width).toBe(595)',
  'expect(karneBox?.height).toBeGreaterThanOrEqual(842)',
  'const karneClip = { height: 842, width: 595',
  'expect(page).toHaveScreenshot("student-report-card-1024.png"',
  'clip: karneClip',
  'maxDiffPixelRatio: 0.005',
  'page.emulateMedia({ media: "print" })',
  'expect(printKarneBox?.width).toBe(595)',
  'expect(printKarneBox?.height).toBeGreaterThanOrEqual(842)',
  'page.emulateMedia({ media: "screen" })',
], failures);
forbidTokens("apps/web/e2e-next/ui-visual-qa-next.spec.ts", files.visualSpec, [
  'locator(".next-desktop-topbar, .next-mobile-topbar").evaluateAll',
  "for (const element of elements) element.remove()",
  'element.style.setProperty("transform"',
  'element.style.removeProperty("transform")',
], failures);
requireTokens("apps/web/app/globals.css", files.globals, [
  ".next-karne-sheet {",
  "scroll-margin-block-start: 4.5rem;",
], failures);
for (const path of visualBaselines) {
  const size = readPngSize(path);
  if (size.width !== expectedSize.width || size.height !== expectedSize.height) {
    failures.push(`${path} must be ${expectedSize.width}x${expectedSize.height}, received ${size.width}x${size.height}.`);
  }
}

const scripts = files.packageJson.scripts ?? {};
const expectedCommand = 'node scripts/check-karne-visual-contract.mjs && UI_VISUAL_ARTIFACT_DIR=artifacts/ui-ux-redesign/local pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts --workers=1 --update-snapshots=none e2e-next/ui-visual-qa-next.spec.ts --grep "rapor çalışma alanı 320/375/414/768/1024/1440 görünümde bağlam ve karne taşmadan kalır"';
if (scripts["karne:visual-contract:check"] !== expectedCommand) {
  failures.push("package.json karne:visual-contract:check must run the contract checker and tracked Playwright comparison.");
}
if (!scripts.ci?.includes("pnpm karne:visual-contract:check")) {
  failures.push("package.json ci script must run karne:visual-contract:check.");
}

if (failures.length > 0) {
  console.error("Karne visual contract check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Karne visual contract wiring check passed.");
console.log("Tracked Playwright comparison follows in the canonical package command.");

function requireTokens(path, source, tokens, output) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      output.push(`${path} missing expected token: ${token}`);
    }
  }
}

function forbidTokens(path, source, tokens, output) {
  for (const token of tokens) {
    if (source.includes(token)) {
      output.push(`${path} contains forbidden sensitive output token: ${token}`);
    }
  }
}

function readPngSize(path) {
  const buffer = readFileSync(path);
  if (buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error(`PNG_SIGNATURE_INVALID:${path}`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
