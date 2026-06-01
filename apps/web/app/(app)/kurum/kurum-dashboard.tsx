"use client";

import { ClassCompareBar, ExamResultDonut, LoadingState, ProgressLineChart, TopicRadarChart } from "@uzman-hocam/ui";
import type { ReportSnapshotRecord } from "@uzman-hocam/shared-types";
import { useAuth } from "../../providers.js";
import { useKurumOverviewQuery, useKurumReportSummaryQuery, useKurumStudentProgressQuery } from "./kurum-dashboard-data.js";

export function KurumDashboard() {
  const { auth } = useAuth();
  const accessToken = auth?.accessToken ?? "";
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const examId = "exam-demo";
  const roles = auth?.session.roles.join(", ") ?? "-";
  const overviewQuery = useKurumOverviewQuery(accessToken, tenantId, Boolean(auth));
  const reportQuery = useKurumReportSummaryQuery(accessToken, tenantId, examId, Boolean(auth));
  const firstStudentId = reportQuery.data?.snapshotData?.students?.[0]?.studentId;
  const progressQuery = useKurumStudentProgressQuery(accessToken, tenantId, examId, firstStudentId, Boolean(auth));
  const overview = overviewQuery.data ?? { classCount: 0, teacherCount: 0, studentCount: 0 };
  const examResult = toExamResult(reportQuery.data);
  const classCompare = toClassCompare(reportQuery.data);
  const topicRadar = toTopicRadar(reportQuery.data);
  const progressPoints = progressQuery.data?.points ?? [];

  return (
    <>
      <header className="next-topbar">
        <div>
          <h1>Kurum Paneli</h1>
          <p>Next.js App Router artık gerçek oturum ve Query verisiyle çalışır.</p>
        </div>
      </header>
      {overviewQuery.isPending ? <LoadingState label="Kurum özeti yükleniyor…" /> : null}
      <section className="next-dashboard-grid" aria-label="Kurum özeti">
        <article className="next-metric">
          <span>Sınıf</span>
          <strong>{overview.classCount}</strong>
        </article>
        <article className="next-metric">
          <span>Öğretmen</span>
          <strong>{overview.teacherCount}</strong>
        </article>
        <article className="next-metric">
          <span>Öğrenci</span>
          <strong>{overview.studentCount}</strong>
        </article>
      </section>
      <section className="next-session-panel" aria-label="Oturum özeti">
        <span>{auth?.session.tenantId ?? "-"}</span>
        <span>{auth?.session.userId ?? "-"}</span>
        <span>{roles}</span>
      </section>
      <section className="next-chart-panel" aria-label="Sınav sonuç özeti">
        <div>
          <h2>Sınav Sonuç Özeti</h2>
          <p>{reportQuery.data ? "exam-demo snapshot verisi" : "Hazır rapor bekleniyor"}</p>
        </div>
        <ExamResultDonut result={examResult} />
      </section>
      <section className="next-chart-panel" aria-label="Sınıf karşılaştırması">
        <div>
          <h2>Sınıf Karşılaştırması</h2>
          <p>{classCompare.length > 0 ? "Sınıf ortalama netleri" : "Sınıf raporu bekleniyor"}</p>
        </div>
        <ClassCompareBar classes={classCompare} />
      </section>
      <section className="next-chart-panel" aria-label="Öğrenci gelişimi">
        <div>
          <h2>Öğrenci Gelişimi</h2>
          <p>{progressPoints.length > 0 ? "İlk öğrencinin sınav gelişimi" : "Gelişim verisi bekleniyor"}</p>
        </div>
        <ProgressLineChart points={progressPoints} />
      </section>
      <section className="next-chart-panel" aria-label="Branş analizi">
        <div>
          <h2>Branş Analizi</h2>
          <p>{topicRadar.length > 0 ? "Branş net dağılımı" : "Branş raporu bekleniyor"}</p>
        </div>
        <TopicRadarChart branches={topicRadar} />
      </section>
      {overviewQuery.isError ? <p className="next-form-error">Kurum özeti alınamadı.</p> : null}
      {reportQuery.isError ? <p className="next-form-error">Rapor özeti alınamadı.</p> : null}
      {progressQuery.isError ? <p className="next-form-error">Öğrenci gelişimi alınamadı.</p> : null}
    </>
  );
}

function toExamResult(snapshot: ReportSnapshotRecord | null | undefined) {
  const averages = snapshot?.snapshotData?.averages;
  const studentTotal = snapshot?.snapshotData?.students?.[0]?.total;

  return {
    correct: averages?.correct ?? studentTotal?.correct,
    wrong: averages?.wrong ?? studentTotal?.wrong,
    blank: averages?.blank ?? studentTotal?.blank,
  };
}

function toClassCompare(snapshot: ReportSnapshotRecord | null | undefined) {
  return (snapshot?.snapshotData?.classes ?? []).map((record) => ({
    classId: record.classId,
    className: record.className,
    net: record.averages.net,
    standardScore: record.averages.standardScore,
  }));
}

function toTopicRadar(snapshot: ReportSnapshotRecord | null | undefined) {
  return (snapshot?.snapshotData?.branches ?? []).map((record) => ({
    branch: record.branch,
    net: record.net,
    resultCount: record.resultCount,
  }));
}
