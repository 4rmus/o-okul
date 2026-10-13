import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { almanacFoundationSourceDigest, almanacMeasurementBaseCommitSha } from "./almanac-foundation-digest.mjs";

const partsRoot = resolve("artifacts/almanac-foundation/measurement-parts");
const allowedRoot = resolve("artifacts/almanac-foundation");
if (!partsRoot.startsWith(allowedRoot + "/")) {
  throw new Error("ALMANAC_MEASUREMENT_PARTS_PATH_INVALID");
}

rmSync(partsRoot, { force: true, recursive: true });
mkdirSync(partsRoot, { recursive: true });
writeFileSync(partsRoot + "/.run.json", JSON.stringify({
  schemaVersion: 1,
  runId: randomUUID(),
  startedAt: new Date().toISOString(),
  baseCommitSha: almanacMeasurementBaseCommitSha(),
  sourceTreeSha256: almanacFoundationSourceDigest(),
}, null, 2) + "\n");
console.log("Gate B measurement çalışma dizini temizlendi ve run kimliği oluşturuldu.");
