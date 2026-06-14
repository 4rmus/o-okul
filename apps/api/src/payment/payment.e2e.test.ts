import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("PaymentPlan API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;
  let teacherAAccessToken: string;
  let studentAAccessToken: string;
  let guardianAAccessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    tenantAAccessToken = await login("admin-a@example.test");
    teacherAAccessToken = await login("teacher-a@example.test");
    studentAAccessToken = await login("student-a@example.test");
    guardianAAccessToken = await login("guardian-a@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("kurum kendi tenant ödeme planlarını taksitleriyle listeler", async () => {
    await request(server)
      .get("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          {
            id: "payment-plan-a",
            tenantId: "tenant-a",
            studentId: "student-a",
            title: "2026 Haziran ödeme planı",
            totalAmount: 100000,
            currency: "TRY",
            createdAt: "2026-06-05T09:00:00.000Z",
            installments: [
              {
                id: "payment-installment-a-1",
                tenantId: "tenant-a",
                planId: "payment-plan-a",
                installmentNo: 1,
                amount: 50000,
                dueDate: "2026-07-01",
                status: "PENDING",
                createdAt: "2026-06-05T09:00:00.000Z",
              },
              {
                id: "payment-installment-a-2",
                tenantId: "tenant-a",
                planId: "payment-plan-a",
                installmentNo: 2,
                amount: 50000,
                dueDate: "2026-08-01",
                status: "PENDING",
                createdAt: "2026-06-05T09:00:00.000Z",
              },
            ],
          },
        ]);
      });
  });

  it("yalnız kurum tenant içi öğrenci için ödeme planı oluşturur", async () => {
    const created = await request(server)
      .post("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        studentId: "student-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        title: "2026 Yaz kursu",
        totalAmount: 120000,
        installments: [
          { installmentNo: 1, amount: 60000, dueDate: "2026-07-15" },
          { installmentNo: 2, amount: 60000, dueDate: "2026-08-15", status: "PENDING" },
        ],
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      studentId: "student-a",
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      title: "2026 Yaz kursu",
      totalAmount: 120000,
      currency: "TRY",
      installments: [
        { tenantId: "tenant-a", installmentNo: 1, amount: 60000, dueDate: "2026-07-15", status: "PENDING" },
        { tenantId: "tenant-a", installmentNo: 2, amount: 60000, dueDate: "2026-08-15", status: "PENDING" },
      ],
    });

    await request(server)
      .get("/payment-plans?campusId=campus-main&gradeLevelId=grade-8&classId=class-a&courseId=course-math&termId=term-2026-spring")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([
          expect.objectContaining({
            id: created.body.id,
            campusId: "campus-main",
            gradeLevelId: "grade-8",
            classId: "class-a",
            courseId: "course-math",
            termId: "term-2026-spring",
          }),
        ]);
      });
  });

  it("ödeme planı sınıf/kampüs bağlamı çelişirse reddeder", async () => {
    await request(server)
      .post("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        studentId: "student-a",
        classId: "class-a",
        campusId: "unknown-campus",
        title: "Hatalı bağlam",
        totalAmount: 10000,
        installments: [{ installmentNo: 1, amount: 10000, dueDate: "2026-07-15" }],
      })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("PAYMENT_PLAN_CLASS_CAMPUS_MISMATCH");
      });
  });

  it("ödeme planı oluştururken takvim dışı taksit tarihini 422 ile reddeder", async () => {
    await request(server)
      .post("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        studentId: "student-a",
        title: "Takvim dışı ödeme planı",
        totalAmount: 10000,
        installments: [{ installmentNo: 1, amount: 10000, dueDate: "2026-02-29" }],
      })
      .expect(422)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          error: {
            code: "VALIDATION_FAILED",
            details: {
              fields: expect.arrayContaining([
                expect.objectContaining({
                  message: "PAYMENT_DATE_INVALID",
                  path: "installments.0.dueDate",
                }),
              ]),
            },
          },
        });
      });
  });

  it("başka tenant öğrencisine ödeme planı oluşturmayı reddeder", async () => {
    await request(server)
      .post("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        studentId: "student-b",
        title: "Yanlış tenant",
        totalAmount: 10000,
        installments: [{ installmentNo: 1, amount: 10000, dueDate: "2026-07-15" }],
      })
      .expect(403);
  });

  it("ödeme planı oluşturmayı Idempotency-Key ile tekilleştirir", async () => {
    const body = {
      studentId: "student-a",
      title: "Idempotent ödeme planı",
      totalAmount: 130000,
      installments: [{ installmentNo: 1, amount: 130000, dueDate: "2026-09-15" }],
    };
    const key = "payment-plan-idempotent-create";

    const first = await request(server)
      .post("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, totalAmount: 140000, installments: [{ installmentNo: 1, amount: 140000, dueDate: "2026-09-15" }] })
      .expect(409)
      .expect(({ body: errorBody }) => {
        expect(JSON.stringify(errorBody)).toContain("IDEMPOTENCY_KEY_BODY_MISMATCH");
      });

    await request(server)
      .get("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body: plans }) => {
        expect(plans.filter((plan: { title: string }) => plan.title === body.title)).toHaveLength(1);
      });
  });

  it("öğretmen ve öğrenci kurum ödeme planı endpointine erişemez", async () => {
    await request(server).get("/payment-plans").set("Authorization", `Bearer ${teacherAAccessToken}`).expect(403);
    await request(server).get("/payment-plans").set("Authorization", `Bearer ${studentAAccessToken}`).expect(403);
  });

  it("veli yalnız bağlı öğrencinin ödeme planını görür", async () => {
    await request(server)
      .get("/me/guardian/students/student-a/payment-plans")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body[0]).toMatchObject({
          id: "payment-plan-a",
          tenantId: "tenant-a",
          studentId: "student-a",
          installments: [
            { id: "payment-installment-a-1", installmentNo: 1, status: "PENDING" },
            { id: "payment-installment-a-2", installmentNo: 2, status: "PENDING" },
          ],
        });
      });

    await request(server)
      .get("/me/guardian/students/student-b/payment-plans")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(403);
  });

  it("kurum ödeme taksidini düzenler, ödendi ve gecikmiş olarak işaretler", async () => {
    await request(server)
      .patch("/payment-plans/payment-plan-a/installments/payment-installment-a-1")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ amount: 55000, dueDate: "2026-07-05" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.installments[0]).toMatchObject({
          id: "payment-installment-a-1",
          amount: 55000,
          dueDate: "2026-07-05",
          status: "PENDING",
        });
      });

    await request(server)
      .patch("/payment-plans/payment-plan-a/installments/payment-installment-a-1")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ status: "PAID", paidAt: "2026-07-02T09:30:00.000Z" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.installments).toEqual([
          expect.objectContaining({
            id: "payment-installment-a-1",
            amount: 55000,
            dueDate: "2026-07-05",
            status: "PAID",
            paidAt: "2026-07-02T09:30:00.000Z",
          }),
          expect.objectContaining({
            id: "payment-installment-a-2",
            status: "PENDING",
          }),
        ]);
      });

    await request(server)
      .patch("/payment-plans/payment-plan-a/installments/payment-installment-a-1")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ status: "OVERDUE" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.installments[0]).toMatchObject({
          id: "payment-installment-a-1",
          status: "OVERDUE",
        });
        expect(body.installments[0]).not.toHaveProperty("paidAt");
      });
  });

  it("taksit güncellerken takvim dışı tarihi 422 ile reddeder", async () => {
    await request(server)
      .patch("/payment-plans/payment-plan-a/installments/payment-installment-a-1")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ dueDate: "2026-04-31" })
      .expect(422)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          error: {
            code: "VALIDATION_FAILED",
            details: {
              fields: expect.arrayContaining([
                expect.objectContaining({
                  message: "PAYMENT_DATE_INVALID",
                  path: "dueDate",
                }),
              ]),
            },
          },
        });
      });
  });

  it("taksit güncellemeyi Idempotency-Key ile tekilleştirir", async () => {
    const created = await request(server)
      .post("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        studentId: "student-a",
        title: "Idempotent taksit planı",
        totalAmount: 90000,
        installments: [{ installmentNo: 1, amount: 90000, dueDate: "2026-10-01" }],
      })
      .expect(201);
    const installmentId = created.body.installments[0].id;
    const key = "payment-installment-idempotent-update";
    const update = { status: "PAID", paidAt: "2026-10-02T09:30:00.000Z" };

    const first = await request(server)
      .patch(`/payment-plans/${created.body.id}/installments/${installmentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(update)
      .expect(200);
    const second = await request(server)
      .patch(`/payment-plans/${created.body.id}/installments/${installmentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(update)
      .expect(200);

    expect(second.body).toEqual(first.body);
    expect(second.body.installments[0]).toMatchObject({
      id: installmentId,
      status: "PAID",
      paidAt: "2026-10-02T09:30:00.000Z",
    });

    await request(server)
      .patch(`/payment-plans/${created.body.id}/installments/${installmentId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send({ status: "OVERDUE" })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("IDEMPOTENCY_KEY_BODY_MISMATCH");
      });
  });

  it("öğretmen ve öğrenci ödeme taksidi güncelleyemez", async () => {
    await request(server)
      .patch("/payment-plans/payment-plan-a/installments/payment-installment-a-1")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ status: "PAID" })
      .expect(403);

    await request(server)
      .patch("/payment-plans/payment-plan-a/installments/payment-installment-a-1")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .send({ status: "PAID" })
      .expect(403);
  });

  it("kurum başka tenant ödeme taksidini güncelleyemez", async () => {
    await request(server)
      .patch("/payment-plans/payment-plan-b/installments/payment-installment-b-1")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ status: "PAID" })
      .expect(403);
  });

  it("veli ödeme izni kapalıysa bağlı öğrencinin ödeme planını göremez", async () => {
    await request(server)
      .patch("/guardians/guardian-a/students/student-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ canViewFinance: false })
      .expect(200);

    await request(server)
      .get("/me/guardian/students/student-a/payment-plans")
      .set("Authorization", `Bearer ${guardianAAccessToken}`)
      .expect(403);

    await request(server)
      .patch("/guardians/guardian-a/students/student-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ canViewFinance: true })
      .expect(200);
  });

  it("öğretmen ve öğrenci veli ödeme planı yüzeyinden geçemez", async () => {
    await request(server)
      .get("/me/guardian/students/student-a/payment-plans")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(403);

    await request(server)
      .get("/me/guardian/students/student-a/payment-plans")
      .set("Authorization", `Bearer ${studentAAccessToken}`)
      .expect(403);
  });

  it("KVKK self-service hesap temizliği ödeme planlarını silmez", async () => {
    const before = await request(server)
      .get("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    const privacyToken = await login("finance-privacy@example.test");

    await request(server)
      .post("/privacy/me/purge-pii")
      .set("Authorization", `Bearer ${privacyToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          userId: "user-finance-privacy",
          tenantId: "tenant-a",
        });
      });

    await request(server)
      .get("/payment-plans")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(before.body);
      });
  });
});
