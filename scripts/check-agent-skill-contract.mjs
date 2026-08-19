import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const failures = [];
const requiredAgentsApprovalLine =
  "- Deploys, provider actions, secret/config changes, DB/data mutations, and mutating smokes require explicit user approval.";

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
      tokens: ["single write owner", "forbidden paths", "Changed files", "Unverified surfaces"],
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

checkConfig();
checkGovernanceContracts();
checkSkills();
checkOrchestrationRouter();
checkAgents();
checkTriggerScenarios();

if (failures.length > 0) {
  console.error("Agent/skill contract kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Agent/skill contract kontrolü geçti: ${requiredSkills.size} skill, ${agentFiles().length} agent, 8 trigger senaryosu doğrulandı.`,
);

function checkConfig() {
  const source = readFileSync(".codex/config.toml", "utf8");
  const configLines = source.split(/\r?\n/);
  const rootEnd = configLines.findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line));
  const rootBlock = configLines.slice(0, rootEnd < 0 ? undefined : rootEnd).join("\n");
  const agentsStart = configLines.findIndex((line) => line.trim() === "[agents]");
  const agentsEnd = configLines.findIndex(
    (line, index) => index > agentsStart && /^\s*\[[^\]]+\]\s*$/.test(line),
  );
  const agentsBlock = agentsStart < 0
    ? ""
    : configLines.slice(agentsStart + 1, agentsEnd < 0 ? undefined : agentsEnd).join("\n");
  const sandboxStart = configLines.findIndex((line) => line.trim() === "[sandbox_workspace_write]");
  const sandboxEnd = configLines.findIndex(
    (line, index) => index > sandboxStart && /^\s*\[[^\]]+\]\s*$/.test(line),
  );
  const sandboxBlock = sandboxStart < 0
    ? ""
    : configLines.slice(sandboxStart + 1, sandboxEnd < 0 ? undefined : sandboxEnd).join("\n");
  const approvalPolicy = rootBlock.match(/^\s*approval_policy\s*=\s*"([^"]+)"/m)?.[1];
  const sandboxMode = rootBlock.match(/^\s*sandbox_mode\s*=\s*"([^"]+)"/m)?.[1];
  const networkAccess = sandboxBlock.match(/^\s*network_access\s*=\s*(true|false)\s*$/m)?.[1];
  const maxDepth = Number(agentsBlock.match(/^\s*max_depth\s*=\s*(\d+)/m)?.[1]);
  const maxThreads = Number(agentsBlock.match(/^\s*max_threads\s*=\s*(\d+)/m)?.[1]);
  if (approvalPolicy !== "on-request") failures.push(".codex/config.toml top-level approval_policy='on-request' olmalı.");
  if (sandboxMode !== "workspace-write") failures.push(".codex/config.toml top-level sandbox_mode='workspace-write' olmalı.");
  if (!sandboxBlock) failures.push(".codex/config.toml [sandbox_workspace_write] tablosu içermeli.");
  if (networkAccess !== "false") failures.push(".codex/config.toml sandbox_workspace_write.network_access=false olmalı.");
  if (!agentsBlock) failures.push(".codex/config.toml [agents] tablosu içermeli.");
  if (maxDepth !== 1) failures.push(".codex/config.toml agents.max_depth=1 olmalı.");
  if (maxThreads !== 3) failures.push(".codex/config.toml agents.max_threads=3 olmalı.");
  if (/^\s*max_concurrent_threads_per_session\s*=/m.test(agentsBlock)) {
    failures.push(".codex/config.toml canonical concurrency anahtarı yerel Codex uyumluluk gate'i kapanmadan kullanılmamalı.");
  }
}

function checkGovernanceContracts() {
  const agentsSource = readFileSync("AGENTS.md", "utf8");
  for (const token of [
    "agents.max_threads = 3",
    "the main agent and at most three subagents may participate concurrently.",
    "Use no more than three subagents total.",
    "If one subagent writes, at most two read-only subagents may remain.",
    "Each active gate may have only one write-capable participant.",
    "When a gate completes, report its result and stop; do not automatically continue to the next gate.",
    "LOCAL_STATIC`, `LOCAL_TEST`, `CI`, `STAGING`, `PRODUCTION`, `EXTERNAL_NOT_RUN`, and `UNPROVEN",
  ]) {
    if (!agentsSource.includes(token)) failures.push(`AGENTS.md beklenen yönetişim sözleşmesini içermeli: ${token}`);
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
    "max_threads = 3",
    "max_depth = 1",
    "limits subagents and excludes the main agent",
    "at most three subagents",
    "at most two read-only subagents",
    "sole scope and integration owner",
    "one write-capable participant",
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
    const frontmatter = parseFrontmatter(source, skillPath);
    if (frontmatter.name !== name) failures.push(`${skillPath} name '${name}' olmalı.`);
    if (!frontmatter.description || frontmatter.description.includes("TODO")) {
      failures.push(`${skillPath} description tamamlanmış olmalı.`);
    }
    if (source.includes("[TODO")) failures.push(`${skillPath} TODO placeholder içermemeli.`);
    for (const token of contract.tokens) {
      if (!source.includes(token)) failures.push(`${skillPath} beklenen workflow token'ını içermeli: ${token}`);
    }

    if (!existsSync(openaiYamlPath)) {
      failures.push(`${openaiYamlPath} eksik.`);
      continue;
    }
    const yaml = readFileSync(openaiYamlPath, "utf8");
    for (const token of ["display_name:", "short_description:", "default_prompt:"]) {
      if (!yaml.includes(token)) failures.push(`${openaiYamlPath} ${token} içermeli.`);
    }
    if (!yaml.includes(`$${name}`)) failures.push(`${openaiYamlPath} default_prompt $${name} içermeli.`);
  }
}

function checkOrchestrationRouter() {
  const source = readFileSync(".agents/skills/o-okul-agent-orchestration/SKILL.md", "utf8");
  for (const skillName of requiredSkills.keys()) {
    if (!source.includes(skillName)) failures.push(`o-okul-agent-orchestration ${skillName} rotasını içermeli.`);
  }
  for (const token of [
    "max_threads = 3",
    "limits subagents and excludes the main agent",
    "at most three subagents",
    "Use no more than three subagents total.",
    "If one subagent writes, at most two read-only subagents may remain.",
    "Each active gate may have only one write-capable participant.",
    "If the main agent writes, every subagent must remain read-only.",
    "If a subagent writes, the main agent may change files only for integration.",
    "owned paths and forbidden paths",
  ]) {
    if (!source.includes(token)) failures.push(`o-okul-agent-orchestration beklenen kuralı içermeli: ${token}`);
  }
  for (const legacyToken of ["1-4 agents", "one write-capable agent per file area"]) {
    if (source.toLowerCase().includes(legacyToken)) {
      failures.push(`o-okul-agent-orchestration eski ve çelişkili kuralı içermemeli: ${legacyToken}`);
    }
  }
}

function checkAgents() {
  const files = agentFiles();
  if (files.length !== 15) failures.push(`Beklenen 15 Codex agent dosyası var; bulunan: ${files.length}.`);

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const name = tomlString(source, "name");
    const description = tomlString(source, "description");
    const sandboxMode = tomlString(source, "sandbox_mode");
    const filenameStem = basename(file, ".toml").replaceAll("-", "_");

    if (!name) failures.push(`${file} name içermeli.`);
    if (!description) failures.push(`${file} description içermeli.`);
    if (!source.includes("developer_instructions")) failures.push(`${file} developer_instructions içermeli.`);
    if (name && name !== filenameStem) failures.push(`${file} adı name alanıyla uyumlu olmalı (${filenameStem}).`);

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
  }
}

function checkTriggerScenarios() {
  const scenarios = [
    ["Uygulamayı analiz et ve production v1 planı çıkar.", "o-okul-planning"],
    ["Modernizasyonu fazlara böl ve en küçük güvenli ilk PR'ı seç.", "o-okul-planning"],
    ["Planlanan auth fix dilimini implement et.", "o-okul-implementation-slice"],
    ["Bu evidence checker değişikliğini uygula ve test et.", "o-okul-implementation-slice"],
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
  if (/(analiz|production v1|modernizasyon|fazlara|ilk pr|roadmap|\bplanla\b|\bplanı\b|\bplani\b)/.test(value)) {
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
    const field = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!field) continue;
    fields[field[1]] = field[2].replace(/^["']|["']$/g, "");
  }
  return fields;
}

function tomlString(source, key) {
  return source.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1] ?? "";
}

function agentFiles() {
  return readdirSync(".codex/agents")
    .filter((file) => file.endsWith(".toml"))
    .map((file) => join(".codex/agents", file))
    .sort();
}
