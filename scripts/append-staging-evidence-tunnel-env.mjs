import { appendFileSync, readFileSync } from "node:fs";

const envFile = readArgValue("--env-file");
const postgresPort = readArgValue("--postgres-port");
const redisPort = readArgValue("--redis-port");
const env = readEnvFile(envFile);

const databaseUrl = env.DATABASE_URL;
const directDatabaseUrl = env.DIRECT_DATABASE_URL || databaseUrl;
const redisUrl = env.REDIS_URL || "redis://127.0.0.1:6379";

if (!databaseUrl) fail("DATABASE_URL is required.");

appendFileSync(
  envFile,
  [
    "",
    "# GitHub Actions SSH tunnel overrides.",
    "STAGING_EVIDENCE_DB_TUNNEL=1",
    `STAGING_EVIDENCE_POSTGRES_TUNNEL_PORT=${postgresPort}`,
    `DATABASE_URL=${rewriteUrl(databaseUrl, postgresPort)}`,
    `DIRECT_DATABASE_URL=${rewriteUrl(directDatabaseUrl, postgresPort)}`,
    `REDIS_URL=${rewriteUrl(redisUrl, redisPort)}`,
    "",
  ].join("\n"),
);

console.log("Staging evidence tunnel env overrides appended.");

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    fail(`${name} is required.`);
  }
  return process.argv[index + 1];
}

function readEnvFile(file) {
  const values = {};
  const contents = readFileSync(file, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^["']|["']$/g, "");
    values[key] = value;
  }
  return values;
}

function rewriteUrl(value, port) {
  const url = new URL(value);
  url.hostname = "127.0.0.1";
  url.port = port;
  return url.toString();
}

function fail(message) {
  console.error(`Staging evidence tunnel env update failed: ${message}`);
  process.exit(1);
}
