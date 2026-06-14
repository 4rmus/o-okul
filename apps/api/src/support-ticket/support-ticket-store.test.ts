import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresSupportTicketStore } from "./support-ticket-store.js";

describe("PostgresSupportTicketStore", () => {
  it("destek talebi sorgularında tenant context ve beklenen parametreleri kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('"SupportTicketComment"')) {
          return {
            rows: [
              {
                id: "support-comment-a",
                tenantId: "tenant-a",
                ticketId: "support-ticket-a",
                authorId: "user-tenant-a",
                body: "Ekran görüntüsünü ekledim.",
                createdAt: new Date("2026-06-08T09:20:00.000Z"),
                deletedAt: null,
              },
            ] as T[],
          };
        }

        if (sql.includes('"SupportTicketAttachment"')) {
          return {
            rows: [
              {
                id: "support-attachment-a",
                tenantId: "tenant-a",
                ticketId: "support-ticket-a",
                uploadedById: "user-tenant-a",
                fileName: "hata-ekrani.txt",
                contentType: "text/plain",
                byteSize: 11,
                sha256: "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
                contentBase64: "aGVsbG8gd29ybGQ=",
                storageKey: null,
                createdAt: new Date("2026-06-08T09:10:00.000Z"),
                deletedAt: null,
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "support-ticket-a",
              tenantId: "tenant-a",
              requesterId: "user-tenant-a",
              campusId: "campus-main",
              gradeLevelId: "grade-8",
              classId: "class-a",
              courseId: "course-math",
              termId: "term-2026-spring",
              subject: "Optik dosya yüklenemiyor",
              message: "TXT dosyası yüklenirken hata alıyoruz.",
              priority: "NORMAL",
              status: "OPEN",
              createdAt: new Date("2026-06-08T09:00:00.000Z"),
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresSupportTicketStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list();
        await store.findById("support-ticket-a");
        await store.create({
          tenantId: "tenant-a",
          requesterId: "user-tenant-a",
          campusId: "campus-main",
          gradeLevelId: "grade-8",
          classId: "class-a",
          courseId: "course-math",
          termId: "term-2026-spring",
          subject: "Yeni destek talebi",
          message: "Yardım gerekiyor.",
          priority: "HIGH",
          status: "OPEN",
          createdAt: "2026-06-08T10:00:00.000Z",
        });
        await store.update("support-ticket-a", {
          priority: "HIGH",
          status: "IN_PROGRESS",
        });
        await store.listAttachments("support-ticket-a");
        await store.findAttachmentById("support-attachment-a");
        await store.createAttachment({
          tenantId: "tenant-a",
          ticketId: "support-ticket-a",
          uploadedById: "user-tenant-a",
          fileName: "ekran.txt",
          contentType: "text/plain",
          byteSize: 11,
          sha256: "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
          storageKey: "support-ticket-attachments/tenant-a/support-ticket-a/sha/ekran.txt",
          createdAt: "2026-06-08T10:05:00.000Z",
        });
        await store.listComments("support-ticket-a");
        await store.createComment({
          tenantId: "tenant-a",
          ticketId: "support-ticket-a",
          authorId: "user-tenant-a",
          body: "Kontrol ediyoruz.",
          createdAt: "2026-06-08T10:10:00.000Z",
        });
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "SupportTicket"');
    expect(businessQueries[1]?.values).toEqual(["support-ticket-a"]);
    expect(businessQueries[2]?.sql).toContain('INSERT INTO "SupportTicket"');
    expect(businessQueries[2]?.values?.slice(1)).toEqual([
      "tenant-a",
      "user-tenant-a",
      null,
      "campus-main",
      "grade-8",
      "class-a",
      "course-math",
      "term-2026-spring",
      "Yeni destek talebi",
      "Yardım gerekiyor.",
      "HIGH",
      "OPEN",
      "2026-06-08T10:00:00.000Z",
    ]);
    expect(businessQueries[3]?.sql).toContain('UPDATE "SupportTicket"');
    expect(businessQueries[3]?.values).toEqual(["support-ticket-a", "HIGH", "IN_PROGRESS"]);
    expect(businessQueries[4]?.sql).toContain('SELECT * FROM "SupportTicketAttachment"');
    expect(businessQueries[4]?.values).toEqual(["support-ticket-a"]);
    expect(businessQueries[5]?.sql).toContain('SELECT * FROM "SupportTicketAttachment"');
    expect(businessQueries[5]?.values).toEqual(["support-attachment-a"]);
    expect(businessQueries[6]?.sql).toContain('INSERT INTO "SupportTicketAttachment"');
    expect(businessQueries[6]?.values?.slice(1)).toEqual([
      "tenant-a",
      "support-ticket-a",
      "user-tenant-a",
      "ekran.txt",
      "text/plain",
      11,
      "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
      null,
      "support-ticket-attachments/tenant-a/support-ticket-a/sha/ekran.txt",
      "2026-06-08T10:05:00.000Z",
    ]);
    expect(businessQueries[7]?.sql).toContain('SELECT * FROM "SupportTicketComment"');
    expect(businessQueries[7]?.values).toEqual(["support-ticket-a"]);
    expect(businessQueries[8]?.sql).toContain('INSERT INTO "SupportTicketComment"');
    expect(businessQueries[8]?.values?.slice(1)).toEqual([
      "tenant-a",
      "support-ticket-a",
      "user-tenant-a",
      "Kontrol ediyoruz.",
      "2026-06-08T10:10:00.000Z",
    ]);
  });
});
