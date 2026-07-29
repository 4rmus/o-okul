import { readFileSync } from "node:fs";

const files = {
  button: read("packages/ui/src/components/button.tsx"),
  charts: read("packages/ui/src/components/charts.tsx"),
  design: read("design.md"),
  globals: read("apps/web/app/globals.css"),
  layout: read("apps/web/app/layout.tsx"),
  tokens: read("tokens.css"),
};
const failures = [];

requireTokens("design.md", files.design, [
  "# Design — O-Okul",
  "## Genre",
  "## Macrostructure family",
  "## Theme — Grafit + Mercan",
  "## Typography",
  "## Motion",
  "## CTA voice",
  "## Route-family rules",
  "## Exports",
  "### tokens.css",
  "### Tailwind v4 `@theme`",
  "### DTCG `tokens.json`",
  "### shadcn/ui CSS variables",
]);

requireTokens("tokens.css", files.tokens, [
  "Hallmark · pre-emit critique:",
  "--color-paper: oklch(95.5% 0.012 70);",
  "--color-paper-raised: oklch(99% 0.004 70);",
  "--color-ink: oklch(21% 0.018 260);",
  "--color-ink-muted: oklch(43% 0.02 260);",
  "--color-rule: oklch(84% 0.015 70);",
  "--color-accent: oklch(56% 0.17 35);",
  "--color-accent-hover: oklch(50% 0.17 35);",
  "--color-accent-soft: oklch(94% 0.035 35);",
  "--color-focus: oklch(56% 0.17 35);",
  "--font-display: var(--font-space-grotesk)",
  "--font-body: var(--font-ibm-plex-sans)",
  "--space-3xs: 0.25rem;",
  "--space-2xl: 4rem;",
  "--text-base: 1rem;",
  "--text-display: clamp(2.25rem, 4vw, 3rem);",
  "--radius-control: 6px;",
  "--radius-panel: 10px;",
  "--radius-dialog: 14px;",
  "--dur-instant: 120ms;",
  "--dur-short: 220ms;",
  "--dur-long: 420ms;",
  "--ease-out: cubic-bezier(0.16, 1, 0.3, 1);",
  "--chart-primary:",
  "--chart-accent:",
  "--chart-success:",
  "--chart-danger:",
  "--chart-neutral:",
  "--chart-grid:",
  "--chart-text:",
  "--chart-surface:",
]);

forbidRegex("tokens.css", files.tokens, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi, "OKLCH dışı renk");
forbidRegex("tokens.css", files.tokens, /oklch\((?:0|100)%\s+0(?:\s|%)/gi, "saf siyah/beyaz uç değer");

requireTokens("apps/web/app/layout.tsx", files.layout, [
  'import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";',
  'variable: "--font-ibm-plex-sans"',
  'variable: "--font-space-grotesk"',
  'subsets: ["latin", "latin-ext"]',
  "bodyFont.variable",
  "displayFont.variable",
]);

if (!files.globals.startsWith('@import "../../../tokens.css";')) {
  failures.push("apps/web/app/globals.css tokens.css importu ilk satırda olmalı.");
}

const hallmarkLayer = readHallmarkLayer(files.globals);
if (!hallmarkLayer.startsWith("/* Hallmark redesign layer · BEGIN */\n@media screen {")) {
  failures.push("apps/web/app/globals.css Hallmark katmanı yalnız @media screen içinde başlamalı.");
}
if (!hallmarkLayer.endsWith("}\n/* Hallmark redesign layer · END */")) {
  failures.push("apps/web/app/globals.css Hallmark katmanı @media screen kapanışından sonra bitmeli.");
}
forbidRegex("apps/web/app/globals.css Hallmark katmanı", hallmarkLayer, /@media\s+print\b/gi, "print kuralı");
const legacyRawColorCeiling = 268;
const legacyGlobals = files.globals.replace(hallmarkLayer, "");
const legacyRawColors = legacyGlobals.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\([^)]*\)/gi) ?? [];
if (legacyRawColors.length > legacyRawColorCeiling) {
  failures.push(
    `apps/web/app/globals.css eski katman ham renk sayısı ${legacyRawColorCeiling} tavanını aşamaz: ${legacyRawColors.length}`,
  );
}
requireTokens("apps/web/app/globals.css Hallmark katmanı", hallmarkLayer, [
  "--color-text: var(--color-ink);",
  "--color-primary: var(--color-accent);",
  "--color-primary-strong: var(--color-accent-hover);",
  "--color-focus-ring: var(--color-focus);",
  "font-family: var(--font-body);",
  "font-family: var(--font-display);",
  "@media (prefers-reduced-motion: reduce)",
]);
forbidRegex(
  "apps/web/app/globals.css Hallmark katmanı",
  hallmarkLayer,
  /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi,
  "ham renk",
);
forbidRegex(
  "apps/web/app/globals.css Hallmark katmanı",
  hallmarkLayer,
  /(?:transition|animation)(?:-timing-function)?:\s*[^;]*\bease(?:\s|;|,)/gi,
  "varsayılan ease",
);

requireTokens("packages/ui/src/components/button.tsx", files.button, [
  "loading?: boolean;",
  "loadingLabel?: string;",
  'aria-busy={loading || undefined}',
  'aria-label={loading ? loadingLabel : props["aria-label"]}',
  'data-state={loading ? "loading" : undefined}',
  "disabled={disabled || loading}",
  'role="status"',
]);

requireTokens("packages/ui/src/components/charts.tsx", files.charts, [
  'chartToken("--chart-primary")',
  'chartToken("--chart-accent")',
  'chartToken("--chart-success")',
  'chartToken("--chart-danger")',
  'chartToken("--chart-neutral")',
  'chartToken("--chart-grid")',
  "getImageData(0, 0, 1, 1)",
  'padStart(2, "0")',
  "animation: false",
]);
forbidRegex("packages/ui/src/components/charts.tsx", files.charts, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi, "ham renk");

validateCustomPropertyGraph(`${files.tokens}\n${files.globals}`);

if (failures.length > 0) {
  console.error("Web design token kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Web design token kontrolü geçti.");

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`Web design token kontrolü başarısız:\n- ${path} okunamadı.`);
    process.exit(1);
  }
}

function requireTokens(path, source, tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(`${path} beklenen sözleşmeyi içermiyor: ${token}`);
  }
}

function forbidRegex(path, source, regex, label) {
  const matches = source.match(regex) ?? [];
  if (matches.length > 0) {
    failures.push(`${path} ${label} içeremez: ${[...new Set(matches)].slice(0, 5).join(", ")}`);
  }
}

function readHallmarkLayer(source) {
  const begin = "/* Hallmark redesign layer · BEGIN */";
  const end = "/* Hallmark redesign layer · END */";
  const startIndex = source.indexOf(begin);
  const endIndex = source.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) {
    failures.push("apps/web/app/globals.css Hallmark BEGIN/END markerlarını içermeli.");
    return "";
  }
  return source.slice(startIndex, endIndex + end.length);
}

function validateCustomPropertyGraph(source) {
  const definitions = new Set([...source.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const references = new Set([...source.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));
  const runtimeFontVariables = new Set(["--font-ibm-plex-sans", "--font-space-grotesk"]);
  const missing = [...references].filter((name) => !definitions.has(name) && !runtimeFontVariables.has(name)).sort();
  if (missing.length > 0) failures.push(`Tanımsız CSS custom property referansları: ${missing.join(", ")}`);
}
