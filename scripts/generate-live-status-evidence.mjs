import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const summaryTarget = readOption("--summary-target") ?? process.env.PRODUCTION_EVIDENCE_SUMMARY_TARGET;
const goLiveTarget = readOption("--go-live-target") ?? process.env.GO_LIVE_EVIDENCE_TARGET;
const pilotTarget = readOption("--pilot-target") ?? process.env.PILOT_EVIDENCE_TARGET;
const outputPath = readOption("--output") ?? process.env.LIVE_STATUS_EVIDENCE_OUTPUT;
const readinessPath = readOption("--readiness-path") ?? process.env.LIVE_STATUS_READINESS_PATH;
const requestedGeneratedAt = readOption("--generated-at");
const allowExampleEvidence =
  process.env.LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE === "1" || process.argv.includes("--allow-example-evidence");

const gates = [
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

const failures = [];
requireValue(summaryTarget, "PRODUCTION_EVIDENCE_SUMMARY_TARGET veya --summary-target");
requireValue(goLiveTarget, "GO_LIVE_EVIDENCE_TARGET veya --go-live-target");
requireValue(pilotTarget, "PILOT_EVIDENCE_TARGET veya --pilot-target");
requireValue(outputPath, "LIVE_STATUS_EVIDENCE_OUTPUT veya --output");

if (failures.length > 0) fail(failures);

const outputUrl = pathToFileURL(resolve(outputPath));
const summaryUrl = toTargetUrl(summaryTarget);
const goLiveUrl = toTargetUrl(goLiveTarget);
const pilotUrl = toTargetUrl(pilotTarget);

const summary = await readJsonTarget(summaryUrl, "Production evidence summary");
const goLive = await readJsonTarget(goLiveUrl, "Go-live evidence");
const pilot = await readJsonTarget(pilotUrl, "Pilot evidence");
const generatedAt = resolveGeneratedAt(requestedGeneratedAt, goLive);

requireDate(generatedAt, "generatedAt");
validateSourceReports(summary, goLive, pilot, failures);
if (!allowExampleEvidence) {
  validateGoLiveLiveStatusTarget(goLive, goLiveUrl, outputUrl, failures);
}
validateSourceEvidenceContracts();

const sourceMap = {
  summary: {
    document: summary,
    target: linkTarget(summaryUrl, outputUrl, summaryTarget),
  },
  goLive: {
    document: goLive,
    target: linkTarget(goLiveUrl, outputUrl, goLiveTarget),
  },
  pilot: {
    document: pilot,
    target: linkTarget(pilotUrl, outputUrl, pilotTarget),
  },
};

const evidence = {
  result: "PASS",
  environment: "production",
  generatedAt,
  productionEvidenceSummaryTarget: sourceMap.summary.target,
  goLiveEvidenceTarget: sourceMap.goLive.target,
  pilotEvidenceTarget: sourceMap.pilot.target,
  gates: gates.map((gate) => buildGate(gate, sourceMap, failures)),
};

if (failures.length > 0) fail(failures);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Live status evidence yazıldı: ${outputPath}`);

if (readinessPath) {
  validateGeneratedEvidence(outputPath, readinessPath);
}
validatePostWriteEvidenceContracts();

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function requireValue(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    failures.push(`${label} boş bırakılamaz.`);
  }
}

function resolveGeneratedAt(requestedValue, goLiveReport) {
  if (typeof requestedValue === "string") {
    return requestedValue;
  }

  const goLiveGeneratedAt = goLiveReport?.liveStatusEvidence?.generatedAt;
  if (typeof goLiveGeneratedAt === "string" && goLiveGeneratedAt.trim() !== "") {
    return goLiveGeneratedAt;
  }

  if (typeof goLiveReport?.checkedAt === "string" && goLiveReport.checkedAt.trim() !== "") {
    return goLiveReport.checkedAt;
  }

  return new Date().toISOString();
}

function validateGoLiveLiveStatusTarget(goLiveReport, goLiveReportUrl, expectedOutputUrl, output) {
  const target = goLiveReport?.liveStatusEvidence?.evidenceTarget;
  if (typeof target !== "string" || target.trim() === "") {
    output.push("goLiveEvidence.liveStatusEvidence.evidenceTarget zorunlu.");
    return;
  }

  const resolvedTarget = resolveTargetReference(target, goLiveReportUrl);
  if (!resolvedTarget) {
    output.push("goLiveEvidence.liveStatusEvidence.evidenceTarget file://, http://, https:// veya goreli URL olmalı.");
    return;
  }

  if (resolvedTarget.href !== expectedOutputUrl.href) {
    output.push("goLiveEvidence.liveStatusEvidence.evidenceTarget --output ile aynı live-status artifact'ini göstermeli.");
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

function validateSourceReports(summary, goLive, pilot, output) {
  requireEqual(summary, output, "productionEvidenceSummary.result", "result", "PASS");
  requireEqual(summary, output, "productionEvidenceSummary.nodeEnv", "nodeEnv", "production");
  requireDate(summary?.generatedAt, "productionEvidenceSummary.generatedAt", output);
  requireEqual(goLive, output, "goLiveEvidence.result", "result", "PASS");
  requireEqual(goLive, output, "goLiveEvidence.environment", "environment", "production");
  requireDate(goLive?.checkedAt, "goLiveEvidence.checkedAt", output);
  requireEqual(pilot, output, "pilotEvidence.result", "result", "PASS");
  requireEqual(pilot, output, "pilotEvidence.environment", "environment", "production");
  requireDate(pilot?.checkedAt, "pilotEvidence.checkedAt", output);

  for (const gate of gates) {
    const scope = gate.path.length > 0 ? getPath(sourceMapPreview(gate.target, summary, goLive, pilot), gate.path) : sourceMapPreview(gate.target, summary, goLive, pilot);
    if (!scope || typeof scope !== "object") {
      output.push(`${gate.label} kaynak nesnesi eksik: ${gate.source}`);
      continue;
    }
    requireDate(scope[gate.dateKey], `${gate.source}.${gate.dateKey}`, output);
    if (scope.result && scope.result !== "PASS") {
      output.push(`${gate.source}.result PASS olmalı.`);
    }
    if (scope.environment && scope.environment !== "production") {
      output.push(`${gate.source}.environment production olmalı.`);
    }
  }
}

function sourceMapPreview(target, summary, goLive, pilot) {
  if (target === "summary") return summary;
  if (target === "goLive") return goLive;
  return pilot;
}

function buildGate(gate, sources, output) {
  const source = sources[gate.target];
  const scope = gate.path.length > 0 ? getPath(source.document, gate.path) : source.document;
  const checkedAt = scope?.[gate.dateKey];
  const evidenceReference = findEvidenceReference(scope, source.target, gate.path);

  if (!evidenceReference) {
    output.push(`${gate.label} evidenceReference üretilemedi.`);
  } else if (!allowExampleEvidence && hasPlaceholderToken(evidenceReference)) {
    output.push(`${gate.label} evidenceReference production için placeholder/example/redacted değer içermemeli.`);
  }

  return {
    label: gate.label,
    status: "PASS",
    command: gate.command,
    source: gate.source,
    checkedAt,
    evidenceReference,
  };
}

function findEvidenceReference(scope, target, path) {
  if (!Array.isArray(path) || path.length === 0) {
    return target;
  }
  if (scope && typeof scope.evidenceReference === "string" && scope.evidenceReference.trim() !== "") {
    return scope.evidenceReference;
  }
  if (scope && Array.isArray(scope.evidenceReferences)) {
    const first = scope.evidenceReferences.find((item) => typeof item === "string" && item.trim() !== "");
    if (first) return first;
  }
  return `${target}${jsonPointer(path)}`;
}

function jsonPointer(path) {
  if (!Array.isArray(path) || path.length === 0) return "";
  return `#/${path.map((item) => item.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function getPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function requireEqual(scope, output, label, key, expected) {
  if (scope?.[key] !== expected) {
    output.push(`${label} ${expected} olmalı.`);
  }
}

function requireDate(value, label, output = failures) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    output.push(`${label} geçerli tarih olmalı.`);
  }
}

function toTargetUrl(value) {
  try {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? new URL(value) : pathToFileURL(resolve(value));
  } catch {
    fail([`${value} file://, http:// veya https:// URL olmalı.`]);
  }
}

async function readJsonTarget(url, label) {
  if (url.protocol === "file:") {
    return parseJson(readFileSync(fileURLToPath(url), "utf8"), label);
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`${label} okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text(), label);
  }

  fail([`${label} için yalnız file://, http:// veya https:// desteklenir.`]);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    fail([`${label} geçerli JSON olmalı.`]);
  }
}

function linkTarget(targetUrl, outputUrl, originalValue) {
  if (targetUrl.protocol !== "file:" || outputUrl.protocol !== "file:") {
    return originalValue;
  }

  const fromDir = dirname(fileURLToPath(outputUrl));
  const targetFile = fileURLToPath(targetUrl);
  const relativePath = relative(fromDir, targetFile);
  return relativePath === "" ? "." : relativePath;
}

function validateGeneratedEvidence(output, readiness) {
  const result = spawnSync(process.execPath, ["scripts/check-live-status-evidence.mjs"], {
    env: {
      ...process.env,
      LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE: allowExampleEvidence ? "1" : process.env.LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE,
      LIVE_STATUS_READINESS_PATH: readiness,
      LIVE_STATUS_EVIDENCE_TARGET: pathToFileURL(resolve(output)).href,
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error("Live status evidence üretimi başarısız: üretilen çıktı doğrulanamadı.");
    process.exit(result.status ?? 1);
  }
}

function validateSourceEvidenceContracts() {
  runEvidenceContractCheck("Production evidence summary", "scripts/check-production-evidence-summary.mjs", {
    PRODUCTION_EVIDENCE_SUMMARY_TARGET: summaryUrl.href,
    PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: allowExampleEvidence ? "1" : "0",
  });
  runEvidenceContractCheck("Pilot evidence", "scripts/check-pilot-evidence.mjs", {
    PILOT_EVIDENCE_TARGET: pilotUrl.href,
    PILOT_ALLOW_EXAMPLE_EVIDENCE: allowExampleEvidence ? "1" : "0",
  });
}

function validatePostWriteEvidenceContracts() {
  runEvidenceContractCheck("Go-live evidence", "scripts/check-go-live-evidence.mjs", {
    GO_LIVE_EVIDENCE_TARGET: goLiveUrl.href,
    GO_LIVE_ALLOW_EXAMPLE_EVIDENCE: allowExampleEvidence ? "1" : "0",
  });
}

function runEvidenceContractCheck(label, script, env) {
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const messages = [`${label} sözleşme kontrolü başarısız.`];
    if (output) messages.push(output);
    fail(messages);
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

function fail(messages) {
  console.error("Live status evidence üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
