export const psychometricsVersion = "2026.07.competition-rank-v2";

export interface CohortBranchInput {
  branch: string;
  net: number;
}

export interface CohortStudentInput {
  studentId: string;
  classId?: string | null;
  net: number;
  rawScore: number;
  rankingScore?: number;
  branches: CohortBranchInput[];
}

export interface ScopeRank {
  rank: number;
  outOf: number;
}

export interface BranchStatistics {
  branch: string;
  net: number;
  general: ScopeRank;
  class: ScopeRank | null;
}

export interface StudentStatistics {
  studentId: string;
  classId: string | null;
  total: {
    net: number;
    rawScore: number;
    general: ScopeRank;
    class: ScopeRank | null;
  };
  branches: BranchStatistics[];
}

export interface CohortStatistics {
  count: number;
  total: {
    meanNet: number;
    meanRawScore: number;
  };
  branches: {
    branch: string;
    count: number;
    meanNet: number;
  }[];
  students: StudentStatistics[];
  _meta: {
    psychometricsVersion: string;
  };
}

export function computeCohortStatistics(students: CohortStudentInput[]): CohortStatistics {
  if (students.length === 0) {
    throw new Error("PSYCHOMETRICS_INPUT_EMPTY");
  }

  const sorted = [...students].sort((left, right) => left.studentId.localeCompare(right.studentId));
  const rankingScores = sorted.map(studentRankingScore);
  const branchNames = uniqueSorted(sorted.flatMap((student) => student.branches.map((branch) => branch.branch)));
  const generalRanks = createRankLookup(rankingScores);
  const classScores = groupValues(sorted, (student) => student.classId ?? undefined, studentRankingScore);
  const classRanks = new Map([...classScores].map(([key, values]) => [key, createRankLookup(values)]));
  const branchScores = new Map(branchNames.map((branch) => [branch, collectBranchNets(sorted, branch)]));
  const branchRanks = new Map([...branchScores].map(([branch, values]) => [branch, createRankLookup(values)]));
  const classBranchScores = new Map<string, number[]>();
  for (const student of sorted) {
    if (!student.classId) continue;
    for (const branch of student.branches) {
      pushTo(classBranchScores, classBranchKey(student.classId, branch.branch), branch.net);
    }
  }
  const classBranchRanks = new Map([...classBranchScores].map(([key, values]) => [key, createRankLookup(values)]));

  return {
    count: sorted.length,
    total: {
      meanNet: mean(sorted.map((student) => student.net)),
      meanRawScore: mean(sorted.map((student) => student.rawScore)),
    },
    branches: branchNames.map((branch) => {
      const values = branchScores.get(branch) ?? [];
      return { branch, count: values.length, meanNet: mean(values) };
    }),
    students: sorted.map((student) => {
      const classId = student.classId ?? null;
      const score = studentRankingScore(student);
      return {
        studentId: student.studentId,
        classId,
        total: {
          net: round2(student.net),
          rawScore: round2(student.rawScore),
          general: generalRanks.get(score) ?? { rank: 1, outOf: sorted.length },
          class: classId === null ? null : classRanks.get(classId)?.get(score) ?? null,
        },
        branches: [...student.branches]
          .sort((left, right) => left.branch.localeCompare(right.branch))
          .map((branch) => ({
            branch: branch.branch,
            net: round2(branch.net),
            general: branchRanks.get(branch.branch)?.get(branch.net) ?? { rank: 1, outOf: 1 },
            class: classId === null
              ? null
              : classBranchRanks.get(classBranchKey(classId, branch.branch))?.get(branch.net) ?? null,
          })),
      };
    }),
    _meta: { psychometricsVersion },
  };
}

function createRankLookup(values: number[]): Map<number, ScopeRank> {
  const descending = [...values].sort((left, right) => right - left);
  const ranks = new Map<number, ScopeRank>();
  descending.forEach((value, index) => {
    if (!ranks.has(value)) ranks.set(value, { rank: index + 1, outOf: descending.length });
  });
  return ranks;
}

function studentRankingScore(student: CohortStudentInput): number {
  return student.rankingScore ?? student.rawScore;
}

function groupValues(
  students: CohortStudentInput[],
  keyOf: (student: CohortStudentInput) => string | undefined,
  valueOf: (student: CohortStudentInput) => number,
): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const student of students) {
    const key = keyOf(student);
    if (key) pushTo(grouped, key, valueOf(student));
  }
  return grouped;
}

function collectBranchNets(students: CohortStudentInput[], branch: string): number[] {
  return students
    .map((student) => student.branches.find((candidate) => candidate.branch === branch)?.net)
    .filter((net): net is number => net !== undefined);
}

function pushTo(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function classBranchKey(classId: string, branch: string): string {
  return `${classId}\u0000${branch}`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
