"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  DataTable,
  LoadingState,
  MetricCard,
  Panel,
  StatusBadge,
  type DataTableColumn,
  type StatusBadgeProps,
} from "@uzman-hocam/ui";
import type { ReportSnapshotRecord } from "@uzman-hocam/shared-types";
import { useAuth } from "../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../src/api-client.js";
import {
  type KurumAnnouncementSummary,
  type KurumDecisionSignals,
  type KurumSystemHealthSummary,
  useKurumDashboardDataQuery,
  useKurumStudentProgressQuery,
} from "./kurum-dashboard-data.js";
import { PageFrame } from "./_shared/page-frame.js";
import {
  OperationSummary,
  type OperationSummaryAction,
  type OperationSummaryBadge,
  type OperationSummaryItem,
} from "./_shared/operation-summary.js";
import { canAccessHref } from "../_shared/access.js";
import { formatCourseName, shortCourseName } from "../_shared/academic-labels.js";
import { ClassCompareBar, ExamResultDonut, ProgressLineChart, TopicRadarChart } from "../_shared/lazy-report-charts.js";
import { ReportChartPanel } from "../_shared/report-chart-panel.js";
import { reportQuestionCount, reportSuccessRate } from "../_shared/report-metrics.js";

interface DashboardLinkCard {
  description: string;
  href: string;
  title: string;
  value: number | string;
}

interface DashboardOverviewMetric {
  description: string;
  label: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  value: number | string;
}

interface DashboardSummaryRow extends DashboardLinkCard {
  badge: string;
  tone: StatusBadgeProps["tone"];
}

interface DashboardDecisionRow extends DashboardLinkCard {
  status: string;
  tone: StatusBadgeProps["tone"];
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
  const systemHealth = dashboardQuery.data?.systemHealth ?? {
    apiOk: false,
    postgresOk: false,
    readyOk: false,
    redisOk: false,
  };
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
  const visibleSummaryCards = buildSummaryCards(latestExam?.title, latestSnapshot, announcements, systemHealth).filter((card) =>
    canAccessHref(auth?.session.roles ?? [], card.href),
  );
  const overviewMetrics = buildOverviewMetrics(overview);
  const summaryRows = toSummaryRows(visibleSummaryCards);
  const decisionRows = toDecisionRows(visibleDecisionCards);
  const dashboardSummaryItems = buildDashboardSummaryItems(overview, latestExam?.title, latestSnapshot, systemHealth, visibleDecisionCards);
  const dashboardSummaryBadges = buildDashboardSummaryBadges(latestSnapshot, systemHealth);
  const dashboardSummaryActions = buildDashboardSummaryActions(visibleAttentionItems, latestExam?.title, latestSnapshot, isEmptyInstitution);
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
      <section aria-label="Kurum özeti" className="next-dashboard-overview-grid">
        {overviewMetrics.map((metric) => (
          <MetricCard
            className="next-dashboard-overview-card"
            description={metric.description}
            key={metric.label}
            label={metric.label}
            tone={metric.tone}
            value={metric.value}
          />
        ))}
      </section>
      <OperationSummary
        actions={dashboardSummaryActions}
        ariaLabel="Kurum dashboard operasyon özeti"
        badges={dashboardSummaryBadges}
        items={dashboardSummaryItems}
      />
      {isEmptyInstitution && !isSetupDismissed && !isOnboardingCompleted ? (
        <Panel
          actions={
            <div className="next-dashboard-onboarding__actions">
              <Link className="uh-button uh-button--primary uh-button--md" href="/kurum/kurulum">
                Kuruluma git
              </Link>
              <button className="uh-button uh-button--secondary uh-button--md" type="button" onClick={dismissSetupCard}>
                Daha sonra
              </button>
            </div>
          }
          aria-label="Kurum kurulum başlangıcı"
          className="next-dashboard-onboarding"
          description="Beş adımlı kurulum sihirbazı genel bilgilerden kişi yönetimine kadar ilk düzeni toplar."
          title="Kurumunu kurmaya başla"
          tone="muted"
        />
      ) : null}
      <Panel
        aria-label="Bugün dikkat gerektirenler"
        className="next-attention-panel"
        description="Destek, ödeme, devamsızlık ve optik sinyallerinin kısa listesi."
        title="Bugün dikkat gerektirenler"
        tone={visibleAttentionItems.length > 0 ? "warning" : "default"}
      >
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
      </Panel>
      {visibleSummaryCards.length > 0 ? (
        <Panel
          aria-label="Operasyon özeti"
          className="next-dashboard-summary-panel"
          description="Rapor, duyuru ve sistem sağlığı bağlantıları rol yetkisine göre listelenir."
          title="Operasyon özeti"
        >
          <DataTable
            caption="Operasyon özeti"
            columns={dashboardSummaryColumns}
            density="compact"
            description="Son rapor durumu, kurum duyurusu ve sistem sağlığı görevleri."
            emptyText="Görüntülenebilir operasyon kaydı yok."
            getRowKey={(row) => `${row.href}-${row.title}`}
            rows={summaryRows}
          />
        </Panel>
      ) : null}
      {visibleDecisionCards.length > 0 ? (
        <Panel
          aria-label="Karar sinyalleri"
          className="next-dashboard-decision-panel"
          description="Destek, finans, devamsızlık ve optik işaretleri tek tablo içinde takip edilir."
          title="Karar sinyalleri"
        >
          <DataTable
            caption="Karar sinyalleri"
            columns={dashboardDecisionColumns}
            density="compact"
            description="Aksiyon gerektiren kurum sinyalleri ve modül bağlantıları."
            emptyText="Açık karar sinyali yok."
            getRowKey={(row) => row.href}
            rows={decisionRows}
          />
        </Panel>
      ) : null}
      <Panel aria-label="Oturum özeti" className="next-session-panel" title="Oturum özeti" tone="muted">
        <StatusBadge tone="success">Kurum kapsamı doğrulandı</StatusBadge>
        <StatusBadge tone="success">Kullanıcı oturumu aktif</StatusBadge>
        <StatusBadge tone="info">{formatRoleSummary(auth?.session.roles ?? [])}</StatusBadge>
      </Panel>
      <div className="next-report-visual-grid">
        <ReportChartPanel
          description={reportDescription}
          title="Sınav Sonuç Özeti"
        >
          <ExamResultDonut result={examResult} />
        </ReportChartPanel>
        <ReportChartPanel description={classCompare.length > 0 ? "Sınıf başarı yüzdeleri" : "Sınıf raporu bekleniyor"} title="Sınıf Karşılaştırması">
          <ClassCompareBar classes={classCompare} />
        </ReportChartPanel>
        <ReportChartPanel description={progressPoints.length > 0 ? "İlk öğrencinin başarı gelişimi" : "Gelişim verisi bekleniyor"} title="Öğrenci Gelişimi">
          <ProgressLineChart points={progressPoints} />
        </ReportChartPanel>
        <ReportChartPanel description={topicRadar.length > 0 ? "Branş başarı dağılımı" : "Branş raporu bekleniyor"} title="Branş Analizi">
          <TopicRadarChart branches={topicRadar} />
        </ReportChartPanel>
      </div>
      {dashboardQuery.isError ? <p className="next-form-error">Dashboard verisi alınamadı.</p> : null}
      {progressQuery.isError ? <p className="next-form-error">Öğrenci gelişimi alınamadı.</p> : null}
    </PageFrame>
  );
}

function TenantProfileSummary({ tenant }: { tenant: TenantProfileRecord }) {
  const tenantDisplayName = tenantNameOrFallback(tenant);

  return (
    <Panel
      actions={tenant.contactEmail ? <a href={`mailto:${tenant.contactEmail}`}>{tenant.contactEmail}</a> : null}
      aria-label="Kurum bilgileri"
      className="next-tenant-profile"
      description={institutionTypeLabel(tenant.institutionType)}
      title={tenantDisplayName}
    >
      {tenant.logoUrl ? (
        <img src={tenant.logoUrl} alt={`${tenantDisplayName} logosu`} />
      ) : (
        <span className="next-tenant-profile__placeholder" aria-hidden="true">
          {tenantDisplayName.slice(0, 1).toLocaleUpperCase("tr-TR")}
        </span>
      )}
    </Panel>
  );
}

const dashboardSummaryColumns: Array<DataTableColumn<DashboardSummaryRow>> = [
  {
    header: "Başlık",
    key: "title",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => <DashboardTableLink row={row} />,
    sticky: "left",
  },
  {
    header: "Durum",
    key: "status",
    mobileLabel: "Durum",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => <StatusBadge tone={row.tone}>{row.badge}</StatusBadge>,
  },
];

const dashboardDecisionColumns: Array<DataTableColumn<DashboardDecisionRow>> = [
  {
    header: "Sinyal",
    key: "signal",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => <DashboardTableLink row={row} />,
    sticky: "left",
  },
  {
    header: "Durum",
    key: "status",
    mobileLabel: "Durum",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => <StatusBadge tone={row.tone}>{row.status}</StatusBadge>,
  },
];

function DashboardTableLink({ row }: { row: DashboardLinkCard }) {
  return (
    <Link className="next-dashboard-link-cell" href={row.href}>
      <span>{row.title}</span>
      <strong>{row.value}</strong>
      <small>{row.description}</small>
    </Link>
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

function buildOverviewMetrics(overview: { classCount: number; guardianCount: number; teacherCount: number; studentCount: number }): DashboardOverviewMetric[] {
  return [
    {
      description: "Aktif sınıf yapısı",
      label: "Sınıf",
      value: overview.classCount,
    },
    {
      description: "Eğitim kadrosu",
      label: "Öğretmen",
      value: overview.teacherCount,
    },
    {
      description: "Kayıtlı öğrenci",
      label: "Öğrenci",
      tone: overview.studentCount > 0 ? "success" : "default",
      value: overview.studentCount,
    },
    {
      description: "Veli ilişkisi",
      label: "Veli",
      value: overview.guardianCount,
    },
  ];
}

function buildDashboardSummaryItems(
  overview: { classCount: number; guardianCount: number; teacherCount: number; studentCount: number },
  examTitle: string | undefined,
  snapshot: ReportSnapshotRecord | null | undefined,
  systemHealth: KurumSystemHealthSummary,
  decisionCards: DashboardLinkCard[],
): OperationSummaryItem[] {
  const decisionTotal = decisionCards.reduce((total, card) => total + Number(card.value || 0), 0);

  return [
    {
      description: `${overview.classCount} sınıf · ${overview.teacherCount} öğretmen`,
      key: "institution",
      label: "Kurum kapsamı",
      tone: overview.studentCount > 0 ? "success" : "default",
      value: `${overview.studentCount} öğrenci`,
    },
    {
      description: examTitle ?? "Yayınlanmış sınav yok",
      key: "report",
      label: "Rapor durumu",
      tone: reportStatusTone(examTitle, snapshot),
      value: reportStatusLabel(examTitle, snapshot),
    },
    {
      description: "Rol yetkisine göre görünen iş kuyruğu",
      key: "decisions",
      label: "Karar sinyali",
      tone: decisionTotal > 0 ? "warning" : "success",
      value: decisionTotal,
    },
    {
      description: systemHealthDescription(systemHealth),
      key: "health",
      label: "Sistem sağlığı",
      tone: systemHealthOperationTone(systemHealth),
      value: systemHealthStatusLabel(systemHealth),
    },
  ];
}

function buildDashboardSummaryBadges(
  snapshot: ReportSnapshotRecord | null | undefined,
  systemHealth: KurumSystemHealthSummary,
): OperationSummaryBadge[] {
  return [
    {
      key: "success-rate",
      label: "Başarı % ana metrik",
      tone: "info",
    },
    {
      key: "report-ready",
      label: snapshot?.status === "READY" ? "READY rapor" : "Rapor bekliyor",
      tone: snapshot?.status === "READY" ? "success" : "warning",
    },
    {
      key: "health",
      label: systemHealthStatusLabel(systemHealth),
      tone: systemHealthBadgeTone(systemHealth),
    },
    {
      key: "tenant-scope",
      label: "Tenant scope doğrulandı",
      tone: "success",
    },
  ];
}

function buildDashboardSummaryActions(
  attentionItems: DashboardLinkCard[],
  examTitle: string | undefined,
  snapshot: ReportSnapshotRecord | null | undefined,
  isEmptyInstitution: boolean,
): OperationSummaryAction[] {
  return [
    {
      detail: "Destek, finans, devamsızlık ve optik izleri",
      key: "attention",
      label: "Dikkat kuyruğu",
      status: attentionItems.length > 0 ? "İzle" : "Sakin",
      tone: attentionItems.length > 0 ? "warning" : "success",
      value: attentionItems.length > 0 ? `${attentionItems.length} başlık` : "Temiz",
    },
    {
      detail: examTitle ?? "Sınav bağlamı yok",
      key: "report",
      label: "Rapor üretimi",
      status: snapshot?.status === "READY" ? "Hazır" : "Kontrol",
      tone: reportStatusBadgeTone(examTitle, snapshot),
      value: reportStatusLabel(examTitle, snapshot),
    },
    {
      detail: "İlk veri girişi ve kişi ağacı",
      key: "setup",
      label: "Kurulum",
      status: isEmptyInstitution ? "Sihirbaz" : "Tamam",
      tone: isEmptyInstitution ? "info" : "success",
      value: isEmptyInstitution ? "Başlangıç" : "Aktif",
    },
  ];
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
  systemHealth: KurumSystemHealthSummary,
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
    {
      title: "Sistem sağlığı",
      value: systemHealthStatusLabel(systemHealth),
      description: systemHealthDescription(systemHealth),
      href: "/kurum/sistem-sagligi",
    },
  ];
}

function toSummaryRows(cards: DashboardLinkCard[]): DashboardSummaryRow[] {
  return cards.map((card) => ({
    ...card,
    badge: summaryCardBadge(card),
    tone: summaryCardTone(card),
  }));
}

function toDecisionRows(cards: DashboardLinkCard[]): DashboardDecisionRow[] {
  return cards.map((card) => ({
    ...card,
    status: Number(card.value) > 0 ? "İşlem bekliyor" : "Sakin",
    tone: Number(card.value) > 0 ? "warning" : "success",
  }));
}

function summaryCardBadge(card: DashboardLinkCard) {
  if (card.title === "Son sınav / rapor") return String(card.value);
  if (card.title === "Sistem sağlığı") return String(card.value);
  if (card.title === "Son duyuru") return card.value === "Duyuru yok" ? "Bekliyor" : "Yayında";
  return "İzle";
}

function summaryCardTone(card: DashboardLinkCard): StatusBadgeProps["tone"] {
  if (card.title === "Son sınav / rapor") {
    if (card.value === "Rapor hazır") return "success";
    if (card.value === "Rapor bekliyor") return "warning";
    return "neutral";
  }
  if (card.title === "Sistem sağlığı") {
    if (card.value === "Hazır") return "success";
    if (card.value === "Kısıtlı") return "warning";
    return "danger";
  }
  if (card.title === "Son duyuru") return card.value === "Duyuru yok" ? "neutral" : "info";
  return "neutral";
}

function systemHealthStatusLabel(systemHealth: KurumSystemHealthSummary) {
  if (systemHealth.apiOk && systemHealth.readyOk && systemHealth.postgresOk && systemHealth.redisOk) return "Hazır";
  if (systemHealth.apiOk || systemHealth.readyOk) return "Kısıtlı";
  return "Sorunlu";
}

function systemHealthDescription(systemHealth: KurumSystemHealthSummary) {
  const dependencies = [
    systemHealth.postgresOk ? "Postgres hazır" : "Postgres kontrol",
    systemHealth.redisOk ? "Redis hazır" : "Redis kontrol",
  ];
  return `${systemHealth.apiOk ? "API çalışıyor" : "API kontrol"} · ${dependencies.join(" · ")}`;
}

function reportStatusLabel(examTitle: string | undefined, snapshot: ReportSnapshotRecord | null | undefined) {
  if (!examTitle) return "Sınav yok";
  if (!snapshot) return "Rapor bekliyor";
  if (snapshot.status === "READY") return "Rapor hazır";
  return snapshot.status;
}

function reportStatusTone(
  examTitle: string | undefined,
  snapshot: ReportSnapshotRecord | null | undefined,
): OperationSummaryItem["tone"] {
  if (!examTitle) return "default";
  if (!snapshot) return "warning";
  if (snapshot.status === "READY") return "success";
  return "info";
}

function reportStatusBadgeTone(
  examTitle: string | undefined,
  snapshot: ReportSnapshotRecord | null | undefined,
): StatusBadgeProps["tone"] {
  if (!examTitle) return "neutral";
  if (!snapshot) return "warning";
  if (snapshot.status === "READY") return "success";
  return "info";
}

function systemHealthOperationTone(systemHealth: KurumSystemHealthSummary): OperationSummaryItem["tone"] {
  if (systemHealth.apiOk && systemHealth.readyOk && systemHealth.postgresOk && systemHealth.redisOk) return "success";
  if (systemHealth.apiOk || systemHealth.readyOk) return "warning";
  return "danger";
}

function systemHealthBadgeTone(systemHealth: KurumSystemHealthSummary): StatusBadgeProps["tone"] {
  if (systemHealth.apiOk && systemHealth.readyOk && systemHealth.postgresOk && systemHealth.redisOk) return "success";
  if (systemHealth.apiOk || systemHealth.readyOk) return "warning";
  return "danger";
}

function formatRoleSummary(roles: string[]) {
  if (roles.length === 0) return "Rol bilgisi yok";
  if (roles.length === 1) return "1 rol doğrulandı";
  return `${roles.length} rol doğrulandı`;
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
    net: averages?.net ?? studentTotal?.net,
    questionCount: averages?.questionCount ?? studentTotal?.questionCount ?? reportQuestionCount(averages ?? studentTotal),
    successRate: averages?.successRate ?? studentTotal?.successRate ?? reportSuccessRate(averages ?? studentTotal),
  };
}

function toClassCompare(snapshot: ReportSnapshotRecord | null | undefined) {
  return (snapshot?.snapshotData?.classes ?? []).map((record) => ({
    classId: record.classId,
    className: record.className,
    net: record.averages.net,
    questionCount: record.averages.questionCount ?? reportQuestionCount(record.averages),
    standardScore: record.averages.standardScore,
    successRate: record.averages.successRate ?? reportSuccessRate(record.averages),
  }));
}

function toTopicRadar(snapshot: ReportSnapshotRecord | null | undefined) {
  return (snapshot?.snapshotData?.branches ?? []).map((record) => ({
    branch: formatCourseName(record.branch),
    chartLabel: shortCourseName(record.branch),
    blank: record.blank,
    correct: record.correct,
    net: record.net,
    questionCount: record.questionCount ?? reportQuestionCount(record),
    resultCount: record.resultCount,
    successRate: record.successRate ?? reportSuccessRate(record),
    wrong: record.wrong,
  }));
}
