import type { AttendanceRecord, ReportStudentBranchSummary, ReportStudentProgress, ReportStudentProgressPoint, StudentOverviewLatestExamRecord } from "@o-okul/shared-types";
import { reportQuestionCount } from "../../_shared/report-metrics.js";
import { buildAttendanceCalendarMonth, monthKeyOf, shiftMonth } from "../../portals/_shared/attendance-calendar-model.js";

export interface StudentNetPoint {
  snapshotId: string;
  examId?: string;
  title: string;
  date: string;
  dateIsExam: boolean;
  net: number;
  questionCount: number;
}

export interface StudentNetOverview {
  hasLatestReport: boolean;
  net?: number;
  questionCount?: number;
  branches: ReportStudentBranchSummary[];
  points: StudentNetPoint[];
  previousDelta?: number;
  seriesDelta?: number;
}

export function buildStudentNetOverview(
  latest: StudentOverviewLatestExamRecord | undefined,
  progress: ReportStudentProgress | null | undefined,
): StudentNetOverview {
  const net = finiteNumber(latest?.total.net);
  const questionCount = reportQuestionCount(latest?.total);
  const current = latest && progress?.points.find((point) => point.snapshotId === latest.snapshotId
    && (!point.examId || point.examId === latest.examId));
  const result: StudentNetOverview = { hasLatestReport: Boolean(latest), net, questionCount, branches: current?.branches ?? [], points: [] };
  if (!current || net === undefined || !questionCount || questionCount <= 0
    || finiteNumber(current.total.net) !== net || reportQuestionCount(current.total) !== questionCount) return result;

  // The selected snapshot may be older than the last exam in the history (for example after a backfill).
  const ordered = [...(progress?.points ?? [])]
    .filter((point) => Number.isFinite(pointTime(point)) && finiteNumber(point.total.net) !== undefined)
    .sort((left, right) => pointTime(left) - pointTime(right) || left.snapshotId.localeCompare(right.snapshotId));
  const currentIndex = ordered.findIndex((point) => point.snapshotId === current.snapshotId);
  if (currentIndex < 0) return result;
  const points = ordered.slice(0, currentIndex + 1)
    .filter((point) => point.snapshotId === current.snapshotId
      || pointTime(point) < pointTime(current) && comparableNetScope(current, point))
    .slice(-4)
    .map((point) => ({
      snapshotId: point.snapshotId,
      examId: point.examId,
      title: point.examTitle ?? "Sınav",
      date: point.examStartsAt ?? point.generatedAt!,
      dateIsExam: Boolean(point.examStartsAt),
      net: point.total.net!,
      questionCount: reportQuestionCount(point.total)!,
    }));
  const previous = points.at(-2);
  const first = points[0];
  return {
    ...result,
    points,
    ...(previous ? { previousDelta: roundNet(net - previous.net) } : {}),
    ...(previous && first ? { seriesDelta: roundNet(net - first.net) } : {}),
  };
}

function comparableNetScope(current: ReportStudentProgressPoint, candidate: ReportStudentProgressPoint) {
  if (!current.examStartsAt || !candidate.examStartsAt || !current.examType || !current.scoringProfileId || !current.examYear
    || candidate.examType !== current.examType || candidate.scoringProfileId !== current.scoringProfileId
    || candidate.examYear !== current.examYear || candidate.courseId !== current.courseId
    || candidate.termId !== current.termId || reportQuestionCount(candidate.total) !== reportQuestionCount(current.total)) return false;
  // Class ids are not a level guarantee: a class can move to a different grade without changing its id.
  if (!current.gradeLevelId || candidate.gradeLevelId !== current.gradeLevelId) return false;
  const currentBranches = questionDistribution(current);
  return currentBranches !== undefined && currentBranches === questionDistribution(candidate);
}

function questionDistribution(point: ReportStudentProgressPoint): string | undefined {
  if (!point.branches?.length) return undefined;
  const rows = point.branches.map((branch) => ({
    name: branch.branch.trim().toLocaleUpperCase("tr-TR"),
    questions: reportQuestionCount(branch),
  }));
  if (rows.some((row) => !row.name || row.questions === undefined || row.questions < 0)
    || new Set(rows.map((row) => row.name)).size !== rows.length
    || rows.reduce((total, row) => total + row.questions!, 0) !== reportQuestionCount(point.total)) return undefined;
  return JSON.stringify(rows.sort((left, right) => left.name.localeCompare(right.name)));
}

function pointTime(point: ReportStudentProgressPoint) {
  return Date.parse(point.examStartsAt ?? point.generatedAt ?? "");
}

function finiteNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function roundNet(value: number) {
  return Number(value.toFixed(4));
}

export function studentNetDomain(points: readonly StudentNetPoint[]) {
  if (points.length === 0) return { low: 0, high: 10 };
  const low = Math.floor(Math.min(...points.map((point) => point.net)) / 10) * 10;
  const high = Math.max(low + 10, Math.ceil(Math.max(...points.map((point) => point.net)) / 10) * 10);
  return { low, high };
}

export function buildAttendanceStripDays(records: readonly AttendanceRecord[], from: string, to: string) {
  const days = [];
  for (let month = monthKeyOf(from); month <= monthKeyOf(to); month = shiftMonth(month, 1)) {
    const calendar = buildAttendanceCalendarMonth(records, month);
    for (const day of calendar.weeks.flat()) {
      if (day && day.dateKey >= from && day.dateKey <= to) days.push(day);
    }
  }
  return days;
}
