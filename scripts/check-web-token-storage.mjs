import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/web/src", "apps/web/app", "apps/web/e2e-next"];
const storageReference = /\b(?:window\.)?(localStorage|sessionStorage)\b/g;
const allowedLocalStorageCall =
  /\b(?:window\.)?localStorage\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*([^,\n)]+)/g;
const allowedLocalStorageKeys = {
  "apps/web/app/(auth)/login/page.tsx": {
    rememberedEmailStorageKey: "des.rememberedLoginEmail",
  },
  "apps/web/app/(app)/app-shell.tsx": {
    sidebarGroupStorageKey: "des.sidebar.expandedGroups.v2",
  },
};
const allowedStorageSnippets = {
  "apps/web/app/(app)/kurum/kurulum/setup-wizard.tsx": [
    "window.sessionStorage.removeItem(draftStorageKey)",
    "window.sessionStorage.getItem(key)",
    "window.sessionStorage.setItem(key, JSON.stringify(draft))",
  ],
  "apps/web/app/(app)/portals/_shared/portal-shell.tsx": [
    "window.sessionStorage.setItem(rolePreviewTokenStorageKey, token)",
    "window.sessionStorage.getItem(rolePreviewTokenStorageKey)",
  ],
  "apps/web/e2e-next/role-preview-contract-next.spec.ts": [
    'window.sessionStorage.setItem("uzman-hocam.role-preview-token", "preview-token-student")',
    "localStorage:",
    "localStorage.length",
    "localStorage.key(index)",
    "localStorage.getItem(key)",
    "sessionStorage:",
    "sessionStorage.length",
    "sessionStorage.key(index)",
    "sessionStorage.getItem(key)",
  ],
  "apps/web/e2e-next/setup-wizard-contract-next.spec.ts": [
    'window.sessionStorage.getItem("uh_onboarding_tenant-setup_draft")',
    "Object.keys(window.sessionStorage)",
    "window.sessionStorage.clear()",
  ],
  "apps/web/e2e-next/student-guardian-portal-contract-next.spec.ts": [
    'window.sessionStorage.setItem("uzman-hocam.role-preview-token", "preview-token-student")',
    'window.sessionStorage.setItem("uzman-hocam.role-preview-token", "preview-token-guardian")',
  ],
  "apps/web/e2e-next/teacher-portal-contract-next.spec.ts": [
    'window.sessionStorage.setItem("uzman-hocam.role-preview-token", "preview-token-teacher")',
  ],
};
const failures = [];

for (const root of roots) {
  for (const file of listFiles(root)) {
    const content = readFileSync(file, "utf8");

    const allowedRanges = collectAllowedRanges(file, content);
    for (const match of content.matchAll(storageReference)) {
      const start = match.index ?? 0;
      if (!allowedRanges.some((range) => range.start <= start && start < range.end)) {
        failures.push(`${file}:${lineNumber(content, start)}: izin verilmeyen ${match[1]} kullanımı`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Web token storage kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Web token storage kontrolü geçti: yalnız izinli UI tercih anahtarları storage kullanıyor.");

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [path] : [];
  });
}

function collectAllowedRanges(file, content) {
  const allowedKeys = allowedLocalStorageKeys[file];
  const ranges = collectSnippetRanges(file, content);
  if (!allowedKeys) return ranges;

  const keyDeclarations = Object.entries(allowedKeys).map(([identifier, literal]) => {
    const escapedIdentifier = escapeRegExp(identifier);
    const escapedLiteral = escapeRegExp(literal);
    return new RegExp(`\\bconst\\s+${escapedIdentifier}\\s*=\\s*["']${escapedLiteral}["']`);
  });
  for (const declaration of keyDeclarations) {
    if (!declaration.test(content)) {
      failures.push(`${file}: izinli storage anahtarı beklenen sabit değerle tanımlı değil`);
      return ranges;
    }
  }

  for (const match of content.matchAll(allowedLocalStorageCall)) {
    const keyExpression = (match[2] ?? "").trim();
    if (!Object.hasOwn(allowedKeys, keyExpression)) continue;
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
  }
  return ranges;
}

function collectSnippetRanges(file, content) {
  const snippets = allowedStorageSnippets[file] ?? [];
  const ranges = [];
  for (const snippet of snippets) {
    let start = content.indexOf(snippet);
    if (start === -1) {
      failures.push(`${file}: izinli storage kullanımı beklenen kalıpla bulunamadı: ${snippet}`);
      continue;
    }
    while (start !== -1) {
      ranges.push({ start, end: start + snippet.length });
      start = content.indexOf(snippet, start + snippet.length);
    }
  }
  return ranges;
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
