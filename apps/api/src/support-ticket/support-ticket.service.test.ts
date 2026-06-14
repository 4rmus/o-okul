import { BadRequestException } from "@nestjs/common";
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
import { SupportTicketService } from "./support-ticket.service.js";

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
});

const context: RequestContext = {
  userId: "teacher-tenant-a",
  tenantId: "tenant-a",
  roles: ["TEACHER"],
  bypassRls: false,
};

function createService(
  storage: SupportTicketAttachmentStorage,
  scanner: UploadAvScanner = { async scan() {} },
): SupportTicketService {
  return new SupportTicketService(
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
    scanner,
  );
}
