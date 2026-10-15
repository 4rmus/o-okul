import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Ratchet for the P0 cutover in docs/account-management-architecture-plan.md section 6: legacy @Roles guards
// are being replaced by exact capability + persona + scope checks (@RequireCapability). @Roles still rides on
// roleRank, so a @Roles("TEACHER") route also admits higher-ranked admin roles. New code must not add @Roles;
// when a route family moves to capabilities, lower its count here in the same change.
// Baseline taken on main c619b8f7e (2026-10-15): 154 usages in 22 files (the plan recorded 146 earlier).
const baseline = {
  "apps/api/src/announcement/announcement.controller.ts": 2,
  "apps/api/src/attendance/attendance.controller.ts": 4,
  "apps/api/src/auth/auth.controller.ts": 7,
  "apps/api/src/development/development.controller.ts": 3,
  "apps/api/src/guardian-notification/guardian-notification-settings.controller.ts": 2,
  "apps/api/src/guardian/guardians.controller.ts": 3,
  "apps/api/src/homework/homework.controller.ts": 13,
  "apps/api/src/me/me.controller.ts": 81,
  "apps/api/src/message-template/message-template.controller.ts": 2,
  "apps/api/src/privacy/privacy.controller.ts": 2,
  "apps/api/src/program/study-session.controller.ts": 2,
  "apps/api/src/school/academic-calendar.controller.ts": 4,
  "apps/api/src/school/alanlar.controller.ts": 2,
  "apps/api/src/school/campuses.controller.ts": 2,
  "apps/api/src/school/classes.controller.ts": 2,
  "apps/api/src/school/courses.controller.ts": 2,
  "apps/api/src/school/grade-levels.controller.ts": 3,
  "apps/api/src/school/learning-outcomes.controller.ts": 2,
  "apps/api/src/search/search.controller.ts": 1,
  "apps/api/src/support-ticket/support-ticket.controller.ts": 8,
  "apps/api/src/teacher-note/teacher-note.controller.ts": 4,
  "apps/api/src/teacher/teachers.controller.ts": 3,
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
