import type {
  GradeAssessmentCreateRequest,
  GradeAssessmentDetail,
  GradeAssessmentKind,
  GradeAssessmentPublishResult,
  GradeAssessmentRecord,
  GradeEntryDraftInput,
  GradeEntryRecord,
} from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest, withQueryParams } from "../../../../src/api-client.js";

export const gradeKindLabels: Record<GradeAssessmentKind, string> = {
  WRITTEN: "Yazılı",
  PERFORMANCE: "Performans",
  PROJECT: "Proje",
  PARTICIPATION: "Derse katılım",
};

export function listGradeAssessments(accessToken: string, filter: { classId?: string } = {}) {
  return apiRequest<GradeAssessmentRecord[]>(accessToken, withQueryParams(`${apiBaseUrl}/grade-assessments`, filter));
}

export function loadGradeAssessment(accessToken: string, id: string) {
  return apiRequest<GradeAssessmentDetail>(accessToken, `${apiBaseUrl}/grade-assessments/${encodeURIComponent(id)}`);
}

export function createGradeAssessment(accessToken: string, input: GradeAssessmentCreateRequest) {
  return apiRequest<GradeAssessmentRecord>(accessToken, `${apiBaseUrl}/grade-assessments`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export function saveGradeEntries(accessToken: string, id: string, entries: GradeEntryDraftInput[]) {
  return apiRequest<GradeEntryRecord[]>(accessToken, `${apiBaseUrl}/grade-assessments/${encodeURIComponent(id)}/entries`, {
    body: JSON.stringify({ entries }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

export function publishGradeAssessment(accessToken: string, id: string, idempotencyKey: string) {
  return apiRequest<GradeAssessmentPublishResult>(accessToken, `${apiBaseUrl}/grade-assessments/${encodeURIComponent(id)}/publish`, {
    headers: { "Idempotency-Key": idempotencyKey },
    method: "POST",
  });
}

/** Every version of one student's grade, oldest first; the last one is current. */
export function entriesByStudent(entries: readonly GradeEntryRecord[]): Map<string, GradeEntryRecord[]> {
  const byStudent = new Map<string, GradeEntryRecord[]>();
  for (const entry of [...entries].sort((left, right) => left.version - right.version)) {
    byStudent.set(entry.studentId, [...(byStudent.get(entry.studentId) ?? []), entry]);
  }
  return byStudent;
}

export function formatGrade(entry: Pick<GradeEntryRecord, "absent" | "score">): string {
  if (entry.absent) return "Girmedi";
  return entry.score === null ? "-" : entry.score.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}
