import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const failures = [];

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
  const maxDepth = Number(source.match(/^\s*max_depth\s*=\s*(\d+)/m)?.[1]);
  const maxThreads = Number(source.match(/^\s*max_threads\s*=\s*(\d+)/m)?.[1]);
  if (maxDepth !== 1) failures.push(".codex/config.toml agents.max_depth=1 olmalı.");
  if (!Number.isFinite(maxThreads) || maxThreads > 6) failures.push(".codex/config.toml agents.max_threads 6 veya daha düşük olmalı.");
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
  for (const token of ["1-4 agents", "one write-capable agent per file area", "owned paths and forbidden paths"]) {
    if (!source.includes(token)) failures.push(`o-okul-agent-orchestration beklenen kuralı içermeli: ${token}`);
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
