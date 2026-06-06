"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { LoadingState } from "@uzman-hocam/ui";
import type { ReportSnapshotRecord } from "@uzman-hocam/shared-types";
import { useAuth } from "../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../src/api-client.js";
import {
  type KurumAnnouncementSummary,
  type KurumDecisionSignals,
  useKurumDashboardDataQuery,
  useKurumStudentProgressQuery,
} from "./kurum-dashboard-data.js";
import { PageFrame } from "./_shared/page-frame.js";
import { MetricPanelGrid } from "./_shared/metric-panel-grid.js";
import { canAccessHref } from "../_shared/access.js";
import { ClassCompareBar, ExamResultDonut, ProgressLineChart, TopicRadarChart } from "../_shared/lazy-report-charts.js";
import { ReportChartPanel } from "../_shared/report-chart-panel.js";

interface DashboardLinkCard {
  description: string;
  href: string;
  title: string;
  value: number | string;
}

interface TenantProfileRecord {
  contactEmail?: string;
  id: string;
  institutionType?: string;
  logoUrl?: string;
  name?: string;
}

export function KurumDashboard() {
  const { auth } = useAuth();
  const accessToken = auth?.accessToken ?? "";
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const roles = auth?.session.roles.join(", ") ?? "-";
  const dashboardQuery = useKurumDashboardDataQuery(accessToken, tenantId, Boolean(auth));
  const tenantProfileQuery = useQuery({
    queryKey: ["next-current-tenant", tenantId],
    queryFn: () => loadCurrentTenant(accessToken),
    enabled: Boolean(auth),
  });
  const tenantProfile = tenantProfileQuery.data ?? null;
  const tenantDisplayName = tenantProfile ? tenantNameOrFallback(tenantProfile) : "Kurum Paneli";
  const latestExam = dashboardQuery.data?.report.exam ?? null;
  const latestSnapshot = dashboardQuery.data?.report.snapshot ?? null;
  const firstStudentId = latestSnapshot?.snapshotData?.students?.[0]?.studentId;
  const progressQuery = useKurumStudentProgressQuery(accessToken, tenantId, latestSnapshot?.examId ?? "", firstStudentId, Boolean(auth));
  const overview = dashboardQuery.data?.overview ?? { classCount: 0, guardianCount: 0, teacherCount: 0, studentCount: 0 };
  const decisionSignals = dashboardQuery.data?.decisionSignals ?? {
    attendanceAlerts: 0,
    openImportQuarantines: 0,
    openSupportTickets: 0,
    overdueInstallments: 0,
  };
  const announcements = dashboardQuery.data?.announcements ?? { publishedCount: 0 };
  const examResult = toExamResult(latestSnapshot);
  const classCompare = toClassCompare(latestSnapshot);
  const topicRadar = toTopicRadar(latestSnapshot);
  const progressPoints = progressQuery.data?.points ?? [];
  const reportDescription = resolveReportDescription(dashboardQuery.isPending, latestExam?.title, latestSnapshot);
  const isEmptyInstitution =
    !dashboardQuery.isPending &&
    overview.classCount === 0 &&
    overview.guardianCount === 0 &&
    overview.teacherCount === 0 &&
    overview.studentCount === 0;
  const visibleDecisionCards = buildDecisionCards(decisionSignals).filter((card) =>
    canAccessHref(auth?.session.roles ?? [], card.href),
  );
  const visibleAttentionItems = buildAttentionItems(decisionSignals, latestExam?.title, latestSnapshot).filter((item) =>
    canAccessHref(auth?.session.roles ?? [], item.href),
  );
  const visibleSummaryCards = buildSummaryCards(latestExam?.title, latestSnapshot, announcements).filter((card) =>
    canAccessHref(auth?.session.roles ?? [], card.href),
  );
  const [isSetupDismissed, setIsSetupDismissed] = useState(false);
  const [isOnboardingCompleted, setIsOnboardingCompleted] = useState(false);
  const setupDismissedCookieName = `uh_setup_${encodeURIComponent(tenantId)}_dismissed`;
  const onboardingCompletedCookieName = `uh_onboarding_${encodeURIComponent(tenantId)}_completed`;

  useEffect(() => {
    if (!auth) return;
    setIsSetupDismissed(readSetupDismissed(setupDismissedCookieName));
    setIsOnboardingCompleted(readSetupDismissed(onboardingCompletedCookieName));
  }, [auth, onboardingCompletedCookieName, setupDismissedCookieName]);

  function dismissSetupCard() {
    setIsSetupDismissed(true);
    writeSetupDismissed(setupDismissedCookieName);
  }

  return (
      <PageFrame
        title={tenantDisplayName}
        subtitle="Kurumsal özetin ve son sınav analizlerinin tek ekranda görünümü."
      >
      {dashboardQuery.isPending ? <LoadingState label="Kurum özeti yükleniyor…" /> : null}
      {tenantProfile ? <TenantProfileSummary tenant={tenantProfile} /> : null}
      <MetricPanelGrid
        ariaLabel="Kurum özeti"
        metrics={[
          { label: "Sınıf", value: overview.classCount },
          { label: "Öğretmen", value: overview.teacherCount },
          { label: "Öğrenci", value: overview.studentCount },
          { label: "Veli", value: overview.guardianCount },
        ]}
      />
      {isEmptyInstitution && !isSetupDismissed && !isOnboardingCompleted ? (
        <section className="next-dashboard-onboarding" aria-label="Kurum kurulum başlangıcı">
          <div>
            <h2>Kurumunu kurmaya başla</h2>
            <p>Beş adımlı kurulum sihirbazı genel bilgilerden kişi yönetimine kadar ilk düzeni toplar.</p>
          </div>
          <div className="next-dashboard-onboarding__actions">
            <Link className="uh-button uh-button--primary uh-button--md" href="/kurum/kurulum">
              Sihirbazı aç
            </Link>
            <button className="uh-button uh-button--secondary uh-button--md" type="button" onClick={dismissSetupCard}>
              Daha sonra
            </button>
          </div>
        </section>
      ) : null}
      <section className="next-attention-panel" aria-label="Bugün dikkat gerektirenler">
        <div>
          <h2>Bugün dikkat gerektirenler</h2>
          <p>Destek, ödeme, devamsızlık ve optik sinyallerinin kısa listesi.</p>
        </div>
        {visibleAttentionItems.length > 0 ? (
          <div className="next-attention-list">
            {visibleAttentionItems.map((item) => (
              <Link className="next-attention-item" href={item.href} key={item.href}>
                <span>{item.title}</span>
                <strong>{item.value}</strong>
                <small>{item.description}</small>
              </Link>
            ))}
          </div>
        ) : (
          <p className="next-attention-empty">Açık kritik iş görünmüyor.</p>
        )}
      </section>
      {visibleSummaryCards.length > 0 ? (
        <section className="next-dashboard-summary-grid" aria-label="Güncel özet">
          {visibleSummaryCards.map((card) => (
            <SummaryCard key={card.href} {...card} />
          ))}
        </section>
      ) : null}
      {visibleDecisionCards.length > 0 ? (
        <section className="next-decision-strip" aria-label="Karar sinyalleri">
          {visibleDecisionCards.map((card) => (
            <DecisionSignalCard key={card.href} {...card} />
          ))}
        </section>
      ) : null}
      <section className="next-session-panel" aria-label="Oturum özeti">
        <span>{auth?.session.tenantId ?? "-"}</span>
        <span>{auth?.session.userId ?? "-"}</span>
        <span>{roles}</span>
      </section>
      <div className="next-report-visual-grid">
        <ReportChartPanel
          description={reportDescription}
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
      {dashboardQuery.isError ? <p className="next-form-error">Dashboard verisi alınamadı.</p> : null}
      {progressQuery.isError ? <p className="next-form-error">Öğrenci gelişimi alınamadı.</p> : null}
    </PageFrame>
  );
}

function SummaryCard({
  description,
  href,
  title,
  value,
}: {
  description: string;
  href: string;
  title: string;
  value: string;
}) {
  return (
    <Link className="next-dashboard-summary-card" href={href}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{description}</small>
    </Link>
  );
}

function DecisionSignalCard({
  description,
  href,
  title,
  value,
}: {
  description: string;
  href: string;
  title: string;
  value: number | string;
}) {
  return (
    <Link className="next-decision-card" href={href}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{description}</small>
    </Link>
  );
}

function TenantProfileSummary({ tenant }: { tenant: TenantProfileRecord }) {
  const tenantDisplayName = tenantNameOrFallback(tenant);

  return (
    <section className="next-tenant-profile" aria-label="Kurum bilgileri">
      {tenant.logoUrl ? (
        <img src={tenant.logoUrl} alt={`${tenantDisplayName} logosu`} />
      ) : (
        <span className="next-tenant-profile__placeholder" aria-hidden="true">
          {tenantDisplayName.slice(0, 1).toLocaleUpperCase("tr-TR")}
        </span>
      )}
      <div>
        <h2>{tenantDisplayName}</h2>
        <p>{institutionTypeLabel(tenant.institutionType)}</p>
      </div>
      {tenant.contactEmail ? <a href={`mailto:${tenant.contactEmail}`}>{tenant.contactEmail}</a> : null}
    </section>
  );
}

function loadCurrentTenant(accessToken: string) {
  return apiRequest<TenantProfileRecord>(accessToken, `${apiBaseUrl}/me/tenant`);
}

function tenantNameOrFallback(tenant: TenantProfileRecord) {
  return tenant.name?.trim() || "Kurum Paneli";
}

function institutionTypeLabel(value: string | undefined) {
  if (value === "school") return "Okul";
  if (value === "study-center") return "Etüt merkezi";
  return "Kurs merkezi";
}

function buildDecisionCards(decisionSignals: KurumDecisionSignals): DashboardLinkCard[] {
  return [
    {
      title: "Bekleyen destek",
      value: decisionSignals.openSupportTickets,
      description: decisionSignals.openSupportTickets > 0 ? "Yanıt bekleyen talep var" : "Açık talep yok",
      href: "/kurum/destek",
    },
    {
      title: "Geciken ödeme",
      value: decisionSignals.overdueInstallments,
      description: decisionSignals.overdueInstallments > 0 ? "Tahsilat kontrolü gerekiyor" : "Geciken taksit yok",
      href: "/kurum/finans",
    },
    {
      title: "Devamsızlık",
      value: decisionSignals.attendanceAlerts,
      description: decisionSignals.attendanceAlerts > 0 ? "Yoklama takibi gerekiyor" : "Kritik kayıt yok",
      href: "/kurum/devamsizlik",
    },
    {
      title: "Optik kontrol",
      value: decisionSignals.openImportQuarantines,
      description: decisionSignals.openImportQuarantines > 0 ? "Karantina çözümü gerekiyor" : "Açık karantina yok",
      href: "/kurum/optik",
    },
  ];
}

function buildAttentionItems(
  decisionSignals: KurumDecisionSignals,
  examTitle: string | undefined,
  snapshot: ReportSnapshotRecord | null | undefined,
) {
  const items = buildDecisionCards(decisionSignals).filter((item) => Number(item.value) > 0);

  if (examTitle && !snapshot) {
    items.push({
      title: "Rapor üretimi",
      value: "Bekliyor",
      description: `${examTitle} için hazır rapor bulunamadı`,
      href: "/kurum/raporlar",
    });
  }

  return items;
}

function buildSummaryCards(
  examTitle: string | undefined,
  snapshot: ReportSnapshotRecord | null | undefined,
  announcements: KurumAnnouncementSummary,
) {
  return [
    {
      title: "Son sınav / rapor",
      value: reportStatusLabel(examTitle, snapshot),
      description: snapshot?.snapshotData?.resultCount
        ? `${snapshot.snapshotData.resultCount} öğrenci sonucu raporda`
        : "Rapor ekranından üretim durumunu takip et",
      href: "/kurum/raporlar",
    },
    {
      title: "Son duyuru",
      value: announcements.latestTitle ?? "Duyuru yok",
      description: announcements.latestPublishedAt
        ? `${formatDate(announcements.latestPublishedAt)} · toplam ${announcements.publishedCount} duyuru`
        : "Henüz yayınlanmış duyuru yok",
      href: "/kurum/duyurular",
    },
  ];
}

function reportStatusLabel(examTitle: string | undefined, snapshot: ReportSnapshotRecord | null | undefined) {
  if (!examTitle) return "Sınav yok";
  if (!snapshot) return "Rapor bekliyor";
  if (snapshot.status === "READY") return "Rapor hazır";
  return snapshot.status;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("tr-TR");
}

function resolveReportDescription(isPending: boolean, examTitle: string | undefined, snapshot: ReportSnapshotRecord | null) {
  if (isPending) return "Rapor aranıyor";
  if (!examTitle) return "Henüz yayınlanmış sınav yok";
  if (!snapshot) return "Hazır rapor yok";
  return `${examTitle} raporu`;
}

function readSetupDismissed(name: string) {
  if (typeof window === "undefined") return false;
  return readCookie(name) === "true";
}

function writeSetupDismissed(name: string) {
  if (typeof window === "undefined") return;
  writeCookie(name, "true");
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  const match = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : "";
}

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
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
