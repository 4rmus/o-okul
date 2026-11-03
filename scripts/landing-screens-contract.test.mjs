// Contract tests for the landing screenshot pipeline (DEC-20261102-08, seventh bullet).
// They pin the local-only, provider-off, no-publication guards; the pipeline itself needs a local stack and is run
// by hand (docs/landing-screens-runbook.md).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LANDING_SCREENS,
  LANDING_SCREENS_DATASET_FILES,
  LANDING_SCREENS_FORBIDDEN_ROUTE_PREFIXES,
  LANDING_SCREENS_VIEWPORTS,
  assertDisposableDatabaseUrl,
  assertLoopbackUrl,
  assertProvidersDisabled,
  buildProvenanceManifest,
  findEnabledProviderEnv,
  previousSchoolDays,
  resolveOutputDir,
  schoolCalendar,
  sha256Hex,
  verifyDataset,
} from "./landing-screens-contract.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pipelineSource = readFileSync(join(repoRoot, "scripts", "landing-screens.mjs"), "utf8");

test("only the agreed screens are captured, never a guardian portal or finance screen", () => {
  assert.deepEqual(LANDING_SCREENS.map((screen) => screen.id), [
    "admin-student-360",
    "teacher-today",
    "teacher-roll-call",
    "teacher-grade-grid",
    "student-gelisimim",
  ]);
  assert.ok(LANDING_SCREENS.every((screen) => ["admin", "teacher", "student"].includes(screen.role)));
  assert.deepEqual(LANDING_SCREENS_VIEWPORTS.map((viewport) => viewport.id), ["desktop-1440", "tablet-834", "mobile-390"]);
  assert.ok(LANDING_SCREENS_FORBIDDEN_ROUTE_PREFIXES.includes("/veli"));
  assert.ok(LANDING_SCREENS_FORBIDDEN_ROUTE_PREFIXES.includes("/kurum/finans"));
});

test("the database must be local and disposable", () => {
  assert.equal(assertDisposableDatabaseUrl("postgresql://app:app@127.0.0.1:55432/o_okul_shots_test", "db").databaseName, "o_okul_shots_test");
  assert.equal(assertDisposableDatabaseUrl("postgresql://app:app@localhost:5433/o_okul_landing", "db").databaseName, "o_okul_landing");
  assert.throws(() => assertDisposableDatabaseUrl("postgresql://app:app@127.0.0.1:5432/o_okul", "db"), /DATABASE_NOT_DISPOSABLE/);
  assert.throws(() => assertDisposableDatabaseUrl("postgresql://app:app@db.staging.example.com:5432/o_okul_test", "db"), /URL_NOT_LOCAL/);
  assert.throws(() => assertDisposableDatabaseUrl("redis://127.0.0.1:6379/o_okul_test", "db"), /DATABASE_URL_PROTOCOL/);
});

test("every other service URL must be loopback", () => {
  assert.equal(assertLoopbackUrl("redis://127.0.0.1:16379/0", "redis").port, "16379");
  assert.throws(() => assertLoopbackUrl("https://staging.o-okul.example/api", "api"), /URL_NOT_LOCAL/);
  assert.throws(() => assertLoopbackUrl("not a url", "api"), /URL_INVALID/);
});

test("SMS and notification providers stay off", () => {
  assert.deepEqual(findEnabledProviderEnv({ PATH: "/usr/bin", SMS_ENABLED: "false" }), []);
  assert.doesNotThrow(() => assertProvidersDisabled({ NODE_ENV: "development" }));
  assert.throws(() => assertProvidersDisabled({ SMS_PROVIDER: "netgsm" }), /PROVIDER_ENV_SET:SMS_PROVIDER/);
  assert.throws(() => assertProvidersDisabled({ NOTIFICATION_HTTP_ENDPOINT: "http://127.0.0.1:1" }), /NOTIFICATION_HTTP_ENDPOINT/);
  assert.throws(() => assertProvidersDisabled({ SMS_ENABLED: "true" }), /SMS_ENABLED/);
  assert.throws(() => assertProvidersDisabled({ NODE_ENV: "production" }), /NODE_ENV_NOT_LOCAL/);
  // Children get an explicit env with SMS off; no SMS, announcement or secret-delivery worker is ever started.
  assert.match(pipelineSource, /SMS_ENABLED: "false"/);
  assert.doesNotMatch(pipelineSource, /create(?:SmsBatch|AnnouncementDelivery|BackupRestore)BullWorker/);
  assert.doesNotMatch(pipelineSource, /createSecretDelivery\w*/);
  // Only the four exam-path worker factories may appear.
  const factories = new Set(pipelineSource.match(/create\w+BullWorker/g) ?? []);
  assert.deepEqual([...factories].sort(), [
    "createExamEvaluationBullWorker",
    "createExcelImportBullWorker",
    "createReportGenerationBullWorker",
    "createReportPdfRenderBullWorker",
  ]);
});

test("output stays outside apps/web/public and inside a gitignored directory", () => {
  const runId = "2026-11-03-abcdef12";
  assert.equal(resolveOutputDir(repoRoot, undefined, runId), join(repoRoot, "artifacts", "landing-screens", runId));
  assert.throws(() => resolveOutputDir(repoRoot, "apps/web/public", runId), /OUTPUT_IN_PUBLIC/);
  assert.throws(() => resolveOutputDir(repoRoot, "apps/web/public/landing", runId), /OUTPUT_IN_PUBLIC/);
  assert.throws(() => resolveOutputDir(repoRoot, "docs/landing", runId), /OUTPUT_NOT_GITIGNORED/);
  const outside = join(tmpdir(), "landing-screens-out");
  assert.equal(resolveOutputDir(repoRoot, outside, runId), join(outside, runId));
  const gitignore = readFileSync(join(repoRoot, ".gitignore"), "utf8").split("\n").map((line) => line.trim());
  assert.ok(gitignore.includes("artifacts/"), ".gitignore must keep artifacts/ out of the repository");
});

test("a symlinked output path cannot land files in apps/web/public or a tracked folder", () => {
  const runId = "2026-11-03-abcdef12";
  const root = mkdtempSync(join(tmpdir(), "landing-screens-symlink-"));
  try {
    const repo = join(root, "repo");
    const publicDir = join(repo, "apps", "web", "public");
    mkdirSync(publicDir, { recursive: true });
    mkdirSync(join(repo, "docs"), { recursive: true });

    // artifacts -> apps/web/public: the default output and any path under artifacts resolve into public.
    symlinkSync(publicDir, join(repo, "artifacts"), "dir");
    assert.throws(() => resolveOutputDir(repo, undefined, runId), /OUTPUT_IN_PUBLIC/);
    assert.throws(() => resolveOutputDir(repo, "artifacts/landing-screens/nested", runId), /OUTPUT_IN_PUBLIC/);
    rmSync(join(repo, "artifacts"));

    // An outside directory that links into public is refused too.
    const outsideLink = join(root, "outside-link");
    symlinkSync(join(publicDir, "landing"), outsideLink, "dir");
    mkdirSync(join(publicDir, "landing"));
    assert.throws(() => resolveOutputDir(repo, outsideLink, runId), /OUTPUT_IN_PUBLIC/);

    // artifacts/landing-screens -> docs: inside the repository but not in the ignored artifacts/ folder.
    mkdirSync(join(repo, "artifacts"));
    symlinkSync(join(repo, "docs"), join(repo, "artifacts", "landing-screens"), "dir");
    assert.throws(() => resolveOutputDir(repo, undefined, runId), /OUTPUT_NOT_GITIGNORED/);
    rmSync(join(repo, "artifacts", "landing-screens"));

    // A dangling symlink cannot be resolved and is refused instead of guessed.
    symlinkSync(join(publicDir, "missing"), join(repo, "artifacts", "landing-screens"), "dir");
    assert.throws(() => resolveOutputDir(repo, undefined, runId), /OUTPUT_UNRESOLVED/);
    rmSync(join(repo, "artifacts", "landing-screens"));

    // A symlink to a directory outside the repository and outside public stays allowed.
    const captures = join(root, "captures");
    mkdirSync(captures);
    symlinkSync(captures, join(repo, "artifacts", "landing-screens"), "dir");
    assert.equal(resolveOutputDir(repo, undefined, runId), join(repo, "artifacts", "landing-screens", runId));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("dataset files are checked against the sentetik-v1 manifest before anything runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "landing-screens-dataset-"));
  try {
    const students = Buffer.from("students");
    const teachers = Buffer.from("teachers");
    writeFileSync(join(dir, LANDING_SCREENS_DATASET_FILES.students), students);
    writeFileSync(join(dir, LANDING_SCREENS_DATASET_FILES.teachers), teachers);
    const manifest = {
      version: 1,
      deterministic: true,
      files: [
        { name: LANDING_SCREENS_DATASET_FILES.students, sha256: sha256Hex(students) },
        { name: LANDING_SCREENS_DATASET_FILES.teachers, sha256: sha256Hex(teachers) },
      ],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    const verified = verifyDataset(dir);
    assert.equal(verified.id, "sentetik-v1");
    assert.deepEqual(verified.files.map((file) => file.name), [LANDING_SCREENS_DATASET_FILES.students, LANDING_SCREENS_DATASET_FILES.teachers]);
    // Exam files are required only for --with-exams and must be pinned too.
    assert.throws(() => verifyDataset(dir, { withExams: true }), /FILE_NOT_PINNED/);
    writeFileSync(join(dir, LANDING_SCREENS_DATASET_FILES.teachers), "edited");
    assert.throws(() => verifyDataset(dir), /HASH_MISMATCH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("school calendar puts today in an active term and history on past weekdays", () => {
  const autumn = schoolCalendar("2026-11-03");
  assert.equal(autumn.year.name, "2026-2027");
  assert.equal(autumn.activeTerm.key, "term-1");
  assert.equal(schoolCalendar("2027-03-01").activeTerm.key, "term-2");
  const days = previousSchoolDays("2026-11-03", 3);
  assert.deepEqual(days, ["2026-11-02", "2026-10-30", "2026-10-29"]);
  assert.deepEqual(previousSchoolDays("2026-09-02", 5, "2026-09-01"), ["2026-09-01"]);
});

test("provenance manifest records dataset, commit and viewport and starts unreviewed and unpublished", () => {
  const screen = {
    id: "teacher-today",
    title: "Öğretmen Bugün",
    role: "teacher",
    route: "/ogretmen",
    viewport: LANDING_SCREENS_VIEWPORTS[0],
    file: "teacher-today--desktop-1440.png",
    bytes: 10,
    sha256: "a".repeat(64),
    status: "CAPTURED",
  };
  const manifest = buildProvenanceManifest({
    capturedAt: "2026-11-03T06:00:00.000Z",
    commit: { sha: "ebfd9f182", dirtyFileCount: 0 },
    dataset: { id: "sentetik-v1", manifestSha256: "b".repeat(64), files: [] },
    examsLoaded: false,
    gaps: ["EXAM_PIPELINE_NOT_RUN"],
    runId: "2026-11-03-abcdef12",
    screens: [screen],
    tool: { node: "v24" },
  });
  assert.equal(manifest.decision, "DEC-20261102-08");
  assert.equal(manifest.evidenceClass, "LOCAL_TEST");
  assert.equal(manifest.theme, "light");
  assert.equal(manifest.dataset.id, "sentetik-v1");
  assert.equal(manifest.source.commit, "ebfd9f182");
  assert.equal(manifest.source.examPipeline, "NOT_RUN");
  assert.equal(manifest.source.queue, "NONE: grade publish skipped");
  assert.equal(manifest.capturedAt, "2026-11-03T06:00:00.000Z");
  assert.equal(manifest.review.status, "PENDING_HUMAN_PII_REVIEW");
  assert.equal(manifest.review.reviewer, null);
  assert.equal(manifest.publication.status, "NOT_APPROVED");
  assert.throws(() => buildProvenanceManifest({ ...manifestInput(), screens: [{ ...screen, route: "/veli" }] }), /FORBIDDEN_ROUTE/);
  assert.throws(() => buildProvenanceManifest({ ...manifestInput(), screens: [{ ...screen, route: "/kurum/finans/tahsilat" }] }), /FORBIDDEN_ROUTE/);
});

function manifestInput() {
  return {
    capturedAt: "2026-11-03T06:00:00.000Z",
    commit: { sha: "x", dirtyFileCount: 0 },
    dataset: { id: "sentetik-v1", manifestSha256: "", files: [] },
    examsLoaded: false,
    gaps: [],
    runId: "r",
    tool: {},
  };
}
