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
import type { SupportTicketAttachmentStorage } from "./support-ticket-attachment-storage.js";
import { InMemorySupportTicketStore } from "./support-ticket-store.js";
import { SupportTicketService } from "./support-ticket.service.js";

describe("SupportTicketService", () => {
  it("S3 storageKey ile kaydedilen destek ekini storage üzerinden indirir", async () => {
    const context: RequestContext = {
      userId: "teacher-tenant-a",
      tenantId: "tenant-a",
      roles: ["TEACHER"],
      bypassRls: false,
    };
    const storage: SupportTicketAttachmentStorage = {
      async put() {
        return { storageKey: "support-ticket-attachments/tenant-a/support-ticket-a/sha-a/ekran.txt" };
      },
      async get(storageKey) {
        expect(storageKey).toBe("support-ticket-attachments/tenant-a/support-ticket-a/sha-a/ekran.txt");
        return Buffer.from("remote file");
      },
    };
    const service = new SupportTicketService(
      new InMemorySupportTicketStore(),
      new InMemoryAcademicCalendarStore(),
      new InMemoryCampusStore(),
      new InMemoryClassStore(),
      new InMemoryCourseStore(),
      new InMemoryGradeLevelStore(),
      new InMemoryTeacherAssignmentStore(),
      new InMemoryStudentStore(),
      new InMemoryGuardianStudentStore(),
      storage,
    );

    const created = await service.addAttachment(context, "support-ticket-a", {
      fileName: "ekran.txt",
      contentType: "text/plain",
      fileBase64: Buffer.from("remote file").toString("base64"),
    });
    const downloaded = await service.downloadAttachment(context, "support-ticket-a", created.id);

    expect((created as { contentBase64?: string }).contentBase64).toBeUndefined();
    expect((created as { storageKey?: string }).storageKey).toBeUndefined();
    expect(downloaded).toMatchObject({
      fileName: "ekran.txt",
      contentType: "text/plain",
      byteSize: 11,
      fileBase64: Buffer.from("remote file").toString("base64"),
    });
  });
});
