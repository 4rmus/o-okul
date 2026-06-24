import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul";
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/o_okul";
const runId = randomUUID();
const tenantA = `tenant-store-smoke-a-${runId}`;
const tenantB = `tenant-store-smoke-b-${runId}`;
const userId = `user-store-smoke-${runId}`;
const userIds = [userId];
const tokenFamilyIds = [];

process.env.DATABASE_URL = databaseUrl;

const postgresUrl = new URL(directDatabaseUrl);
await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");

const { runWithRequestContext } = await import("../apps/api/dist/context/request-context.js");
const { AuthService } = await import("../apps/api/dist/auth/auth.service.js");
const { PostgresAuthUserStore, hashPassword, verifyPassword } = await import("../apps/api/dist/auth/auth-user-store.js");
const { PostgresPasswordResetStore } = await import("../apps/api/dist/auth/password-reset-store.js");
const { PostgresSessionStore, hashRefreshToken } = await import("../apps/api/dist/auth/session-store.js");
const { TokenService } = await import("../apps/api/dist/auth/token-service.js");
const { PostgresIdentityInvitationStore } = await import("../apps/api/dist/identity-invitation/identity-invitation-store.js");
const { IdentityInvitationService } = await import("../apps/api/dist/identity-invitation/identity-invitation.service.js");
const { PostgresTenantStore } = await import("../apps/api/dist/tenant/tenant-store.js");
const { PostgresUserManagementStore } = await import("../apps/api/dist/user-management/user-management-store.js");
const { PostgresClassStore } = await import("../apps/api/dist/school/class-store.js");
const { PostgresScheduleStore } = await import("../apps/api/dist/program/schedule-store.js");
const { PostgresStudySessionStore } = await import("../apps/api/dist/program/study-session-store.js");
const { PostgresHomeworkStore } = await import("../apps/api/dist/homework/homework-store.js");
const { PostgresStudentStore } = await import("../apps/api/dist/student/student-store.js");
const { PostgresTeacherStore } = await import("../apps/api/dist/school/teacher-store.js");
const { PostgresGuardianStore } = await import("../apps/api/dist/school/guardian-store.js");
const { PostgresGuardianStudentStore } = await import("../apps/api/dist/school/guardian-student-store.js");
const { PostgresPaymentPlanStore } = await import("../apps/api/dist/payment/payment-store.js");

const appPool = new pg.Pool({ connectionString: databaseUrl });
const directPool = new pg.Pool({ connectionString: directDatabaseUrl });

try {
  await seedSupportRows();

  const classStore = new PostgresClassStore(appPool);
  const scheduleStore = new PostgresScheduleStore(appPool);
  const studySessionStore = new PostgresStudySessionStore(appPool);
  const homeworkStore = new PostgresHomeworkStore(appPool);
  const studentStore = new PostgresStudentStore(appPool);
  const teacherStore = new PostgresTeacherStore(appPool);
  const guardianStore = new PostgresGuardianStore(appPool);
  const guardianStudentStore = new PostgresGuardianStudentStore(appPool);
  const paymentPlanStore = new PostgresPaymentPlanStore(appPool);
  const authUserStore = new PostgresAuthUserStore(appPool);
  const sessionStore = new PostgresSessionStore(appPool);
  const passwordResetStore = new PostgresPasswordResetStore(appPool);
  const authService = new AuthService(authUserStore, sessionStore, passwordResetStore, { resolve: async () => undefined });
  const tokenService = new TokenService(sessionStore, "postgres-store-smoke-secret");
  const identityInvitationStore = new PostgresIdentityInvitationStore(appPool);
  const tenantStore = new PostgresTenantStore(appPool);
  const userManagementStore = new PostgresUserManagementStore(appPool);
  const identityInvitationService = new IdentityInvitationService(
    identityInvitationStore,
    userManagementStore,
    studentStore,
    guardianStore,
    teacherStore,
    tenantStore,
  );

  const authUser = await authUserStore.findByEmail(`store-smoke-${runId}@example.test`);
  assertEqual(authUser?.id, userId, "AUTH_USER_STORE_LOGIN_SOURCE_MISMATCH");
  assertEqual(authUser?.tenantId, tenantA, "AUTH_USER_STORE_TENANT_MISMATCH");
  assertArrayEqual(authUser?.roles ?? [], ["TENANT_ADMIN"], "AUTH_USER_STORE_ROLES_MISMATCH");
  if (!verifyPassword("password", authUser.passwordHash)) {
    throw new Error("AUTH_USER_STORE_PASSWORD_HASH_MISMATCH");
  }

  const issued = await tokenService.issue({
    sub: authUser.id,
    tenantId: authUser.tenantId,
    roles: authUser.roles,
    membershipVersion: authUser.membershipVersion,
  });
  tokenFamilyIds.push(issued.session.tokenFamilyId);
  const sessionRow = await directBypassQuery(`SELECT COUNT(*)::int AS count FROM "AuthSession" WHERE "id" = $1`, [
    issued.session.id,
  ]);
  assertEqual(sessionRow.rows[0]?.count, 1, "AUTH_SESSION_STORE_CREATE_MISMATCH");
  const rotated = await tokenService.rotate(issued.refreshToken);
  const consumedRow = await directBypassQuery(
    `SELECT COUNT(*)::int AS count FROM "ConsumedRefreshToken" WHERE "refreshTokenHash" = $1`,
    [hashRefreshToken(issued.refreshToken)],
  );
  assertEqual(consumedRow.rows[0]?.count, 1, "AUTH_SESSION_CONSUMED_TOKEN_MISMATCH");
  await assertRejects(() => tokenService.rotate(issued.refreshToken), "REFRESH_TOKEN_REUSE_DETECTED");
  await assertRejects(() => tokenService.rotate(rotated.refreshToken), "REFRESH_TOKEN_REUSE_DETECTED");

  const resetSession = await tokenService.issue({
    sub: authUser.id,
    tenantId: authUser.tenantId,
    roles: authUser.roles,
    membershipVersion: authUser.membershipVersion,
  });
  tokenFamilyIds.push(resetSession.session.tokenFamilyId);
  const resetIssue = await authService.requestPasswordReset(`store-smoke-${runId}@example.test`);
  assertEqual(resetIssue.status, "ISSUED", "PASSWORD_RESET_REQUEST_MISMATCH");
  if (!resetIssue.resetToken) {
    throw new Error("PASSWORD_RESET_TOKEN_MISSING");
  }
  await authService.confirmPasswordReset(resetIssue.resetToken, "password2");
  await assertRejects(() => authService.login(`store-smoke-${runId}@example.test`, "password"), "LOGIN_FAILED");
  await assertRejects(() => authService.confirmPasswordReset(resetIssue.resetToken, "password3"), "PASSWORD_RESET_NOT_PENDING");
  await assertRejects(() => tokenService.rotate(resetSession.refreshToken), "REFRESH_TOKEN_REUSE_DETECTED");
  const resetLogin = await authService.login(`store-smoke-${runId}@example.test`, "password2");
  tokenFamilyIds.push(resetLogin.session.tokenFamilyId);

  const tenantUsers = await userManagementStore.listTenantUsers(tenantA);
  assertIncludesId(tenantUsers, userId, "USER_MANAGEMENT_LIST_MISMATCH");
  const managedUser = await userManagementStore.createOrAttachTenantUser({
    tenantId: tenantA,
    email: `managed-${runId}@example.test`,
    name: "Managed Store User",
    password: "password1",
    roles: ["TEACHER"],
  });
  userIds.push(managedUser.id);
  assertArrayEqual(managedUser.roles, ["TEACHER"], "USER_MANAGEMENT_CREATE_ROLES_MISMATCH");
  const updatedManagedUser = await userManagementStore.setTenantRoles(tenantA, managedUser.id, ["STUDENT"]);
  assertArrayEqual(updatedManagedUser?.roles ?? [], ["STUDENT"], "USER_MANAGEMENT_UPDATE_ROLES_MISMATCH");
  await assertEmptyFromTenant(tenantB, () => userManagementStore.listTenantUsers(tenantB), "USER_MANAGEMENT_RLS_LEAK");

  const classRecord = await withTenant(tenantA, () =>
    classStore.create({ tenantId: tenantA, name: "Store Smoke 8-A", level: "8" }),
  );
  assertEqual(classRecord.tenantId, tenantA, "CLASS_TENANT_MISMATCH");
  assertEqual(classRecord.name, "Store Smoke 8-A", "CLASS_CREATE_MISMATCH");
  await assertInvisibleFromTenant(tenantB, () => classStore.findById(classRecord.id), "CLASS_RLS_LEAK");

  const updatedClass = await withTenant(tenantA, () => classStore.update(classRecord.id, { name: "Store Smoke 8-B" }));
  assertEqual(updatedClass?.name, "Store Smoke 8-B", "CLASS_UPDATE_MISMATCH");

  const student = await withTenant(tenantA, () =>
    studentStore.create({ tenantId: tenantA, firstName: "Store", lastName: "Student" }),
  );
  assertEqual(student.tenantId, tenantA, "STUDENT_TENANT_MISMATCH");
  await assertInvisibleFromTenant(tenantB, () => studentStore.findById(student.id), "STUDENT_RLS_LEAK");

  const studentInvite = await withTenant(tenantA, () =>
    identityInvitationService.create(
      { userId, tenantId: tenantA, roles: ["TENANT_ADMIN"], bypassRls: false },
      {
        subjectType: "STUDENT",
        subjectId: student.id,
        email: `invited-student-${runId}@example.test`,
      },
    ),
  );
  const acceptedStudentInvite = await identityInvitationService.accept({
    token: studentInvite.activationToken,
    password: "password1",
  });
  if (!acceptedStudentInvite.acceptedUserId) {
    throw new Error("IDENTITY_INVITATION_ACCEPTED_USER_MISSING");
  }
  userIds.push(acceptedStudentInvite.acceptedUserId);
  const linkedStudent = await withTenant(tenantA, () => studentStore.findById(student.id));
  assertEqual(linkedStudent?.userId, acceptedStudentInvite.acceptedUserId, "IDENTITY_INVITATION_STUDENT_LINK_MISMATCH");
  const invitedAuthUser = await authUserStore.findByEmail(`invited-student-${runId}@example.test`);
  assertArrayEqual(invitedAuthUser?.roles ?? [], ["STUDENT"], "IDENTITY_INVITATION_AUTH_ROLE_MISMATCH");

  const importedStudents = await withTenant(tenantA, () =>
    studentStore.createMany([{ tenantId: tenantA, firstName: "Store", lastName: "Import" }]),
  );
  assertEqual(importedStudents.length, 1, "STUDENT_CREATE_MANY_MISMATCH");

  const updatedStudent = await withTenant(tenantA, () => studentStore.update(student.id, { firstName: "Store Guncel" }));
  assertEqual(updatedStudent?.firstName, "Store Guncel", "STUDENT_UPDATE_MISMATCH");

  const paymentPlan = await withTenant(tenantA, () =>
    paymentPlanStore.create({
      plan: {
        tenantId: tenantA,
        studentId: student.id,
        title: "Store Smoke Odeme",
        totalAmount: 100000,
        currency: "TRY",
      },
      installments: [
        { installmentNo: 1, amount: 50000, dueDate: "2026-07-01", status: "PENDING" },
        { installmentNo: 2, amount: 50000, dueDate: "2026-08-01", status: "PENDING" },
      ],
    }),
  );
  assertEqual(paymentPlan.studentId, student.id, "PAYMENT_PLAN_CREATE_MISMATCH");
  assertEqual(paymentPlan.installments.length, 2, "PAYMENT_INSTALLMENT_CREATE_MISMATCH");
  await assertInvisibleFromTenant(tenantB, () => paymentPlanStore.findById(paymentPlan.id), "PAYMENT_PLAN_RLS_LEAK");

  const teacher = await withTenant(tenantA, () =>
    teacherStore.create({ tenantId: tenantA, firstName: "Store", lastName: "Teacher", branch: "Matematik" }),
  );
  assertEqual(teacher.tenantId, tenantA, "TEACHER_TENANT_MISMATCH");
  await assertInvisibleFromTenant(tenantB, () => teacherStore.findById(teacher.id), "TEACHER_RLS_LEAK");

  const updatedTeacher = await withTenant(tenantA, () => teacherStore.update(teacher.id, { branch: "Fen" }));
  assertEqual(updatedTeacher?.branch, "Fen", "TEACHER_UPDATE_MISMATCH");

  const guardian = await withTenant(tenantA, () =>
    guardianStore.create({ tenantId: tenantA, firstName: "Store", lastName: "Guardian", phone: "5000000099" }),
  );
  assertEqual(guardian.tenantId, tenantA, "GUARDIAN_TENANT_MISMATCH");
  await assertInvisibleFromTenant(tenantB, () => guardianStore.findById(guardian.id), "GUARDIAN_RLS_LEAK");

  const updatedGuardian = await withTenant(tenantA, () => guardianStore.update(guardian.id, { phone: "5000000100" }));
  assertEqual(updatedGuardian?.phone, "5000000100", "GUARDIAN_UPDATE_MISMATCH");

  const guardianStudent = await withTenant(tenantA, () =>
    guardianStudentStore.create({ tenantId: tenantA, guardianId: guardian.id, studentId: student.id }),
  );
  assertEqual(guardianStudent.studentId, student.id, "GUARDIAN_STUDENT_CREATE_MISMATCH");
  const guardianStudents = await withTenant(tenantA, () => guardianStudentStore.listByGuardian(guardian.id));
  assertIncludesId(guardianStudents, guardianStudent.id, "GUARDIAN_STUDENT_LIST_MISMATCH");
  await assertEmptyFromTenant(tenantB, () => guardianStudentStore.listByGuardian(guardian.id), "GUARDIAN_STUDENT_RLS_LEAK");

  const schedule = await withTenant(tenantA, () =>
    scheduleStore.create({
      tenantId: tenantA,
      classId: classRecord.id,
      teacherId: teacher.id,
      title: "Matematik",
      startsAt: "2026-06-10T09:00:00.000Z",
      endsAt: "2026-06-10T10:00:00.000Z",
    }),
  );
  assertEqual(schedule.teacherId, teacher.id, "SCHEDULE_CREATE_MISMATCH");
  await assertInvisibleFromTenant(tenantB, () => scheduleStore.findById(schedule.id), "SCHEDULE_RLS_LEAK");

  const updatedSchedule = await withTenant(tenantA, () => scheduleStore.update(schedule.id, { title: "Matematik Etkinlik" }));
  assertEqual(updatedSchedule?.title, "Matematik Etkinlik", "SCHEDULE_UPDATE_MISMATCH");

  const studySession = await withTenant(tenantA, () =>
    studySessionStore.create({
      tenantId: tenantA,
      classId: classRecord.id,
      teacherId: teacher.id,
      studentIds: [student.id],
      title: "Etut",
      capacity: 4,
      startsAt: "2026-06-10T11:00:00.000Z",
      endsAt: "2026-06-10T12:00:00.000Z",
    }),
  );
  assertArrayEqual(studySession.studentIds, [student.id], "STUDY_SESSION_STUDENTS_MISMATCH");
  await assertInvisibleFromTenant(tenantB, () => studySessionStore.findById(studySession.id), "STUDY_SESSION_RLS_LEAK");

  const updatedStudySession = await withTenant(tenantA, () =>
    studySessionStore.update(studySession.id, { title: "Etut Guncel", capacity: 5, studentIds: [student.id] }),
  );
  assertEqual(updatedStudySession?.capacity, 5, "STUDY_SESSION_UPDATE_MISMATCH");

  const material = await withTenant(tenantA, () =>
    homeworkStore.createMaterial({ tenantId: tenantA, title: "Kesirler", description: "Canli store smoke" }),
  );
  assertEqual(material.title, "Kesirler", "HOMEWORK_MATERIAL_CREATE_MISMATCH");
  await assertInvisibleFromTenant(tenantB, () => homeworkStore.findMaterialById(material.id), "HOMEWORK_MATERIAL_RLS_LEAK");

  const updatedMaterial = await withTenant(tenantA, () =>
    homeworkStore.updateMaterial(material.id, { title: "Kesirler Guncel", description: "Canli store smoke guncel" }),
  );
  assertEqual(updatedMaterial?.title, "Kesirler Guncel", "HOMEWORK_MATERIAL_UPDATE_MISMATCH");

  const materialFile = await withTenant(tenantA, () =>
    homeworkStore.createMaterialFile({
      tenantId: tenantA,
      materialId: material.id,
      uploadedById: userId,
      fileName: "kesirler.txt",
      contentType: "text/plain",
      byteSize: 11,
      sha256: "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
      contentBase64: "aGVsbG8gd29ybGQ=",
      createdAt: "2026-06-10T09:00:00.000Z",
    }),
  );
  const materialFiles = await withTenant(tenantA, () => homeworkStore.listMaterialFiles(material.id));
  assertIncludesId(materialFiles, materialFile.id, "HOMEWORK_MATERIAL_FILE_LIST_MISMATCH");

  const materialAssignment = await withTenant(tenantA, () =>
    homeworkStore.createMaterialAssignment({
      tenantId: tenantA,
      materialId: material.id,
      studentId: student.id,
      assignedById: userId,
      note: "Tekrar",
      dueAt: "2026-06-11T12:00:00.000Z",
      createdAt: "2026-06-10T09:30:00.000Z",
    }),
  );
  const materialAssignments = await withTenant(tenantA, () => homeworkStore.listMaterialAssignments(material.id));
  assertIncludesId(materialAssignments, materialAssignment.id, "HOMEWORK_MATERIAL_ASSIGNMENT_LIST_MISMATCH");

  const homework = await withTenant(tenantA, () =>
    homeworkStore.create({
      tenantId: tenantA,
      classId: classRecord.id,
      sourceMaterialId: material.id,
      sourceMaterialTitle: updatedMaterial.title,
      title: "Kesirler Guncel",
      description: "1-20 arasi sorular",
      dueAt: "2026-06-12T12:00:00.000Z",
    }),
  );
  assertEqual(homework.sourceMaterialId, material.id, "HOMEWORK_CREATE_MISMATCH");
  await assertInvisibleFromTenant(tenantB, () => homeworkStore.findById(homework.id), "HOMEWORK_RLS_LEAK");

  const updatedHomework = await withTenant(tenantA, () =>
    homeworkStore.update(homework.id, { title: "Kesirler Kontrol", description: "1-25 arasi sorular" }),
  );
  assertEqual(updatedHomework?.title, "Kesirler Kontrol", "HOMEWORK_UPDATE_MISMATCH");

  const checkedHomework = await withTenant(tenantA, () =>
    homeworkStore.updateCheckStatus(homework.id, "2026-06-12T13:00:00.000Z", userId),
  );
  assertEqual(checkedHomework?.checkedBy, userId, "HOMEWORK_CHECK_STATUS_MISMATCH");

  await withTenant(tenantA, () => homeworkStore.softDelete(homework.id, "2026-06-13T09:00:00.000Z"));
  await withTenant(tenantA, () => homeworkStore.softDeleteMaterial(material.id, "2026-06-13T09:01:00.000Z"));
  await withTenant(tenantA, () => studySessionStore.softDelete(studySession.id, "2026-06-13T09:02:00.000Z"));
  await withTenant(tenantA, () => scheduleStore.softDelete(schedule.id, "2026-06-13T09:03:00.000Z"));
  const deletedGuardianStudent = await withTenant(tenantA, () => guardianStudentStore.delete(guardian.id, student.id));
  assertEqual(deletedGuardianStudent, true, "GUARDIAN_STUDENT_DELETE_MISMATCH");
  const purgedGuardian = await withTenant(tenantA, () => guardianStore.purgePii(guardian.id));
  assertEqual(purgedGuardian?.firstName, "Anonim", "GUARDIAN_PURGE_MISMATCH");
  const deletedGuardian = await withTenant(tenantA, () => guardianStore.softDelete(guardian.id, "2026-06-13T09:03:10.000Z"));
  if (!deletedGuardian?.deletedAt) {
    throw new Error("GUARDIAN_SOFT_DELETE_MISMATCH");
  }
  const purgedTeacher = await withTenant(tenantA, () => teacherStore.purgePii(teacher.id));
  assertEqual(purgedTeacher?.firstName, "Anonim", "TEACHER_PURGE_MISMATCH");
  const deletedTeacher = await withTenant(tenantA, () => teacherStore.softDelete(teacher.id, "2026-06-13T09:03:20.000Z"));
  if (!deletedTeacher?.deletedAt) {
    throw new Error("TEACHER_SOFT_DELETE_MISMATCH");
  }
  const purgedStudent = await withTenant(tenantA, () => studentStore.purgePii(student.id));
  assertEqual(purgedStudent?.firstName, "Anonim", "STUDENT_PURGE_MISMATCH");
  const deletedStudent = await withTenant(tenantA, () => studentStore.softDelete(student.id, "2026-06-13T09:03:30.000Z"));
  if (!deletedStudent?.deletedAt) {
    throw new Error("STUDENT_SOFT_DELETE_MISMATCH");
  }
  const deletedClass = await withTenant(tenantA, () => classStore.softDelete(classRecord.id, "2026-06-13T09:04:00.000Z"));
  if (!deletedClass?.deletedAt) {
    throw new Error("CLASS_SOFT_DELETE_MISMATCH");
  }

  console.log(
    `Postgres store smoke gecti: auth-user, auth-session, password-reset, user-management, identity-invitation, class, teacher, guardian, guardian-student, student, payment-plan, schedule, study-session, homework/material tenant izolasyonu dogrulandi (${tenantA}).`,
  );
} finally {
  await cleanup();
  await appPool.end();
  await directPool.end();
}

async function withTenant(tenantId, callback) {
  return runWithRequestContext(
    {
      userId,
      tenantId,
      roles: ["TENANT_ADMIN"],
      bypassRls: false,
    },
    callback,
  );
}

async function seedSupportRows() {
  const client = await directPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    await client.query(
      `INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt")
       VALUES ($1, 'Store Smoke A', $2, 'ACTIVE', now()), ($3, 'Store Smoke B', $4, 'ACTIVE', now())`,
      [tenantA, `store-smoke-a-${runId}`, tenantB, `store-smoke-b-${runId}`],
    );
    await client.query(
      `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
       VALUES ($1, $2, 'Store Smoke User', $3, now())`,
      [userId, `store-smoke-${runId}@example.test`, hashPassword("password", `store-smoke-${runId}`)],
    );
    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
       VALUES ($1, $2, $3, 'TENANT_ADMIN', now())`,
      [`membership-store-smoke-${runId}`, tenantA, userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`POSTGRES_STORE_SMOKE_SEED_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

async function cleanup() {
  const client = await directPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    if (tokenFamilyIds.length > 0) {
      await client.query(`DELETE FROM "ConsumedRefreshToken" WHERE "tokenFamilyId" = ANY($1::text[])`, [
        tokenFamilyIds,
      ]);
    }
    await client.query(`DELETE FROM "Tenant" WHERE "id" = ANY($1::text[])`, [[tenantA, tenantB]]);
    await client.query(`DELETE FROM "User" WHERE "id" = ANY($1::text[])`, [userIds]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.warn(`Postgres store smoke temizligi tamamlanamadi: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

async function directBypassQuery(sql, values = []) {
  const client = await directPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const result = await client.query(sql, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertInvisibleFromTenant(tenantId, finder, errorCode) {
  const record = await withTenant(tenantId, finder);
  if (record !== undefined) {
    throw new Error(errorCode);
  }
}

async function assertEmptyFromTenant(tenantId, finder, errorCode) {
  const records = await withTenant(tenantId, finder);
  if (records.length !== 0) {
    throw new Error(errorCode);
  }
}

function assertEqual(actual, expected, errorCode) {
  if (actual !== expected) {
    throw new Error(`${errorCode}: expected=${expected} actual=${actual}`);
  }
}

function assertArrayEqual(actual, expected, errorCode) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${errorCode}: expected=${expected.join(",")} actual=${actual.join(",")}`);
  }
}

function assertIncludesId(records, id, errorCode) {
  if (!records.some((record) => record.id === id)) {
    throw new Error(errorCode);
  }
}

async function assertRejects(callback, expectedMessage) {
  try {
    await callback();
  } catch (error) {
    if (error instanceof Error && error.message === expectedMessage) {
      return;
    }
    throw error;
  }
  throw new Error(`EXPECTED_REJECTION: ${expectedMessage}`);
}

async function assertPort(name, host, port, hint) {
  await new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`${name} portu acik degil: ${host}:${port}. Once ${hint} calistirin.`));
    });
    socket.once("error", () => {
      socket.destroy();
      reject(new Error(`${name} portu acik degil: ${host}:${port}. Once ${hint} calistirin.`));
    });
    socket.connect(port, host);
  });
}
