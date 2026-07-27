import type { ExamType } from "@o-okul/shared-types";

export const scoringEngineVersion = "2026.07.practice-score-nosd-v1";
export const lgsScoringProfileId = "TR-LGS-2026-NOSD-V1";
export const yksScoringProfileId = "TR-YKS-2026-NOSD-V1";

export type Choice = "A" | "B" | "C" | "D" | "E" | "";
export type ExamScoreType = "LGS" | "TYT" | "SAY" | "EA" | "SOZ";
export type ExamScoreStatus = "CALCULATED" | "NOT_ELIGIBLE" | "MISSING_TYT";
export type ScoreSection =
  | "LGS_TURKCE"
  | "LGS_MATEMATIK"
  | "LGS_FEN"
  | "LGS_INKILAP"
  | "LGS_DIN"
  | "LGS_YABANCI_DIL"
  | "TYT_TURKCE"
  | "TYT_SOSYAL"
  | "TYT_MATEMATIK"
  | "TYT_FEN"
  | "AYT_MATEMATIK"
  | "AYT_FIZIK"
  | "AYT_KIMYA"
  | "AYT_BIYOLOJI"
  | "AYT_EDEBIYAT"
  | "AYT_TARIH_1"
  | "AYT_COGRAFYA_1"
  | "AYT_TARIH_2"
  | "AYT_COGRAFYA_2"
  | "AYT_FELSEFE"
  | "AYT_DIN";

export interface ExamScoreMetrics {
  correct: number;
  wrong: number;
  blank: number;
  net: number;
  questionCount: number;
  successRate: number;
}

export interface ExamScoreView {
  type: ExamScoreType;
  status: ExamScoreStatus;
  metrics: ExamScoreMetrics;
  practiceScore?: number;
  profileId: typeof lgsScoringProfileId | typeof yksScoringProfileId;
  officialComparable: false;
}

export interface LinkedTytScoreInput {
  status: ExamScoreStatus;
  practiceScore?: number;
}

export interface StudentAnswer {
  questionNo: number;
  answer: Choice;
}

export interface AnswerKeyItem {
  questionNo: number;
  correctAnswer: Exclude<Choice, "">;
  branch: string;
  outcomeCode?: string;
  topic?: string;
  scoreSection?: ScoreSection;
  evaluationStatus?: "ACTIVE" | "CANCELLED";
}

export interface ScoringConfig {
  examType?: ExamType;
  examYear?: number;
  scoringProfileId?: string;
  linkedTytScore?: LinkedTytScoreInput;
  wrongPenalty: number;
  rawScoreMultiplier?: number;
  standardScoreBase?: number;
  standardScoreMultiplier?: number;
  answerKeyVersion: string;
  engineVersion: string;
  computedAt: string;
}

export interface BranchScore {
  branch: string;
  correct: number;
  wrong: number;
  blank: number;
  net: number;
}

export interface QuestionScore {
  questionNo: number;
  branch: string;
  outcomeCode?: string;
  topic?: string;
  scoreSection?: ScoreSection;
  evaluationStatus?: "ACTIVE" | "CANCELLED";
  answer: Choice;
  correctAnswer: Choice;
  status: "CORRECT" | "WRONG" | "BLANK" | "CANCELLED";
}

export interface OutcomeScore {
  outcomeCode: string;
  branch: string;
  correct: number;
  wrong: number;
  blank: number;
  net: number;
}

export interface ScoringResult {
  total: {
    correct: number;
    wrong: number;
    blank: number;
    net: number;
    rawScore: number;
    standardScore?: number;
    estimatedRawScore?: number;
  };
  branches: BranchScore[];
  outcomes?: OutcomeScore[];
  questions: QuestionScore[];
  scoreViews?: ExamScoreView[];
  _meta: {
    answerKeyVersion: string;
    engineVersion: string;
    computedAt: string;
    examType?: ExamType;
    examYear?: number;
    scoringProfileId?: typeof lgsScoringProfileId | typeof yksScoringProfileId;
    physicalQuestionCount?: number;
    activeQuestionCount?: number;
  };
}

interface SectionScore extends ExamScoreMetrics {
  section: ScoreSection;
}

const lgsWeights: Partial<Record<ScoreSection, number>> = {
  LGS_TURKCE: 4,
  LGS_MATEMATIK: 4,
  LGS_FEN: 4,
  LGS_INKILAP: 1,
  LGS_DIN: 1,
  LGS_YABANCI_DIL: 1,
};

const tytWeights: Partial<Record<ScoreSection, number>> = {
  TYT_TURKCE: 33,
  TYT_SOSYAL: 17,
  TYT_MATEMATIK: 33,
  TYT_FEN: 17,
};

const aytWeights: Record<Exclude<ExamScoreType, "LGS" | "TYT">, Partial<Record<ScoreSection, number>>> = {
  SAY: { AYT_MATEMATIK: 30, AYT_FIZIK: 10, AYT_KIMYA: 10, AYT_BIYOLOJI: 10 },
  EA: { AYT_MATEMATIK: 30, AYT_EDEBIYAT: 18, AYT_TARIH_1: 7, AYT_COGRAFYA_1: 5 },
  SOZ: {
    AYT_EDEBIYAT: 18,
    AYT_TARIH_1: 7,
    AYT_COGRAFYA_1: 5,
    AYT_TARIH_2: 8,
    AYT_COGRAFYA_2: 8,
    AYT_FELSEFE: 9,
    AYT_DIN: 5,
  },
};

export function scoreExam(
  answers: StudentAnswer[],
  answerKey: AnswerKeyItem[],
  config: ScoringConfig,
): ScoringResult {
  const answerMap = new Map(answers.map((answer) => [answer.questionNo, answer.answer]));
  const branchScores = new Map<string, BranchScore>();
  const outcomeScores = new Map<string, OutcomeScore>();
  const sectionScores = new Map<ScoreSection, SectionScore>();
  const questions: QuestionScore[] = [];
  const profileId = resolveScoringProfile(config);
  if (profileId) validateProfileInput(answerKey, config, profileId);
  const wrongPenalty = profileId === lgsScoringProfileId ? 1 / 3 : profileId === yksScoringProfileId ? 1 / 4 : config.wrongPenalty;
  const calculateExamNet = profileId ? calculatePracticeNet : calculateNet;
  let activeQuestionCount = 0;

  for (const key of answerKey) {
    validateAnswerKeyItem(key);
    const answer = answerMap.get(key.questionNo) ?? "";
    const section = key.scoreSection ?? inferScoreSection(key.branch, config.examType);

    if (key.evaluationStatus === "CANCELLED") {
      questions.push({
        ...key,
        ...(section ? { scoreSection: section } : {}),
        answer: "",
        correctAnswer: "",
        status: "CANCELLED",
      });
      continue;
    }

    activeQuestionCount += 1;
    const score = ensureBranchScore(branchScores, key.branch);
    const outcome = key.outcomeCode ? ensureOutcomeScore(outcomeScores, key.outcomeCode, key.branch) : undefined;
    const sectionScore = section ? ensureSectionScore(sectionScores, section) : undefined;

    if (answer === "") {
      score.blank += 1;
      if (outcome) outcome.blank += 1;
      if (sectionScore) sectionScore.blank += 1;
      questions.push({ ...key, ...(section ? { scoreSection: section } : {}), answer, status: "BLANK" });
    } else if (answer === key.correctAnswer) {
      score.correct += 1;
      if (outcome) outcome.correct += 1;
      if (sectionScore) sectionScore.correct += 1;
      questions.push({ ...key, ...(section ? { scoreSection: section } : {}), answer, status: "CORRECT" });
    } else {
      score.wrong += 1;
      if (outcome) outcome.wrong += 1;
      if (sectionScore) sectionScore.wrong += 1;
      questions.push({ ...key, ...(section ? { scoreSection: section } : {}), answer, status: "WRONG" });
    }
  }

  const branches = [...branchScores.values()].map((score) => ({
    ...score,
    net: calculateExamNet(score.correct, score.wrong, wrongPenalty),
  }));
  const outcomes = [...outcomeScores.values()].map((score) => ({
    ...score,
    net: calculateExamNet(score.correct, score.wrong, wrongPenalty),
  }));
  const sections = [...sectionScores.values()].map((score) => withCalculatedMetrics(score, wrongPenalty));
  const total = branches.reduce(
    (sum, score) => ({
      correct: sum.correct + score.correct,
      wrong: sum.wrong + score.wrong,
      blank: sum.blank + score.blank,
    }),
    { correct: 0, wrong: 0, blank: 0 },
  );
  const totalWithNet = { ...total, net: calculateExamNet(total.correct, total.wrong, wrongPenalty) };
  const rawScore = calculateRawScore(totalWithNet.net, config);
  const scoreViews = profileId ? createScoreViews(config.examType, sections, config.linkedTytScore) : [];
  const legacyEstimatedRawScore =
    profileId === undefined && (config.examType === undefined || config.examType === "LGS")
      ? calculateLegacyEstimatedRawScore(branches)
      : undefined;

  return {
    total: {
      ...totalWithNet,
      rawScore,
      ...(profileId === undefined ? { standardScore: calculateStandardScore(rawScore, config) } : {}),
      ...(legacyEstimatedRawScore !== undefined ? { estimatedRawScore: legacyEstimatedRawScore } : {}),
    },
    branches,
    ...(outcomes.length > 0 ? { outcomes } : {}),
    questions,
    ...(scoreViews.length > 0 ? { scoreViews } : {}),
    _meta: {
      answerKeyVersion: config.answerKeyVersion,
      engineVersion: config.engineVersion,
      computedAt: config.computedAt,
      ...(config.examType ? { examType: config.examType } : {}),
      ...(profileId ? {
        examYear: config.examYear ?? 2026,
        scoringProfileId: profileId,
        physicalQuestionCount: answerKey.length,
        activeQuestionCount,
      } : {}),
    },
  };
}

export function calculateAytScoreViews(
  sections: ReadonlyArray<ExamScoreMetrics & { section: ScoreSection }>,
  linkedTytScore?: LinkedTytScoreInput,
): ExamScoreView[] {
  return (["SAY", "EA", "SOZ"] as const).map((type) => {
    const relevant = sections.filter((section) => aytWeights[type][section.section] !== undefined);
    const metrics = combineMetrics(relevant);
    if (linkedTytScore?.status !== "CALCULATED" || linkedTytScore.practiceScore === undefined) {
      return scoreView(type, "MISSING_TYT", metrics, yksScoringProfileId);
    }
    if (!isAytEligible(type, sections)) {
      return scoreView(type, "NOT_ELIGIBLE", metrics, yksScoringProfileId);
    }

    const tytRatio = clamp((linkedTytScore.practiceScore - 100) / 400, 0, 1);
    const aytRatio = weightedRatio(sections, aytWeights[type]);
    return scoreView(
      type,
      "CALCULATED",
      metrics,
      yksScoringProfileId,
      practiceScore(0.4 * tytRatio + 0.6 * aytRatio),
    );
  });
}

function createScoreViews(
  examType: ExamType | undefined,
  sections: SectionScore[],
  linkedTytScore?: LinkedTytScoreInput,
): ExamScoreView[] {
  if (examType === "LGS") {
    return [
      scoreView(
        "LGS",
        "CALCULATED",
        combineMetrics(sections),
        lgsScoringProfileId,
        practiceScore(weightedRatio(sections, lgsWeights)),
      ),
    ];
  }
  if (examType === "TYT") {
    const metrics = combineMetrics(sections);
    const eligible = sectionNet(sections, "TYT_TURKCE") >= 0.5 || sectionNet(sections, "TYT_MATEMATIK") >= 0.5;
    return [
      scoreView(
        "TYT",
        eligible ? "CALCULATED" : "NOT_ELIGIBLE",
        metrics,
        yksScoringProfileId,
        eligible ? practiceScore(weightedRatio(sections, tytWeights)) : undefined,
      ),
    ];
  }
  if (examType === "AYT") {
    return calculateAytScoreViews(sections, linkedTytScore);
  }
  return [];
}

function isAytEligible(type: "SAY" | "EA" | "SOZ", sections: ReadonlyArray<SectionScore>): boolean {
  if (type === "SAY") {
    return sectionNet(sections, "AYT_MATEMATIK") >= 0.5
      || sumSectionNets(sections, ["AYT_FIZIK", "AYT_KIMYA", "AYT_BIYOLOJI"]) >= 0.5;
  }
  if (type === "EA") {
    return sectionNet(sections, "AYT_MATEMATIK") >= 0.5
      || sumSectionNets(sections, ["AYT_EDEBIYAT", "AYT_TARIH_1", "AYT_COGRAFYA_1"]) >= 0.5;
  }
  return sumSectionNets(sections, ["AYT_EDEBIYAT", "AYT_TARIH_1", "AYT_COGRAFYA_1"]) >= 0.5
    || sumSectionNets(sections, ["AYT_TARIH_2", "AYT_COGRAFYA_2", "AYT_FELSEFE", "AYT_DIN"]) >= 0.5;
}

function sumSectionNets(sections: ReadonlyArray<SectionScore>, names: ScoreSection[]): number {
  return names.reduce((sum, name) => sum + sectionNet(sections, name), 0);
}

function sectionNet(sections: ReadonlyArray<SectionScore>, name: ScoreSection): number {
  return sections.find((section) => section.section === name)?.net ?? 0;
}

function weightedRatio(
  sections: ReadonlyArray<SectionScore>,
  weights: Partial<Record<ScoreSection, number>>,
): number {
  let weightedSuccess = 0;
  let activeWeight = 0;
  for (const section of sections) {
    const weight = weights[section.section];
    if (weight === undefined || section.questionCount <= 0) continue;
    weightedSuccess += weight * (exactSectionNet(section) / section.questionCount);
    activeWeight += weight;
  }
  return activeWeight > 0 ? clamp(weightedSuccess / activeWeight, 0, 1) : 0;
}

function exactSectionNet(section: SectionScore): number {
  return section.correct - section.wrong * (section.section.startsWith("LGS_") ? 1 / 3 : 1 / 4);
}

function scoreView(
  type: ExamScoreType,
  status: ExamScoreStatus,
  metrics: ExamScoreMetrics,
  profileId: typeof lgsScoringProfileId | typeof yksScoringProfileId,
  practiceScoreValue?: number,
): ExamScoreView {
  return {
    type,
    status,
    metrics,
    ...(practiceScoreValue !== undefined ? { practiceScore: practiceScoreValue } : {}),
    profileId,
    officialComparable: false,
  };
}

function practiceScore(ratio: number): number {
  return roundPracticeScore(100 + 400 * clamp(ratio, 0, 1));
}

function combineMetrics(scores: ReadonlyArray<ExamScoreMetrics>): ExamScoreMetrics {
  const combined = scores.reduce(
    (sum, score) => ({
      correct: sum.correct + score.correct,
      wrong: sum.wrong + score.wrong,
      blank: sum.blank + score.blank,
      net: sum.net + score.net,
      questionCount: sum.questionCount + score.questionCount,
    }),
    { correct: 0, wrong: 0, blank: 0, net: 0, questionCount: 0 },
  );
  return {
    ...combined,
    net: roundPracticeScore(combined.net),
    successRate: combined.questionCount > 0
      ? roundPracticeScore(clamp(combined.net / combined.questionCount, 0, 1) * 100)
      : 0,
  };
}

function withCalculatedMetrics<T extends { correct: number; wrong: number; blank: number }>(
  score: T,
  wrongPenalty: number,
): T & ExamScoreMetrics {
  const questionCount = score.correct + score.wrong + score.blank;
  const net = calculatePracticeNet(score.correct, score.wrong, wrongPenalty);
  return {
    ...score,
    net,
    questionCount,
    successRate: questionCount > 0
      ? roundPracticeScore(clamp(net / questionCount, 0, 1) * 100)
      : 0,
  };
}

function resolveScoringProfile(config: ScoringConfig) {
  if (!config.scoringProfileId) return undefined;
  if (config.examYear !== 2026) throw new Error("SCORING_PROFILE_MISMATCH");
  if (config.examType === "LGS" && config.scoringProfileId === lgsScoringProfileId) return lgsScoringProfileId;
  if ((config.examType === "TYT" || config.examType === "AYT") && config.scoringProfileId === yksScoringProfileId) {
    return yksScoringProfileId;
  }
  throw new Error("SCORING_PROFILE_MISMATCH");
}

function validateProfileSectionDistribution(answerKey: AnswerKeyItem[], examType: ExamType | undefined): void {
  const expected = examType === "LGS"
    ? { LGS_TURKCE: 20, LGS_MATEMATIK: 20, LGS_FEN: 20, LGS_INKILAP: 10, LGS_DIN: 10, LGS_YABANCI_DIL: 10 }
    : examType === "TYT"
      ? { TYT_TURKCE: 40, TYT_SOSYAL: 20, TYT_MATEMATIK: 40, TYT_FEN: 20 }
      : examType === "AYT"
        ? {
          AYT_MATEMATIK: 40,
          AYT_FIZIK: 14,
          AYT_KIMYA: 13,
          AYT_BIYOLOJI: 13,
          AYT_EDEBIYAT: 24,
          AYT_TARIH_1: 10,
          AYT_COGRAFYA_1: 6,
          AYT_TARIH_2: 11,
          AYT_COGRAFYA_2: 11,
          AYT_FELSEFE: 12,
          AYT_DIN: 6,
        }
        : undefined;
  if (!expected) throw new Error("SCORING_PROFILE_MISMATCH");
  const counts = new Map<ScoreSection, number>();
  for (const item of answerKey) {
    const section = item.scoreSection;
    const expectedPrefix = examType === "LGS" ? "LGS_" : examType === "TYT" ? "TYT_" : "AYT_";
    if (!section?.startsWith(expectedPrefix)) throw new Error("SCORING_PROFILE_SECTION_DISTRIBUTION_INVALID");
    counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  if (Object.entries(expected).some(([section, count]) => counts.get(section as ScoreSection) !== count)) {
    throw new Error("SCORING_PROFILE_SECTION_DISTRIBUTION_INVALID");
  }
}

function validateProfileInput(
  answerKey: AnswerKeyItem[],
  config: ScoringConfig,
  profileId: typeof lgsScoringProfileId | typeof yksScoringProfileId,
): void {
  const expectedPenalty = profileId === lgsScoringProfileId ? 1 / 3 : 1 / 4;
  if (Math.abs(config.wrongPenalty - expectedPenalty) > 1e-9) {
    throw new Error("SCORING_PROFILE_WRONG_PENALTY_MISMATCH");
  }
  validateProfileSectionDistribution(answerKey, config.examType);
}

function validateAnswerKeyItem(key: AnswerKeyItem): void {
  if (!key.branch.trim()) {
    throw new Error("SCORING_ANSWER_KEY_BRANCH_REQUIRED");
  }
}

function ensureBranchScore(scores: Map<string, BranchScore>, branch: string): BranchScore {
  const existing = scores.get(branch);
  if (existing) return existing;
  const score = { branch, correct: 0, wrong: 0, blank: 0, net: 0 };
  scores.set(branch, score);
  return score;
}

function ensureOutcomeScore(scores: Map<string, OutcomeScore>, outcomeCode: string, branch: string): OutcomeScore {
  const existing = scores.get(outcomeCode);
  if (existing) return existing;
  const score = { outcomeCode, branch, correct: 0, wrong: 0, blank: 0, net: 0 };
  scores.set(outcomeCode, score);
  return score;
}

function ensureSectionScore(scores: Map<ScoreSection, SectionScore>, section: ScoreSection): SectionScore {
  const existing = scores.get(section);
  if (existing) return existing;
  const score = { section, correct: 0, wrong: 0, blank: 0, net: 0, questionCount: 0, successRate: 0 };
  scores.set(section, score);
  return score;
}

function calculateNet(correct: number, wrong: number, wrongPenalty: number): number {
  return roundScore(correct - wrong * wrongPenalty);
}

function calculatePracticeNet(correct: number, wrong: number, wrongPenalty: number): number {
  return roundPracticeScore(correct - wrong * wrongPenalty);
}

function calculateRawScore(net: number, config: ScoringConfig): number {
  return config.rawScoreMultiplier === undefined ? net : roundScore(net * config.rawScoreMultiplier);
}

function calculateLegacyEstimatedRawScore(branches: BranchScore[]): number {
  const highPriorityBranches = new Set(["TURKCE", "MATEMATIK", "FEN BILIMLERI"]);
  return roundScore(branches.reduce((sum, branch) => {
    const multiplier = highPriorityBranches.has(normalizeBranchName(branch.branch)) ? 4.348 : 1.08;
    return sum + branch.net * multiplier;
  }, 0));
}

function calculateStandardScore(rawScore: number, config: ScoringConfig): number {
  if (config.standardScoreBase === undefined && config.standardScoreMultiplier === undefined) return rawScore;
  return roundScore((config.standardScoreBase ?? 0) + rawScore * (config.standardScoreMultiplier ?? 1));
}

function inferScoreSection(branch: string, examType: ExamType | undefined): ScoreSection | undefined {
  const normalized = normalizeBranchName(branch);
  if (examType === "LGS") {
    return ({
      TURKCE: "LGS_TURKCE",
      MATEMATIK: "LGS_MATEMATIK",
      "FEN BILIMLERI": "LGS_FEN",
      FEN: "LGS_FEN",
      "T C INKILAP TARIHI VE ATATURKCULUK": "LGS_INKILAP",
      "INKILAP TARIHI": "LGS_INKILAP",
      "DIN KULTURU VE AHLAK BILGISI": "LGS_DIN",
      "DIN KULTURU": "LGS_DIN",
      INGILIZCE: "LGS_YABANCI_DIL",
      "YABANCI DIL": "LGS_YABANCI_DIL",
    } as const)[normalized];
  }
  if (examType === "TYT") {
    return ({
      TURKCE: "TYT_TURKCE",
      "SOSYAL BILIMLER": "TYT_SOSYAL",
      "TEMEL MATEMATIK": "TYT_MATEMATIK",
      MATEMATIK: "TYT_MATEMATIK",
      "FEN BILIMLERI": "TYT_FEN",
    } as const)[normalized];
  }
  return undefined;
}

function normalizeBranchName(branch: string): string {
  return branch
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(LGS|TYT|AYT)\s+/u, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function roundPracticeScore(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
