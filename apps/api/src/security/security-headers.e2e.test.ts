import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Security headers", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  it("temel güvenlik header'larını döner", async () => {
    const response = await request(server).get("/health").expect(200);

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    expect(response.headers["strict-transport-security"]).toContain("max-age=");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});
