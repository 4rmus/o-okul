import { describe, expect, it, vi } from "vitest";
import { createStudentPortalActivationCode, StudentPortalActivationService } from "./student-portal-activation.service.js";
import type { StudentPortalActivationStore } from "./student-portal-activation-store.js";

describe("StudentPortalActivationService", () => {
  it("12 karakterlik kodu yalnız tanımlı 32 karakterlik alfabeden üretir", () => {
    const codes = Array.from({ length: 256 }, () => createStudentPortalActivationCode());

    expect(codes.every((code) => /^[A-HJ-NP-Z2-9]{12}$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("ham kodu store hash'i ve audit kaydı dışında yalnız issue cevabında gösterir", async () => {
    const issue = vi.fn(async (input: Parameters<StudentPortalActivationStore["issue"]>[0]) => ({
      id: input.id,
      tenantId: input.tenantId,
      tenantSlug: "okul-a",
      studentId: input.studentId,
      studentNo: "101",
      expiresAt: input.expiresAt,
    }));
    const auditLogs = { record: vi.fn() };
    const service = new StudentPortalActivationService(
      { issue, accept: vi.fn() } as StudentPortalActivationStore,
      auditLogs as never,
    );

    const result = await service.issue(
      { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      "student-a",
    );

    expect(result.activationCode).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(result.activationUrl).toContain("/aktivasyon#tenant=");
    expect(result.activationUrl).not.toContain("/aktivasyon?");
    expect(result.activationUrl).toContain(encodeURIComponent(result.activationCode));
    expect(issue.mock.calls[0]?.[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(issue.mock.calls[0]?.[0].tokenHash).not.toContain(result.activationCode);
    expect(JSON.stringify(auditLogs.record.mock.calls)).not.toContain(result.activationCode);
  });

  it("kabul edilen öğrenciye yalnız öğrenci numarasını loginName olarak döner", async () => {
    const auditLogs = { record: vi.fn() };
    const store: StudentPortalActivationStore = {
      issue: vi.fn(),
      accept: vi.fn(async () => ({
        status: "ACCEPTED" as const,
        acceptedAt: "2026-08-01T12:00:00.000Z",
        invitationId: "invitation-a",
        loginName: "101",
        tenantId: "tenant-a",
        studentId: "student-a",
        userId: "user-student-a",
      })),
    };
    const service = new StudentPortalActivationService(store, auditLogs as never);

    await expect(service.accept({
      tenantSlug: " OKUL-A ",
      studentNo: " 101 ",
      code: "abcdefghjkl2",
      password: "secure-password-123",
    })).resolves.toEqual({
      status: "ACCEPTED",
      acceptedAt: "2026-08-01T12:00:00.000Z",
      loginName: "101",
    });
    expect(store.accept).toHaveBeenCalledWith(expect.objectContaining({
      tenantSlug: "okul-a",
      studentNo: "101",
      code: "ABCDEFGHJKL2",
    }));
  });

  it("read-only lisans döneminde public aktivasyon yazısını başlatmaz", async () => {
    const store: StudentPortalActivationStore = { issue: vi.fn(), accept: vi.fn() };
    const service = new StudentPortalActivationService(
      store,
      { record: vi.fn() } as never,
      { findBySlug: vi.fn(async () => ({ id: "tenant-a", status: "ACTIVE" })) } as never,
      {
        resolveForTenant: vi.fn(async () => ({
          mirrorParity: true,
          state: "READ_ONLY",
          term: {
            id: "license-a",
            tenantId: "tenant-a",
            planCode: "PRO",
            startsAt: "2026-01-01T00:00:00.000Z",
            endsAt: "2026-07-31T00:00:00.000Z",
            activeStudentLimit: 100,
          },
        })),
      } as never,
    );

    await expect(service.accept({
      tenantSlug: "okul-a",
      studentNo: "101",
      code: "ABCDEFGHJKL2",
      password: "secure-password-123",
    })).rejects.toThrow("STUDENT_PORTAL_ACTIVATION_INVALID");
    expect(store.accept).not.toHaveBeenCalled();
  });
});
