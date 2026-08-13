import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST = Object.freeze(JSON.parse(readFileSync(
  new URL("../docs/evidence-manifests/isem-optical-pipeline-inputs.json", import.meta.url),
  "utf8",
)));
export const ISEM_OPTICAL_PIPELINE_RELEASE_COMMAND = "pnpm isem-optical-pipeline:smoke";
const defaultInputRoot = resolve(
  repositoryRoot,
  ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST.defaultInputRootRelativePath,
);

export const ISEM_OPTICAL_PIPELINE_FIXTURE = Object.freeze({
  answerKeyQuestionCount: 90,
  bookletVariantCount: 1,
  studentCount: 21,
  participantCount: 21,
  matchedCount: 21,
  quarantineCount: 0,
  examResultCount: 21,
  reportResultCount: 21,
});

export function resolveApprovedIsemInputPath(
  inputKey,
  configuredPath,
  { inputRoot = defaultInputRoot, lstat = lstatSync, realpath = realpathSync } = {},
) {
  const input = ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST.inputs?.[inputKey];
  if (!input) throw new Error(`ISEM_OPTICAL_INPUT_MANIFEST_KEY_MISSING:${inputKey}`);
  if (!isAbsolute(inputRoot)) throw new Error("ISEM_OPTICAL_INPUT_ROOT_NOT_ABSOLUTE");
  const approvedRoot = resolve(inputRoot);
  const rootStat = lstat(approvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("ISEM_OPTICAL_INPUT_ROOT_NOT_REGULAR_DIRECTORY");
  }
  if (realpath(approvedRoot) !== approvedRoot) throw new Error("ISEM_OPTICAL_INPUT_ROOT_REALPATH_MISMATCH");
  const approvedPath = resolve(approvedRoot, input.relativePath);
  if (dirname(approvedPath) !== approvedRoot) throw new Error(`ISEM_OPTICAL_INPUT_MANIFEST_PATH_UNSAFE:${inputKey}`);
  const candidatePath = resolve(configuredPath ?? approvedPath);
  if (candidatePath !== approvedPath) throw new Error(`ISEM_OPTICAL_INPUT_PATH_NOT_APPROVED:${inputKey}`);
  const stat = lstat(candidatePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`ISEM_OPTICAL_INPUT_NOT_REGULAR_FILE:${inputKey}`);
  if (realpath(candidatePath) !== candidatePath) throw new Error(`ISEM_OPTICAL_INPUT_REALPATH_MISMATCH:${inputKey}`);
  return candidatePath;
}

export function assertIsemOpticalReleaseInputProvisioning({ environment, inputRoot, wrapperActive }) {
  if (environment !== "staging" && environment !== "production") return;
  if (wrapperActive !== "1") throw new Error("ISEM_OPTICAL_PRIVATE_WRAPPER_REQUIRED");
  if (!inputRoot) throw new Error("ISEM_OPTICAL_INPUT_ROOT_REQUIRED");
}

export function createLiveUiWorkerEvidence({
  examId,
  firstStudentId,
  guardianPortal,
  loginName,
  password,
  studentPortal,
  tenantSlug,
  generatedAt = new Date().toISOString(),
}) {
  return {
    examId,
    firstStudentId,
    generatedAt,
    ...(guardianPortal ? { guardianPortal } : {}),
    loginName,
    password,
    ...(studentPortal ? { studentPortal } : {}),
    tenantSlug,
  };
}
