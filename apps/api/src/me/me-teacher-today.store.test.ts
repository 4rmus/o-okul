import { describe, expect, it } from "vitest";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { InMemoryTeacherTodayStore, PostgresTeacherTodayStore } from "./me-teacher-today.store.js";

const teacherContext: RequestContext = {
  tenantId: "tenant-a",
  userId: "user-teacher",
  roles: ["TEACHER"],
  bypassRls: false,
  subjectType: "TEACHER",
  subjectId: "teacher-a",
};

function createPool(rowsFor: (sql: string) => unknown[]) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    queries,
    pool: {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: rowsFor(sql) as T[] };
      },
    },
  };
}

describe("PostgresTeacherTodayStore", () => {
  it("yalnız verilen kapsam kimlikleri üzerinde tenant işlemi içinde sayar", async () => {
    const { pool, queries } = createPool((sql) => {
      if (sql.includes('FROM "Attendance"')) return [{ classId: "class-a" }];
      if (sql.includes('FROM "HomeworkSubmission"')) return [{ count: 4 }];
      if (sql.includes('FROM "GradeEntry"')) return [{ count: 2 }];
      return [];
    });
    const store = new PostgresTeacherTodayStore(pool);

    const result = await runWithRequestContext(teacherContext, () => store.loadInbox({
      tenantId: "tenant-a",
      date: "2026-10-01",
      classIds: ["class-a", "class-b"],
      homeworkIds: ["homework-a"],
      studentIds: ["student-a"],
      assessmentIds: ["assessment-a"],
    }));

    expect(result).toEqual({ attendanceClassIds: ["class-a"], pendingSubmissionCount: 4, unpublishedGradeDraftCount: 2 });
    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some((query) => query.sql.includes("app.current_tenant_id") && query.values?.[0] === "tenant-a")).toBe(true);
    const attendance = queries.find((query) => query.sql.includes('FROM "Attendance"'));
    expect(attendance?.values).toEqual(["tenant-a", "2026-10-01", ["class-a", "class-b"]]);
    expect(attendance?.sql).toContain('attendance."deletedAt" IS NULL');
    const submissions = queries.find((query) => query.sql.includes('FROM "HomeworkSubmission"'));
    expect(submissions?.values).toEqual(["tenant-a", ["homework-a"], ["student-a"]]);
    expect(submissions?.sql).toContain('submission."studentId" = ANY($3::text[])');
    expect(submissions?.sql).toContain('submission."checkedAt" IS NULL');
    expect(submissions?.sql).toContain('homework."checkedAt" IS NULL');
    expect(submissions?.sql).toContain('student."classId" = homework."classId"');
    const drafts = queries.find((query) => query.sql.includes('FROM "GradeEntry"'));
    expect(drafts?.values).toEqual(["tenant-a", ["assessment-a"]]);
    expect(drafts?.sql).toContain('entry."publishedAt" IS NULL');
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("boş kapsamda sorgu çalıştırmaz, okunamayan öğrenci ve not defteri kapsamında sayaçları düşürür", async () => {
    const { pool, queries } = createPool(() => []);
    const store = new PostgresTeacherTodayStore(pool);

    const result = await runWithRequestContext(teacherContext, () => store.loadInbox({
      tenantId: "tenant-a",
      date: "2026-10-01",
      classIds: [],
      homeworkIds: [],
    }));

    expect(result).toEqual({ attendanceClassIds: [] });
    expect(queries.filter((query) => /FROM "(Attendance|HomeworkSubmission|GradeEntry)"/.test(query.sql))).toEqual([]);

    const noVisibleStudents = await runWithRequestContext(teacherContext, () => store.loadInbox({
      tenantId: "tenant-a",
      date: "2026-10-01",
      classIds: [],
      homeworkIds: ["homework-a"],
      studentIds: [],
    }));
    expect(noVisibleStudents).toEqual({ attendanceClassIds: [], pendingSubmissionCount: 0 });
    expect(queries.filter((query) => query.sql.includes('FROM "HomeworkSubmission"'))).toEqual([]);
  });
});

describe("InMemoryTeacherTodayStore", () => {
  it("diğer modüllerin bellek içi kayıtlarını okuyamadığı için bilinmiyor döner", async () => {
    await expect(new InMemoryTeacherTodayStore().loadInbox({ tenantId: "t", date: "2026-10-01", classIds: ["c"], homeworkIds: ["h"] })).resolves.toBeUndefined();
  });
});
