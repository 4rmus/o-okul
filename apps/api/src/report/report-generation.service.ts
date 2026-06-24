import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, type OnModuleDestroy } from "@nestjs/common";
import type {
  ReportPdfInstitution,
  ReportPdfRenderJobPayload,
  ReportPdfRenderJobResult,
  ReportPdfSnapshotRecord,
  ReportErrorBooklet,
  ReportScopeRank,
  ReportStudentBranchStatistics,
  ReportStudentBranchSummary,
  ReportStudentCommentary,
  ReportStudentOutcomeSummary,
  ReportStudentProgress,
  ReportStudentProgressPoint,
  ReportStudentQuestionSummary,
  ReportStudentScoreSummary,
  ReportStudentSnapshot,
  ReportStudentStatistics,
} from "@uzman-hocam/shared-types";
import { Queue, QueueEvents } from "bullmq";
import ExcelJS from "exceljs";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { parseRedisUrl } from "../config/env.js";
import { resolvePersistenceDriver } from "../config/persistence.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import type { ProducedJob, TenantQueueJobInput } from "../queue/job-producer.js";
import { examParticipantRepositoryToken, examRepositoryToken, type ExamParticipantRepository, type ExamRepository } from "../exam/exam.service.js";
import { type TeacherAssignmentStore, teacherAssignmentStoreToken } from "../school/teacher-assignment-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import type { StudentRecord } from "../student/student.service.js";
import { assertTenantResourceAccess, filterTenantResources, isTeacherSubjectContext } from "../tenant/tenant-access.js";
import { tenantStoreToken, type TenantStore } from "../tenant/tenant-store.js";
import { reportSnapshotStoreToken, type ReportSnapshotStore } from "./report-snapshot-store.js";

export const reportGenerationQueueProducerToken = Symbol("reportGenerationQueueProducer");
export const reportPdfRendererToken = Symbol("reportPdfRenderer");
export const examResultSummaryReportType = "EXAM_RESULT_SUMMARY";

export interface ReportGenerationQueueProducer {
  enqueue(input: TenantQueueJobInput): Promise<ProducedJob>;
}

export interface EnqueueReportGenerationInput {
  examId?: string;
  reportType?: string;
  contentHash?: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
}

export interface ReportGenerationQueueResult {
  tenantId: string;
  examId: string;
  reportType: typeof examResultSummaryReportType;
  queueName: "report-generation";
  jobId: string;
  status: "queued";
}

export interface ReportSnapshotRecord {
  id: string;
  tenantId: string;
  examId: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  reportType: string;
  status: string;
  inputRefs: Record<string, unknown>;
  snapshotData?: Record<string, unknown>;
  generatedAt?: string;
  staleAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportSnapshotListFilters {
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
}

export interface ReportStudentProgressOptions {
  scope?: "all" | "exam";
}

export interface ReportSnapshotExportResult {
  fileName: string;
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  fileBase64: string;
  rowCount: number;
}

export type ReportSnapshotPdfResult = ReportPdfRenderJobResult;

export type ReportPdfRenderInput = ReportPdfRenderJobPayload;

export interface ReportPdfRenderer {
  render(input: ReportPdfRenderInput): Promise<ReportSnapshotPdfResult>;
  close?(): Promise<void>;
}

@Injectable()
export class ReportGenerationService implements OnModuleDestroy {
  constructor(
    @Inject(reportGenerationQueueProducerToken)
    private readonly producer: ReportGenerationQueueProducer,
    @Inject(reportSnapshotStoreToken)
    private readonly snapshots: ReportSnapshotStore,
    @Optional()
    @Inject(reportPdfRendererToken)
    private readonly pdfRenderer: ReportPdfRenderer = createReportPdfRenderer(),
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional()
    @Inject(studentStoreToken)
    private readonly studentStore?: StudentStore,
    @Optional()
    @Inject(teacherAssignmentStoreToken)
    private readonly teacherAssignmentStore?: TeacherAssignmentStore,
    @Optional()
    @Inject(examRepositoryToken)
    private readonly examRepository?: ExamRepository,
    @Optional()
    @Inject(examParticipantRepositoryToken)
    private readonly examParticipants?: ExamParticipantRepository,
    @Optional()
    @Inject(tenantStoreToken)
    private readonly tenantStore?: TenantStore,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.pdfRenderer.close?.();
  }

  async enqueueGeneration(
    context: RequestContext,
    input: EnqueueReportGenerationInput,
    idempotencyKey?: string,
  ): Promise<ReportGenerationQueueResult> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "report.generation.enqueue", request: input },
        () => this.enqueueGenerationJob(context, input),
      );
    }

    return this.enqueueGenerationJob(context, input);
  }

  private async enqueueGenerationJob(
    context: RequestContext,
    input: EnqueueReportGenerationInput,
  ): Promise<ReportGenerationQueueResult> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const examId = required(input.examId, "REPORT_EXAM_REQUIRED");
    const reportType = parseReportType(input.reportType);
    const contentHash = required(input.contentHash, "REPORT_CONTENT_HASH_REQUIRED");
    const reportContext = resolveReportContext(input);

    const job = await this.producer.enqueue({
      queueName: "report-generation",
      tenantId: context.tenantId,
      userId: context.userId,
      entityId: examId,
      contentHash,
      reportType,
      ...reportContext,
    });
    await this.auditLogs?.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      entityType: "ReportGeneration",
      entityId: examId,
      action: "report_generation.queued",
      diff: { reportType, contentHash, jobId: job.options.jobId, ...reportContext },
    });

    return {
      tenantId: context.tenantId,
      examId,
      reportType,
      queueName: "report-generation",
      jobId: job.options.jobId,
      status: "queued",
    };
  }

  async listSnapshots(
    context: RequestContext,
    examId: string | undefined,
    filters: ReportSnapshotListFilters = {},
  ): Promise<ReportSnapshotRecord[]> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const snapshots = await this.snapshots.listByExam(context.tenantId, required(examId, "REPORT_EXAM_REQUIRED"));
    const scopedSnapshots = await Promise.all(filterReportSnapshots(snapshots, filters).map((snapshot) => this.scopeSnapshotForTeacher(context, snapshot)));
    return scopedSnapshots.map(createSnapshotListSummary);
  }

  async listStudentSnapshots(
    context: RequestContext,
    examId: string | undefined,
    studentId: string | undefined,
  ): Promise<ReportSnapshotRecord[]> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    await this.assertTeacherStudentReportScope(context, resolvedStudentId);
    const snapshots = await this.snapshots.listByExam(context.tenantId, resolvedExamId);
    const summaries: ReportSnapshotRecord[] = [];

    for (const snapshot of snapshots) {
      if (snapshot.status !== "READY" || !snapshot.snapshotData) continue;
      if (isTeacherSubjectContext(context) && !(await this.canTeacherAccessStudentReport(context, resolvedStudentId, snapshot))) {
        continue;
      }
      const student = readRecords(snapshot.snapshotData.students)
        .find((candidate) => readText(candidate.studentId) === resolvedStudentId);
      if (!student) continue;
      summaries.push(createStudentScopedSnapshotSummary(snapshot, student));
    }

    return summaries.sort((left, right) => toTime(right.generatedAt ?? right.createdAt) - toTime(left.generatedAt ?? left.createdAt));
  }

  async exportSnapshotExcel(
    context: RequestContext,
    examId: string | undefined,
    snapshotId: string | undefined,
  ): Promise<ReportSnapshotExportResult> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedSnapshotId = required(snapshotId, "REPORT_SNAPSHOT_REQUIRED");
    const snapshot = await this.snapshots.findById(context.tenantId, resolvedExamId, resolvedSnapshotId);
    if (!snapshot) {
      throw new NotFoundException("REPORT_SNAPSHOT_NOT_FOUND");
    }
    if (snapshot.status !== "READY" || !snapshot.snapshotData) {
      throw new BadRequestException("REPORT_SNAPSHOT_NOT_READY");
    }

    return createSnapshotWorkbook(await this.scopeSnapshotForTeacher(context, snapshot));
  }

  async exportSnapshotPdf(
    context: RequestContext,
    examId: string | undefined,
    snapshotId: string | undefined,
  ): Promise<ReportSnapshotPdfResult> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedSnapshotId = required(snapshotId, "REPORT_SNAPSHOT_REQUIRED");
    const snapshot = await this.snapshots.findById(context.tenantId, resolvedExamId, resolvedSnapshotId);
    if (!snapshot) {
      throw new NotFoundException("REPORT_SNAPSHOT_NOT_FOUND");
    }
    if (snapshot.status !== "READY" || !snapshot.snapshotData) {
      throw new BadRequestException("REPORT_SNAPSHOT_NOT_READY");
    }

    return createSnapshotPdf(
      await this.scopeSnapshotForTeacher(context, snapshot),
      this.pdfRenderer,
      await this.findInstitutionProfile(context),
    );
  }

  async getStudentReport(
    context: RequestContext,
    examId: string | undefined,
    snapshotId: string | undefined,
    studentId: string | undefined,
  ): Promise<ReportStudentSnapshot> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedSnapshotId = required(snapshotId, "REPORT_SNAPSHOT_REQUIRED");
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    await this.assertTeacherStudentReportScope(context, resolvedStudentId);
    const snapshot = await this.snapshots.findById(context.tenantId, resolvedExamId, resolvedSnapshotId);
    if (!snapshot) {
      throw new NotFoundException("REPORT_SNAPSHOT_NOT_FOUND");
    }
    if (snapshot.status !== "READY" || !snapshot.snapshotData) {
      throw new BadRequestException("REPORT_SNAPSHOT_NOT_READY");
    }
    await this.assertTeacherStudentReportScope(context, resolvedStudentId, snapshot);

    const student = readRecords(snapshot.snapshotData.students)
      .find((candidate) => readText(candidate.studentId) === resolvedStudentId);
    if (!student) {
      throw new NotFoundException("REPORT_STUDENT_NOT_FOUND");
    }

    const classId = readText(student.classId);
    const className = readText(student.className);
    const outcomes = readRecords(student.outcomes).map(readOutcomeSummary);
    const questions = readRecords(student.questions).map(readQuestionSummary);
    const statistics = readStudentStatistics(student.statistics);
    const commentary = readStudentCommentary(student.commentary);
    const branchAverages = createStudentBranchAverageLookup(snapshot.snapshotData, classId);
    const institution = await this.findInstitutionProfile(context);
    const examMeta = await this.findExamMeta(context, resolvedExamId);
    const participantMeta = await this.findParticipantMeta(context, resolvedExamId, resolvedStudentId);
    const studentName = await this.findStudentDisplayName(context, resolvedStudentId);
    return {
      tenantId: context.tenantId,
      ...institution,
      examId: resolvedExamId,
      ...examMeta,
      snapshotId: resolvedSnapshotId,
      studentId: resolvedStudentId,
      ...(studentName ? { studentName } : {}),
      ...participantMeta,
      ...(classId ? { classId } : {}),
      ...(className ? { className } : {}),
      ...(snapshot.courseId ? { courseId: snapshot.courseId } : {}),
      resultKey: readText(student.resultKey),
      ...(snapshot.termId ? { termId: snapshot.termId } : {}),
      total: readScoreSummary(student.total),
      branches: readRecords(student.branches).map((branch) => readBranchSummary(branch, branchAverages)),
      ...(outcomes.length > 0 ? { outcomes } : {}),
      ...(questions.length > 0 ? { questions } : {}),
      ...(statistics ? { statistics } : {}),
      ...(commentary ? { commentary } : {}),
      generatedAt: snapshot.generatedAt,
    };
  }

  async getLatestStudentReport(
    context: RequestContext,
    examId: string | undefined,
    studentId: string | undefined,
  ): Promise<ReportStudentSnapshot> {
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    const snapshotId = await this.findLatestReadyStudentSnapshotId(context, examId, resolvedStudentId);
    return this.getStudentReport(context, examId, snapshotId, resolvedStudentId);
  }

  async getStudentErrorBooklet(
    context: RequestContext,
    examId: string | undefined,
    snapshotId: string | undefined,
    studentId: string | undefined,
  ): Promise<ReportErrorBooklet> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedSnapshotId = required(snapshotId, "REPORT_SNAPSHOT_REQUIRED");
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    await this.assertTeacherStudentReportScope(context, resolvedStudentId);
    const snapshot = await this.snapshots.findById(context.tenantId, resolvedExamId, resolvedSnapshotId);
    if (!snapshot) {
      throw new NotFoundException("REPORT_SNAPSHOT_NOT_FOUND");
    }
    if (snapshot.status !== "READY" || !snapshot.snapshotData) {
      throw new BadRequestException("REPORT_SNAPSHOT_NOT_READY");
    }
    await this.assertTeacherStudentReportScope(context, resolvedStudentId, snapshot);

    const student = readRecords(snapshot.snapshotData.students)
      .find((candidate) => readText(candidate.studentId) === resolvedStudentId);
    if (!student) {
      throw new NotFoundException("REPORT_STUDENT_NOT_FOUND");
    }

    const items = readRecords(student.questions)
      .map(readQuestionSummary)
      .filter((question) => question.status === "WRONG" || question.status === "BLANK");

    return {
      tenantId: context.tenantId,
      examId: resolvedExamId,
      snapshotId: resolvedSnapshotId,
      studentId: resolvedStudentId,
      items,
      generatedAt: snapshot.generatedAt,
    };
  }

  async getLatestStudentErrorBooklet(
    context: RequestContext,
    examId: string | undefined,
    studentId: string | undefined,
  ): Promise<ReportErrorBooklet> {
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    const snapshotId = await this.findLatestReadyStudentSnapshotId(context, examId, resolvedStudentId);
    return this.getStudentErrorBooklet(context, examId, snapshotId, resolvedStudentId);
  }

  async getStudentProgress(
    context: RequestContext,
    examId: string | undefined,
    studentId: string | undefined,
    options: ReportStudentProgressOptions = {},
  ): Promise<ReportStudentProgress> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    await this.assertTeacherStudentReportScope(context, resolvedStudentId);
    const snapshots = options.scope === "all"
      ? await this.snapshots.listByTenant(context.tenantId)
      : await this.snapshots.listByExam(context.tenantId, resolvedExamId);
    const points: ReportStudentProgressPoint[] = [];

    for (const snapshot of snapshots) {
      if (snapshot.status !== "READY" || !snapshot.snapshotData) continue;

      const student = readRecords(snapshot.snapshotData.students)
        .find((candidate) => readText(candidate.studentId) === resolvedStudentId);
      if (student) {
        if (isTeacherSubjectContext(context) && !(await this.canTeacherAccessStudentReport(context, resolvedStudentId, snapshot))) {
          continue;
        }
        points.push({
          snapshotId: snapshot.id,
          ...(snapshot.courseId ? { courseId: snapshot.courseId } : {}),
          ...(snapshot.generatedAt ? { generatedAt: snapshot.generatedAt } : {}),
          ...(snapshot.termId ? { termId: snapshot.termId } : {}),
          total: readScoreSummary(student.total),
          branches: readRecords(student.branches).map((branch) => readBranchSummary(branch)),
        });
      }
    }

    points.sort((a, b) => toTime(a.generatedAt) - toTime(b.generatedAt));

    const netDelta = delta(points, (point) => point.total.net);
    const standardScoreDelta = delta(points, (point) => point.total.standardScore);

    return {
      tenantId: context.tenantId,
      examId: resolvedExamId,
      studentId: resolvedStudentId,
      points,
      ...(netDelta !== undefined ? { netDelta } : {}),
      ...(standardScoreDelta !== undefined ? { standardScoreDelta } : {}),
    };
  }

  private async findLatestReadyStudentSnapshotId(
    context: RequestContext,
    examId: string | undefined,
    studentId: string,
  ): Promise<string> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const snapshots = await this.snapshots.listByExam(context.tenantId, resolvedExamId);
    const snapshot = snapshots
      .filter((candidate) => candidate.status === "READY" && candidate.snapshotData)
      .sort((a, b) => toTime(b.generatedAt ?? b.createdAt) - toTime(a.generatedAt ?? a.createdAt))
      .find((candidate) =>
        readRecords(candidate.snapshotData?.students).some((student) => readText(student.studentId) === studentId),
      );

    if (!snapshot) {
      throw new NotFoundException("REPORT_STUDENT_NOT_FOUND");
    }

    return snapshot.id;
  }

  private async assertTeacherStudentReportScope(
    context: RequestContext,
    studentId: string,
    reportContext?: Pick<ReportSnapshotRecord, "courseId" | "termId">,
  ): Promise<void> {
    if (!isTeacherSubjectContext(context)) {
      return;
    }
    if (!(await this.canTeacherAccessStudentReport(context, studentId, reportContext))) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }
  }

  private async findStudentDisplayName(context: RequestContext, studentId: string): Promise<string | undefined> {
    if (!this.studentStore) return undefined;

    const student = await this.studentStore.findById(studentId);
    if (!student || student.tenantId !== context.tenantId) return undefined;

    return `${student.firstName} ${student.lastName}`.trim() || undefined;
  }

  private async findInstitutionProfile(
    context: RequestContext,
  ): Promise<Pick<ReportStudentSnapshot, "institutionLogoUrl" | "institutionName">> {
    if (!this.tenantStore || !context.tenantId) return {};

    try {
      const tenant = await this.tenantStore.findById(context.tenantId);
      return {
        ...(tenant?.name.trim() ? { institutionName: tenant.name.trim() } : {}),
        ...(tenant?.logoUrl?.trim() ? { institutionLogoUrl: tenant.logoUrl.trim() } : {}),
      };
    } catch {
      return {};
    }
  }

  private async findExamMeta(context: RequestContext, examId: string): Promise<Pick<ReportStudentSnapshot, "examStartsAt" | "examTitle">> {
    if (!this.examRepository || !context.tenantId) return {};

    let exam;
    try {
      exam = await this.examRepository.findById(context.tenantId, examId);
    } catch {
      return {};
    }
    if (!exam) return {};

    return {
      ...(exam.title ? { examTitle: exam.title } : {}),
      ...(exam.startsAt ? { examStartsAt: exam.startsAt } : {}),
    };
  }

  private async findParticipantMeta(
    context: RequestContext,
    examId: string,
    studentId: string,
  ): Promise<Pick<ReportStudentSnapshot, "bookletType" | "participantNo">> {
    if (!this.examParticipants || !context.tenantId) return {};

    let participant;
    try {
      participant = (await this.examParticipants.list(context.tenantId, examId))
        .find((candidate) => candidate.studentId === studentId);
    } catch {
      return {};
    }
    if (!participant) return {};

    return {
      ...(participant.participantNo ? { participantNo: participant.participantNo } : {}),
      ...(participant.bookletType ? { bookletType: participant.bookletType } : {}),
    };
  }

  private async canTeacherAccessStudentReport(
    context: RequestContext & { subjectType: "TEACHER"; subjectId: string },
    studentId: string,
    reportContext?: Pick<ReportSnapshotRecord, "courseId" | "termId">,
  ): Promise<boolean> {
    if (!this.studentStore || !this.teacherAssignmentStore) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const student = await this.studentStore.findById(studentId);
    if (!student) {
      return false;
    }

    try {
      assertTenantResourceAccess(context, student);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }

    const assignments = filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(context.subjectId));
    return isTeacherScopedStudent(context.subjectId, student, assignments, reportContext);
  }

  private async scopeSnapshotForTeacher(
    context: RequestContext,
    snapshot: ReportSnapshotRecord,
  ): Promise<ReportSnapshotRecord> {
    if (!isTeacherSubjectContext(context)) {
      return snapshot;
    }

    const scope = await this.resolveTeacherReportScope(context, snapshot);
    const snapshotData = snapshot.snapshotData ?? {};
    const scopedStudents = readRecords(snapshotData.students)
      .filter((student) => scope.studentIds.has(readText(student.studentId)));
    const scopedClasses = readRecords(snapshotData.classes)
      .filter((classSummary) => scope.classIds.has(readText(classSummary.classId)));

    return {
      ...snapshot,
      snapshotData: {
        reportType: readText(snapshotData.reportType) || snapshot.reportType,
        ...(readText(snapshotData.generatedAt) || snapshot.generatedAt
          ? { generatedAt: readText(snapshotData.generatedAt) || snapshot.generatedAt }
          : {}),
        resultCount: scopedStudents.length,
        classes: scopedClasses,
        students: scopedStudents,
      },
    };
  }

  private async resolveTeacherReportScope(
    context: RequestContext & { subjectType: "TEACHER"; subjectId: string },
    reportContext: Pick<ReportSnapshotRecord, "courseId" | "termId">,
  ): Promise<{ studentIds: Set<string>; classIds: Set<string> }> {
    if (!this.studentStore || !this.teacherAssignmentStore) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const assignments = filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(context.subjectId));
    const scopedStudents = filterTenantResources(context, await this.studentStore.list())
      .filter((student) => !student.deletedAt && isTeacherScopedStudent(context.subjectId, student, assignments, reportContext));

    return {
      studentIds: new Set(scopedStudents.map((student) => student.id)),
      classIds: new Set(scopedStudents.map((student) => student.classId).filter((classId): classId is string => Boolean(classId))),
    };
  }
}

function isTeacherScopedStudent(
  teacherId: string,
  student: StudentRecord,
  assignments: Array<{ teacherId: string; studentId?: string; classId?: string; courseId?: string; termId?: string; startsAt?: string; endsAt?: string }>,
  reportContext?: Pick<ReportSnapshotRecord, "courseId" | "termId">,
): boolean {
  return student.responsibleTeacherId === teacherId ||
    assignments.some((assignment) =>
      assignment.teacherId === teacherId &&
      isAssignmentActive(assignment) &&
      matchesReportContext(assignment, reportContext) &&
      (assignment.studentId === student.id || Boolean(student.classId && assignment.classId === student.classId)),
    );
}

function matchesReportContext(
  assignment: { courseId?: string; termId?: string },
  reportContext: Pick<ReportSnapshotRecord, "courseId" | "termId"> | undefined,
): boolean {
  if (!reportContext) return true;
  if (assignment.courseId && assignment.courseId !== reportContext.courseId) return false;
  if (assignment.termId && assignment.termId !== reportContext.termId) return false;
  return true;
}

function isAssignmentActive(assignment: { startsAt?: string; endsAt?: string }): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return (!assignment.startsAt || assignment.startsAt <= today) && (!assignment.endsAt || assignment.endsAt >= today);
}

function parseReportType(value: string | undefined): typeof examResultSummaryReportType {
  const reportType = required(value, "REPORT_TYPE_REQUIRED");
  if (reportType !== examResultSummaryReportType) {
    throw new BadRequestException("REPORT_TYPE_UNSUPPORTED");
  }
  return reportType;
}

function required(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolveReportContext(input: ReportSnapshotListFilters): ReportSnapshotListFilters {
  return {
    campusId: optionalText(input.campusId),
    gradeLevelId: optionalText(input.gradeLevelId),
    classId: optionalText(input.classId),
    courseId: optionalText(input.courseId),
    termId: optionalText(input.termId),
  };
}

function filterReportSnapshots(records: ReportSnapshotRecord[], filters: ReportSnapshotListFilters): ReportSnapshotRecord[] {
  return records
    .filter((snapshot) => !filters.campusId || snapshot.campusId === filters.campusId)
    .filter((snapshot) => !filters.gradeLevelId || snapshot.gradeLevelId === filters.gradeLevelId)
    .filter((snapshot) => !filters.classId || snapshot.classId === filters.classId)
    .filter((snapshot) => !filters.courseId || snapshot.courseId === filters.courseId)
    .filter((snapshot) => !filters.termId || snapshot.termId === filters.termId);
}

function createStudentScopedSnapshotSummary(
  snapshot: ReportSnapshotRecord,
  student: Record<string, unknown>,
): ReportSnapshotRecord {
  const snapshotData = snapshot.snapshotData ?? {};
  const generatedAt = readText(snapshotData.generatedAt) || snapshot.generatedAt;
  const studentId = readText(student.studentId);
  return {
    ...snapshot,
    snapshotData: {
      reportType: readText(snapshotData.reportType) || snapshot.reportType,
      ...(generatedAt ? { generatedAt } : {}),
      resultCount: 1,
      students: [
        {
          studentId,
          ...(readText(student.classId) ? { classId: readText(student.classId) } : {}),
          ...(readText(student.className) ? { className: readText(student.className) } : {}),
          resultKey: readText(student.resultKey) || `${snapshot.id}:${studentId}`,
          total: readScoreSummary(student.total),
        },
      ],
    },
  };
}

function createSnapshotListSummary(snapshot: ReportSnapshotRecord): ReportSnapshotRecord {
  const snapshotData = snapshot.snapshotData ?? {};
  const generatedAt = readText(snapshotData.generatedAt) || snapshot.generatedAt;
  const averages = readRecord(snapshotData.averages);
  const branches = readRecords(snapshotData.branches);
  const classes = readRecords(snapshotData.classes);
  const students = readRecords(snapshotData.students);
  const resultCount = readOptionalNumber(snapshotData.resultCount) ?? students.length;

  return {
    ...snapshot,
    snapshotData: {
      reportType: readText(snapshotData.reportType) || snapshot.reportType,
      ...(generatedAt ? { generatedAt } : {}),
      resultCount,
      ...(Object.keys(averages).length > 0 ? { averages: readScoreSummary(averages) } : {}),
      ...(branches.length > 0 ? { branches: branches.map((branch) => readBranchSummary(branch)) } : {}),
      ...(classes.length > 0 ? { classes: classes.map(createSnapshotClassListSummary) } : {}),
      ...(students.length > 0 ? { students: students.map(createSnapshotStudentListSummary) } : {}),
    },
  };
}

function createSnapshotClassListSummary(classSummary: Record<string, unknown>): Record<string, unknown> {
  const averages = readRecord(classSummary.averages);
  const branches = readRecords(classSummary.branches);
  return {
    classId: readText(classSummary.classId),
    ...(readText(classSummary.className) ? { className: readText(classSummary.className) } : {}),
    resultCount: readOptionalNumber(classSummary.resultCount) ?? 0,
    ...(Object.keys(averages).length > 0 ? { averages: readScoreSummary(averages) } : {}),
    ...(branches.length > 0 ? { branches: branches.map((branch) => readBranchSummary(branch)) } : {}),
  };
}

function createSnapshotStudentListSummary(student: Record<string, unknown>): Record<string, unknown> {
  const studentId = readText(student.studentId);
  return {
    studentId,
    ...(readText(student.classId) ? { classId: readText(student.classId) } : {}),
    ...(readText(student.className) ? { className: readText(student.className) } : {}),
    resultKey: readText(student.resultKey) || studentId,
    total: readScoreSummary(student.total),
  };
}

async function createSnapshotWorkbook(snapshot: ReportSnapshotRecord): Promise<ReportSnapshotExportResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "o-okul";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Summary");
  const snapshotData = snapshot.snapshotData ?? {};
  const averages = readRecord(snapshotData.averages);

  summary.addRows([
    ["examId", snapshot.examId],
    ["snapshotId", snapshot.id],
    ["reportType", snapshot.reportType],
    ["status", snapshot.status],
    ["generatedAt", snapshot.generatedAt ?? ""],
    ["resultCount", readNumber(snapshotData.resultCount)],
    ["averageNet", readNumber(averages.net)],
    ["averageRawScore", readNumber(averages.rawScore)],
    ["averageStandardScore", readNumber(averages.standardScore)],
    ["averageEstimatedRawScore", readNumber(averages.estimatedRawScore)],
    ["averageQuestionCount", readNumberOrFallback(averages.questionCount, scoreQuestionCount(averages))],
    ["averageSuccessRate", readNumberOrFallback(averages.successRate, scoreSuccessRate(averages))],
  ]);

  const branches = workbook.addWorksheet("Branches");
  branches.addRow(["branch", "resultCount", "correct", "wrong", "blank", "net", "questionCount", "successRate"]);
  for (const branch of readRecords(snapshotData.branches)) {
    branches.addRow([
      readText(branch.branch),
      readNumber(branch.resultCount),
      readNumber(branch.correct),
      readNumber(branch.wrong),
      readNumber(branch.blank),
      readNumber(branch.net),
      readNumberOrFallback(branch.questionCount, scoreQuestionCount(branch)),
      readNumberOrFallback(branch.successRate, scoreSuccessRate(branch)),
    ]);
  }

  const classes = workbook.addWorksheet("Classes");
  classes.addRow([
    "classId",
    "className",
    "resultCount",
    "correct",
    "wrong",
    "blank",
    "net",
    "rawScore",
    "standardScore",
    "estimatedRawScore",
    "questionCount",
    "successRate",
  ]);
  for (const classSummary of readRecords(snapshotData.classes)) {
    const averages = readRecord(classSummary.averages);
    classes.addRow([
      readText(classSummary.classId),
      readText(classSummary.className),
      readNumber(classSummary.resultCount),
      readNumber(averages.correct),
      readNumber(averages.wrong),
      readNumber(averages.blank),
      readNumber(averages.net),
      readNumber(averages.rawScore),
      readNumber(averages.standardScore),
      readNumber(averages.estimatedRawScore),
      readNumberOrFallback(averages.questionCount, scoreQuestionCount(averages)),
      readNumberOrFallback(averages.successRate, scoreSuccessRate(averages)),
    ]);
  }

  const students = workbook.addWorksheet("Students");
  students.addRow([
    "studentId",
    "classId",
    "className",
    "resultKey",
    "correct",
    "wrong",
    "blank",
    "net",
    "rawScore",
    "standardScore",
    "generalRank",
    "generalOutOf",
    "generalPercentile",
    "classRank",
    "classOutOf",
    "classPercentile",
    "estimatedRawScore",
    "questionCount",
    "successRate",
  ]);
  for (const student of readRecords(snapshotData.students)) {
    const total = readRecord(student.total);
    const statistics = readStudentStatistics(student.statistics);
    students.addRow([
      readText(student.studentId),
      readText(student.classId),
      readText(student.className),
      readText(student.resultKey),
      readNumber(total.correct),
      readNumber(total.wrong),
      readNumber(total.blank),
      readNumber(total.net),
      readNumber(total.rawScore),
      readNumber(total.standardScore),
      statistics?.general.rank ?? "",
      statistics?.general.outOf ?? "",
      statistics?.general.percentile ?? "",
      statistics?.class?.rank ?? "",
      statistics?.class?.outOf ?? "",
      statistics?.class?.percentile ?? "",
      readNumber(total.estimatedRawScore),
      readNumberOrFallback(total.questionCount, scoreQuestionCount(total)),
      readNumberOrFallback(total.successRate, scoreSuccessRate(total)),
    ]);
  }

  const branchStatistics = workbook.addWorksheet("BranchStatistics");
  branchStatistics.addRow([
    "studentId",
    "branch",
    "standardScore",
    "generalRank",
    "generalOutOf",
    "generalPercentile",
    "classRank",
    "classOutOf",
    "classPercentile",
  ]);
  for (const student of readRecords(snapshotData.students)) {
    const studentId = readText(student.studentId);
    const statistics = readStudentStatistics(student.statistics);
    for (const branch of statistics?.branches ?? []) {
      branchStatistics.addRow([
        studentId,
        branch.branch,
        branch.standardScore,
        branch.general.rank,
        branch.general.outOf,
        branch.general.percentile,
        branch.class?.rank ?? "",
        branch.class?.outOf ?? "",
        branch.class?.percentile ?? "",
      ]);
    }
  }

  for (const worksheet of workbook.worksheets) {
    worksheet.columns.forEach((column) => {
      column.width = 18;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    fileName: `${snapshot.examId}-${snapshot.id}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileBase64: Buffer.from(buffer).toString("base64"),
    rowCount: readRecords(snapshotData.students).length,
  };
}

export function createReportPdfRenderer(): ReportPdfRenderer {
  const mode = process.env.REPORT_PDF_RENDERER ?? (resolvePersistenceDriver() === "postgres" ? "worker" : "memory");
  if (process.env.NODE_ENV === "production" && mode !== "worker") {
    throw new Error('REPORT_PDF_RENDERER must be "worker" in production.');
  }
  if (mode === "worker") {
    return new BullReportPdfRenderer();
  }
  if (mode === "memory") {
    return new SimpleReportPdfRenderer();
  }
  throw new Error("REPORT_PDF_RENDERER_INVALID");
}

class BullReportPdfRenderer implements ReportPdfRenderer {
  private readonly queue = new Queue<ReportPdfRenderInput, ReportSnapshotPdfResult>("report-pdf-render", {
    connection: parseRedisUrl(),
    prefix: process.env.QUEUE_PREFIX,
  });
  private readonly queueEvents = new QueueEvents("report-pdf-render", {
    connection: parseRedisUrl(),
    prefix: process.env.QUEUE_PREFIX,
  });
  private readonly timeoutMs = Number(process.env.REPORT_PDF_RENDER_TIMEOUT_MS ?? 30_000);

  async render(input: ReportPdfRenderInput): Promise<ReportSnapshotPdfResult> {
    await this.queueEvents.waitUntilReady();
    const job = await this.queue.add("report-pdf-render", input, {
      attempts: 1,
      jobId: `report-pdf-${randomUUID()}`,
      removeOnComplete: true,
      removeOnFail: false,
    });
    return job.waitUntilFinished(this.queueEvents, this.timeoutMs);
  }

  async close(): Promise<void> {
    await Promise.all([this.queue.close(), this.queueEvents.close()]);
  }
}

class SimpleReportPdfRenderer implements ReportPdfRenderer {
  async render(input: ReportPdfRenderInput): Promise<ReportSnapshotPdfResult> {
    const pdf = buildSimplePdf(createSnapshotPdfLines(input.snapshot, input.institution));
    return {
      fileName: `${input.snapshot.examId}-${input.snapshot.id}.pdf`,
      contentType: "application/pdf",
      fileBase64: pdf.toString("base64"),
      pageCount: 1,
    };
  }
}

async function createSnapshotPdf(
  snapshot: ReportSnapshotRecord,
  renderer: ReportPdfRenderer,
  institution: ReportPdfInstitution = {},
): Promise<ReportSnapshotPdfResult> {
  return renderer.render({
    institution,
    snapshot,
  });
}

function createSnapshotPdfLines(
  snapshot: ReportPdfSnapshotRecord,
  institution: ReportPdfInstitution = {},
): string[] {
  const snapshotData = snapshot.snapshotData ?? {};
  const averages = readRecord(snapshotData.averages);
  return [
    `${institution.institutionName ?? "o-okul"} - Sinav Raporu`,
    `Sinav: ${snapshot.examId}`,
    `Snapshot: ${snapshot.id}`,
    `Durum: ${snapshot.status}`,
    `Uretim: ${snapshot.generatedAt ?? "-"}`,
    "",
    "Genel Ozet",
    `Sonuc sayisi: ${readNumber(snapshotData.resultCount) || "-"}`,
    `Ortalama net: ${readNumber(averages.net) || "-"}`,
    `Ortalama basari: ${formatPdfPercent(readNumberOrFallback(averages.successRate, scoreSuccessRate(averages)))}`,
    `Ortalama LGS puani: ${readLgsScore(averages) || "-"}`,
    `Standart puan: ${readNumber(averages.standardScore) || "-"}`,
    "",
    "Branslar",
    ...readRecords(snapshotData.branches).slice(0, 8).map((branch) =>
      `${readText(branch.branch) || "-"}: ${readNumber(branch.resultCount) || "-"} sonuc, ${readNumber(branch.net) || "-"} net, ${formatPdfPercent(readNumberOrFallback(branch.successRate, scoreSuccessRate(branch)))}`
    ),
    "",
    "Siniflar",
    ...readRecords(snapshotData.classes).slice(0, 8).map((classSummary) => {
      const classAverages = readRecord(classSummary.averages);
      return `${readText(classSummary.className) || "Sinifsiz"}: ${readNumber(classSummary.resultCount) || "-"} sonuc, ${readNumber(classAverages.net) || "-"} net, ${formatPdfPercent(readNumberOrFallback(classAverages.successRate, scoreSuccessRate(classAverages)))}`;
    }),
    "",
    "Ogrenciler",
    ...readRecords(snapshotData.students).slice(0, 12).map((student) => {
      const total = readRecord(student.total);
      const statistics = readStudentStatistics(student.statistics);
      return `${readText(student.studentId) || "-"} ${readText(student.className) || ""}: ${readNumber(total.net) || "-"} net, ${formatPdfPercent(readNumberOrFallback(total.successRate, scoreSuccessRate(total)))}, ${readLgsScore(total) || "-"} LGS puani, genel ${formatPdfRank(statistics?.general)}, sinif ${formatPdfRank(statistics?.class)}`;
    }),
    "",
    "Ogrenci Karnesi",
    "Bolum Analizi",
    "Puan - Sira Analizi",
    "Bolum Basari Yuzdeleri",
    "Son Sinav Netleri",
  ];
}

function formatPdfRank(rank: ReportScopeRank | undefined): string {
  if (!rank) return "-";
  return `${rank.rank}/${rank.outOf} (%${rank.percentile})`;
}

function formatPdfPercent(value: number | ""): string {
  return value === "" ? "-" : `%${value}`;
}

function buildSimplePdf(lines: string[]): Buffer {
  const textStream = [
    "BT",
    "/F1 18 Tf",
    "50 790 Td",
    `(${escapePdfText(lines[0] ?? "")}) Tj`,
    "/F1 11 Tf",
    ...lines.slice(1).map((line) => `0 -18 Td (${escapePdfText(line)}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(textStream, "utf8")} >>\nstream\n${textStream}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "utf8");
}

function escapePdfText(value: string): string {
  return normalizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function normalizePdfText(value: string): string {
  return value
    .replace(/[Çç]/g, "c")
    .replace(/[Ğğ]/g, "g")
    .replace(/[İIı]/g, "i")
    .replace(/[Öö]/g, "o")
    .replace(/[Şş]/g, "s")
    .replace(/[Üü]/g, "u")
    .replace(/[^\x20-\x7E]/g, "?");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(readRecord) : [];
}

function readNumber(value: unknown): number | "" {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

function readNumberOrFallback(value: unknown, fallback: number | undefined): number | "" {
  const direct = readNumber(value);
  return direct === "" ? fallback ?? "" : direct;
}

function readLgsScore(value: unknown): number | "" {
  const record = readRecord(value);
  const estimatedRawScore = readNumber(record.estimatedRawScore);
  return estimatedRawScore === "" ? readNumber(record.standardScore) : estimatedRawScore;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readScoreSummary(value: unknown): ReportStudentScoreSummary {
  const record = readRecord(value);
  const questionCount = readOptionalNumber(record.questionCount) ?? scoreQuestionCount(record);
  const successRate = readOptionalNumber(record.successRate) ?? scoreSuccessRate(record);
  const summary: ReportStudentScoreSummary = {
    correct: readOptionalNumber(record.correct),
    wrong: readOptionalNumber(record.wrong),
    blank: readOptionalNumber(record.blank),
    net: readOptionalNumber(record.net),
    ...(questionCount !== undefined ? { questionCount } : {}),
    rawScore: readOptionalNumber(record.rawScore),
    standardScore: readOptionalNumber(record.standardScore),
    ...(successRate !== undefined ? { successRate } : {}),
  };
  const estimatedRawScore = readOptionalNumber(record.estimatedRawScore);
  if (estimatedRawScore !== undefined) {
    summary.estimatedRawScore = estimatedRawScore;
  }
  return summary;
}

function readBranchSummary(
  value: unknown,
  averages: Map<string, Pick<ReportStudentBranchSummary, "classNetAverage" | "generalNetAverage" | "schoolNetAverage">> = new Map(),
): ReportStudentBranchSummary {
  const record = readRecord(value);
  const branch = readText(record.branch);
  const branchAverages = averages.get(branch);
  const questionCount = readOptionalNumber(record.questionCount) ?? scoreQuestionCount(record);
  const successRate = readOptionalNumber(record.successRate) ?? scoreSuccessRate(record);
  return {
    branch,
    correct: readOptionalNumber(record.correct),
    wrong: readOptionalNumber(record.wrong),
    blank: readOptionalNumber(record.blank),
    net: readOptionalNumber(record.net),
    ...(questionCount !== undefined ? { questionCount } : {}),
    ...(successRate !== undefined ? { successRate } : {}),
    ...(branchAverages?.classNetAverage !== undefined ? { classNetAverage: branchAverages.classNetAverage } : {}),
    ...(branchAverages?.schoolNetAverage !== undefined ? { schoolNetAverage: branchAverages.schoolNetAverage } : {}),
    ...(branchAverages?.generalNetAverage !== undefined ? { generalNetAverage: branchAverages.generalNetAverage } : {}),
  };
}

function createStudentBranchAverageLookup(
  snapshotData: Record<string, unknown>,
  classId: string,
): Map<string, Pick<ReportStudentBranchSummary, "classNetAverage" | "generalNetAverage" | "schoolNetAverage">> {
  const averages = new Map<string, Pick<ReportStudentBranchSummary, "classNetAverage" | "generalNetAverage" | "schoolNetAverage">>();
  const schoolBranches = readRecords(snapshotData.branches);
  const classBranches = readRecords(readRecords(snapshotData.classes).find((klass) => readText(klass.classId) === classId)?.branches);
  const generalBranches = readRecords(readRecord(snapshotData.statistics).branches);
  for (const branch of schoolBranches) {
    const branchName = readText(branch.branch);
    if (!branchName) continue;
    const schoolNetAverage = readOptionalNumber(branch.net);
    averages.set(branchName, {
      ...(schoolNetAverage !== undefined ? { schoolNetAverage } : {}),
    });
  }
  for (const branch of classBranches) {
    const branchName = readText(branch.branch);
    if (!branchName) continue;
    const current = averages.get(branchName) ?? {};
    const classNetAverage = readOptionalNumber(branch.net);
    averages.set(branchName, {
      ...current,
      ...(classNetAverage !== undefined ? { classNetAverage } : {}),
    });
  }
  for (const branch of generalBranches) {
    const branchName = readText(branch.branch);
    if (!branchName) continue;
    const current = averages.get(branchName) ?? {};
    const generalNetAverage = readOptionalNumber(branch.meanNet);
    averages.set(branchName, {
      ...current,
      ...(generalNetAverage !== undefined ? { generalNetAverage } : {}),
    });
  }
  return averages;
}

function readStudentStatistics(value: unknown): ReportStudentStatistics | undefined {
  const record = readRecord(value);
  const general = readScopeRank(record.general);
  if (!general) {
    return undefined;
  }
  const klass = readScopeRank(record.class);
  return {
    standardScore: readOptionalNumber(record.standardScore) ?? 0,
    general,
    ...(klass ? { class: klass } : {}),
    branches: readRecords(record.branches)
      .map(readBranchStatistics)
      .filter((branch): branch is ReportStudentBranchStatistics => branch !== undefined),
  };
}

function readStudentCommentary(value: unknown): ReportStudentCommentary | undefined {
  const record = readRecord(value);
  if (record.provider !== "template" || record.reviewStatus !== "DRAFT") {
    return undefined;
  }
  const generatedAt = readText(record.generatedAt);
  const parentSummary = readText(record.parentSummary);
  const teacherActionDraft = readText(record.teacherActionDraft);
  const disclaimer = readText(record.disclaimer);
  if (!generatedAt || !parentSummary || !teacherActionDraft || !disclaimer) {
    return undefined;
  }
  return {
    provider: "template",
    generatedAt,
    parentSummary,
    teacherActionDraft,
    reviewStatus: "DRAFT",
    disclaimer,
  };
}

function readBranchStatistics(value: unknown): ReportStudentBranchStatistics | undefined {
  const record = readRecord(value);
  const branch = readText(record.branch);
  const general = readScopeRank(record.general);
  if (!branch || !general) {
    return undefined;
  }
  const klass = readScopeRank(record.class);
  return {
    branch,
    standardScore: readOptionalNumber(record.standardScore) ?? 0,
    general,
    ...(klass ? { class: klass } : {}),
  };
}

function readScopeRank(value: unknown): ReportScopeRank | undefined {
  const record = readRecord(value);
  const rank = readOptionalNumber(record.rank);
  const outOf = readOptionalNumber(record.outOf);
  const percentile = readOptionalNumber(record.percentile);
  if (rank === undefined || outOf === undefined || percentile === undefined) {
    return undefined;
  }
  return { rank, outOf, percentile };
}

function readOutcomeSummary(value: unknown): ReportStudentOutcomeSummary {
  const record = readRecord(value);
  const questionCount = readOptionalNumber(record.questionCount) ?? scoreQuestionCount(record);
  const successRate = readOptionalNumber(record.successRate) ?? scoreSuccessRate(record);
  return {
    outcomeCode: readText(record.outcomeCode),
    branch: readText(record.branch),
    correct: readOptionalNumber(record.correct),
    wrong: readOptionalNumber(record.wrong),
    blank: readOptionalNumber(record.blank),
    net: readOptionalNumber(record.net),
    ...(questionCount !== undefined ? { questionCount } : {}),
    ...(successRate !== undefined ? { successRate } : {}),
  };
}

function scoreQuestionCount(value: Record<string, unknown>): number | undefined {
  const correct = readOptionalNumber(value.correct);
  const wrong = readOptionalNumber(value.wrong);
  const blank = readOptionalNumber(value.blank);
  if (correct === undefined || wrong === undefined || blank === undefined) {
    return undefined;
  }
  return roundReportMetric(correct + wrong + blank);
}

function scoreSuccessRate(value: Record<string, unknown>): number | undefined {
  const net = readOptionalNumber(value.net);
  const questionCount = readOptionalNumber(value.questionCount) ?? scoreQuestionCount(value);
  if (net === undefined || questionCount === undefined || questionCount <= 0) {
    return undefined;
  }
  return roundReportMetric((net / questionCount) * 100);
}

function roundReportMetric(value: number): number {
  return Number(value.toFixed(4));
}

function readQuestionSummary(value: unknown): ReportStudentQuestionSummary {
  const record = readRecord(value);
  return {
    questionNo: readWholeNumber(record.questionNo),
    branch: readText(record.branch),
    ...(readText(record.outcomeCode) ? { outcomeCode: readText(record.outcomeCode) } : {}),
    answer: readText(record.answer),
    correctAnswer: readText(record.correctAnswer),
    status: readQuestionStatus(record.status),
  };
}

function readQuestionStatus(value: unknown): ReportStudentQuestionSummary["status"] {
  return value === "WRONG" || value === "BLANK" ? value : "CORRECT";
}

function readWholeNumber(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toTime(value: string | undefined): number {
  return value ? new Date(value).getTime() : 0;
}

function delta(
  points: ReportStudentProgressPoint[],
  select: (point: ReportStudentProgressPoint) => number | undefined,
): number | undefined {
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) return undefined;

  const first = select(firstPoint);
  const last = select(lastPoint);
  return first === undefined || last === undefined ? undefined : Number((last - first).toFixed(4));
}
