// Landing screenshot pipeline (DEC-20261102-08, seventh bullet). Local only, no publication.
//
// Starts a local stack (API with PERSISTENCE_DRIVER=postgres on a disposable database, `next start` for the web),
// loads the fictional ornek-veriler/sentetik-v1 dataset through the real HTTP import endpoints, optionally runs the
// real raw import -> worker -> ReportSnapshot path (--with-exams, needs local Redis and MinIO), captures the agreed
// screens in the light theme at fixed viewports and writes PNG files plus a provenance manifest under
// artifacts/landing-screens/<runId>/ (gitignored). It never writes into apps/web/public and never starts an SMS,
// notification or announcement worker. Runbook: docs/landing-screens-runbook.md.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  LANDING_SCREENS,
  LANDING_SCREENS_DATASET_FILES,
  LANDING_SCREENS_VIEWPORTS,
  assertDisposableDatabaseUrl,
  assertLoopbackUrl,
  assertProvidersDisabled,
  buildProvenanceManifest,
  istanbulDateKey,
  previousSchoolDays,
  resolveOutputDir,
  schoolCalendar,
  sha256Hex,
  verifyDataset,
} from "./landing-screens-contract.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { values: args } = parseArgs({
  options: {
    "with-exams": { type: "boolean", default: false },
    "skip-capture": { type: "boolean", default: false },
    build: { type: "boolean", default: false },
    out: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Kullanım: node scripts/landing-screens.mjs [--with-exams] [--skip-capture] [--build] [--out <dizin>]
Gerekli ortam: LANDING_SCREENS_DATABASE_URL (app rolü) ve LANDING_SCREENS_DIRECT_DATABASE_URL (migration rolü),
ikisi de yerel ve adı _landing veya _test ile biten tek kullanımlık veritabanı. İsteğe bağlı: LANDING_SCREENS_REDIS_URL
(yerel Redis; not yayımlama için), --with-exams için ayrıca LANDING_SCREENS_S3_* (yerel MinIO). Ayrıntı: docs/landing-screens-runbook.md`);
  process.exit(0);
}

const runId = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
const withExams = args["with-exams"];
const skipCapture = args["skip-capture"];
const env = process.env;

assertProvidersDisabled(env);
const databaseUrl = requireEnv("LANDING_SCREENS_DATABASE_URL");
const directDatabaseUrl = requireEnv("LANDING_SCREENS_DIRECT_DATABASE_URL");
const { databaseName } = assertDisposableDatabaseUrl(databaseUrl, "LANDING_SCREENS_DATABASE_URL");
const direct = assertDisposableDatabaseUrl(directDatabaseUrl, "LANDING_SCREENS_DIRECT_DATABASE_URL");
if (direct.databaseName !== databaseName) throw new Error("LANDING_SCREENS_DATABASE_URL_MISMATCH");
const apiPort = Number(env.LANDING_SCREENS_API_PORT ?? "3100");
const webPort = Number(env.LANDING_SCREENS_WEB_PORT ?? "43181");
// `next start` listens on the next port; the edge proxy on webPort plays Traefik's role (/api and /health -> API).
const nextPort = webPort + 1;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://localhost:${webPort}`;
const datasetDir = env.LANDING_SCREENS_DATASET_DIR ?? join(repoRoot, "ornek-veriler", "sentetik-v1");
const outDir = resolveOutputDir(repoRoot, args.out ?? env.LANDING_SCREENS_OUTPUT_DIR, runId);
// With PERSISTENCE_DRIVER=postgres the API enqueues guardian notification jobs on grade publish; without a local
// Redis that enqueue never returns, so grade publication is skipped and listed as a gap instead.
const queueStack = resolveQueueStack();
const examStack = withExams ? resolveExamStack() : undefined;

const dataset = verifyDataset(datasetDir, { withExams });
mkdirSync(join(outDir, "logs"), { recursive: true });
console.log(`landing-screens ${runId}: veri seti ${dataset.id} doğrulandı (${dataset.files.length} dosya), çıktı ${relative(repoRoot, outDir) || outDir}`);

const gaps = [];
const adjustments = [];
const children = [];
let examWorkers = [];
let edgeProxy;
let exitCode = 0;
try {
  await assertPortFree(apiPort, "LANDING_SCREENS_API_PORT");
  if (!skipCapture) {
    await assertPortFree(webPort, "LANDING_SCREENS_WEB_PORT");
    await assertPortFree(nextPort, "LANDING_SCREENS_WEB_PORT+1");
  }
  ensureBuilds();

  const seed = await bootstrapTenant();
  if (examStack) examWorkers = await startExamWorkers(examStack);
  children.push(startApi());
  await waitForHttp(`${apiOrigin}/health`, 60_000, "LANDING_SCREENS_API_NOT_READY");

  const ownerToken = await login(seed.tenantSlug, seed.owner.loginName, seed.owner.password);
  const loaded = await loadDataset(ownerToken, seed.tenantId);
  await provisionPortalAccounts(seed, loaded);
  if (examStack) {
    await loadExams(ownerToken, loaded);
  } else {
    gaps.push("EXAM_PIPELINE_NOT_RUN: --with-exams verilmedi; Öğrenci 360 ve Gelişimim sınav panelleri sınav verisi olmadan çekildi.");
  }

  if (skipCapture) {
    gaps.push("CAPTURE_NOT_RUN: --skip-capture verildi; görüntü üretilmedi.");
    writeManifest(seed, [], { tool: { node: process.version } });
    console.log(`landing-screens ${runId}: veri yüklendi, yakalama atlandı.`);
  } else {
    children.push(startWeb());
    await waitForHttp(`http://127.0.0.1:${nextPort}/login`, 120_000, "LANDING_SCREENS_WEB_NOT_READY");
    edgeProxy = await startEdgeProxy();
    const capture = await captureScreens(seed, loaded);
    writeManifest(seed, capture.screens, { tool: capture.tool });
    const failed = capture.screens.filter((screen) => screen.status === "FAILED");
    if (failed.length > 0) {
      exitCode = 1;
      console.error(`landing-screens ${runId}: ${failed.length} ekran yakalanamadı (manifest.json içinde reason alanı).`);
    }
    console.log(`landing-screens ${runId}: ${capture.screens.length - failed.length} PNG yazıldı -> ${relative(repoRoot, outDir) || outDir}`);
  }
} catch (error) {
  exitCode = 1;
  console.error(`landing-screens ${runId} durdu: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (edgeProxy) await new Promise((resolveClose) => edgeProxy.close(() => resolveClose()));
  for (const child of children.reverse()) await stopChild(child);
  for (const worker of examWorkers) await worker.close().catch(() => undefined);
}
process.exit(exitCode);

function requireEnv(name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function resolveQueueStack() {
  const redisUrl = env.LANDING_SCREENS_REDIS_URL?.trim();
  if (!redisUrl) return undefined;
  assertLoopbackUrl(redisUrl, "LANDING_SCREENS_REDIS_URL");
  // A run-scoped prefix keeps these jobs apart from any other queue; no announcement worker consumes them.
  return { redisUrl, queuePrefix: `landing-screens-${runId}` };
}

function resolveExamStack() {
  if (!queueStack) throw new Error("LANDING_SCREENS_REDIS_URL_REQUIRED: --with-exams yerel Redis ister");
  const s3Endpoint = requireEnv("LANDING_SCREENS_S3_ENDPOINT");
  assertLoopbackUrl(s3Endpoint, "LANDING_SCREENS_S3_ENDPOINT");
  return {
    ...queueStack,
    s3: {
      S3_ENDPOINT: s3Endpoint,
      S3_BUCKET: env.LANDING_SCREENS_S3_BUCKET?.trim() || "o-okul-landing-screens",
      S3_REGION: env.LANDING_SCREENS_S3_REGION?.trim() || "us-east-1",
      S3_FORCE_PATH_STYLE: "true",
      S3_ACCESS_KEY_ID: requireEnv("LANDING_SCREENS_S3_ACCESS_KEY_ID"),
      S3_SECRET_ACCESS_KEY: requireEnv("LANDING_SCREENS_S3_SECRET_ACCESS_KEY"),
    },
  };
}

/** Child processes get an explicit env; provider credentials in the operator shell never reach them. */
function childEnv(extra) {
  const base = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "PLAYWRIGHT_BROWSERS_PATH"]) {
    if (env[name] !== undefined) base[name] = env[name];
  }
  return {
    ...base,
    NODE_ENV: "development",
    // Production containers run in UTC; timestamp columns are read back with the process time zone.
    TZ: "UTC",
    SMS_ENABLED: "false",
    ADMIN_MFA_MODE: "off",
    COOKIE_SECURE: "false",
    ...extra,
  };
}

function apiEnv() {
  return childEnv({
    PORT: String(apiPort),
    WEB_URL: webOrigin,
    // Tenant hosts are <slug>.localhost like production's <slug>.<domain>; the script's own loopback calls stay legacy.
    DOMAIN: "localhost",
    DATABASE_URL: databaseUrl,
    DIRECT_DATABASE_URL: directDatabaseUrl,
    PERSISTENCE_DRIVER: "postgres",
    // Without LANDING_SCREENS_REDIS_URL the queue points at a closed loopback port so no other Redis on this machine
    // is touched. The login/API rate limiters always use their supported in-memory stores (non-production only).
    REDIS_URL: queueStack?.redisUrl ?? "redis://127.0.0.1:9/0",
    ...(queueStack ? { QUEUE_PREFIX: queueStack.queuePrefix } : {}),
    ...(examStack ? examStack.s3 : {}),
    LOGIN_ATTEMPT_LIMITER_STORE: "memory",
    API_RATE_LIMIT_STORE: "memory",
    // One operator drives a few hundred requests from loopback; the default per-IP budget would throttle the load.
    API_RATE_LIMIT_MAX: "5000",
  });
}

function ensureBuilds() {
  const apiMain = join(repoRoot, "apps", "api", "dist", "main.js");
  const webBuildId = join(repoRoot, "apps", "web", ".next", "BUILD_ID");
  const run = (label, command, commandArgs, extraEnv = {}) => {
    console.log(`landing-screens: ${label}`);
    const result = spawnSync(command, commandArgs, { cwd: repoRoot, env: { ...childEnv(extraEnv) }, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`LANDING_SCREENS_BUILD_FAILED:${label}`);
  };
  if (args.build) {
    run("API ve bağımlı paketler derleniyor", "pnpm", ["--filter", "@o-okul/api...", "build"]);
    if (withExams) run("worker ve bağımlı paketler derleniyor", "pnpm", ["--filter", "@o-okul/worker...", "build"]);
    if (!skipCapture) run("ui derleniyor", "pnpm", ["--filter", "@o-okul/ui", "build"]);
    if (!skipCapture) run("web derleniyor", "pnpm", ["--filter", "@o-okul/web", "next:build"], { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" });
  }
  if (!existsSync(apiMain)) throw new Error("LANDING_SCREENS_API_BUILD_MISSING: --build ile çalıştırın");
  if (withExams && !existsSync(join(repoRoot, "apps", "worker", "dist", "queue", "bullmq-worker.js"))) {
    throw new Error("LANDING_SCREENS_WORKER_BUILD_MISSING: --build ile çalıştırın");
  }
  if (skipCapture) return;
  if (!existsSync(webBuildId)) throw new Error("LANDING_SCREENS_WEB_BUILD_MISSING: --build ile çalıştırın");
}

function startApi() {
  return startChild("api", process.execPath, [join(repoRoot, "apps", "api", "dist", "main.js")], repoRoot, apiEnv());
}

function startWeb() {
  const webDir = join(repoRoot, "apps", "web");
  return startChild(
    "web",
    process.execPath,
    [join(webDir, "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", String(nextPort)],
    webDir,
    childEnv({ NODE_ENV: "production", DOMAIN: "localhost", NEXT_TELEMETRY_DISABLED: "1" }),
  );
}

/**
 * Local stand-in for the production edge (Traefik): /api/* and /health* go to the API, everything else to
 * `next start`. The Host header is passed unchanged so <slug>.localhost resolves the tenant on both sides.
 */
function startEdgeProxy() {
  const server = createServer((incoming, outgoing) => {
    const path = incoming.url ?? "/";
    const toApi = path.startsWith("/api/") || path === "/health" || path.startsWith("/health/") || path.startsWith("/health?");
    const upstream = httpRequest({
      host: "127.0.0.1",
      port: toApi ? apiPort : nextPort,
      method: incoming.method,
      path,
      headers: { ...incoming.headers, "x-forwarded-proto": "http" },
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(webPort, "127.0.0.1", () => resolveListen(server));
  });
}

function startChild(name, command, commandArgs, cwd, childEnvironment) {
  const log = createWriteStream(join(outDir, "logs", `${name}.log`), { flags: "a" });
  const child = spawn(command, commandArgs, { cwd, env: childEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", (code, signal) => {
    if (!child.stopping) console.error(`landing-screens: ${name} beklenmedik biçimde kapandı (code ${code}, signal ${signal}); logs/${name}.log`);
  });
  return Object.assign(child, { label: name, log });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stopping = true;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  await exited;
  clearTimeout(timer);
  child.log.end();
}

async function assertPortFree(port, label) {
  const inUse = await new Promise((resolvePort) => {
    const socket = new Socket();
    socket.setTimeout(1_000);
    socket.once("connect", () => { socket.destroy(); resolvePort(true); });
    socket.once("timeout", () => { socket.destroy(); resolvePort(false); });
    socket.once("error", () => resolvePort(false));
    socket.connect(port, "127.0.0.1");
  });
  if (inUse) throw new Error(`LANDING_SCREENS_PORT_IN_USE:${label}:${port}`);
}

async function waitForHttp(url, timeoutMs, code) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    await delay(500);
  }
  throw new Error(code);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function withMigrationClient(work) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function hashPassword(password) {
  const module = await import(pathToFileURL(join(repoRoot, "apps", "api", "dist", "auth", "auth-user-store.js")).href);
  // Per-user random salt (scrypt v2), the same format the API writes for real accounts.
  return module.hashPasswordAsync(password);
}

/**
 * Tenant provisioning is a system-admin step outside the landing screens, so it is seeded directly, as the live
 * smokes do: tenant, licence term and the first owner. Guardian auto-notifications are switched off for the tenant.
 * Every password is random per run and is kept only in this process.
 */
async function bootstrapTenant() {
  const suffix = runId.slice(-8);
  const tenantId = randomUUID();
  const tenantSlug = `landing-${suffix}`;
  const owner = { id: randomUUID(), loginName: `kurum-sahibi-${suffix}@example.test`, password: randomBytes(24).toString("base64url") };
  const startsAt = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const ownerHash = await hashPassword(owner.password);
  await withMigrationClient(async (client) => {
    await client.query(
      `INSERT INTO "Tenant" ("id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "status", "seatLimit",
         "guardianNotifyAbsence", "guardianNotifyPaymentDue", "guardianNotifyGradePublish", "updatedAt")
       VALUES ($1, 'Örnek Ortaokulu', $2, 'PRO', $3, $4, 'ACTIVE', 200, false, false, false, now())`,
      [tenantId, tenantSlug, startsAt, endsAt],
    );
    await client.query(
      `INSERT INTO "LicenseTerm" ("id", "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit", "auditReference", "updatedAt")
       VALUES ($1, $2, 'PRO', $3, $4, 200, 'landing-screens-pipeline', now())`,
      [randomUUID(), tenantId, startsAt, endsAt],
    );
    await insertUser(client, tenantId, owner.id, owner.loginName, "Ayşe Örnek", ownerHash);
    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "staffRole", "status", "version", "scopeMode", "updatedAt")
       VALUES ($1, $2, $3, 'TENANT_OWNER', 'TENANT_OWNER', 'ACTIVE', 1, 'TENANT', now())`,
      [randomUUID(), tenantId, owner.id],
    );
  });
  adjustments.push("TENANT_BOOTSTRAP: kurum, lisans dönemi ve ilk kurum sahibi doğrudan veritabanına yazıldı (sistem admin adımı); veli otomatik bildirimleri kapalı.");
  return { tenantId, tenantSlug, owner };
}

async function insertUser(client, tenantId, userId, loginName, name, passwordHash) {
  await client.query(
    `INSERT INTO "User" ("id", "tenantId", "email", "emailNormalized", "loginName", "loginNameNormalized", "name", "passwordHash", "updatedAt")
     VALUES ($1, $2, $3, lower(btrim($3)), $3, lower(btrim($3)), $4, $5, now())`,
    [userId, tenantId, loginName, name, passwordHash],
  );
}

async function login(tenantSlug, loginName, password) {
  const response = await fetch(`${apiOrigin}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantSlug, loginName, password }),
  });
  const body = await response.json().catch(() => ({}));
  const token = body.data?.accessToken ?? body.accessToken;
  if (!response.ok || !token) throw new Error(`LANDING_SCREENS_LOGIN_FAILED:${response.status}:${body.error?.code ?? "UNKNOWN"}`);
  return token;
}

async function api(token, method, path, body) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["idempotency-key"] = `landing-${runId}-${randomUUID()}`;
  const response = await fetch(`${apiOrigin}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 204) return undefined;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Only the route shape and the error code are reported; request and response bodies may carry PII.
    const route = path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ":id");
    throw new Error(`LANDING_SCREENS_API_FAILED:${method} ${route}:${response.status}:${payload.error?.code ?? "UNKNOWN"}`);
  }
  return payload.data ?? payload;
}

function fileBase64(name) {
  return readFileSync(join(datasetDir, name)).toString("base64");
}

/** Loads sentetik-v1 through the same endpoints the setup wizard and import screens call. */
async function loadDataset(token, tenantId) {
  const today = istanbulDateKey();
  const calendar = schoolCalendar(today);
  const activeTermDef = calendar.activeTerm;
  if (!activeTermDef) throw new Error("LANDING_SCREENS_ACTIVE_TERM_MISSING");

  const campus = await api(token, "POST", "/campuses", { code: "MRK", name: "MERKEZ KAMPÜS", unitType: "SCHOOL" });
  const year = await api(token, "POST", "/academic-years", { ...calendar.year, isActive: true });
  const terms = {};
  for (const term of calendar.terms) {
    terms[term.key] = await api(token, "POST", "/academic-terms", {
      academicYearId: year.id, name: term.name, startsAt: term.startsAt, endsAt: term.endsAt, isActive: term.isActive,
    });
  }
  const activeTerm = terms[activeTermDef.key];
  const gradeLevel = await api(token, "POST", "/grade-levels", { code: "8", name: "8. SINIF" });
  const classes = {};
  for (const section of ["A", "B"]) {
    classes[section] = await api(token, "POST", "/classes", { name: `8-${section}`, section, gradeLevelId: gradeLevel.id, campusId: campus.id });
  }
  const courseNames = ["TÜRKÇE", "MATEMATİK", "FEN BİLİMLERİ", "SOSYAL BİLGİLER", "İNGİLİZCE", "DİN KÜLTÜRÜ"];
  const courses = {};
  for (const [index, name] of courseNames.entries()) {
    courses[name] = await api(token, "POST", "/courses", { name, code: `D${index + 1}` });
    await api(token, "PUT", `/grade-levels/${gradeLevel.id}/courses/${courses[name].id}`);
  }

  const teacherDryRun = await api(token, "POST", "/teachers/imports/dry-run", { fileBase64: fileBase64(LANDING_SCREENS_DATASET_FILES.teachers) });
  if (isIdentityPairOnlyFailure(teacherDryRun)) {
    // sentetik-v1 (2026-08) has teacher rows with T.C. but no phone and the reverse; today's import contract wants
    // both or neither. The same people are created through the single-teacher form endpoint without identity fields.
    gaps.push("TEACHER_IMPORT_IDENTITY_PAIR: sentetik-v1 öğretmen dosyası bugünkü aktarım sözleşmesine (T.C. ve telefon birlikte) uymuyor; öğretmenler tek kayıt formu ucuyla T.C./telefon olmadan oluşturuldu.");
    for (const row of await readTeacherRows()) await api(token, "POST", "/teachers", row);
  } else {
    assertDryRun("teachers", teacherDryRun);
    await api(token, "POST", "/teachers/imports", { fileBase64: fileBase64(LANDING_SCREENS_DATASET_FILES.teachers) });
  }
  const studentDryRun = await api(token, "POST", "/students/imports/dry-run", { fileBase64: fileBase64(LANDING_SCREENS_DATASET_FILES.students) });
  assertDryRun("students", studentDryRun);
  if (studentDryRun.quota?.wouldExceed) throw new Error("LANDING_SCREENS_STUDENT_QUOTA_EXCEEDED");
  await api(token, "POST", "/students/imports", { fileBase64: fileBase64(LANDING_SCREENS_DATASET_FILES.students) });

  // Imported enrollments start today; the screens show a term already in progress, so the enrollment start moves to
  // the first day of the active term. This is the only history adjustment and it is listed in the manifest.
  const backdated = await withMigrationClient((client) => client.query(
    `UPDATE "StudentEnrollment" SET "startsAt" = $2::date, "updatedAt" = now()
     WHERE "tenantId" = $1 AND "startsAt" = $3::date AND "endsAt" IS NULL`,
    [tenantId, activeTermDef.startsAt, today],
  ));
  adjustments.push(`ENROLLMENT_BACKDATED: ${backdated.rowCount} kayıt; başlangıç ${activeTermDef.startsAt} (aktif dönem başı) yapıldı, geçmiş yoklama ve notlar bu sayede girilebildi.`);

  const teachers = await api(token, "GET", "/teachers");
  const students = await api(token, "GET", "/students");
  const mathTeacher = teachers.find((teacher) => normalizeLabel(teacher.branch) === "MATEMATIK");
  if (!mathTeacher) throw new Error("LANDING_SCREENS_MATH_TEACHER_MISSING");
  const studentsByClass = { A: [], B: [] };
  for (const student of students) {
    if (student.classId === classes.A.id) studentsByClass.A.push(student);
    if (student.classId === classes.B.id) studentsByClass.B.push(student);
  }
  for (const list of Object.values(studentsByClass)) list.sort((left, right) => String(left.studentNo).localeCompare(String(right.studentNo), "tr"));
  if (studentsByClass.A.length === 0 || studentsByClass.B.length === 0) throw new Error("LANDING_SCREENS_CLASS_ROSTER_EMPTY");
  const featuredStudent = studentsByClass.A[0];

  const math = courses["MATEMATİK"];
  const turkish = courses["TÜRKÇE"];
  await api(token, "POST", `/teachers/${mathTeacher.id}/assignments`, { classId: classes.A.id, role: "CLASS_TEACHER", termId: activeTerm.id });
  for (const section of ["A", "B"]) {
    await api(token, "POST", `/teachers/${mathTeacher.id}/assignments`, { classId: classes[section].id, courseId: math.id, role: "BRANCH_TEACHER", termId: activeTerm.id });
  }
  const turkishTeacher = teachers.find((teacher) => normalizeLabel(teacher.branch) === "TURKCE");
  if (turkishTeacher) {
    await api(token, "POST", `/teachers/${turkishTeacher.id}/assignments`, { classId: classes.A.id, courseId: turkish.id, role: "BRANCH_TEACHER", termId: activeTerm.id });
  }

  // Today's lessons for the featured teacher (Europe/Istanbul wall clock).
  const lessons = [["08:40", "09:20", "A"], ["10:20", "11:00", "B"], ["13:30", "14:10", "A"]];
  for (const [start, end, section] of lessons) {
    await api(token, "POST", "/schedule-lessons", {
      classId: classes[section].id, courseId: math.id, teacherId: mathTeacher.id, termId: activeTerm.id,
      title: "Matematik", startsAt: `${today}T${start}:00+03:00`, endsAt: `${today}T${end}:00+03:00`,
    });
  }

  // Roll call history for the last school days of the term; today stays open so "Yoklama bekliyor" is real.
  const pattern = ["PRESENT", "PRESENT", "PRESENT", "PRESENT", "LATE", "PRESENT", "PRESENT", "ABSENT", "PRESENT", "EXCUSED"];
  for (const [dayIndex, date] of previousSchoolDays(today, 8, activeTermDef.startsAt).entries()) {
    for (const section of ["A", "B"]) {
      await api(token, "PUT", "/attendance/daily", {
        classId: classes[section].id,
        date,
        entries: studentsByClass[section].map((student, index) => ({ studentId: student.id, status: pattern[(index * 3 + dayIndex) % pattern.length] })),
      });
    }
  }

  // School grades: published assessments feed Gelişimim; one saved draft is what the grade grid shows.
  const assessmentDates = previousSchoolDays(today, 25, activeTermDef.startsAt);
  const heldOn = (offset) => assessmentDates[Math.min(offset, assessmentDates.length - 1)] ?? today;
  const published = [
    { courseId: math.id, kind: "WRITTEN", title: "1. Yazılı", day: 18, base: 62 },
    { courseId: math.id, kind: "PERFORMANCE", title: "Performans 1", day: 9, base: 71 },
    { courseId: turkish.id, kind: "WRITTEN", title: "1. Yazılı", day: 14, base: 68 },
  ];
  for (const item of published) {
    const assessment = await api(token, "POST", "/grade-assessments", {
      classId: classes.A.id, courseId: item.courseId, termId: activeTerm.id, kind: item.kind, title: item.title, heldOn: heldOn(item.day), maxScore: 100,
    });
    await api(token, "PUT", `/grade-assessments/${assessment.id}/entries`, { entries: gradeEntries(studentsByClass.A, item.base) });
    if (queueStack) await api(token, "POST", `/grade-assessments/${assessment.id}/publish`);
  }
  if (!queueStack) {
    gaps.push("GRADE_PUBLISH_NOT_RUN: LANDING_SCREENS_REDIS_URL verilmedi; not yayımlama kuyruk kaydı ister, notlar taslak kaldı ve Gelişimim not serisi boş çekildi.");
  }
  const draft = await api(token, "POST", "/grade-assessments", {
    classId: classes.A.id, courseId: math.id, termId: activeTerm.id, kind: "WRITTEN", title: "2. Yazılı", heldOn: heldOn(1), maxScore: 100,
  });
  await api(token, "PUT", `/grade-assessments/${draft.id}/entries`, { entries: gradeEntries(studentsByClass.A, 66) });

  // Development assessment visible to the student (GUARDIAN visibility); no mentor note to keep free text out.
  const criteria = [];
  for (const [index, name] of ["Derse katılım", "Sorumluluk", "İş birliği"].entries()) {
    criteria.push(await api(token, "POST", "/development/criteria", { name, scaleMin: 1, scaleMax: 5, sortOrder: index + 1 }));
  }
  await api(token, "POST", "/development/assessments", {
    studentId: featuredStudent.id, teacherId: mathTeacher.id, termId: activeTerm.id, periodLabel: "Dönem ara değerlendirmesi",
    scores: criteria.map((criterion, index) => ({ criterionId: criterion.id, score: [4, 5, 4][index] })), visibility: "GUARDIAN",
  });
  await api(token, "POST", "/teacher-notes", {
    studentId: featuredStudent.id, teacherId: mathTeacher.id, courseId: math.id, termId: activeTerm.id,
    body: "Problem çözme çalışmalarına düzenli katılıyor.", visibility: "GUARDIAN_STUDENT",
  });

  console.log(`landing-screens: veri yüklendi (öğretmen ${teachers.length}, öğrenci ${students.length}, sınıf 2, ders ${courseNames.length})`);
  return {
    today, activeTerm, activeTermStartsAt: activeTermDef.startsAt, classes, courses, gradeLevel, mathTeacher, featuredStudent,
    studentsByClass, students, draftAssessmentTitle: draft.title,
  };
}

function assertDryRun(label, result) {
  if (!result?.wouldImport || (result.errors?.length ?? 0) > 0) {
    // Column names and codes only; row values may carry PII.
    const codes = [...new Set((result?.errors ?? []).map((error) => `${error.field ?? error.column ?? "row"}:${error.code ?? error.reason ?? "UNKNOWN"}`))].join(",");
    throw new Error(`LANDING_SCREENS_IMPORT_DRY_RUN_FAILED:${label}:${codes || "NO_ROWS"}`);
  }
}

function isIdentityPairOnlyFailure(result) {
  const errors = result?.errors ?? [];
  return errors.length > 0 && errors.every((error) => (error.field === "phone" || error.field === "nationalId") && error.code === "REQUIRED");
}

/** Name and branch columns of the teacher sheet (ad, soyad, brans); identity columns are not read. */
async function readTeacherRows() {
  const apiRequire = createRequire(join(repoRoot, "apps", "api", "package.json"));
  const ExcelJS = apiRequire("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(join(datasetDir, LANDING_SCREENS_DATASET_FILES.teachers));
  const sheet = workbook.worksheets.find((candidate) => {
    const header = candidate.getRow(1).values;
    return Array.isArray(header) && header.includes("ad") && header.includes("soyad") && header.includes("brans");
  });
  if (!sheet) throw new Error("LANDING_SCREENS_TEACHER_SHEET_MISSING");
  const header = sheet.getRow(1).values;
  const column = (name) => header.indexOf(name);
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = (name) => String(row.getCell(column(name)).value ?? "").trim();
    if (!cell("ad") || !cell("soyad")) return;
    rows.push({
      firstName: cell("ad").toLocaleUpperCase("tr-TR"),
      lastName: cell("soyad").toLocaleUpperCase("tr-TR"),
      branch: cell("brans").toLocaleUpperCase("tr-TR") || undefined,
    });
  });
  return rows;
}

function gradeEntries(students, base) {
  return students.map((student, index) => ({ studentId: student.id, score: Math.min(100, base + ((index * 7) % 31)), absent: false }));
}

function normalizeLabel(value) {
  return String(value ?? "").toLocaleUpperCase("tr-TR").replace(/Ü/g, "U").replace(/İ/g, "I").replace(/Ç/g, "C").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ö/g, "O").trim();
}

/**
 * Portal accounts for the featured teacher and student. Account activation normally goes through an invitation
 * delivered by SMS or e-mail; that delivery is off by rule, so the login user is bound directly, as the live smokes do.
 */
async function provisionPortalAccounts(seed, loaded) {
  const suffix = runId.slice(-8);
  seed.teacher = { id: randomUUID(), loginName: `ogretmen-${suffix}@example.test`, password: randomBytes(24).toString("base64url") };
  seed.student = { id: randomUUID(), loginName: `ogrenci-${suffix}@example.test`, password: randomBytes(24).toString("base64url") };
  const teacherHash = await hashPassword(seed.teacher.password);
  const studentHash = await hashPassword(seed.student.password);
  await withMigrationClient(async (client) => {
    await insertUser(client, seed.tenantId, seed.teacher.id, seed.teacher.loginName, `${loaded.mathTeacher.firstName} ${loaded.mathTeacher.lastName}`, teacherHash);
    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona", "status", "version", "scopeMode", "updatedAt")
       VALUES ($1, $2, $3, 'TEACHER', NULL, true, false, 'ACTIVE', 1, 'TENANT', now())`,
      [randomUUID(), seed.tenantId, seed.teacher.id],
    );
    const teacherBound = await client.query(`UPDATE "Teacher" SET "userId" = $3, "updatedAt" = now() WHERE "tenantId" = $1 AND "id" = $2 AND "userId" IS NULL`, [seed.tenantId, loaded.mathTeacher.id, seed.teacher.id]);
    if (teacherBound.rowCount !== 1) throw new Error("LANDING_SCREENS_TEACHER_BIND_FAILED");

    await insertUser(client, seed.tenantId, seed.student.id, seed.student.loginName, `${loaded.featuredStudent.firstName} ${loaded.featuredStudent.lastName}`, studentHash);
    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona", "status", "version", "scopeMode", "updatedAt")
       VALUES ($1, $2, $3, 'STUDENT', NULL, false, true, 'ACTIVE', 1, 'TENANT', now())`,
      [randomUUID(), seed.tenantId, seed.student.id],
    );
    const studentBound = await client.query(`UPDATE "Student" SET "userId" = $3, "updatedAt" = now() WHERE "tenantId" = $1 AND "id" = $2 AND "userId" IS NULL`, [seed.tenantId, loaded.featuredStudent.id, seed.student.id]);
    if (studentBound.rowCount !== 1) throw new Error("LANDING_SCREENS_STUDENT_BIND_FAILED");
  });
  adjustments.push("PORTAL_ACCOUNTS_BOUND: öne çıkan öğretmen ve öğrenci için giriş hesabı davet teslimi olmadan doğrudan bağlandı (SMS/e-posta kapalı).");
}

/** Only the exam workers run in-process; SMS, announcement and secret-delivery workers are never started. */
async function startExamWorkers(stack) {
  Object.assign(process.env, { DATABASE_URL: databaseUrl, REDIS_URL: stack.redisUrl, QUEUE_PREFIX: stack.queuePrefix, SMS_ENABLED: "false", TZ: "UTC", ...stack.s3 });
  const { CreateBucketCommand, HeadBucketCommand, S3Client } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    endpoint: stack.s3.S3_ENDPOINT, region: stack.s3.S3_REGION, forcePathStyle: true,
    credentials: { accessKeyId: stack.s3.S3_ACCESS_KEY_ID, secretAccessKey: stack.s3.S3_SECRET_ACCESS_KEY },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: stack.s3.S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: stack.s3.S3_BUCKET }));
  }
  const workerModule = await import(pathToFileURL(join(repoRoot, "apps", "worker", "dist", "queue", "bullmq-worker.js")).href);
  const connection = workerModule.createRedisConnectionOptions(stack.redisUrl);
  const options = { connection, workerOptions: { prefix: stack.queuePrefix } };
  const workers = [
    workerModule.createExcelImportBullWorker(options),
    workerModule.createExamEvaluationBullWorker(options),
    workerModule.createReportGenerationBullWorker(options),
    workerModule.createReportPdfRenderBullWorker(options),
  ];
  for (const worker of workers) if (typeof worker.waitUntilReady === "function") await worker.waitUntilReady();
  return workers;
}

/**
 * sentetik-v1 exams through the real path: exam with answer key -> approved OPTIK_7108_LGS parser config ->
 * participants -> optical TXT raw import (S3 + excel-import worker) -> evaluation worker -> report generation
 * worker -> READY ReportSnapshot -> exam publish. Row counts are checked against beklenen-sonuclar.json.
 */
async function loadExams(token, loaded) {
  const byStudentNo = new Map(loaded.students.map((student) => [String(student.studentNo), student]));
  const expected = JSON.parse(readFileSync(join(datasetDir, LANDING_SCREENS_DATASET_FILES.expectedResults), "utf8"));
  const examDates = previousSchoolDays(loaded.today, 30, loaded.activeTermStartsAt);
  for (const [index, exam] of LANDING_SCREENS_DATASET_FILES.exams.entries()) {
    const expectedExam = expected.exams.find((candidate) => candidate.opticalFile === exam.opticalTxt);
    if (!expectedExam) throw new Error(`LANDING_SCREENS_EXPECTED_RESULTS_MISSING:${exam.key}`);
    const examDate = examDates[Math.max(0, Math.min(examDates.length - 1, 20 - index * 8))] ?? loaded.today;
    const created = await api(token, "POST", "/exams", {
      title: exam.title, examType: "LGS", gradeLevelId: loaded.gradeLevel.id, classIds: [loaded.classes.A.id, loaded.classes.B.id],
      startsAt: `${examDate}T09:00:00+03:00`,
      answerKey: { version: `${exam.key}-v1`, fileBase64: fileBase64(exam.answerKey), scoringConfig: { wrongPenalty: expected.wrongPenalty ?? 1 / 3 } },
    });
    const suggestion = await api(token, "POST", `/exams/${created.id}/parser-configs/suggestions`, { preset: "OPTIK_7108_LGS" });
    const parserConfigVersion = `${exam.key}-optik-7108`;
    await api(token, "POST", `/exams/${created.id}/parser-configs/approvals`, { suggestion: suggestion.suggestion, version: parserConfigVersion });
    for (const row of expectedExam.results) {
      const student = byStudentNo.get(String(row.studentNo));
      if (!student) throw new Error(`LANDING_SCREENS_PARTICIPANT_MISSING:${exam.key}`);
      await api(token, "POST", `/exams/${created.id}/participants`, { studentId: student.id, participantNo: String(row.studentNo), bookletType: row.booklet });
    }
    const upload = await api(token, "POST", `/exams/${created.id}/raw-imports`, {
      sourceType: "OPTICAL_TXT", fileName: exam.opticalTxt, contentType: "text/plain", parserConfigVersion, fileBase64: fileBase64(exam.opticalTxt),
    });
    const rawImportId = upload.rawImport.id;
    const summary = await poll(`LANDING_SCREENS_PARSE_TIMEOUT:${exam.key}`, 60_000, async () => {
      const current = await api(token, "GET", `/exams/${created.id}/raw-imports/${rawImportId}/summary`);
      return current.totalRows === expectedExam.results.length ? current : undefined;
    });
    if (summary.matchedCount !== expectedExam.results.length || summary.quarantinedCount !== 0) {
      throw new Error(`LANDING_SCREENS_PARSE_SUMMARY_MISMATCH:${exam.key}:${summary.matchedCount}/${summary.quarantinedCount}`);
    }
    await api(token, "POST", `/exams/${created.id}/raw-imports/${rawImportId}/evaluation-jobs`, {});
    await poll(`LANDING_SCREENS_EVALUATION_TIMEOUT:${exam.key}`, 90_000, async () => {
      const status = await api(token, "GET", `/exams/${created.id}/raw-imports/${rawImportId}/evaluation-status`);
      return status.status === "COMPLETED" && status.pendingCount === 0 ? status : undefined;
    });
    await api(token, "POST", `/exams/${created.id}/reports/generation-jobs`, { reportType: "EXAM_RESULT_SUMMARY" });
    await poll(`LANDING_SCREENS_REPORT_TIMEOUT:${exam.key}`, 90_000, async () => {
      const snapshots = await api(token, "GET", `/exams/${created.id}/reports/snapshots`);
      return snapshots.find((snapshot) => snapshot.status === "READY");
    });
    await api(token, "POST", `/exams/${created.id}/publish`);
    console.log(`landing-screens: ${exam.title} raporu hazır ve yayımlandı`);
  }
}

async function poll(code, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe().catch(() => undefined);
    if (result) return result;
    await delay(1_000);
  }
  throw new Error(code);
}

function screenRoute(screen, loaded) {
  switch (screen.id) {
    case "admin-student-360":
      return `/kurum/ogrenciler/${loaded.featuredStudent.id}`;
    case "teacher-today":
      return "/ogretmen";
    case "teacher-roll-call":
      return `/ogretmen/ders-akisi?classId=${encodeURIComponent(loaded.classes.A.id)}&date=${loaded.today}`;
    case "teacher-grade-grid":
      return "/ogretmen/not-defteri";
    case "student-gelisimim":
      return "/ogrenci";
    default:
      throw new Error(`LANDING_SCREENS_UNKNOWN_SCREEN:${screen.id}`);
  }
}

/** A locator that must be visible before the frame is taken, plus an optional step that opens the content. */
async function prepareScreen(page, screen, loaded) {
  switch (screen.id) {
    case "admin-student-360":
      await page.getByRole("heading", { level: 1 }).first().waitFor({ state: "visible", timeout: 30_000 });
      return;
    case "teacher-today":
      await page.getByLabel("Bugünkü dersler").first().waitFor({ state: "visible", timeout: 30_000 });
      return;
    case "teacher-roll-call": {
      await page.getByLabel("Yoklama kaydet").first().waitFor({ state: "visible", timeout: 30_000 });
      return;
    }
    case "teacher-grade-grid": {
      const select = page.getByLabel("Değerlendirme").first();
      await select.waitFor({ state: "visible", timeout: 30_000 });
      const value = await select.evaluate((element, title) => {
        const option = [...element.querySelectorAll("option")].find((candidate) => candidate.textContent?.startsWith(`${title} ·`));
        return option?.value ?? "";
      }, loaded.draftAssessmentTitle);
      if (!value) throw new Error("LANDING_SCREENS_DRAFT_ASSESSMENT_OPTION_MISSING");
      await select.selectOption(value);
      // The grid mounts after the assessment detail arrives; a load-state wait would return at once here.
      await page.getByRole("button", { name: "Taslağı kaydet" }).first().waitFor({ state: "visible", timeout: 30_000 });
      return;
    }
    case "student-gelisimim":
      await page.getByLabel("Gelişimim").first().waitFor({ state: "visible", timeout: 30_000 });
      return;
    default:
      throw new Error(`LANDING_SCREENS_UNKNOWN_SCREEN:${screen.id}`);
  }
}

async function captureScreens(seed, loaded) {
  const webRequire = createRequire(join(repoRoot, "apps", "web", "package.json"));
  const { chromium } = webRequire("@playwright/test");
  const playwrightVersion = JSON.parse(readFileSync(webRequire.resolve("@playwright/test/package.json"), "utf8")).version;
  // --lang keeps native controls (date inputs) in Turkish format, matching locale tr-TR below.
  const browser = await chromium.launch({ args: ["--lang=tr-TR"] });
  const accounts = { admin: seed.owner, teacher: seed.teacher, student: seed.student };
  const homes = { admin: /\/kurum(?:[/?#]|$)/, teacher: /\/ogretmen(?:[/?#]|$)/, student: /\/ogrenci(?:[/?#]|$)/ };
  const results = [];
  let chromiumVersion = "unknown";
  try {
    for (const role of ["admin", "teacher", "student"]) {
      const context = await browser.newContext({
        colorScheme: "light",
        locale: "tr-TR",
        timezoneId: "Europe/Istanbul",
        reducedMotion: "reduce",
        viewport: { width: LANDING_SCREENS_VIEWPORTS[0].width, height: LANDING_SCREENS_VIEWPORTS[0].height },
      });
      await context.addInitScript(() => {
        try { window.localStorage.setItem("o-okul-theme", "light"); } catch { /* storage blocked */ }
      });
      const page = await context.newPage();
      try {
        await page.goto(`http://${seed.tenantSlug}.localhost:${webPort}/giris`);
        await page.locator('input[name="loginName"]').fill(accounts[role].loginName);
        await page.locator('input[name="password"]').fill(accounts[role].password);
        await Promise.all([page.waitForURL(homes[role], { timeout: 30_000 }), page.getByRole("button", { name: "Giriş yap" }).click()]);
      } catch (error) {
        for (const screen of LANDING_SCREENS.filter((candidate) => candidate.role === role)) {
          for (const viewport of LANDING_SCREENS_VIEWPORTS) results.push(failedScreen(screen, viewport, screenRoute(screen, loaded), `LOGIN_FAILED:${errorCode(error)}`));
        }
        await context.close();
        continue;
      }
      for (const screen of LANDING_SCREENS.filter((candidate) => candidate.role === role)) {
        const route = screenRoute(screen, loaded);
        for (const viewport of LANDING_SCREENS_VIEWPORTS) {
          try {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await page.goto(new URL(route, page.url()).toString(), { waitUntil: "networkidle" });
            await prepareScreen(page, screen, loaded);
            await settle(page);
            await frameScreen(page, screen);
            const alerts = (await page.getByRole("alert").allInnerTexts()).map((text) => text.trim()).filter(Boolean);
            const file = `${screen.id}--${viewport.id}.png`;
            const buffer = await page.screenshot({ path: join(outDir, file), animations: "disabled", caret: "hide", fullPage: false });
            results.push({
              id: screen.id, title: screen.title, role, route: new URL(route, webOrigin).pathname, viewport,
              file, bytes: buffer.length, sha256: sha256Hex(buffer), status: alerts.length > 0 ? "CAPTURED_WITH_ALERTS" : "CAPTURED", alerts,
              examDataLoaded: Boolean(examStack), needsExams: screen.needsExams,
            });
          } catch (error) {
            results.push(failedScreen(screen, viewport, route, errorCode(error)));
          }
        }
      }
      await context.close();
    }
  } finally {
    chromiumVersion = browser.version();
    await browser.close();
  }
  return { screens: results, tool: { node: process.version, playwright: playwrightVersion, chromium: chromiumVersion } };
}

function failedScreen(screen, viewport, route, reason) {
  return { id: screen.id, title: screen.title, role: screen.role, route: new URL(route, webOrigin).pathname, viewport, file: null, bytes: 0, sha256: null, status: "FAILED", reason, alerts: [], examDataLoaded: Boolean(examStack), needsExams: screen.needsExams };
}

function errorCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0].slice(0, 160);
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0, undefined, { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function frameScreen(page, screen) {
  // The pointer stays out of the frame so no row or button shows a hover state.
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  // Panels below the fold are scrolled to the top of the frame; every other screen starts at the top.
  const label = screen.focusLabel;
  if (!label) return;
  await page.getByLabel(label).first().evaluate((element) => {
    // Leave room for the sticky top bar so the panel heading is not covered.
    const top = element.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo(0, Math.max(0, top));
  });
  await page.waitForTimeout(100);
}

function gitCommit() {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean).length;
    return { sha, dirtyFileCount: dirty };
  } catch {
    return { sha: "UNKNOWN", dirtyFileCount: -1 };
  }
}

function writeManifest(seed, screens, { tool }) {
  const manifest = buildProvenanceManifest({
    capturedAt: new Date().toISOString(),
    commit: gitCommit(),
    dataset,
    examsLoaded: Boolean(examStack),
    gaps,
    queueAvailable: Boolean(queueStack),
    adjustments,
    runId,
    screens,
    tool: { ...tool, database: databaseName, tenantSlug: seed.tenantSlug },
  });
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  for (const screen of screens) {
    if (screen.file && !statSync(join(outDir, screen.file)).isFile()) throw new Error(`LANDING_SCREENS_OUTPUT_MISSING:${screen.file}`);
  }
}
