import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const environmentName = readArgValue("--environment") ?? process.env.STAGING_GITHUB_ENVIRONMENT ?? "staging";
const ghBin = readArgValue("--gh-bin") ?? process.env.GH_BIN ?? defaultGhBin();
const repo = readArgValue("--repo") ?? process.env.GITHUB_REPOSITORY ?? inferRepoFromRemote();
const expectedDeployDir = "/root/uzman-hocam";
const requiredSecrets = [
  "STAGING_SSH_HOST",
  "STAGING_SSH_USER",
  "STAGING_SSH_PRIVATE_KEY",
  "GHCR_READ_TOKEN",
  "STAGING_EVIDENCE_ENV_B64",
];
const requiredVariables = ["STAGING_DEPLOY_DIR", "STAGING_NEXT_PUBLIC_API_URL"];
const optionalVariables = ["STAGING_EDGE_MODE"];
const failures = [];

if (!repo) {
  fail(["GitHub repo belirlenemedi; --repo owner/name veya GITHUB_REPOSITORY verilmeli."]);
}

const environmentPath = `repos/${repo}/environments/${encodeURIComponent(environmentName)}`;
const environment = ghJson(["api", environmentPath], {
  notFoundMessage: `GitHub staging environment bulunamadı: ${repo}/${environmentName}`,
});

if (environment) {
  const variables = ghJson(["api", `${environmentPath}/variables?per_page=100`], {
    notFoundMessage: `GitHub staging environment variables okunamadı: ${repo}/${environmentName}`,
  });
  const secrets = ghJson(["api", `${environmentPath}/secrets?per_page=100`], {
    notFoundMessage: `GitHub staging environment secrets okunamadı: ${repo}/${environmentName}`,
  });

  if (variables) validateVariables(variables, failures);
  if (secrets) validateSecrets(secrets, failures);
}

if (failures.length > 0) {
  fail(failures);
}

console.log(`GitHub staging environment kontrolü geçti: ${repo}/${environmentName}`);

function validateVariables(response, output) {
  const variables = new Map((response.variables ?? []).map((variable) => [variable.name, variable.value]));

  for (const key of requiredVariables) {
    if (!variables.has(key)) {
      output.push(`GitHub staging variable eksik: ${key}`);
      continue;
    }
    if (String(variables.get(key)).trim() === "") {
      output.push(`GitHub staging variable boş: ${key}`);
    }
  }

  for (const key of optionalVariables) {
    if (variables.has(key) && String(variables.get(key)).trim() === "") {
      output.push(`GitHub staging variable boş: ${key}`);
    }
  }

  validateDeployDir(variables.get("STAGING_DEPLOY_DIR"), output);
  validateNextPublicApiUrl(variables.get("STAGING_NEXT_PUBLIC_API_URL"), variables.get("STAGING_EDGE_MODE"), output);
  validateEdgeMode(variables.get("STAGING_EDGE_MODE"), output);
}

function validateSecrets(response, output) {
  const secretNames = new Set((response.secrets ?? []).map((secret) => secret.name));
  for (const key of requiredSecrets) {
    if (!secretNames.has(key)) {
      output.push(`GitHub staging secret eksik: ${key}`);
    }
  }
}

function validateDeployDir(value, output) {
  if (typeof value !== "string" || value.trim() === "") return;
  if (!value.startsWith("/")) {
    output.push("STAGING_DEPLOY_DIR absolute path olmalı.");
  }
  if (value === "/") {
    output.push("STAGING_DEPLOY_DIR / olamaz.");
  }
  if (value !== expectedDeployDir) {
    output.push("STAGING_DEPLOY_DIR /root/uzman-hocam olmalı.");
  }
  if (value.includes("'") || value.includes("\n") || value.includes("\r")) {
    output.push("STAGING_DEPLOY_DIR shell için güvenli path olmalı.");
  }
}

function validateNextPublicApiUrl(value, edgeMode, output) {
  if (typeof value !== "string" || value.trim() === "") return;

  let url;
  try {
    url = new URL(value);
  } catch {
    output.push("STAGING_NEXT_PUBLIC_API_URL geçerli URL olmalı.");
    return;
  }

  if (url.protocol !== "https:") {
    output.push("STAGING_NEXT_PUBLIC_API_URL https:// URL olmalı.");
  }
  if (hasPlaceholderHost(url.hostname)) {
    output.push("STAGING_NEXT_PUBLIC_API_URL gerçek staging host olmalı.");
  }
  if (isIpv4Address(url.hostname) && edgeMode !== "ip") {
    output.push("STAGING_EDGE_MODE ip staging host için ip olmalı.");
  }
}

function validateEdgeMode(value, output) {
  if (value === undefined) return;
  if (value !== "domain" && value !== "ip") {
    output.push("STAGING_EDGE_MODE domain veya ip olmalı.");
  }
}

function hasPlaceholderHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".test") ||
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized.includes("example") ||
    normalized.includes("__set") ||
    normalized.includes("placeholder")
  );
}

function isIpv4Address(hostname) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);
}

function defaultGhBin() {
  if (existsSync("/opt/homebrew/bin/gh")) return "/opt/homebrew/bin/gh";
  return "gh";
}

function ghJson(commandArgs, { notFoundMessage }) {
  const result = spawnSync(ghBin, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`;
    if (output.includes("HTTP 404") || output.includes("Not Found")) {
      failures.push(notFoundMessage);
      return null;
    }
    failures.push(`gh ${commandArgs.join(" ")} komutu başarısız oldu.`);
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    failures.push(`gh ${commandArgs.join(" ")} geçerli JSON dönmeli.`);
    return null;
  }
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

function fail(messages) {
  console.error("GitHub staging environment kontrolü başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
