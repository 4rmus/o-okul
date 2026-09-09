import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import type { RequestContext } from "../context/request-context.js";
import { testLoginBody } from "../test-auth.js";
import { DeviceBackupService } from "./device-backup.service.js";

describe("device backup HTTP boundary", () => {
  let app: INestApplication, token: string, teacher: string;
  const backups = { status: vi.fn(() => ({ available: true, maxFileBytes: 33558528 })), download: vi.fn(async (_context: RequestContext, _password: string) => Buffer.from("signed-encrypted-fixture")), preview: vi.fn(async (_context: RequestContext, _file: Buffer, _password: string, _planToken?: string) => ({ backupId: "a".repeat(32), integrityVerified: true, restoreVerified: false, canRestore: false })) };
  beforeAll(async () => {
    resetInMemoryAuthUsers();
    upsertInMemoryAuthUser({ id: "user-tenant-a", email: "admin-a@example.test", name: "Tenant A Admin", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], password: "password", membership: { id: "member-a", staffRole: "TENANT_ADMIN", hasTeacherPersona: false, hasStudentPersona: false, version: 2, scopeMode: "TENANT" } });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DeviceBackupService).useValue(backups).compile();
    app = module.createNestApplication(); await app.listen(0, "127.0.0.1");
    token = (await request(app.getHttpServer()).post("/auth/login").send(testLoginBody("admin-a@example.test")).expect(200)).body.accessToken;
    teacher = (await request(app.getHttpServer()).post("/auth/login").send(testLoginBody("teacher-a@example.test")).expect(200)).body.accessToken;
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await app.close(); resetInMemoryAuthUsers(); });
  it("downloads an attachment without caching and binds the authenticated institution", async () => {
    await request(app.getHttpServer()).post("/device-backups/download").set("Authorization", `Bearer ${token}`).send({ password: "a long archive password" }).expect(200).expect("content-type", /application\/octet-stream/).expect("cache-control", "no-store").expect("content-disposition", /\.ookulbackup/);
    expect(backups.download).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }), "a long archive password");
  });
  it("parses one bounded multipart file and never exposes an apply action", async () => {
    const response = await request(app.getHttpServer()).post("/device-backups/preview").set("Authorization", `Bearer ${token}`).field("password", "a long archive password").attach("file", Buffer.from("fixture"), "test.ookulbackup").expect(response => { expect(response.status, JSON.stringify(response.body)).toBe(201); });
    expect(response.body).toMatchObject({ integrityVerified: true, restoreVerified: false, canRestore: false });
    expect(backups.preview).toHaveBeenCalledOnce();
    expect(backups.preview.mock.calls[0]?.[0]).toMatchObject({ tenantId: "tenant-a" });
    await request(app.getHttpServer()).post("/device-backups/restore").set("Authorization", `Bearer ${token}`).send({}).expect(404);
  });
  it("accepts only the bounded optional plan token alongside the original archive", async () => {
    await request(app.getHttpServer()).post("/device-backups/preview").set("Authorization",`Bearer ${token}`).field("password","a long archive password").field("planToken","fixture-plan").attach("file",Buffer.from("fixture"),"test.ookulbackup").expect(201);
    expect(backups.preview.mock.calls[0]?.[3]).toBe("fixture-plan");
    await request(app.getHttpServer()).post("/device-backups/preview").set("Authorization",`Bearer ${token}`).field("password","a long archive password").field("unexpected","value").attach("file",Buffer.from("fixture"),"test.ookulbackup").expect(400);
  });
  it("rejects unauthorized callers before invoking the service", async () => {
    await request(app.getHttpServer()).post("/device-backups/download").send({ password: "a long archive password" }).expect(401);
    await request(app.getHttpServer()).post("/device-backups/preview").set("Authorization", `Bearer ${teacher}`).field("password", "a long archive password").attach("file", Buffer.from("fixture"), "test.ookulbackup").expect(403);
    expect(backups.preview).not.toHaveBeenCalled(); expect(backups.download).not.toHaveBeenCalled();
  });
  it("rejects extra fields, weak passwords, missing files and multiple files", async () => {
    await request(app.getHttpServer()).post("/device-backups/download").set("Authorization", `Bearer ${token}`).send({ password: "a long archive password", tenantId: "tenant-b" }).expect(400);
    await request(app.getHttpServer()).post("/device-backups/download").set("Authorization", `Bearer ${token}`).send({ password: "            " }).expect(400);
    await request(app.getHttpServer()).post("/device-backups/preview").set("Authorization", `Bearer ${token}`).field("password", "a long archive password").expect(400);
    await request(app.getHttpServer()).post("/device-backups/preview").set("Authorization", `Bearer ${token}`).field("password", "a long archive password").attach("file", Buffer.from("a"), "a.ookulbackup").attach("file", Buffer.from("b"), "b.ookulbackup").expect(400);
    expect(backups.preview).not.toHaveBeenCalled(); expect(backups.download).not.toHaveBeenCalled();
  });
});
