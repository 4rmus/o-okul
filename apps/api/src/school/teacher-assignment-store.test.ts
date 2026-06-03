import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresTeacherAssignmentStore } from "./teacher-assignment-store.js";

describe("PostgresTeacherAssignmentStore", () => {
  it("TeacherAssignment işlemleri için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "teacher-assignment-a",
              tenantId: "tenant-a",
              teacherId: "teacher-a",
              classId: "class-a",
              studentId: null,
              courseId: null,
              role: "CLASS_TEACHER",
              startsAt: null,
              endsAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresTeacherAssignmentStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.listByTeacher("teacher-a");
        await store.listByStudent("student-a");
        await store.create({ tenantId: "tenant-a", teacherId: "teacher-a", classId: "class-a", role: "CLASS_TEACHER" });
        await store.update("teacher-assignment-a", { role: "GUIDANCE_COUNSELOR", studentId: "student-a" });
        await store.delete("teacher-assignment-a");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('FROM "TeacherAssignment"');
    expect(businessQueries[0]?.values).toEqual(["teacher-a"]);
    expect(businessQueries[1]?.sql).toContain('FROM "TeacherAssignment"');
    expect(businessQueries[1]?.values).toEqual(["student-a"]);
    expect(businessQueries[2]?.sql).toContain('INSERT INTO "TeacherAssignment"');
    expect(businessQueries[2]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "teacher-a",
      "class-a",
      null,
      null,
      null,
      "CLASS_TEACHER",
      null,
      null,
    ]);
    expect(businessQueries[3]?.sql).toContain('UPDATE "TeacherAssignment"');
    expect(businessQueries[3]?.values).toEqual([
      "teacher-assignment-a",
      false,
      null,
      true,
      "student-a",
      false,
      null,
      false,
      null,
      "GUIDANCE_COUNSELOR",
      false,
      null,
      false,
      null,
    ]);
    expect(businessQueries[4]?.sql).toContain('DELETE FROM "TeacherAssignment"');
    expect(businessQueries[4]?.values).toEqual(["teacher-assignment-a"]);
  });
});
