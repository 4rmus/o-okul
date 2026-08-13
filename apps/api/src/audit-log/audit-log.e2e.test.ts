import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ExcelJS from "exceljs";
import request from "supertest";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Audit log API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;
  let teacherAAccessToken: string;
  let systemAccessToken: string;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    upsertInMemoryAuthUser({
      id: "user-tenant-a",
      email: "admin-a@example.test",
      name: "Tenant A Admin",
      password: "password",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membership: {
        id: "membership-tenant-a-admin",
        staffRole: "TENANT_ADMIN",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 2,
        scopeMode: "TENANT",
        campusIds: [],
      },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    const login = await request(server)
      .post("/auth/login")
      .send(testLoginBody("admin-a@example.test"))
      .expect(200);
    tenantAAccessToken = (login.body as { accessToken: string }).accessToken;

    const teacherLogin = await request(server)
      .post("/auth/login")
      .send(testLoginBody("teacher-a@example.test"))
      .expect(200);
    teacherAAccessToken = (teacherLogin.body as { accessToken: string }).accessToken;

    const systemLogin = await request(server)
      .post("/auth/login")
      .send(testLoginBody("system@example.test"))
      .expect(200);
    systemAccessToken = (systemLogin.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  it("tenant admin sadece kendi tenant audit kayıtlarını listeler", async () => {
    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "audit-log-a",
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "SupportTicket",
        entityId: "support-ticket-a",
        action: "support_ticket.created",
      }),
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "Auth",
        entityId: "user-tenant-a",
        action: "auth.login",
      }),
    ]));
    expect((response.body as Array<{ tenantId?: string }>).every((record) => record.tenantId === "tenant-a")).toBe(true);
  });

  it("destek bildirimi oluşturma ve güncelleme audit kaydı üretir", async () => {
    const created = await request(server)
      .post("/support-tickets")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        subject: "Audit izleme",
        message: "Audit kayıtları kontrol ediliyor.",
        priority: "NORMAL",
      })
      .expect(201);

    await request(server)
      .patch(`/support-tickets/${(created.body as { id: string }).id}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ status: "IN_PROGRESS", priority: "HIGH" })
      .expect(200);

    const attachment = await request(server)
      .post(`/support-tickets/${(created.body as { id: string }).id}/attachments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "gizli-ek.txt",
        contentType: "text/plain",
        fileBase64: Buffer.from("Gizli ek icerigi").toString("base64"),
      })
      .expect(201);

    const comment = await request(server)
      .post(`/support-tickets/${(created.body as { id: string }).id}/comments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ body: "Gizli yorum metni" })
      .expect(201);

    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "SupportTicket",
        entityId: (created.body as { id: string }).id,
        action: "support_ticket.created",
      }),
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "SupportTicket",
        entityId: (created.body as { id: string }).id,
        action: "support_ticket.updated",
        diff: {
          before: { priority: "NORMAL", status: "OPEN" },
          after: { priority: "HIGH", status: "IN_PROGRESS" },
        },
      }),
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "SupportTicketAttachment",
        entityId: (attachment.body as { id: string }).id,
        action: "support_ticket_attachment.created",
        diff: {
          ticketId: (created.body as { id: string }).id,
          contentType: "text/plain",
          byteSize: Buffer.from("Gizli ek icerigi").byteLength,
          sha256: expect.any(String),
        },
      }),
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "SupportTicketComment",
        entityId: (comment.body as { id: string }).id,
        action: "support_ticket_comment.created",
        diff: { ticketId: (created.body as { id: string }).id, bodyLength: "Gizli yorum metni".length },
      }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain("gizli-ek.txt");
    expect(JSON.stringify(response.body)).not.toContain("Gizli ek icerigi");
    expect(JSON.stringify(response.body)).not.toContain("Gizli yorum metni");
  });

  it("class oluşturma, güncelleme ve silme işlemleri audit kaydı üretir", async () => {
    const created = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Audit 6-A" })
      .expect(201);
    const classId = (created.body as { id: string }).id;

    await request(server)
      .patch(`/classes/${classId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "Audit 6 Fen" })
      .expect(200);

    await request(server)
      .delete(`/classes/${classId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);

    await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ tenantId: "tenant-b", name: "Gizli Audit Sınıfı" })
      .expect(403);

    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "Class",
        entityId: classId,
        action: "class.created",
        diff: { name: "[REDACTED]" },
      }),
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "Class",
        entityId: classId,
        action: "class.updated",
        diff: {
          before: { name: "[REDACTED]" },
          after: { name: "[REDACTED]" },
        },
      }),
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "Class",
        entityId: classId,
        action: "class.deleted",
        diff: expect.objectContaining({
          name: "[REDACTED]",
          deletedAt: expect.any(String),
        }),
      }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain("Audit 6-A");
    expect(JSON.stringify(response.body)).not.toContain("Audit 6 Fen");
    expect(JSON.stringify(response.body)).not.toContain("Gizli Audit Sınıfı");
  });

  it("öğrenci, öğretmen ve veli CRUD işlemleri PII saklamadan audit kaydı üretir", async () => {
    const student = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "DenetimGizli", lastName: "Ogrenci" })
      .expect(201);
    const studentId = (student.body as { id: string }).id;

    await request(server)
      .patch(`/students/${studentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "DenetimGizliGuncel" })
      .expect(200);

    await request(server)
      .delete(`/students/${studentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);

    const teacher = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "DenetimGizli", lastName: "Ogretmen", branch: "Fen" })
      .expect(201);
    const teacherId = (teacher.body as { id: string }).id;

    await request(server)
      .patch(`/teachers/${teacherId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ branch: "Matematik" })
      .expect(200);

    await request(server)
      .delete(`/teachers/${teacherId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);

    const guardian = await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "DenetimGizli", lastName: "Veli", phone: "5000000088" })
      .expect(201);
    const guardianId = (guardian.body as { id: string }).id;

    await request(server)
      .patch(`/guardians/${guardianId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ phone: "5000000089" })
      .expect(200);

    await request(server)
      .delete(`/guardians/${guardianId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);

    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: "Student",
        entityId: studentId,
        action: "student.created",
        diff: { fieldsSet: ["studentNo", "firstName", "lastName", "status"] },
      }),
      expect.objectContaining({
        entityType: "Student",
        entityId: studentId,
        action: "student.updated",
        diff: { fieldsChanged: ["firstName"] },
      }),
      expect.objectContaining({
        entityType: "Student",
        entityId: studentId,
        action: "student.deleted",
        diff: expect.objectContaining({ deletedAt: expect.any(String) }),
      }),
      expect.objectContaining({
        entityType: "Teacher",
        entityId: teacherId,
        action: "teacher.created",
        diff: { fieldsSet: ["firstName", "lastName", "branch"] },
      }),
      expect.objectContaining({
        entityType: "Teacher",
        entityId: teacherId,
        action: "teacher.updated",
        diff: { fieldsChanged: ["branch"] },
      }),
      expect.objectContaining({
        entityType: "Teacher",
        entityId: teacherId,
        action: "teacher.deleted",
        diff: expect.objectContaining({ deletedAt: expect.any(String) }),
      }),
      expect.objectContaining({
        entityType: "Guardian",
        entityId: guardianId,
        action: "guardian.created",
        diff: { fieldsSet: ["firstName", "lastName", "phone"] },
      }),
      expect.objectContaining({
        entityType: "Guardian",
        entityId: guardianId,
        action: "guardian.updated",
        diff: { fieldsChanged: ["phone"] },
      }),
      expect.objectContaining({
        entityType: "Guardian",
        entityId: guardianId,
        action: "guardian.deleted",
        diff: expect.objectContaining({ deletedAt: expect.any(String) }),
      }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain("DenetimGizli");
    expect(JSON.stringify(response.body)).not.toContain("5000000088");
    expect(JSON.stringify(response.body)).not.toContain("5000000089");
  });

  it("veli-öğrenci izin değişikliklerini PII saklamadan audit'e yazar", async () => {
    const guardian = await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "DenetimGizli", lastName: "Iliski", phone: "5000000099" })
      .expect(201);
    const guardianId = (guardian.body as { id: string }).id;

    const linked = await request(server)
      .post(`/guardians/${guardianId}/students`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentId: "student-a", canViewFinance: false })
      .expect(201);

    await request(server)
      .patch(`/guardians/${guardianId}/students/student-a`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ canReceiveSms: false })
      .expect(200);

    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: "GuardianStudent",
        entityId: linked.body.id,
        action: "guardian_student.linked",
          diff: expect.objectContaining({
            guardianId,
            studentId: "student-a",
            fieldsSet: expect.arrayContaining(["canViewFinance"]),
          }),
      }),
      expect.objectContaining({
        entityType: "GuardianStudent",
        entityId: linked.body.id,
        action: "guardian_student.updated",
          diff: expect.objectContaining({
            guardianId,
            studentId: "student-a",
            fieldsChanged: ["canReceiveSms"],
          }),
      }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain("DenetimGizli");
    expect(JSON.stringify(response.body)).not.toContain("5000000099");
  });

  it("öğrenci detay denetim özeti raw audit alanlarını döndürmeden daraltır", async () => {
    const guardian = await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Filtre", lastName: "Veli", phone: "5000000101" })
      .expect(201);
    const guardianId = (guardian.body as { id: string }).id;

    const linked = await request(server)
      .post(`/guardians/${guardianId}/students`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentId: "student-a", canViewFinance: true })
      .expect(201);

    await request(server)
      .patch(`/guardians/${guardianId}/students/student-a`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ canReceiveSms: false })
      .expect(200);

    const response = await request(server)
      .get("/audit-logs/student-summary?studentId=student-a&limit=5")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionLabel: "Veli ilişkisi kuruldu",
        createdAt: expect.any(String),
        id: expect.any(String),
      }),
      expect.objectContaining({
        actionLabel: "Veli ilişkisi güncellendi",
        createdAt: expect.any(String),
        id: expect.any(String),
      }),
    ]));
    for (const record of response.body as Array<Record<string, unknown>>) {
      expect(Object.keys(record).sort()).toEqual(["actionLabel", "createdAt", "id"]);
    }
    expect(JSON.stringify(response.body)).not.toContain(linked.body.id);
    expect(JSON.stringify(response.body)).not.toContain(guardianId);
    expect(JSON.stringify(response.body)).not.toContain("student-a");
    expect(JSON.stringify(response.body)).not.toContain("actorUserId");
    expect(JSON.stringify(response.body)).not.toContain("entityId");
    expect(JSON.stringify(response.body)).not.toContain("entityType");
    expect(JSON.stringify(response.body)).not.toContain("diff");
    expect(JSON.stringify(response.body)).not.toContain("support_ticket.created");
    expect(JSON.stringify(response.body)).not.toContain("Teacher");
    expect(JSON.stringify(response.body)).not.toContain("guardian.created");
  });

  it("ders programı ve etüt CRUD işlemleri audit kaydı üretir", async () => {
    const lesson = await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        title: "SakliDersBasligi",
        startsAt: "2026-06-01T11:00:00.000Z",
        endsAt: "2026-06-01T12:00:00.000Z",
      })
      .expect(201);
    const lessonId = (lesson.body as { id: string }).id;

    await request(server)
      .patch(`/schedule-lessons/${lessonId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ title: "SakliDersBasligiGuncel" })
      .expect(200);

    await request(server)
      .delete(`/schedule-lessons/${lessonId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);

    const session = await request(server)
      .post("/study-sessions")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        studentIds: ["student-a"],
        title: "SakliEtutBasligi",
        capacity: 2,
        startsAt: "2026-06-02T15:00:00.000Z",
        endsAt: "2026-06-02T16:00:00.000Z",
      })
      .expect(201);
    const sessionId = (session.body as { id: string }).id;

    await request(server)
      .patch(`/study-sessions/${sessionId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ title: "SakliEtutBasligiGuncel", capacity: 3 })
      .expect(200);

    await request(server)
      .delete(`/study-sessions/${sessionId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);

    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: "ScheduleLesson",
        entityId: lessonId,
        action: "schedule_lesson.created",
        diff: {
          classId: "class-a",
          teacherId: "teacher-a",
          fieldsSet: ["title", "startsAt", "endsAt"],
        },
      }),
      expect.objectContaining({
        entityType: "ScheduleLesson",
        entityId: lessonId,
        action: "schedule_lesson.updated",
        diff: { fieldsChanged: ["title"] },
      }),
      expect.objectContaining({
        entityType: "ScheduleLesson",
        entityId: lessonId,
        action: "schedule_lesson.deleted",
        diff: expect.objectContaining({ deletedAt: expect.any(String) }),
      }),
      expect.objectContaining({
        entityType: "StudySession",
        entityId: sessionId,
        action: "study_session.created",
        diff: {
          classId: "class-a",
          teacherId: "teacher-a",
          studentCount: 1,
          capacity: 2,
          fieldsSet: ["title", "startsAt", "endsAt"],
        },
      }),
      expect.objectContaining({
        entityType: "StudySession",
        entityId: sessionId,
        action: "study_session.updated",
        diff: { fieldsChanged: ["title", "capacity"] },
      }),
      expect.objectContaining({
        entityType: "StudySession",
        entityId: sessionId,
        action: "study_session.deleted",
        diff: expect.objectContaining({ deletedAt: expect.any(String) }),
      }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain("SakliDersBasligi");
    expect(JSON.stringify(response.body)).not.toContain("SakliEtutBasligi");
  });

  it("öğrenci Excel import işlemi ham öğrenci adlarını saklamadan audit kaydı üretir", async () => {
    const imported = await request(server)
      .post("/students/imports")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", "student-import-audit-a")
      .send({ fileBase64: await createStudentWorkbookBase64([["SakliImportAdi", "SakliImportSoyadi"]]) })
      .expect(201);
    const importedStudentId = (imported.body as { students: Array<{ id: string }> }).students[0]?.id;

    if (importedStudentId) {
      await request(server)
        .delete(`/students/${importedStudentId}`)
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .expect(204);
    }

    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "StudentImport",
        action: "student_import.completed",
        diff: expect.objectContaining({
          totalRows: 1,
          importedRows: 1,
          errorCount: 0,
        }),
      }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain("SakliImportAdi");
    expect(JSON.stringify(response.body)).not.toContain("SakliImportSoyadi");
  });

  it("materyal ve ödev yazma işlemleri ham içerik saklamadan audit kaydı üretir", async () => {
    const material = await request(server)
      .post("/homework/materials")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        title: "OdevGizliMateryal",
        description: "OdevGizliAciklama",
      })
      .expect(201);
    const materialId = (material.body as { id: string }).id;

    await request(server)
      .patch(`/homework/materials/${materialId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ title: "OdevGizliMateryalGuncel" })
      .expect(200);

    const materialFile = await request(server)
      .post(`/homework/materials/${materialId}/files`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "odev-gizli.txt",
        contentType: "text/plain",
        fileBase64: Buffer.from("OdevGizliDosya").toString("base64"),
      })
      .expect(201);
    const materialFileId = (materialFile.body as { id: string }).id;

    const assignment = await request(server)
      .post(`/homework/materials/${materialId}/assignments`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        studentId: "student-a",
        note: "OdevGizliNot",
        dueAt: "2026-06-10T12:00:00.000Z",
      })
      .expect(201);
    const assignmentId = (assignment.body as { id: string }).id;

    const homework = await request(server)
      .post("/homework")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        title: "OdevGizliBaslik",
        description: "OdevGizliDetay",
        dueAt: "2026-06-11T12:00:00.000Z",
      })
      .expect(201);
    const homeworkId = (homework.body as { id: string }).id;

    const materialHomework = await request(server)
      .post("/homework/from-material")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        materialId,
        dueAt: "2026-06-12T12:00:00.000Z",
      })
      .expect(201);
    const materialHomeworkId = (materialHomework.body as { id: string }).id;

    await request(server)
      .patch(`/homework/${homeworkId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ title: "OdevGizliBaslikGuncel" })
      .expect(200);

    await request(server)
      .patch(`/homework/${homeworkId}/check-status`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ checked: true })
      .expect(200);

    await request(server)
      .delete(`/homework/${homeworkId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);

    await request(server)
      .delete(`/homework/materials/${materialId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);

    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: "HomeworkMaterial",
        entityId: materialId,
        action: "homework_material.created",
        diff: { fieldsSet: ["title", "description"] },
      }),
      expect.objectContaining({
        entityType: "HomeworkMaterial",
        entityId: materialId,
        action: "homework_material.updated",
        diff: { fieldsChanged: ["title"] },
      }),
      expect.objectContaining({
        entityType: "HomeworkMaterialFile",
        entityId: materialFileId,
        action: "homework_material_file.created",
        diff: expect.objectContaining({
          materialId,
          contentType: "text/plain",
          byteSize: 14,
        }),
      }),
      expect.objectContaining({
        entityType: "HomeworkMaterialAssignment",
        entityId: assignmentId,
        action: "homework_material_assignment.created",
        diff: {
          materialId,
          studentId: "student-a",
          fieldsSet: ["note", "dueAt"],
        },
      }),
      expect.objectContaining({
        entityType: "Homework",
        entityId: homeworkId,
        action: "homework.created",
        diff: { classId: "class-a", fieldsSet: ["title", "description", "dueAt"] },
      }),
      expect.objectContaining({
        entityType: "Homework",
        entityId: materialHomeworkId,
        action: "homework.created_from_material",
        diff: { classId: "class-a", sourceMaterialId: materialId, fieldsSet: ["dueAt"] },
      }),
      expect.objectContaining({
        entityType: "Homework",
        entityId: homeworkId,
        action: "homework.updated",
        diff: { fieldsChanged: ["title"] },
      }),
      expect.objectContaining({
        actorUserId: "teacher-tenant-a",
        entityType: "Homework",
        entityId: homeworkId,
        action: "homework.check_status_updated",
        diff: { checked: true },
      }),
      expect.objectContaining({
        entityType: "Homework",
        entityId: homeworkId,
        action: "homework.deleted",
        diff: expect.objectContaining({ classId: "class-a", deletedAt: expect.any(String) }),
      }),
      expect.objectContaining({
        entityType: "HomeworkMaterial",
        entityId: materialId,
        action: "homework_material.deleted",
        diff: expect.objectContaining({
          fieldsPresent: ["title", "description"],
          deletedAt: expect.any(String),
        }),
      }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain("OdevGizli");
  });

  it("duyuru ve mesaj şablonu yazma işlemleri audit kaydı üretir", async () => {
    const announcement = await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        title: "Ali Yilmaz audit duyurusu",
        body: "Audit akışı kontrol ediliyor.",
        audience: "TEACHERS",
      })
      .expect(201);

    const template = await request(server)
      .post("/message-templates")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        name: "Ali Yilmaz Audit SMS",
        channel: "SMS",
        body: "Sayın veli, audit testi yapılmaktadır.",
      })
      .expect(201);
    const templateId = (template.body as { id: string }).id;

    await request(server)
      .patch(`/message-templates/${templateId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        name: "Ali Yilmaz Audit SMS Güncel",
        body: "Sayın veli, audit testi güncellendi.",
      })
      .expect(200);

    await request(server)
      .delete(`/message-templates/${templateId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);

    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "Announcement",
        entityId: (announcement.body as { id: string }).id,
        action: "announcement.created",
        diff: { audience: "TEACHERS", title: "[REDACTED]" },
      }),
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "MessageTemplate",
        entityId: templateId,
        action: "message_template.created",
        diff: { channel: "SMS", name: "[REDACTED]" },
      }),
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "MessageTemplate",
        entityId: templateId,
        action: "message_template.updated",
        diff: {
          before: {
            channel: "SMS",
            name: "[REDACTED]",
            body: "[REDACTED]",
          },
          after: {
            channel: "SMS",
            name: "[REDACTED]",
            body: "[REDACTED]",
          },
        },
      }),
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "MessageTemplate",
        entityId: templateId,
        action: "message_template.deleted",
        diff: expect.objectContaining({
          name: "[REDACTED]",
          deletedAt: expect.any(String),
        }),
      }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain("Ali Yilmaz");
    expect(JSON.stringify(response.body)).not.toContain("Sayın veli, audit testi yapılmaktadır.");
    expect(JSON.stringify(response.body)).not.toContain("Sayın veli, audit testi güncellendi.");
  });

  it("veli PII purge işlemi ham ad soyad ve telefonu saklamadan audit kaydı üretir", async () => {
    const guardian = await request(server)
      .post("/guardians")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "SakliVeliAdi", lastName: "SakliVeliSoyadi", phone: "5000000099" })
      .expect(201);
    const guardianId = (guardian.body as { id: string }).id;

    await request(server)
      .post(`/guardians/${guardianId}/purge-pii`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Veli");
        expect(body.phone).toBeUndefined();
      });

    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    const purgeRecord = (response.body as Array<{ entityId?: string; action?: string; diff?: unknown }>).find(
      (record) => record.entityId === guardianId && record.action === "kvkk.guardian_pii_purged",
    );
    expect(purgeRecord).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-tenant-a",
      entityType: "Guardian",
      entityId: guardianId,
      action: "kvkk.guardian_pii_purged",
      diff: {
        fieldsPurged: ["firstName", "lastName", "phone"],
        before: { firstNamePresent: true, lastNamePresent: true, phonePresent: true },
      },
    });
    expect(JSON.stringify(purgeRecord?.diff)).not.toContain("5000000099");
    expect(JSON.stringify(purgeRecord?.diff)).not.toContain("SakliVeliAdi");
    expect(JSON.stringify(purgeRecord?.diff)).not.toContain("SakliVeliSoyadi");
  });

  it("öğrenci ve öğretmen PII purge işlemleri ham ad soyadı saklamadan audit kaydı üretir", async () => {
    const student = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Sakli", lastName: "Ogrenci" })
      .expect(201);
    const studentId = (student.body as { id: string }).id;

    const teacher = await request(server)
      .post("/teachers")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Sakli", lastName: "Ogretmen", branch: "Fen" })
      .expect(201);
    const teacherId = (teacher.body as { id: string }).id;

    await request(server)
      .post(`/students/${studentId}/purge-pii`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Ogrenci");
      });

    await request(server)
      .post(`/teachers/${teacherId}/purge-pii`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.firstName).toBe("Anonim");
        expect(body.lastName).toBe("Ogretmen");
      });

    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "Student",
        entityId: studentId,
        action: "kvkk.student_pii_purged",
        diff: {
          fieldsPurged: [
            "firstName",
            "lastName",
            "nationalIdEncrypted",
            "nationalIdHash",
            "phone",
            "email",
            "photoKey",
            "ReportSnapshot.displayName",
            "ReportSnapshot.studentNo",
            "StudentContact.firstName",
            "StudentContact.lastName",
            "StudentContact.relationType",
            "StudentContact.phoneEncrypted",
            "StudentContact.phoneHash",
            "StudentContact.emailEncrypted",
            "StudentContact.emailHash",
            "StudentContact.canReceiveSms",
            "StudentContact.canReceiveAnnouncements",
            "StudentContact.canReceiveFinance",
            "StudentContact.consentSource",
            "StudentContact.consentRecordedAt",
          ],
          reportSnapshotPurgeCount: expect.any(Number),
          studentContactPurgeCount: expect.any(Number),
        },
      }),
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "StudentContact",
        entityId: studentId,
        action: "kvkk.student_contact_pii_purged",
        diff: { studentId, recordCount: expect.any(Number) },
      }),
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-tenant-a",
        entityType: "Teacher",
        entityId: teacherId,
        action: "kvkk.teacher_pii_purged",
        diff: {
          fieldsPurged: ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone"],
          before: {
            firstNamePresent: true,
            lastNamePresent: true,
            nationalIdPresent: false,
            phonePresent: false,
          },
        },
      }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain("Sakli");
  });

  it("kullanıcı kendi hesap PII temizleme işlemini self-service yapar ve ham email/ad audit'e yazılmaz", async () => {
    const login = await request(server)
      .post("/auth/login")
      .send(testLoginBody("privacy@example.test"))
      .expect(200);
    const accessToken = (login.body as { accessToken: string }).accessToken;

    const purge = await request(server)
      .post("/privacy/me/purge-pii")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(purge.body).toMatchObject({
      userId: "user-privacy",
      tenantId: "tenant-a",
    });
    expect(typeof (purge.body as { purgedAt?: unknown }).purgedAt).toBe("string");

    await request(server)
      .post("/auth/login")
      .send(testLoginBody("privacy@example.test"))
      .expect(401);

    const response = await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: "tenant-a",
        actorUserId: "user-privacy",
        entityType: "Auth",
        entityId: "user-privacy",
        action: "kvkk.user_pii_purged",
        diff: {
          fieldsPurged: ["email", "name"],
          before: { emailPresent: true, namePresent: true },
        },
      }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain("privacy@example.test");
    expect(JSON.stringify(response.body)).not.toContain("Privacy User");
  });

  it("normal system admin tenant audit rota ailesine giremez", async () => {
    for (const path of [
      "/audit-logs",
      "/audit-logs/safe-list",
      "/audit-logs/student-summary?studentId=student-a",
    ]) {
      await request(server)
        .get(path)
        .set("Authorization", `Bearer ${systemAccessToken}`)
        .expect(403);
    }
  });

  it("teacher audit rota ailesini okuyamaz", async () => {
    for (const path of [
      "/audit-logs",
      "/audit-logs/safe-list",
      "/audit-logs/student-summary?studentId=student-a",
    ]) {
      await request(server)
        .get(path)
        .set("Authorization", `Bearer ${teacherAAccessToken}`)
        .expect(403);
    }
  });

  it("yetkisiz request audit endpointine erişemez", async () => {
    await request(server).get("/audit-logs").expect(401);
  });
});

async function createStudentWorkbookBase64(rows: string[][]): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Students");
  worksheet.addRow(["firstName", "lastName"]);
  rows.forEach((row) => worksheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}
