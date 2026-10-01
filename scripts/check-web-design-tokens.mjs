import { readFileSync, readdirSync } from "node:fs";
import { readCssWithLocalImports } from "./read-css-with-local-imports.mjs";

const files = {
  button: read("packages/ui/src/components/button.tsx"),
  charts: read("packages/ui/src/components/charts.tsx"),
  design: read("design.md"),
  globals: readCssWithLocalImports("apps/web/app/globals.css"),
  layout: read("apps/web/app/layout.tsx"),
  darkTheme: read("apps/web/app/_styles/01-theme-dark.css"),
  log: read(".hallmark/log.json"),
  package: read("package.json"),
  reportRoute: read("apps/web/app/(app)/kurum/raporlar/reports-page.tsx"),
  tokens: read("tokens.css"),
  uiSource: readSourceTree("packages/ui/src"),
};
const failures = [];

requireTokens("design.md", files.design, [
  "# Design — O-Okul",
  "## Genre",
  "## Macrostructure family",
  "## Theme — Berrak",
  "### Koyu tema",
  "## Typography",
  "## Motion",
  "## CTA voice",
  "## Route-family rules",
  "Tüm route envanteri 320 / 375 / 414 / 768 px'te doğrulanır.",
  "Aile\n  temsilcileri ve mevcut geniş ekran sözleşmeleri 1024 / 1440 px'i",
  "## Exports",
  "Slop test: `58 / 58 ✓`.",
  "### tokens.css",
  "### Tailwind v4 `@theme`",
  "### DTCG `tokens.json`",
  "### shadcn/ui CSS variables",
]);

const designTokens = readMarkdownCodeBlock(files.design, "### tokens.css");
if (designTokens.trim() !== files.tokens.trim()) {
  failures.push("design.md ### tokens.css ihracı kökteki tokens.css ile birebir olmalı.");
}
const tailwindExport = readMarkdownCodeBlock(files.design, "### Tailwind v4 `@theme`");
const dtcgExport = readMarkdownCodeBlock(files.design, "### DTCG `tokens.json`", "json");
const shadcnExport = readMarkdownCodeBlock(files.design, "### shadcn/ui CSS variables");
validatePortableExportParity(files.tokens, tailwindExport, dtcgExport, shadcnExport);
requireTokens("design.md Tailwind ihracı", tailwindExport, [
  "--color-paper-muted:",
  "--color-danger-token:",
  "--chart-surface:",
  "--font-mono:",
  "--spacing-3xs:",
  "--spacing-2xl:",
  "--text-display:",
  "--radius-dialog:",
  "--radius-pill:",
  "--duration-long:",
  "--ease-standard:",
]);
requireTokens("design.md DTCG ihracı", dtcgExport, [
  '"paperMuted":',
  '"dangerSoft":',
  '"chart":',
  '"surface":',
  '"mono":',
  '"3xs":',
  '"2xl":',
  '"display":',
  '"dialog":',
  '"pill":',
  '"long":',
  '"standard":',
]);
requireTokens("design.md shadcn ihracı", shadcnExport, [
  "--o-okul-color-paper-muted:",
  "--o-okul-color-danger-soft:",
  "--o-okul-chart-surface:",
  "--o-okul-font-mono:",
  "--o-okul-space-3xs:",
  "--o-okul-space-2xl:",
  "--o-okul-text-display:",
  "--o-okul-radius-dialog:",
  "--o-okul-radius-pill:",
  "--o-okul-duration-long:",
  "--o-okul-ease-standard:",
]);

requireTokens("tokens.css", files.tokens, [
  "Hallmark · macrostructure: Narrative Workflow / Workbench · tone: calm-product · anchor hue: indigo 277",
  "Hallmark · pre-emit critique:",
  "--color-paper: oklch(98.3% 0.003 250);",
  "--color-paper-raised: oklch(99.9% 0.001 250);",
  "--color-paper-muted: oklch(96.5% 0.005 250);",
  "--color-ink: oklch(21% 0.020 265);",
  "--color-ink-muted: oklch(51% 0.030 260);",
  "--color-rule: oklch(91% 0.008 255);",
  "--color-accent: oklch(51% 0.230 277);",
  "--color-accent-hover: oklch(46% 0.215 277);",
  "--color-accent-soft: oklch(96% 0.018 272);",
  "--color-accent-secondary: oklch(60% 0.118 185);",
  "--color-focus: oklch(51% 0.230 277);",
  "--font-display: var(--font-ibm-plex-sans)",
  "--font-body: var(--font-ibm-plex-sans)",
  "--space-3xs: 0.25rem;",
  "--space-2xl: 4rem;",
  "--text-base: 1rem;",
  "--text-display: clamp(2rem, 3.5vw, 2.5rem);",
  "--radius-control: 6px;",
  "--radius-panel: 8px;",
  "--radius-dialog: 12px;",
  "--radius-pill: 999px;",
  "--dur-instant: 100ms;",
  "--dur-short: 180ms;",
  "--dur-long: 320ms;",
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
requireTokens("Hallmark yönü", `${files.design}\n${files.tokens}`, [
  "landing: Narrative Workflow",
  "app: Workbench",
  "theme: Berrak",
]);
forbidRegex(
  "Hallmark damgaları",
  `${files.design}\n${files.tokens}\n${files.globals}`,
  /\bnav:\s*N9\b|\bfooter:\s*Ft2\b|\b(?:contrast|slop|honest|chrome|tokens|responsive|icons|mobile):\s*pass\b/gi,
  "doğrulanmamış pass/nav/footer damgası",
);

forbidRegex("tokens.css", files.tokens, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi, "OKLCH dışı renk");
forbidRegex(
  "packages/ui/src ve rapor route TSX",
  `${files.uiSource}\n${files.reportRoute}`,
  /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi,
  "yeni ham renk",
);
forbidRegex("tokens.css", files.tokens, /oklch\((?:0|100)%\s+0(?:\s|%)/gi, "saf siyah/beyaz uç değer");

requireTokens("apps/web/app/layout.tsx", files.layout, [
  'import { IBM_Plex_Sans } from "next/font/google";',
  'variable: "--font-ibm-plex-sans"',
  'subsets: ["latin", "latin-ext"]',
  "bodyFont.variable",
  'data-theme="light"',
  "suppressHydrationWarning",
  'localStorage.getItem("o-okul-theme")',
  "(prefers-color-scheme: dark)",
  "d.dataset.theme=t",
  "<script dangerouslySetInnerHTML={{ __html: themeScript }} />",
]);
forbidRegex("apps/web/app/layout.tsx", files.layout, /Source_Serif_4|font-source-serif/g, "serif display fontu");
validateBerrakDarkTheme(files.tokens, files.darkTheme);
validateKarnePins(files.tokens, read("apps/web/app/_styles/73-almanac-report.css"));

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
requireTokens("apps/web/app/globals.css Hallmark katmanı", hallmarkLayer, [
  "html,\n  body {\n    overflow-x: clip;",
  "color-scheme: light;",
  ".uh-button {\n    position: relative;\n    min-height: 44px;",
  "white-space: nowrap;",
  ".uh-action-card,\n  .uh-action-card[data-tone] {\n    border: 1px solid var(--color-rule);",
  ".next-karne-sheet h2,",
  "font-family: inherit;",
  "min-width: auto;\n    overflow-wrap: normal;",
  ".next-karne-sheet table {\n    font-variant-numeric: normal;",
  ".next-karne-sheet .uh-metric-card__value {\n    font-variant-numeric: normal;",
  ".next-karne-sheet .next-karne-block {\n    box-shadow: 0 1px 2px var(--karne-block-shadow);",
  ".next-report-status-surface .uh-status-badge {\n    border-radius: var(--radius-pill);",
  "color-scheme: light;",
  "--color-text: var(--karne-app-text);",
  "--color-border-input: var(--karne-outline);",
]);
const legacyGlobals = files.globals.replace(hallmarkLayer, "");
const rawColorPattern = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\([^)]*\)/gi;
const karneRawColorBlock = readMarkedBlock(legacyGlobals, "karne-print");
const receiptRawColorBlock = readMarkedBlock(legacyGlobals, "receipt-print");
const karneRawColors = karneRawColorBlock.match(rawColorPattern) ?? [];
const receiptRawColors = receiptRawColorBlock.match(rawColorPattern) ?? [];
if (karneRawColors.length !== 40) {
  failures.push(`karne-print allowlist tam 40 dondurulmuş ham renk içermeli: ${karneRawColors.length}`);
}
if (receiptRawColors.length !== 4) {
  failures.push(`receipt-print allowlist tam 4 dondurulmuş ham renk içermeli: ${receiptRawColors.length}`);
}
const globalsWithoutFrozenColors = legacyGlobals
  .replace(karneRawColorBlock, "")
  .replace(receiptRawColorBlock, "");
forbidRegex(
  "apps/web/app/globals.css allowlist dışı",
  globalsWithoutFrozenColors,
  rawColorPattern,
  "ham renk",
);
requireTokens("dondurulmuş karne/print istisnaları", legacyGlobals, [
  ".next-karne-sheet {",
  "font-family: Arial, sans-serif;",
  "@media print {",
]);
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

validateHallmarkLog(files.log);

const packageJson = parseJson("package.json", files.package);
if (packageJson?.scripts?.["ui-ux-redesign:visual-qa"]?.includes("--update-snapshots=none") !== true) {
  failures.push("ui-ux-redesign:visual-qa snapshot güncellemeyi --update-snapshots=none ile kapatmalı.");
}
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
  'attributeFilter: ["data-theme"]',
  "observer.disconnect()",
]);
forbidRegex("packages/ui/src/components/charts.tsx", files.charts, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi, "ham renk");

validateCustomPropertyGraph(`${files.tokens}\n${files.globals}`);

// Berrak §7 ratchet: uygulama CSS'indeki ham px sayıları yalnız azalabilir. Sayı düştüğünde baseline
// aynı değişiklikte düşürülür (sessizce geri artmasın diye eşitlik beklenir).
{
  const sample = countRawPx(".a { padding: 8px -4px var(--space-sm); margin-top: 2px; font-size: 12px; border-top-left-radius: 6px; /* gap: 9px; */ }");
  if (JSON.stringify(sample) !== JSON.stringify({ spacing: 2, fontSize: 1, radius: 1 })) failures.push(`countRawPx öz denetimi başarısız: ${JSON.stringify(sample)}`);
}
const rawPxBaseline = { spacing: 469, fontSize: 165, radius: 28 };
const rawPxCounts = countStyleRawPx();
for (const [group, baseline] of Object.entries(rawPxBaseline)) {
  const count = rawPxCounts[group];
  if (count > baseline) {
    failures.push(`Ham px ratchet'i aşıldı (${group}): ${count} > ${baseline}. Değerleri tokens.css token'larına bağlayın.`);
  } else if (count < baseline) {
    failures.push(`Ham px ratchet'i düştü (${group}): ${count} < ${baseline}. rawPxBaseline.${group} değerini ${count} yapın.`);
  }
}

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

function readSourceTree(root) {
  return readdirSync(root, { recursive: true })
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .map((path) => read(`${root}/${path}`))
    .join("\n");
}

function parseJson(path, source) {
  try {
    return JSON.parse(source);
  } catch {
    failures.push(`${path} geçerli JSON olmalı.`);
    return null;
  }
}

function readMarkdownCodeBlock(source, heading, language = "css") {
  const headingIndex = source.indexOf(heading);
  if (headingIndex < 0) {
    failures.push(`design.md beklenen başlığı içermiyor: ${heading}`);
    return "";
  }
  const marker = `\`\`\`${language}\n`;
  const blockStart = source.indexOf(marker, headingIndex);
  const blockEnd = source.indexOf("\n```", blockStart + marker.length);
  if (blockStart < 0 || blockEnd < 0) {
    failures.push(`design.md ${heading} altında CSS kod bloğu içermeli.`);
    return "";
  }
  return source.slice(blockStart + marker.length, blockEnd);
}

function validatePortableExportParity(tokensSource, tailwindSource, dtcgSource, shadcnSource) {
  const canonical = parseCustomProperties(tokensSource);
  const tailwindNames = new Map([...canonical.keys()].map((name) => [name, portableTokenName(name, "tailwind")]));
  const shadcnNames = new Map([...canonical.keys()].map((name) => [name, portableTokenName(name, "shadcn")]));
  comparePropertyMaps(
    "design.md Tailwind ihracı",
    remapProperties(canonical, tailwindNames),
    parseCustomProperties(tailwindSource),
  );

  const shadcnProperties = new Map(
    [...parseCustomProperties(shadcnSource)].filter(([name]) => name.startsWith("--o-okul-")),
  );
  comparePropertyMaps(
    "design.md shadcn --o-okul-* ihracı",
    remapProperties(canonical, shadcnNames),
    shadcnProperties,
  );

  const dtcg = parseJson("design.md DTCG ihracı", dtcgSource);
  if (!dtcg) return;
  const flattenedDtcg = flattenDtcgTokens(dtcg);
  const canonicalNameByDtcgPath = new Map(
    [...canonical.keys()].map((name) => [dtcgTokenPath(name), name]),
  );
  if (flattenedDtcg.size !== canonical.size) {
    failures.push(`design.md DTCG ihracı token sayısı ${canonical.size} olmalı: ${flattenedDtcg.size}`);
  }
  for (const [name, value] of canonical) {
    const path = dtcgTokenPath(name);
    const token = flattenedDtcg.get(path);
    if (!token) {
      failures.push(`design.md DTCG ihracı eksik token: ${path}`);
      continue;
    }
    const actualValue = normalizeDtcgValue(token.$value, canonicalNameByDtcgPath);
    if (actualValue !== normalizeValue(value)) {
      failures.push(`design.md DTCG ihracı değer drift'i: ${path}`);
    }
  }
}

function parseCustomProperties(source) {
  return new Map(
    [...source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
      .map((match) => [match[1], normalizeValue(match[2])]),
  );
}

function remapProperties(properties, names) {
  return new Map([...properties].map(([name, value]) => [
    names.get(name),
    normalizeValue(value.replace(/var\((--[\w-]+)\)/g, (_match, reference) =>
      `var(${names.get(reference) ?? reference})`)),
  ]));
}

function comparePropertyMaps(label, expected, actual) {
  if (actual.size !== expected.size) {
    failures.push(`${label} token sayısı ${expected.size} olmalı: ${actual.size}`);
  }
  for (const [name, value] of expected) {
    if (!actual.has(name)) {
      failures.push(`${label} eksik token: ${name}`);
    } else if (actual.get(name) !== value) {
      failures.push(`${label} değer drift'i: ${name}`);
    }
  }
}

function portableTokenName(name, format) {
  if (format === "tailwind") {
    return name.replace(/^--space-/, "--spacing-").replace(/^--dur-/, "--duration-");
  }
  const body = name
    .slice(2)
    .replace(/^dur-/, "duration-")
    .replace(/^color-(.+)-token$/, "color-$1");
  return `--o-okul-${body}`;
}

function dtcgTokenPath(name) {
  const body = name.slice(2);
  const [group, ...parts] = body.split("-");
  const dtcgGroup = group === "dur" ? "duration" : group === "ease" ? "easing" : group;
  const normalizedParts = group === "color" && parts.at(-1) === "token"
    ? parts.slice(0, -1)
    : parts;
  return `${dtcgGroup}.${kebabToCamel(normalizedParts.join("-"))}`;
}

function kebabToCamel(value) {
  return value.replace(/-([a-z0-9])/g, (_match, character) => character.toUpperCase());
}

function flattenDtcgTokens(value, prefix = "", result = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child) && "$value" in child) {
      result.set(path, child);
    } else if (child && typeof child === "object" && !Array.isArray(child)) {
      flattenDtcgTokens(child, path, result);
    }
  }
  return result;
}

function normalizeDtcgValue(value, canonicalNameByPath) {
  if (Array.isArray(value)) return normalizeValue(`cubic-bezier(${value.join(", ")})`);
  if (typeof value !== "string") return normalizeValue(String(value));
  const alias = value.match(/^\{([^}]+)\}$/);
  return alias
    ? `var(${canonicalNameByPath.get(alias[1]) ?? alias[1]})`
    : normalizeValue(value);
}

function normalizeValue(value) {
  return value.replace(/\s+/g, " ").trim();
}

function validateHallmarkLog(source) {
  const log = parseJson(".hallmark/log.json", source);
  if (!Array.isArray(log) || log.length === 0) {
    failures.push(".hallmark/log.json en az bir kayıt içeren JSON dizisi olmalı.");
    return;
  }
  if (log.length > 20) failures.push(".hallmark/log.json en fazla 20 kayıt içermeli.");
  const expectedKeys = ["brief", "date", "enrichment", "macrostructure", "scope", "theme", "theme_axes"];
  for (const [index, entry] of log.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      failures.push(`.hallmark/log.json ${index + 1}. kaydı nesne olmalı.`);
      continue;
    }
    const actualKeys = Object.keys(entry).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      failures.push(`.hallmark/log.json ${index + 1}. kayıt standart alanları kullanmalı: ${expectedKeys.join(", ")}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      failures.push(`.hallmark/log.json ${index + 1}. kayıt tarihi YYYY-AA-GG biçiminde olmalı.`);
    }
    for (const key of ["brief", "macrostructure", "scope", "theme", "enrichment", "theme_axes"]) {
      if (typeof entry[key] !== "string" || entry[key].trim().length === 0) {
        failures.push(`.hallmark/log.json ${index + 1}. kayıt ${key} alanını doldurmalı.`);
      }
    }
    if (typeof entry.brief !== "string" || entry.brief.trim().length < 20) {
      failures.push(`.hallmark/log.json ${index + 1}. kayıt brief alanı gerçek kapsamı açıklamalı.`);
    }
  }
  const entry = log[0];
  const expectedValues = {
    scope: "app",
    macrostructure: "Narrative Workflow / Workbench / Index-First",
    theme: "Berrak",
    enrichment: "none",
    theme_axes: "light+dark / sans / cool-indigo",
  };
  for (const [key, value] of Object.entries(expectedValues)) {
    if (entry?.[key] !== value) failures.push(`.hallmark/log.json ilk kayıt ${key} değeri ${value} olmalı.`);
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

function readMarkedBlock(source, label) {
  const begin = `/* RAW-COLOR-ALLOWLIST ${label} BEGIN */`;
  const end = `/* RAW-COLOR-ALLOWLIST ${label} END */`;
  const startIndex = source.indexOf(begin);
  const endIndex = source.indexOf(end);
  if (
    startIndex < 0
    || endIndex <= startIndex
    || source.indexOf(begin, startIndex + begin.length) >= 0
    || source.indexOf(end, endIndex + end.length) >= 0
  ) {
    failures.push(`apps/web/app/globals.css ${label} allowlist markerlarını tam bir kez içermeli.`);
    return "";
  }
  return source.slice(startIndex, endIndex + end.length);
}

function validateCustomPropertyGraph(source) {
  const definitions = new Set([...source.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const references = new Set([...source.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));
  const runtimeFontVariables = new Set(["--font-ibm-plex-sans"]);
  const missing = [...references].filter((name) => !definitions.has(name) && !runtimeFontVariables.has(name)).sort();
  if (missing.length > 0) failures.push(`Tanımsız CSS custom property referansları: ${missing.join(", ")}`);
}

function validateBerrakDarkTheme(tokensSource, darkSource) {
  const lightColors = new Map([...parseCustomProperties(tokensSource)].filter(([name]) => name.startsWith("--color-")));
  const darkBlock = darkSource.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)?.[1] ?? "";
  const darkColors = parseCustomProperties(darkBlock);
  if (!darkBlock.includes("color-scheme: dark;")) failures.push("01-theme-dark.css koyu blok color-scheme: dark içermeli.");
  const lightNames = [...lightColors.keys()].sort().join(",");
  if ([...darkColors.keys()].sort().join(",") !== lightNames) {
    failures.push("01-theme-dark.css koyu blok tokens.css ile aynı renk token adlarını tanımlamalı.");
  }
  const resetBegin = darkSource.indexOf("/* BERRAK-LIGHT-RESET BEGIN */");
  const resetEnd = darkSource.indexOf("/* BERRAK-LIGHT-RESET END */");
  if (resetBegin < 0 || resetEnd <= resetBegin) {
    failures.push("01-theme-dark.css BERRAK-LIGHT-RESET markerlarını içermeli.");
    return;
  }
  const reset = darkSource.slice(resetBegin, resetEnd);
  if (!reset.includes("@media print {")) failures.push("BERRAK-LIGHT-RESET @media print bloğu içermeli.");
  const blocks = [...reset.matchAll(/\{([^{}]*)\}/g)].map((match) => parseCustomProperties(match[1]));
  if (blocks.length !== 1) failures.push(`BERRAK-LIGHT-RESET tek print bloğu içermeli: ${blocks.length}`);
  for (const block of blocks) {
    for (const [name, value] of lightColors) {
      if (block.get(name) !== value) failures.push(`BERRAK-LIGHT-RESET tokens.css değerinden sapıyor: ${name}`);
    }
  }
}

// Karne G10'a kadar donmuştur: her primitive renk token'ı karne kapsamında sabitlenmelidir.
function validateKarnePins(tokensSource, reportSource) {
  const begin = reportSource.indexOf("/* KARNE-ALMANAC-PINS BEGIN */");
  const end = reportSource.indexOf("/* KARNE-ALMANAC-PINS END */");
  if (begin < 0 || end <= begin) {
    failures.push("73-almanac-report.css KARNE-ALMANAC-PINS markerlarını içermeli.");
    return;
  }
  const pins = parseCustomProperties(reportSource.slice(begin, end));
  for (const name of parseCustomProperties(tokensSource).keys()) {
    if (name.startsWith("--color-") && !pins.has(name)) failures.push(`KARNE-ALMANAC-PINS eksik token: ${name}`);
  }
}

function countStyleRawPx() {
  const styleDir = "apps/web/app/_styles";
  const paths = readdirSync(styleDir).filter((name) => name.endsWith(".css")).map((name) => `${styleDir}/${name}`);
  const total = { spacing: 0, fontSize: 0, radius: 0 };
  for (const path of [...paths, "apps/web/app/globals.css"]) {
    const counts = countRawPx(read(path));
    for (const group of Object.keys(total)) total[group] += counts[group];
  }
  return total;
}

// Yalnız pozitif px literal'leri sayılır (calc içindekiler dahil); negatif ofsetler sayılmaz.
function countRawPx(css) {
  const groups = {
    spacing: /^(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?$/,
    fontSize: /^font-size$/,
    radius: /^border(?:-[a-z]+)*-radius$/,
  };
  const counts = { spacing: 0, fontSize: 0, radius: 0 };
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
    for (const [group, pattern] of Object.entries(groups)) {
      if (pattern.test(match[1])) counts[group] += (match[2].match(/(?<![\w.-])\d*\.?\d+px\b/g) ?? []).length;
    }
  }
  return counts;
}

