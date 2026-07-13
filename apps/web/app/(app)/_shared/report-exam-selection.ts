export const reportExamIdSearchParam = "examId";

interface ReportExamParamReader {
  get(name: string): string | null;
}

export function readReportExamId(searchParams: ReportExamParamReader, fallback = "") {
  return normalizeReportExamId(searchParams.get(reportExamIdSearchParam), fallback);
}

export function normalizeReportExamId(value: string | null | undefined, fallback = "") {
  return value?.trim() || fallback;
}
