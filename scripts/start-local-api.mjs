import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const externalEnvKeys = new Set(Object.keys(process.env));

loadEnvFile(".env");
loadEnvFile(".env.local");

setDefault("PORT", "3100");
setDefault("WEB_URL", "http://localhost:3001");
setDefault("DATABASE_URL", "postgresql://app:app@localhost:5432/o_okul");
setDefault("DIRECT_DATABASE_URL", "postgresql://migration:migration@localhost:5432/o_okul");
setDefault("REDIS_URL", "redis://localhost:6379");
setDefault("PERSISTENCE_DRIVER", "postgres");

const child = spawn(process.execPath, ["apps/api/dist/main.js"], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function loadEnvFile(fileName) {
  const filePath = join(repoRoot, fileName);
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed || externalEnvKeys.has(parsed.key)) continue;
    process.env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return undefined;
  return {
    key: match[1],
    value: stripQuotes(match[2].trim()),
  };
}

function stripQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function setDefault(key, value) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
