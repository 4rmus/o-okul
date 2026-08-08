"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActionCard, Button, LoadingState, Panel, StatusBadge } from "@o-okul/ui";
import type { InstitutionDashboardSummary } from "@o-okul/shared-types";
import { useAuth } from "../../providers.js";
import { canAccessHref } from "../_shared/access.js";
import { ClassCompareBar } from "../_shared/lazy-report-charts.js";
import { ReportChartPanel } from "../_shared/report-chart-panel.js";
import { PageFrame } from "./_shared/page-frame.js";
import { OperationSummary, type OperationSummaryItem } from "./_shared/operation-summary.js";
import { useKurumAnnouncementsQuery, useKurumDashboardDataQuery } from "./kurum-dashboard-data.js";

interface DashboardAttentionItem {
  description: string;
  href: string;
  title: string;
  value: number | string;
}

const emptyDashboard: InstitutionDashboardSummary = {
  generatedAt: "",
  institution: { name: "Kurum Paneli" },
  activeStudentCount: 0,
  attention: {
    attendanceAlertCount: 0,
    openImportQuarantineCount: 0,
    openSupportTicketCount: 0,
  },
};

export function KurumDashboard() {
  const { auth } = useAuth();
  const accessToken = auth?.accessToken ?? "";
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const dashboardQuery = useKurumDashboardDataQuery(accessToken, tenantId, Boolean(auth));
  const announcementsQuery = useKurumAnnouncementsQuery(accessToken, tenantId, Boolean(auth));
  const dashboard = dashboardQuery.data ?? emptyDashboard;
  const announcements = announcementsQuery.data?.data ?? [];
  const latestExam = dashboard.latestExam;
  const latestReport = latestExam?.report;
  const attentionItems = buildAttentionItems(dashboard)
    .filter((item) => canAccessHref(auth?.session.roles ?? [], item.href))
    .slice(0, 3);
  const attentionTotal = totalAttention(dashboard);
  const [isSetupDismissed, setIsSetupDismissed] = useState(false);
  const setupDismissedCookieName = `uh_setup_${encodeURIComponent(tenantId)}_dismissed`;
  const classCompare = (latestReport?.classes ?? []).map((record) => ({
    ...(record.classId ? { classId: record.classId } : {}),
    ...(record.className ? { className: record.className } : {}),
    ...(record.net !== undefined ? { net: record.net } : {}),
    ...(record.questionCount !== undefined ? { questionCount: record.questionCount } : {}),
    ...(record.successRate !== undefined ? { successRate: record.successRate } : {}),
  }));

  useEffect(() => {
    if (!auth) return;
    setIsSetupDismissed(readCookie(setupDismissedCookieName) === "true");
  }, [auth, setupDismissedCookieName]);

  function dismissSetupCard() {
    setIsSetupDismissed(true);
    writeCookie(setupDismissedCookieName, "true");
  }

  if (dashboardQuery.isPending && !dashboardQuery.data) {
    return (
      <PageFrame
        title="Kurum Paneli"
        subtitle="Öğrenci gelişimini, son sınav katılımını ve destek bekleyen işleri tek yerde izleyin."
      >
        <LoadingState label="Kurum başarı görünümü yükleniyor…" />
      </PageFrame>
    );
  }

  if (dashboardQuery.isError && !dashboardQuery.data) {
    return (
      <PageFrame
        title="Kurum Paneli"
        subtitle="Öğrenci gelişimini, son sınav katılımını ve destek bekleyen işleri tek yerde izleyin."
      >
        <Panel
          actions={<Button onClick={() => void dashboardQuery.refetch()}>Tekrar dene</Button>}
          aria-label="Kurum başarı görünümü alınamadı"
          description="Öğrenci ve kurum verileri yüklenemedi. Eksik veriyi sıfır veya tamamlanmış iş olarak göstermiyoruz."
          title="Kurum başarı görünümü alınamadı"
          tone="warning"
        />
      </PageFrame>
    );
  }

  return (
    <PageFrame
      title={dashboard.institution.name}
      subtitle="Öğrenci gelişimini, son sınav katılımını ve destek bekleyen işleri tek yerde izleyin."
    >
      {dashboardQuery.isPending ? <LoadingState label="Kurum başarı görünümü yükleniyor…" /> : null}

      <Panel
        aria-label="Bugün ilgilenmeniz gerekenler"
        className="next-attention-panel"
        description="Önce takip edilmesi gereken en fazla üç kurum işi."
        title="Bugün ilgilenmeniz gerekenler"
        tone={attentionItems.length > 0 ? "warning" : "default"}
      >
        {attentionItems.length > 0 ? (
          <div className="next-attention-list">
            {attentionItems.map((item) => (
              <ActionCard
                as="a"
                aria-label={`${item.title} ${item.value}: ${item.description}`}
                className="next-attention-item"
                detail={item.description}
                href={item.href}
                key={item.href}
                label={item.title}
                tone="warning"
                value={item.value}
              />
            ))}
          </div>
        ) : (
          <p className="next-attention-empty">Bugün için açık destek sinyali görünmüyor.</p>
        )}
      </Panel>

      <OperationSummary
        ariaLabel="Kurum başarı görünümü"
        items={buildMetrics(dashboard, attentionTotal)}
      />

      <Panel
        actions={<Link href="/kurum/duyurular">Tüm duyuruları aç</Link>}
        aria-label="Kurum duyuruları"
        className="next-attention-panel"
        description="Kurum genelinde yayımlanan son bilgilendirmeler."
        title="Kurum duyuruları"
      >
        {announcementsQuery.isPending ? (
          <LoadingState label="Duyurular yükleniyor…" />
        ) : announcementsQuery.isError ? (
          <p className="next-attention-empty">Duyurular şu anda alınamadı.</p>
        ) : announcements.length > 0 ? (
          <div className="next-attention-list">
            {announcements.map((announcement) => (
              <ActionCard
                as="a"
                className="next-attention-item"
                detail={announcement.body}
                href="/kurum/duyurular"
                key={announcement.id}
                label={announcement.title}
                value={formatDate(announcement.publishedAt)}
              />
            ))}
          </div>
        ) : (
          <p className="next-attention-empty">Henüz yayımlanmış duyuru yok.</p>
        )}
      </Panel>

      {dashboard.activeStudentCount === 0 && !isSetupDismissed ? (
        <Panel
          actions={
            <div className="next-dashboard-onboarding__actions">
              <Link className="uh-button uh-button--primary uh-button--md" href="/kurum/kurulum">
                Kuruluma git
              </Link>
              <Button onClick={dismissSetupCard} type="button" variant="secondary">
                Daha sonra
              </Button>
            </div>
          }
          aria-label="Kurum kurulum başlangıcı"
          className="next-dashboard-onboarding"
          description="Öğrenci ve öğretmen kayıtlarını tamamlayarak başarı takibini başlatın."
          title="Kurumunuzu kurmaya başlayın"
          tone="muted"
        />
      ) : null}

      <div className="next-institution-growth-layout">
        <div className="next-institution-growth-primary">
          <Panel
            actions={
              <Link href="/kurum/raporlar">
                Raporları aç
              </Link>
            }
            aria-label="Son sınav ve rapor durumu"
            className="next-dashboard-exam-panel"
            description={latestExam ? "Katılım ve başarı özetinin karşılaştırılabilir son görünümü." : "Henüz yayınlanmış sınav yok."}
            title="Son sınav ve rapor durumu"
          >
            {latestExam ? (
              <div className="next-dashboard-exam-summary">
                <div>
                  <strong>{latestExam.title}</strong>
                  <span>{latestExam.startsAt ? formatDate(latestExam.startsAt) : "Sınav tarihi belirtilmemiş"}</span>
                </div>
                <StatusBadge tone={latestExam.reportStatus === "READY" ? "success" : "warning"}>
                  {latestExam.reportStatus === "READY" ? "Rapor hazır" : "Rapor bekliyor"}
                </StatusBadge>
                <dl>
                  <div>
                    <dt>Katılım</dt>
                    <dd>{latestExam.attendedParticipantCount}/{latestExam.registeredParticipantCount}</dd>
                  </div>
                  <div>
                    <dt>Devamsız</dt>
                    <dd>{latestExam.absentParticipantCount}</dd>
                  </div>
                  <div>
                    <dt>Sonuç</dt>
                    <dd>{latestReport?.resultCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Başarı %</dt>
                    <dd>{formatPercent(latestReport?.successRate)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="next-attention-empty">İlk yayınlanan sınavdan sonra katılım ve rapor durumu burada görünecek.</p>
            )}
          </Panel>

          <ReportChartPanel
            className="next-student-growth-chart next-student-growth-chart--institution"
            description={classCompare.length > 0
              ? `${latestExam?.title ?? "Son sınav"} · Başarı % ana, Net/Soru bağlamsal metriktir.`
              : "Karşılaştırılabilir sınıf sonucu bekleniyor."}
            title="Sınıf karşılaştırması"
          >
            <ClassCompareBar
              caption="Son sınav sınıf başarı karşılaştırması"
              classes={classCompare}
              emptyLabel="Karşılaştırılabilir sınıf sonucu yok"
            />
          </ReportChartPanel>
        </div>

        <Panel
          aria-label="Diğer kurum işlemleri"
          className="next-dashboard-links-panel next-institution-growth-side"
          description="Günlük özetin dışında kalan operasyon ekranları."
          title="Diğer kurum işlemleri"
          tone="muted"
        >
          <nav aria-label="Kurum operasyon bağlantıları" className="next-dashboard-compact-links">
            <Link href="/kurum/ogrenciler">Öğrenciler</Link>
            <Link href="/kurum/raporlar">Başarı raporları</Link>
            <Link href="/kurum/devamsizlik">Devamsızlık takibi</Link>
            <Link href="/kurum/optik">Sonuç hazırlama</Link>
          </nav>
        </Panel>
      </div>

      {dashboardQuery.isError ? <p className="next-form-error">Kurum başarı görünümü güncellenemedi; son alınan bilgiler gösteriliyor.</p> : null}
    </PageFrame>
  );
}

function buildMetrics(dashboard: InstitutionDashboardSummary, attentionTotal: number): OperationSummaryItem[] {
  const latestExam = dashboard.latestExam;
  const report = latestExam?.report;
  return [
    {
      key: "students",
      label: "Aktif öğrenci",
      value: dashboard.activeStudentCount,
      description: "Başarı takibine dahil",
      tone: dashboard.activeStudentCount > 0 ? "success" : "default",
    },
    {
      key: "attendance",
      label: "Son sınav katılımı",
      value: latestExam
        ? `${latestExam.attendedParticipantCount}/${latestExam.registeredParticipantCount}`
        : "Veri yok",
      description: latestExam ? `${latestExam.absentParticipantCount} devamsız` : "Yayınlanmış sınav bekleniyor",
      tone: latestExam ? "info" : "default",
    },
    {
      key: "success",
      label: "Son sınav başarı yüzdesi",
      value: formatPercent(report?.successRate),
      description: report?.questionCount !== undefined && report.net !== undefined
        ? `${formatNumber(report.net)} net / ${formatNumber(report.questionCount)} soru`
        : "Karşılaştırılabilir rapor bekleniyor",
      tone: report?.successRate !== undefined ? "success" : "default",
    },
    {
      key: "attention",
      label: "Destek bekleyen iş",
      value: attentionTotal,
      description: attentionTotal > 0 ? "Önceliklendirme gerekiyor" : "Açık sinyal yok",
      tone: attentionTotal > 0 ? "warning" : "success",
    },
  ];
}

function buildAttentionItems(dashboard: InstitutionDashboardSummary): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [
    {
      title: "Öğrenci destek talepleri",
      value: dashboard.attention.openSupportTicketCount,
      description: "Yanıt veya yönlendirme bekleyen talepler",
      href: "/kurum/destek",
    },
    {
      title: "Devamsızlık takibi",
      value: dashboard.attention.attendanceAlertCount,
      description: "Bugün devamsız veya geç kalan öğrenciler",
      href: "/kurum/devamsizlik",
    },
    {
      title: "Sonuç kontrolü",
      value: dashboard.attention.openImportQuarantineCount,
      description: "Eşleştirme veya kontrol bekleyen kayıtlar",
      href: "/kurum/optik",
    },
  ].filter((item) => Number(item.value) > 0);

  if (dashboard.latestExam?.reportStatus === "MISSING") {
    items.push({
      title: "Rapor durumu",
      value: "Bekliyor",
      description: `${dashboard.latestExam.title} sonuçlarının raporu henüz hazır değil`,
      href: "/kurum/raporlar",
    });
  }

  return items;
}

function totalAttention(dashboard: InstitutionDashboardSummary): number {
  const reportAttention = dashboard.latestExam?.reportStatus === "MISSING" ? 1 : 0;
  return dashboard.attention.attendanceAlertCount
    + dashboard.attention.openImportQuarantineCount
    + dashboard.attention.openSupportTicketCount
    + reportAttention;
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "Veri yok" : `%${formatNumber(value)}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("tr-TR");
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  const match = document.cookie.split("; ").find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : "";
}

function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}
