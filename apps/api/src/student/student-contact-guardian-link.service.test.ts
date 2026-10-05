import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { StudentContactGuardianLinkService } from "./student-contact-guardian-link.service.js";

const context: RequestContext = { userId: "user-admin", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false };

function service(storeError: Error) {
  const contact = { id: "contact-a", tenantId: "tenant-a", studentId: "student-a", relationType: "LEGAL_GUARDIAN" };
  const fail = async () => { throw storeError; };
  return new StudentContactGuardianLinkService(
    { findOne: async () => ({ id: "student-a", tenantId: "tenant-a" }) } as never,
    { findGuardian: async () => ({ id: "guardian-a" }) } as never,
    { findById: async () => contact, linkGuardianWithStudentLink: fail, linkUserAsGuardianWithStudentLink: fail } as never,
    { findByUserId: async () => undefined } as never,
    { findById: async () => ({ id: "user-a", tenantId: "tenant-a", roles: ["GUARDIAN"] }) } as never,
  );
}

describe("StudentContactGuardianLinkService (KV-3b race)", () => {
  it("bağ/bağ kaldırma yarışında store çakışma kodu 500 değil 409 olur", async () => {
    const conflict = new Error("STUDENT_CONTACT_GUARDIAN_LINK_CONFLICT");
    for (const target of [{ guardianId: "guardian-a" }, { userId: "user-a" }]) {
      const result = service(conflict).link(context, "student-a", "contact-a", target, "key-a");
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(service(conflict).link(context, "student-a", "contact-a", target, "key-a")).rejects.toThrow("STUDENT_CONTACT_GUARDIAN_LINK_CONFLICT");
    }
    // Any other store failure is not swallowed into a 409.
    await expect(service(new Error("boom")).link(context, "student-a", "contact-a", { guardianId: "guardian-a" }, "key-b"))
      .rejects.not.toBeInstanceOf(ConflictException);
  });
});
