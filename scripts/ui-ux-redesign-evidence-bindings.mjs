const githubCiKeys = ["repository", "commitSha", "workflowPath", "runId", "runUrl", "completedAt", "conclusion", "successfulJobs"];
const artifactKeys = [
  "reference",
  "mediaType",
  "byteSize",
  "sha256",
  "surface",
  "viewportWidth",
  "imageWidth",
  "imageHeight",
  "piiReview",
];
const requiredWidths = [320, 375, 414, 768, 1024, 1440];
const requiredSurfaces = [
  "kurum dashboard",
  "system dashboard",
  "system tenants",
  "optik workspace",
  "rapor workspace",
  "portal shell",
];

export function validateUiUxRedesignBindings(report, {
  allowExampleEvidence = false,
  expectedGithubCi,
  label = "uiUxRedesign",
  trustedEvidenceHosts = [],
} = {}) {
  const failures = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) return [`${label} nesnesi zorunlu.`];

  validateTrustedHosts(report.allowedEvidenceHosts, trustedEvidenceHosts, failures, label);
  validateGithubCi(report, expectedGithubCi, failures, label);
  const releaseReferences = report.stagingProductionEvidence?.evidenceReferences;
  if (
    !Array.isArray(releaseReferences) ||
    releaseReferences.length !== 4 ||
    releaseReferences[1] !== `run:${report.githubCi?.runUrl}` ||
    releaseReferences[3] !== report.privacy?.reviewReference
  ) {
    failures.push(`${label}.stagingProductionEvidence summary, GitHub run, UAT, privacy review sırasını korumalı.`);
  }
  for (const phase of report.phaseEvidence ?? []) {
    if (phase.evidenceReferences?.some((reference) => reference.startsWith("run:"))) {
      failures.push(`${label}.${phase.phase} okunabilir JSON artifact/url referansı kullanmalı.`);
    }
  }
  const viewportBindings = validateViewportCoverage(report.viewportCoverage, failures, label);
  validateArtifacts(report, viewportBindings, failures, label, allowExampleEvidence);
  return failures;
}

function validateTrustedHosts(value, trustedEvidenceHosts, failures, label) {
  if (!Array.isArray(value) || value.some((host) => typeof host !== "string" || host.trim() !== host)) {
    failures.push(`${label}.allowedEvidenceHosts hostname listesi olmalı.`);
    return;
  }
  const embedded = [...new Set(value.map((host) => host.toLowerCase()))].sort();
  const trusted = [...new Set(trustedEvidenceHosts.map((host) => host.trim().toLowerCase()).filter(Boolean))].sort();
  if (embedded.length !== value.length || JSON.stringify(embedded) !== JSON.stringify(trusted)) {
    failures.push(`${label}.allowedEvidenceHosts güvenilir UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS ile birebir eşleşmeli.`);
  }
}

function validateGithubCi(report, expected, failures, label) {
  const value = report.githubCi;
  if (!hasExactKeys(value, githubCiKeys)) {
    failures.push(`${label}.githubCi exact schema v2 alanlarını içermeli.`);
    return;
  }
  const expectedJobs = Array.isArray(expected?.jobs)
    ? expected.jobs.filter((job) => job?.conclusion === "success").map((job) => job.name).sort()
    : [];
  const actualJobs = Array.isArray(value.successfulJobs) ? [...value.successfulJobs].sort() : [];
  const expectedRunId = String(expected?.workflow?.runId ?? "");
  if (
    value.repository !== expected?.repository ||
    value.commitSha !== report.sourceCommitSha ||
    value.commitSha !== expected?.commitSha ||
    value.workflowPath !== expected?.workflow?.path ||
    value.workflowPath !== ".github/workflows/ci.yml" ||
    value.runId !== expectedRunId ||
    value.runUrl !== expected?.workflow?.runUrl ||
    value.runUrl !== `https://github.com/${value.repository}/actions/runs/${value.runId}` ||
    value.completedAt !== expected?.workflow?.completedAt ||
    value.conclusion !== "success" ||
    value.conclusion !== expected?.workflow?.conclusion ||
    actualJobs.length === 0 ||
    new Set(actualJobs).size !== actualJobs.length ||
    JSON.stringify(actualJobs) !== JSON.stringify(expectedJobs)
  ) {
    failures.push(`${label}.githubCi standalone GitHub CI kanıtıyla exact SHA/run/job bağı kurmalı.`);
  }
  if (!report.stagingProductionEvidence?.evidenceReferences?.includes(`run:${value.runUrl}`)) {
    failures.push(`${label}.stagingProductionEvidence exact githubCi.runUrl referansını içermeli.`);
  }
}

function validateViewportCoverage(value, failures, label) {
  const bindings = new Map();
  if (!Array.isArray(value) || value.length !== requiredSurfaces.length) {
    failures.push(`${label}.viewportCoverage tam ${requiredSurfaces.length} yüzey içermeli.`);
    return bindings;
  }
  const seenSurfaces = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object" || seenSurfaces.has(item.surface) || !requiredSurfaces.includes(item.surface)) {
      failures.push(`${label}.viewportCoverage benzersiz kanonik yüzeylerden oluşmalı.`);
      continue;
    }
    seenSurfaces.add(item.surface);
    if (
      JSON.stringify(item.widths) !== JSON.stringify(requiredWidths) ||
      !Array.isArray(item.evidenceReferences) ||
      item.evidenceReferences.length !== requiredWidths.length
    ) {
      failures.push(`${label}.viewportCoverage.${item.surface} kanonik viewport/reference eşleşmesini korumalı.`);
      continue;
    }
    item.evidenceReferences.forEach((reference, index) => {
      if (typeof reference !== "string" || reference.startsWith("run:") || bindings.has(reference)) {
        failures.push(`${label}.viewportCoverage referansları benzersiz metin olmalı.`);
        return;
      }
      bindings.set(reference, { surface: item.surface, width: item.widths[index] });
    });
  }
  return bindings;
}

function validateArtifacts(report, viewportBindings, failures, label, allowExampleEvidence) {
  if (!Array.isArray(report.artifacts) || report.artifacts.length === 0) {
    failures.push(`${label}.artifacts boş olmayan schema v2 manifesti olmalı.`);
    return;
  }
  const expectedReferences = new Set([
    ...(report.stagingProductionEvidence?.evidenceReferences ?? []),
    ...(report.phaseEvidence ?? []).flatMap((item) => item?.evidenceReferences ?? []),
    ...(report.viewportCoverage ?? []).flatMap((item) => item?.evidenceReferences ?? []),
  ].filter((reference) => typeof reference === "string" && !reference.startsWith("run:")));
  const seen = new Set();
  for (const [index, item] of report.artifacts.entries()) {
    const itemLabel = `${label}.artifacts.${index}`;
    if (!hasExactKeys(item, artifactKeys)) {
      failures.push(`${itemLabel} exact schema v2 alanlarını içermeli.`);
      continue;
    }
    if (
      typeof item.reference !== "string" ||
      seen.has(item.reference) ||
      !expectedReferences.has(item.reference) ||
      !["application/json", "image/png", "text/plain"].includes(item.mediaType) ||
      !Number.isInteger(item.byteSize) ||
      item.byteSize <= 0 ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(item.sha256) ||
      item.piiReview !== "PASS"
    ) {
      failures.push(`${itemLabel} reference/mediaType/byteSize/sha256/piiReview bağı geçersiz.`);
      continue;
    }
    seen.add(item.reference);
    const binding = viewportBindings.get(item.reference);
    if (binding) {
      if (
        item.mediaType !== "image/png" ||
        item.surface !== binding.surface ||
        item.viewportWidth !== binding.width ||
        item.imageWidth !== binding.width ||
        !Number.isInteger(item.imageHeight) ||
        item.imageHeight <= 0
      ) {
        failures.push(`${itemLabel} viewport yüzeyi ve gerçek PNG ölçüsüyle eşleşmeli.`);
      }
    } else if (
      item.surface !== null ||
      item.viewportWidth !== null ||
      (item.mediaType !== "image/png" && (item.imageWidth !== null || item.imageHeight !== null))
    ) {
      failures.push(`${itemLabel} viewport dışı metadata alanları null olmalı.`);
    }
  }
  if (!allowExampleEvidence) {
    for (const reference of expectedReferences) {
      if (!seen.has(reference)) failures.push(`${label}.artifacts manifesti eksik referans içeriyor: ${reference}`);
    }
  }
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}
