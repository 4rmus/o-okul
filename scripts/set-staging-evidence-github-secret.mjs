import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const secretName = "STAGING_EVIDENCE_ENV_B64";
const args = process.argv.slice(2);
const envFileArg = readArgValue("--env-file");
const environmentName = readArgValue("--environment") ?? process.env.STAGING_GITHUB_ENVIRONMENT ?? "staging";
const ghBin = readArgValue("--gh-bin") ?? process.env.GH_BIN ?? defaultGhBin();
const repo = readArgValue("--repo") ?? process.env.GITHUB_REPOSITORY ?? inferRepoFromRemote();
const dryRun = hasFlag("--dry-run");

if (hasFlag("--help")) {
  printUsage();
  process.exit(0);
}

const failures = [];

if (!envFileArg) {
  failures.push("--env-file için özel staging evidence env dosyası gerekli.");
}
if (!repo) {
  failures.push("GitHub repo belirlenemedi; --repo owner/name veya GITHUB_REPOSITORY verilmeli.");
}
if (environmentName.trim() === "") {
  failures.push("--environment boş olamaz.");
}

if (failures.length > 0) {
  fail(failures);
}

const envFile = resolve(envFileArg);
validateSecretFile(envFile, failures);

if (failures.length > 0) {
  fail(failures);
}

runEvidenceEnvCheck(envFile);

const encodedEnv = readFileSync(envFile).toString("base64");
if (encodedEnv.trim() === "") {
  fail([`${envFile} boş olmamalı.`]);
}

if (dryRun) {
  console.log(`Staging evidence secret dry-run geçti: ${repo}/${environmentName}/${secretName}`);
  process.exit(0);
}

const result = spawnSync(ghBin, ["secret", "set", secretName, "--env", environmentName, "--repo", repo], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: process.env,
  input: encodedEnv,
  stdio: ["pipe", "pipe", "pipe"],
});

if (result.status !== 0) {
  fail([`gh secret set komutu başarısız oldu: ${repo}/${environmentName}/${secretName}`]);
}

console.log(`GitHub staging evidence secret güncellendi: ${repo}/${environmentName}/${secretName}`);

function validateSecretFile(file, output) {
  let fileLstat;
  try {
    fileLstat = lstatSync(file);
  } catch {
    output.push(`${file} okunabilir bir dosya olmalı.`);
    return;
  }

  if (fileLstat.isSymbolicLink()) {
    output.push(`${file} symlink olamaz.`);
  }
  if (!fileLstat.isFile()) {
    output.push(`${file} normal dosya olmalı.`);
    return;
  }

  validateParentDirs(file, output);

  const fileStat = statSync(file);
  if ((fileStat.mode & 0o077) !== 0) {
    output.push(`${file} sadece sahibi tarafından okunmalı: chmod 600 ${file}`);
  }

  const realFile = realpathSync(file);
  for (const base of forbiddenBases()) {
    if (isInside(realFile, base)) {
      output.push(`${file} geçici dizin altında olmamalı: ${base}`);
    }
  }

  const workspaceRoot = realpathSync(process.cwd());
  if (isInside(realFile, workspaceRoot)) {
    output.push(`${file} repo çalışma ağacı dışında tutulmalı.`);
  }
}

function validateParentDirs(file, output) {
  let current = dirname(file);
  while (true) {
    const currentLstat = lstatSync(current);
    if (currentLstat.isSymbolicLink()) {
      output.push(`${file} parent-symlink içermemeli: ${current}`);
      return;
    }

    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function forbiddenBases() {
  return ["/tmp", "/private/tmp", "/var/tmp", process.env.TMPDIR].filter(Boolean).map((base) => realpathIfExists(base));
}

function realpathIfExists(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isInside(targetPath, parentPath) {
  const relativePath = relative(parentPath, targetPath);
  return relativePath === "" || (!!relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function runEvidenceEnvCheck(file) {
  const result = spawnSync(process.execPath, ["scripts/check-staging-evidence-env.mjs", "--env-file", file], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function defaultGhBin() {
  if (existsSync("/opt/homebrew/bin/gh")) return "/opt/homebrew/bin/gh";
  return "gh";
}

function inferRepoFromRemote() {
  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) return "";

  const remoteUrl = result.stdout.trim();
  const githubMatch = remoteUrl.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/);
  if (!githubMatch?.groups) return "";
  return `${githubMatch.groups.owner}/${githubMatch.groups.repo}`;
}

function readArgValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function hasFlag(name) {
  return args.includes(name);
}

function printUsage() {
  console.log(`Usage:
  pnpm staging:evidence-env:secret:set -- --repo 4rmus/uzman-hocam --environment staging --env-file /secure/path/staging-evidence.env

Options:
  --env-file      Gerçek staging evidence env dosyası. Repo ve temp dizinleri reddedilir.
  --repo          GitHub repo: owner/name.
  --environment   GitHub environment adı. Varsayılan: staging.
  --gh-bin        gh binary yolu. Varsayılan: /opt/homebrew/bin/gh veya gh.
  --dry-run       Dosya güvenliğini ve env sözleşmesini doğrular, secret yazmaz.

Secret base64 değeri gh secret set komutuna stdin üzerinden verilir; shell argümanına yazılmaz.
`);
}

function fail(messages) {
  console.error("Staging evidence secret set işlemi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
