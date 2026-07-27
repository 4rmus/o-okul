import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, type OnModuleDestroy } from "@nestjs/common";
import type {
  ExamScoreAverage,
  ExamScoreStatus,
  ExamScoreType,
  ExamScoreView,
  ExamScoreRanking,
  ReportGenerationJobStatus,
  ReportPdfInstitution,
  ReportPdfRenderJobPayload,
  ReportPdfRenderJobResult,
  ReportPdfSnapshotRecord,
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
} from "@o-okul/shared-types";
import {
  reportCourseMatchesScoreType,
  reportCourseShortName,
  reportCourseSortOrder,
} from "@o-okul/shared-types";
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
import { filterTenantResources, isTeacherSubjectContext } from "../tenant/tenant-access.js";
import { tenantStoreToken, type TenantStore } from "../tenant/tenant-store.js";
import { reportSnapshotStoreToken, type ReportSnapshotStore } from "./report-snapshot-store.js";

export const reportGenerationQueueProducerToken = Symbol("reportGenerationQueueProducer");
export const reportGenerationJobStatusReaderToken = Symbol("reportGenerationJobStatusReader");
export const reportPdfRendererToken = Symbol("reportPdfRenderer");
export const examResultSummaryReportType = "EXAM_RESULT_SUMMARY";

export interface ReportGenerationQueueProducer {
  enqueue(input: TenantQueueJobInput): Promise<ProducedJob>;
}

export interface ReportGenerationQueuedJobStatus extends ReportGenerationJobStatus {
  tenantId: string;
  examId: string;
}

export interface ReportGenerationJobStatusReader {
  get(jobId: string): Promise<ReportGenerationQueuedJobStatus | undefined>;
  close?(): Promise<void>;
}

export interface EnqueueReportGenerationInput {
  examId?: string;
  reportType?: string;
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
    @Optional()
    @Inject(reportGenerationJobStatusReaderToken)
    private readonly generationJobStatuses?: ReportGenerationJobStatusReader,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.pdfRenderer.close?.(),
      this.generationJobStatuses?.close?.(),
    ]);
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
    const reportContext = resolveReportContext(input);
    const contentHash = createReportGenerationContentHash({
      tenantId: context.tenantId,
      examId,
      reportType,
      ...reportContext,
    });

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

  async getGenerationJobStatus(
    context: RequestContext,
    examId: string | undefined,
    jobId: string | undefined,
  ): Promise<ReportGenerationJobStatus> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedJobId = required(jobId, "REPORT_GENERATION_JOB_REQUIRED");
    const generationContentHash = parseGenerationJobContentHash(resolvedExamId, resolvedJobId);
    const queuedJob = await this.generationJobStatuses?.get(resolvedJobId);
    if (queuedJob) {
      if (queuedJob.tenantId !== context.tenantId || queuedJob.examId !== resolvedExamId) {
        throw new NotFoundException("REPORT_GENERATION_JOB_NOT_FOUND");
      }
      const { tenantId: _tenantId, examId: _examId, ...status } = queuedJob;
      return status;
    }

    const snapshots = await this.snapshots.listByExam(context.tenantId, resolvedExamId);
    const completedSnapshot = snapshots
      .filter((snapshot) => snapshot.status === "READY" && snapshot.inputRefs.generationContentHash === generationContentHash)
      .sort((left, right) => toTime(right.updatedAt) - toTime(left.updatedAt))[0];
    if (!completedSnapshot) {
      throw new NotFoundException("REPORT_GENERATION_JOB_NOT_FOUND");
    }

    return {
      jobId: resolvedJobId,
      status: "COMPLETED",
      snapshotId: completedSnapshot.id,
      updatedAt: completedSnapshot.updatedAt,
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

    if (isTeacherSubjectContext(context) && summaries.length === 0) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
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

    const scopedSnapshot = await this.scopeSnapshotForTeacher(context, snapshot);
    const result = await createSnapshotPdf(
      projectSnapshotStudents(
        scopedSnapshot,
        readRecords(scopedSnapshot.snapshotData?.students),
        "INSTITUTION_SUMMARY",
      ),
      this.pdfRenderer,
      await this.findInstitutionProfile(context),
    );
    return { ...result, fileName: `${resolvedExamId}-${resolvedSnapshotId}-kurum-ozeti.pdf` };
  }

  async exportSnapshotKarnelerPdf(
    context: RequestContext,
    examId: string | undefined,
    snapshotId: string | undefined,
  ): Promise<ReportSnapshotPdfResult> {
    const { resolvedExamId, resolvedSnapshotId, snapshot } = await this.requireReadySnapshot(
      context,
      examId,
      snapshotId,
    );
    const scopedSnapshot = await this.scopeSnapshotForTeacher(context, snapshot);
    const result = await createSnapshotPdf(
      projectSnapshotStudents(
        scopedSnapshot,
        readRecords(scopedSnapshot.snapshotData?.students),
        "STUDENT_CARDS",
      ),
      this.pdfRenderer,
      await this.findInstitutionProfile(context),
    );
    return { ...result, fileName: `${resolvedExamId}-${resolvedSnapshotId}-toplu-karneler.pdf` };
  }

  async exportStudentPdf(
    context: RequestContext,
    examId: string | undefined,
    snapshotId: string | undefined,
    studentId: string | undefined,
  ): Promise<ReportSnapshotPdfResult> {
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    const { resolvedExamId, resolvedSnapshotId, snapshot } = await this.requireReadySnapshot(
      context,
      examId,
      snapshotId,
    );
    await this.assertTeacherStudentReportScope(context, resolvedStudentId, snapshot);
    const scopedSnapshot = await this.scopeSnapshotForTeacher(context, snapshot);
    const student = readRecords(scopedSnapshot.snapshotData?.students)
      .find((candidate) => readText(candidate.studentId) === resolvedStudentId);
    if (!student) {
      throw new NotFoundException("REPORT_STUDENT_NOT_FOUND");
    }
    const result = await createSnapshotPdf(
      projectSnapshotStudents(scopedSnapshot, [student], "STUDENT_CARDS"),
      this.pdfRenderer,
      await this.findInstitutionProfile(context),
    );
    return { ...result, fileName: `${resolvedExamId}-${resolvedSnapshotId}-${resolvedStudentId}-karne.pdf` };
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
    const schemaVersion = readOptionalNumber(snapshot.snapshotData.schemaVersion);
    const statistics = schemaVersion === 2 ? undefined : readStudentStatistics(student.statistics);
    const scoreViews = readExamScoreViews(student.scoreViews);
    const scoreRankings = schemaVersion === 2 ? readExamScoreRankings(student.scoreRankings) : [];
    const examYear = readOptionalNumber(snapshot.snapshotData.examYear);
    const branchAverages = createStudentBranchAverageLookup(snapshot.snapshotData, classId);
    const institution = await this.findInstitutionProfile(context);
    const examMeta = schemaVersion === 2
      ? {
          ...(readText(snapshot.snapshotData.examTitle) ? { examTitle: readText(snapshot.snapshotData.examTitle) } : {}),
          ...(readText(snapshot.snapshotData.examStartsAt) ? { examStartsAt: readText(snapshot.snapshotData.examStartsAt) } : {}),
        }
      : await this.findExamMeta(context, resolvedExamId);
    const participantMeta = schemaVersion === 2
      ? {
          ...(readText(student.participantNo) ? { participantNo: readText(student.participantNo) } : {}),
          ...(readText(student.bookletType) ? { bookletType: readText(student.bookletType) } : {}),
        }
      : await this.findParticipantMeta(context, resolvedExamId, resolvedStudentId);
    const studentName = readText(student.displayName) || await this.findStudentDisplayName(context, resolvedStudentId);
    return {
      tenantId: context.tenantId,
      ...institution,
      examId: resolvedExamId,
      ...(readText(snapshot.snapshotData.examType) ? { examType: readText(snapshot.snapshotData.examType) } : {}),
      ...(examYear !== undefined ? { examYear } : {}),
      ...(readText(snapshot.snapshotData.scoringProfileId)
        ? { scoringProfileId: readText(snapshot.snapshotData.scoringProfileId) }
        : {}),
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
      ...(scoreViews.length > 0 ? { scoreViews } : {}),
      ...(scoreRankings.length > 0 ? { scoreRankings } : {}),
      total: readScoreSummary(student.total),
      branches: readRecords(student.branches).map((branch) => readBranchSummary(branch, branchAverages)),
      ...(outcomes.length > 0 ? { outcomes } : {}),
      ...(questions.length > 0 ? { questions } : {}),
      ...(statistics ? { statistics } : {}),
      generatedAt: snapshot.generatedAt,
    };
  }

  private async requireReadySnapshot(
    context: RequestContext,
    examId: string | undefined,
    snapshotId: string | undefined,
  ): Promise<{
    resolvedExamId: string;
    resolvedSnapshotId: string;
    snapshot: ReportSnapshotRecord;
  }> {
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
    return { resolvedExamId, resolvedSnapshotId, snapshot };
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
    const snapshots = options.scope === "all"
      ? await this.snapshots.listByTenant(context.tenantId)
      : await this.snapshots.listByExam(context.tenantId, resolvedExamId);
    const points: ReportStudentProgressPoint[] = [];
    let teacherAuthorizedSnapshot = false;

    for (const snapshot of snapshots) {
      if (snapshot.status !== "READY" || !snapshot.snapshotData) continue;

      const student = readRecords(snapshot.snapshotData.students)
        .find((candidate) => readText(candidate.studentId) === resolvedStudentId);
      if (student) {
        if (isTeacherSubjectContext(context) && !(await this.canTeacherAccessStudentReport(context, resolvedStudentId, snapshot))) {
          continue;
        }
        if (isTeacherSubjectContext(context)) teacherAuthorizedSnapshot = true;
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

    if (isTeacherSubjectContext(context) && !teacherAuthorizedSnapshot) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }

    points.sort((a, b) => toTime(a.generatedAt) - toTime(b.generatedAt));

    const successRateDelta = delta(points, (point) => point.total.successRate);
    const netDelta = delta(points, (point) => point.total.net);
    const standardScoreDelta = delta(points, (point) => point.total.standardScore);

    return {
      tenantId: context.tenantId,
      examId: resolvedExamId,
      studentId: resolvedStudentId,
      points,
      ...(successRateDelta !== undefined ? { successRateDelta } : {}),
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
    snapshot: ReportSnapshotRecord,
  ): Promise<void> {
    if (!isTeacherSubjectContext(context)) {
      return;
    }
    if (!(await this.canTeacherAccessStudentReport(context, studentId, snapshot))) {
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
    snapshot: ReportSnapshotRecord,
  ): Promise<boolean> {
    if (!this.teacherAssignmentStore) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }
    const student = readRecords(snapshot.snapshotData?.students)
      .find((candidate) => readText(candidate.studentId) === studentId);
    if (!student) return false;
    const assignments = filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(context.subjectId));
    return isTeacherScopedSnapshotStudent(context.subjectId, student, assignments, snapshot, snapshotReferenceDate(snapshot));
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
      .filter((classSummary) => scope.aggregateClassIds.has(readText(classSummary.classId)));

    return {
      ...snapshot,
      snapshotData: {
        ...readSnapshotHeader(snapshotData, false),
        reportType: readText(snapshotData.reportType) || snapshot.reportType,
        ...(readText(snapshotData.generatedAt) || snapshot.generatedAt
          ? { generatedAt: readText(snapshotData.generatedAt) || snapshot.generatedAt }
          : {}),
        resultCount: scopedStudents.length,
        ...(scopedClasses.length > 0 ? { classes: scopedClasses } : {}),
        students: scopedStudents,
      },
    };
  }

  private async resolveTeacherReportScope(
    context: RequestContext & { subjectType: "TEACHER"; subjectId: string },
    snapshot: ReportSnapshotRecord,
  ): Promise<{ studentIds: Set<string>; aggregateClassIds: Set<string> }> {
    if (!this.teacherAssignmentStore) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const assignments = filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(context.subjectId));
    const referenceDate = snapshotReferenceDate(snapshot);
    const scopedStudents = readRecords(snapshot.snapshotData?.students)
      .filter((student) => isTeacherScopedSnapshotStudent(context.subjectId, student, assignments, snapshot, referenceDate));

    return {
      studentIds: new Set(scopedStudents.map((student) => readText(student.studentId)).filter(Boolean)),
      aggregateClassIds: new Set(assignments
        .filter((assignment) => assignment.classId && !assignment.studentId)
        .filter((assignment) => isAssignmentActiveAt(assignment, referenceDate) && matchesReportContext(assignment, snapshot))
        .map((assignment) => assignment.classId as string)),
    };
  }
}

export function createReportGenerationContentHash(input: {
  tenantId: string;
  examId: string;
  reportType: typeof examResultSummaryReportType;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([
      "report-generation-v1",
      input.tenantId,
      input.examId,
      input.reportType,
      input.campusId ?? null,
      input.gradeLevelId ?? null,
      input.classId ?? null,
      input.courseId ?? null,
      input.termId ?? null,
    ]))
    .digest("hex");
}

export function createReportGenerationJobStatusReader(): ReportGenerationJobStatusReader {
  return new BullReportGenerationJobStatusReader();
}

class BullReportGenerationJobStatusReader implements ReportGenerationJobStatusReader {
  private queue?: Queue<Record<string, unknown>, Record<string, unknown>>;

  async get(jobId: string): Promise<ReportGenerationQueuedJobStatus | undefined> {
    const job = await this.getQueue().getJob(jobId);
    if (!job) return undefined;

    const data = readRecord(job.data);
    const tenantId = readText(data.tenantId);
    const examId = readText(data.entityId);
    if (!tenantId || !examId) return undefined;

    const status = mapReportGenerationJobState(await job.getState());
    if (!status) return undefined;
    const result = readRecord(job.returnvalue);
    const snapshotId = readText(result.id);
    const timestamp = job.finishedOn ?? job.processedOn ?? job.timestamp;

    return {
      tenantId,
      examId,
      jobId,
      status,
      ...(status === "COMPLETED" && snapshotId ? { snapshotId } : {}),
      ...(status === "FAILED" ? { errorCode: "REPORT_GENERATION_FAILED" } : {}),
      updatedAt: new Date(timestamp).toISOString(),
    };
  }

  async close(): Promise<void> {
    await this.queue?.close();
  }

  private getQueue(): Queue<Record<string, unknown>, Record<string, unknown>> {
    this.queue ??= new Queue("report-generation", {
      connection: parseRedisUrl(),
      prefix: process.env.QUEUE_PREFIX,
    });
    return this.queue;
  }
}

function mapReportGenerationJobState(state: string): ReportGenerationJobStatus["status"] | undefined {
  if (state === "active") return "RUNNING";
  if (state === "completed") return "COMPLETED";
  if (state === "failed") return "FAILED";
  if (["delayed", "paused", "waiting", "waiting-children"].includes(state)) return "QUEUED";
  return undefined;
}

function parseGenerationJobContentHash(examId: string, jobId: string): string {
  const prefix = `${examId}_`;
  const contentHash = jobId.startsWith(prefix) ? jobId.slice(prefix.length) : "";
  if (!/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new BadRequestException("REPORT_GENERATION_JOB_INVALID");
  }
  return contentHash;
}

export function isTeacherScopedStudent(
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

export function isTeacherScopedSnapshotStudent(
  teacherId: string,
  student: Record<string, unknown>,
  assignments: Array<{ teacherId: string; studentId?: string; classId?: string; courseId?: string; termId?: string; startsAt?: string; endsAt?: string }>,
  reportContext: Pick<ReportSnapshotRecord, "courseId" | "termId">,
  referenceDate: string,
): boolean {
  const studentId = readText(student.studentId);
  const classId = readText(student.classId);
  return Boolean(studentId) && assignments.some((assignment) =>
    assignment.teacherId === teacherId &&
    isAssignmentActiveAt(assignment, referenceDate) &&
    matchesReportContext(assignment, reportContext) &&
    (assignment.studentId === studentId || Boolean(classId && assignment.classId === classId)),
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
  return isAssignmentActiveAt(assignment, today);
}

function isAssignmentActiveAt(assignment: { startsAt?: string; endsAt?: string }, referenceDate: string): boolean {
  const date = referenceDate.slice(0, 10);
  return (!assignment.startsAt || assignment.startsAt <= date) && (!assignment.endsAt || assignment.endsAt >= date);
}

function snapshotReferenceDate(snapshot: ReportSnapshotRecord): string {
  return readText(snapshot.snapshotData?.generatedAt) || snapshot.generatedAt || snapshot.createdAt;
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
      ...readSnapshotHeader(snapshotData),
      reportType: readText(snapshotData.reportType) || snapshot.reportType,
      ...(generatedAt ? { generatedAt } : {}),
      resultCount: 1,
      students: [
        {
          studentId,
          ...(readText(student.displayName) ? { displayName: readText(student.displayName) } : {}),
          ...(readText(student.studentNo) ? { studentNo: readText(student.studentNo) } : {}),
          ...(readText(student.participantNo) ? { participantNo: readText(student.participantNo) } : {}),
          ...(readText(student.bookletType) ? { bookletType: readText(student.bookletType) } : {}),
          ...(readText(student.classId) ? { classId: readText(student.classId) } : {}),
          ...(readText(student.className) ? { className: readText(student.className) } : {}),
          resultKey: readText(student.resultKey) || `${snapshot.id}:${studentId}`,
          ...(readExamScoreViews(student.scoreViews).length > 0
            ? { scoreViews: readExamScoreViews(student.scoreViews) }
            : {}),
          ...(readExamScoreRankings(student.scoreRankings).length > 0
            ? { scoreRankings: readExamScoreRankings(student.scoreRankings) }
            : {}),
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
      ...readSnapshotHeader(snapshotData),
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
    ...(readText(student.displayName) ? { displayName: readText(student.displayName) } : {}),
    ...(readText(student.studentNo) ? { studentNo: readText(student.studentNo) } : {}),
    ...(readText(student.participantNo) ? { participantNo: readText(student.participantNo) } : {}),
    ...(readText(student.bookletType) ? { bookletType: readText(student.bookletType) } : {}),
    ...(readText(student.classId) ? { classId: readText(student.classId) } : {}),
    ...(readText(student.className) ? { className: readText(student.className) } : {}),
    resultKey: readText(student.resultKey) || studentId,
    ...(readExamScoreViews(student.scoreViews).length > 0
      ? { scoreViews: readExamScoreViews(student.scoreViews) }
      : {}),
    ...(readExamScoreRankings(student.scoreRankings).length > 0
      ? { scoreRankings: readExamScoreRankings(student.scoreRankings) }
      : {}),
    total: readScoreSummary(student.total),
  };
}

function readSnapshotHeader(
  snapshotData: Record<string, unknown>,
  includeScoreAverages = true,
): Record<string, unknown> {
  const schemaVersion = readOptionalNumber(snapshotData.schemaVersion);
  const examType = readText(snapshotData.examType);
  const examYear = readOptionalNumber(snapshotData.examYear);
  const scoringProfileId = readText(snapshotData.scoringProfileId);
  const examTitle = readText(snapshotData.examTitle);
  const examStartsAt = readText(snapshotData.examStartsAt);
  const scoreAverages = readExamScoreAverages(snapshotData.scoreAverages);
  const scoringAssumptions = readRecord(snapshotData.scoringAssumptions);
  const hasScoringAssumptions = scoringAssumptions.standardDeviationUsed === false
    && scoringAssumptions.cancelledQuestionsExcludedFromScoringDenominator === true
    && typeof scoringAssumptions.lgsAvailableSectionWeightsRenormalized === "boolean";
  return {
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    ...(examType ? { examType } : {}),
    ...(examYear !== undefined ? { examYear } : {}),
    ...(scoringProfileId ? { scoringProfileId } : {}),
    ...(examTitle ? { examTitle } : {}),
    ...(examStartsAt ? { examStartsAt } : {}),
    ...(includeScoreAverages && scoreAverages.length > 0 ? { scoreAverages } : {}),
    ...(snapshotData.officialComparable === false ? { officialComparable: false } : {}),
    ...(hasScoringAssumptions
      ? {
          scoringAssumptions: {
            standardDeviationUsed: false,
            cancelledQuestionsExcludedFromScoringDenominator: true,
            lgsAvailableSectionWeightsRenormalized: scoringAssumptions.lgsAvailableSectionWeightsRenormalized,
          },
        }
      : {}),
  };
}

function projectSnapshotStudents(
  snapshot: ReportSnapshotRecord,
  students: Record<string, unknown>[],
  pdfMode: "INSTITUTION_SUMMARY" | "STUDENT_CARDS",
): ReportSnapshotRecord {
  if (!snapshot.snapshotData) {
    return snapshot;
  }
  return {
    ...snapshot,
    snapshotData: {
      ...snapshot.snapshotData,
      students,
      pdfMode,
    },
  };
}

export async function createSnapshotWorkbook(snapshot: ReportSnapshotRecord): Promise<ReportSnapshotExportResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "o-okul";
  const snapshotData = snapshot.snapshotData ?? {};
  workbook.created = new Date(readText(snapshotData.generatedAt) || snapshot.generatedAt || snapshot.createdAt);

  const summary = workbook.addWorksheet("Özet");
  const averages = readRecord(snapshotData.averages);
  const scoreAverages = readExamScoreAverages(snapshotData.scoreAverages);
  const scoreTypes = scoreTypesForSnapshot(snapshotData);
  const branchNames = uniqueTextValues(readRecords(snapshotData.branches).map((branch) => readText(branch.branch)));
  const isModernSnapshot = readOptionalNumber(snapshotData.schemaVersion) === 2;
  const exampleMarker = readText((snapshotData as Record<string, unknown>).exampleMarker);

  summary.addRows([
    ["Sınav kimliği", snapshot.examId],
    ["Sınav türü", readText(snapshotData.examType)],
    ["Sınav yılı", readNumber(snapshotData.examYear)],
    ["Puanlama profili", readText(snapshotData.scoringProfileId)],
    ["Snapshot kimliği", snapshot.id],
    ["Rapor türü", snapshot.reportType],
    ["Durum", snapshot.status],
    ["Üretim zamanı", snapshot.generatedAt ?? ""],
    ...(exampleMarker ? [["Örnek", exampleMarker]] : []),
    ["Sonuç sayısı", readNumber(snapshotData.resultCount)],
    ["Ortalama başarı %", readNumberOrFallback(averages.successRate, scoreSuccessRate(averages))],
    ["Ortalama soru sayısı", readNumberOrFallback(averages.questionCount, scoreQuestionCount(averages))],
    ["Ortalama net", readNumber(averages.net)],
    ...scoreAverages.map((average) => [
      `${scoreTypeLabel(average.type)} ortalama deneme puanı`,
      average.practiceScore,
    ]),
    ...(isModernSnapshot
      ? [["Uyarı", "Standart sapma kullanılmadan hesaplanan deneme puanıdır. Resmî MEB/ÖSYM sınav puanı değildir."]]
      : [["Eski hesaplama", readLegacyScore(averages)]]),
    ...(readText(snapshotData.examTitle) ? [["Sınav adı", readText(snapshotData.examTitle)]] : []),
    ...(readText(snapshotData.examStartsAt) ? [["Sınav tarihi", readText(snapshotData.examStartsAt)]] : []),
    ...(branchNames.length > 0
      ? [
        ["Ders başarı grafiği", "Başarı %"],
        ...branchNames.map((branchName) => {
          const branch = readRecords(snapshotData.branches).find((record) => readText(record.branch) === branchName);
          const successRate = readNumberOrFallback(branch?.successRate, scoreSuccessRate(readRecord(branch)));
          return [`Ders · ${branchName}`, formatTextBar(successRate, 0, 100)];
        }),
      ]
      : []),
    ...(scoreAverages.length > 0
      ? [
        ["Puan türü grafiği", "100-500 deneme puanı"],
        ...scoreAverages.map((average) => [
          `Puan · ${scoreTypeLabel(average.type)}`,
          formatTextBar(average.practiceScore, 100, 500),
        ]),
      ]
      : []),
  ]);

  const students = workbook.addWorksheet("Öğrenciler");
  students.addRow([
    "Öğrenci",
    "Öğrenci no",
    "Öğrenci kimliği",
    "Sınıf kimliği",
    "Sınıf",
    "Sonuç anahtarı",
    "Başarı %",
    "Soru sayısı",
    "Doğru",
    "Yanlış",
    "Boş",
    "Net",
    ...scoreTypes.flatMap((type) => {
      const scoreBranches = branchNamesForScoreType(type, branchNames);
      return [
        `${scoreTypeLabel(type)} Durum`,
        `${scoreTypeLabel(type)} Deneme puanı`,
        ...scoreBranches.map((branchName) => `${scoreTypeLabel(type)} · ${reportCourseShortName(branchName)} net`),
        `${scoreTypeLabel(type)} Kurum başarı sırası`,
        `${scoreTypeLabel(type)} Sınıf başarı sırası`,
      ];
    }),
    "Katılımcı no",
    "Kitapçık",
  ]);
  for (const student of readRecords(snapshotData.students)) {
    const total = readRecord(student.total);
    students.addRow([
      readText(student.displayName),
      readText(student.studentNo),
      readText(student.studentId),
      readText(student.classId),
      readText(student.className),
      readText(student.resultKey),
      readNumberOrFallback(total.successRate, scoreSuccessRate(total)),
      readNumberOrFallback(total.questionCount, scoreQuestionCount(total)),
      readNumber(total.correct),
      readNumber(total.wrong),
      readNumber(total.blank),
      readNumber(total.net),
      ...readScoreExportCells(student, scoreTypes, branchNames),
      readText(student.participantNo),
      readText(student.bookletType),
    ]);
  }

  const studentBranches = workbook.addWorksheet("Öğrenci Branşları");
  studentBranches.addRow([
    "Öğrenci kimliği", "Öğrenci", "Öğrenci no", "Sınıf", "Branş", "Başarı %", "Soru sayısı",
    "Doğru", "Yanlış", "Boş", "Net", "Sınıf net ort", "Okul net ort", "Genel net ort",
  ]);
  for (const student of readRecords(snapshotData.students)) {
    for (const branch of readRecords(student.branches)) {
      studentBranches.addRow([
        readText(student.studentId),
        readText(student.displayName),
        readText(student.studentNo),
        readText(student.className),
        readText(branch.branch),
        readNumberOrFallback(branch.successRate, scoreSuccessRate(branch)),
        readNumberOrFallback(branch.questionCount, scoreQuestionCount(branch)),
        readNumber(branch.correct),
        readNumber(branch.wrong),
        readNumber(branch.blank),
        readNumber(branch.net),
        readNumber(branch.classNetAverage),
        readNumber(branch.schoolNetAverage),
        readNumber(branch.generalNetAverage),
      ]);
    }
  }

  const classBranches = workbook.addWorksheet("Sınıf-Branş");
  classBranches.addRow([
    "Kapsam", "Sınıf kimliği", "Sınıf", "Branş", "Sonuç sayısı", "Başarı %", "Soru sayısı",
    "Doğru", "Yanlış", "Boş", "Net",
  ]);
  for (const branch of readRecords(snapshotData.branches)) {
    classBranches.addRow([
      "Kurum", "", "", readText(branch.branch), readNumber(branch.resultCount),
      readNumberOrFallback(branch.successRate, scoreSuccessRate(branch)),
      readNumberOrFallback(branch.questionCount, scoreQuestionCount(branch)),
      readNumber(branch.correct), readNumber(branch.wrong), readNumber(branch.blank), readNumber(branch.net),
    ]);
  }
  for (const classSummary of readRecords(snapshotData.classes)) {
    for (const branch of readRecords(classSummary.branches)) {
      classBranches.addRow([
        "Sınıf", readText(classSummary.classId), readText(classSummary.className), readText(branch.branch),
        readNumber(branch.resultCount), readNumberOrFallback(branch.successRate, scoreSuccessRate(branch)),
        readNumberOrFallback(branch.questionCount, scoreQuestionCount(branch)),
        readNumber(branch.correct), readNumber(branch.wrong), readNumber(branch.blank), readNumber(branch.net),
      ]);
    }
  }

  const outcomes = workbook.addWorksheet("Kazanımlar");
  outcomes.addRow([
    "Öğrenci kimliği", "Öğrenci", "Öğrenci no", "Sınıf", "Kazanım", "Branş", "Başarı %",
    "Soru sayısı", "Doğru", "Yanlış", "Boş", "Net",
  ]);
  for (const student of readRecords(snapshotData.students)) {
    for (const outcome of readRecords(student.outcomes)) {
      outcomes.addRow([
        readText(student.studentId),
        readText(student.displayName),
        readText(student.studentNo),
        readText(student.className),
        readText(outcome.outcomeCode),
        readText(outcome.branch),
        readNumberOrFallback(outcome.successRate, scoreSuccessRate(outcome)),
        readNumberOrFallback(outcome.questionCount, scoreQuestionCount(outcome)),
        readNumber(outcome.correct),
        readNumber(outcome.wrong),
        readNumber(outcome.blank),
        readNumber(outcome.net),
      ]);
    }
  }

  const questions = workbook.addWorksheet("Soru Detayı");
  questions.addRow([
    "Öğrenci kimliği", "Öğrenci", "Öğrenci no", "Sınıf", "Soru", "Branş", "Kazanım",
    "Öğrenci cevabı", "Doğru cevap", "Durum", "Puan bölümü", "Değerlendirme", "Konu",
  ]);
  for (const student of readRecords(snapshotData.students)) {
    for (const question of readRecords(student.questions)) {
      questions.addRow([
        readText(student.studentId),
        readText(student.displayName),
        readText(student.studentNo),
        readText(student.className),
        readNumber(question.questionNo),
        readText(question.branch),
        readText(question.outcomeCode),
        readText(question.answer),
        readText(question.correctAnswer),
        readText(question.status),
        readText(question.scoreSection),
        readText(question.evaluationStatus),
        readText(question.topic),
      ]);
    }
  }

  for (const worksheet of workbook.worksheets) {
    styleSnapshotWorksheet(worksheet);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    fileName: `${snapshot.examId}-${snapshot.id}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileBase64: Buffer.from(buffer).toString("base64"),
    rowCount: readRecords(snapshotData.students).length,
  };
}

function styleSnapshotWorksheet(worksheet: ExcelJS.Worksheet): void {
  worksheet.views = worksheet.name === "Özet"
    ? [{ showGridLines: false }]
    : [{ showGridLines: false, state: "frozen", ySplit: 1 }];
  if (worksheet.name === "Özet") {
    worksheet.getColumn(1).width = 28;
    worksheet.getColumn(2).width = 42;
    worksheet.getColumn(1).font = { name: "Arial", size: 11, bold: true, color: { argb: "FF344054" } };
    worksheet.getColumn(2).font = { name: "Arial", size: 11 };
    worksheet.getColumn(2).alignment = { vertical: "top", wrapText: true };
    worksheet.eachRow((row) => {
      const label = String(row.getCell(1).value ?? "");
      if (/başarı|net|puan/iu.test(label)) row.getCell(2).numFmt = "0.00";
      if (label === "Örnek" || label === "Uyarı") {
        row.height = label === "Uyarı" ? 64 : 40;
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4E5" } };
          cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF7A2E0E" } };
        });
      }
      if (label === "Ders başarı grafiği" || label === "Puan türü grafiği") {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF4FF" } };
          cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF1849A9" } };
        });
      }
    });
    return;
  }

  const header = worksheet.getRow(1);
  header.height = 30;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF101828" } };
  header.alignment = { vertical: "middle", wrapText: true };
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(1, worksheet.columnCount) },
  };
  worksheet.columns.forEach((column, index) => {
    const label = String(header.getCell(index + 1).value ?? "");
    column.width = Math.min(30, Math.max(14, label.length + 3));
    if (/Başarı %|Net|Deneme puanı|net ort/iu.test(label)) column.numFmt = "0.00";
    if (/Soru sayısı|Doğru|Yanlış|Boş|Sonuç sayısı/iu.test(label)) column.numFmt = "0";
  });
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell) => {
      cell.font = { ...cell.font, name: "Arial", size: 10 };
      cell.alignment = { ...cell.alignment, vertical: "top" };
    });
  });
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
  const scoreAverages = readExamScoreAverages(snapshotData.scoreAverages);
  const isModernSnapshot = readOptionalNumber(snapshotData.schemaVersion) === 2;
  const pdfMode = readText(snapshotData.pdfMode);
  const header = [
    `${institution.institutionName ?? "o-okul"} - Sinav Raporu`,
    `Sinav: ${readText(snapshotData.examTitle) || snapshot.examId}`,
    `Sinav tarihi: ${readText(snapshotData.examStartsAt) || "-"}`,
    `Sinav turu: ${readText(snapshotData.examType) || "-"}`,
    `Snapshot: ${snapshot.id}`,
    `Durum: ${snapshot.status}`,
    `Uretim: ${snapshot.generatedAt ?? "-"}`,
    "",
    ...(isModernSnapshot
      ? ["Standart sapma kullanılmadan hesaplanan deneme puanıdır. Resmî MEB/ÖSYM sınav puanı değildir."]
      : [`Eski hesaplama: ${readLegacyScore(averages) || "-"}`]),
  ];
  const institutionSummary = [
    "Genel Ozet",
    `Sonuc sayisi: ${readNumber(snapshotData.resultCount) || "-"}`,
    `Ortalama basari: ${formatPdfPercent(readNumberOrFallback(averages.successRate, scoreSuccessRate(averages)))}`,
    `Ortalama net: ${readNumber(averages.net) || "-"}`,
    ...scoreAverages.map((average) => `${average.type} ortalama deneme puani: ${average.practiceScore}`),
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
    ...readRecords(snapshotData.students).map((student) => {
      const total = readRecord(student.total);
      const statistics = readOptionalNumber(snapshotData.schemaVersion) === 2
        ? undefined
        : readStudentStatistics(student.statistics);
      const identity = readText(student.displayName) || readText(student.studentId) || "-";
      const studentNo = readText(student.studentNo);
      const scoreLabel = formatPdfPracticeScores(student, readOptionalNumber(snapshotData.schemaVersion));
      const scoreRankingLabel = formatPdfScoreRankings(student);
      const legacyRankingLabel = statistics
        ? `kurum ${formatPdfRank(statistics.general)}, sinif ${formatPdfRank(statistics.class)}`
        : "";
      return `${identity}${studentNo ? ` (${studentNo})` : ""} ${readText(student.className) || ""}: ${formatPdfPercent(readNumberOrFallback(total.successRate, scoreSuccessRate(total)))}, ${readNumber(total.net) || "-"} net${scoreLabel ? `, ${scoreLabel}` : ""}${scoreRankingLabel || legacyRankingLabel ? `, ${scoreRankingLabel || legacyRankingLabel}` : ""}`;
    }),
  ];
  const studentCards = [
    "",
    "Ogrenci Karnesi",
    "Bolum Analizi",
    "Puan - Sira Analizi",
    "Bolum Basari Yuzdeleri",
    "Son Sinav Netleri",
    ...readRecords(snapshotData.students).flatMap((student) => {
      const identity = readText(student.displayName) || readText(student.studentId) || "-";
      return [
        identity,
        formatPdfPracticeScores(student, readOptionalNumber(snapshotData.schemaVersion)),
        formatPdfScoreRankings(student),
        ...readRecords(student.branches).map((branch) =>
          `${readText(branch.branch) || "-"}: ${readNumber(branch.net) || "-"} net, ${formatPdfPercent(readNumberOrFallback(branch.successRate, scoreSuccessRate(branch)))}`
        ),
      ];
    }),
  ];
  if (pdfMode === "INSTITUTION_SUMMARY") return [...header, ...institutionSummary];
  if (pdfMode === "STUDENT_CARDS") return [...header, ...studentCards];
  return [...header, ...institutionSummary, ...studentCards];
}

function formatPdfRank(rank: ReportScopeRank | undefined): string {
  if (!rank) return "-";
  return `${rank.rank}/${rank.outOf}${rank.percentile === undefined ? "" : ` (%${rank.percentile})`}`;
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
  return value.replace(/[\u0000-\u001F\u007F]/gu, "?");
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

function readLegacyScore(value: unknown): number | "" {
  const record = readRecord(value);
  const estimatedRawScore = readNumber(record.estimatedRawScore);
  return estimatedRawScore === "" ? readNumber(record.standardScore) : estimatedRawScore;
}

function readScoreExportCells(
  student: Record<string, unknown>,
  scoreTypes: ExamScoreType[],
  branchNames: string[],
): Array<number | string> {
  const scoreViews = new Map(readExamScoreViews(student.scoreViews).map((view) => [view.type, view]));
  const scoreRankings = new Map(readExamScoreRankings(student.scoreRankings).map((ranking) => [ranking.type, ranking]));
  const branches = new Map(readRecords(student.branches).map((branch) => [readText(branch.branch), branch]));
  return scoreTypes.flatMap((type) => {
    const view = scoreViews.get(type);
    const ranking = scoreRankings.get(type);
    const practiceScore = view?.status === "CALCULATED" ? view.practiceScore ?? "" : "";
    const scoreBranches = branchNamesForScoreType(type, branchNames);
    return [
      view ? formatScoreStatus(view.status) : "",
      practiceScore,
      ...scoreBranches.map((branchName) => readNumber(branches.get(branchName)?.net)),
      formatRankCell(ranking?.institution),
      formatRankCell(ranking?.class),
    ];
  });
}

function branchNamesForScoreType(type: ExamScoreType, branchNames: string[]): string[] {
  return branchNames
    .filter((branchName) => reportCourseMatchesScoreType(type, branchName))
    .sort((left, right) => reportCourseSortOrder(type, left) - reportCourseSortOrder(type, right));
}

function formatScoreStatus(status: ExamScoreStatus): string {
  if (status === "CALCULATED") return "Hesaplandı";
  if (status === "NOT_ELIGIBLE") return "Hesaplanamadı";
  return "Bağlı TYT deneme puanı yok";
}

function formatRankCell(rank: ExamScoreRanking["institution"] | undefined): string {
  return rank ? `${rank.rank}/${rank.outOf}` : "";
}

function formatPdfPracticeScores(student: Record<string, unknown>, schemaVersion: number | undefined): string {
  const scoreViews = readExamScoreViews(student.scoreViews)
    .filter((view) => view.status === "CALCULATED" && view.practiceScore !== undefined);
  if (scoreViews.length > 0) {
    return scoreViews.map((view) => `${view.type} deneme puani ${view.practiceScore}`).join(", ");
  }
  const legacyScore = schemaVersion === 2 ? "" : readLegacyScore(student.total);
  return legacyScore === "" ? "" : `Onceki hesaplama puani ${legacyScore}`;
}

function formatPdfScoreRankings(student: Record<string, unknown>): string {
  return readExamScoreRankings(student.scoreRankings)
    .map((ranking) =>
      `${ranking.type} kurum ${formatPdfRank(ranking.institution)}, sinif ${formatPdfRank(ranking.class)}`
    )
    .join(", ");
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const examScoreTypes = new Set<ExamScoreType>(["LGS", "TYT", "SAY", "EA", "SOZ"]);
const examScoreTypeOrder: ExamScoreType[] = ["LGS", "TYT", "SAY", "EA", "SOZ"];
const examScoreStatuses = new Set<ExamScoreStatus>(["CALCULATED", "NOT_ELIGIBLE", "MISSING_TYT"]);

function scoreTypesForSnapshot(snapshotData: Record<string, unknown>): ExamScoreType[] {
  const examType = readText(snapshotData.examType);
  if (examType === "LGS") return ["LGS"];
  if (examType === "TYT") return ["TYT"];
  if (examType === "AYT") return ["SAY", "EA", "SOZ"];
  const available = new Set(readExamScoreAverages(snapshotData.scoreAverages).map((average) => average.type));
  return available.size > 0
    ? examScoreTypeOrder.filter((type) => available.has(type))
    : examScoreTypeOrder;
}

function scoreTypeLabel(type: ExamScoreType): string {
  if (type === "SAY") return "Sayısal";
  if (type === "SOZ") return "Sözel";
  return type;
}

function uniqueTextValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function formatTextBar(value: number | "", minimum: number, maximum: number): string {
  if (value === "") return "-";
  const ratio = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return `${"■".repeat(Math.round(ratio * 20)).padEnd(20, "·")} ${value.toFixed(2)}`;
}

function readExamScoreAverages(value: unknown): ExamScoreAverage[] {
  return readRecords(value)
    .map((record): ExamScoreAverage | undefined => {
      const type = readText(record.type) as ExamScoreType;
      const calculatedCount = readOptionalNumber(record.calculatedCount);
      const practiceScore = readOptionalNumber(record.practiceScore);
      if (!examScoreTypes.has(type) || calculatedCount === undefined || practiceScore === undefined) {
        return undefined;
      }
      return { type, calculatedCount, practiceScore };
    })
    .filter((average): average is ExamScoreAverage => average !== undefined);
}

function readExamScoreViews(value: unknown): ExamScoreView[] {
  return readRecords(value)
    .map((record): ExamScoreView | undefined => {
      const type = readText(record.type) as ExamScoreType;
      const status = readText(record.status) as ExamScoreStatus;
      const metrics = readRecord(record.metrics);
      const correct = readOptionalNumber(metrics.correct);
      const wrong = readOptionalNumber(metrics.wrong);
      const blank = readOptionalNumber(metrics.blank);
      const net = readOptionalNumber(metrics.net);
      const questionCount = readOptionalNumber(metrics.questionCount);
      const successRate = readOptionalNumber(metrics.successRate);
      const profileId = readText(record.profileId);
      if (
        !examScoreTypes.has(type)
        || !examScoreStatuses.has(status)
        || correct === undefined
        || wrong === undefined
        || blank === undefined
        || net === undefined
        || questionCount === undefined
        || successRate === undefined
        || !profileId
        || record.officialComparable !== false
      ) {
        return undefined;
      }
      const practiceScore = readOptionalNumber(record.practiceScore);
      return {
        type,
        status,
        metrics: { correct, wrong, blank, net, questionCount, successRate },
        ...(practiceScore !== undefined ? { practiceScore } : {}),
        profileId,
        officialComparable: false,
      };
    })
    .filter((view): view is ExamScoreView => view !== undefined);
}

function readExamScoreRankings(value: unknown): ExamScoreRanking[] {
  return readRecords(value)
    .map((record): ExamScoreRanking | undefined => {
      const type = readText(record.type) as ExamScoreType;
      const institution = readRank(record.institution);
      if (!examScoreTypes.has(type) || !institution) return undefined;
      const klass = readRank(record.class);
      return {
        type,
        institution,
        ...(klass ? { class: klass } : {}),
      };
    })
    .filter((ranking): ranking is ExamScoreRanking => ranking !== undefined);
}

function readRank(value: unknown): ExamScoreRanking["institution"] | undefined {
  const record = readRecord(value);
  const rank = readOptionalNumber(record.rank);
  const outOf = readOptionalNumber(record.outOf);
  if (rank === undefined || outOf === undefined) return undefined;
  return { rank, outOf };
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
    ...(readText(record.topic) ? { topic: readText(record.topic) } : {}),
    ...(readText(record.scoreSection)
      ? { scoreSection: readText(record.scoreSection) as ReportStudentQuestionSummary["scoreSection"] }
      : {}),
    ...(record.evaluationStatus === "ACTIVE" || record.evaluationStatus === "CANCELLED"
      ? { evaluationStatus: record.evaluationStatus }
      : {}),
    answer: readText(record.answer),
    correctAnswer: readText(record.correctAnswer),
    status: readQuestionStatus(record.status),
  };
}

function readQuestionStatus(value: unknown): ReportStudentQuestionSummary["status"] {
  return value === "WRONG" || value === "BLANK" || value === "CANCELLED" ? value : "CORRECT";
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
