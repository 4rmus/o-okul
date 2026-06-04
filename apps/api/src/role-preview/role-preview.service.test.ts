import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuditLogService, CreateAuditLogInput } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { RolePreviewService } from "./role-preview.service.js";

describe("RolePreviewService", () => {
  it("tenant admin için auditli ve süreli role preview başlatır", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T09:00:00.000Z"));
    const auditLogs = new FakeAuditLogService();
    const service = new RolePreviewService(auditLogs as unknown as AuditLogService);

    const session = await service.start(tenantAdminContext, {
      targetRole: "TEACHER",
      targetSubjectId: "teacher-a",
    });

    expect(session).toMatchObject({
      tenantId: "tenant-a",
      actorUserId: "user-a",
      targetRole: "TEACHER",
      targetSubjectType: "TEACHER",
      targetSubjectId: "teacher-a",
      mode: "READ_ONLY",
      createdAt: "2026-06-10T09:00:00.000Z",
      expiresAt: "2026-06-10T09:15:00.000Z",
    });
    expect(session.previewToken).toEqual(expect.any(String));
    expect(service.verifyPreviewToken(session.previewToken)).toMatchObject({
      id: session.id,
      tenantId: "tenant-a",
      actorUserId: "user-a",
      targetRole: "TEACHER",
      targetSubjectType: "TEACHER",
      targetSubjectId: "teacher-a",
      mode: "READ_ONLY",
      expiresAt: "2026-06-10T09:15:00.000Z",
    });
    expect(auditLogs.records).toEqual([expect.objectContaining({
      tenantId: "tenant-a",
      actorUserId: "user-a",
      entityType: "RolePreview",
      action: "role_preview.started",
      diff: expect.objectContaining({
        targetRole: "TEACHER",
        targetSubjectId: "teacher-a",
        mode: "READ_ONLY",
        expiresAt: "2026-06-10T09:15:00.000Z",
      }),
    })]);
    vi.useRealTimers();
  });

  it("tenant admin olmayan kullanıcı preview başlatamaz", async () => {
    const service = new RolePreviewService();

    await expect(service.start(assistantContext, {
      targetRole: "TEACHER",
      targetSubjectId: "teacher-a",
    })).rejects.toThrow(ForbiddenException);
  });

  it("desteklenmeyen hedef rolü reddeder", async () => {
    const service = new RolePreviewService();

    await expect(service.start(tenantAdminContext, {
      targetRole: "TENANT_ADMIN",
      targetSubjectId: "user-a",
    })).rejects.toThrow(BadRequestException);
  });

  it("süresi dolan preview tokenı reddeder", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T09:00:00.000Z"));
    const service = new RolePreviewService();
    const session = await service.start(tenantAdminContext, {
      targetRole: "STUDENT",
      targetSubjectId: "student-a",
    });

    vi.setSystemTime(new Date("2026-06-10T09:16:00.000Z"));
    expect(() => service.verifyPreviewToken(session.previewToken)).toThrow(ForbiddenException);
    vi.useRealTimers();
  });
});

const tenantAdminContext: RequestContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
};

const assistantContext: RequestContext = {
  tenantId: "tenant-a",
  userId: "assistant-a",
  roles: ["ASSISTANT_ADMIN"],
  bypassRls: false,
};

class FakeAuditLogService {
  records: CreateAuditLogInput[] = [];

  async record(input: CreateAuditLogInput) {
    this.records.push(input);
    return { id: "audit-a", createdAt: "2026-06-06T09:00:00.000Z", ...input };
  }
}
