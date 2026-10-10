// Verifies the agent/skill/MCP governance contract of this repo.
//
// Canonical sources: .codex/config.toml, .codex/agents/*.toml, .agents/skills/*/SKILL.md.
// Generated adapters: .claude/agents, .claude/skills, .mcp.json (scripts/generate-agent-adapters.mjs).
// Governance docs: AGENTS.md, docs/codex-agent-architecture.md.
//
// Format references (checked 2026-10-10): Codex config reference and subagents/skills docs at
// learn.chatgpt.com, Claude Code docs at code.claude.com, Cursor docs at cursor.com/docs, and the
// Agent Skills specification at agentskills.io.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { checkAdapters, listCodexAgentFiles, parseAgentToml } from "./generate-agent-adapters.mjs";

const failures = [];
const requiredAgentsApprovalLine =
  "- Deploys, provider actions, secret/config changes, DB/data mutations, and mutating smokes require explicit user approval.";
const expectedAgentCount = 15;
const agentsMdMaxBytes = 32 * 1024; // Codex project_doc_max_bytes default.
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const skillNameMaxLength = 64;
const skillDescriptionMaxLength = 1024;
const skillMaxLines = 500;
const walkIgnoredDirs = new Set(["node_modules", ".git", ".next", ".turbo", "dist", "coverage", ".pnpm-store"]);

const requiredSkills = new Map([
  [
    "o-okul-planning",
    {
      tokens: ["AGENTS.md", "docs/codex-agent-architecture.md", "smallest safe first PR", "local/static PASS"],
    },
  ],
  [
    "o-okul-implementation-slice",
    {
      tokens: ["single write owner", "forbidden paths", "Changed files", "Unverified surfaces", "pnpm agents:generate"],
    },
  ],
  [
    "o-okul-release-evidence",
    {
      tokens: ["Static/local", "Live runtime", "running image", "Next action"],
    },
  ],
  [
    "o-okul-pr-review",
    {
      tokens: ["Findings first", "Test gaps", "file and line", "P0/P1"],
    },
  ],
]);

const repoFiles = listRepoFiles();
const rootScripts = new Set(Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {}));
const workspaceScripts = loadWorkspaceScripts();
const counters = { ownershipPaths: 0, gateCommands: 0 };

checkConfig();
checkGovernanceContracts();
checkSkills();
checkOrchestrationRouter();
const agentNames = checkAgents();
checkRosterParity(agentNames);
checkGeneratedAdapters();
checkCursorSurface();
checkTriggerScenarios();

if (failures.length > 0) {
  console.error("Agent/skill contract kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Agent/skill contract kontrolü geçti: ${requiredSkills.size + 1} skill, ${agentNames.length} agent, ` +
    `${counters.ownershipPaths} sahiplik yolu, ${counters.gateCommands} gate komutu, ` +
    "üretilmiş adapter'lar ve 10 trigger senaryosu doğrulandı.",
);

function checkConfig() {
  const source = readFileSync(".codex/config.toml", "utf8");
  const config = parseAgentToml(source, ".codex/config.toml");
  const agents = config.tables.agents ?? {};
  const sandbox = config.tables.sandbox_workspace_write;

  if (config.approval_policy !== "on-request") failures.push(".codex/config.toml top-level approval_policy='on-request' olmalı.");
  if (config.sandbox_mode !== "workspace-write") failures.push(".codex/config.toml top-level sandbox_mode='workspace-write' olmalı.");
  if (!sandbox) failures.push(".codex/config.toml [sandbox_workspace_write] tablosu içermeli.");
  if (sandbox && sandbox.network_access !== false) failures.push(".codex/config.toml sandbox_workspace_write.network_access=false olmalı.");
  if (!config.tables.agents) failures.push(".codex/config.toml [agents] tablosu içermeli.");
  if (agents.max_depth !== 1) failures.push(".codex/config.toml agents.max_depth=1 olmalı.");
  if (agents.max_concurrent_threads_per_session !== 3) {
    failures.push(".codex/config.toml agents.max_concurrent_threads_per_session=3 olmalı (kanonik eşzamanlılık anahtarı).");
  }
  if ("max_threads" in agents) {
    failures.push(".codex/config.toml eski 'agents.max_threads' takma adını kullanmamalı; max_concurrent_threads_per_session kullanın.");
  }
  if (agents.enabled === false) failures.push(".codex/config.toml agents.enabled=false subagent sistemini kapatır; kaldırın.");

  const mcpTables = Object.keys(config.tables).filter((table) => table.startsWith("mcp_servers."));
  if (mcpTables.length === 0) failures.push(".codex/config.toml en az bir [mcp_servers.<id>] tablosu içermeli (docs_researcher bağımlılığı).");
  for (const table of mcpTables) {
    const server = config.tables[table];
    if (!server.url && !server.command) failures.push(`.codex/config.toml [${table}] url veya command içermeli.`);
    if (server.url && !/^https:\/\//.test(server.url)) failures.push(`.codex/config.toml [${table}] url https ile başlamalı.`);
    for (const key of Object.keys(server)) {
      if (/token|secret|password|api_key/i.test(key) && key !== "bearer_token_env_var") {
        failures.push(`.codex/config.toml [${table}] '${key}' gizli değer taşıyamaz; bearer_token_env_var kullanın.`);
      }
    }
  }
}

function checkGovernanceContracts() {
  const agentsSource = readFileSync("AGENTS.md", "utf8");
  if (Buffer.byteLength(agentsSource, "utf8") > agentsMdMaxBytes) {
    failures.push(`AGENTS.md ${agentsMdMaxBytes} bayt Codex project_doc_max_bytes varsayılanını aşmamalı.`);
  }
  for (const token of [
    "agents.max_concurrent_threads_per_session = 3",
    "the main agent and at most three subagents may participate concurrently.",
    "Use no more than three subagents total.",
    "If one subagent writes, at most two read-only subagents may remain.",
    "Each active gate may have only one write-capable participant.",
    "When a gate completes, report its result and stop; do not automatically continue to the next gate.",
    "LOCAL_STATIC`, `LOCAL_TEST`, `CI`, `STAGING`, `PRODUCTION`, `EXTERNAL_NOT_RUN`, and `UNPROVEN",
    "pnpm agents:generate",
    "pnpm agents:check",
  ]) {
    if (!agentsSource.includes(token)) failures.push(`AGENTS.md beklenen yönetişim sözleşmesini içermeli: ${token}`);
  }
  if (agentsSource.includes("max_threads")) {
    failures.push("AGENTS.md eski 'max_threads' takma adına atıf yapmamalı.");
  }
  if (!hasRequiredAgentsApprovalRule(agentsSource)) {
    failures.push(`AGENTS.md beklenen onay kuralını birebir satır olarak içermeli: ${requiredAgentsApprovalLine}`);
  }
  for (const invalidApprovalSource of [
    "- Unrelated actions require explicit user approval.",
    "- Deploys, provider actions, secret/config changes, DB/data mutations, and mutating smokes do not require explicit user approval.",
  ]) {
    if (hasRequiredAgentsApprovalRule(invalidApprovalSource)) {
      failures.push(`AGENTS.md onay kuralı negatif kontrolü yanlış eşleşti: ${invalidApprovalSource}`);
    }
  }

  const architectureSource = readFileSync("docs/codex-agent-architecture.md", "utf8");
  for (const token of [
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    "network_access = false",
    "max_concurrent_threads_per_session = 3",
    "max_depth = 1",
    "limits subagents and excludes the main agent",
    "at most three subagents",
    "at most two read-only subagents",
    "sole scope and integration owner",
    "one write-capable participant",
    "pnpm agents:generate",
    "scripts/generate-agent-adapters.mjs",
  ]) {
    if (!architectureSource.includes(token)) {
      failures.push(`docs/codex-agent-architecture.md beklenen yönetişim sözleşmesini içermeli: ${token}`);
    }
  }
}

function hasRequiredAgentsApprovalRule(source) {
  return source.split(/\r?\n/).includes(requiredAgentsApprovalLine);
}

function checkSkills() {
  for (const [name, contract] of requiredSkills) {
    const skillDir = join(".agents/skills", name);
    const skillPath = join(skillDir, "SKILL.md");
    const openaiYamlPath = join(skillDir, "agents/openai.yaml");

    if (!existsSync(skillPath)) {
      failures.push(`${name} SKILL.md eksik.`);
      continue;
    }
    const source = readFileSync(skillPath, "utf8");
    checkSkillFile(skillPath, name, source);
    if (source.includes("[TODO")) failures.push(`${skillPath} TODO placeholder içermemeli.`);
    for (const token of contract.tokens) {
      if (!source.includes(token)) failures.push(`${skillPath} beklenen workflow token'ını içermeli: ${token}`);
    }
    if (/\b1-4 agents\b/i.test(source)) failures.push(`${skillPath} 'at most three subagents' kuralıyla çelişen '1-4 agents' ifadesini içermemeli.`);

    if (!existsSync(openaiYamlPath)) {
      failures.push(`${openaiYamlPath} eksik.`);
      continue;
    }
    const yaml = readFileSync(openaiYamlPath, "utf8");
    for (const token of ["interface:", "display_name:", "short_description:", "default_prompt:"]) {
      if (!yaml.includes(token)) failures.push(`${openaiYamlPath} ${token} içermeli.`);
    }
    if (!yaml.includes(`$${name}`)) failures.push(`${openaiYamlPath} default_prompt $${name} içermeli.`);
  }

  const orchestrationPath = ".agents/skills/o-okul-agent-orchestration/SKILL.md";
  checkSkillFile(orchestrationPath, "o-okul-agent-orchestration", readFileSync(orchestrationPath, "utf8"));
}

function checkSkillFile(skillPath, expectedName, source) {
  const frontmatter = parseFrontmatter(source, skillPath);
  if (frontmatter.name !== expectedName) failures.push(`${skillPath} name '${expectedName}' olmalı (klasör adıyla aynı).`);
  if (frontmatter.name && (!skillNamePattern.test(frontmatter.name) || frontmatter.name.length > skillNameMaxLength)) {
    failures.push(`${skillPath} name Agent Skills spec'ine uymalı: küçük harf, rakam, tek tire, en çok ${skillNameMaxLength} karakter.`);
  }
  if (!frontmatter.description || frontmatter.description.includes("TODO")) {
    failures.push(`${skillPath} description tamamlanmış olmalı.`);
  } else if (frontmatter.description.length > skillDescriptionMaxLength) {
    failures.push(`${skillPath} description ${skillDescriptionMaxLength} karakteri aşmamalı (Agent Skills spec).`);
  }
  const lineCount = source.split(/\r?\n/).length;
  if (lineCount > skillMaxLines) failures.push(`${skillPath} ${skillMaxLines} satırı aşmamalı; ayrıntıyı references/ altına taşıyın.`);
}

function checkOrchestrationRouter() {
  const source = readFileSync(".agents/skills/o-okul-agent-orchestration/SKILL.md", "utf8");
  for (const skillName of requiredSkills.keys()) {
    if (!source.includes(skillName)) failures.push(`o-okul-agent-orchestration ${skillName} rotasını içermeli.`);
  }
  for (const token of [
    "max_concurrent_threads_per_session = 3",
    "excludes the main agent",
    "at most three subagents",
    "Use no more than three subagents total.",
    "If one subagent writes, at most two read-only subagents may remain.",
    "Each active gate may have only one write-capable participant.",
    "If the main agent writes, every subagent must remain read-only.",
    "If a subagent writes, the main agent may change files only for integration.",
    "owned paths and forbidden paths",
    "pnpm agents:generate",
  ]) {
    if (!source.includes(token)) failures.push(`o-okul-agent-orchestration beklenen kuralı içermeli: ${token}`);
  }
  for (const legacyToken of ["1-4 agents", "one write-capable agent per file area", "max_threads"]) {
    if (source.toLowerCase().includes(legacyToken)) {
      failures.push(`o-okul-agent-orchestration eski ve çelişkili kuralı içermemeli: ${legacyToken}`);
    }
  }
}

function checkAgents() {
  const files = listCodexAgentFiles();
  const names = [];
  if (files.length !== expectedAgentCount) failures.push(`Beklenen ${expectedAgentCount} Codex agent dosyası var; bulunan: ${files.length}.`);

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    let agent;
    try {
      agent = parseAgentToml(source, file);
    } catch (error) {
      failures.push(error.message);
      continue;
    }
    const { name, description, sandbox_mode: sandboxMode, developer_instructions: instructions } = agent;
    const filenameStem = basename(file, ".toml").replaceAll("-", "_");

    if (!name) failures.push(`${file} name içermeli.`);
    if (!description) failures.push(`${file} description içermeli.`);
    if (!instructions) failures.push(`${file} developer_instructions içermeli.`);
    if (name && name !== filenameStem) failures.push(`${file} adı name alanıyla uyumlu olmalı (${filenameStem}).`);
    if (name) names.push(name);
    if (agent.model_reasoning_effort && !["minimal", "low", "medium", "high", "xhigh"].includes(agent.model_reasoning_effort)) {
      failures.push(`${file} model_reasoning_effort geçerli bir değer olmalı.`);
    }

    if (sandboxMode === "read-only") {
      for (const token of ["Stay read-only", "Return"]) {
        if (!source.includes(token)) failures.push(`${file} read-only agent standard token'ı içermeli: ${token}`);
      }
      if (!/(Primary|Responsibilities|Review priorities|Recommended checks)/.test(source)) {
        failures.push(`${file} read-only agent inceleme sorumluluğu tanımlamalı.`);
      }
    } else if (sandboxMode === "workspace-write") {
      for (const token of ["If no write scope is given", "Default ownership", "Useful gates", "Final response"]) {
        if (!source.includes(token)) failures.push(`${file} write agent standard token'ı içermeli: ${token}`);
      }
    } else {
      failures.push(`${file} sandbox_mode read-only veya workspace-write olmalı.`);
    }

    if (instructions) {
      checkOwnershipPaths(file, instructions);
      checkGateCommands(file, instructions);
    }
  }
  return names;
}

function checkOwnershipPaths(file, instructions) {
  for (const heading of ["Default ownership:", "Primary ownership to inspect:"]) {
    for (const bullet of sectionBullets(instructions, heading)) {
      const path = bullet.split(/\s+/)[0];
      if (!path || !/^[A-Za-z0-9_./()*{},-]+$/.test(path)) {
        failures.push(`${file} sahiplik satırı bir yol ile başlamalı: ${bullet}`);
        continue;
      }
      counters.ownershipPaths += 1;
      if (!pathExists(path)) failures.push(`${file} sahiplik yolu repoda bulunamadı: ${path}`);
    }
  }
}

function checkGateCommands(file, instructions) {
  for (const bullet of sectionBullets(instructions, "Useful gates:")) {
    if (!bullet.startsWith("pnpm ")) {
      failures.push(`${file} gate satırı 'pnpm' ile başlamalı: ${bullet}`);
      continue;
    }
    const tokens = bullet.split(/\s+/);
    counters.gateCommands += 1;
    if (tokens[1] === "--filter") {
      const packageName = tokens[2];
      const command = tokens[3];
      const scripts = workspaceScripts.get(packageName);
      if (!scripts) {
        failures.push(`${file} gate komutu bilinmeyen workspace paketi kullanıyor: ${packageName}`);
      } else if (command !== "exec" && !scripts.has(command)) {
        failures.push(`${file} gate komutu ${packageName} içinde olmayan script kullanıyor: ${command}`);
      }
      continue;
    }
    if (!rootScripts.has(tokens[1])) failures.push(`${file} gate komutu package.json'da yok: pnpm ${tokens[1]}`);
  }
}

function sectionBullets(source, heading) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return [];
  const bullets = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") break;
    const match = line.match(/^- (.+)$/);
    if (match) bullets.push(match[1].trim());
  }
  return bullets;
}

function checkRosterParity(agentNames) {
  const source = readFileSync("AGENTS.md", "utf8");
  const rosterStart = source.indexOf("## Agent Roster");
  const rosterEnd = source.indexOf("\n## ", rosterStart + 1);
  const roster = rosterStart < 0 ? "" : source.slice(rosterStart, rosterEnd < 0 ? undefined : rosterEnd);
  const listed = new Set([...roster.matchAll(/^- `([a-z_]+)`:/gm)].map((match) => match[1]));
  for (const name of agentNames) {
    if (!listed.has(name)) failures.push(`AGENTS.md Agent Roster '${name}' agent'ını listelemeli.`);
  }
  for (const name of listed) {
    if (!agentNames.includes(name)) failures.push(`AGENTS.md Agent Roster .codex/agents içinde olmayan '${name}' agent'ını listeliyor.`);
  }
  const orchestration = readFileSync(".agents/skills/o-okul-agent-orchestration/SKILL.md", "utf8");
  for (const name of agentNames) {
    if (!orchestration.includes(`\`${name}\``)) failures.push(`o-okul-agent-orchestration '${name}' için rota içermeli.`);
  }
}

function checkGeneratedAdapters() {
  try {
    failures.push(...checkAdapters());
  } catch (error) {
    failures.push(`Adapter üretimi başarısız: ${error.message}`);
  }
}

function checkCursorSurface() {
  const cursorSkillsDir = ".cursor/skills";
  if (!existsSync(cursorSkillsDir)) return;
  for (const entry of readdirSync(cursorSkillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(cursorSkillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) {
      failures.push(`${join(cursorSkillsDir, entry.name)} SKILL.md içermeli.`);
      continue;
    }
    const source = readFileSync(skillPath, "utf8");
    checkSkillFile(skillPath, entry.name, source);
    if (requiredSkills.has(entry.name) || entry.name === "o-okul-agent-orchestration") {
      failures.push(`${skillPath} repo skill kopyası olmamalı; Cursor .agents/skills dizinini doğrudan okur.`);
    }
  }
  for (const file of walkFiles(".cursor")) {
    if (file.includes("/__pycache__/") || file.endsWith(".pyc")) {
      failures.push(`.cursor altında derlenmiş Python artefaktı bulunmamalı: ${file}`);
    }
  }
}

function checkTriggerScenarios() {
  const scenarios = [
    ["Uygulamayı analiz et ve production v1 planı çıkar.", "o-okul-planning"],
    ["Modernizasyonu fazlara böl ve en küçük güvenli ilk PR'ı seç.", "o-okul-planning"],
    ["Fiyat sayfası için plan çıkar.", "o-okul-planning"],
    ["Planlanan auth fix dilimini implement et.", "o-okul-implementation-slice"],
    ["Bu evidence checker değişikliğini uygula ve test et.", "o-okul-implementation-slice"],
    ["KV-8 dilimini uygula.", "o-okul-implementation-slice"],
    ["main ile senkron mu, çalışan image tagini kontrol et.", "o-okul-release-evidence"],
    ["Staging deploy yeşil ama canlı sürüm doğru mu?", "o-okul-release-evidence"],
    ["Bu branch'i PR gibi review et.", "o-okul-pr-review"],
    ["Working tree diff için P0/P1 bulgu ara.", "o-okul-pr-review"],
  ];

  for (const [prompt, expected] of scenarios) {
    const actual = routePrompt(prompt);
    if (actual !== expected) failures.push(`Trigger senaryosu yanlış rota: '${prompt}' -> ${actual}; beklenen ${expected}.`);
  }
}

function routePrompt(prompt) {
  const value = prompt.toLowerCase();
  if (/(review|pr gibi|branch|commit|diff|working tree|p0\/p1)/.test(value)) return "o-okul-pr-review";
  if (/(deploy|staging|production evidence|main ile senkron|image tag|canlı sürüm|canli surum)/.test(value)) {
    return "o-okul-release-evidence";
  }
  if (/(analiz|production v1|modernizasyon|fazlara|ilk pr|roadmap|\bplanla\b|\bplan\b|\bplanı\b|\bplani\b)/.test(value)) {
    return "o-okul-planning";
  }
  if (/(implement|fix|inşa et|insa et|\buygula|tamamla|test et|checker değişikliğini|checker degisikligini)/.test(value)) {
    return "o-okul-implementation-slice";
  }
  return "o-okul-agent-orchestration";
}

function parseFrontmatter(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    failures.push(`${file} YAML frontmatter içermeli.`);
    return {};
  }
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (!field) continue;
    fields[field[1]] = field[2].replace(/^["']|["']$/g, "");
  }
  return fields;
}

function pathExists(path) {
  if (!/[*?{]/.test(path)) return existsSync(path);
  const pattern = globToRegExp(path);
  return repoFiles.some((file) => pattern.test(file));
}

function globToRegExp(glob) {
  let expression = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        if (glob[index + 2] === "/") {
          expression += "(?:.*/)?";
          index += 2;
        } else {
          expression += ".*";
          index += 1;
        }
      } else {
        expression += "[^/]*";
      }
    } else if (char === "?") {
      expression += "[^/]";
    } else if (char === "{") {
      const end = glob.indexOf("}", index);
      const alternatives = glob
        .slice(index + 1, end)
        .split(",")
        .map((item) => escapeRegExp(item.trim()));
      expression += `(?:${alternatives.join("|")})`;
      index = end;
    } else {
      expression += escapeRegExp(char);
    }
  }
  return new RegExp(`${expression}$`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listRepoFiles() {
  try {
    const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const files = output.split("\n").filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // Fall through to the filesystem walk when git is unavailable.
  }
  return walkFiles(".");
}

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = current === "." ? entry.name : join(current, entry.name);
      if (entry.isDirectory()) {
        if (!walkIgnoredDirs.has(entry.name)) stack.push(path);
      } else {
        files.push(path);
      }
    }
  }
  return files;
}

function loadWorkspaceScripts() {
  const scripts = new Map();
  for (const group of ["apps", "packages"]) {
    if (!existsSync(group)) continue;
    for (const entry of readdirSync(group, { withFileTypes: true })) {
      const packagePath = join(group, entry.name, "package.json");
      if (!entry.isDirectory() || !existsSync(packagePath) || !statSync(packagePath).isFile()) continue;
      const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
      if (manifest.name) scripts.set(manifest.name, new Set(Object.keys(manifest.scripts ?? {})));
    }
  }
  return scripts;
}
