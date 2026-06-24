import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { ReportErrorBooklet, ReportStudentProgress, ReportStudentSnapshot } from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
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
  contentHash: requiredTrimmedString,
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
  @Roles("TENANT_ADMIN", "TEACHER")
  listSnapshots(@Param("examId") examId: string, @Query() query: ReportSnapshotListQuery): Promise<ReportSnapshotRecord[]> {
    return this.reports.listSnapshots(getRequestContext(), examId, query);
  }

  @Get("students/:studentId/snapshots")
  @Roles("TENANT_ADMIN", "TEACHER")
  listStudentSnapshots(
    @Param("examId") examId: string,
    @Param("studentId") studentId: string,
  ): Promise<ReportSnapshotRecord[]> {
    return this.reports.listStudentSnapshots(getRequestContext(), examId, studentId);
  }

  @Get("snapshots/:snapshotId/export.xlsx")
  @Roles("TENANT_ADMIN", "TEACHER")
  exportSnapshotExcel(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
  ): Promise<ReportSnapshotExportResult> {
    return this.reports.exportSnapshotExcel(getRequestContext(), examId, snapshotId);
  }

  @Get("snapshots/:snapshotId/export.pdf")
  @Roles("TENANT_ADMIN", "TEACHER")
  exportSnapshotPdf(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
  ): Promise<ReportSnapshotPdfResult> {
    return this.reports.exportSnapshotPdf(getRequestContext(), examId, snapshotId);
  }

  @Get("snapshots/:snapshotId/students/:studentId")
  @Roles("TENANT_ADMIN", "TEACHER")
  getStudentReport(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
    @Param("studentId") studentId: string,
  ): Promise<ReportStudentSnapshot> {
    return this.reports.getStudentReport(getRequestContext(), examId, snapshotId, studentId);
  }

  @Get("snapshots/:snapshotId/students/:studentId/error-booklet")
  @Roles("TENANT_ADMIN", "TEACHER")
  getStudentErrorBooklet(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
    @Param("studentId") studentId: string,
  ): Promise<ReportErrorBooklet> {
    return this.reports.getStudentErrorBooklet(getRequestContext(), examId, snapshotId, studentId);
  }

  @Get("students/:studentId/progress")
  @Roles("TENANT_ADMIN", "TEACHER")
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
      contentHash: body.contentHash,
      campusId: body.campusId,
      gradeLevelId: body.gradeLevelId,
      classId: body.classId,
      courseId: body.courseId,
      termId: body.termId,
    }, idempotencyKey);
  }
}
