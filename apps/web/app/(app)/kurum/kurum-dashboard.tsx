"use client";

import { ClassCompareBar, ExamResultDonut, LoadingState, ProgressLineChart, TopicRadarChart } from "@uzman-hocam/ui";
import type { ReportSnapshotRecord } from "@uzman-hocam/shared-types";
import { useAuth } from "../../providers.js";
import { useKurumOverviewQuery, useKurumReportSummaryQuery, useKurumStudentProgressQuery } from "./kurum-dashboard-data.js";
import { PageFrame } from "./_shared/page-frame.js";
import { MetricPanelGrid } from "./_shared/metric-panel-grid.js";
import { ReportChartPanel } from "../_shared/report-chart-panel.js";

export function KurumDashboard() {
  const { auth } = useAuth();
  const accessToken = auth?.accessToken ?? "";
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const examId = "exam-demo-isem-lgs-1";
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
      <PageFrame title="Kurum Paneli" subtitle="Kurumsal özetin ve son sınav analizlerinin tek ekranda görünümü.">
      {overviewQuery.isPending ? <LoadingState label="Kurum özeti yükleniyor…" /> : null}
      <MetricPanelGrid
        ariaLabel="Kurum özeti"
        metrics={[
          { label: "Sınıf", value: overview.classCount },
          { label: "Öğretmen", value: overview.teacherCount },
          { label: "Öğrenci", value: overview.studentCount },
        ]}
      />
      <section className="next-session-panel" aria-label="Oturum özeti">
        <span>{auth?.session.tenantId ?? "-"}</span>
        <span>{auth?.session.userId ?? "-"}</span>
        <span>{roles}</span>
      </section>
      <div className="next-report-visual-grid">
        <ReportChartPanel
          description={reportQuery.data ? "İSEM LGS-1 sınav raporu" : "Hazır rapor bekleniyor"}
          title="Sınav Sonuç Özeti"
        >
          <ExamResultDonut result={examResult} />
        </ReportChartPanel>
        <ReportChartPanel description={classCompare.length > 0 ? "Sınıf ortalama netleri" : "Sınıf raporu bekleniyor"} title="Sınıf Karşılaştırması">
          <ClassCompareBar classes={classCompare} />
        </ReportChartPanel>
        <ReportChartPanel description={progressPoints.length > 0 ? "İlk öğrencinin sınav gelişimi" : "Gelişim verisi bekleniyor"} title="Öğrenci Gelişimi">
          <ProgressLineChart points={progressPoints} />
        </ReportChartPanel>
        <ReportChartPanel description={topicRadar.length > 0 ? "Branş net dağılımı" : "Branş raporu bekleniyor"} title="Branş Analizi">
          <TopicRadarChart branches={topicRadar} />
        </ReportChartPanel>
      </div>
      {overviewQuery.isError ? <p className="next-form-error">Kurum özeti alınamadı.</p> : null}
      {reportQuery.isError ? <p className="next-form-error">Rapor özeti alınamadı.</p> : null}
      {progressQuery.isError ? <p className="next-form-error">Öğrenci gelişimi alınamadı.</p> : null}
    </PageFrame>
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
