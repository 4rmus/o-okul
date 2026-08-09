import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { testLoginBody } from "../test-auth.js";

describe("Feature rollout API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantToken: string;
  let systemToken: string;
  const auditRecord = vi.fn().mockResolvedValue({});
  const originalConfig = process.env.FEATURE_ROLLOUTS_JSON;
  const originalEnvironment = process.env.FEATURE_ROLLOUT_ENVIRONMENT;
  const originalPublicFlag = process.env.NEXT_PUBLIC_SHELL_V2_ENABLED;

  beforeAll(async () => {
    const now = Date.now();
    process.env.FEATURE_ROLLOUT_ENVIRONMENT = "local";
    process.env.NEXT_PUBLIC_SHELL_V2_ENABLED = "true";
    process.env.FEATURE_ROLLOUTS_JSON = JSON.stringify({
      "web.shell-v2": [{
        environment: "local",
        tenantId: "tenant-a",
        startsAt: new Date(now - 60_000).toISOString(),
        expiresAt: new Date(now + 60 * 60_000).toISOString(),
        reference: "DEC-20260809-01",
      }],
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuditLogService)
      .useValue({ record: auditRecord })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
    tenantToken = await login("admin-a@example.test");
    systemToken = await login("system@example.test");
  });

  afterAll(async () => {
    await app.close();
    if (originalConfig === undefined) delete process.env.FEATURE_ROLLOUTS_JSON;
    else process.env.FEATURE_ROLLOUTS_JSON = originalConfig;
    if (originalEnvironment === undefined) delete process.env.FEATURE_ROLLOUT_ENVIRONMENT;
    else process.env.FEATURE_ROLLOUT_ENVIRONMENT = originalEnvironment;
    if (originalPublicFlag === undefined) delete process.env.NEXT_PUBLIC_SHELL_V2_ENABLED;
    else process.env.NEXT_PUBLIC_SHELL_V2_ENABLED = originalPublicFlag;
  });

  it("yalnız çözülen keyleri no-store response ile döndürür", async () => {
    const response = await request(server)
      .get("/me/feature-rollouts")
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(200);

    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toEqual({ enabledFeatureKeys: ["web.shell-v2"] });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("tenant-a");
    expect(serialized).not.toContain("DEC-20260809-01");
    expect(serialized).not.toContain("environment");
    expect(serialized).not.toContain("startsAt");
    expect(serialized).not.toContain("expiresAt");
  });

  it("oturumsuz isteği reddeder; query/header/client env tenant veya environment değiştiremez", async () => {
    await request(server).get("/me/feature-rollouts").expect(401);

    const response = await request(server)
      .get("/me/feature-rollouts?tenantId=tenant-b&environment=production")
      .set("Authorization", `Bearer ${tenantToken}`)
      .set("x-feature-rollout-environment", "production")
      .expect(200);
    expect(response.body).toEqual({ enabledFeatureKeys: ["web.shell-v2"] });
  });

  it("SYSTEM_ADMIN ve bypass header ile tenant flagi çözülemez", async () => {
    await request(server)
      .get("/me/feature-rollouts")
      .set("Authorization", `Bearer ${systemToken}`)
      .expect(403);
    await request(server)
      .get("/me/feature-rollouts")
      .set("Authorization", `Bearer ${systemToken}`)
      .set("x-rls-bypass-reason", "feature rollout inspection")
      .expect(403);
  });

  it("enabled exposure audit yazılamazsa response fail-closed kalır", async () => {
    auditRecord.mockImplementationOnce(async () => {
      throw new Error("AUDIT_DOWN");
    });
    const response = await request(server)
      .get("/me/feature-rollouts")
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(500);
    expect(JSON.stringify(response.body)).not.toContain("web.shell-v2");
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }
});
