import { runWithJobContext } from "../context/job-context.js";
import { assertTenantJobPayload, type QueueJob, type TenantJobPayload } from "../queue/queues.js";
import type { BranchScore, OutcomeScore, QuestionScore, ScoringResult } from "./scoring-engine.js";
import {
  computeCohortStatistics,
  type CohortStatistics,
  type ScopeRank,
  type StudentStatistics,
} from "./psychometrics.js";

export const examResultSummaryReportType = "EXAM_RESULT_SUMMARY";

export type ReportType = typeof examResultSummaryReportType;

export interface ReportGenerationJobPayload extends TenantJobPayload {
  reportType: ReportType;
}

export interface ReportGenerationJobInput {
  tenantId: string;
  userId: string;
  jobId: string;
  examId: string;
  reportType: ReportType;
  contentHash: string;
}

export interface ExamResultForReport {
  studentId: string;
  classId?: string;
  className?: string;
  resultKey: string;
  answerKeyVersion: string;
  parserConfigVersion: string;
  engineVersion: string;
  score: ScoringResult;
  computedAt: string;
}

export interface ReportSnapshotCandidate {
  tenantId: string;
  examId: string;
  reportType: ReportType;
  status: "READY";
  inputRefs: {
    resultKeys: string[];
    answerKeyVersions: string[];
    parserConfigVersions: string[];
    engineVersions: string[];
  };
  snapshotData: {
    reportType: ReportType;
    generatedAt: string;
    resultCount: number;
    averages: ScoreAverages;
    branches: BranchAverages[];
    outcomes?: OutcomeAverages[];
    classes: ClassAverages[];
    statistics: CohortStatisticsSummary;
    students: StudentReportSummary[];
  };
  generatedAt: string;
}

export interface ReportGenerationJobResult extends ReportSnapshotCandidate {
  id: string;
}

export interface ReportGenerationJobAdapter {
  loadResults(input: ReportGenerationJobInput): Promise<ExamResultForReport[]>;
  saveSnapshot(snapshot: ReportSnapshotCandidate): Promise<ReportGenerationJobResult>;
}

interface ScoreAverages {
  correct: number;
  wrong: number;
  blank: number;
  net: number;
  rawScore: number;
  standardScore: number;
}

interface BranchAverages {
  branch: string;
  resultCount: number;
  correct: number;
  wrong: number;
  blank: number;
  net: number;
}

interface OutcomeAverages {
  outcomeCode: string;
  branch: string;
  resultCount: number;
  correct: number;
  wrong: number;
  blank: number;
  net: number;
}

interface ClassAverages {
  classId: string | null;
  className: string | null;
  resultCount: number;
  averages: ScoreAverages;
}

interface BranchStatisticsSummary {
  branch: string;
  standardScore: number;
  general: ScopeRank;
  class: ScopeRank | null;
}

interface StudentStatisticsSummary {
  standardScore: number;
  general: ScopeRank;
  class: ScopeRank | null;
  branches: BranchStatisticsSummary[];
}

interface CohortStatisticsSummary {
  count: number;
  total: { meanNet: number; sdNet: number; meanRawScore: number; sdRawScore: number };
  branches: { branch: string; count: number; meanNet: number; sdNet: number }[];
  standardScore: { mean: number; sd: number };
  version: string;
}

interface StudentReportSummary {
  studentId: string;
  classId?: string;
  className?: string;
  resultKey: string;
  total: ScoringResult["total"];
  branches: BranchScore[];
  outcomes?: OutcomeScore[];
  questions: QuestionScore[];
  statistics: StudentStatisticsSummary;
}

export async function processReportGenerationJob(
  job: QueueJob<ReportGenerationJobPayload>,
  adapter: ReportGenerationJobAdapter,
  now: () => string = () => new Date().toISOString(),
): Promise<ReportGenerationJobResult> {
  if (job.name !== "report-generation") {
    throw new Error("REPORT_GENERATION_JOB_NAME_INVALID");
  }
  assertTenantJobPayload(job.payload);
  assertReportGenerationPayload(job.payload);

  return runWithJobContext(
    {
      tenantId: job.payload.tenantId,
      userId: job.payload.userId,
      jobId: job.id,
    },
    async () => {
      const input: ReportGenerationJobInput = {
        tenantId: job.payload.tenantId,
        userId: job.payload.userId,
        jobId: job.id,
        examId: job.payload.entityId,
        reportType: job.payload.reportType,
        contentHash: job.payload.contentHash,
      };
      const results = await adapter.loadResults(input);
      const snapshot = createExamResultSummarySnapshot(input, results, now());
      return adapter.saveSnapshot(snapshot);
    },
  );
}

export function createExamResultSummarySnapshot(
  input: Pick<ReportGenerationJobInput, "tenantId" | "examId" | "reportType">,
  results: ExamResultForReport[],
  generatedAt: string,
): ReportSnapshotCandidate {
  if (input.reportType !== examResultSummaryReportType) {
    throw new Error("REPORT_TYPE_INVALID");
  }
  if (results.length === 0) {
    throw new Error("REPORT_INPUT_EMPTY");
  }

  const sortedResults = [...results].sort((a, b) => a.studentId.localeCompare(b.studentId));
  const outcomeAverages = createOutcomeAverages(results);
  const cohortStatistics = computeCohortStatistics(
    sortedResults.map((result) => ({
      studentId: result.studentId,
      classId: result.classId ?? null,
      net: result.score.total.net,
      rawScore: result.score.total.rawScore,
      branches: result.score.branches.map((branch) => ({ branch: branch.branch, net: branch.net })),
    })),
  );
  const statisticsByStudent = new Map(cohortStatistics.students.map((student) => [student.studentId, student]));
  return {
    tenantId: input.tenantId,
    examId: input.examId,
    reportType: input.reportType,
    status: "READY",
    inputRefs: {
      resultKeys: uniqueSorted(results.map((result) => result.resultKey)),
      answerKeyVersions: uniqueSorted(results.map((result) => result.answerKeyVersion)),
      parserConfigVersions: uniqueSorted(results.map((result) => result.parserConfigVersion)),
      engineVersions: uniqueSorted(results.map((result) => result.engineVersion)),
    },
    snapshotData: {
      reportType: input.reportType,
      generatedAt,
      resultCount: results.length,
      averages: createTotalAverages(results),
      branches: createBranchAverages(results),
      ...(outcomeAverages.length > 0 ? { outcomes: outcomeAverages } : {}),
      classes: createClassAverages(results),
      statistics: toCohortStatisticsSummary(cohortStatistics),
      students: sortedResults.map((result) => createStudentSummary(result, statisticsByStudent)),
    },
    generatedAt,
  };
}

function assertReportGenerationPayload(payload: ReportGenerationJobPayload): void {
  if (payload.reportType !== examResultSummaryReportType) {
    throw new Error("REPORT_GENERATION_PAYLOAD_INVALID");
  }
}

function createTotalAverages(results: ExamResultForReport[]): ScoreAverages {
  return {
    correct: average(results.map((result) => result.score.total.correct)),
    wrong: average(results.map((result) => result.score.total.wrong)),
    blank: average(results.map((result) => result.score.total.blank)),
    net: average(results.map((result) => result.score.total.net)),
    rawScore: average(results.map((result) => result.score.total.rawScore)),
    standardScore: average(results.map((result) => result.score.total.standardScore)),
  };
}

function createBranchAverages(results: ExamResultForReport[]): BranchAverages[] {
  const branchMap = new Map<string, BranchScore[]>();
  for (const result of results) {
    for (const branch of result.score.branches) {
      const scores = branchMap.get(branch.branch) ?? [];
      scores.push(branch);
      branchMap.set(branch.branch, scores);
    }
  }

  return [...branchMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([branch, scores]) => ({
      branch,
      resultCount: scores.length,
      correct: average(scores.map((score) => score.correct)),
      wrong: average(scores.map((score) => score.wrong)),
      blank: average(scores.map((score) => score.blank)),
      net: average(scores.map((score) => score.net)),
    }));
}

function createOutcomeAverages(results: ExamResultForReport[]): OutcomeAverages[] {
  const outcomeMap = new Map<string, OutcomeScore[]>();
  for (const result of results) {
    for (const outcome of result.score.outcomes ?? []) {
      const scores = outcomeMap.get(outcome.outcomeCode) ?? [];
      scores.push(outcome);
      outcomeMap.set(outcome.outcomeCode, scores);
    }
  }

  return [...outcomeMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([outcomeCode, scores]) => {
      const first = scores[0];
      return {
        outcomeCode,
        branch: first?.branch ?? "",
        resultCount: scores.length,
        correct: average(scores.map((score) => score.correct)),
        wrong: average(scores.map((score) => score.wrong)),
        blank: average(scores.map((score) => score.blank)),
        net: average(scores.map((score) => score.net)),
      };
    });
}

function createStudentSummary(
  result: ExamResultForReport,
  statisticsByStudent: Map<string, StudentStatistics>,
): StudentReportSummary {
  const outcomes = result.score.outcomes ?? [];
  const statistics = statisticsByStudent.get(result.studentId);
  if (!statistics) {
    throw new Error("REPORT_STATISTICS_MISSING");
  }
  return {
    studentId: result.studentId,
    classId: result.classId,
    className: result.className,
    resultKey: result.resultKey,
    total: result.score.total,
    branches: result.score.branches,
    ...(outcomes.length > 0 ? { outcomes } : {}),
    questions: result.score.questions ?? [],
    statistics: toStudentStatisticsSummary(statistics),
  };
}

function toStudentStatisticsSummary(statistics: StudentStatistics): StudentStatisticsSummary {
  return {
    standardScore: statistics.total.standardScore,
    general: statistics.total.general,
    class: statistics.total.class,
    branches: statistics.branches.map((branch) => ({
      branch: branch.branch,
      standardScore: branch.standardScore,
      general: branch.general,
      class: branch.class,
    })),
  };
}

function toCohortStatisticsSummary(statistics: CohortStatistics): CohortStatisticsSummary {
  return {
    count: statistics.count,
    total: statistics.total,
    branches: statistics.branches,
    standardScore: statistics._meta.standardScore,
    version: statistics._meta.psychometricsVersion,
  };
}

function createClassAverages(results: ExamResultForReport[]): ClassAverages[] {
  const classMap = new Map<string, ExamResultForReport[]>();
  for (const result of results) {
    const key = result.classId ?? "";
    const current = classMap.get(key) ?? [];
    current.push(result);
    classMap.set(key, current);
  }

  return [...classMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, classResults]) => {
      const first = classResults[0];
      return {
        classId: first?.classId ?? null,
        className: first?.className ?? null,
        resultCount: classResults.length,
        averages: createTotalAverages(classResults),
      };
    });
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function average(values: number): number;
function average(values: number[]): number;
function average(values: number | number[]): number {
  const list = Array.isArray(values) ? values : [values];
  const total = list.reduce((sum, value) => sum + value, 0);
  return Number((total / list.length).toFixed(4));
}
