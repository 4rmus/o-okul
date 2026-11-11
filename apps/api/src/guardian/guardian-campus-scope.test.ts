import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import type { IdentityProvisioningService } from "../identity-provisioning/identity-provisioning.service.js";
import { IdempotencyService, InMemoryIdempotencyStore } from "../http/idempotency.js";
import { InMemoryClassStore } from "../school/class-store.js";
import { InMemoryGuardianStore } from "../school/guardian-store.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryTeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { GuardianService } from "./guardian.service.js";
import { toGuardianResponse } from "./guardian-response.js";

const admin: RequestContext = { userId: "admin", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false };
const scoped: RequestContext = {
  ...admin, userId: "operations-main", roles: ["OPERATIONS_STAFF"], activePersona: "STAFF",
  campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
};

async function setup() {
  const guardians = new InMemoryGuardianStore();
  const links = new InMemoryGuardianStudentStore();
  const students = new InMemoryStudentStore();
  const classes = new InMemoryClassStore();
  const assignments = new InMemoryTeacherAssignmentStore();
  const otherClass = await classes.create({ tenantId: "tenant-a", name: "Other", campusId: "campus-other" });
  const foreignStudent = await students.create({ tenantId: "tenant-a", firstName: "Other", lastName: "Student", classId: otherClass.id });
  const available = await students.create({ tenantId: "tenant-a", firstName: "Available", lastName: "Main", classId: "class-a" });
  const unplaced = await students.create({ tenantId: "tenant-a", firstName: "Unplaced", lastName: "Student" });
  const outside = await guardians.create({ tenantId: "tenant-a", firstName: "Outside", lastName: "Guardian", phone: "5321234567" });
  const unlinked = await guardians.create({ tenantId: "tenant-a", firstName: "Legacy", lastName: "Unlinked" });
  const shared = await guardians.create({ tenantId: "tenant-a", firstName: "Shared", lastName: "Guardian", phone: "5321234568" });
  await links.create({ tenantId: "tenant-a", guardianId: outside.id, studentId: foreignStudent.id });
  await links.create({ tenantId: "tenant-a", guardianId: shared.id, studentId: "student-a" });
  await links.create({ tenantId: "tenant-a", guardianId: shared.id, studentId: foreignStudent.id });
  const lifecycle = {
    provisionOrInvite: vi.fn(async () => ({ status: "SKIPPED" })),
    deactivateProfile: vi.fn(async () => ({ userId: "guardian-user", roleRemoved: true, sessionsClosed: true, invitationsRevoked: 0 })),
  };
  const service = new GuardianService(guardians, links, students, classes, assignments, undefined, lifecycle as unknown as IdentityProvisioningService,
    new IdempotencyService(new InMemoryIdempotencyStore()));
  return { service, guardians, links, students, classes, outside, unlinked, shared, foreignStudent, available, unplaced, lifecycle };
}

describe("guardian campus scope", () => {
  it("limits list, detail, linked and available students to the authorized campus", async () => {
    const f = await setup();
    expect((await f.service.listGuardians(scoped)).map((row) => row.id).sort()).toEqual(["guardian-a", f.shared.id].sort());
    await expect(f.service.findGuardian(scoped, f.outside.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.findGuardian(scoped, f.unlinked.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await f.service.listGuardianStudents(scoped, f.shared.id)).map((link) => link.studentId)).toEqual(["student-a"]);
    const details = await f.service.listGuardianStudentDetails(scoped, f.shared.id);
    expect(details.links.map((link) => link.studentId)).toEqual(["student-a"]);
    expect(details.linkedStudents.map((row) => row.id)).toEqual(["student-a"]);
    expect(details.availableStudents.map((row) => row.id)).toEqual([f.available.id]);
    expect((await f.service.listStudentGuardians(scoped, "student-a")).map((row) => row.id)).toContain(f.shared.id);
    await expect(f.service.listStudentGuardians(scoped, f.foreignStudent.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.listStudentGuardianLinks(scoped, f.foreignStudent.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("uses one tenant bulk link projection instead of a query for every guardian", async () => {
    const f = await setup();
    const perGuardian = vi.spyOn(f.links, "listByGuardian");
    const bulk = vi.spyOn(f.links, "listPairs");
    await f.service.listGuardians(scoped);
    expect(perGuardian).not.toHaveBeenCalled();
    expect(bulk).toHaveBeenCalledExactlyOnceWith("tenant-a");
  });

  it("denies foreign targets for every link write without changing their permissions", async () => {
    const f = await setup();
    const before = await f.links.listByGuardian(f.shared.id);
    await expect(f.service.linkGuardianStudent(scoped, f.shared.id, f.foreignStudent.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.updateGuardianStudent(scoped, f.shared.id, f.foreignStudent.id, { canViewFinance: true })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.unlinkGuardianStudent(scoped, f.shared.id, f.foreignStudent.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.linkGuardianStudent(scoped, f.outside.id, "student-a")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.linkGuardianStudent(scoped, f.unlinked.id, "student-a")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.linkGuardianStudent(scoped, "guardian-a", f.unplaced.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await f.links.listByGuardian(f.shared.id)).toEqual(before);
    await f.service.linkGuardianStudent(scoped, f.shared.id, f.available.id);
    expect((await f.service.updateGuardianStudent(scoped, f.shared.id, f.available.id, { canViewFinance: true })).canViewFinance).toBe(true);
    await f.service.unlinkGuardianStudent(scoped, f.shared.id, f.available.id);
    expect((await f.links.listByGuardian(f.shared.id)).map((row) => row.studentId)).toEqual(["student-a", f.foreignStudent.id]);
  });

  it("protects profile, account and identity matching changes affecting another campus", async () => {
    const f = await setup();
    await expect(f.service.updateGuardian(scoped, f.shared.id, { firstName: "Changed" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.deleteGuardian(scoped, f.shared.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.purgeGuardianPii(scoped, f.shared.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.createGuardian(scoped, { phone: f.outside.phone })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.createGuardian(scoped, { phone: f.shared.phone })).rejects.toBeInstanceOf(ForbiddenException);
    expect((await f.guardians.findById(f.shared.id))?.firstName).toBe("Shared");
    expect(f.lifecycle.deactivateProfile).not.toHaveBeenCalled();
    await expect(f.service.updateGuardian(scoped, "guardian-a", { firstName: "Allowed" })).resolves.toMatchObject({ firstName: "Allowed" });
  });

  it("preserves scoped create→link with immutable server provenance, then relink after unlink", async () => {
    const f = await setup();
    const created = await f.service.createGuardian(scoped, { firstName: "New", lastName: "Guardian" });
    await expect(f.service.findGuardian(scoped, created.id)).resolves.toMatchObject({ id: created.id });
    await expect(f.service.findGuardian({ ...scoped, userId: "other-operator" }, created.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.linkGuardianStudent({ ...scoped, userId: "other-operator" }, created.id, "student-a")).rejects.toBeInstanceOf(ForbiddenException);
    expect(toGuardianResponse(created, scoped)).not.toHaveProperty("createdByUserId");
    await f.service.linkGuardianStudent(scoped, created.id, "student-a");
    await f.service.unlinkGuardianStudent(scoped, created.id, "student-a");
    await expect(f.service.linkGuardianStudent(scoped, created.id, f.available.id)).resolves.toMatchObject({ studentId: f.available.id });
  });

  it("fails closed without an operations scope on reads, writes and matching", async () => {
    const f = await setup();
    const missing = { ...scoped, campusScope: undefined };
    for (const run of [
      () => f.service.listGuardians(missing), () => f.service.findGuardian(missing, "guardian-a"),
      () => f.service.listStudentGuardians(missing, "student-a"), () => f.service.listStudentGuardianLinks(missing, "student-a"),
      () => f.service.createGuardian(missing, { firstName: "Denied" }),
      () => f.service.updateGuardian(missing, "guardian-a", { firstName: "Denied" }),
      () => f.service.linkGuardianStudent(missing, "guardian-a", "student-a"),
    ]) await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
    expect((await f.guardians.list()).some((row) => row.firstName === "Denied")).toBe(false);
  });

  it("reauthorizes cached create and link responses for the current actor and campus", async () => {
    const f = await setup();
    const input = { firstName: "Replay", lastName: "Guardian" };
    const created = await f.service.createGuardian(scoped, input, "guardian-create");
    await expect(f.service.createGuardian(scoped, input, "guardian-create")).resolves.toMatchObject({ id: created.id });
    await expect(f.service.createGuardian({ ...scoped, userId: "other-operator" }, input, "guardian-create")).rejects.toThrow();
    await f.service.linkGuardianStudent(scoped, created.id, "student-a", {}, "guardian-link");
    const movedScope = { ...scoped, campusScope: { scopeMode: "CAMPUSES" as const, campusIds: ["campus-other"] } };
    await expect(f.service.createGuardian(movedScope, input, "guardian-create")).rejects.toThrow();
    await expect(f.service.linkGuardianStudent(movedScope, created.id, "student-a", {}, "guardian-link")).rejects.toThrow();
    await expect(f.service.linkGuardianStudent(scoped, created.id, "student-a", {}, "guardian-link")).resolves.toMatchObject({ studentId: "student-a" });
  });

  it("preserves tenant-wide, teacher and guardian-self workflows", async () => {
    const f = await setup();
    const tenantOps = { ...scoped, campusScope: { scopeMode: "TENANT" as const, campusIds: [] } };
    expect((await f.service.listGuardians(tenantOps)).map((row) => row.id)).toContain(f.outside.id);
    await expect(f.service.linkGuardianStudent(tenantOps, f.unlinked.id, f.foreignStudent.id)).resolves.toMatchObject({ studentId: f.foreignStudent.id });
    const teacher = { ...admin, roles: ["TEACHER"], subjectType: "TEACHER" as const, subjectId: "teacher-a" };
    expect((await f.service.listGuardians(teacher)).map((row) => row.id).sort()).toEqual(["guardian-a", f.shared.id].sort());
    const self = { ...admin, roles: ["GUARDIAN"], subjectType: "GUARDIAN" as const, subjectId: f.shared.id };
    await expect(f.service.updateCurrentGuardianNotificationPreferences(self, f.foreignStudent.id, { canReceiveSms: true })).resolves.toMatchObject({ canReceiveSms: true });
    await expect(f.service.findGuardian(admin, f.unlinked.id)).resolves.toMatchObject({ id: f.unlinked.id });
  });
});
