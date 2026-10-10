#!/usr/bin/env node
// Generates the adapter surfaces for Claude Code from the canonical Codex definitions.
//
// Canonical sources (hand-edited):
//   .codex/agents/*.toml          -> .claude/agents/<file>.md       (Claude Code project subagents)
//   .agents/skills/*/SKILL.md     -> .claude/skills/<name>/SKILL.md (Claude Code project skills)
//   .codex/config.toml            -> .mcp.json                      (Claude Code project MCP servers)
//
// Cursor reads .agents/skills, .codex/agents and .claude/agents natively, so it needs no adapter.
//
// Usage:
//   node scripts/generate-agent-adapters.mjs          write adapters, remove stale generated files
//   node scripts/generate-agent-adapters.mjs --check  exit 1 when the committed adapters differ
//
// Format references (checked 2026-10-10):
//   Claude Code subagents: https://code.claude.com/docs/en/sub-agents
//   Claude Code skills:    https://code.claude.com/docs/en/skills
//   Claude Code MCP:       https://code.claude.com/docs/en/mcp
//   Codex custom agents:   https://learn.chatgpt.com/docs/agent-configuration/subagents
//   Codex skills:          https://learn.chatgpt.com/docs/build-skills
//   Codex MCP:             https://learn.chatgpt.com/docs/extend/mcp

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GENERATOR_PATH = "scripts/generate-agent-adapters.mjs";
export const CODEX_AGENTS_DIR = ".codex/agents";
export const CODEX_CONFIG_PATH = ".codex/config.toml";
export const REPO_SKILLS_DIR = ".agents/skills";
export const CLAUDE_AGENTS_DIR = ".claude/agents";
export const CLAUDE_SKILLS_DIR = ".claude/skills";
export const MCP_JSON_PATH = ".mcp.json";
export const GENERATED_MARKER = "GENERATED FILE - do not edit by hand.";

const READ_ONLY_DISALLOWED_TOOLS = "Write, Edit, NotebookEdit";
const CLAUDE_EFFORT_BY_CODEX_EFFORT = new Map([
  ["minimal", "low"],
  ["low", "low"],
  ["medium", "medium"],
  ["high", "high"],
  ["xhigh", "xhigh"],
]);

export function parseAgentToml(source, file) {
  const result = { tables: {} };
  const lines = source.split(/\r?\n/);
  let table = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const tableMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      table = tableMatch[1].trim();
      result.tables[table] ??= {};
      continue;
    }

    const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!keyMatch) throw new Error(`${file}:${index + 1} TOML satırı çözümlenemedi: ${trimmed}`);
    const key = keyMatch[1];
    const rawValue = keyMatch[2];
    const target = table ? result.tables[table] : result;

    if (rawValue.startsWith('"""')) {
      const firstLineRest = rawValue.slice(3);
      if (firstLineRest.includes('"""')) {
        target[key] = firstLineRest.slice(0, firstLineRest.indexOf('"""'));
        continue;
      }
      const body = [];
      let closed = false;
      for (index += 1; index < lines.length; index += 1) {
        const closeIndex = lines[index].indexOf('"""');
        if (closeIndex >= 0) {
          if (closeIndex > 0) body.push(lines[index].slice(0, closeIndex));
          closed = true;
          break;
        }
        body.push(lines[index]);
      }
      if (!closed) throw new Error(`${file} çok satırlı '${key}' alanı kapatılmamış.`);
      // TOML trims the newline immediately following the opening delimiter.
      target[key] = (firstLineRest === "" ? "" : `${firstLineRest}\n`) + body.join("\n");
      continue;
    }

    target[key] = parseScalar(rawValue, file, index + 1);
  }
  return result;
}

function parseScalar(rawValue, file, lineNumber) {
  const value = stripComment(rawValue).trim();
  if (value.startsWith('"')) {
    const match = value.match(/^"((?:[^"\\]|\\.)*)"$/);
    if (!match) throw new Error(`${file}:${lineNumber} string değeri çözümlenemedi: ${value}`);
    return JSON.parse(`"${match[1]}"`);
  }
  if (value.startsWith("[")) {
    const match = value.match(/^\[(.*)\]$/);
    if (!match) throw new Error(`${file}:${lineNumber} dizi değeri çözümlenemedi: ${value}`);
    const inner = match[1].trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => parseScalar(item.trim(), file, lineNumber));
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  throw new Error(`${file}:${lineNumber} desteklenmeyen TOML değeri: ${value}`);
}

function stripComment(rawValue) {
  let inString = false;
  for (let index = 0; index < rawValue.length; index += 1) {
    const char = rawValue[index];
    if (char === '"' && rawValue[index - 1] !== "\\") inString = !inString;
    if (char === "#" && !inString) return rawValue.slice(0, index);
  }
  return rawValue;
}

export function listCodexAgentFiles() {
  return readdirSync(CODEX_AGENTS_DIR)
    .filter((file) => file.endsWith(".toml"))
    .map((file) => join(CODEX_AGENTS_DIR, file))
    .sort();
}

export function listRepoSkillDirs() {
  return readdirSync(REPO_SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(REPO_SKILLS_DIR, entry.name, "SKILL.md")))
    .map((entry) => join(REPO_SKILLS_DIR, entry.name))
    .sort();
}

export function renderClaudeAgent(file) {
  const agent = parseAgentToml(readFileSync(file, "utf8"), file);
  for (const key of ["name", "description", "developer_instructions", "sandbox_mode"]) {
    if (!agent[key]) throw new Error(`${file} '${key}' alanı eksik; adapter üretilemez.`);
  }
  const readOnly = agent.sandbox_mode === "read-only";
  const effort = CLAUDE_EFFORT_BY_CODEX_EFFORT.get(agent.model_reasoning_effort ?? "");

  const frontmatter = [
    `name: ${agent.name}`,
    `description: ${yamlString(agent.description)}`,
    "model: inherit",
  ];
  if (effort) frontmatter.push(`effort: ${effort}`);
  if (readOnly) {
    frontmatter.push("permissionMode: plan");
    frontmatter.push(`disallowedTools: ${READ_ONLY_DISALLOWED_TOOLS}`);
  }

  const body = agent.developer_instructions.trim();
  return [
    "---",
    ...frontmatter,
    "---",
    `<!-- ${GENERATED_MARKER} Source: ${file}. Regenerate with \`pnpm agents:generate\`. -->`,
    "",
    body,
    "",
  ].join("\n");
}

export function renderClaudeSkill(skillDir) {
  const skillPath = join(skillDir, "SKILL.md");
  const source = readFileSync(skillPath, "utf8");
  const match = source.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/);
  if (!match) throw new Error(`${skillPath} YAML frontmatter içermeli; adapter üretilemez.`);
  const frontmatter = match[1].replace(/\r\n/g, "\n");
  const body = match[2].replace(/\r\n/g, "\n").replace(/^\n+/, "");
  return `${frontmatter}<!-- ${GENERATED_MARKER} Source: ${skillPath}. Regenerate with \`pnpm agents:generate\`. -->\n\n${body}`;
}

export function renderMcpJson() {
  const config = parseAgentToml(readFileSync(CODEX_CONFIG_PATH, "utf8"), CODEX_CONFIG_PATH);
  const mcpServers = {};
  for (const [table, values] of Object.entries(config.tables)) {
    const match = table.match(/^mcp_servers\.([A-Za-z0-9_-]+)$/);
    if (!match) continue;
    if (values.enabled === false) continue;
    if (!values.url) {
      throw new Error(`${CODEX_CONFIG_PATH} [${table}] yalnız streamable HTTP (url) sunucular .mcp.json'a taşınır.`);
    }
    const server = { type: "http", url: values.url };
    if (typeof values.tool_timeout_sec === "number") server.timeout = values.tool_timeout_sec * 1000;
    mcpServers[match[1]] = server;
  }
  return `${JSON.stringify({ mcpServers }, null, 2)}\n`;
}

export function collectAdapters() {
  const files = new Map();
  for (const file of listCodexAgentFiles()) {
    files.set(join(CLAUDE_AGENTS_DIR, `${basename(file, ".toml")}.md`), renderClaudeAgent(file));
  }
  for (const skillDir of listRepoSkillDirs()) {
    files.set(join(CLAUDE_SKILLS_DIR, basename(skillDir), "SKILL.md"), renderClaudeSkill(skillDir));
  }
  files.set(MCP_JSON_PATH, renderMcpJson());
  return files;
}

export function listGeneratedFilesOnDisk() {
  const found = [];
  if (existsSync(CLAUDE_AGENTS_DIR)) {
    for (const file of readdirSync(CLAUDE_AGENTS_DIR)) {
      if (file.endsWith(".md")) found.push(join(CLAUDE_AGENTS_DIR, file));
    }
  }
  if (existsSync(CLAUDE_SKILLS_DIR)) {
    for (const entry of readdirSync(CLAUDE_SKILLS_DIR, { withFileTypes: true })) {
      const skillPath = join(CLAUDE_SKILLS_DIR, entry.name, "SKILL.md");
      if (entry.isDirectory() && existsSync(skillPath)) found.push(skillPath);
    }
  }
  if (existsSync(MCP_JSON_PATH)) found.push(MCP_JSON_PATH);
  return found.sort();
}

export function checkAdapters() {
  const problems = [];
  const expected = collectAdapters();
  for (const [file, content] of expected) {
    if (!existsSync(file)) {
      problems.push(`${file} eksik; 'pnpm agents:generate' çalıştırın.`);
      continue;
    }
    if (readFileSync(file, "utf8") !== content) {
      problems.push(`${file} kanonik kaynaktan sapmış; 'pnpm agents:generate' çalıştırın.`);
    }
  }
  for (const file of listGeneratedFilesOnDisk()) {
    if (!expected.has(file)) problems.push(`${file} kanonik kaynağı olmayan eski adapter; 'pnpm agents:generate' siler.`);
  }
  return problems;
}

export function writeAdapters() {
  const expected = collectAdapters();
  for (const file of listGeneratedFilesOnDisk()) {
    if (expected.has(file)) continue;
    const content = readFileSync(file, "utf8");
    if (file === MCP_JSON_PATH || content.includes(GENERATED_MARKER)) {
      rmSync(file.endsWith("SKILL.md") ? dirname(file) : file, { recursive: true, force: true });
    }
  }
  const written = [];
  for (const [file, content] of expected) {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file) && readFileSync(file, "utf8") === content) continue;
    writeFileSync(file, content);
    written.push(file);
  }
  return { total: expected.size, written };
}

function yamlString(value) {
  return JSON.stringify(value);
}

function main() {
  const check = process.argv.includes("--check");
  if (check) {
    const problems = checkAdapters();
    if (problems.length > 0) {
      console.error("Agent adapter kontrolü başarısız:");
      for (const problem of problems) console.error(`- ${problem}`);
      process.exit(1);
    }
    console.log(`Agent adapter kontrolü geçti: ${collectAdapters().size} üretilmiş dosya kanonik kaynakla uyumlu.`);
    return;
  }
  const { total, written } = writeAdapters();
  console.log(`Agent adapter üretimi tamamlandı: ${total} dosya, ${written.length} yazıldı.`);
  for (const file of written) console.log(`- ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
