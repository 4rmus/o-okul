import { readFileSync } from "node:fs";

const files = {
  "apps/web/e2e-next/a11y-next.spec.ts": readFileSync("apps/web/e2e-next/a11y-next.spec.ts", "utf8"),
  "apps/web/package.json": readFileSync("apps/web/package.json", "utf8"),
  "apps/web/app/page.tsx": readFileSync("apps/web/app/page.tsx", "utf8"),
  "claudedocs/prod-plan-2026-06-12.md": readFileSync("claudedocs/prod-plan-2026-06-12.md", "utf8"),
  "docs/phase-6-production-readiness.md": readFileSync("docs/phase-6-production-readiness.md", "utf8"),
  "docs/product-journeys-v1.md": readFileSync("docs/product-journeys-v1.md", "utf8"),
  "package.json": readFileSync("package.json", "utf8"),
  "apps/web/playwright.next.config.ts": readFileSync("apps/web/playwright.next.config.ts", "utf8"),
  "scripts/profile-web-performance.mjs": readFileSync("scripts/profile-web-performance.mjs", "utf8"),
};

const packageJson = JSON.parse(files["package.json"]);
const webPackageJson = JSON.parse(files["apps/web/package.json"]);
const failures = [];

requireScript("web:ux-baseline:check", "node scripts/check-web-ux-baseline.mjs");
requireScriptIncludes("ci", "pnpm web:performance:check");
requireScriptIncludes("ci", "pnpm web:a11y:check");
requireScriptIncludes("ci", "pnpm web:ux-baseline:check");

if (webPackageJson.scripts?.a11y !== "playwright test -c playwright.next.config.ts e2e-next/a11y-next.spec.ts") {
  failures.push("apps/web/package.json a11y script must run e2e-next/a11y-next.spec.ts.");
}

requireTokens("apps/web/e2e-next/a11y-next.spec.ts", [
  "AxeBuilder",
  'withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])',
  'violation.impact === "critical"',
  'await page.goto("/")',
  'await page.goto("/login")',
  "openInstitutionDashboard(page)",
  'getByRole("navigation", { name: "Ana men',
  "setViewportSize({ height: 1024, width: 768 })",
  "expectNoHorizontalOverflow",
  "scrollWidth -",
  "clientWidth",
]);

requireTokens("scripts/profile-web-performance.mjs", [
  "WEB_PERFORMANCE_BUDGET",
  "landingHeroFallbackPng",
  "landingHeroWebp",
  "2_000_000",
  "250_000",
  "Landing route server component",
  "Landing route useQuery",
  "landing-hero-education-ops.webp",
  "fetchPriority",
  "loading",
]);

requireTokens("apps/web/app/page.tsx", [
  "landing-hero-education-ops.webp",
  "landing-hero-education-ops.png",
  "<picture>",
  "fetchPriority=\"high\"",
  "loading=\"eager\"",
  "width={1440}",
  "height={810}",
]);

requireTokens("apps/web/playwright.next.config.ts", [
  "pnpm --filter @uzman-hocam/ui build && pnpm --filter @uzman-hocam/web next:dev",
]);

requireTokens("docs/phase-6-production-readiness.md", [
  "pnpm web:ux-baseline:check",
  "Web UX ve A11y",
  "Landing, login, auth sonrası kurum dashboard shell'i",
  "768x1024",
  "Kritik WCAG 2 A/AA axe ihlali 0",
  "Web UX baseline",
]);

requireTokens("docs/product-journeys-v1.md", [
  "pnpm web:ux-baseline:check",
  "tablet/a11y",
  "kritik axe ihlallerini",
  "server/no-query",
]);

requireTokens("claudedocs/prod-plan-2026-06-12.md", [
  "Web UX baseline contract",
  "pnpm web:ux-baseline:check",
  "LOCAL_BASELINE_PASS_WITH_FUTURE_UI_PENDING",
  "tam liste sanallaştırma/dark mode kapsamı sonraki faz",
]);

if (failures.length > 0) {
  console.error("Web UX baseline contract check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Web UX baseline contract check passed.");

function requireScript(name, expected) {
  if (packageJson.scripts?.[name] !== expected) {
    failures.push(`package.json ${name} must be: ${expected}`);
  }
}

function requireScriptIncludes(name, expected) {
  const value = packageJson.scripts?.[name];
  if (typeof value !== "string" || !value.includes(expected)) {
    failures.push(`package.json ${name} script must include: ${expected}`);
  }
}

function requireTokens(path, tokens) {
  const source = files[path];
  for (const token of tokens) {
    if (!source.includes(token)) {
      failures.push(`${path} missing expected token: ${token}`);
    }
  }
}
