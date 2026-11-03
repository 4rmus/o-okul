import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { loginAs, registerTestLoginIdentity } from "../test-auth.js";
import { normalizeFiltersSummary } from "./list-export-validation.js";

// DEC-20261102-08: masked CSV export writes one audit record (user, list, row count) before the browser builds it.
describe("List export audit API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let adminToken: string;
  let financeToken: string;
  let teacherToken: string;
  let guardianToken: string;
  let systemToken: string;

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
    upsertInMemoryAuthUser({
      id: "user-finance-export",
      email: "finance-export@example.test",
      name: "Finance Export User",
      password: "password",
      tenantId: "tenant-a",
      roles: ["FINANCE_STAFF"],
      membership: {
        id: "membership-finance-export",
        staffRole: "FINANCE_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: "TENANT",
        campusIds: [],
      },
    });
    registerTestLoginIdentity("finance-export@example.test", { tenantSlug: "dna-egitim" });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];

    adminToken = await loginAs(server, "admin-a@example.test");
    financeToken = await loginAs(server, "finance-export@example.test");
    teacherToken = await loginAs(server, "teacher-a@example.test");
    guardianToken = await loginAs(server, "guardian-a@example.test");
    systemToken = await loginAs(server, "system@example.test");
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  it("dışa aktarmayı Idempotency-Key ile tek denetim kaydına yazar; satır içeriği ve arama metni saklanmaz", async () => {
    const body = { filtersSummary: "q=ada;classId=class-a;sort=-firstName;page=2", list: "students", rowCount: 3 };
    const first = await request(server)
      .post("/audit/list-exports")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "list-export-idempotency-a")
      .send(body)
      .expect(201);
    const replay = await request(server)
      .post("/audit/list-exports")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "list-export-idempotency-a")
      .send(body)
      .expect(201);

    const recorded = first.body as { auditId: string; list: string; recordedAt: string; rowCount: number };
    expect(recorded).toEqual({ auditId: expect.any(String), list: "students", recordedAt: expect.any(String), rowCount: 3 });
    expect((replay.body as { auditId: string }).auditId).toBe(recorded.auditId);

    const logs = await request(server)
      .get("/audit-logs")
      .query({ entityType: "ListExport" })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const exportLogs = logs.body as Array<{ action: string; actorUserId?: string; diff?: Record<string, unknown>; entityId?: string; tenantId?: string }>;
    expect(exportLogs).toHaveLength(1);
    expect(exportLogs[0]).toMatchObject({
      action: "list.exported",
      actorUserId: "user-tenant-a",
      // `page` is not a students list filter (that list pages with a cursor), so it is dropped.
      diff: { filtersSummary: "q;classId=class-a;sort=-firstName", listType: "students", rowCount: 3 },
      entityId: "students",
      tenantId: "tenant-a",
    });
    expect(JSON.stringify(exportLogs[0])).not.toContain("ada");

    const safeList = await request(server)
      .get("/audit-logs/safe-list")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(safeList.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionLabel: "Liste dışa aktarıldı", entityLabel: "Liste dışa aktarma kaydı" }),
    ]));
  });

  it("aynı anahtarla farklı gövde 409 döner, anahtarsız istek reddedilir", async () => {
    await request(server)
      .post("/audit/list-exports")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "list-export-idempotency-b")
      .send({ filtersSummary: "", list: "classes", rowCount: 4 })
      .expect(201);
    await request(server)
      .post("/audit/list-exports")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "list-export-idempotency-b")
      .send({ filtersSummary: "", list: "classes", rowCount: 5 })
      .expect(409);
    await request(server)
      .post("/audit/list-exports")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filtersSummary: "", list: "classes", rowCount: 4 })
      .expect(400);
  });

  it("geçersiz gövdeyi reddeder: bilinmeyen liste, sıfır satır, serbest metinli süzgeç özeti", async () => {
    for (const body of [
      { filtersSummary: "", list: "guardians", rowCount: 1 },
      { filtersSummary: "", list: "teachers", rowCount: 0 },
      { filtersSummary: "q=Ada Kaya", list: "teachers", rowCount: 1 },
      { filtersSummary: "", list: "teachers", rowCount: 1, rows: [["Ada Kaya"]] },
    ]) {
      await request(server)
        .post("/audit/list-exports")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("Idempotency-Key", `list-export-invalid-${body.list}-${body.rowCount}`)
        .send(body)
        .expect(422);
    }
  });

  it("listeyi göremeyen rol, portal personaları ve sistem yöneticisi dışa aktaramaz", async () => {
    for (const list of ["students", "teachers", "classes", "attendance"]) {
      await request(server)
        .post("/audit/list-exports")
        .set("Authorization", `Bearer ${financeToken}`)
        .set("Idempotency-Key", `list-export-finance-${list}`)
        .send({ filtersSummary: "", list, rowCount: 1 })
        .expect(403);
    }
    for (const token of [teacherToken, guardianToken, systemToken]) {
      await request(server)
        .post("/audit/list-exports")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "list-export-portal-a")
        .send({ filtersSummary: "", list: "students", rowCount: 1 })
        .expect(403);
    }
    await request(server)
      .post("/audit/list-exports")
      .set("Idempotency-Key", "list-export-anonymous-a")
      .send({ filtersSummary: "", list: "students", rowCount: 1 })
      .expect(401);
  });

  it("arama değerini süzgeç özetinden düşürür", () => {
    expect(normalizeFiltersSummary("students", "q=ada;classId=class-a")).toBe("q;classId=class-a");
    expect(normalizeFiltersSummary("teachers", "q=ada;page=2")).toBe("q;page=2");
    expect(normalizeFiltersSummary("students", "")).toBe("");
  });

  it("listeye ait olmayan süzgeç anahtarlarını düşürür ve değerleri kurala göre sınırlar", () => {
    // Web callers: students sends cursor/q/sort and its filter panel; teachers and classes page/q/sort; attendance adds classId.
    expect(normalizeFiltersSummary(
      "students",
      "cursor=eyJpZCI6InN0dWRlbnQtYSJ9;q;sort=-studentNo;classId=class-a;level=8;responsibleTeacherId=teacher-a;status=ACTIVE;guardianLinked=true",
    )).toBe("cursor;q;sort=-studentNo;classId=class-a;level=8;responsibleTeacherId=teacher-a;status=ACTIVE;guardianLinked=true");
    expect(normalizeFiltersSummary("teachers", "page=2;q;sort=lastName;classId=class-a;search=kaya;adaKaya;note=ada")).toBe("page=2;q;sort=lastName");
    expect(normalizeFiltersSummary("classes", "page=1;sort=-name;studentName=ada")).toBe("page=1;sort=-name");
    expect(normalizeFiltersSummary("attendance", "classId=class-a;page=3;q;sort=-date;status=ABSENT")).toBe("classId=class-a;page=3;q;sort=-date");
    // Values outside the key's rule keep only the key; repeated keys keep the first one; key match is exact.
    expect(normalizeFiltersSummary("students", "status=ada;guardianLinked=maybe;page=2;classId=class-a;classId=class-b;Q=ada"))
      .toBe("status;guardianLinked;classId=class-a");
    expect(normalizeFiltersSummary("teachers", "page=0;sort=a.b;page=3")).toBe("page;sort");
    expect(normalizeFiltersSummary("classes", `page=${"9".repeat(7)}`)).toBe("page");
    expect(normalizeFiltersSummary("students", "constructor=x;toString;__proto__")).toBe("");
  });

  it("bilinmeyen süzgeç anahtarı denetim kaydına ulaşmaz", async () => {
    await request(server)
      .post("/audit/list-exports")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("Idempotency-Key", "list-export-unknown-keys-a")
      .send({ filtersSummary: "page=4;adaKaya;phone=5551112233;sort=lastName", list: "teachers", rowCount: 2 })
      .expect(201);
    const logs = await request(server)
      .get("/audit-logs")
      .query({ entityType: "ListExport" })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const teacherExport = (logs.body as Array<{ diff?: Record<string, unknown>; entityId?: string }>).find((log) => log.entityId === "teachers");
    expect(teacherExport?.diff).toMatchObject({ filtersSummary: "page=4;sort=lastName", listType: "teachers", rowCount: 2 });
    expect(JSON.stringify(teacherExport)).not.toMatch(/adaKaya|5551112233|phone/);
  });
});
