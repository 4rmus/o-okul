export const fallbackReportExamId = "exam-demo-isem-lgs-1";
export const reportExamIdSearchParam = "examId";

interface ReportExamParamReader {
  get(name: string): string | null;
}

export function readReportExamId(searchParams: ReportExamParamReader, fallback = fallbackReportExamId) {
  return normalizeReportExamId(searchParams.get(reportExamIdSearchParam), fallback);
}

export function normalizeReportExamId(value: string | null | undefined, fallback = fallbackReportExamId) {
  return value?.trim() || fallback;
}
