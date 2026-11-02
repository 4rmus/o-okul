import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  istanbulDate,
  type ClassOverview,
  type ClassOverviewAssessmentStatus,
  type ClassOverviewRollCallState,
} from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { isCampusInScope, resolveCampusRestriction } from "../tenant/tenant-access.js";
import {
  type ClassOverviewAssessmentSource,
  type ClassOverviewSource,
  type ClassOverviewStore,
  classOverviewStoreToken,
} from "./class-overview.store.js";

/**
 * DEC-20261102-04 Class 360. The route carries academic:manage; this service adds tenant and campus scope. A class of
 * another tenant, outside the viewer's campuses, soft-deleted, or asked for by an OPERATIONS_STAFF context without a
 * campus scope is reported as missing, never as forbidden, so existence does not leak.
 */
@Injectable()
export class ClassOverviewService {
  constructor(@Inject(classOverviewStoreToken) private readonly store: ClassOverviewStore) {}

  async get(context: RequestContext, classId: string, now = new Date()): Promise<ClassOverview> {
    if (!context.tenantId || context.bypassRls) throw new ForbiddenException("TENANT_CONTEXT_REQUIRED");
    const tenantId = context.tenantId;
    let restriction: ReadonlySet<string> | undefined;
    try {
      restriction = resolveCampusRestriction(context);
    } catch {
      throw new NotFoundException("CLASS_NOT_FOUND");
    }
    const klass = await this.store.findLiveClass(tenantId, classId);
    if (!klass || !isCampusInScope(restriction, klass.campusId)) throw new NotFoundException("CLASS_NOT_FOUND");
    const date = istanbulDate(now);
    const source = await this.store.loadSource(tenantId, klass.id, date);
    return buildClassOverview(klass.id, date, now, source);
  }
}

export function buildClassOverview(classId: string, date: string, now: Date, source: ClassOverviewSource): ClassOverview {
  const assessments = source.assessments.map((assessment) => toAssessmentStatus(assessment, source.rosterCount));
  return {
    classId,
    date,
    generatedAt: now.toISOString(),
    rosterCount: source.rosterCount,
    ...(source.lessonCount > 0
      ? {
          rollCall: {
            state: rollCallState(source.markedCount, source.rosterCount),
            lessonCount: source.lessonCount,
            markedCount: source.markedCount,
          },
        }
      : {}),
    homework: {
      openCount: source.openHomeworkCount,
      waitingSubmissionCount: source.waitingSubmissionCount,
    },
    gradeEntry: summarize(assessments),
    teacherAssignments: source.assignments.map((assignment) => {
      // GradebookService.assertCanAuthor: an assignment without a course or term covers every course or term.
      const authored = assessments.filter((assessment) =>
        (!assignment.courseId || assignment.courseId === assessment.courseId) &&
        (!assignment.termId || assignment.termId === assessment.termId));
      const summary = summarize(authored);
      return {
        assignmentId: assignment.id,
        teacherId: assignment.teacherId,
        teacherName: assignment.teacherName,
        role: assignment.role,
        ...(assignment.courseId ? { courseId: assignment.courseId } : {}),
        ...(assignment.courseName ? { courseName: assignment.courseName } : {}),
        ...(assignment.termId ? { termId: assignment.termId } : {}),
        assessmentCount: summary.assessmentCount,
        missingEntryAssessmentCount: summary.missingEntryAssessmentCount,
        unpublishedDraftAssessmentCount: summary.unpublishedDraftAssessmentCount,
        assessments: authored,
      };
    }),
  };
}

function toAssessmentStatus(assessment: ClassOverviewAssessmentSource, rosterCount: number): ClassOverviewAssessmentStatus {
  // Counts and the published version only: draft scores and averages never leave the store (ADR-0011).
  return {
    assessmentId: assessment.id,
    title: assessment.title,
    kind: assessment.kind,
    heldOn: assessment.heldOn,
    courseId: assessment.courseId,
    ...(assessment.courseName ? { courseName: assessment.courseName } : {}),
    termId: assessment.termId,
    enteredCount: assessment.enteredCount,
    rosterCount,
    missingEntries: assessment.enteredCount < rosterCount,
    hasUnpublishedDraft: assessment.hasDraft,
    ...(assessment.publishedVersion !== undefined ? { publishedVersion: assessment.publishedVersion } : {}),
  };
}

function summarize(assessments: readonly ClassOverviewAssessmentStatus[]): ClassOverview["gradeEntry"] {
  return {
    assessmentCount: assessments.length,
    missingEntryAssessmentCount: assessments.filter((assessment) => assessment.missingEntries).length,
    unpublishedDraftAssessmentCount: assessments.filter((assessment) => assessment.hasUnpublishedDraft).length,
  };
}

function rollCallState(markedCount: number, rosterCount: number): ClassOverviewRollCallState {
  if (markedCount >= rosterCount) return "TAKEN";
  return markedCount === 0 ? "NOT_TAKEN" : "PARTIAL";
}
