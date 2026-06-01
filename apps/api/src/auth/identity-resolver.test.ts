import { describe, expect, it } from "vitest";
import { InMemoryGuardianStore } from "../school/guardian-store.js";
import { InMemoryTeacherStore } from "../school/teacher-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { IdentityResolver } from "./identity-resolver.js";

describe("IdentityResolver", () => {
  it("subject bilgisini userId bağı olan öğrenci, veli ve öğretmen kaydından çözer", async () => {
    const resolver = new IdentityResolver(
      new InMemoryStudentStore(),
      new InMemoryGuardianStore(),
      new InMemoryTeacherStore(),
    );

    await expect(
      resolver.resolve({ userId: "student-tenant-a", tenantId: "tenant-a", roles: ["STUDENT"] }),
    ).resolves.toEqual({ subjectType: "STUDENT", subjectId: "student-a" });
    await expect(
      resolver.resolve({ userId: "guardian-tenant-a", tenantId: "tenant-a", roles: ["GUARDIAN"] }),
    ).resolves.toEqual({ subjectType: "GUARDIAN", subjectId: "guardian-a" });
    await expect(
      resolver.resolve({ userId: "teacher-tenant-a", tenantId: "tenant-a", roles: ["TEACHER"] }),
    ).resolves.toEqual({ subjectType: "TEACHER", subjectId: "teacher-a" });
  });

  it("tenant admin için subject üretmez", async () => {
    const resolver = new IdentityResolver(
      new InMemoryStudentStore(),
      new InMemoryGuardianStore(),
      new InMemoryTeacherStore(),
    );

    await expect(
      resolver.resolve({ userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"] }),
    ).resolves.toBeUndefined();
  });
});
