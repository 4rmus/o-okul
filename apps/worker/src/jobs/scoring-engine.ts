export const scoringEngineVersion = "2026.06.lgs-prefixed-scaled-net";

export type Choice = "A" | "B" | "C" | "D" | "E" | "";

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
}

export interface ScoringConfig {
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
  answer: Choice;
  correctAnswer: Exclude<Choice, "">;
  status: "CORRECT" | "WRONG" | "BLANK";
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
    standardScore: number;
    estimatedRawScore?: number;
  };
  branches: BranchScore[];
  outcomes?: OutcomeScore[];
  questions: QuestionScore[];
  _meta: {
    answerKeyVersion: string;
    engineVersion: string;
    computedAt: string;
  };
}

const highPriorityBranches = new Set(["TURKCE", "MATEMATIK", "FEN BILIMLERI"]);
const highPriorityBranchMultiplier = 4.348;
const defaultBranchMultiplier = 1.08;

export function scoreExam(
  answers: StudentAnswer[],
  answerKey: AnswerKeyItem[],
  config: ScoringConfig,
): ScoringResult {
  const answerMap = new Map(answers.map((answer) => [answer.questionNo, answer.answer]));
  const branchScores = new Map<string, BranchScore>();
  const outcomeScores = new Map<string, OutcomeScore>();
  const questions: QuestionScore[] = [];

  for (const key of answerKey) {
    validateAnswerKeyItem(key);
    const score = ensureBranchScore(branchScores, key.branch);
    const outcome = key.outcomeCode ? ensureOutcomeScore(outcomeScores, key.outcomeCode, key.branch) : undefined;
    const answer = answerMap.get(key.questionNo) ?? "";

    if (answer === "") {
      score.blank += 1;
      if (outcome) outcome.blank += 1;
      questions.push({ ...key, answer, status: "BLANK" });
    } else if (answer === key.correctAnswer) {
      score.correct += 1;
      if (outcome) outcome.correct += 1;
      questions.push({ ...key, answer, status: "CORRECT" });
    } else {
      score.wrong += 1;
      if (outcome) outcome.wrong += 1;
      questions.push({ ...key, answer, status: "WRONG" });
    }
  }

  const branches = [...branchScores.values()].map((score) => ({
    ...score,
    net: calculateNet(score.correct, score.wrong, config.wrongPenalty),
  }));
  const outcomes = [...outcomeScores.values()].map((score) => ({
    ...score,
    net: calculateNet(score.correct, score.wrong, config.wrongPenalty),
  }));
  const total = branches.reduce(
    (sum, score) => ({
      correct: sum.correct + score.correct,
      wrong: sum.wrong + score.wrong,
      blank: sum.blank + score.blank,
      net: sum.net + score.net,
    }),
    { correct: 0, wrong: 0, blank: 0, net: 0 },
  );
  const rawScore = calculateRawScore(total.net, config);
  const estimatedRawScore = calculateEstimatedRawScore(branches);

  return {
    total: {
      ...total,
      rawScore,
      estimatedRawScore,
      standardScore: calculateStandardScore(rawScore, config),
    },
    branches,
    ...(outcomes.length > 0 ? { outcomes } : {}),
    questions,
    _meta: {
      answerKeyVersion: config.answerKeyVersion,
      engineVersion: config.engineVersion,
      computedAt: config.computedAt,
    },
  };
}

function validateAnswerKeyItem(key: AnswerKeyItem): void {
  if (!key.branch.trim()) {
    throw new Error("SCORING_ANSWER_KEY_BRANCH_REQUIRED");
  }
}

function ensureBranchScore(scores: Map<string, BranchScore>, branch: string): BranchScore {
  const existing = scores.get(branch);
  if (existing) {
    return existing;
  }

  const score = { branch, correct: 0, wrong: 0, blank: 0, net: 0 };
  scores.set(branch, score);
  return score;
}

function ensureOutcomeScore(scores: Map<string, OutcomeScore>, outcomeCode: string, branch: string): OutcomeScore {
  const existing = scores.get(outcomeCode);
  if (existing) {
    return existing;
  }

  const score = { outcomeCode, branch, correct: 0, wrong: 0, blank: 0, net: 0 };
  scores.set(outcomeCode, score);
  return score;
}

function calculateNet(correct: number, wrong: number, wrongPenalty: number): number {
  return correct - wrong * wrongPenalty;
}

function calculateRawScore(net: number, config: ScoringConfig): number {
  if (config.rawScoreMultiplier === undefined) {
    return net;
  }
  return roundScore(net * config.rawScoreMultiplier);
}

function calculateEstimatedRawScore(branches: BranchScore[]): number {
  return roundScore(
    branches.reduce((sum, branch) => {
      const multiplier = estimateBranchMultiplier(branch.branch);
      return sum + branch.net * multiplier;
    }, 0),
  );
}

function estimateBranchMultiplier(branch: string): number {
  const normalized = normalizeBranchName(branch);
  return highPriorityBranches.has(normalized) ? highPriorityBranchMultiplier : defaultBranchMultiplier;
}

function normalizeBranchName(branch: string): string {
  return branch
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^LGS\s+/u, "");
}

function calculateStandardScore(rawScore: number, config: ScoringConfig): number {
  if (config.standardScoreBase === undefined && config.standardScoreMultiplier === undefined) {
    return rawScore;
  }
  const base = config.standardScoreBase ?? 0;
  const multiplier = config.standardScoreMultiplier ?? 1;
  return roundScore(base + rawScore * multiplier);
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}
