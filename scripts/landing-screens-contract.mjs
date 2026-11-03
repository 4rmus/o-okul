// Landing screenshot pipeline contract (DEC-20261102-08, seventh bullet).
// Pure helpers shared by scripts/landing-screens.mjs and its node:test file: dataset pinning,
// local-only guards, provider guards, output location and the provenance manifest shape.
// Screens are captured from a real local stack with the fictional sentetik-v1 dataset; nothing here
// publishes into apps/web/public. Publication needs separate product-owner approval after staging UAT.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const LANDING_SCREENS_DATASET_ID = "sentetik-v1";
export const LANDING_SCREENS_MANIFEST_VERSION = 1;

/** Files the pipeline reads; each must match the dataset's own manifest.json sha256 before anything runs. */
export const LANDING_SCREENS_DATASET_FILES = Object.freeze({
  students: "ogrenci-aktarim-sentetik.xlsx",
  teachers: "ogretmen-aktarim-sentetik.xlsx",
  expectedResults: "beklenen-sonuclar.json",
  exams: Object.freeze([
    Object.freeze({ key: "sentetik-lgs-1", title: "SENTETİK LGS 1", opticalTxt: "sentetik-lgs-1.txt", answerKey: "sentetik-lgs-1-cevap-anahtari.xlsx" }),
    Object.freeze({ key: "sentetik-lgs-2", title: "SENTETİK LGS 2", opticalTxt: "sentetik-lgs-2.txt", answerKey: "sentetik-lgs-2-cevap-anahtari.xlsx" }),
    Object.freeze({ key: "sentetik-lgs-3", title: "SENTETİK LGS 3", opticalTxt: "sentetik-lgs-3.txt", answerKey: "sentetik-lgs-3-cevap-anahtari.xlsx" }),
  ]),
});

/**
 * Scoring identity the exam form sends for an LGS exam (apps/web exams-page, apps/api assertOfficialScoringProfile):
 * POST /exams with examType LGS is refused with SCORING_PROFILE_REQUIRED unless the official 2026 profile and its exam
 * year are named, and the answer key import checks the profile's wrong-answer penalty.
 */
export const LANDING_SCREENS_LGS_SCORING = Object.freeze({
  examType: "LGS",
  examYear: 2026,
  scoringProfileId: "TR-LGS-2026-NOSD-V1",
  wrongPenalty: 1 / 3,
});

/** Run states written to manifest.json; a FAILED run still records its gaps and adjustments. */
export const LANDING_SCREENS_RUN_STATUSES = Object.freeze(["COMPLETED", "FAILED"]);

/** Light theme only; sizes are fixed so later runs are comparable frame by frame. */
export const LANDING_SCREENS_VIEWPORTS = Object.freeze([
  Object.freeze({ id: "desktop-1440", width: 1440, height: 900 }),
  Object.freeze({ id: "tablet-834", width: 834, height: 1112 }),
  Object.freeze({ id: "mobile-390", width: 390, height: 844 }),
]);

/**
 * The agreed screens. No guardian portal and no finance screen (DEC-20261102-08).
 * `needsExams` marks screens whose exam panels stay empty unless the run used --with-exams; `focusLabel` is the
 * accessible name of a panel below the fold that is scrolled to the top of the frame.
 */
export const LANDING_SCREENS = Object.freeze([
  Object.freeze({ id: "admin-student-360", role: "admin", title: "Öğrenci 360", needsExams: true }),
  Object.freeze({ id: "teacher-today", role: "teacher", title: "Öğretmen Bugün", needsExams: false }),
  Object.freeze({ id: "teacher-roll-call", role: "teacher", title: "Yoklama", needsExams: false, focusLabel: "Yoklama kaydet" }),
  Object.freeze({ id: "teacher-grade-grid", role: "teacher", title: "Not girişi", needsExams: false }),
  Object.freeze({ id: "student-gelisimim", role: "student", title: "Gelişimim", needsExams: true, focusLabel: "Gelişimim" }),
]);

export const LANDING_SCREENS_FORBIDDEN_ROUTE_PREFIXES = Object.freeze(["/veli", "/kurum/finans", "/kurum/veliler"]);

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const disposableDatabaseName = /^o_okul_[a-z0-9_]*(?:landing|test)$/;

/** Env names that would let a child process reach an SMS or notification provider (sentetik-v1 README rule). */
export const LANDING_SCREENS_PROVIDER_ENV = Object.freeze([
  "SMS_PROVIDER",
  "NETGSM_USERCODE",
  "NETGSM_PASSWORD",
  "NETGSM_MSG_HEADER",
  "NETGSM_APP_NAME",
  "NETGSM_ENDPOINT",
  "NOTIFICATION_PROVIDER",
  "NOTIFICATION_HTTP_ENDPOINT",
  "NOTIFICATION_HTTP_BEARER_TOKEN",
  "NOTIFICATION_FROM_EMAIL",
]);

export function sha256Hex(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function isLoopbackHost(hostname) {
  return loopbackHosts.has(String(hostname ?? "").toLowerCase());
}

/** Accepts only loopback http(s)/redis/postgres URLs; the pipeline never calls staging or any remote host. */
export function assertLoopbackUrl(rawUrl, label) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`LANDING_SCREENS_URL_INVALID:${label}`);
  }
  if (!isLoopbackHost(url.hostname)) throw new Error(`LANDING_SCREENS_URL_NOT_LOCAL:${label}`);
  return url;
}

/**
 * The pipeline creates a tenant and imports data, so it runs only against a disposable local database
 * whose name ends with `_landing` or `_test` (for example o_okul_landing). The default `o_okul` is refused.
 */
export function assertDisposableDatabaseUrl(rawUrl, label) {
  const url = assertLoopbackUrl(rawUrl, label);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error(`LANDING_SCREENS_DATABASE_URL_PROTOCOL:${label}`);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!disposableDatabaseName.test(databaseName)) throw new Error(`LANDING_SCREENS_DATABASE_NOT_DISPOSABLE:${label}`);
  return { databaseName, url };
}

/** Returns the provider env names that are set; any hit stops the run before a child process starts. */
export function findEnabledProviderEnv(env) {
  const hits = LANDING_SCREENS_PROVIDER_ENV.filter((name) => typeof env[name] === "string" && env[name].trim() !== "");
  const smsEnabled = String(env.SMS_ENABLED ?? "").trim().toLowerCase();
  if (smsEnabled !== "" && smsEnabled !== "false" && smsEnabled !== "0") hits.push("SMS_ENABLED");
  return hits;
}

export function assertProvidersDisabled(env) {
  const hits = findEnabledProviderEnv(env);
  if (hits.length > 0) throw new Error(`LANDING_SCREENS_PROVIDER_ENV_SET:${hits.join(",")}`);
  if (String(env.NODE_ENV ?? "").trim() === "production" || String(env.NODE_ENV ?? "").trim() === "staging") {
    throw new Error("LANDING_SCREENS_NODE_ENV_NOT_LOCAL");
  }
}

/**
 * Output stays outside apps/web/public; the default is artifacts/landing-screens/<runId> (gitignored).
 * Absolute paths outside the repository are allowed for operators who keep captures elsewhere.
 * The checks run on the lexical path and again on the real path (symlinks resolved through the nearest existing
 * ancestor), so a symlinked artifacts or output directory cannot land files in apps/web/public or a tracked folder.
 */
export function resolveOutputDir(repoRoot, requested, runId) {
  const base = requested ? resolve(repoRoot, requested) : join(repoRoot, "artifacts", "landing-screens");
  const target = join(base, runId);
  const publicDir = join(repoRoot, "apps", "web", "public");
  const artifactsDir = join(repoRoot, "artifacts");
  assertOutputLocation({ artifactsDir, publicDir, repoRoot, target });

  const realRepoRoot = realPathThroughNearestAncestor(repoRoot);
  assertOutputLocation({
    // The ignore rule matches artifacts/ by its place in the repository, not by where a symlink named artifacts points.
    artifactsDir: join(realRepoRoot, "artifacts"),
    publicDir: realPathThroughNearestAncestor(publicDir),
    repoRoot: realRepoRoot,
    target: realPathThroughNearestAncestor(target),
  });
  return target;
}

function assertOutputLocation({ artifactsDir, publicDir, repoRoot, target }) {
  if (isInside(publicDir, target) || isInside(target, publicDir)) throw new Error("LANDING_SCREENS_OUTPUT_IN_PUBLIC");
  if (isInside(repoRoot, target) && !isInside(artifactsDir, target)) throw new Error("LANDING_SCREENS_OUTPUT_NOT_GITIGNORED");
}

/**
 * The real path of `path`: the nearest ancestor that exists is resolved with realpathSync and the missing tail is
 * appended. A dangling symlink on the way cannot be resolved, so it is refused instead of guessed.
 */
export function realPathThroughNearestAncestor(path) {
  let current = resolve(path);
  const missing = [];
  for (;;) {
    let exists = true;
    try {
      lstatSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      exists = false;
    }
    if (exists) {
      try {
        return join(realpathSync.native(current), ...missing);
      } catch {
        throw new Error("LANDING_SCREENS_OUTPUT_UNRESOLVED");
      }
    }
    const parent = dirname(current);
    if (parent === current) return join(current, ...missing);
    missing.unshift(basename(current));
    current = parent;
  }
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.startsWith(`..${sep}`));
}

/** Verifies every file the pipeline reads against the dataset's manifest.json; returns the pinned hashes. */
export function verifyDataset(datasetDir, { withExams = false } = {}) {
  const manifestPath = join(datasetDir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("LANDING_SCREENS_DATASET_MANIFEST_MISSING");
  const manifestContent = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestContent.toString("utf8"));
  if (manifest.version !== 1 || manifest.deterministic !== true || !Array.isArray(manifest.files)) {
    throw new Error("LANDING_SCREENS_DATASET_MANIFEST_INVALID");
  }
  const pinned = new Map(manifest.files.map((file) => [file.name, file.sha256]));
  const wanted = [LANDING_SCREENS_DATASET_FILES.students, LANDING_SCREENS_DATASET_FILES.teachers];
  if (withExams) {
    wanted.push(LANDING_SCREENS_DATASET_FILES.expectedResults);
    for (const exam of LANDING_SCREENS_DATASET_FILES.exams) wanted.push(exam.opticalTxt, exam.answerKey);
  }
  const files = [];
  for (const name of wanted) {
    const expected = pinned.get(name);
    if (!expected) throw new Error(`LANDING_SCREENS_DATASET_FILE_NOT_PINNED:${name}`);
    const path = join(datasetDir, name);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`LANDING_SCREENS_DATASET_FILE_MISSING:${name}`);
    const actual = sha256Hex(readFileSync(path));
    if (actual !== expected) throw new Error(`LANDING_SCREENS_DATASET_HASH_MISMATCH:${name}`);
    files.push({ name, sha256: actual });
  }
  return { id: LANDING_SCREENS_DATASET_ID, manifestSha256: sha256Hex(manifestContent), files };
}

/**
 * School-year calendar around `today` (YYYY-MM-DD, Europe/Istanbul): September to August, two terms.
 * The term that contains today is the active one so teacher and student screens have a current term.
 */
export function schoolCalendar(today) {
  const [year, month] = today.split("-").map(Number);
  const startYear = month >= 9 ? year : year - 1;
  const terms = [
    { key: "term-1", name: "1. DÖNEM", startsAt: `${startYear}-09-01`, endsAt: `${startYear + 1}-01-31` },
    { key: "term-2", name: "2. DÖNEM", startsAt: `${startYear + 1}-02-01`, endsAt: `${startYear + 1}-08-31` },
  ].map((term) => ({ ...term, isActive: term.startsAt <= today && today <= term.endsAt }));
  return {
    year: { name: `${startYear}-${startYear + 1}`, startsAt: `${startYear}-09-01`, endsAt: `${startYear + 1}-08-31` },
    terms,
    activeTerm: terms.find((term) => term.isActive),
  };
}

/** Previous weekdays strictly before `today`, newest first, never before `notBefore`. */
export function previousSchoolDays(today, count, notBefore) {
  const days = [];
  const cursor = new Date(`${today}T12:00:00Z`);
  while (days.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const key = cursor.toISOString().slice(0, 10);
    if (notBefore && key < notBefore) break;
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(key);
  }
  return days;
}

/**
 * `pnpm landing:screens -- --build` hands the script a literal "--" under pnpm 11; parseArgs would then read every
 * flag after it as a positional and stop with ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL. Only a leading separator is
 * dropped, so a later "--" keeps its usual meaning.
 */
export function stripLeadingArgSeparator(argv) {
  return argv[0] === "--" ? argv.slice(1) : [...argv];
}

/** The LGS exam create body: the official scoring identity plus the answer key with the profile's penalty. */
export function lgsExamCreateBody({ title, gradeLevelId, classIds, startsAt, answerKey }) {
  return {
    title,
    examType: LANDING_SCREENS_LGS_SCORING.examType,
    examYear: LANDING_SCREENS_LGS_SCORING.examYear,
    scoringProfileId: LANDING_SCREENS_LGS_SCORING.scoringProfileId,
    gradeLevelId,
    classIds,
    startsAt,
    answerKey: {
      version: answerKey.version,
      fileBase64: answerKey.fileBase64,
      scoringConfig: { wrongPenalty: LANDING_SCREENS_LGS_SCORING.wrongPenalty },
    },
  };
}

/**
 * Exam create with classIds already enrolls every student of those classes (participant without participantNo or
 * booklet); raw import matching reads the student number, so those rows match as they are. Only expected optical
 * rows whose student is not yet a participant are added; adding an enrolled student again is EXAM_PARTICIPANT_EXISTS.
 */
export function planMissingExamParticipants(expectedRows, studentsByNo, existingParticipants) {
  const enrolled = new Set(existingParticipants.map((participant) => participant.studentId));
  const missing = [];
  for (const row of expectedRows) {
    const student = studentsByNo.get(String(row.studentNo));
    if (!student) throw new Error("LANDING_SCREENS_PARTICIPANT_MISSING");
    if (enrolled.has(student.id)) continue;
    enrolled.add(student.id);
    missing.push({ studentId: student.id, participantNo: String(row.studentNo), bookletType: row.booklet });
  }
  return missing;
}

export function istanbulDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function buildProvenanceManifest({ adjustments = [], capturedAt, commit, dataset, examsLoaded, failure = null, gaps, queueAvailable = false, runId, screens, status = "COMPLETED", tool }) {
  if (!LANDING_SCREENS_RUN_STATUSES.includes(status)) throw new Error(`LANDING_SCREENS_RUN_STATUS_INVALID:${status}`);
  if (status === "FAILED" && !failure) throw new Error("LANDING_SCREENS_RUN_FAILURE_REQUIRED");
  for (const screen of screens) {
    if (LANDING_SCREENS_FORBIDDEN_ROUTE_PREFIXES.some((prefix) => screen.route === prefix || screen.route.startsWith(`${prefix}/`) || screen.route.startsWith(`${prefix}?`))) {
      throw new Error(`LANDING_SCREENS_FORBIDDEN_ROUTE:${screen.id}`);
    }
  }
  return {
    version: LANDING_SCREENS_MANIFEST_VERSION,
    kind: "landing-screens-provenance",
    decision: "DEC-20261102-08",
    runId,
    capturedAt,
    // FAILED keeps the gaps and adjustments of a run that stopped; `failure` is the error code only, never a body.
    status,
    failure: status === "FAILED" ? failure : null,
    evidenceClass: "LOCAL_TEST",
    dataset,
    source: {
      commit: commit.sha,
      dirtyFileCount: commit.dirtyFileCount,
      stack: "local API (PERSISTENCE_DRIVER=postgres, TZ=UTC) + next start behind a local /api edge proxy; real HTTP import flow; SMS and notification providers off",
      queue: queueAvailable ? "local Redis, run-scoped QUEUE_PREFIX, no announcement/SMS worker" : "NONE: grade publish skipped",
      examPipeline: examsLoaded ? "raw import -> excel-import/exam-evaluation/report-generation workers -> ReportSnapshot" : "NOT_RUN",
    },
    tool,
    theme: "light",
    screens,
    gaps,
    // Direct database steps outside the HTTP flow (tenant bootstrap, portal account binding, enrollment start).
    adjustments,
    review: {
      status: "PENDING_HUMAN_PII_REVIEW",
      reviewer: null,
      reviewedAt: null,
      checklist: "docs/landing-screens-runbook.md#pii-incelemesi",
    },
    publication: {
      status: "NOT_APPROVED",
      rule: "apps/web/public yalnız staging UAT ve insan PII incelemesinden sonra ayrı ürün sahibi onayıyla",
    },
  };
}
