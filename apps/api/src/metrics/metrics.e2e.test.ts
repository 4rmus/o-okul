import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

describe("Metrics API", () => {
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

  it("Prometheus formatında uptime ve request sayacı döner", async () => {
    await request(server).get("/health").expect(200);

    const response = await request(server).get("/metrics").expect(200);

    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("# TYPE o_okul_process_uptime_seconds gauge");
    expect(response.text).toContain("o_okul_http_requests_total");
    expect(response.text).toContain("# TYPE o_okul_queue_jobs gauge");
    expect(response.text).toContain("o_okul_queue_metrics_scrape_error 0");
    expect(response.text).toContain('method="GET"');
    expect(response.text).toContain('path="/health"');
    expect(response.text).toContain('status="200"');
  });
});
