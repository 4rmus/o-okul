import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { ReportErrorBooklet, ReportGenerationJobStatus, ReportStudentProgress, ReportStudentSnapshot } from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  ReportGenerationService,
  examResultSummaryReportType,
  type ReportGenerationQueueResult,
  type ReportSnapshotListFilters,
  type ReportSnapshotExportResult,
  type ReportSnapshotPdfResult,
  type ReportSnapshotRecord,
} from "./report-generation.service.js";

interface ReportSnapshotListQuery extends ReportSnapshotListFilters {}

const reportGenerationEnqueueBodySchema = z.object({
  campusId: optionalTrimmedString,
  classId: optionalTrimmedString,
  courseId: optionalTrimmedString,
  gradeLevelId: optionalTrimmedString,
  reportType: z.literal(examResultSummaryReportType),
  termId: optionalTrimmedString,
}).strict();

type EnqueueReportGenerationBody = z.infer<typeof reportGenerationEnqueueBodySchema>;

@Controller("exams/:examId/reports")
@UseGuards(RolesGuard)
export class ReportGenerationController {
  constructor(private readonly reports: ReportGenerationService) {}

  @Get("snapshots")
  @RequireCapability("academic:read")
  listSnapshots(@Param("examId") examId: string, @Query() query: ReportSnapshotListQuery): Promise<ReportSnapshotRecord[]> {
    return this.reports.listSnapshots(getRequestContext(), examId, query);
  }

  @Get("students/:studentId/snapshots")
  @RequireCapability("academic:read")
  listStudentSnapshots(
    @Param("examId") examId: string,
    @Param("studentId") studentId: string,
  ): Promise<ReportSnapshotRecord[]> {
    return this.reports.listStudentSnapshots(getRequestContext(), examId, studentId);
  }

  @Get("snapshots/:snapshotId/export.xlsx")
  @RequireCapability("academic:read")
  exportSnapshotExcel(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
  ): Promise<ReportSnapshotExportResult> {
    return this.reports.exportSnapshotExcel(getRequestContext(), examId, snapshotId);
  }

  @Get("snapshots/:snapshotId/export.pdf")
  @RequireCapability("academic:read")
  exportSnapshotPdf(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
  ): Promise<ReportSnapshotPdfResult> {
    return this.reports.exportSnapshotPdf(getRequestContext(), examId, snapshotId);
  }

  @Get("snapshots/:snapshotId/students/:studentId")
  @RequireCapability("academic:read")
  getStudentReport(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
    @Param("studentId") studentId: string,
  ): Promise<ReportStudentSnapshot> {
    return this.reports.getStudentReport(getRequestContext(), examId, snapshotId, studentId);
  }

  @Get("snapshots/:snapshotId/students/:studentId/error-booklet")
  @RequireCapability("academic:read")
  getStudentErrorBooklet(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
    @Param("studentId") studentId: string,
  ): Promise<ReportErrorBooklet> {
    return this.reports.getStudentErrorBooklet(getRequestContext(), examId, snapshotId, studentId);
  }

  @Get("students/:studentId/progress")
  @RequireCapability("academic:read")
  getStudentProgress(
    @Param("examId") examId: string,
    @Param("studentId") studentId: string,
    @Query("scope") scope?: string,
  ): Promise<ReportStudentProgress> {
    return this.reports.getStudentProgress(getRequestContext(), examId, studentId, {
      scope: scope === "all" ? "all" : "exam",
    });
  }

  @Post("generation-jobs")
  @RequireCapability("academic:manage")
  enqueue(
    @Param("examId") examId: string,
    @Body(zodBody(reportGenerationEnqueueBodySchema)) body: EnqueueReportGenerationBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<ReportGenerationQueueResult> {
    return this.reports.enqueueGeneration(getRequestContext(), {
      examId,
      reportType: body.reportType,
      campusId: body.campusId,
      gradeLevelId: body.gradeLevelId,
      classId: body.classId,
      courseId: body.courseId,
      termId: body.termId,
    }, idempotencyKey);
  }

  @Get("generation-jobs/:jobId")
  @RequireCapability("academic:manage")
  getGenerationJobStatus(
    @Param("examId") examId: string,
    @Param("jobId") jobId: string,
  ): Promise<ReportGenerationJobStatus> {
    return this.reports.getGenerationJobStatus(getRequestContext(), examId, jobId);
  }
}
