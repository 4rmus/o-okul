import { createHash } from "node:crypto";
import { runWithJobContext } from "../context/job-context.js";
import { assertTenantJobPayload, type QueueJob, type TenantJobPayload } from "../queue/queues.js";
import {
  calculateAytScoreViews,
  type BranchScore,
  type ExamScoreType,
  type ExamScoreView,
  type OutcomeScore,
  type QuestionScore,
  type ScoreSection,
  type ScoringResult,
} from "./scoring-engine.js";

export const examResultSummaryReportType = "EXAM_RESULT_SUMMARY";

export type ReportType = typeof examResultSummaryReportType;

export interface ReportGenerationJobPayload extends TenantJobPayload {
  reportType: ReportType;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
}

export interface ReportGenerationJobInput {
  tenantId: string;
  userId: string;
  jobId: string;
  examId: string;
  reportType: ReportType;
  contentHash: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
}

export interface ExamResultForReport {
  examId: string;
  examTitle?: string;
  examStartsAt?: string;
  studentId: string;
  displayName?: string;
  studentNo?: string;
  participantNo?: string;
  bookletType?: string;
  classId?: string;
  className?: string;
  resultKey: string;
  answerKeyVersion: string;
  parserConfigVersion: string;
  engineVersion: string;
  score: ScoringResult;
  computedAt: string;
  linkedTytResult?: {
    examId: string;
    resultKey: string;
    answerKeyVersion: string;
    parserConfigVersion: string;
    engineVersion: string;
    score: ScoringResult;
    computedAt: string;
  };
}

export interface ReportSnapshotCandidate {
  tenantId: string;
  examId: string;
  contentHash: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  reportType: ReportType;
  status: "READY";
  inputRefs: {
    resultKeys: string[];
    answerKeyVersions: string[];
    parserConfigVersions: string[];
    engineVersions: string[];
    scoringProfileIds?: string[];
    linkedTytExamIds?: string[];
    generationContentHash?: string;
  };
  snapshotData: {
    schemaVersion?: 2;
    examType?: string;
    examYear?: number;
    scoringProfileId?: string;
    examTitle?: string;
    examStartsAt?: string;
    officialComparable?: false;
    scoringAssumptions?: {
      standardDeviationUsed: false;
      cancelledQuestionsExcludedFromScoringDenominator: true;
      lgsAvailableSectionWeightsRenormalized: boolean;
    };
    reportType: ReportType;
    generatedAt: string;
    resultCount: number;
    averages: ScoreAverages;
    scoreAverages?: Array<{ type: ExamScoreType; calculatedCount: number; practiceScore: number }>;
    branches: BranchAverages[];
    outcomes?: OutcomeAverages[];
    classes: ClassAverages[];
    statistics?: Record<string, unknown>;
    students: StudentReportSummary[];
  };
  generatedAt: string;
}

export interface ReportGenerationJobResult extends Omit<ReportSnapshotCandidate, "status"> {
  id: string;
  status: "READY" | "STALE";
}

export interface ReportGenerationJobAdapter {
  loadResults(input: ReportGenerationJobInput): Promise<ExamResultForReport[]>;
  saveSnapshot(snapshot: ReportSnapshotCandidate): Promise<ReportGenerationJobResult>;
}

interface ScoreMetrics {
  questionCount: number;
  successRate: number;
}

interface ScoreAverages extends ScoreMetrics {
  correct: number;
  wrong: number;
  blank: number;
  net: number;
  rawScore: number;
  standardScore?: number;
  estimatedRawScore?: number;
}

interface BranchAverages extends ScoreMetrics {
  branch: string;
  resultCount: number;
  correct: number;
  wrong: number;
  blank: number;
  net: number;
}

interface OutcomeAverages extends ScoreMetrics {
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
  branches: BranchAverages[];
}

type StudentScoreSummary = ScoreMetrics & {
  correct?: number;
  wrong?: number;
  blank?: number;
  net?: number;
  rawScore: number;
  standardScore?: number;
  estimatedRawScore?: number;
};
type StudentBranchSummary = BranchScore & ScoreMetrics;
type StudentOutcomeSummary = OutcomeScore & ScoreMetrics;

interface StudentReportSummary {
  studentId: string;
  displayName?: string;
  studentNo?: string;
  participantNo?: string;
  bookletType?: string;
  classId?: string;
  className?: string;
  resultKey: string;
  total: StudentScoreSummary;
  branches: StudentBranchSummary[];
  outcomes?: StudentOutcomeSummary[];
  questions: QuestionScore[];
  scoreViews?: ExamScoreView[];
  scoreRankings?: Array<{
    type: ExamScoreType;
    institution: { rank: number; outOf: number };
    class?: { rank: number; outOf: number };
  }>;
  statistics?: Record<string, unknown>;
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
        campusId: job.payload.campusId,
        gradeLevelId: job.payload.gradeLevelId,
        classId: job.payload.classId,
        courseId: job.payload.courseId,
        termId: job.payload.termId,
      };
      const results = await adapter.loadResults(input);
      const snapshot = createExamResultSummarySnapshot(input, results, now());
      return adapter.saveSnapshot(snapshot);
    },
  );
}

export function createExamResultSummarySnapshot(
  input: Pick<ReportGenerationJobInput, "tenantId" | "examId" | "reportType" | "contentHash" | "campusId" | "classId" | "courseId" | "gradeLevelId" | "termId">,
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
  const firstResult = sortedResults[0]!;
  const examType = firstResult.score._meta.examType;
  const examYear = firstResult.score._meta.examYear;
  const scoringProfileId = firstResult.score._meta.scoringProfileId;
  const examTitle = optionalText(firstResult.examTitle);
  const examStartsAt = optionalText(firstResult.examStartsAt);
  const outcomeAverages = createOutcomeAverages(results);
  const scoreViewsByStudent = new Map(sortedResults.map((result) => [result.studentId, resolveScoreViews(result)]));
  const scoreRankingsByStudent = createScoreRankings(sortedResults, scoreViewsByStudent);
  const scoreAverages = createScoreAverages(scoreViewsByStudent);
  const averages = createTotalAverages(results);
  const branches = createBranchAverages(results);
  const classes = createClassAverages(results);
  const students = sortedResults.map((result) => createStudentSummary(
    result,
    scoreViewsByStudent.get(result.studentId) ?? [],
    scoreRankingsByStudent.get(result.studentId) ?? [],
  ));
  const linkedResults = results.flatMap((result) => result.linkedTytResult ? [result.linkedTytResult] : []);
  const sourceRefs = {
    resultKeys: uniqueSorted([
      ...results.map((result) => result.resultKey),
      ...linkedResults.map((result) => result.resultKey),
    ]),
    answerKeyVersions: uniqueSorted([
      ...results.map((result) => result.answerKeyVersion),
      ...linkedResults.map((result) => result.answerKeyVersion),
    ]),
    parserConfigVersions: uniqueSorted([
      ...results.map((result) => result.parserConfigVersion),
      ...linkedResults.map((result) => result.parserConfigVersion),
    ]),
    engineVersions: uniqueSorted([
      ...results.map((result) => result.engineVersion),
      ...linkedResults.map((result) => result.engineVersion),
    ]),
    scoringProfileIds: uniqueSorted(results
      .flatMap((result) => result.score._meta.scoringProfileId ? [result.score._meta.scoringProfileId] : [])),
    linkedTytExamIds: uniqueSorted(linkedResults.map((result) => result.examId)),
  };
  const identityFingerprint = createReportIdentityFingerprint(sortedResults);

  return {
    tenantId: input.tenantId,
    examId: input.examId,
    contentHash: createReportSnapshotContentHash(input.contentHash, sourceRefs, identityFingerprint),
    ...resolveReportContext(input),
    reportType: input.reportType,
    status: "READY",
    inputRefs: {
      ...sourceRefs,
      generationContentHash: input.contentHash,
    },
    snapshotData: {
      schemaVersion: 2,
      ...(examType ? { examType } : {}),
      ...(examYear !== undefined ? { examYear } : {}),
      ...(scoringProfileId ? { scoringProfileId } : {}),
      ...(examTitle ? { examTitle } : {}),
      ...(examStartsAt ? { examStartsAt } : {}),
      officialComparable: false,
      scoringAssumptions: {
        standardDeviationUsed: false,
        cancelledQuestionsExcludedFromScoringDenominator: true,
        lgsAvailableSectionWeightsRenormalized: examType === "LGS",
      },
      reportType: input.reportType,
      generatedAt,
      resultCount: results.length,
      averages,
      ...(scoreAverages.length > 0 ? { scoreAverages } : {}),
      branches,
      ...(outcomeAverages.length > 0 ? { outcomes: outcomeAverages } : {}),
      classes,
      students,
    },
    generatedAt,
  };
}

export function createReportSnapshotContentHash(
  requestHash: string,
  inputRefs: Omit<ReportSnapshotCandidate["inputRefs"], "generationContentHash">,
  identityFingerprint?: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ requestHash, inputRefs, identityFingerprint: identityFingerprint ?? null }))
    .digest("hex");
}

export function createReportIdentityFingerprint(results: ExamResultForReport[]): string {
  return createHash("sha256")
    .update(JSON.stringify([...results]
      .sort((left, right) => left.studentId.localeCompare(right.studentId))
      .map((result) => ({
        studentId: result.studentId,
        examTitle: normalizeDisplayName(result.examTitle),
        examStartsAt: optionalText(result.examStartsAt) ?? null,
        displayName: normalizeDisplayName(result.displayName),
        studentNo: normalizeStudentNo(result.studentNo),
        participantNo: normalizeStudentNo(result.participantNo),
        bookletType: normalizeStudentNo(result.bookletType),
      }))))
    .digest("hex");
}

function normalizeDisplayName(value: string | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
  return normalized || null;
}

function normalizeStudentNo(value: string | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
  return normalized || null;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolveReportContext(input: Partial<Pick<ReportGenerationJobInput, "campusId" | "classId" | "courseId" | "gradeLevelId" | "termId">>) {
  return {
    campusId: optionalText(input.campusId),
    gradeLevelId: optionalText(input.gradeLevelId),
    classId: optionalText(input.classId),
    courseId: optionalText(input.courseId),
    termId: optionalText(input.termId),
  };
}

function assertReportGenerationPayload(payload: ReportGenerationJobPayload): void {
  if (payload.reportType !== examResultSummaryReportType) {
    throw new Error("REPORT_GENERATION_PAYLOAD_INVALID");
  }
}

function createTotalAverages(results: ExamResultForReport[]): ScoreAverages {
  const totals = results.map((result) => result.score.total);
  return {
    correct: average(totals.map((score) => score.correct)),
    wrong: average(totals.map((score) => score.wrong)),
    blank: average(totals.map((score) => score.blank)),
    net: average(totals.map((score) => score.net)),
    questionCount: average(totals.map(scoreQuestionCount)),
    rawScore: average(totals.map((score) => score.rawScore)),
    successRate: average(totals.map(scoreSuccessRate)),
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
      questionCount: average(scores.map(scoreQuestionCount)),
      successRate: average(scores.map(scoreSuccessRate)),
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
        questionCount: average(scores.map(scoreQuestionCount)),
        successRate: average(scores.map(scoreSuccessRate)),
      };
    });
}

function createStudentSummary(
  result: ExamResultForReport,
  scoreViews: ExamScoreView[],
  scoreRankings: StudentReportSummary["scoreRankings"],
): StudentReportSummary {
  const outcomes = result.score.outcomes ?? [];
  return {
    studentId: result.studentId,
    ...(result.displayName ? { displayName: result.displayName } : {}),
    ...(result.studentNo ? { studentNo: result.studentNo } : {}),
    ...(result.participantNo ? { participantNo: result.participantNo } : {}),
    ...(result.bookletType ? { bookletType: result.bookletType } : {}),
    classId: result.classId,
    className: result.className,
    resultKey: result.resultKey,
    total: withScoreMetrics(result.score.total),
    branches: result.score.branches.map(withScoreMetrics),
    ...(outcomes.length > 0 ? { outcomes: outcomes.map(withScoreMetrics) } : {}),
    questions: result.score.questions ?? [],
    ...(scoreViews.length > 0 ? { scoreViews } : {}),
    ...(scoreRankings?.length ? { scoreRankings } : {}),
  };
}

function createScoreAverages(scoreViewsByStudent: Map<string, ExamScoreView[]>) {
  const averages: Array<{ type: ExamScoreType; calculatedCount: number; practiceScore: number }> = [];
  for (const type of ["LGS", "TYT", "SAY", "EA", "SOZ"] as const) {
    const scores = [...scoreViewsByStudent.values()].flatMap((views) => {
      const view = views.find((candidate) => candidate.type === type);
      return view?.status === "CALCULATED" && view.practiceScore !== undefined ? [view.practiceScore] : [];
    });
    if (scores.length > 0) {
      averages.push({ type, calculatedCount: scores.length, practiceScore: average(scores) });
    }
  }
  return averages;
}

function resolveScoreViews(result: ExamResultForReport): ExamScoreView[] {
  if (result.score._meta.examType !== "AYT" || !result.linkedTytResult) {
    return result.score.scoreViews ?? [];
  }
  const linkedTyt = result.linkedTytResult.score.scoreViews?.find((view) => view.type === "TYT");
  return calculateAytScoreViews(createAytSectionMetrics(result.score.questions), linkedTyt);
}

function createScoreRankings(
  results: ExamResultForReport[],
  scoreViewsByStudent: Map<string, ExamScoreView[]>,
): Map<string, NonNullable<StudentReportSummary["scoreRankings"]>> {
  const rankings = new Map<string, NonNullable<StudentReportSummary["scoreRankings"]>>();
  for (const type of ["LGS", "TYT", "SAY", "EA", "SOZ"] as const) {
    const eligible = results.flatMap((result) => {
      const view = scoreViewsByStudent.get(result.studentId)?.find((candidate) => candidate.type === type);
      return view?.status === "CALCULATED" && view.practiceScore !== undefined
        ? [{ result, practiceScore: view.practiceScore }]
        : [];
    });
    const institution = competitionRanks(eligible.map((item) => item.practiceScore));
    const classes = new Map<string, Map<number, { rank: number; outOf: number }>>();
    for (const classId of uniqueSorted(eligible
      .map((item) => item.result.classId)
      .filter((value): value is string => value !== undefined))) {
      classes.set(classId, competitionRanks(eligible
        .filter((item) => item.result.classId === classId)
        .map((item) => item.practiceScore)));
    }
    for (const item of eligible) {
      const current = rankings.get(item.result.studentId) ?? [];
      current.push({
        type,
        institution: institution.get(item.practiceScore)!,
        ...(item.result.classId ? { class: classes.get(item.result.classId)?.get(item.practiceScore) } : {}),
      });
      rankings.set(item.result.studentId, current);
    }
  }
  return rankings;
}

function competitionRanks(values: number[]): Map<number, { rank: number; outOf: number }> {
  const sorted = [...values].sort((left, right) => right - left);
  const ranks = new Map<number, { rank: number; outOf: number }>();
  sorted.forEach((value, index) => {
    if (!ranks.has(value)) ranks.set(value, { rank: index + 1, outOf: sorted.length });
  });
  return ranks;
}

function createAytSectionMetrics(questions: QuestionScore[]) {
  const sections = new Map<ScoreSection, { correct: number; wrong: number; blank: number }>();
  for (const question of questions) {
    if (!question.scoreSection?.startsWith("AYT_") || question.status === "CANCELLED") continue;
    const metrics = sections.get(question.scoreSection) ?? { correct: 0, wrong: 0, blank: 0 };
    if (question.status === "CORRECT") metrics.correct += 1;
    else if (question.status === "WRONG") metrics.wrong += 1;
    else metrics.blank += 1;
    sections.set(question.scoreSection, metrics);
  }
  return [...sections].map(([section, metrics]) => {
    const questionCount = metrics.correct + metrics.wrong + metrics.blank;
    const net = roundMetric(metrics.correct - metrics.wrong / 4);
    return {
      section,
      ...metrics,
      net,
      questionCount,
      successRate: questionCount > 0 ? roundMetric((net / questionCount) * 100) : 0,
    };
  });
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
        branches: createBranchAverages(classResults),
      };
    });
}

function withScoreMetrics<T extends { blank: number; correct: number; net: number; wrong: number }>(
  score: T,
): Omit<T, "estimatedRawScore" | "standardScore"> & ScoreMetrics {
  const {
    estimatedRawScore: _estimatedRawScore,
    standardScore: _standardScore,
    ...current
  } = score as T & { estimatedRawScore?: number; standardScore?: number };
  return {
    ...current,
    questionCount: scoreQuestionCount(score),
    successRate: scoreSuccessRate(score),
  };
}

function scoreQuestionCount(score: { blank: number; correct: number; wrong: number }): number {
  return roundMetric(score.correct + score.wrong + score.blank);
}

function scoreSuccessRate(score: { blank: number; correct: number; net: number; wrong: number }): number {
  const questionCount = scoreQuestionCount(score);
  if (questionCount <= 0) {
    return 0;
  }
  return roundMetric(Math.min(100, Math.max(0, score.net / questionCount)) * 100);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function average(values: number): number;
function average(values: number[]): number;
function average(values: number | number[]): number {
  const list = Array.isArray(values) ? values : [values];
  const total = list.reduce((sum, value) => sum + value, 0);
  return roundMetric(total / list.length);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}
