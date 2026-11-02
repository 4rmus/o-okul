import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryAcademicCalendarStore } from "../school/academic-calendar-store.js";
import { InMemoryCampusStore } from "../school/campus-store.js";
import { InMemoryClassStore } from "../school/class-store.js";
import { InMemoryCourseStore } from "../school/course-store.js";
import { InMemoryGradeLevelStore } from "../school/grade-level-store.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryTeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import type { UploadAvScanInput, UploadAvScanner } from "../upload/upload-av-scanner.js";
import type { SupportTicketAttachmentStorage } from "./support-ticket-attachment-storage.js";
import { InMemorySupportTicketStore } from "./support-ticket-store.js";
import { canReachStaffSupportTicket, SupportTicketService } from "./support-ticket.service.js";

describe("SupportTicketService", () => {
  it("S3 storageKey ile kaydedilen destek eki için imzalı indirme URL'si üretir", async () => {
    const scans: UploadAvScanInput[] = [];
    let getCalls = 0;
    const storage: SupportTicketAttachmentStorage = {
      async put() {
        return { storageKey: "support-ticket-attachments/tenant-a/support-ticket-a/sha-a/ekran.txt" };
      },
      async get(storageKey) {
        getCalls += 1;
        expect(storageKey).toBe("support-ticket-attachments/tenant-a/support-ticket-a/sha-a/ekran.txt");
        return Buffer.from("remote file");
      },
      async createSignedDownloadUrl(storageKey) {
        expect(storageKey).toBe("support-ticket-attachments/tenant-a/support-ticket-a/sha-a/ekran.txt");
        return {
          url: "https://storage.example.test/support-ticket-attachment",
          expiresAt: "2026-06-13T12:05:00.000Z",
          expiresInSeconds: 300,
        };
      },
    };
    const service = createService(storage, {
      async scan(input) {
        scans.push(input);
      },
    });

    const created = await service.addAttachment(context, "support-ticket-a", {
      fileName: "ekran.txt",
      contentType: "text/plain",
      fileBase64: Buffer.from("remote file").toString("base64"),
    });
    const downloaded = await service.downloadAttachment(context, "support-ticket-a", created.id);

    expect((created as { contentBase64?: string }).contentBase64).toBeUndefined();
    expect((created as { storageKey?: string }).storageKey).toBeUndefined();
    expect(scans).toEqual([
      expect.objectContaining({
        surface: "support_ticket_attachment",
        tenantId: "tenant-a",
        fileName: "ekran.txt",
        contentType: "text/plain",
        sha256: "736cf6923460f56b8d6cbae98f1013a53d93e47bca9ef6d76f5a5a3a863217c6",
      }),
    ]);
    expect(downloaded).toMatchObject({
      fileName: "ekran.txt",
      contentType: "text/plain",
      byteSize: 11,
      downloadMode: "signed-url",
      downloadUrl: "https://storage.example.test/support-ticket-attachment",
      downloadUrlExpiresAt: "2026-06-13T12:05:00.000Z",
      downloadUrlExpiresInSeconds: 300,
    });
    expect(downloaded.fileBase64).toBeUndefined();
    expect(getCalls).toBe(0);
  });

  it("scanner malware bulursa destek ekini storage'a yazmadan reddeder", async () => {
    let putCalls = 0;
    const storage: SupportTicketAttachmentStorage = {
      async put() {
        putCalls += 1;
        return { contentBase64: Buffer.from("remote file").toString("base64") };
      },
      async get() {
        return Buffer.from("remote file");
      },
    };
    const service = createService(storage, {
      async scan() {
        throw new BadRequestException("UPLOAD_AV_MALWARE_DETECTED");
      },
    });

    await expect(service.addAttachment(context, "support-ticket-a", {
      fileName: "ekran.txt",
      contentType: "text/plain",
      fileBase64: Buffer.from("remote file").toString("base64"),
    })).rejects.toThrow("UPLOAD_AV_MALWARE_DETECTED");
    expect(putCalls).toBe(0);
  });

  it("support:manage olmayan personel yalnız kendi talebine ulaşır; başkasının talebi 404 döner", async () => {
    const service = createService({
      async put() {
        return { contentBase64: Buffer.from("x").toString("base64") };
      },
      async get() {
        return Buffer.from("x");
      },
    });
    const own = await service.create(teacherContext, { subject: "Öğretmen talebi", message: "Mesaj" });

    expect((await service.list(teacherContext)).map((ticket) => ticket.id)).toEqual([own.id]);
    await expect(service.findOne(teacherContext, own.id)).resolves.toMatchObject({ id: own.id });
    for (const attempt of [
      () => service.findOne(teacherContext, "support-ticket-a"),
      () => service.listComments(teacherContext, "support-ticket-a"),
      () => service.listAttachments(teacherContext, "support-ticket-a"),
      () => service.downloadAttachment(teacherContext, "support-ticket-a", "support-attachment-a"),
      () => service.addComment(teacherContext, "support-ticket-a", { body: "Sızma" }),
      () => service.addAttachment(teacherContext, "support-ticket-a", {
        fileName: "ekran.txt",
        contentType: "text/plain",
        fileBase64: Buffer.from("hello world").toString("base64"),
      }),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(NotFoundException);
    }
    await expect(service.findOne(teacherContext, "support-ticket-b")).rejects.toThrow("FORBIDDEN_TENANT");
  });

  it("CAMPUSES kapsamlı yönetici yalnız kapsamdaki kampüsün taleplerini görür; kampüssüz talep kapalı kalır", async () => {
    const service = createService({
      async put() {
        return { contentBase64: Buffer.from("x").toString("base64") };
      },
      async get() {
        return Buffer.from("x");
      },
    });
    const campuslessTicket = await service.create(teacherContext, { subject: "Kampüssüz", message: "Mesaj" });
    const otherCampus: RequestContext = {
      ...managerContext,
      userId: "user-operations-other",
      roles: ["OPERATIONS_STAFF"],
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-other"] },
    };
    const mainCampus: RequestContext = { ...otherCampus, campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] } };

    expect((await service.list(managerContext)).map((ticket) => ticket.id)).toEqual(["support-ticket-a", campuslessTicket.id]);
    expect((await service.list(mainCampus)).map((ticket) => ticket.id)).toEqual(["support-ticket-a"]);
    expect(await service.list(otherCampus)).toEqual([]);
    await expect(service.findOne(otherCampus, "support-ticket-a")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.findOne(mainCampus, campuslessTicket.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(otherCampus, "support-ticket-a", { status: "RESOLVED" })).rejects.toBeInstanceOf(NotFoundException);

    const ownCampusless = await service.create(mainCampus, { subject: "Kendi talebim", message: "Mesaj" });
    await expect(service.findOne(mainCampus, ownCampusless.id)).resolves.toMatchObject({ id: ownCampusless.id });
  });

  it("kampüssüz eski talebi sınıfın, yoksa öğrencinin sınıf kampüsüyle atar; çözülemeyen talep kapalı kalır", async () => {
    const store = new InMemorySupportTicketStore();
    const service = createService(inlineStorage, undefined, store);
    const base = {
      tenantId: "tenant-a",
      requesterId: "someone-else",
      subject: "Eski talep",
      message: "Kampüs alanı boş kaydedildi.",
      priority: "NORMAL" as const,
      status: "OPEN" as const,
      createdAt: "2026-06-09T09:00:00.000Z",
    };
    const legacyStudent = await store.create({ ...base, studentId: "student-a" });
    const legacyClass = await store.create({ ...base, classId: "class-a" });
    const orphan = await store.create({ ...base, studentId: "student-missing" });
    const mainCampus = campusContext(["campus-main"]);
    const otherCampus = campusContext(["campus-other"]);

    expect((await service.list(mainCampus)).map((ticket) => ticket.id)).toEqual(
      ["support-ticket-a", legacyStudent.id, legacyClass.id],
    );
    await expect(service.findOne(mainCampus, legacyStudent.id)).resolves.toMatchObject({ id: legacyStudent.id });
    await expect(service.findOne(mainCampus, orphan.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.list(otherCampus)).toEqual([]);
    await expect(service.findOne(otherCampus, legacyClass.id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.list(managerContext)).map((ticket) => ticket.id)).toContain(orphan.id);
  });

  it("portal ve öğretmen talebine oluştururken kampüs damgası basar", async () => {
    const service = createService(inlineStorage);
    const studentContext: RequestContext = {
      userId: "student-tenant-a",
      tenantId: "tenant-a",
      roles: ["STUDENT"],
      bypassRls: false,
      subjectType: "STUDENT",
      subjectId: "student-a",
    };

    await expect(service.createCurrentStudent(studentContext, { subject: "Öğrenci", message: "Mesaj" }))
      .resolves.toMatchObject({ studentId: "student-a", campusId: "campus-main" });
    await expect(service.createCurrentTeacher(teacherContext, { subject: "Öğretmen", message: "Mesaj", classId: "class-a" }))
      .resolves.toMatchObject({ classId: "class-a", campusId: "campus-main" });
    const contextless = await service.createCurrentTeacher(teacherContext, { subject: "Öğretmen", message: "Bağlamsız" });
    expect(contextless.campusId).toBeUndefined();
  });

  it("kampüs kapsamlı personel kapsam dışı bağlamla talep açamaz; kapsamı eksik operasyon çalışanı reddedilir", async () => {
    const service = createService(inlineStorage);
    const otherCampus = campusContext(["campus-other"]);
    for (const input of [{ campusId: "campus-main" }, { classId: "class-a" }, { studentId: "student-a" }]) {
      await expect(service.create(otherCampus, { subject: "Kapsam dışı", message: "Mesaj", ...input }))
        .rejects.toThrow("SUPPORT_TICKET_CAMPUS_SCOPE_FORBIDDEN");
    }
    await expect(service.create(campusContext(["campus-main"]), { subject: "Kapsam içi", message: "Mesaj", studentId: "student-a" }))
      .resolves.toMatchObject({ campusId: "campus-main" });

    const unscopedOperations: RequestContext = { ...managerContext, userId: "user-operations", roles: ["OPERATIONS_STAFF"] };
    await expect(service.create(unscopedOperations, { subject: "Kapsamsız", message: "Mesaj" }))
      .rejects.toThrow("SUPPORT_TICKET_CAMPUS_SCOPE_MISSING");
    expect(await service.list(unscopedOperations)).toEqual([]);
  });

  it("canReachStaffSupportTicket sahiplik, yetki ve kampüs kapsamını birlikte uygular", () => {
    const ticket = { requesterId: "someone-else", campusId: "campus-main" };
    expect(canReachStaffSupportTicket(teacherContext, ticket)).toBe(false);
    expect(canReachStaffSupportTicket(teacherContext, { ...ticket, requesterId: teacherContext.userId })).toBe(true);
    expect(canReachStaffSupportTicket(managerContext, ticket)).toBe(true);
    expect(canReachStaffSupportTicket({ ...managerContext, campusScope: { scopeMode: "TENANT", campusIds: [] } }, { requesterId: "x" })).toBe(true);
    expect(canReachStaffSupportTicket({ ...managerContext, campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] } }, { requesterId: "x" })).toBe(false);
    expect(canReachStaffSupportTicket({ ...teacherContext, capabilities: ["support:*"] }, ticket)).toBe(true);
    expect(canReachStaffSupportTicket(campusContext(["campus-main"]), { requesterId: "x" }, "campus-main")).toBe(true);
    expect(canReachStaffSupportTicket(campusContext(["campus-other"]), { requesterId: "x" }, "campus-main")).toBe(false);
    expect(canReachStaffSupportTicket({ ...managerContext, roles: ["OPERATIONS_STAFF"] }, ticket)).toBe(false);
  });
});

const inlineStorage: SupportTicketAttachmentStorage = {
  async put() {
    return { contentBase64: Buffer.from("x").toString("base64") };
  },
  async get() {
    return Buffer.from("x");
  },
};

function campusContext(campusIds: string[]): RequestContext {
  return {
    userId: `user-operations-${campusIds.join("-")}`,
    tenantId: "tenant-a",
    roles: ["OPERATIONS_STAFF"],
    bypassRls: false,
    campusScope: { scopeMode: "CAMPUSES", campusIds },
  };
}

const context: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
};

const managerContext = context;

const teacherContext: RequestContext = {
  userId: "teacher-tenant-a",
  tenantId: "tenant-a",
  roles: ["TEACHER"],
  bypassRls: false,
  subjectType: "TEACHER",
  subjectId: "teacher-a",
};

function createService(
  storage: SupportTicketAttachmentStorage,
  scanner: UploadAvScanner = { async scan() {} },
  store = new InMemorySupportTicketStore(),
): SupportTicketService {
  return new SupportTicketService(
    store,
    new InMemoryAcademicCalendarStore(),
    new InMemoryCampusStore(),
    new InMemoryClassStore(),
    new InMemoryCourseStore(),
    new InMemoryGradeLevelStore(),
    new InMemoryTeacherAssignmentStore(),
    new InMemoryStudentStore(),
    new InMemoryGuardianStudentStore(),
    storage,
    scanner,
  );
}
