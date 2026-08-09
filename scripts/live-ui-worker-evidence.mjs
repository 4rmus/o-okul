import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSmokeEvidenceOutputTarget } from "./smoke-evidence.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function writeLiveUiWorkerEvidence(filePath, payload) {
  if (!filePath) return;
  const resolvedPath = resolve(filePath);
  assertPrivateRuntimeInputPath(resolvedPath);
  await validateSmokeEvidenceOutputTarget(resolvedPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await validateSmokeEvidenceOutputTarget(resolvedPath);
  await writeFile(
    resolvedPath,
    `${JSON.stringify({ ...payload, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(resolvedPath, 0o600);
  await validateSmokeEvidenceOutputTarget(resolvedPath);
}

function assertPrivateRuntimeInputPath(filePath) {
  const segments = filePath.split(/[\\/]+/).filter(Boolean);
  if (!segments.includes("private")) {
    throw new Error("ISEM_OPTICAL_PIPELINE_UI_WORKER_EVIDENCE_FILE private runtime input dizini altında olmalı.");
  }
  const repositoryRelativePath = relative(repositoryRoot, filePath);
  if (
    repositoryRelativePath === ""
    || (!repositoryRelativePath.startsWith(`..${sep}`) && repositoryRelativePath !== ".." && !isAbsolute(repositoryRelativePath))
  ) {
    throw new Error("ISEM_OPTICAL_PIPELINE_UI_WORKER_EVIDENCE_FILE repository çalışma ağacının dışında olmalı.");
  }
}
