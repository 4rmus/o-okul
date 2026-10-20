import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Ratchet for the P0 cutover in docs/account-management-architecture-plan.md section 6: legacy @Roles guards
// are being replaced by exact capability + persona + scope checks (@RequireCapability). @Roles still rides on
// roleRank, so a @Roles("TEACHER") route also admits higher-ranked admin roles. New code must not add @Roles;
// when a route family moves to capabilities, lower its count here in the same change.
// Baseline taken on main c619b8f7e (2026-10-15): 154 usages in 22 files (the plan recorded 146 earlier).
// 2026-10-15: teacher-note moved to note:read-assigned / note:write-assigned (154 -> 150, 21 files).
// 2026-10-15: six @Roles that only duplicated an existing @RequireCapability removed (150 -> 144, 19 files);
//   equivalence proof in apps/api/src/rbac/roles-capability-equivalence.test.ts.
// 2026-10-15: school read routes moved to academic:read, class:read and academic:read-catalog (144 -> 127, 12 files).
// 2026-10-16: announcement, message-template, attendance, study-session, development, guardians and teachers moved
//   to capabilities (127 -> 108, 5 files).
// 2026-10-16: POST /privacy/me/purge-pii removed (DEC-20261016-01) (108 -> 107, 4 files).
// 2026-10-16: homework and support-ticket moved to homework:* / support:* capabilities (107 -> 86, 2 files).
// 2026-10-20: me.controller moved to account:self, setup:read, notification:device and portal:student|guardian|teacher;
//   persona portals admit only their own persona (86 -> 7, 1 file; auth MFA routes wait for the platform realm).
const baseline = {
  "apps/api/src/auth/auth.controller.ts": 7,
};

export function countRoles(root = "apps/api/src") {
  const counts = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
        const count = (readFileSync(path, "utf8").match(/@Roles\(/g) ?? []).length;
        if (count) counts[path.split("\\").join("/")] = count;
      }
    }
  };
  walk(root);
  return counts;
}

export function evaluateRoles(counts, expected) {
  const failures = [], lowered = [];
  for (const [file, count] of Object.entries(counts)) {
    const allowed = expected[file] ?? 0;
    if (count > allowed) failures.push(`${file}: ${count} @Roles (taban ${allowed}); yeni route @RequireCapability kullanmalı`);
    else if (count < allowed) lowered.push(`${file}: ${count} < taban ${allowed}`);
  }
  for (const [file, allowed] of Object.entries(expected)) if (!(file in counts)) lowered.push(`${file}: 0 < taban ${allowed}`);
  return { failures, lowered };
}

// Self-test: the ratchet must reject an increase and a new file, and accept the baseline itself.
const selfTest = [
  evaluateRoles(baseline, baseline).failures.length === 0,
  evaluateRoles({ ...baseline, "apps/api/src/search/search.controller.ts": 2 }, baseline).failures.length === 1,
  evaluateRoles({ ...baseline, "apps/api/src/new/new.controller.ts": 1 }, baseline).failures.length === 1,
];
if (selfTest.includes(false)) { console.error("@Roles envanter kontrolü öz testi başarısız"); process.exit(1); }

const counts = countRoles();
const { failures, lowered } = evaluateRoles(counts, baseline);
const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
if (failures.length) {
  console.error(`@Roles envanter kontrolü başarısız (${total} kullanım):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
if (lowered.length) {
  console.error(`@Roles sayısı tabanın altına indi; scripts/check-roles-inventory.mjs tabanını aynı değişiklikte düşürün:\n- ${lowered.join("\n- ")}`);
  process.exit(1);
}
console.log(`@Roles envanter kontrolü geçti: ${total} kullanım, ${Object.keys(counts).length} dosya (artış yok).`);
