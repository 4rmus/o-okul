import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST,
  ISEM_OPTICAL_PIPELINE_RELEASE_COMMAND,
  resolveApprovedIsemInputPath,
} from "./isem-optical-pipeline-contract.mjs";

export function runPrivateIsemOpticalPipeline({
  env = process.env,
  inputManifest = ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST,
  resolveInput = resolveApprovedIsemInputPath,
  spawn = spawnSync,
  temporaryRoot = tmpdir(),
  platform = process.platform,
  log = console.log,
} = {}) {
  const encodedInputs = {
    opticalTxt: decodeRequiredBase64(env, "ISEM_OPTICAL_PIPELINE_TXT_BASE64"),
    answerKey: decodeRequiredBase64(env, "ISEM_OPTICAL_PIPELINE_ANSWER_KEY_BASE64"),
  };
  const inputRoot = realpathSync(mkdtempSync(join(temporaryRoot, "o-okul-isem-")));
  chmodSync(inputRoot, 0o700);

  try {
    for (const [inputKey, content] of Object.entries(encodedInputs)) {
      const input = inputManifest.inputs[inputKey];
      const target = resolve(inputRoot, input.relativePath);
      if (dirname(target) !== inputRoot) throw new Error(`ISEM_OPTICAL_INPUT_MANIFEST_PATH_UNSAFE:${inputKey}`);
      writeFileSync(target, content, { flag: "wx", mode: 0o600 });
      const approvedPath = resolveInput(inputKey, target, { inputRoot });
      const actualHash = createHash("sha256").update(readFileSync(approvedPath)).digest("hex");
      if (actualHash !== input.sha256) throw new Error(`ISEM_OPTICAL_INPUT_HASH_MISMATCH:${inputKey}`);
    }

    if (env.ISEM_OPTICAL_PIPELINE_PRIVATE_INPUTS_PREFLIGHT_ONLY === "1") {
      log(`iSEM private input preflight passed: ${inputManifest.fixtureId}`);
      return 0;
    }

    const childEnv = {
      ...env,
      ISEM_OPTICAL_PIPELINE_INPUT_ROOT: inputRoot,
      ISEM_OPTICAL_PIPELINE_PRIVATE_WRAPPER: "1",
      ISEM_OPTICAL_PIPELINE_SMOKE_COMMAND: ISEM_OPTICAL_PIPELINE_RELEASE_COMMAND,
    };
    delete childEnv.ISEM_OPTICAL_PIPELINE_TXT_BASE64;
    delete childEnv.ISEM_OPTICAL_PIPELINE_ANSWER_KEY_BASE64;
    delete childEnv.ISEM_OPTICAL_PIPELINE_PRIVATE_INPUTS_PREFLIGHT_ONLY;
    delete childEnv.ISEM_OPTICAL_PIPELINE_TXT_PATH;
    delete childEnv.ISEM_OPTICAL_PIPELINE_ANSWER_KEY_PATH;

    const pnpm = platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = spawn(pnpm, ["isem-optical-pipeline:smoke:producer"], {
      env: childEnv,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    rmSync(inputRoot, { force: true, recursive: true });
  }
}

function decodeRequiredBase64(env, envName) {
  const encoded = env[envName]?.trim();
  if (!encoded) throw new Error(`${envName}_REQUIRED`);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(`${envName}_INVALID`);
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) throw new Error(`${envName}_INVALID`);
  return decoded;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runPrivateIsemOpticalPipeline();
}
