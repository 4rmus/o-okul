import "reflect-metadata";
import { INestApplication, ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers } from "../auth/auth-user-store.js";
import { HealthService } from "../health/health.service.js";

describe("API error envelope", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;

	  beforeAll(async () => {
	    resetInMemoryAuthUsers();
	    const moduleRef = await Test.createTestingModule({
	      imports: [AppModule],
	    })
	      .overrideProvider(HealthService)
	      .useValue({
	        health: () => ({ status: "ok" }),
	        ready: () => {
	          throw new ServiceUnavailableException({
	            error: {
	              code: "DEPENDENCY_NOT_READY",
	              message: "Postgres veya Redis hazır değil.",
	              details: {
	                postgres: "down",
	                redis: "down",
	              },
	            },
	          });
	        },
	      })
	      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    const login = await request(server)
      .post("/auth/login")
      .send(testLoginBody("admin-a@example.test"))
      .expect(200);
    tenantAAccessToken = (login.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("yetkisiz hatayı sözleşmedeki error zarfıyla döner", async () => {
    const response = await request(server).get("/homework").expect(401);

    expect(response.body).toEqual({
      error: {
        code: "REQUEST_CONTEXT_MISSING",
        message: "Oturum gerekli.",
      },
    });
  });

  it("tenant erişim hatasını sözleşmedeki error zarfıyla döner", async () => {
    const response = await request(server)
      .get("/homework/homework-b")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);

    expect(response.body).toEqual({
      error: {
        code: "FORBIDDEN_TENANT",
        message: "Erişim izni yok.",
      },
    });
  });

  it("hazır olmayan bağımlılık detaylarını korur", async () => {
    const response = await request(server).get("/health/ready").expect(503);

    expect(response.body).toMatchObject({
      error: {
        code: "DEPENDENCY_NOT_READY",
        message: "Postgres veya Redis hazır değil.",
        details: {
          postgres: expect.any(String),
          redis: expect.any(String),
        },
      },
    });
  });

  it("auth login gövde validasyon hatalarını 422 alan listesiyle döner", async () => {
    const response = await request(server)
      .post("/auth/login")
      .send({ tenantSlug: 123, nationalId: " ", password: 123 })
      .expect(422);

    expect(response.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        message: "İstek gövdesi geçersiz.",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({ path: "tenantSlug" }),
            expect.objectContaining({ path: "nationalId" }),
            expect.objectContaining({ path: "password" }),
          ]),
        },
      },
    });
  });

  it("kritik mutation gövdelerini Zod pipe ile 422 olarak reddeder", async () => {
    const scenarios = [
      {
        body: { firstName: 123, lastName: "Veli" },
        field: "firstName",
        path: "/students",
      },
      {
        body: { startsAt: "", title: 123 },
        field: "title",
        path: "/exams",
      },
      {
        body: { installments: [], studentId: "student-a", title: "Hatalı", totalAmount: "1000" },
        field: "totalAmount",
        path: "/payment-plans",
      },
    ];

    for (const scenario of scenarios) {
      const response = await request(server)
        .post(scenario.path)
        .set("Authorization", `Bearer ${tenantAAccessToken}`)
        .send(scenario.body)
        .expect(422);
      expect(response.body).toMatchObject({
        error: {
          code: "VALIDATION_FAILED",
          details: {
            fields: expect.arrayContaining([
              expect.objectContaining({ path: scenario.field }),
            ]),
          },
        },
      });
    }
  });
});
