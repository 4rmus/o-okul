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

const root = resolve("..", ".o-okul-staging-secret-contract");
const repoPath = resolve("artifacts/staging-evidence-secret-contract");
const fakeGhPath = join(root, "fake-gh.mjs");
const validEnvPath = join(root, "staging-evidence.env");
const secretLeakMarker = "super-secret-value-that-must-not-leak";

rmSync(root, { recursive: true, force: true });
rmSync(repoPath, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
mkdirSync(repoPath, { recursive: true });

writeFileSync(validEnvPath, buildValidEnvFile());
chmodSync(validEnvPath, 0o600);
writeFakeGh();

try {
  expectSetPass();
  expectDryRunDoesNotCallGh();
  expectGhFailureDoesNotLeakOutput();
  expectFailure(
    "missing env file argument",
    ["--repo", "owner/repo", "--environment", "staging", "--gh-bin", fakeGhPath],
    ["--env-file için özel staging evidence env dosyası gerekli."],
  );
  expectFailure("loose file mode", ["--repo", "owner/repo", "--env-file", looseModeEnvFile()], [
    "chmod 600",
  ]);
  expectFailure("repo path", ["--repo", "owner/repo", "--env-file", repoEnvFile()], [
    "repo çalışma ağacı dışında tutulmalı",
  ]);
  expectFailure("temp path", ["--repo", "owner/repo", "--env-file", tempEnvFile()], [
    "geçici dizin altında olmamalı",
  ]);
  expectFailure("symlink file", ["--repo", "owner/repo", "--env-file", symlinkEnvFile()], [
    "symlink olamaz",
  ]);
  expectFailure("parent symlink", ["--repo", "owner/repo", "--env-file", parentSymlinkEnvFile()], [
    "parent-symlink",
  ]);
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(repoPath, { recursive: true, force: true });
}

console.log("Staging evidence GitHub secret contract kontrolü geçti.");

function expectSetPass() {
  const captureDir = resetCapture("pass");
  const result = runHelper(["--repo", "owner/repo", "--environment", "staging", "--env-file", validEnvPath], {
    FAKE_GH_CAPTURE_DIR: captureDir,
    FAKE_GH_SCENARIO: "pass",
  });
  if (result.status !== 0) {
    failContract("secret set senaryosu geçmeli.", result);
  }

  const output = combinedOutput(result);
  if (!output.includes("GitHub staging evidence secret güncellendi: owner/repo/staging/STAGING_EVIDENCE_ENV_B64")) {
    failContract("secret set senaryosu başarı çıktısını üretmeli.", result);
  }
  assertNoSecretLeak(result, "secret set");

  const args = JSON.parse(readFileSync(join(captureDir, "args.json"), "utf8"));
  const expectedArgs = ["secret", "set", "STAGING_EVIDENCE_ENV_B64", "--env", "staging", "--repo", "owner/repo"];
  if (JSON.stringify(args) !== JSON.stringify(expectedArgs)) {
    failContract(`fake gh argümanları beklenenle eşleşmeli: ${expectedArgs.join(" ")}`, result);
  }

  const encoded = readFileSync(join(captureDir, "stdin.txt"), "utf8");
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  if (decoded !== readFileSync(validEnvPath, "utf8")) {
    failContract("secret set stdin içeriği env dosyasının base64 çıktısı olmalı.", result);
  }
}

function expectDryRunDoesNotCallGh() {
  const captureDir = resetCapture("dry-run");
  const result = runHelper(["--repo", "owner/repo", "--environment", "staging", "--env-file", validEnvPath, "--dry-run"], {
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
  const result = runHelper(["--repo", "owner/repo", "--environment", "staging", "--env-file", validEnvPath], {
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
  return spawnSync(process.execPath, ["scripts/set-staging-evidence-github-secret.mjs", "--gh-bin", fakeGhPath, ...helperArgs], {
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

function looseModeEnvFile() {
  const file = join(root, "loose-mode.env");
  writeFileSync(file, readFileSync(validEnvPath, "utf8"));
  chmodSync(file, 0o644);
  return file;
}

function repoEnvFile() {
  const file = join(repoPath, "staging-evidence.env");
  writeFileSync(file, "NODE_ENV=production\n");
  chmodSync(file, 0o600);
  return file;
}

function tempEnvFile() {
  const file = join(tmpdir(), `o-okul-staging-secret-${Date.now()}.env`);
  writeFileSync(file, "NODE_ENV=production\n");
  chmodSync(file, 0o600);
  return file;
}

function symlinkEnvFile() {
  const link = join(root, "symlink-env.env");
  symlinkSync(validEnvPath, link);
  return link;
}

function parentSymlinkEnvFile() {
  const realParent = join(root, "real-parent");
  const linkParent = join(root, "link-parent");
  mkdirSync(realParent, { recursive: true });
  writeFileSync(join(realParent, "staging-evidence.env"), readFileSync(validEnvPath, "utf8"));
  chmodSync(join(realParent, "staging-evidence.env"), 0o600);
  symlinkSync(realParent, linkParent);
  return join(linkParent, "staging-evidence.env");
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

if (JSON.stringify(args) !== JSON.stringify(["secret", "set", "STAGING_EVIDENCE_ENV_B64", "--env", "staging", "--repo", "owner/repo"])) {
  process.stderr.write("unexpected args");
  process.exit(2);
}

process.stdout.write("fake gh secret set ok\\n");
`,
  );
  chmodSync(fakeGhPath, 0o700);
}

function buildValidEnvFile() {
  const template = readFileSync("docs/evidence-templates/staging-evidence.env.example", "utf8");
  const replacements = new Map([
    ["https://__SET_STAGING_WEB_HOST__", "https://staging.o-okul.com"],
    ["https://__SET_STAGING_API_HOST__", "https://api.staging.o-okul.com"],
    ["__SET_STAGING_WEB_HOST__", "staging.o-okul.com"],
    ["__SET_APP_DB_PASSWORD__", "contractAppDbPasswordValue001"],
    ["__SET_MIGRATION_DB_PASSWORD__", "contractMigrationDbPasswordValue001"],
    ["__SET_STAGING_DB_HOST__", "db.staging.o-okul.internal"],
    ["__SET_REAL_ACCESS_SECRET__", "contractAccessSecretValue000000000001"],
    ["__SET_REAL_STUDENT_PII_ENCRYPTION_KEY__", "contractStudentPiiEncryption00000003"],
    ["__SET_REAL_STUDENT_PII_HASH_KEY__", "contractStudentPiiHashValue000000004"],
    ["__SET_REAL_ADMIN_MFA_SECRET_ENCRYPTION_KEY__", "contractAdminMfaEncryption000000005"],
    ["__SET_REAL_ADMIN_MFA_RECOVERY_HASH_KEY__", "contractAdminMfaRecoveryHash000000006"],
    ["__SET_REAL_ADMIN_MFA_CHALLENGE_SECRET__", "contractAdminMfaChallenge00000000007"],
    ["__SET_STAGING_COOKIE_DOMAIN__", "staging.o-okul.com"],
    ["__SET_QUEUE_BOARD_USER__", "queue-board-admin"],
    ["__SET_QUEUE_BOARD_PASSWORD__", "contractQueueBoardPassword0000000008"],
    ["__SET_AUTHORIZED_STAGING_SMS_NUMBER__", "+905551112233"],
    ["__SET_NETGSM_USERCODE__", "netgsmUsercodeContract001"],
    ["__SET_NETGSM_PASSWORD__", "netgsmPasswordContractValue001"],
    ["__SET_NETGSM_MSG_HEADER__", "OOKUL"],
    ["https://__SET_NOTIFICATION_ENDPOINT__", "https://notify.staging.o-okul.com/hook"],
    ["__SET_NOTIFICATION_BEARER_TOKEN__", "contractNotificationBearer00000000009"],
    ["__SET_STAGING_EMAIL_TO__", "ops@o-okul.com"],
    ["__SET_STAGING_PUSH_TO__", "push-target-staging-team"],
    ["https://__SET_S3_ENDPOINT__", "https://s3.staging.o-okul.com"],
    ["__SET_STAGING_BUCKET__", "o-okul-staging"],
    ["__SET_S3_ACCESS_KEY_ID__", "s3AccessKeyContractValue001"],
    ["__SET_S3_SECRET_ACCESS_KEY__", "s3SecretAccessKeyContractValue001"],
    ["__SET_GITHUB_REPOSITORY__", "o-okul-contract/uzman-hocam"],
    ["__SET_IMAGE_TAG__", "ui-ux-contract-20260625"],
    ["__SET_RUN_ID__", "987654321"],
    ["__SET_UI_UX_APPROVED_AT_ISO__", "2026-06-25T12:00:00.000Z"],
    ["https://__SET_SENTRY_DSN__", "https://contractpublickey@sentry.staging.o-okul.com/123"],
    ["s3://__SET_WAL_ARCHIVE_BUCKET__/staging", "s3://o-okul-wal/staging"],
    ["https://__SET_ALERT_WEBHOOK_URL__", "https://alerts.staging.o-okul.com/webhook"],
    ["__SET_ALERT_WEBHOOK_TOKEN__", "contractAlertWebhookToken00000000010"],
  ]);

  let output = template;
  for (const [from, to] of replacements) {
    output = output.split(from).join(to);
  }
  return output;
}

function assertNoSecretLeak(result, label) {
  const output = combinedOutput(result);
  for (const forbidden of [secretLeakMarker, "contractAccessSecretValue000000000001"]) {
    if (output.includes(forbidden)) {
      failContract(`${label} senaryosu secret değerini yazdırmamalı.`, result);
    }
  }
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function failContract(message, result) {
  console.error("Staging evidence GitHub secret contract kontrolü başarısız:");
  console.error(`- ${message}`);
  if (result) {
    console.error(combinedOutput(result));
  }
  process.exit(1);
}
