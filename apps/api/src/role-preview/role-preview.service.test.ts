import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuditLogService, CreateAuditLogInput } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import type { GuardianStore } from "../school/guardian-store.js";
import type { TeacherStore } from "../school/teacher-store.js";
import type { StudentStore } from "../student/student-store.js";
import { RolePreviewService } from "./role-preview.service.js";

describe("RolePreviewService", () => {
  it("tenant admin için auditli ve süreli role preview başlatır", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T09:00:00.000Z"));
    const auditLogs = new FakeAuditLogService();
    const service = createService(auditLogs as unknown as AuditLogService);

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
    const service = createService();

    await expect(service.start(assistantContext, {
      targetRole: "TEACHER",
      targetSubjectId: "teacher-a",
    })).rejects.toThrow(ForbiddenException);
  });

  it("desteklenmeyen hedef rolü reddeder", async () => {
    const service = createService();

    await expect(service.start(tenantAdminContext, {
      targetRole: "TENANT_ADMIN",
      targetSubjectId: "user-a",
    })).rejects.toThrow(BadRequestException);
  });

  it("olmayan hedef subject için preview token üretmez", async () => {
    const auditLogs = new FakeAuditLogService();
    const service = createService(auditLogs as unknown as AuditLogService);

    await expect(service.start(tenantAdminContext, {
      targetRole: "TEACHER",
      targetSubjectId: "teacher-missing",
    })).rejects.toThrow(NotFoundException);
    expect(auditLogs.records).toEqual([]);
  });

  it("başka tenant hedef subject için preview token üretmez", async () => {
    const auditLogs = new FakeAuditLogService();
    const service = createService(auditLogs as unknown as AuditLogService);

    await expect(service.start(tenantAdminContext, {
      targetRole: "GUARDIAN",
      targetSubjectId: "guardian-b",
    })).rejects.toThrow(NotFoundException);
    expect(auditLogs.records).toEqual([]);
  });

  it("süresi dolan preview tokenı reddeder", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T09:00:00.000Z"));
    const service = createService();
    const session = await service.start(tenantAdminContext, {
      targetRole: "STUDENT",
      targetSubjectId: "student-a",
    });

    vi.setSystemTime(new Date("2026-06-10T09:16:00.000Z"));
    expect(() => service.verifyPreviewToken(session.previewToken)).toThrow(ForbiddenException);
    vi.useRealTimers();
  });

  it("production'da secret yoksa test fallback ile açılmaz", () => {
    const previousEnv = {
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
      NODE_ENV: process.env.NODE_ENV,
      ROLE_PREVIEW_SECRET: process.env.ROLE_PREVIEW_SECRET,
    };
    try {
      process.env.NODE_ENV = "production";
      delete process.env.JWT_ACCESS_SECRET;
      delete process.env.ROLE_PREVIEW_SECRET;

      expect(() => createService()).toThrow("ROLE_PREVIEW_SECRET_REQUIRED");
    } finally {
      restoreEnv("JWT_ACCESS_SECRET", previousEnv.JWT_ACCESS_SECRET);
      restoreEnv("NODE_ENV", previousEnv.NODE_ENV);
      restoreEnv("ROLE_PREVIEW_SECRET", previousEnv.ROLE_PREVIEW_SECRET);
    }
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

function createService(auditLogs?: AuditLogService): RolePreviewService {
  const stores = createSubjectStores();
  return new RolePreviewService(
    stores.teachers as unknown as TeacherStore,
    stores.students as unknown as StudentStore,
    stores.guardians as unknown as GuardianStore,
    auditLogs,
  );
}

function createSubjectStores() {
  return {
    teachers: new FakeSubjectStore([
      { id: "teacher-a", tenantId: "tenant-a" },
      { id: "teacher-b", tenantId: "tenant-b" },
    ]),
    students: new FakeSubjectStore([
      { id: "student-a", tenantId: "tenant-a" },
      { id: "student-b", tenantId: "tenant-b" },
    ]),
    guardians: new FakeSubjectStore([
      { id: "guardian-a", tenantId: "tenant-a" },
      { id: "guardian-b", tenantId: "tenant-b" },
    ]),
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

class FakeSubjectStore<TRecord extends { id: string; tenantId: string }> {
  constructor(private readonly records: TRecord[]) {}

  async findById(id: string): Promise<TRecord | undefined> {
    return this.records.find((candidate) => candidate.id === id);
  }
}

class FakeAuditLogService {
  records: CreateAuditLogInput[] = [];

  async record(input: CreateAuditLogInput) {
    this.records.push(input);
    return { id: "audit-a", createdAt: "2026-06-06T09:00:00.000Z", ...input };
  }
}
