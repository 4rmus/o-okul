import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AnswerKeyRecord, ExamParticipantRecord, ExamRecord } from "@o-okul/shared-types";
import request from "supertest";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { registerTestLoginIdentity, testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { AnswerKeyExcelImportService } from "../exam/answer-key-excel-import.service.js";
import {
  answerKeyRepositoryToken,
  type AnswerKeyRepository,
  type SaveAnswerKeyInput,
} from "../exam/answer-key.service.js";
import {
  type CreateExamParticipantRepositoryInput,
  type CreateExamRepositoryInput,
  type ExamParticipantRepository,
  examParticipantRepositoryToken,
  type ExamRepository,
  examRepositoryToken,
  type UpdateExamRepositoryInput,
} from "../exam/exam.service.js";
import { paymentPlanStoreToken, type PaymentPlanStore } from "../payment/payment-store.js";
import { InMemorySupportTicketStore, supportTicketStoreToken } from "../support-ticket/support-ticket-store.js";

describe("Capability access matrix", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAdminToken: string;
  let assistantToken: string;
  let teacherToken: string;
  let financeToken: string;
  let financeTenantScopeToken: string;
  let financeWithoutScopeToken: string;
  let studentToken: string;
  let guardianToken: string;
  let systemToken: string;
  let inScopePaymentPlanId: string;
  let outOfScopePaymentPlanId: string;
  let answerKeys: FakeAnswerKeyRepository;

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    upsertInMemoryAuthUser({
      id: "user-finance-rbac",
      email: "finance-rbac@example.test",
      name: "Finance RBAC User",
      password: "password",
      tenantId: "tenant-a",
      roles: ["FINANCE_STAFF"],
      membership: {
        id: "membership-finance-rbac",
        staffRole: "FINANCE_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: "CAMPUSES",
        campusIds: ["campus-main"],
      },
    });
    upsertInMemoryAuthUser({
      id: "user-finance-tenant-scope",
      email: "finance-tenant-scope@example.test",
      name: "Finance Tenant Scope",
      password: "password",
      tenantId: "tenant-a",
      roles: ["FINANCE_STAFF"],
      membership: {
        id: "membership-finance-tenant-scope",
        staffRole: "FINANCE_STAFF",
        hasTeacherPersona: false,
        hasStudentPersona: false,
        version: 1,
        scopeMode: "TENANT",
        campusIds: [],
      },
    });
    upsertInMemoryAuthUser({
      id: "user-finance-no-scope",
      email: "finance-no-scope@example.test",
      name: "Finance Without Scope",
      password: "password",
      tenantId: "tenant-a",
      roles: ["FINANCE_STAFF"],
    });
    registerTestLoginIdentity("finance-rbac@example.test", { tenantSlug: "dna-egitim" });
    registerTestLoginIdentity("finance-tenant-scope@example.test", { tenantSlug: "dna-egitim" });
    registerTestLoginIdentity("finance-no-scope@example.test", { tenantSlug: "dna-egitim" });

    answerKeys = new FakeAnswerKeyRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(examRepositoryToken)
      .useValue(new FakeExamRepository())
      .overrideProvider(examParticipantRepositoryToken)
      .useValue(new FakeExamParticipantRepository())
      .overrideProvider(supportTicketStoreToken)
      .useValue(new InMemorySupportTicketStore())
      .overrideProvider(answerKeyRepositoryToken)
      .useValue(answerKeys)
      .overrideProvider(AnswerKeyExcelImportService)
      .useValue({
        import(context: { tenantId?: string }, input: { examId?: string; version?: string }) {
          const answerKey = answerKeys.add({
            tenantId: context.tenantId ?? "tenant-a",
            examId: input.examId ?? "exam-a",
            version: input.version ?? "answer-key-v1",
          });
          return Promise.resolve({
            imported: true,
            answerKey,
            bookletVariants: [],
          });
        },
      })
      .compile();

    const paymentPlans = moduleRef.get<PaymentPlanStore>(paymentPlanStoreToken);
    const inScopePlan = await paymentPlans.create({
      plan: {
        tenantId: "tenant-a",
        studentId: "student-a",
        campusId: "campus-main",
        title: "Kampüs kapsamındaki plan",
        totalAmount: 1000,
        currency: "TRY",
      },
      installments: [],
    });
    const outOfScopePlan = await paymentPlans.create({
      plan: {
        tenantId: "tenant-a",
        studentId: "student-a",
        campusId: "campus-secondary",
        title: "Kampüs dışındaki plan",
        totalAmount: 1000,
        currency: "TRY",
      },
      installments: [],
    });
    inScopePaymentPlanId = inScopePlan.id;
    outOfScopePaymentPlanId = outOfScopePlan.id;

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    tenantAdminToken = await login("admin-a@example.test");
    assistantToken = await login("assistant-a@example.test");
    teacherToken = await login("teacher-a@example.test");
    financeToken = await login("finance-rbac@example.test");
    financeTenantScopeToken = await login("finance-tenant-scope@example.test");
    financeWithoutScopeToken = await login("finance-no-scope@example.test");
    studentToken = await login("student-a@example.test");
    guardianToken = await login("guardian-a@example.test");
    systemToken = await login("system@example.test");
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("ASSISTANT_ADMIN finans endpoint'lerine giremez", async () => {
    await request(server)
      .get("/payment-plans")
      .set("Authorization", `Bearer ${assistantToken}`)
      .expect(403);
  });

  it("FINANCE_STAFF akademik, portal ve destek endpoint'lerine giremez; finans endpoint'ine girer", async () => {
    for (const path of ["/students", "/teachers", "/exams", "/attendance", "/search?q=ayse", "/support-tickets"]) {
      await request(server)
        .get(path)
        .set("Authorization", `Bearer ${financeToken}`)
        .expect(403);
    }

    await request(server)
      .patch("/support-tickets/support-ticket-a")
      .set("Authorization", `Bearer ${financeToken}`)
      .send({ status: "IN_PROGRESS" })
      .expect(403);

    await request(server)
      .get("/payment-plans")
      .set("Authorization", `Bearer ${financeToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([expect.objectContaining({ id: inScopePaymentPlanId, campusId: "campus-main" })]);
      });
  });

  it("öğrenci ve veli tenant-genel öğrenci listesi ile export alamaz", async () => {
    for (const token of [studentToken, guardianToken]) {
      await request(server)
        .get("/students")
        .set("Authorization", `Bearer ${token}`)
        .expect(403);
      await request(server)
        .get("/students/export")
        .set("Authorization", `Bearer ${token}`)
        .expect(403);
    }
  });

  it("öğrenci tenant taşımasını tenant admin ve break-glass sistem admin için fail-closed tutar", async () => {
    await request(server)
      .patch("/students/student-a/tenant")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .send({ tenantId: "tenant-a" })
      .expect(403);

    await request(server)
      .patch("/students/student-a/tenant")
      .set("Authorization", `Bearer ${systemToken}`)
      .set("X-RLS-Bypass-Reason", "SEC-1234 tenant correction")
      .send({ tenantId: "tenant-a" })
      .expect(403);
  });

  it("CAMPUSES scope'lu FINANCE_STAFF yalnız seçili kampüsün plan ve tahsilatını görür ya da değiştirir", async () => {
    await request(server)
      .get(`/payment-plans/${inScopePaymentPlanId}/transactions`)
      .set("Authorization", `Bearer ${financeToken}`)
      .expect(200);

    await request(server)
      .post(`/payment-plans/${inScopePaymentPlanId}/transactions`)
      .set("Authorization", `Bearer ${financeToken}`)
      .send({ amount: 1000, method: "CASH", paidAt: "2026-06-06T09:00:00.000Z" })
      .expect(201);

    await request(server)
      .get(`/payment-plans/${outOfScopePaymentPlanId}/transactions`)
      .set("Authorization", `Bearer ${financeToken}`)
      .expect(404);

    await request(server)
      .delete(`/payment-plans/${outOfScopePaymentPlanId}`)
      .set("Authorization", `Bearer ${financeToken}`)
      .expect(404);
  });

  it("TENANT scope'lu FINANCE_STAFF tenant-genel finans planlarını görmeye devam eder", async () => {
    await request(server)
      .get("/payment-plans")
      .set("Authorization", `Bearer ${financeTenantScopeToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: inScopePaymentPlanId }),
          expect.objectContaining({ id: outOfScopePaymentPlanId }),
        ]));
      });
  });

  it("scope bilgisi olmayan FINANCE_STAFF için tenant-genel finans erişimi açılmaz", async () => {
    await request(server)
      .get("/payment-plans")
      .set("Authorization", `Bearer ${financeWithoutScopeToken}`)
      .expect(403);
  });

  it("ASSISTANT_ADMIN operasyon, kullanıcı ve KVKK endpoint'lerine giremez", async () => {
    await request(server)
      .get("/tenant-users")
      .set("Authorization", `Bearer ${assistantToken}`)
      .expect(403);

    await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${assistantToken}`)
      .expect(403);

    await request(server)
      .post("/students/student-a/purge-pii")
      .set("Authorization", `Bearer ${assistantToken}`)
      .expect(403);
  });

  it("TENANT_ADMIN menüdeki operasyon yetkili alanları açar", async () => {
    await request(server)
      .get("/tenant-users")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(200);

    await request(server)
      .get("/audit-logs")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(200);

    await request(server)
      .get("/backup-restore-jobs")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(200);
  });

  it("tenant profilini TENANT_ADMIN ve ASSISTANT_ADMIN kurulum yetkisiyle günceller", async () => {
    await request(server)
      .patch("/me/tenant")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({ name: "Yardımcı Kurulum Güncellemesi" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: "tenant-a", name: "YARDIMCI KURULUM GÜNCELLEMESİ" });
      });

    await request(server)
      .patch("/me/tenant")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .send({ name: "DNA EĞİTİM KURUMU" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: "tenant-a", name: "DNA EĞİTİM KURUMU" });
      });
  });

  it("kurum başarı özetini yalnız kurum yöneticilerine açar", async () => {
    await request(server)
      .get("/me/institution-dashboard")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          activeStudentCount: 0,
          attention: {
            attendanceAlertCount: 0,
            openImportQuarantineCount: 0,
            openSupportTicketCount: 0,
          },
        });
      });

    await request(server)
      .get("/me/institution-dashboard")
      .set("Authorization", `Bearer ${assistantToken}`)
      .expect(200);

    await request(server)
      .get("/me/institution-dashboard")
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(403);
  });

  it("ASSISTANT_ADMIN menüde görünen akademik ve destek işlemlerini yapar", async () => {
    await request(server)
      .post("/schedule-lessons")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({
        classId: "class-a",
        teacherId: "teacher-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        title: "Md.Yrd Ders Programı",
        startsAt: "2026-06-01T12:00:00.000Z",
        endsAt: "2026-06-01T13:00:00.000Z",
      })
      .expect(201);

    await request(server)
      .patch("/support-tickets/support-ticket-a")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({ status: "IN_PROGRESS", priority: "HIGH" })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: "support-ticket-a", status: "IN_PROGRESS", priority: "HIGH" });
      });

    const announcementPreview = await request(server)
      .post("/announcements/recipients/preview")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({
        audience: "GUARDIANS",
        channel: "IN_APP",
        classId: "class-a",
      })
      .expect(201);

    await request(server)
      .post("/announcements")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({
        title: "Md.Yrd Duyuru",
        body: "Veli bilgilendirme duyurusu.",
        audience: "GUARDIANS",
        channel: "IN_APP",
        classId: "class-a",
        recipientPreviewToken: announcementPreview.body.previewToken,
      })
      .expect(201);

    await request(server)
      .post("/message-templates")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send({
        name: "Md.Yrd SMS Şablonu",
        channel: "SMS",
        body: "Sayın veli, öğrencimiz için bilgilendirme mesajıdır.",
      })
      .expect(201);
  });

  it("ASSISTANT_ADMIN akademik yönetim yapar, TEACHER yapamaz", async () => {
    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${assistantToken}`)
      .send(examCreateBody("Md.Yrd Yetki Denemesi"))
      .expect(201);

    await request(server)
      .post("/exams")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send(examCreateBody("Öğretmen Yetki Denemesi"))
      .expect(403);
  });

  function examCreateBody(title: string) {
    return {
      title,
      answerKey: {
        version: "rbac-answer-key-v1",
        fileBase64: Buffer.from("fake-xlsx").toString("base64"),
      },
    };
  }
});

class FakeAnswerKeyRepository implements AnswerKeyRepository {
  private readonly records = new Map<string, AnswerKeyRecord>();

  add(input: Pick<SaveAnswerKeyInput, "tenantId" | "examId" | "version">): AnswerKeyRecord {
    const now = "2026-03-01T00:00:00.000Z";
    const record: AnswerKeyRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      examId: input.examId,
      version: input.version,
      questionCount: 1,
      branches: [{ branch: "Matematik", questionCount: 1 }],
      scoringConfig: { wrongPenalty: 0.25 },
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(`${record.tenantId}:${record.examId}:${record.version}`, record);
    return record;
  }

  async create(input: SaveAnswerKeyInput): Promise<AnswerKeyRecord> {
    return this.add(input);
  }

  async list(tenantId: string, examId: string): Promise<AnswerKeyRecord[]> {
    return [...this.records.values()].filter((record) => record.tenantId === tenantId && record.examId === examId);
  }

  async publish(tenantId: string, examId: string, version: string): Promise<AnswerKeyRecord | undefined> {
    const record = this.records.get(`${tenantId}:${examId}:${version}`);
    if (!record) {
      return undefined;
    }
    const updated: AnswerKeyRecord = { ...record, status: "PUBLISHED", publishedAt: "2026-03-01T00:00:00.000Z" };
    this.records.set(`${tenantId}:${examId}:${version}`, updated);
    return updated;
  }
}

class FakeExamRepository implements ExamRepository {
  private readonly exams = new Map<string, ExamRecord>();

  async create(input: CreateExamRepositoryInput): Promise<ExamRecord> {
    const now = "2026-03-01T00:00:00.000Z";
    const exam: ExamRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      ...(input.gradeLevelId ? { gradeLevelId: input.gradeLevelId } : {}),
      ...(input.alanId ? { alanId: input.alanId } : {}),
      ...(input.examType ? { examType: input.examType } : {}),
      title: input.title,
      status: "DRAFT",
      ...(input.startsAt ? { startsAt: input.startsAt } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.exams.set(exam.id, exam);
    return exam;
  }

  async list(tenantId: string): Promise<ExamRecord[]> {
    return [...this.exams.values()].filter((exam) => exam.tenantId === tenantId);
  }

  async findById(tenantId: string, examId: string): Promise<ExamRecord | undefined> {
    const exam = this.exams.get(examId);
    return exam && exam.tenantId === tenantId ? exam : undefined;
  }

  async publish(tenantId: string, examId: string): Promise<ExamRecord | undefined> {
    const exam = this.exams.get(examId);
    if (!exam || exam.tenantId !== tenantId) {
      return undefined;
    }
    const updated: ExamRecord = { ...exam, status: "PUBLISHED" };
    this.exams.set(examId, updated);
    return updated;
  }

  async update(tenantId: string, examId: string, input: UpdateExamRepositoryInput): Promise<ExamRecord | undefined> {
    const exam = this.exams.get(examId);
    if (!exam || exam.tenantId !== tenantId) {
      return undefined;
    }
    const updated: ExamRecord = {
      ...exam,
      title: input.title,
      ...(input.gradeLevelId ? { gradeLevelId: input.gradeLevelId } : { gradeLevelId: undefined }),
      ...(input.alanId ? { alanId: input.alanId } : { alanId: undefined }),
      ...(input.examType ? { examType: input.examType } : { examType: undefined }),
      ...(input.startsAt ? { startsAt: input.startsAt } : {}),
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    this.exams.set(examId, updated);
    return updated;
  }

  async delete(tenantId: string, examId: string): Promise<ExamRecord | undefined> {
    const exam = this.exams.get(examId);
    if (!exam || exam.tenantId !== tenantId) {
      return undefined;
    }
    this.exams.delete(examId);
    return exam;
  }
}

class FakeExamParticipantRepository implements ExamParticipantRepository {
  private readonly participants = new Map<string, ExamParticipantRecord>();

  async list(tenantId: string, examId: string): Promise<ExamParticipantRecord[]> {
    return [...this.participants.values()].filter(
      (participant) => participant.tenantId === tenantId && participant.examId === examId,
    );
  }

  async create(input: CreateExamParticipantRepositoryInput): Promise<ExamParticipantRecord> {
    const now = "2026-03-01T00:00:00.000Z";
    const participant: ExamParticipantRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      examId: input.examId,
      studentId: input.studentId,
      ...(input.participantNo ? { participantNo: input.participantNo } : {}),
      ...(input.bookletType ? { bookletType: input.bookletType } : {}),
      status: "REGISTERED",
      createdAt: now,
      updatedAt: now,
    };
    this.participants.set(participant.id, participant);
    return participant;
  }
}
