import { pathToFileURL } from "node:url";
import pg from "pg";

// Her API oturumu (AuthService.issueTokenPairForUser) aynı akışta auth.* audit kaydı yazar.
// Oturum audit'ten belirgin biçimde yeniyse audit yazımı sessizce kayboluyordur.
// RLS canlı kontrolünün doğrudan SQL ile tohumladığı fixture oturumları API'den geçmez; hariç tutulur.
const FIXTURE_TENANT_SLUG_PATTERN = "rls-tenant-%";

export function evaluateAuditLogFreshness({ lastSessionAt, lastAuditAt, graceMinutes }) {
  if (!lastSessionAt) return { result: "PASS", reason: "API oturumu yok" };
  if (!lastAuditAt) return { result: "FAIL", reason: "API oturumu var ama hiç audit kaydı yok" };
  const lagMinutes = (lastSessionAt.getTime() - lastAuditAt.getTime()) / 60_000;
  return lagMinutes > graceMinutes
    ? { result: "FAIL", reason: `son API oturumu son audit kaydından ${Math.round(lagMinutes)} dk yeni (tolerans ${graceMinutes} dk)` }
    : { result: "PASS", reason: "son API oturumu audit kaydıyla eşleşiyor" };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL zorunlu.");
  const graceMinutes = Number(process.env.AUDIT_LOG_FRESHNESS_GRACE_MINUTES ?? 15);
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
    throw new Error("AUDIT_LOG_FRESHNESS_GRACE_MINUTES negatif olmayan sayı olmalı.");
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const { rows: [row] } = await client.query(
      `SELECT
         (SELECT max(s."createdAt") FROM "AuthSession" s JOIN "Tenant" t ON t.id = s."tenantId"
           WHERE t.slug NOT LIKE $1) AS "lastSessionAt",
         (SELECT max("createdAt") FROM "AuditLog" WHERE action LIKE 'auth.%') AS "lastAuditAt"`,
      [FIXTURE_TENANT_SLUG_PATTERN],
    );
    await client.query("ROLLBACK");

    const outcome = evaluateAuditLogFreshness({ ...row, graceMinutes });
    console.log(JSON.stringify({
      check: "audit_log_freshness",
      ...outcome,
      lastSessionAt: row.lastSessionAt?.toISOString() ?? null,
      lastAuditAt: row.lastAuditAt?.toISOString() ?? null,
      checkedAt: new Date().toISOString(),
    }));
    if (outcome.result !== "PASS") process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
