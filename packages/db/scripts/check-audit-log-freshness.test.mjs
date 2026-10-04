import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuditLogFreshness } from "./check-audit-log-freshness.mjs";

const at = (iso) => new Date(iso);

test("API oturumu yoksa PASS", () => {
  assert.equal(evaluateAuditLogFreshness({ lastSessionAt: null, lastAuditAt: null, graceMinutes: 15 }).result, "PASS");
});

test("oturum audit ile aynı anda ise PASS", () => {
  const outcome = evaluateAuditLogFreshness({
    lastSessionAt: at("2026-09-09T10:36:36Z"),
    lastAuditAt: at("2026-09-09T10:36:37Z"),
    graceMinutes: 15,
  });
  assert.equal(outcome.result, "PASS");
});

test("oturum audit'ten tolerans kadar yeni ise PASS", () => {
  const outcome = evaluateAuditLogFreshness({
    lastSessionAt: at("2026-10-01T12:15:00Z"),
    lastAuditAt: at("2026-10-01T12:00:00Z"),
    graceMinutes: 15,
  });
  assert.equal(outcome.result, "PASS");
});

test("oturum audit'ten toleranstan yeni ise FAIL", () => {
  const outcome = evaluateAuditLogFreshness({
    lastSessionAt: at("2026-10-01T12:03:04Z"),
    lastAuditAt: at("2026-09-09T12:26:12Z"),
    graceMinutes: 15,
  });
  assert.equal(outcome.result, "FAIL");
});

test("oturum var ama audit hiç yoksa FAIL", () => {
  assert.equal(
    evaluateAuditLogFreshness({ lastSessionAt: at("2026-10-01T12:03:04Z"), lastAuditAt: null, graceMinutes: 15 }).result,
    "FAIL",
  );
});
