import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PortalReportIndexItem } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { examRepositoryToken, type ExamRepository } from "../exam/exam.service.js";
import { isTeacherScopedStudent, type ReportSnapshotRecord } from "../report/report-generation.service.js";
import { reportSnapshotStoreToken, type ReportSnapshotStore } from "../report/report-snapshot-store.js";
import { teacherAssignmentStoreToken, type TeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import { studentStoreToken, type StudentStore } from "../student/student-store.js";
import { filterTenantResources } from "../tenant/tenant-access.js";

@Injectable()
export class MeReportIndexService {
  constructor(
    @Inject(examRepositoryToken) private readonly exams: ExamRepository,
    @Inject(reportSnapshotStoreToken) private readonly snapshots: ReportSnapshotStore,
    @Inject(studentStoreToken) private readonly students: StudentStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignments: TeacherAssignmentStore,
  ) {}

  async listForStudent(context: RequestContext, studentId: string): Promise<PortalReportIndexItem[]> {
    const tenantId = requireTenant(context);
    const [exams, snapshots] = await Promise.all([
      this.exams.list(tenantId),
      this.snapshots.listByTenant(tenantId),
    ]);
    return buildIndex(exams, snapshots.filter((snapshot) =>
      isReady(snapshot) && snapshotStudents(snapshot).some((student) => student.studentId === studentId),
    ));
  }

  async listForTeacher(context: RequestContext): Promise<PortalReportIndexItem[]> {
    const tenantId = requireTenant(context);
    if (context.subjectType !== "TEACHER" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }
    const teacherId = context.subjectId;
    const [exams, snapshots, students, assignments] = await Promise.all([
      this.exams.list(tenantId),
      this.snapshots.listByTenant(tenantId),
      this.students.list(),
      this.teacherAssignments.listByTeacher(teacherId),
    ]);
    const studentById = new Map(
      filterTenantResources(context, students)
        .filter((student) => !student.deletedAt)
        .map((student) => [student.id, student]),
    );
    const scopedAssignments = filterTenantResources(context, assignments);
    return buildIndex(exams, snapshots.filter((snapshot) =>
      isReady(snapshot) && snapshotStudents(snapshot).some(({ studentId }) => {
        const student = studentById.get(studentId);
        return Boolean(student && isTeacherScopedStudent(teacherId, student, scopedAssignments, snapshot));
      }),
    ));
  }
}

function buildIndex(
  exams: Array<{ id: string; title: string; startsAt?: string }>,
  snapshots: ReportSnapshotRecord[],
): PortalReportIndexItem[] {
  const examById = new Map(exams.map((exam) => [exam.id, exam]));
  const latestByExam = new Map<string, ReportSnapshotRecord>();
  for (const snapshot of snapshots) {
    const current = latestByExam.get(snapshot.examId);
    if (!current || snapshotTime(snapshot) > snapshotTime(current)) latestByExam.set(snapshot.examId, snapshot);
  }
  return [...latestByExam.values()]
    .map((snapshot) => {
      const exam = examById.get(snapshot.examId);
      if (!exam) return undefined;
      return {
        examId: exam.id,
        title: exam.title,
        ...(exam.startsAt ? { startsAt: exam.startsAt } : {}),
        latestReadySnapshotId: snapshot.id,
        latestGeneratedAt: generatedAt(snapshot),
      } satisfies PortalReportIndexItem;
    })
    .filter((item): item is PortalReportIndexItem => Boolean(item))
    .sort((left, right) => Date.parse(right.latestGeneratedAt) - Date.parse(left.latestGeneratedAt));
}

function isReady(snapshot: ReportSnapshotRecord): boolean {
  return snapshot.status === "READY" && Boolean(snapshot.snapshotData);
}

function snapshotStudents(snapshot: ReportSnapshotRecord): Array<{ studentId: string }> {
  const students = snapshot.snapshotData?.students;
  if (!Array.isArray(students)) return [];
  return students.flatMap((student) => {
    if (!student || typeof student !== "object" || Array.isArray(student)) return [];
    const studentId = (student as Record<string, unknown>).studentId;
    return typeof studentId === "string" && studentId ? [{ studentId }] : [];
  });
}

function generatedAt(snapshot: ReportSnapshotRecord): string {
  const value = snapshot.snapshotData?.generatedAt;
  return typeof value === "string" && value ? value : snapshot.generatedAt ?? snapshot.updatedAt;
}

function snapshotTime(snapshot: ReportSnapshotRecord): number {
  return Date.parse(generatedAt(snapshot));
}

function requireTenant(context: RequestContext): string {
  if (!context.tenantId) throw new ForbiddenException("TENANT_CONTEXT_MISSING");
  return context.tenantId;
}
