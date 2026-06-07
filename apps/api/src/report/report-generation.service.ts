import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  ReportErrorBooklet,
  ReportScopeRank,
  ReportStudentBranchStatistics,
  ReportStudentBranchSummary,
  ReportStudentOutcomeSummary,
  ReportStudentProgress,
  ReportStudentProgressPoint,
  ReportStudentQuestionSummary,
  ReportStudentScoreSummary,
  ReportStudentSnapshot,
  ReportStudentStatistics,
} from "@uzman-hocam/shared-types";
import ExcelJS from "exceljs";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
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

export interface ReportSnapshotPdfResult {
  fileName: string;
  contentType: "application/pdf";
  fileBase64: string;
  pageCount: number;
}

export interface ReportPdfRenderInput {
  html: string;
  fallbackLines: string[];
}

export interface ReportPdfRenderer {
  render(input: ReportPdfRenderInput): Promise<Buffer>;
}

@Injectable()
export class ReportGenerationService {
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
  ) {}

  async enqueueGeneration(
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
    return Promise.all(filterReportSnapshots(snapshots, filters).map((snapshot) => this.scopeSnapshotForTeacher(context, snapshot)));
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

async function createSnapshotWorkbook(snapshot: ReportSnapshotRecord): Promise<ReportSnapshotExportResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Uzman Hocam";
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
  ]);

  const branches = workbook.addWorksheet("Branches");
  branches.addRow(["branch", "resultCount", "correct", "wrong", "blank", "net"]);
  for (const branch of readRecords(snapshotData.branches)) {
    branches.addRow([
      readText(branch.branch),
      readNumber(branch.resultCount),
      readNumber(branch.correct),
      readNumber(branch.wrong),
      readNumber(branch.blank),
      readNumber(branch.net),
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
  const executablePath = process.env.REPORT_PDF_BROWSER_EXECUTABLE_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH;
  return executablePath ? new PuppeteerReportPdfRenderer(executablePath) : new SimpleReportPdfRenderer();
}

class PuppeteerReportPdfRenderer implements ReportPdfRenderer {
  constructor(private readonly executablePath: string) {}

  async render(input: ReportPdfRenderInput): Promise<Buffer> {
    const puppeteer = await import("puppeteer-core");
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: this.executablePath,
      headless: true,
    });

    try {
      const page = await browser.newPage();
      await page.setContent(input.html, { waitUntil: "domcontentloaded" });
      const pdf = await page.pdf({
        format: "A4",
        margin: { bottom: "16mm", left: "14mm", right: "14mm", top: "16mm" },
        printBackground: true,
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
}

class SimpleReportPdfRenderer implements ReportPdfRenderer {
  async render(input: ReportPdfRenderInput): Promise<Buffer> {
    return buildSimplePdf(input.fallbackLines);
  }
}

async function createSnapshotPdf(
  snapshot: ReportSnapshotRecord,
  renderer: ReportPdfRenderer,
  institution: Pick<ReportStudentSnapshot, "institutionLogoUrl" | "institutionName"> = {},
): Promise<ReportSnapshotPdfResult> {
  const lines = createSnapshotPdfLines(snapshot, institution);
  const pdf = await renderer.render({
    fallbackLines: lines,
    html: createSnapshotPdfHtml(snapshot, institution),
  });

  return {
    fileName: `${snapshot.examId}-${snapshot.id}.pdf`,
    contentType: "application/pdf",
    fileBase64: pdf.toString("base64"),
    pageCount: 1,
  };
}

function createSnapshotPdfLines(
  snapshot: ReportSnapshotRecord,
  institution: Pick<ReportStudentSnapshot, "institutionName"> = {},
): string[] {
  const snapshotData = snapshot.snapshotData ?? {};
  const averages = readRecord(snapshotData.averages);
  return [
    `${institution.institutionName ?? "Uzman Hocam"} - Sinav Raporu`,
    `Sinav: ${snapshot.examId}`,
    `Snapshot: ${snapshot.id}`,
    `Durum: ${snapshot.status}`,
    `Uretim: ${snapshot.generatedAt ?? "-"}`,
    "",
    "Genel Ozet",
    `Sonuc sayisi: ${readNumber(snapshotData.resultCount) || "-"}`,
    `Ortalama net: ${readNumber(averages.net) || "-"}`,
    `Ortalama LGS puani: ${readLgsScore(averages) || "-"}`,
    `Standart puan: ${readNumber(averages.standardScore) || "-"}`,
    "",
    "Branslar",
    ...readRecords(snapshotData.branches).slice(0, 8).map((branch) =>
      `${readText(branch.branch) || "-"}: ${readNumber(branch.resultCount) || "-"} sonuc, ${readNumber(branch.net) || "-"} net`
    ),
    "",
    "Siniflar",
    ...readRecords(snapshotData.classes).slice(0, 8).map((classSummary) => {
      const classAverages = readRecord(classSummary.averages);
      return `${readText(classSummary.className) || "Sinifsiz"}: ${readNumber(classSummary.resultCount) || "-"} sonuc, ${readNumber(classAverages.net) || "-"} net`;
    }),
    "",
    "Ogrenciler",
    ...readRecords(snapshotData.students).slice(0, 12).map((student) => {
      const total = readRecord(student.total);
      const statistics = readStudentStatistics(student.statistics);
      return `${readText(student.studentId) || "-"} ${readText(student.className) || ""}: ${readNumber(total.net) || "-"} net, ${readLgsScore(total) || "-"} LGS puani, genel ${formatPdfRank(statistics?.general)}, sinif ${formatPdfRank(statistics?.class)}`;
    }),
    "",
    "Ogrenci Karnesi",
    "Bolum Analizi",
    "Puan - Sira Analizi",
    "Bolum Basari Yuzdeleri",
    "Son Sinav Netleri",
  ];
}

function createSnapshotPdfHtml(
  snapshot: ReportSnapshotRecord,
  institution: Pick<ReportStudentSnapshot, "institutionLogoUrl" | "institutionName"> = {},
): string {
  const snapshotData = snapshot.snapshotData ?? {};
  const averages = readRecord(snapshotData.averages);
  const averageLgsScore = readLgsScore(averages);
  const branches = readRecords(snapshotData.branches).slice(0, 8);
  const classes = readRecords(snapshotData.classes).slice(0, 8);
  const students = readRecords(snapshotData.students).slice(0, 14);
  const institutionName = institution.institutionName ?? "Uzman Hocam";

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <style>
    body { color: #1b1d23; font-family: Arial, sans-serif; margin: 0; }
    .hero { background: #16324f; color: #fff; padding: 28px 30px; }
    .hero p { margin: 0 0 8px; opacity: .78; }
    .hero h1 { font-size: 26px; margin: 0; }
    .content { padding: 24px 30px; }
    .cards { display: grid; gap: 12px; grid-template-columns: repeat(4, 1fr); margin-bottom: 24px; }
    .card { border: 1px solid #dce3ec; border-radius: 8px; padding: 12px; }
    .card span { color: #66758a; display: block; font-size: 11px; margin-bottom: 7px; }
    .card strong { font-size: 18px; }
    .karne { border: 3px solid #d9a428; margin: 0 0 24px; padding: 14px; }
    .karne-detail { page-break-before: always; }
    .karne-header { display: grid; grid-template-columns: 1fr 160px; border: 1px solid #d9a428; }
    .karne-header div { padding: 10px 12px; }
    .karne-header h2 { margin: 0 0 6px; }
    .karne-header strong { display: block; font-size: 20px; }
    .karne-brand { align-items: center; border-left: 1px solid #d9a428; color: #0f766e; display: grid; font-weight: 800; justify-items: center; padding: 10px; text-align: center; }
    .karne-brand img { display: block; max-height: 66px; max-width: 116px; object-fit: contain; }
    .karne-summary { display: grid; grid-template-columns: repeat(5, 1fr); margin: 10px 0; }
    .karne-summary span { border: 1px solid #d9a428; font-size: 11px; font-weight: 700; padding: 7px; text-align: center; }
    .karne-grid { display: grid; gap: 12px; grid-template-columns: 1.3fr .7fr; }
    h2 { color: #16324f; font-size: 16px; margin: 22px 0 10px; }
    table { border-collapse: collapse; font-size: 12px; width: 100%; }
    th { background: #eef3f8; color: #273447; text-align: left; }
    th, td { border: 1px solid #dce3ec; padding: 7px 8px; }
    .footer { color: #66758a; font-size: 11px; margin-top: 18px; }
  </style>
</head>
<body>
  <section class="hero">
    <p>${escapeHtml(institutionName)}</p>
    <h1>Sınav Raporu</h1>
  </section>
  <main class="content">
    <section class="cards">
      ${renderPdfCard("Sınav", snapshot.examId)}
    ${renderPdfCard("Snapshot", snapshot.id)}
    ${renderPdfCard("Sonuç", readNumber(snapshotData.resultCount) || "-")}
    ${renderPdfCard("Ortalama net", readNumber(averages.net) || "-")}
    ${renderPdfCard("Ortalama LGS puanı", averageLgsScore || "-")}
    ${renderPdfCard("Standart puan", readNumber(averages.standardScore) || "-")}
    ${renderPdfCard("Durum", snapshot.status)}
    ${renderPdfCard("Üretim", snapshot.generatedAt ?? "-")}
    ${renderPdfCard("Rapor tipi", snapshot.reportType)}
    </section>
    ${renderPdfStudentKarne(students[0], createStudentBranchAverageLookup(snapshotData, readText(students[0]?.classId)), institution)}
    ${renderPdfTable("Branş Başarı", ["Branş", "Sonuç", "Net"], branches, (branch) => [
      readText(branch.branch) || "-",
      readNumber(branch.resultCount) || "-",
      readNumber(branch.net) || "-",
    ])}
    ${renderPdfTable("Sınıf Başarı", ["Sınıf", "Sonuç", "Net", "LGS puanı", "Standart puan"], classes, (classSummary) => {
      const classAverages = readRecord(classSummary.averages);
      return [
        readText(classSummary.className) || "Sınıfsız",
        readNumber(classSummary.resultCount) || "-",
        readNumber(classAverages.net) || "-",
        readLgsScore(classAverages) || "-",
        readNumber(classAverages.standardScore) || "-",
      ];
    })}
    ${renderPdfTable("Öğrenci Özeti", ["Öğrenci", "Sınıf", "Net", "LGS puanı", "Standart puan", "Genel sıra", "Sınıf sıra"], students, (student) => {
      const total = readRecord(student.total);
      const statistics = readStudentStatistics(student.statistics);
      return [
        readText(student.studentId) || "-",
        readText(student.className) || "-",
        readNumber(total.net) || "-",
        readLgsScore(total) || "-",
        readNumber(total.standardScore) || "-",
        formatPdfRank(statistics?.general),
        formatPdfRank(statistics?.class),
      ];
    })}
    <p class="footer">Bu çıktı hazır ReportSnapshot verisinden üretilmiştir.</p>
  </main>
</body>
</html>`;
}

function renderPdfStudentKarne(
  student: Record<string, unknown> | undefined,
  branchAverages = new Map<string, Pick<ReportStudentBranchSummary, "classNetAverage" | "generalNetAverage" | "schoolNetAverage">>(),
  institution: Pick<ReportStudentSnapshot, "institutionLogoUrl" | "institutionName"> = {},
): string {
  if (!student) return "";

  const total = readRecord(student.total);
  const lgsScore = readLgsScore(total);
  const statistics = readStudentStatistics(student.statistics);
  const branches = readRecords(student.branches);
  const outcomes = readRecords(student.outcomes);
  const summaryOutcomes = outcomes.slice(0, 6);
  const questions = readRecords(student.questions).sort((left, right) => {
    const leftNo = readNumber(left.questionNo) || 0;
    const rightNo = readNumber(right.questionNo) || 0;
    return leftNo - rightNo;
  });

  return `<section class="karne">
      <div class="karne-header">
        <div>
          <h2>Öğrenci Karnesi</h2>
          <strong>${escapeHtml(readText(student.studentId) || "-")}</strong>
          <span>${escapeHtml(readText(student.className) || readText(student.classId) || "-")}</span>
        </div>
        <div class="karne-brand">${renderPdfInstitutionBrand(institution)}</div>
      </div>
      <div class="karne-summary">
        <span>Net ${escapeHtml(formatPdfValue(readNumber(total.net)))}</span>
        <span>LGS puanı ${escapeHtml(formatPdfValue(lgsScore))}</span>
        <span>Standart puan ${escapeHtml(formatPdfValue(readNumber(total.standardScore)))}</span>
        <span>Genel sıra ${escapeHtml(formatPdfRank(statistics?.general))}</span>
        <span>Sınıf sıra ${escapeHtml(formatPdfRank(statistics?.class))}</span>
      </div>
      <div class="karne-grid">
        ${renderPdfTable("BÖLÜM ANALİZİ", ["No", "Branş", "Soru sayısı", "Doğru", "Yanlış", "Boş", "Net", "Sınıf net ort", "Okul net ort", "Genel net ort"], branches, (branch, index) => [
          index + 1,
          readText(branch.branch) || "-",
          formatPdfValue(branchQuestionCount(branch)),
          formatPdfValue(readNumber(branch.correct)),
          formatPdfValue(readNumber(branch.wrong)),
          formatPdfValue(readNumber(branch.blank)),
          formatPdfValue(readNumber(branch.net)),
          formatPdfValue(branchAverages.get(readText(branch.branch))?.classNetAverage ?? readNumber(branch.classNetAverage)),
          formatPdfValue(branchAverages.get(readText(branch.branch))?.schoolNetAverage ?? readNumber(branch.schoolNetAverage)),
          formatPdfValue(branchAverages.get(readText(branch.branch))?.generalNetAverage ?? readNumber(branch.generalNetAverage)),
        ])}
        <section>
          <h2>PUAN - SIRA ANALİZİ</h2>
          <table>
            <tbody>
        <tr><th>LGS puanı</th><td>${escapeHtml(formatPdfValue(lgsScore))}</td></tr>
        <tr><th>Standart puan</th><td>${escapeHtml(formatPdfValue(readNumber(total.standardScore)))}</td></tr>
        <tr><th>SIRA</th><td>${escapeHtml(formatPdfRank(statistics?.general))}</td></tr>
        <tr><th>SINIF</th><td>${escapeHtml(formatPdfRank(statistics?.class))}</td></tr>
      </tbody>
    </table>
        </section>
      </div>
      ${renderPdfTable("BÖLÜM BAŞARI YÜZDELERİ", ["Kazanım", "Branş", "Doğru", "Yanlış", "Boş", "Net"], summaryOutcomes, (outcome) => [
        readText(outcome.outcomeCode) || "-",
        readText(outcome.branch) || "-",
        formatPdfValue(readNumber(outcome.correct)),
        formatPdfValue(readNumber(outcome.wrong)),
        formatPdfValue(readNumber(outcome.blank)),
        formatPdfValue(readNumber(outcome.net)),
      ])}
      ${renderPdfTable("SON SINAV NETLERİ", ["Öğrenci", "Net", "LGS puanı", "Standart puan"], [student], (row) => {
        const rowTotal = readRecord(row.total);
        return [
          readText(row.studentId) || "-",
          formatPdfValue(readNumber(rowTotal.net)),
          formatPdfValue(readLgsScore(rowTotal)),
          formatPdfValue(readNumber(rowTotal.standardScore)),
        ];
      })}
    </section>
    <section class="karne karne-detail">
      <div class="karne-header">
        <div>
          <h2>Detaylı Deneme Analizi</h2>
          <strong>${escapeHtml(readText(student.studentId) || "-")}</strong>
          <span>${escapeHtml(readText(student.className) || readText(student.classId) || "-")}</span>
        </div>
        <div class="karne-brand">${renderPdfInstitutionBrand(institution)}</div>
      </div>
      ${renderPdfTable("KAZANIM DETAYI", ["Kazanım", "Ders", "Doğru", "Yanlış", "Boş", "Net"], outcomes, (outcome) => [
        readText(outcome.outcomeCode) || "-",
        readText(outcome.branch) || "-",
        formatPdfValue(readNumber(outcome.correct)),
        formatPdfValue(readNumber(outcome.wrong)),
        formatPdfValue(readNumber(outcome.blank)),
        formatPdfValue(readNumber(outcome.net)),
      ])}
      ${renderPdfTable("SORU CEVAP ANALİZİ", ["Soru", "Ders", "Kazanım", "Öğrenci cevabı", "Doğru cevap", "Durum"], questions, (question) => [
        formatPdfValue(readNumber(question.questionNo)),
        readText(question.branch) || "-",
        readText(question.outcomeCode) || "-",
        readText(question.answer) || "-",
        readText(question.correctAnswer) || "-",
        formatPdfQuestionStatus(question.status),
      ])}
    </section>`;
}

function renderPdfInstitutionBrand(institution: Pick<ReportStudentSnapshot, "institutionLogoUrl" | "institutionName">): string {
  const name = institution.institutionName ?? "Uzman Hocam";
  if (institution.institutionLogoUrl) {
    return `<img src="${escapeHtml(institution.institutionLogoUrl)}" alt="${escapeHtml(name)} logosu" />`;
  }
  return escapeHtml(name);
}

function renderPdfCard(label: string, value: string | number): string {
  return `<article class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`;
}

function formatPdfValue(value: string | number): string {
  return value === "" ? "-" : String(value);
}

function formatPdfRank(rank: ReportScopeRank | undefined): string {
  if (!rank) return "-";
  return `${rank.rank}/${rank.outOf} (%${rank.percentile})`;
}

function formatPdfQuestionStatus(value: unknown): string {
  const status = readQuestionStatus(value);
  if (status === "WRONG") return "Yanlış";
  if (status === "BLANK") return "Boş";
  return "Doğru";
}

function renderPdfTable(
  title: string,
  headers: string[],
  rows: Record<string, unknown>[],
  mapRow: (row: Record<string, unknown>, index: number) => Array<string | number>,
): string {
  if (rows.length === 0) return "";

  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const rowHtml = rows
    .map((row, index) => `<tr>${mapRow(row, index).map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`)
    .join("");

  return `<section><h2>${escapeHtml(title)}</h2><table><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table></section>`;
}

function branchQuestionCount(branch: Record<string, unknown>): string | number {
  const correct = readNumber(branch.correct);
  const wrong = readNumber(branch.wrong);
  const blank = readNumber(branch.blank);
  if (correct === "" || wrong === "" || blank === "") return "-";
  return correct + wrong + blank;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  const summary: ReportStudentScoreSummary = {
    correct: readOptionalNumber(record.correct),
    wrong: readOptionalNumber(record.wrong),
    blank: readOptionalNumber(record.blank),
    net: readOptionalNumber(record.net),
    rawScore: readOptionalNumber(record.rawScore),
    standardScore: readOptionalNumber(record.standardScore),
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
  return {
    branch,
    correct: readOptionalNumber(record.correct),
    wrong: readOptionalNumber(record.wrong),
    blank: readOptionalNumber(record.blank),
    net: readOptionalNumber(record.net),
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
  return {
    outcomeCode: readText(record.outcomeCode),
    branch: readText(record.branch),
    correct: readOptionalNumber(record.correct),
    wrong: readOptionalNumber(record.wrong),
    blank: readOptionalNumber(record.blank),
    net: readOptionalNumber(record.net),
  };
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
