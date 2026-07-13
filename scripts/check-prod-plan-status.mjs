import { existsSync, readFileSync } from "node:fs";

const sources = {
  status: "status.md",
  decisions: "docs/DECISIONS.md",
  journeys: "docs/product-journeys-v1.md",
  readiness: "docs/phase-6-production-readiness.md",
  runbook: "docs/phase-6-ops-runbook.md",
  wiki: "docs/llm-wiki/README.md",
};

const failures = [];
const files = Object.fromEntries(
  Object.entries(sources).map(([name, path]) => [name, readFileSync(path, "utf8")]),
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

const requiredTokens = {
  status: ["# O-Okul Durum", "## Doğruluk Hiyerarşisi", "## Açık İşler", "## Doğrulama"],
  decisions: ["# Karar", "DEC-"],
  journeys: ["# V1 Urun Yolculuklari", "UAT", "DEC-"],
  readiness: ["pnpm prod:readiness:check", "pnpm prod:evidence:templates:check", "pnpm run ci"],
  runbook: ["pnpm prod:evidence:check", "pnpm go-live:check"],
  wiki: ["# O-Okul LLM Wiki", "status.md", "docs/DECISIONS.md"],
};

for (const [name, tokens] of Object.entries(requiredTokens)) {
  for (const token of tokens) {
    if (!files[name].includes(token)) {
      failures.push(`${sources[name]} eksik zorunlu ifade: ${token}`);
    }
  }
}

const requiredScripts = [
  "prod:plan:check",
  "prod:readiness:check",
  "prod:evidence:templates:check",
  "product-journeys:check",
  "ops:check",
  "ci",
];

for (const script of requiredScripts) {
  if (!packageJson.scripts?.[script]) {
    failures.push(`package.json eksik script: ${script}`);
  }
}

const retiredDocs = [
  "PLAN.md",
  "docs/MASTER_PLAN.md",
  "docs/development-plan-2026-06-02.md",
  "docs/architecture-improvement-plan-2026-06-21.md",
  "docs/production-v1-modernization-plan-2026-06-27.md",
  "docs/ui-ux-redesign-plan.md",
  "claudedocs/prod-plan-2026-06-12.md",
];

for (const path of retiredDocs) {
  if (existsSync(path)) {
    failures.push(`Eski plan hâlâ mevcut: ${path}`);
  }
}

if (failures.length > 0) {
  console.error("Production plan/durum kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Production plan/durum kontrolü geçti: status.md ve aktif sözleşmeler doğrulandı.");
