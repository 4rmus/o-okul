"use client";

import { type FormEvent, useState } from "react";
import { Button, Input } from "@uzman-hocam/ui";
import type {
  ReportErrorBooklet,
  ReportSnapshotExportResult,
  ReportSnapshotRecord,
  ReportStudentProgress,
} from "@uzman-hocam/shared-types";
import { Download, RefreshCw } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { firstFormError, reportQueryFormSchema } from "../../../../src/form-validation.js";

interface ReportData {
  snapshots: ReportSnapshotRecord[];
  studentProgress: ReportStudentProgress | null;
  errorBooklet: ReportErrorBooklet | null;
}

export function ReportsPage() {
  const { auth } = useAuth();
  const [examId, setExamId] = useState("exam-demo");
  const [loadedExamId, setLoadedExamId] = useState("exam-demo");
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const latestSnapshot = reportData?.snapshots[0] ?? null;

  async function loadReports(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = reportQueryFormSchema.safeParse({ examId });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      setReportData(await loadReportData(auth.accessToken, parsedForm.data.examId));
      setLoadedExamId(parsedForm.data.examId);
    } catch {
      setReportData(null);
      setError("Rapor alınamadı.");
    }
  }

  async function exportReport(kind: "xlsx" | "pdf") {
    if (!auth || !latestSnapshot) return;

    setError("");
    try {
      const result = kind === "xlsx"
        ? await exportReportSnapshotExcel(auth.accessToken, loadedExamId, latestSnapshot.id)
        : await exportReportSnapshotPdf(auth.accessToken, loadedExamId, latestSnapshot.id);
      downloadBase64File(result);
    } catch {
      setError("Rapor çıktısı alınamadı.");
    }
  }

  return (
    <>
      <form className="next-support-tool" onSubmit={(event) => void loadReports(event)}>
        <h1>Sınav Raporu</h1>
        <label>
          Rapor sınav ID
          <Input required value={examId} onChange={(event) => setExamId(event.target.value)} />
        </label>
        {error ? <p className="uh-crud-page__error">{error}</p> : null}
        <Button type="submit">
          <RefreshCw size={17} aria-hidden="true" />
          Raporu getir
        </Button>
      </form>
      <section className="next-report-panel" aria-label="Rapor özeti">
        <h2>Rapor Özeti</h2>
        {latestSnapshot ? (
          <>
            <div className="next-dashboard-grid">
              <article className="next-metric">
                <span>Durum</span>
                <strong>{latestSnapshot.status}</strong>
              </article>
              <article className="next-metric">
                <span>Sonuç</span>
                <strong>{latestSnapshot.snapshotData?.resultCount ?? "-"}</strong>
              </article>
              <article className="next-metric">
                <span>Ortalama net</span>
                <strong>{formatNumber(latestSnapshot.snapshotData?.averages?.net)}</strong>
              </article>
              <article className="next-metric">
                <span>Standart puan</span>
                <strong>{formatNumber(latestSnapshot.snapshotData?.averages?.standardScore)}</strong>
              </article>
            </div>
            <section className="next-report-list" aria-label="Sınıf ve branş özeti">
              {(latestSnapshot.snapshotData?.branches ?? []).map((branch) => (
                <p key={branch.branch}>{branch.branch}: {formatNumber(branch.net)} net</p>
              ))}
              {(latestSnapshot.snapshotData?.classes ?? []).map((classSummary) => (
                <p key={classSummary.classId ?? "no-class"}>
                  {classSummary.className ?? "Sınıfsız"}: {formatNumber(classSummary.averages.net)} net
                </p>
              ))}
            </section>
            <section className="next-report-list" aria-label="Öğrenci gelişimi">
              <h3>Öğrenci gelişimi</h3>
              <p>{formatTrend(reportData?.studentProgress)}</p>
              {(reportData?.studentProgress?.points ?? []).map((point) => (
                <p key={point.snapshotId}>{formatNumber(point.total.net)}</p>
              ))}
            </section>
            {reportData?.errorBooklet ? (
              <section className="next-report-list" aria-label="Hata kitapçığı">
                <h3>Hata kitapçığı</h3>
                <p>{reportData.errorBooklet.items.length} soru</p>
                {reportData.errorBooklet.items.map((item) => (
                  <p key={`${item.questionNo}-${item.status}`}>
                    {item.questionNo}. soru {item.status === "BLANK" ? "Boş" : `Yanıt ${item.answer}`} Doğru {item.correctAnswer}
                  </p>
                ))}
              </section>
            ) : null}
            <div className="next-report-actions">
              <Button onClick={() => void exportReport("xlsx")}>
                <Download size={17} aria-hidden="true" />
                Excel indir
              </Button>
              <Button onClick={() => void exportReport("pdf")}>
                <Download size={17} aria-hidden="true" />
                PDF indir
              </Button>
            </div>
          </>
        ) : (
          <p>Hazır rapor yok</p>
        )}
      </section>
    </>
  );
}

async function loadReportData(accessToken: string, examId: string): Promise<ReportData> {
  const snapshots = await apiRequest<ReportSnapshotRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots`,
  );
  const latestSnapshot = snapshots[0];
  const studentId = latestSnapshot?.snapshotData?.students?.[0]?.studentId;

  if (!latestSnapshot || !studentId) {
    return { snapshots, studentProgress: null, errorBooklet: null };
  }

  const [studentProgress, errorBooklet] = await Promise.all([
    apiRequest<ReportStudentProgress>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/progress`,
    ).catch(() => null),
    apiRequest<ReportErrorBooklet>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(latestSnapshot.id)}/students/${encodeURIComponent(studentId)}/error-booklet`,
    ).catch(() => null),
  ]);

  return { snapshots, studentProgress, errorBooklet };
}

async function exportReportSnapshotExcel(accessToken: string, examId: string, snapshotId: string) {
  return apiRequest<ReportSnapshotExportResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/export.xlsx`,
  );
}

async function exportReportSnapshotPdf(accessToken: string, examId: string, snapshotId: string) {
  return apiRequest<ReportSnapshotExportResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/export.pdf`,
  );
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
}

function formatTrend(progress: ReportStudentProgress | null | undefined) {
  if (!progress) return "-";
  const net = progress.netDelta === undefined ? "-" : `${progress.netDelta > 0 ? "+" : ""}${formatNumber(progress.netDelta)} net`;
  const score = progress.standardScoreDelta === undefined
    ? "-"
    : `${progress.standardScoreDelta > 0 ? "+" : ""}${formatNumber(progress.standardScoreDelta)} puan`;
  if (net === "-") return score;
  if (score === "-") return net;
  return `${net} / ${score}`;
}

function downloadBase64File(file: ReportSnapshotExportResult): void {
  const binary = atob(file.fileBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}
