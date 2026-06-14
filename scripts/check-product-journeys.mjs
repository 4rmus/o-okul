import { readFileSync } from "node:fs";

const files = {
  journeys: readFileSync("docs/product-journeys-v1.md", "utf8"),
  uatChecker: readFileSync("scripts/check-uat-evidence.mjs", "utf8"),
  uatTemplate: JSON.parse(readFileSync("docs/evidence-templates/uat.example.json", "utf8")),
  uatPage: readFileSync("apps/web/app/(app)/kurum/uat-rollback/uat-rollback-page.tsx", "utf8"),
};

const failures = [];
const journeyMatrix = parseJourneyMatrix(files.journeys);
const journeySkeletonIds = parseJourneySkeletonIds(files.journeys);
const checkerScenarios = parseCheckerScenarios(files.uatChecker);
const templateScenarios = parseTemplateScenarios(files.uatTemplate);
const uatPageIds = extractScenarioIds(files.uatPage);

compareSets("Yolculuk matrisi", journeyMatrix.ids, "UAT senaryo iskeleti", journeySkeletonIds, failures);
compareSets("Yolculuk matrisi", journeyMatrix.ids, "UAT checker", new Set(checkerScenarios.keys()), failures);
compareSets("Yolculuk matrisi", journeyMatrix.ids, "UAT template", new Set(templateScenarios.keys()), failures);
compareSets("Yolculuk matrisi", journeyMatrix.ids, "UAT rollback ekranı", uatPageIds, failures);

for (const [id, persona] of checkerScenarios) {
  const acceptedPersonas = journeyMatrix.personasById.get(id);
  if (!acceptedPersonas) continue;
  if (!acceptedPersonas.has(persona)) {
    failures.push(`${id} checker persona uyumsuz: ${persona}; beklenenlerden biri: ${[...acceptedPersonas].join(", ")}`);
  }
}

for (const [id, scenario] of templateScenarios) {
  const checkerPersona = checkerScenarios.get(id);
  if (!checkerPersona) continue;
  if (scenario.persona !== checkerPersona) {
    failures.push(`${id} template persona uyumsuz: ${scenario.persona}; checker: ${checkerPersona}`);
  }
  if (scenario.status !== "PASS") {
    failures.push(`${id} template status PASS olmalı.`);
  }
  if (!Array.isArray(scenario.evidence) || scenario.evidence.length === 0) {
    failures.push(`${id} template evidence boş olmayan liste olmalı.`);
  }
}

if (failures.length > 0) {
  console.error("Product journeys kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Product journeys kontrolü geçti: ${journeyMatrix.ids.size} UAT senaryosu doğrulandı.`);

function parseJourneyMatrix(markdown) {
  const ids = new Set();
  const personasById = new Map();

  for (const row of tableRows(markdown)) {
    if (row.length !== 6) continue;
    const [personaCell, , , , scenarioCell] = row;
    if (!personaCell || personaCell === "Persona" || personaCell.startsWith("---")) continue;
    const scenarioId = firstScenarioId(scenarioCell);
    if (!scenarioId) continue;

    ids.add(scenarioId);
    const personas = personasById.get(scenarioId) ?? new Set();
    for (const persona of personaCell.split("/").map((value) => value.trim()).filter(Boolean)) {
      personas.add(persona);
    }
    personasById.set(scenarioId, personas);
  }

  return { ids, personasById };
}

function parseJourneySkeletonIds(markdown) {
  const ids = new Set();
  for (const row of tableRows(markdown)) {
    const id = firstScenarioId(row[0] ?? "");
    if (id) ids.add(id);
  }
  return ids;
}

function parseCheckerScenarios(source) {
  const scenarios = new Map();
  const regex = /\["(UAT-[A-Z]+-\d{2})",\s*"([A-Z_]+)"\]/g;
  for (const match of source.matchAll(regex)) {
    scenarios.set(match[1], match[2]);
  }
  return scenarios;
}

function parseTemplateScenarios(template) {
  const scenarios = new Map();
  if (!Array.isArray(template.journeyScenariosVerified)) return scenarios;
  for (const scenario of template.journeyScenariosVerified) {
    if (!scenario || typeof scenario !== "object" || typeof scenario.id !== "string") continue;
    scenarios.set(scenario.id, scenario);
  }
  return scenarios;
}

function extractScenarioIds(source) {
  return new Set([...source.matchAll(/UAT-[A-Z]+-\d{2}/g)].map((match) => match[0]));
}

function tableRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
}

function firstScenarioId(value) {
  return value.match(/UAT-[A-Z]+-\d{2}/)?.[0];
}

function compareSets(leftLabel, left, rightLabel, right, output) {
  for (const id of left) {
    if (!right.has(id)) output.push(`${rightLabel} eksik: ${id}`);
  }
  for (const id of right) {
    if (!left.has(id)) output.push(`${rightLabel} fazladan senaryo içeriyor: ${id} (${leftLabel} içinde yok)`);
  }
}
