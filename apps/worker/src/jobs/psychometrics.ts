export const psychometricsVersion = "2026.06.cohort-v1";

/**
 * Standart puan ölçeği. Varsayılan T-skor: ortalama 50, standart sapma 10.
 * (ör. ÖSYM/MEB tarzı). Kurum isterse 100 taban / 15 ölçek gibi alternatifleri
 * `standardScore` ile geçer. z-skoru popülasyon standart sapmasıyla (÷N) hesaplanır.
 */
export interface StandardScoreScale {
  mean: number;
  sd: number;
}

export interface PsychometricsConfig {
  standardScore?: StandardScoreScale;
}

export interface CohortBranchInput {
  branch: string;
  net: number;
}

export interface CohortStudentInput {
  studentId: string;
  classId?: string | null;
  net: number;
  rawScore: number;
  branches: CohortBranchInput[];
}

/** Bir kapsam (genel ya da sınıf) içindeki konumlandırma. */
export interface ScopeRank {
  /** 1 tabanlı rekabet sıralaması: eşit puanlar aynı rank'i paylaşır, sonraki rank atlar. */
  rank: number;
  /** Kapsamdaki öğrenci sayısı. */
  outOf: number;
  /** Yüzdelik dilim: (altındaki + 0.5·eşit) / N × 100. */
  percentile: number;
}

export interface BranchStatistics {
  branch: string;
  net: number;
  standardScore: number;
  general: ScopeRank;
  class: ScopeRank | null;
}

export interface StudentStatistics {
  studentId: string;
  classId: string | null;
  total: {
    net: number;
    rawScore: number;
    standardScore: number;
    general: ScopeRank;
    class: ScopeRank | null;
  };
  branches: BranchStatistics[];
}

export interface CohortBranchSummary {
  branch: string;
  count: number;
  meanNet: number;
  sdNet: number;
}

export interface CohortStatistics {
  count: number;
  total: {
    meanNet: number;
    sdNet: number;
    meanRawScore: number;
    sdRawScore: number;
  };
  branches: CohortBranchSummary[];
  students: StudentStatistics[];
  _meta: {
    psychometricsVersion: string;
    standardScore: StandardScoreScale;
  };
}

const defaultScale: StandardScoreScale = { mean: 50, sd: 10 };

/**
 * Bir sınavın tüm sonuçlarından (kohort) standart puan, yüzdelik dilim ve
 * sıralama üretir. Saf ve deterministik: aynı girdi (sıradan bağımsız) → aynı çıktı.
 * Standart puan kohort geneline görelidir; sıralama/yüzdelik hem genel hem sınıf
 * kapsamında verilir. Dağılımlar bir kez ön-hesaplanıp ikili arama ile
 * sorgulanır (O(N log N)).
 */
export function computeCohortStatistics(
  students: CohortStudentInput[],
  config: PsychometricsConfig = {},
): CohortStatistics {
  if (students.length === 0) {
    throw new Error("PSYCHOMETRICS_INPUT_EMPTY");
  }
  const scale = config.standardScore ?? defaultScale;

  const sorted = [...students].sort((a, b) => a.studentId.localeCompare(b.studentId));
  const rawScores = sorted.map((student) => student.rawScore);
  const nets = sorted.map((student) => student.net);
  const branchNames = uniqueSorted(sorted.flatMap((student) => student.branches.map((branch) => branch.branch)));

  const totalDistribution = buildDistribution(rawScores);
  const branchDistribution = new Map<string, Distribution>();
  for (const branch of branchNames) {
    branchDistribution.set(branch, buildDistribution(collectBranchNets(sorted, branch)));
  }

  const classRawValues = new Map<string, number[]>();
  const classBranchValues = new Map<string, number[]>();
  for (const student of sorted) {
    if (student.classId == null) continue;
    pushTo(classRawValues, student.classId, student.rawScore);
    for (const branch of student.branches) {
      pushTo(classBranchValues, classBranchKey(student.classId, branch.branch), branch.net);
    }
  }
  const classTotalDistribution = buildDistributionMap(classRawValues);
  const classBranchDistribution = buildDistributionMap(classBranchValues);

  const context: CohortContext = {
    scale,
    totalDistribution,
    branchDistribution,
    classTotalDistribution,
    classBranchDistribution,
  };

  return {
    count: sorted.length,
    total: {
      meanNet: round4(mean(nets)),
      sdNet: round4(populationSd(nets)),
      meanRawScore: round4(totalDistribution.mean),
      sdRawScore: round4(totalDistribution.sd),
    },
    branches: branchNames.map((branch) => {
      const distribution = branchDistribution.get(branch) ?? buildDistribution([]);
      return {
        branch,
        count: distribution.sortedAsc.length,
        meanNet: round4(distribution.mean),
        sdNet: round4(distribution.sd),
      };
    }),
    students: sorted.map((student) => toStudentStatistics(student, context)),
    _meta: {
      psychometricsVersion,
      standardScore: scale,
    },
  };
}

interface CohortContext {
  scale: StandardScoreScale;
  totalDistribution: Distribution;
  branchDistribution: Map<string, Distribution>;
  classTotalDistribution: Map<string, Distribution>;
  classBranchDistribution: Map<string, Distribution>;
}

function toStudentStatistics(student: CohortStudentInput, context: CohortContext): StudentStatistics {
  const classId = student.classId ?? null;
  const classTotal = classId == null ? null : context.classTotalDistribution.get(classId) ?? buildDistribution([student.rawScore]);
  const branches = [...student.branches]
    .sort((a, b) => a.branch.localeCompare(b.branch))
    .map((branch) => toBranchStatistics(branch, classId, context));

  return {
    studentId: student.studentId,
    classId,
    total: {
      net: round4(student.net),
      rawScore: round4(student.rawScore),
      standardScore: standardize(context.totalDistribution, student.rawScore, context.scale),
      general: scopeRank(context.totalDistribution, student.rawScore),
      class: classTotal == null ? null : scopeRank(classTotal, student.rawScore),
    },
    branches,
  };
}

function toBranchStatistics(branch: CohortBranchInput, classId: string | null, context: CohortContext): BranchStatistics {
  const general = context.branchDistribution.get(branch.branch) ?? buildDistribution([branch.net]);
  const inClass = classId == null ? null : context.classBranchDistribution.get(classBranchKey(classId, branch.branch)) ?? buildDistribution([branch.net]);

  return {
    branch: branch.branch,
    net: round4(branch.net),
    standardScore: standardize(general, branch.net, context.scale),
    general: scopeRank(general, branch.net),
    class: inClass == null ? null : scopeRank(inClass, branch.net),
  };
}

/** Bir kapsamın puan dağılımı: artan sıralı değerler + ortalama + popülasyon std sapması. */
interface Distribution {
  sortedAsc: number[];
  mean: number;
  sd: number;
}

function buildDistribution(values: number[]): Distribution {
  const sortedAsc = [...values].sort((a, b) => a - b);
  const center = mean(values);
  const variance = values.length === 0 ? 0 : values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length;
  return { sortedAsc, mean: center, sd: Math.sqrt(variance) };
}

function buildDistributionMap(valuesByKey: Map<string, number[]>): Map<string, Distribution> {
  const distributions = new Map<string, Distribution>();
  for (const [key, values] of valuesByKey) {
    distributions.set(key, buildDistribution(values));
  }
  return distributions;
}

function scopeRank(distribution: Distribution, value: number): ScopeRank {
  const outOf = distribution.sortedAsc.length;
  const below = lowerBound(distribution.sortedAsc, value);
  const equal = upperBound(distribution.sortedAsc, value) - below;
  return {
    rank: outOf - below - equal + 1,
    outOf,
    percentile: round4(((below + 0.5 * equal) / outOf) * 100),
  };
}

function standardize(distribution: Distribution, value: number, scale: StandardScoreScale): number {
  const z = distribution.sd > 0 ? (value - distribution.mean) / distribution.sd : 0;
  return round4(scale.mean + scale.sd * z);
}

/** İlk `value`'dan küçük olmayan (>=) elemanın indeksi = kesin küçük olanların sayısı. */
function lowerBound(sortedAsc: number[], value: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedAsc[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** İlk `value`'dan büyük (>) elemanın indeksi. upperBound − lowerBound = eşit olanların sayısı. */
function upperBound(sortedAsc: number[], value: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedAsc[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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
  return `${classId} ${branch}`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function populationSd(values: number[]): number {
  if (values.length === 0) return 0;
  const center = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}
