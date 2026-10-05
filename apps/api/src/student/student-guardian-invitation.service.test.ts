import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { GuardianService } from "../guardian/guardian.service.js";
import type { IdentityInvitationService } from "../identity-invitation/identity-invitation.service.js";
import type { UserManagementStore } from "../user-management/user-management-store.js";
import { encryptStudentContactValue } from "./student-contact-pii.js";
import type { StudentContactStorageRecord, StudentContactStore } from "./student-contact-store.js";
import { StudentGuardianInvitationService } from "./student-guardian-invitation.service.js";
import type { StudentService } from "./student.service.js";

const context = { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"] } as unknown as RequestContext;

// The linked-guardian path (guardian without account or pending invitation) is not reachable through the e2e API.
function setup(existingPhone: string | undefined) {
  const contact: StudentContactStorageRecord = {
    id: "contact-1", tenantId: "tenant-a", studentId: "student-1", firstName: "Veli", lastName: "Yasal",
    relationType: "LEGAL_GUARDIAN", guardianId: "guardian-1",
    emailEncrypted: encryptStudentContactValue("veli@example.test"), phoneEncrypted: encryptStudentContactValue("5551000001"),
    canReceiveSms: false, canReceiveAnnouncements: false, canReceiveFinance: false, createdAt: "", updatedAt: "",
  };
  const guardians = {
    findGuardian: vi.fn(async () => ({ id: "guardian-1", tenantId: "tenant-a", firstName: "Veli", lastName: "Yasal", phone: existingPhone })),
    updateGuardian: vi.fn(async () => ({})),
    // The real shared rule, running against the mocked findGuardian/updateGuardian above.
    fillEmptyPhone: GuardianService.prototype.fillEmptyPhone,
  };
  const service = new StudentGuardianInvitationService(
    { findOne: async () => ({ id: "student-1" }) } as unknown as StudentService,
    guardians as unknown as GuardianService,
    {
      list: async () => [],
      create: async () => ({ invitation: { id: "invitation-1" } }),
    } as unknown as IdentityInvitationService,
    { listByStudent: async () => [contact] } as unknown as StudentContactStore,
    { listTenantUsers: async () => [] } as unknown as UserManagementStore,
  );
  return { service, guardians };
}

describe("StudentGuardianInvitationService guardian phone (2026-10-05)", () => {
  it("does not overwrite a guardian phone that is already set", async () => {
    const { service, guardians } = setup("5559999999");
    const result = await service.inviteBulk(context, { studentIds: ["student-1"] }, "key-1");
    expect(result.createdCount).toBe(1);
    expect(guardians.updateGuardian).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("555");
  });

  it("fills an empty guardian phone from the LEGAL_GUARDIAN contact", async () => {
    const { service, guardians } = setup(undefined);
    const result = await service.inviteBulk(context, { studentIds: ["student-1"] }, "key-2");
    expect(guardians.updateGuardian).toHaveBeenCalledWith(context, "guardian-1", { phone: "5551000001" });
    expect(JSON.stringify(result)).not.toContain("5551000001");
  });
});
