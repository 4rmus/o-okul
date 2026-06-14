import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const readinessPath = process.env.LIVE_STATUS_READINESS_PATH ?? "docs/phase-6-production-readiness.md";
const evidenceTarget = process.env.LIVE_STATUS_EVIDENCE_TARGET ?? process.argv[2];
const allowExampleEvidence = process.env.LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE === "1";

const liveStatusTopLevelKeys = [
  "result",
  "environment",
  "generatedAt",
  "productionEvidenceSummaryTarget",
  "goLiveEvidenceTarget",
  "pilotEvidenceTarget",
  "gates",
];

const liveStatusGateKeys = ["label", "status", "command", "source", "checkedAt", "evidenceReference"];

const requiredStaticPassRows = new Map([
  ["Repo gate", "PASS"],
  ["Yerel geliştirme canlı smoke", "PASS"],
  ["Kurum canlı yayın kanıt ekranı", "PASS"],
]);

const externalGates = [
  {
    label: "Traefik HTTPS smoke",
    command: "pnpm traefik:https:smoke",
    source: "productionEvidenceSummary.smokeEvidence.traefikHttps",
    target: "summary",
    path: ["smokeEvidence", "traefikHttps"],
    dateKey: "generatedAt",
  },
  {
    label: "TR datacenter/provider kanıtı",
    command: "pnpm deployment:region:check",
    source: "productionEvidenceSummary.reports.deploymentRegion",
    target: "summary",
    path: ["reports", "deploymentRegion"],
    dateKey: "checkedAt",
  },
  {
    label: "Staging/prod UAT",
    command: "pnpm uat:check",
    source: "productionEvidenceSummary.reports.uat",
    target: "summary",
    path: ["reports", "uat"],
    dateKey: "checkedAt",
  },
  {
    label: "Deployment rollback tatbikatı",
    command: "pnpm deployment:rollback:check",
    source: "productionEvidenceSummary.reports.deploymentRollback",
    target: "summary",
    path: ["reports", "deploymentRollback"],
    dateKey: "checkedAt",
  },
  {
    label: "Pilot kapanış kanıtı",
    command: "pnpm pilot:check",
    source: "pilotEvidence",
    target: "pilot",
    path: [],
    dateKey: "checkedAt",
  },
  {
    label: "Go-live karar paketi",
    command: "pnpm go-live:check",
    source: "goLiveEvidence",
    target: "goLive",
    path: [],
    dateKey: "checkedAt",
  },
  {
    label: "Off-host backup hedefi",
    command: "pnpm backup:offsite:smoke",
    source: "productionEvidenceSummary.smokeEvidence.backupOffsite",
    target: "summary",
    path: ["smokeEvidence", "backupOffsite"],
    dateKey: "generatedAt",
  },
  {
    label: "Alert bildirim kanalı",
    command: "pnpm alert:webhook:smoke",
    source: "productionEvidenceSummary.smokeEvidence.alertWebhook",
    target: "summary",
    path: ["smokeEvidence", "alertWebhook"],
    dateKey: "generatedAt",
  },
];

const readiness = await readFile(readinessPath, "utf8");
const statuses = parseLiveStatus(readiness);
const failures = [];

for (const [label, expected] of requiredStaticPassRows) {
  if (statuses.get(label) !== expected) {
    failures.push(`${label} canlı durum satırı ${expected} olmalı.`);
  }
}

for (const gate of externalGates) {
  const status = statuses.get(gate.label);
  if (!status) {
    failures.push(`${gate.label} canlı durum satırı eksik.`);
    continue;
  }
  if (!["NOT_RUN", "PASS"].includes(status)) {
    failures.push(`${gate.label} canlı durum değeri PASS veya NOT_RUN olmalı.`);
  }
  if (status === "PASS" && !evidenceTarget) {
    failures.push(`${gate.label} PASS yapılamaz: LIVE_STATUS_EVIDENCE_TARGET zorunlu.`);
  }
}

if (evidenceTarget) {
  const evidenceUrl = toTargetUrl(evidenceTarget);
  const evidence = await readJsonTarget(evidenceUrl);
  failures.push(...(await validateEvidenceBundle(evidence, statuses, evidenceUrl)));
}

if (failures.length > 0) {
  console.error("Live status evidence kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const passCount = externalGates.filter((gate) => statuses.get(gate.label) === "PASS").length;
console.log(`Live status evidence kontrolü geçti: ${passCount}/${externalGates.length} dış kanıt PASS.`);

function parseLiveStatus(source) {
  const section = source.split(/^## Canlı Durum\s*$/m)[1]?.split(/^## /m)[0];
  if (!section) {
    failNow(["docs/phase-6-production-readiness.md Canlı Durum bölümü eksik."]);
  }

  const statusMap = new Map();
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^- ([^:]+): `([^`]+)`/);
    if (match) {
      statusMap.set(match[1].trim(), match[2].trim());
    }
  }
  return statusMap;
}

async function validateEvidenceBundle(bundle, statuses, bundleUrl) {
  const output = [];

  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    output.push("liveStatusEvidence nesnesi zorunlu.");
    return output;
  }

  requireObjectKeySet(bundle, liveStatusTopLevelKeys, output, "liveStatusEvidence");
  requireEqual(bundle, output, "result", "PASS");
  requireEqual(bundle, output, "environment", "production");
  requireDate(bundle, output, "generatedAt");
  requireDateNotInFuture(bundle, output, "generatedAt");
  requireNonPlaceholderString(bundle, output, "productionEvidenceSummaryTarget");
  requireNonPlaceholderString(bundle, output, "goLiveEvidenceTarget");
  requireNonPlaceholderString(bundle, output, "pilotEvidenceTarget");

  if (!Array.isArray(bundle.gates)) {
    output.push("gates listesi zorunlu.");
    return output;
  }

  requireExpectedGateSet(bundle.gates, output);

  for (const item of bundle.gates) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      output.push("gates satırı nesne olmalı.");
      continue;
    }
    requireObjectKeySet(item, liveStatusGateKeys, output, `gates.${typeof item.label === "string" ? item.label : "unknown"}`);
  }

  for (const gate of externalGates) {
    const docStatus = statuses.get(gate.label);
    const item = bundle.gates.find((candidate) => candidate?.label === gate.label);
    if (!item) {
      output.push(`gates eksik: ${gate.label}`);
      continue;
    }
    if (item.status !== docStatus) {
      output.push(`gates.${gate.label}.status Canlı Durum ile eşleşmeli (${docStatus}).`);
    }
    requireObjectEqual(item, output, `gates.${gate.label}.command`, "command", gate.command);
    requireObjectEqual(item, output, `gates.${gate.label}.source`, "source", gate.source);
    requireObjectDate(item, output, `gates.${gate.label}.checkedAt`, "checkedAt");
    requireDateNotInFuture(item, output, `gates.${gate.label}.checkedAt`, "checkedAt");
    requireDateNotAfter(item, output, `gates.${gate.label}.checkedAt`, "checkedAt", bundle, "generatedAt", "generatedAt");
    requireObjectNonPlaceholderString(item, output, `gates.${gate.label}.evidenceReference`, "evidenceReference");
  }

  const sourceBundle = await readSourceBundle(bundle, bundleUrl, output);
  if (sourceBundle) {
    validateGateSourceLinks(bundle, sourceBundle, output);
  }

  requireNoPlaceholderValues(bundle, output, "liveStatusEvidence");
  return output;
}

async function readSourceBundle(bundle, bundleUrl, output) {
  const summary = await readSourceJsonReference(
    bundle.productionEvidenceSummaryTarget,
    bundleUrl,
    output,
    "productionEvidenceSummaryTarget",
  );
  const goLive = await readSourceJsonReference(bundle.goLiveEvidenceTarget, bundleUrl, output, "goLiveEvidenceTarget");
  const pilot = await readSourceJsonReference(bundle.pilotEvidenceTarget, bundleUrl, output, "pilotEvidenceTarget");

  if (!summary || !goLive || !pilot) return undefined;

  return {
    summary: {
      document: summary,
      target: bundle.productionEvidenceSummaryTarget,
    },
    goLive: {
      document: goLive,
      target: bundle.goLiveEvidenceTarget,
    },
    pilot: {
      document: pilot,
      target: bundle.pilotEvidenceTarget,
    },
  };
}

async function readSourceJsonReference(value, baseUrl, output, label) {
  if (typeof value !== "string" || value.trim() === "") return undefined;

  const url = resolveTargetReference(value, baseUrl);
  if (!url) {
    output.push(`${label} file:// veya https:// URL olmalı.`);
    return undefined;
  }
  if (!isAllowedEvidenceTargetUrl(url)) {
    output.push(`${label} file:// veya https:// URL olmalı.`);
    return undefined;
  }

  try {
    let raw;
    if (url.protocol === "file:") {
      raw = await readEvidenceFile(url, label);
    } else if (url.protocol === "https:") {
      const response = await fetch(url);
      if (!response.ok) {
        output.push(`${label} okunamadı: HTTP ${response.status}`);
        return undefined;
      }
      raw = await response.text();
    } else {
      output.push(`${label} yalnız file:// veya https:// destekler.`);
      return undefined;
    }

    return JSON.parse(raw);
  } catch {
    output.push(`${label} okunabilir JSON olmalı.`);
    return undefined;
  }
}

function resolveTargetReference(value, baseUrl) {
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      return new URL(value);
    }

    if (baseUrl.protocol === "file:") {
      return pathToFileURL(resolve(dirname(fileURLToPath(baseUrl)), value));
    }

    return new URL(value, baseUrl);
  } catch {
    return undefined;
  }
}

function validateGateSourceLinks(bundle, sources, output) {
  for (const gate of externalGates) {
    const item = bundle.gates.find((candidate) => candidate?.label === gate.label);
    if (!item) continue;

    const source = sources[gate.target];
    const sourceScope = getPath(source.document, gate.path);
    if (!sourceScope || typeof sourceScope !== "object" || Array.isArray(sourceScope)) {
      output.push(`gates.${gate.label}.source kaynak nesnesi eksik: ${gate.source}`);
      continue;
    }

    const sourceDate = sourceScope[gate.dateKey];
    if (typeof sourceDate === "string" && !Number.isNaN(Date.parse(sourceDate)) && item.checkedAt !== sourceDate) {
      output.push(`gates.${gate.label}.checkedAt ${gate.source}.${gate.dateKey} ile eslesmeli.`);
    }

    const expectedReference = resolveGateEvidenceReference(sourceScope, source.target, gate.path);
    if (!expectedReference) {
      output.push(`gates.${gate.label}.evidenceReference kaynak referansı üretilemedi.`);
    } else if (item.evidenceReference !== expectedReference) {
      output.push(`gates.${gate.label}.evidenceReference ${gate.source} kaynak referansı ile eslesmeli.`);
    }
  }
}

function getPath(value, path) {
  if (!Array.isArray(path) || path.length === 0) return value;
  return path.reduce((current, key) => current?.[key], value);
}

function resolveGateEvidenceReference(sourceScope, sourceTarget, path) {
  if (!Array.isArray(path) || path.length === 0) {
    return sourceTarget;
  }
  if (typeof sourceScope.evidenceReference === "string" && sourceScope.evidenceReference.trim() !== "") {
    return sourceScope.evidenceReference;
  }
  if (Array.isArray(sourceScope.evidenceReferences)) {
    const first = sourceScope.evidenceReferences.find((item) => typeof item === "string" && item.trim() !== "");
    if (first) return first;
  }
  return `${sourceTarget}${jsonPointer(path)}`;
}

function jsonPointer(path) {
  return `#/${path.map((item) => item.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function requireObjectKeySet(value, expectedKeys, output, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    output.push(`${label} nesnesi zorunlu.`);
    return;
  }

  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length) {
    output.push(`${label} tam ${expectedKeys.length} alan içermeli.`);
  }

  const expected = new Set(expectedKeys);
  for (const key of actualKeys) {
    if (!expected.has(key)) {
      output.push(`${label} beklenmeyen alan içeriyor: ${key}`);
    }
  }

  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      output.push(`${label} eksik alan içeriyor: ${key}`);
    }
  }
}

function requireExpectedGateSet(gates, output) {
  const expectedLabels = new Set(externalGates.map((gate) => gate.label));
  const seenLabels = new Set();

  if (gates.length !== externalGates.length) {
    output.push(`gates tam ${externalGates.length} satır içermeli.`);
  }

  for (const gate of gates) {
    const label = gate?.label;
    if (typeof label !== "string" || label.trim() === "") {
      output.push("gates.label boş olmayan string olmalı.");
      continue;
    }
    if (!expectedLabels.has(label)) {
      output.push(`gates beklenmeyen satır içeriyor: ${label}`);
    }
    if (seenLabels.has(label)) {
      output.push(`gates tekrarlı satır içeriyor: ${label}`);
    }
    seenLabels.add(label);
  }
}

function toTargetUrl(value) {
  try {
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? new URL(value) : pathToFileURL(value);
    if (!isAllowedEvidenceTargetUrl(url)) {
      failNow(["LIVE_STATUS_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
    }
    return url;
  } catch {
    failNow(["LIVE_STATUS_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
  }
}

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url, "LIVE_STATUS_EVIDENCE_TARGET"));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      failNow([`Live status evidence okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  failNow(["LIVE_STATUS_EVIDENCE_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url, label) {
  const filePath = fileURLToPath(url);
  await assertParentPathAllowed(dirname(filePath), label);

  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    failNow([`${label} okunabilir file:// artifact olmalı.`]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    failNow([`${label} symlink olmayan file:// artifact olmalı.`]);
  }

  return readFile(filePath, "utf8");
}

async function assertParentPathAllowed(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);

    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      const failure =
        label === "LIVE_STATUS_EVIDENCE_TARGET"
          ? "LIVE_STATUS_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmalı."
          : `${label} parent dizini symlink olmayan dizin olmalı.`;
      failNow([failure]);
    }
  }
}

function isAllowedEvidenceTargetUrl(url) {
  return (
    (url.protocol === "file:" && !isLocalTempEvidenceTargetUrl(url)) ||
    (url.protocol === "https:" && !isPlaceholderEvidenceTargetHost(url.hostname))
  );
}

function isPlaceholderEvidenceTargetHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".test") ||
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized.includes("example") ||
    normalized.includes("__set") ||
    normalized.includes("placeholder")
  );
}

function isLocalTempEvidenceTargetUrl(url) {
  const path = fileURLToPath(url).replace(/\/+$/g, "") || "/";
  return path === "/tmp" || path.startsWith("/tmp/") || path === "/var/tmp" || path.startsWith("/var/tmp/");
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    failNow(["Live status evidence geçerli JSON olmalı."]);
  }
}

function requireEqual(scope, output, key, expected) {
  if (scope?.[key] !== expected) {
    output.push(`${key} ${expected} olmalı.`);
  }
}

function requireObjectEqual(scope, output, label, key, expected) {
  if (scope?.[key] !== expected) {
    output.push(`${label} ${expected} olmalı.`);
  }
}

function requireDate(scope, output, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    output.push(`${key} geçerli tarih olmalı.`);
  }
}

function requireObjectDate(scope, output, label, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    output.push(`${label} geçerli tarih olmalı.`);
  }
}

function requireDateNotInFuture(scope, output, label, key = label) {
  if (allowExampleEvidence) return;

  const value = scope?.[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) return;

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    output.push(`${label} gelecekte olamaz.`);
  }
}

function requireDateNotAfter(scope, output, firstLabel, firstKey, secondScope, secondLabel, secondKey) {
  const first = Date.parse(scope?.[firstKey]);
  const second = Date.parse(secondScope?.[secondKey]);
  if (Number.isNaN(first) || Number.isNaN(second)) return;
  if (first > second) {
    output.push(`${firstLabel} ${secondLabel} tarihinden sonra olamaz.`);
  }
}

function requireNonPlaceholderString(scope, output, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${key} boş olmayan string olmalı.`);
    return;
  }
  if (!allowExampleEvidence && hasPlaceholderToken(value)) {
    output.push(`${key} production için placeholder/example/redacted değer içermemeli.`);
  }
}

function requireObjectNonPlaceholderString(scope, output, label, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş olmayan string olmalı.`);
    return;
  }
  if (!allowExampleEvidence && hasPlaceholderToken(value)) {
    output.push(`${label} production için placeholder/example/redacted değer içermemeli.`);
  }
}

function requireNoPlaceholderValues(value, output, label) {
  if (allowExampleEvidence) return;
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => requireNoPlaceholderValues(item, output, `${label}.${index}`));
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const itemLabel = `${label}.${key}`;
    if (typeof item === "string" && hasPlaceholderToken(item)) {
      output.push(`${itemLabel} production için placeholder/example/redacted değer içermemeli.`);
      continue;
    }
    if (item && typeof item === "object") {
      requireNoPlaceholderValues(item, output, itemLabel);
    }
  }
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("example") ||
    normalized.includes("redacted") ||
    normalized.includes("__set") ||
    normalized.includes("localhost") ||
    normalized.includes(".test")
  );
}

function failNow(output) {
  console.error("Live status evidence kontrolü başarısız:");
  for (const failure of output) console.error(`- ${failure}`);
  process.exit(1);
}
