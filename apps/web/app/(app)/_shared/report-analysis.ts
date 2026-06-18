import type {
  ClassRecord,
  ExamParticipantRecord,
  ReportScopeRank,
  ReportSnapshotRecord,
  ReportStudentStatistics,
  StudentRecord,
} from "@uzman-hocam/shared-types";
import { reportSuccessRate } from "./report-metrics.js";

type SnapshotStudent = NonNullable<NonNullable<ReportSnapshotRecord["snapshotData"]>["students"]>[number] & {
  statistics?: ReportStudentStatistics;
};

export type ReportAnalysisRowStatus = "READY" | "NO_RESULT" | "ABSENT";

export interface ReportAnalysisRow {
  rowKey: string;
  studentId: string;
  studentName: string;
  studentNo?: string;
  classId?: string;
  className: string;
  participantNo?: string;
  bookletType?: string;
  participationStatus?: string;
  resultStatus: ReportAnalysisRowStatus;
  correct?: number;
  wrong?: number;
  blank?: number;
  questionCount?: number;
  successRate?: number;
  net?: number;
  rawScore?: number;
  standardScore?: number;
  estimatedRawScore?: number;
  generalRank?: ReportScopeRank;
  classRank?: ReportScopeRank;
  percentile?: number;
  hasResult: boolean;
}

export interface BuildReportAnalysisRowsInput {
  classes?: ClassRecord[];
  participants?: ExamParticipantRecord[];
  snapshot?: ReportSnapshotRecord | null;
  students?: StudentRecord[];
}

export function buildReportAnalysisRows({
  classes = [],
  participants = [],
  snapshot,
  students = [],
}: BuildReportAnalysisRowsInput): ReportAnalysisRow[] {
  const classNameById = new Map(classes.map((klass) => [klass.id, klass.name]));
  const snapshotClassNameById = new Map(
    (snapshot?.snapshotData?.classes ?? [])
      .filter((klass) => Boolean(klass.classId))
      .map((klass) => [klass.classId as string, klass.className ?? klass.classId as string]),
  );
  const studentsById = new Map(students.map((student) => [student.id, student]));
  const participantsByStudentId = new Map(participants.map((participant) => [participant.studentId, participant]));
  const snapshotStudents = snapshot?.snapshotData?.students as SnapshotStudent[] | undefined ?? [];
  const snapshotStudentsById = new Map(snapshotStudents.map((student) => [student.studentId, student]));
  const rowStudentIds = uniqueInOrder([
    ...participants.map((participant) => participant.studentId),
    ...snapshotStudents.map((student) => student.studentId),
  ]);

  return rowStudentIds
    .map((studentId) => {
      const student = studentsById.get(studentId);
      const participant = participantsByStudentId.get(studentId);
      const snapshotStudent = snapshotStudentsById.get(studentId);
      const total = snapshotStudent?.total ?? {};
      const classId = snapshotStudent?.classId ?? student?.classId;
      const className =
        snapshotStudent?.className ??
        (classId ? snapshotClassNameById.get(classId) ?? classNameById.get(classId) : undefined) ??
        "-";
      const resultStatus = resolveResultStatus(participant, snapshotStudent);
      const generalRank = snapshotStudent?.statistics?.general;
      const classRank = snapshotStudent?.statistics?.class;

      return {
        rowKey: participant?.id ?? `${snapshot?.id ?? "snapshot"}-${studentId}`,
        studentId,
        studentName: student ? `${student.firstName} ${student.lastName}`.trim() : studentId,
        ...(student?.studentNo ? { studentNo: student.studentNo } : {}),
        ...(classId ? { classId } : {}),
        className,
        ...(participant?.participantNo ? { participantNo: participant.participantNo } : {}),
        ...(participant?.bookletType ? { bookletType: participant.bookletType } : {}),
        ...(participant?.status ? { participationStatus: participant.status } : {}),
        resultStatus,
        correct: total.correct,
        wrong: total.wrong,
        blank: total.blank,
        questionCount: total.questionCount,
        successRate: total.successRate,
        net: total.net,
        rawScore: total.rawScore,
        standardScore: total.standardScore,
        estimatedRawScore: total.estimatedRawScore,
        ...(generalRank ? { generalRank } : {}),
        ...(classRank ? { classRank } : {}),
        ...(generalRank ? { percentile: generalRank.percentile } : {}),
        hasResult: resultStatus === "READY",
      } satisfies ReportAnalysisRow;
    })
    .sort(compareReportAnalysisRows);
}

export function compareReportAnalysisRows(first: ReportAnalysisRow, second: ReportAnalysisRow): number {
  return compareNumber(reportSuccessRate(first), reportSuccessRate(second), "desc") ||
    compareNumber(first.standardScore, second.standardScore, "desc") ||
    compareNumber(first.estimatedRawScore, second.estimatedRawScore, "desc") ||
    compareNumber(first.net, second.net, "desc") ||
    compareNumber(first.generalRank?.rank, second.generalRank?.rank, "asc") ||
    first.studentName.localeCompare(second.studentName, "tr-TR", { sensitivity: "base" }) ||
    first.studentId.localeCompare(second.studentId);
}

function resolveResultStatus(
  participant: ExamParticipantRecord | undefined,
  snapshotStudent: SnapshotStudent | undefined,
): ReportAnalysisRowStatus {
  if (snapshotStudent) return "READY";
  if (participant?.status === "ABSENT") return "ABSENT";
  return "NO_RESULT";
}

function compareNumber(
  first: number | undefined,
  second: number | undefined,
  direction: "asc" | "desc",
): number {
  const firstMissing = first === undefined;
  const secondMissing = second === undefined;
  if (firstMissing && secondMissing) return 0;
  if (firstMissing) return 1;
  if (secondMissing) return -1;
  return direction === "asc" ? first - second : second - first;
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
