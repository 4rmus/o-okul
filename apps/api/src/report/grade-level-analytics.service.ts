import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type {
  GradeLevelAnalytics,
  GradeLevelAnalyticsExamRef,
  GradeLevelAnalyticsPoint,
  GradeLevelAnalyticsSeries,
} from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { requireTenantWideStaffContext } from "../tenant/tenant-access.js";
import {
  type GradeLevelAnalyticsExamRow,
  type GradeLevelAnalyticsProjection,
  reportSnapshotStoreToken,
  type ReportSnapshotStore,
} from "./report-snapshot-store.js";

export interface GradeLevelAnalyticsQuery {
  gradeLevelId?: string;
  examType?: string;
  termId?: string;
}

/**
 * DEC-20261102-08 (G3) level analytics. Reads only level snapshots (gradeLevelId = L, no campus, class or course
 * filter) that are READY and belong to a PUBLISHED exam; a STALE level snapshot is listed as needing a refresh and is
 * never plotted. There is no fallback to unfiltered snapshots and no recomputation: Başarı %, Net and Soru are the
 * averages stored in the snapshot. Only tenant-wide staff may read it; a campus-restricted context gets 403.
 */
@Injectable()
export class GradeLevelAnalyticsService {
  constructor(
    @Inject(reportSnapshotStoreToken)
    private readonly snapshots: ReportSnapshotStore,
  ) {}

  async getGradeLevelAnalytics(context: RequestContext, query: GradeLevelAnalyticsQuery): Promise<GradeLevelAnalytics> {
    const tenantId = requireTenantWideReportContext(context);
    const gradeLevelId = optionalText(query.gradeLevelId);
    if (!gradeLevelId) {
      throw new BadRequestException("REPORT_GRADE_LEVEL_REQUIRED");
    }
    const examType = optionalText(query.examType);
    const termId = optionalText(query.termId);
    const projection: GradeLevelAnalyticsProjection = this.snapshots.listGradeLevelAnalytics
      ? await this.snapshots.listGradeLevelAnalytics(tenantId, {
        gradeLevelId,
        ...(examType ? { examType } : {}),
        ...(termId ? { termId } : {}),
      })
      : { snapshots: [], examsWithoutLevelReport: [] };

    return buildGradeLevelAnalytics({ tenantId, gradeLevelId, examType, termId }, projection);
  }
}

export function buildGradeLevelAnalytics(
  scope: { tenantId: string; gradeLevelId: string; examType?: string; termId?: string },
  projection: GradeLevelAnalyticsProjection,
): GradeLevelAnalytics {
  const seriesByType = new Map<string, GradeLevelAnalyticsSeries>();
  const needsRefresh: GradeLevelAnalytics["needsRefresh"] = [];

  for (const row of projection.snapshots) {
    const exam = toExamRef(row);
    if (row.status === "STALE") {
      needsRefresh.push({ ...exam, snapshotId: row.snapshotId, ...(row.staleAt ? { staleAt: row.staleAt } : {}) });
      continue;
    }
    // A READY level snapshot without results carries zero averages; plotting it would read as 0 % success.
    if (!row.resultCount || row.resultCount <= 0) continue;
    const point: GradeLevelAnalyticsPoint = {
      ...exam,
      snapshotId: row.snapshotId,
      ...(row.generatedAt ? { generatedAt: row.generatedAt } : {}),
      participantCount: row.resultCount,
      ...(row.successRate !== undefined ? { successRate: row.successRate } : {}),
      ...(row.net !== undefined ? { net: row.net } : {}),
      ...(row.questionCount !== undefined ? { questionCount: row.questionCount } : {}),
    };
    const key = row.examType ?? "";
    const series = seriesByType.get(key) ?? { ...(row.examType ? { examType: row.examType } : {}), points: [] };
    series.points.push(point);
    seriesByType.set(key, series);
  }

  return {
    tenantId: scope.tenantId,
    gradeLevelId: scope.gradeLevelId,
    ...(scope.examType ? { examType: scope.examType } : {}),
    ...(scope.termId ? { termId: scope.termId } : {}),
    series: [...seriesByType.values()].sort(compareSeries),
    needsRefresh,
    withoutLevelReport: projection.examsWithoutLevelReport.map(toExamRef),
  };
}

function requireTenantWideReportContext(context: RequestContext): string {
  try {
    return requireTenantWideStaffContext(context, "REPORT_CAMPUS_SCOPE_FORBIDDEN");
  } catch (error) {
    throw new ForbiddenException(error instanceof Error ? error.message : "REPORT_CAMPUS_SCOPE_FORBIDDEN");
  }
}

function toExamRef(row: GradeLevelAnalyticsExamRow): GradeLevelAnalyticsExamRef {
  return {
    examId: row.examId,
    examTitle: row.examTitle,
    ...(row.examType ? { examType: row.examType } : {}),
    ...(row.examStartsAt ? { startsAt: row.examStartsAt } : {}),
  };
}

/** Typed series in a stable order; exams without a type come last. */
function compareSeries(left: GradeLevelAnalyticsSeries, right: GradeLevelAnalyticsSeries): number {
  if (!left.examType) return right.examType ? 1 : 0;
  if (!right.examType) return -1;
  return left.examType < right.examType ? -1 : left.examType > right.examType ? 1 : 0;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
