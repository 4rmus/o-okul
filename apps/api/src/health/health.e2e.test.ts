import "reflect-metadata";
import { INestApplication, ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, it } from "vitest";
import { AppModule } from "../app.module.js";
import { HealthService } from "./health.service.js";

describe("health endpoints", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

	  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  it("/health yaşam sinyali döndürür", async () => {
    await request(server).get("/health").expect(200, { status: "ok" });
  });

  it("/health/ready DB veya Redis hazır değilken ready saymaz", async () => {
    await request(server).get("/health/ready").expect(503);
  });
});
