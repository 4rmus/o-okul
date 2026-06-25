import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve("..", ".o-okul-staging-ghcr-secret-contract");
const repoPath = resolve("artifacts/staging-ghcr-secret-contract");
const fakeGhPath = join(root, "fake-gh.mjs");
const validTokenPath = join(root, "ghcr-read-token");
const secretLeakMarker = "github_pat_super_secret_value_that_must_not_leak_1234567890";

rmSync(root, { recursive: true, force: true });
rmSync(repoPath, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
mkdirSync(repoPath, { recursive: true });

writeFileSync(validTokenPath, `${secretLeakMarker}\n`);
chmodSync(validTokenPath, 0o600);
writeFakeGh();

try {
  expectSetPass();
  expectDryRunDoesNotCallGh();
  expectGhFailureDoesNotLeakOutput();
  expectFailure(
    "missing token file argument",
    ["--repo", "owner/repo", "--environment", "staging", "--gh-bin", fakeGhPath],
    ["--token-file için özel GHCR read token dosyası gerekli."],
  );
  expectFailure("loose file mode", ["--repo", "owner/repo", "--token-file", looseModeTokenFile()], ["chmod 600"]);
  expectFailure("repo path", ["--repo", "owner/repo", "--token-file", repoTokenFile()], [
    "repo çalışma ağacı dışında tutulmalı",
  ]);
  expectFailure("temp path", ["--repo", "owner/repo", "--token-file", tempTokenFile()], [
    "geçici dizin altında olmamalı",
  ]);
  expectFailure("symlink file", ["--repo", "owner/repo", "--token-file", symlinkTokenFile()], ["symlink olamaz"]);
  expectFailure("parent symlink", ["--repo", "owner/repo", "--token-file", parentSymlinkTokenFile()], [
    "parent-symlink",
  ]);
  expectFailure("placeholder token", ["--repo", "owner/repo", "--token-file", placeholderTokenFile()], [
    "GHCR read token gerçek değer olmalı.",
  ]);
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(repoPath, { recursive: true, force: true });
}

console.log("Staging GHCR read token secret contract kontrolü geçti.");

function expectSetPass() {
  const captureDir = resetCapture("pass");
  const result = runHelper(["--repo", "owner/repo", "--environment", "staging", "--token-file", validTokenPath], {
    FAKE_GH_CAPTURE_DIR: captureDir,
    FAKE_GH_SCENARIO: "pass",
  });
  if (result.status !== 0) {
    failContract("secret set senaryosu geçmeli.", result);
  }

  const output = combinedOutput(result);
  if (!output.includes("GitHub staging GHCR read token secret güncellendi: owner/repo/staging/GHCR_READ_TOKEN")) {
    failContract("secret set senaryosu başarı çıktısını üretmeli.", result);
  }
  assertNoSecretLeak(result, "secret set");

  const args = JSON.parse(readFileSync(join(captureDir, "args.json"), "utf8"));
  const expectedArgs = ["secret", "set", "GHCR_READ_TOKEN", "--env", "staging", "--repo", "owner/repo"];
  if (JSON.stringify(args) !== JSON.stringify(expectedArgs)) {
    failContract(`fake gh argümanları beklenenle eşleşmeli: ${expectedArgs.join(" ")}`, result);
  }

  const stdin = readFileSync(join(captureDir, "stdin.txt"), "utf8");
  if (stdin !== secretLeakMarker) {
    failContract("secret set stdin içeriği token değeri olmalı.", result);
  }
}

function expectDryRunDoesNotCallGh() {
  const captureDir = resetCapture("dry-run");
  const result = runHelper(["--repo", "owner/repo", "--environment", "staging", "--token-file", validTokenPath, "--dry-run"], {
    FAKE_GH_CAPTURE_DIR: captureDir,
    FAKE_GH_SCENARIO: "pass",
  });
  if (result.status !== 0) {
    failContract("dry-run senaryosu geçmeli.", result);
  }
  if (existsSync(join(captureDir, "args.json")) || existsSync(join(captureDir, "stdin.txt"))) {
    failContract("dry-run fake gh çağırmamalı.", result);
  }
  assertNoSecretLeak(result, "dry-run");
}

function expectGhFailureDoesNotLeakOutput() {
  const captureDir = resetCapture("gh-failure");
  const result = runHelper(["--repo", "owner/repo", "--environment", "staging", "--token-file", validTokenPath], {
    FAKE_GH_CAPTURE_DIR: captureDir,
    FAKE_GH_SCENARIO: "fail-with-secret",
  });
  if (result.status === 0) {
    failContract("gh failure senaryosu kırılmalı.", result);
  }

  const output = combinedOutput(result);
  if (!output.includes("gh secret set komutu başarısız oldu")) {
    failContract("gh failure güvenli hata mesajı üretmeli.", result);
  }
  assertNoSecretLeak(result, "gh failure");
}

function expectFailure(label, args, expectedMessages) {
  const result = runHelper(args);
  if (result.status === 0) {
    failContract(`${label} senaryosu kırılmalı.`, result);
  }

  const output = combinedOutput(result);
  for (const message of expectedMessages) {
    if (!output.includes(message)) {
      failContract(`${label} senaryosu beklenen hatayı üretmeli: ${message}`, result);
    }
  }
  assertNoSecretLeak(result, label);
}

function runHelper(helperArgs, extraEnv = {}) {
  return spawnSync(process.execPath, ["scripts/set-staging-ghcr-read-token-secret.mjs", "--gh-bin", fakeGhPath, ...helperArgs], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

function resetCapture(name) {
  const captureDir = join(root, "capture", name);
  rmSync(captureDir, { recursive: true, force: true });
  mkdirSync(captureDir, { recursive: true });
  return captureDir;
}

function looseModeTokenFile() {
  const file = join(root, "loose-mode-token");
  writeFileSync(file, `${secretLeakMarker}\n`);
  chmodSync(file, 0o644);
  return file;
}

function repoTokenFile() {
  const file = join(repoPath, "ghcr-read-token");
  writeFileSync(file, `${secretLeakMarker}\n`);
  chmodSync(file, 0o600);
  return file;
}

function tempTokenFile() {
  const file = join(tmpdir(), `o-okul-ghcr-secret-${Date.now()}`);
  writeFileSync(file, `${secretLeakMarker}\n`);
  chmodSync(file, 0o600);
  return file;
}

function symlinkTokenFile() {
  const link = join(root, "symlink-token");
  symlinkSync(validTokenPath, link);
  return link;
}

function parentSymlinkTokenFile() {
  const realParent = join(root, "real-parent");
  const linkParent = join(root, "link-parent");
  mkdirSync(realParent, { recursive: true });
  writeFileSync(join(realParent, "ghcr-read-token"), `${secretLeakMarker}\n`);
  chmodSync(join(realParent, "ghcr-read-token"), 0o600);
  symlinkSync(realParent, linkParent);
  return join(linkParent, "ghcr-read-token");
}

function placeholderTokenFile() {
  const file = join(root, "placeholder-token");
  writeFileSync(file, "replace-me-ghcr-read-token-value-000\n");
  chmodSync(file, 0o600);
  return file;
}

function writeFakeGh() {
  writeFileSync(
    fakeGhPath,
    `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const captureDir = process.env.FAKE_GH_CAPTURE_DIR;
const scenario = process.env.FAKE_GH_SCENARIO ?? "pass";
if (!captureDir) {
  process.stderr.write("missing capture dir");
  process.exit(2);
}

mkdirSync(captureDir, { recursive: true });
writeFileSync(join(captureDir, "args.json"), JSON.stringify(args));
writeFileSync(join(captureDir, "stdin.txt"), readFileSync(0, "utf8"));

if (scenario === "fail-with-secret") {
  process.stdout.write("${secretLeakMarker}\\n");
  process.stderr.write("${secretLeakMarker}\\n");
  process.exit(1);
}

if (JSON.stringify(args) !== JSON.stringify(["secret", "set", "GHCR_READ_TOKEN", "--env", "staging", "--repo", "owner/repo"])) {
  process.stderr.write("unexpected args");
  process.exit(2);
}

process.stdout.write("fake gh secret set ok\\n");
`,
  );
  chmodSync(fakeGhPath, 0o700);
}

function assertNoSecretLeak(result, label) {
  const output = combinedOutput(result);
  if (output.includes(secretLeakMarker)) {
    failContract(`${label} senaryosu secret değerini yazdırmamalı.`, result);
  }
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function failContract(message, result) {
  console.error("Staging GHCR read token secret contract kontrolü başarısız:");
  console.error(`- ${message}`);
  if (result) {
    console.error(combinedOutput(result));
  }
  process.exit(1);
}
