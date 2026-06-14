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
export type ReportSummaryProvider = "disabled" | "template" | "anthropic";

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

export interface ReportSummaryOptions {
  provider?: ReportSummaryProvider;
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
    commentary?: ReportSnapshotCommentary;
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
  estimatedRawScore?: number;
  standardScore: number;
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

type StudentScoreSummary = ScoringResult["total"] & ScoreMetrics;
type StudentBranchSummary = BranchScore & ScoreMetrics;
type StudentOutcomeSummary = OutcomeScore & ScoreMetrics;

interface StudentReportSummary {
  studentId: string;
  classId?: string;
  className?: string;
  resultKey: string;
  total: StudentScoreSummary;
  branches: StudentBranchSummary[];
  outcomes?: StudentOutcomeSummary[];
  questions: QuestionScore[];
  statistics: StudentStatisticsSummary;
  commentary?: ReportStudentCommentary;
}

interface ReportSnapshotCommentary {
  provider: "template";
  generatedAt: string;
  parentSummary: string;
  teacherActionDrafts: string[];
  reviewStatus: "DRAFT";
  disclaimer: string;
  dataPolicy: {
    piiIncluded: false;
    fieldsUsed: string[];
    fieldsExcluded: string[];
  };
}

interface ReportStudentCommentary {
  provider: "template";
  generatedAt: string;
  parentSummary: string;
  teacherActionDraft: string;
  reviewStatus: "DRAFT";
  disclaimer: string;
}

export async function processReportGenerationJob(
  job: QueueJob<ReportGenerationJobPayload>,
  adapter: ReportGenerationJobAdapter,
  now: () => string = () => new Date().toISOString(),
  summaryOptions: ReportSummaryOptions = resolveReportSummaryOptions(),
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
      const snapshot = createExamResultSummarySnapshot(input, results, now(), summaryOptions);
      return adapter.saveSnapshot(snapshot);
    },
  );
}

export function createExamResultSummarySnapshot(
  input: Pick<ReportGenerationJobInput, "tenantId" | "examId" | "reportType" | "campusId" | "classId" | "courseId" | "gradeLevelId" | "termId">,
  results: ExamResultForReport[],
  generatedAt: string,
  summaryOptions: ReportSummaryOptions = {},
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
  const averages = createTotalAverages(results);
  const branches = createBranchAverages(results);
  const classes = createClassAverages(results);
  const statistics = toCohortStatisticsSummary(cohortStatistics);
  const students = sortedResults.map((result) => createStudentSummary(result, statisticsByStudent));
  const provider = parseReportSummaryProvider(summaryOptions.provider ?? "disabled");
  if (provider === "anthropic") {
    throw new Error("AI_REPORT_SUMMARY_EXTERNAL_PROVIDER_NOT_ENABLED");
  }
  const commentary = provider === "template"
    ? createTemplateSnapshotCommentary({ averages, branches, classes, generatedAt })
    : undefined;
  const studentsWithCommentary = provider === "template"
    ? students.map((student) => ({
      ...student,
      commentary: createTemplateStudentCommentary(student, branches, generatedAt),
    }))
    : students;

  return {
    tenantId: input.tenantId,
    examId: input.examId,
    ...resolveReportContext(input),
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
      averages,
      branches,
      ...(outcomeAverages.length > 0 ? { outcomes: outcomeAverages } : {}),
      classes,
      statistics,
      ...(commentary ? { commentary } : {}),
      students: studentsWithCommentary,
    },
    generatedAt,
  };
}

export function resolveReportSummaryOptions(env: NodeJS.ProcessEnv = process.env): ReportSummaryOptions {
  const provider = parseReportSummaryProvider(env.AI_REPORT_SUMMARY_PROVIDER?.trim() || "disabled");
  if (provider === "anthropic") {
    throw new Error("AI_REPORT_SUMMARY_EXTERNAL_PROVIDER_NOT_ENABLED");
  }
  return { provider };
}

function parseReportSummaryProvider(value: string): ReportSummaryProvider {
  if (value !== "disabled" && value !== "template" && value !== "anthropic") {
    throw new Error("AI_REPORT_SUMMARY_PROVIDER_INVALID");
  }
  return value;
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
  const estimatedRawScore = averageOptional(results.map((result) => result.score.total.estimatedRawScore));
  return {
    correct: average(totals.map((score) => score.correct)),
    wrong: average(totals.map((score) => score.wrong)),
    blank: average(totals.map((score) => score.blank)),
    net: average(totals.map((score) => score.net)),
    questionCount: average(totals.map(scoreQuestionCount)),
    rawScore: average(totals.map((score) => score.rawScore)),
    ...(estimatedRawScore !== undefined ? { estimatedRawScore } : {}),
    standardScore: average(totals.map((score) => score.standardScore)),
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
    total: withScoreMetrics(result.score.total),
    branches: result.score.branches.map(withScoreMetrics),
    ...(outcomes.length > 0 ? { outcomes: outcomes.map(withScoreMetrics) } : {}),
    questions: result.score.questions ?? [],
    statistics: toStudentStatisticsSummary(statistics),
  };
}

const templateCommentaryDisclaimer = "Bu yorum otomatik taslaktır; veliye yayınlanmadan önce öğretmen tarafından kontrol edilmelidir.";
const reportSummaryFieldsUsed = [
  "total.net",
  "total.successRate",
  "total.standardScore",
  "branches.branch",
  "branches.net",
  "branches.successRate",
  "classes.averages.net",
  "classes.averages.successRate",
  "statistics.rank",
];
const reportSummaryFieldsExcluded = [
  "studentId",
  "studentName",
  "guardianName",
  "tcKimlikNo",
  "phone",
  "email",
  "address",
];

function createTemplateSnapshotCommentary(input: {
  averages: ScoreAverages;
  branches: BranchAverages[];
  classes: ClassAverages[];
  generatedAt: string;
}): ReportSnapshotCommentary {
  const strongestBranch = pickBranch(input.branches, "strongest");
  const focusBranch = pickBranch(input.branches, "weakest");
  const classSpread = describeClassSpread(input.classes);
  return {
    provider: "template",
    generatedAt: input.generatedAt,
    parentSummary: [
      `Genel ortalama ${formatScore(input.averages.net)} net.`,
      strongestBranch ? `En güçlü alan ${strongestBranch.branch} (${formatScore(strongestBranch.net)} net).` : "",
      focusBranch ? `Gelişim odağı ${focusBranch.branch} (${formatScore(focusBranch.net)} net).` : "",
      classSpread,
    ].filter(Boolean).join(" "),
    teacherActionDrafts: [
      focusBranch
        ? `${focusBranch.branch} için yanlış ve boş soru örüntüsü sınıfta kısa tekrar planına alınmalı.`
        : "Düşük netli kazanımlar sınıf tekrar planına alınmalı.",
      strongestBranch
        ? `${strongestBranch.branch} performansı korunurken karışık deneme takibi sürdürülmeli.`
        : "Haftalık deneme takibi öğretmen onayıyla paylaşılmalı.",
    ],
    reviewStatus: "DRAFT",
    disclaimer: templateCommentaryDisclaimer,
    dataPolicy: {
      piiIncluded: false,
      fieldsUsed: reportSummaryFieldsUsed,
      fieldsExcluded: reportSummaryFieldsExcluded,
    },
  };
}

function createTemplateStudentCommentary(
  student: StudentReportSummary,
  cohortBranches: BranchAverages[],
  generatedAt: string,
): ReportStudentCommentary {
  const strongestBranch = pickBranch(student.branches, "strongest");
  const focusBranch = pickBranch(student.branches, "weakest");
  const focusGap = focusBranch ? describeBranchGap(focusBranch, cohortBranches) : "";
  return {
    provider: "template",
    generatedAt,
    parentSummary: [
      `Bu sonuçta toplam ${formatScore(student.total.net)} net görünüyor.`,
      strongestBranch ? `Güçlü alan ${strongestBranch.branch}.` : "",
      focusBranch ? `Öncelikli çalışma alanı ${focusBranch.branch}${focusGap}.` : "",
      "Yorum, yalnızca sayısal sınav verilerinden üretilmiş anonim bir taslaktır.",
    ].filter(Boolean).join(" "),
    teacherActionDraft: focusBranch
      ? `${focusBranch.branch} için yanlış/boş soru incelemesi yapılıp kısa tekrar ve hedefli soru seti atanmalı.`
      : "Öğretmen, sınav kırılımını kontrol ederek hedefli tekrar planı oluşturmalı.",
    reviewStatus: "DRAFT",
    disclaimer: templateCommentaryDisclaimer,
  };
}

function pickBranch<T extends { branch: string; net: number }>(branches: T[], mode: "strongest" | "weakest"): T | undefined {
  return [...branches].sort((a, b) => mode === "strongest" ? b.net - a.net : a.net - b.net)[0];
}

function describeBranchGap(branch: { branch: string; net: number }, cohortBranches: BranchAverages[]): string {
  const cohort = cohortBranches.find((candidate) => candidate.branch === branch.branch);
  if (!cohort) return "";
  const difference = Number((branch.net - cohort.net).toFixed(2));
  if (Math.abs(difference) < 0.01) {
    return ", kurum ortalamasına yakın";
  }
  return difference > 0
    ? `, kurum ortalamasının ${formatScore(difference)} net üzerinde`
    : `, kurum ortalamasının ${formatScore(Math.abs(difference))} net altında`;
}

function describeClassSpread(classes: ClassAverages[]): string {
  if (classes.length < 2) {
    return "";
  }
  const sorted = [...classes].sort((a, b) => b.averages.net - a.averages.net);
  const top = sorted[0];
  const bottom = sorted.at(-1);
  if (!top || !bottom || top.classId === bottom.classId) {
    return "";
  }
  return `Sınıf ortalamaları ${formatScore(bottom.averages.net)}-${formatScore(top.averages.net)} net aralığında.`;
}

function formatScore(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return Number(value.toFixed(2)).toString();
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
        branches: createBranchAverages(classResults),
      };
    });
}

function withScoreMetrics<T extends { blank: number; correct: number; net: number; wrong: number }>(score: T): T & ScoreMetrics {
  return {
    ...score,
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
  return roundMetric((score.net / questionCount) * 100);
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

function averageOptional(values: Array<number | undefined>): number | undefined {
  const validValues = values.filter((value): value is number => value !== undefined);
  if (validValues.length === 0) {
    return undefined;
  }
  return average(validValues);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}
