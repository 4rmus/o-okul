export interface ReportMetricSource {
  blank?: number;
  correct?: number;
  net?: number;
  questionCount?: number;
  successRate?: number;
  wrong?: number;
}

export function reportQuestionCount(value: ReportMetricSource | null | undefined): number | undefined {
  if (!value) return undefined;
  if (isFiniteNumber(value.questionCount)) return value.questionCount;
  if (!isFiniteNumber(value.correct) || !isFiniteNumber(value.wrong) || !isFiniteNumber(value.blank)) return undefined;
  return roundReportMetric(value.correct + value.wrong + value.blank);
}

export function reportSuccessRate(value: ReportMetricSource | null | undefined): number | undefined {
  if (!value) return undefined;
  if (isFiniteNumber(value.successRate)) return value.successRate;
  const questionCount = reportQuestionCount(value);
  if (!isFiniteNumber(value.net) || !questionCount || questionCount <= 0) return undefined;
  return roundReportMetric((value.net / questionCount) * 100);
}

export function clampSuccessRate(value: number | undefined): number {
  if (!isFiniteNumber(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function formatPercentNumber(value: number | undefined): string {
  return value === undefined
    ? "-"
    : `%${value.toLocaleString("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`;
}

export function formatPercentDelta(value: number | undefined): string {
  if (value === undefined) return "-";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const magnitude = Math.abs(value).toLocaleString("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return `${sign}%${magnitude}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundReportMetric(value: number): number {
  return Number(value.toFixed(4));
}
