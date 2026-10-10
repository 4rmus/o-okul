// Verifies the agent/skill/settings governance contract of this repo.
//
// Canonical sources (hand-edited): .claude/agents/*.md, .claude/skills/*/SKILL.md, .claude/settings.json.
// Governance docs: AGENTS.md, docs/agent-architecture.md.
//
// Format references (checked 2026-10-10): Claude Code docs at code.claude.com (memory, sub-agents,
// skills, settings, env-vars, mcp), Cursor docs at cursor.com/docs, and the Agent Skills
// specification at agentskills.io.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const failures = [];
const counters = { ownershipPaths: 0, gateCommands: 0 };

const agentsDir = ".claude/agents";
const skillsDir = ".claude/skills";
const settingsPath = ".claude/settings.json";
const architectureDocPath = "docs/agent-architecture.md";
const mcpJsonPath = ".mcp.json";
const cursorSkillsDir = ".cursor/skills";
const expectedAgentCount = 15;
const expectedConcurrentSubagents = "3";
const expectedSpawnDepth = "1";
const requiredAgentsApprovalLine =
  "- Deploys, provider actions, secret/config changes, DB/data mutations, and mutating smokes require explicit user approval.";
const agentsMdMaxBytes = 32 * 1024;
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const skillNameMaxLength = 64;
const skillDescriptionMaxLength = 1024;
const skillMaxLines = 500;
const generatedMarker = "GENERATED FILE";
const walkIgnoredDirs = new Set(["node_modules", ".git", ".next", ".turbo", "dist", "coverage", ".pnpm-store"]);
const removedSurfaces = [".codex", ".agents"];
const shadowingInstructionFiles = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];
const validEfforts = new Set(["low", "medium", "high", "xhigh", "max"]);
const readOnlyRequiredDisallowedTools = ["Write", "Edit"];

const requiredSkills = new Map([
  [
    "o-okul-planning",
    {
      tokens: ["AGENTS.md", "docs/agent-architecture.md", "smallest safe first PR", "local/static PASS"],
    },
  ],
  [
    "o-okul-implementation-slice",
    {
      tokens: ["single write owner", "forbidden paths", "Changed files", "Unverified surfaces", "pnpm agents:check"],
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
const orchestrationSkill = "o-okul-agent-orchestration";

const repoFiles = listRepoFiles();
const rootScripts = new Set(Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {}));
const workspaceScripts = loadWorkspaceScripts();

checkRemovedSurfaces();
checkSettings();
checkGovernanceContracts();
checkSkills();
checkOrchestrationRouter();
const agentNames = checkAgents();
checkRosterParity(agentNames);
checkMcpJson();
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
    "settings.json subagent sınırları ve 10 trigger senaryosu doğrulandı.",
);

function checkRemovedSurfaces() {
  for (const surface of removedSurfaces) {
    if (existsSync(surface)) {
      failures.push(`${surface}/ yeniden oluşturulmamalı; Cursor için .claude altındaki agent/skill adlarını çiftler (kanonik kaynak .claude).`);
    }
  }
  for (const file of shadowingInstructionFiles) {
    if (existsSync(file)) {
      failures.push(`${file} bulunmamalı; Claude Code bu dosya varken AGENTS.md'yi proje talimatı olarak okumaz.`);
    }
  }
}

function checkSettings() {
  if (!existsSync(settingsPath)) {
    failures.push(`${settingsPath} eksik; subagent sınırları env bloğunda tanımlanmalı.`);
    return;
  }
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    failures.push(`${settingsPath} geçerli JSON olmalı: ${error.message}`);
    return;
  }
  const env = settings.env ?? {};
  if (env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS !== expectedConcurrentSubagents) {
    failures.push(`${settingsPath} env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS="${expectedConcurrentSubagents}" olmalı.`);
  }
  if (env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH !== expectedSpawnDepth) {
    failures.push(`${settingsPath} env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH="${expectedSpawnDepth}" olmalı.`);
  }
  for (const [key, value] of Object.entries(env)) {
    if (/token|secret|password|api_key/i.test(key) || /^(sk-|ghp_|xox)/.test(String(value))) {
      failures.push(`${settingsPath} env bloğu gizli değer taşıyamaz: ${key}`);
    }
  }
}

function checkGovernanceContracts() {
  const agentsSource = readFileSync("AGENTS.md", "utf8");
  if (Buffer.byteLength(agentsSource, "utf8") > agentsMdMaxBytes) {
    failures.push(`AGENTS.md ${agentsMdMaxBytes} baytı aşmamalı; proje talimatı bütçesini korumak için ayrıntıyı .claude/rules veya skill'lere taşıyın.`);
  }
  for (const token of [
    ".claude/agents/*.md",
    ".claude/skills/*/SKILL.md",
    "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=3",
    "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1",
    "the main agent and at most three subagents may participate concurrently.",
    "Use no more than three subagents total.",
    "If one subagent writes, at most two read-only subagents may remain.",
    "Each active gate may have only one write-capable participant.",
    "When a gate completes, report its result and stop; do not automatically continue to the next gate.",
    "LOCAL_STATIC`, `LOCAL_TEST`, `CI`, `STAGING`, `PRODUCTION`, `EXTERNAL_NOT_RUN`, and `UNPROVEN",
    "pnpm agents:check",
  ]) {
    if (!agentsSource.includes(token)) failures.push(`AGENTS.md beklenen yönetişim sözleşmesini içermeli: ${token}`);
  }
  for (const legacyToken of ["max_threads", ".codex/", ".agents/skills", "agents:generate"]) {
    if (agentsSource.includes(legacyToken)) failures.push(`AGENTS.md kaldırılan Codex yüzeyine atıf yapmamalı: ${legacyToken}`);
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

  if (!existsSync(architectureDocPath)) {
    failures.push(`${architectureDocPath} eksik.`);
    return;
  }
  const architectureSource = readFileSync(architectureDocPath, "utf8");
  for (const token of [
    "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS",
    "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH",
    "permissionMode: plan",
    "at most three subagents",
    "at most two read-only subagents",
    "sole scope and integration owner",
    "one write-capable participant",
    "pnpm agents:check",
  ]) {
    if (!architectureSource.includes(token)) {
      failures.push(`${architectureDocPath} beklenen yönetişim sözleşmesini içermeli: ${token}`);
    }
  }
}

function hasRequiredAgentsApprovalRule(source) {
  return source.split(/\r?\n/).includes(requiredAgentsApprovalLine);
}

function checkSkills() {
  for (const [name, contract] of requiredSkills) {
    const skillPath = join(skillsDir, name, "SKILL.md");
    if (!existsSync(skillPath)) {
      failures.push(`${name} SKILL.md eksik.`);
      continue;
    }
    const source = readFileSync(skillPath, "utf8");
    checkSkillFile(skillPath, name, source);
    for (const token of contract.tokens) {
      if (!source.includes(token)) failures.push(`${skillPath} beklenen workflow token'ını içermeli: ${token}`);
    }
    if (/\b1-4 agents\b/i.test(source)) failures.push(`${skillPath} 'at most three subagents' kuralıyla çelişen '1-4 agents' ifadesini içermemeli.`);
  }

  const orchestrationPath = join(skillsDir, orchestrationSkill, "SKILL.md");
  if (!existsSync(orchestrationPath)) {
    failures.push(`${orchestrationPath} eksik.`);
    return;
  }
  checkSkillFile(orchestrationPath, orchestrationSkill, readFileSync(orchestrationPath, "utf8"));

  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (requiredSkills.has(entry.name) || entry.name === orchestrationSkill) continue;
      const extraSkill = join(skillsDir, entry.name, "SKILL.md");
      if (existsSync(extraSkill)) checkSkillFile(extraSkill, entry.name, readFileSync(extraSkill, "utf8"));
    }
  }
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
  if (source.includes("[TODO")) failures.push(`${skillPath} TODO placeholder içermemeli.`);
  if (source.includes(generatedMarker)) failures.push(`${skillPath} üretilmiş dosya işareti taşımamalı; dosya elle düzenlenen kanonik kaynaktır.`);
  const lineCount = source.split(/\r?\n/).length;
  if (lineCount > skillMaxLines) failures.push(`${skillPath} ${skillMaxLines} satırı aşmamalı; ayrıntıyı references/ altına taşıyın.`);
}

function checkOrchestrationRouter() {
  const orchestrationPath = join(skillsDir, orchestrationSkill, "SKILL.md");
  if (!existsSync(orchestrationPath)) return;
  const source = readFileSync(orchestrationPath, "utf8");
  for (const skillName of requiredSkills.keys()) {
    if (!source.includes(skillName)) failures.push(`${orchestrationSkill} ${skillName} rotasını içermeli.`);
  }
  for (const token of [
    "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS",
    "at most three subagents",
    "Use no more than three subagents total.",
    "If one subagent writes, at most two read-only subagents may remain.",
    "Each active gate may have only one write-capable participant.",
    "If the main agent writes, every subagent must remain read-only.",
    "If a subagent writes, the main agent may change files only for integration.",
    "owned paths and forbidden paths",
    "pnpm agents:check",
  ]) {
    if (!source.includes(token)) failures.push(`${orchestrationSkill} beklenen kuralı içermeli: ${token}`);
  }
  for (const legacyToken of ["1-4 agents", "one write-capable agent per file area", "max_threads", "agents:generate"]) {
    if (source.toLowerCase().includes(legacyToken)) {
      failures.push(`${orchestrationSkill} eski ve çelişkili kuralı içermemeli: ${legacyToken}`);
    }
  }
}

function checkAgents() {
  const files = listAgentFiles();
  const names = [];
  if (files.length !== expectedAgentCount) failures.push(`Beklenen ${expectedAgentCount} Claude agent dosyası var; bulunan: ${files.length}.`);

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const frontmatter = parseFrontmatter(source, file);
    const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    const { name, description } = frontmatter;
    const filenameStem = basename(file, ".md").replaceAll("-", "_");

    if (!name) failures.push(`${file} name içermeli.`);
    if (!description) failures.push(`${file} description içermeli.`);
    if (name && name !== filenameStem) failures.push(`${file} adı name alanıyla uyumlu olmalı (${filenameStem}).`);
    if (name && (name.includes(":") || name.startsWith("-") || name.length > 256)) {
      failures.push(`${file} name ':' içeremez, '-' ile başlayamaz ve 256 karakteri aşamaz (Claude Code sub-agents).`);
    }
    if (name) names.push(name);
    if (frontmatter.model && frontmatter.model !== "inherit") {
      failures.push(`${file} model 'inherit' olmalı; model seçimi oturumdan miras alınır.`);
    }
    if (frontmatter.effort && !validEfforts.has(frontmatter.effort)) {
      failures.push(`${file} effort low|medium|high|xhigh|max değerlerinden biri olmalı.`);
    }
    if (source.includes(generatedMarker)) failures.push(`${file} üretilmiş dosya işareti taşımamalı; dosya elle düzenlenen kanonik kaynaktır.`);
    if (body.trim() === "") failures.push(`${file} frontmatter sonrası system prompt gövdesi içermeli.`);

    const readOnly = frontmatter.permissionMode === "plan";
    const disallowedTools = (frontmatter.disallowedTools ?? "").split(",").map((tool) => tool.trim()).filter(Boolean);
    if (readOnly) {
      for (const tool of readOnlyRequiredDisallowedTools) {
        if (!disallowedTools.includes(tool)) failures.push(`${file} read-only agent disallowedTools içinde '${tool}' taşımalı.`);
      }
      for (const token of ["Stay read-only", "Return"]) {
        if (!body.includes(token)) failures.push(`${file} read-only agent standard token'ı içermeli: ${token}`);
      }
      if (!/(Primary|Responsibilities|Review priorities|Recommended checks)/.test(body)) {
        failures.push(`${file} read-only agent inceleme sorumluluğu tanımlamalı.`);
      }
    } else {
      if (frontmatter.permissionMode) failures.push(`${file} write agent permissionMode belirtmemeli ('plan' yalnız read-only agent'lar için).`);
      for (const token of ["If no write scope is given", "Default ownership", "Useful gates", "Final response"]) {
        if (!body.includes(token)) failures.push(`${file} write agent standard token'ı içermeli: ${token}`);
      }
    }

    checkOwnershipPaths(file, body);
    checkGateCommands(file, body);
  }
  return names;
}

function checkOwnershipPaths(file, body) {
  for (const heading of ["Default ownership:", "Primary ownership to inspect:"]) {
    for (const bullet of sectionBullets(body, heading)) {
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

function checkGateCommands(file, body) {
  for (const bullet of sectionBullets(body, "Useful gates:")) {
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
    if (!agentNames.includes(name)) failures.push(`AGENTS.md Agent Roster .claude/agents içinde olmayan '${name}' agent'ını listeliyor.`);
  }
  const orchestrationPath = join(skillsDir, orchestrationSkill, "SKILL.md");
  if (!existsSync(orchestrationPath)) return;
  const orchestration = readFileSync(orchestrationPath, "utf8");
  for (const name of agentNames) {
    if (!orchestration.includes(`\`${name}\``)) failures.push(`${orchestrationSkill} '${name}' için rota içermeli.`);
  }
}

function checkMcpJson() {
  if (!existsSync(mcpJsonPath)) return;
  let config;
  try {
    config = JSON.parse(readFileSync(mcpJsonPath, "utf8"));
  } catch (error) {
    failures.push(`${mcpJsonPath} geçerli JSON olmalı: ${error.message}`);
    return;
  }
  const servers = config.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    failures.push(`${mcpJsonPath} tek bir 'mcpServers' nesnesi içermeli.`);
    return;
  }
  for (const [id, server] of Object.entries(servers)) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) failures.push(`${mcpJsonPath} sunucu adı yalnız harf, rakam, tire ve alt çizgi içerebilir: ${id}`);
    const type = server.type ?? "stdio";
    if (["http", "sse", "ws", "streamable-http"].includes(type)) {
      if (!server.url) failures.push(`${mcpJsonPath} [${id}] url içermeli.`);
      else if (!/^(https:\/\/|wss:\/\/|\$\{)/.test(server.url)) failures.push(`${mcpJsonPath} [${id}] url https veya \${VAR} ile başlamalı.`);
    } else if (type === "stdio") {
      if (!server.command) failures.push(`${mcpJsonPath} [${id}] stdio sunucusu command içermeli.`);
      if (server.url) failures.push(`${mcpJsonPath} [${id}] url verilen sunucu 'type' belirtmeli; type'sız giriş stdio sayılır.`);
    } else {
      failures.push(`${mcpJsonPath} [${id}] type stdio|http|sse|ws olmalı.`);
    }
    for (const value of Object.values(server.headers ?? {})) {
      if (/bearer\s+(?!\$\{)[A-Za-z0-9._-]{12,}/i.test(String(value))) {
        failures.push(`${mcpJsonPath} [${id}] header içinde düz metin token olamaz; \${VAR} kullanın.`);
      }
    }
    for (const value of Object.values(server.env ?? {})) {
      if (/^(sk-|ghp_|xox)/.test(String(value))) failures.push(`${mcpJsonPath} [${id}] env içinde düz metin gizli değer olamaz.`);
    }
  }
}

function checkCursorSurface() {
  if (!existsSync(cursorSkillsDir)) return;
  for (const entry of readdirSync(cursorSkillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(cursorSkillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) {
      failures.push(`${join(cursorSkillsDir, entry.name)} SKILL.md içermeli.`);
      continue;
    }
    checkSkillFile(skillPath, entry.name, readFileSync(skillPath, "utf8"));
    if (requiredSkills.has(entry.name) || entry.name === orchestrationSkill) {
      failures.push(`${skillPath} repo skill kopyası olmamalı; Cursor .claude/skills dizinini doğrudan okur.`);
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
  return orchestrationSkill;
}

function parseFrontmatter(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    failures.push(`${file} YAML frontmatter içermeli ve '---' dosyanın ilk satırı olmalı.`);
    return {};
  }
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!field) continue;
    fields[field[1]] = unquote(field[2]);
  }
  return fields;
}

function unquote(value) {
  const trimmed = value.trim();
  if (/^".*"$/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
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

function listAgentFiles() {
  if (!existsSync(agentsDir)) {
    failures.push(`${agentsDir} dizini eksik.`);
    return [];
  }
  return readdirSync(agentsDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => join(agentsDir, file))
    .sort();
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
