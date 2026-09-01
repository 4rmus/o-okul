import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const targetMigration = "20260831120000_add_student_grade_level";
const connectionString = process.env.STUDENT_GRADE_LEVEL_TEST_DATABASE_URL;
if (!connectionString) throw new Error("STUDENT_GRADE_LEVEL_TEST_DATABASE_URL zorunlu.");

const database = new URL(connectionString);
if (!["127.0.0.1", "localhost"].includes(database.hostname)
  || database.pathname !== "/o_okul_student_grade_level_test") {
  throw new Error("Test yalnız localhost/o_okul_student_grade_level_test üzerinde çalışabilir.");
}

const migrationsRoot = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
const admin = new pg.Client({ connectionString });
let createdGrantRoles = [];

await admin.connect();
try {
  createdGrantRoles = await ensureGrantRoles();
  await resetBeforeTarget();
  await seedLegacyRows({ mismatchedEnrollment: true });
  await assert.rejects(applyTargetMigration, (error) => {
    assert.match(error.message, /STUDENT_ENROLLMENT_GRADE_LEVEL_BACKFILL_MISMATCH/);
    return true;
  });
  await admin.query("ROLLBACK");
  const rolledBackColumn = await admin.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'Student' AND column_name = 'gradeLevelId'`,
  );
  assert.equal(rolledBackColumn.rowCount, 0, "Başarısız cutover kolon eklemesini rollback etmedi.");

  await resetBeforeTarget();
  await seedLegacyRows({ mismatchedEnrollment: false });
  await applyTargetMigration();
  await assertBackfill();
  await assertCreateVsClassGradeRace();
  await assertDeferredConstraint();
  console.log("Student seviye PostgreSQL kontrolü geçti: cutover rollback, backfill, kilit yarışı ve deferred FK doğrulandı.");
} finally {
  await admin.query("ROLLBACK");
  await admin.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
  for (const role of createdGrantRoles.reverse()) await admin.query(`DROP ROLE "${role}"`);
  await admin.end();
}

async function ensureGrantRoles() {
  const roles = ["app", "secret_delivery_worker"];
  const existing = await admin.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])", [roles]);
  const existingNames = new Set(existing.rows.map((row) => row.rolname));
  const created = [];
  for (const role of roles) {
    if (existingNames.has(role)) continue;
    await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
    created.push(role);
  }
  return created;
}

async function resetBeforeTarget() {
  await admin.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
  const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name < targetMigration)
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    await admin.query(await readFile(`${migrationsRoot}/${migration}/migration.sql`, "utf8"));
  }
}

async function seedLegacyRows({ mismatchedEnrollment }) {
  await admin.query(`
    INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt")
    VALUES ('gate-tenant', 'Gate Tenant', 'gate-tenant', now());
    INSERT INTO "GradeLevel" ("id", "tenantId", "name", "code", "updatedAt")
    VALUES ('grade-8', 'gate-tenant', '8. Sınıf', '8', now());
    INSERT INTO "Class" ("id", "tenantId", "gradeLevelId", "name", "updatedAt")
    VALUES ('class-8-a', 'gate-tenant', 'grade-8', '8-A', now());
    INSERT INTO "Student" ("id", "tenantId", "classId", "firstName", "lastName", "studentNo", "updatedAt")
    VALUES ('legacy-student', 'gate-tenant', 'class-8-a', 'Ada', 'Kaya', 'LEGACY-1', now());
    INSERT INTO "StudentEnrollment" ("id", "tenantId", "studentId", "classId", "status", "startsAt", "updatedAt")
    VALUES ('legacy-enrollment', 'gate-tenant', 'legacy-student', ${mismatchedEnrollment ? "NULL" : "'class-8-a'"}, 'ACTIVE', '2026-08-31', now());
  `);
}

async function applyTargetMigration() {
  await admin.query(await readFile(`${migrationsRoot}/${targetMigration}/migration.sql`, "utf8"));
}

async function assertBackfill() {
  const result = await admin.query(`
    SELECT student."gradeLevelId" AS student_grade,
           enrollment."gradeLevelId" AS enrollment_grade,
           enrollment."classId" AS enrollment_class
    FROM "Student" student
    JOIN "StudentEnrollment" enrollment ON enrollment."studentId" = student."id"
    WHERE student."id" = 'legacy-student'
  `);
  assert.deepEqual(result.rows[0], {
    student_grade: "grade-8",
    enrollment_grade: "grade-8",
    enrollment_class: "class-8-a",
  });
}

async function assertCreateVsClassGradeRace() {
  await admin.query(`INSERT INTO "GradeLevel" ("id", "tenantId", "name", "code", "updatedAt")
                     VALUES ('grade-9', 'gate-tenant', '9. Sınıf', '9', now())`);
  const creator = new pg.Client({ connectionString });
  const updater = new pg.Client({ connectionString });
  await Promise.all([creator.connect(), updater.connect()]);
  try {
    await creator.query("BEGIN");
    await creator.query(`SELECT "gradeLevelId" FROM "Class" WHERE "id" = 'class-8-a' FOR SHARE`);

    let updaterHasLock = false;
    const update = (async () => {
      await updater.query("BEGIN");
      await updater.query(`SELECT 1 FROM "Class" WHERE "id" = 'class-8-a' FOR UPDATE`);
      updaterHasLock = true;
      await updater.query(`UPDATE "Class" SET "gradeLevelId" = 'grade-9' WHERE "id" = 'class-8-a'`);
      await updater.query(`UPDATE "Student" SET "gradeLevelId" = 'grade-9' WHERE "classId" = 'class-8-a'`);
      await updater.query(`UPDATE "StudentEnrollment" SET "gradeLevelId" = 'grade-9'
                           WHERE "classId" = 'class-8-a' AND "status" = 'ACTIVE' AND "endsAt" IS NULL`);
      await updater.query("COMMIT");
    })();

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(updaterHasLock, false, "Class FOR UPDATE, öğrenci create FOR SHARE kilidini beklemedi.");
    await creator.query(`INSERT INTO "Student" ("id", "tenantId", "gradeLevelId", "classId", "firstName", "lastName", "studentNo", "updatedAt")
                         VALUES ('race-student', 'gate-tenant', 'grade-8', 'class-8-a', 'Yarış', 'Öğrenci', 'RACE-1', now())`);
    await creator.query(`INSERT INTO "StudentEnrollment" ("id", "tenantId", "studentId", "gradeLevelId", "classId", "status", "startsAt", "updatedAt")
                         VALUES ('race-open', 'gate-tenant', 'race-student', 'grade-8', 'class-8-a', 'ACTIVE', '2026-08-31', now()),
                                ('race-closed', 'gate-tenant', 'race-student', 'grade-8', 'class-8-a', 'PASSIVE', '2025-09-01', now())`);
    await creator.query("COMMIT");
    await update;

    const state = await admin.query(`
      SELECT student."gradeLevelId" AS student_grade,
             open."gradeLevelId" AS open_grade,
             closed."gradeLevelId" AS closed_grade
      FROM "Student" student
      JOIN "StudentEnrollment" open ON open."id" = 'race-open'
      JOIN "StudentEnrollment" closed ON closed."id" = 'race-closed'
      WHERE student."id" = 'race-student'
    `);
    assert.deepEqual(state.rows[0], { student_grade: "grade-9", open_grade: "grade-9", closed_grade: "grade-8" });
  } finally {
    await Promise.all([creator.end(), updater.end()]);
  }
}

async function assertDeferredConstraint() {
  const constraint = await admin.query(`
    SELECT condeferrable, condeferred FROM pg_constraint
    WHERE conname = 'Student_tenantId_classId_gradeLevelId_fkey'
  `);
  assert.deepEqual(constraint.rows[0], { condeferrable: true, condeferred: true });
  await admin.query("BEGIN");
  try {
    await admin.query(`INSERT INTO "Student" ("id", "tenantId", "gradeLevelId", "classId", "firstName", "lastName", "studentNo", "updatedAt")
                       VALUES ('mismatch-student', 'gate-tenant', 'grade-8', 'class-8-a', 'Hatalı', 'Öğrenci', 'BAD-1', now())`);
    await assert.rejects(admin.query("COMMIT"), (error) => error.code === "23503");
  } finally {
    await admin.query("ROLLBACK");
  }
}
