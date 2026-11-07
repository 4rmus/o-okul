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
import { TrialStatusBanner } from "./_shared/trial-status.js";
import { useKurumAnnouncementsQuery, useKurumDashboardDataQuery } from "./kurum-dashboard-data.js";
import { formatDate } from "../_shared/format.js";

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
    .filter((item) => canAccessHref(auth?.session.roles ?? [], item.href, auth?.session.activePersona))
    .slice(0, 3);
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
    <div className="campus-institution-workspace">
      <PageFrame
        title={dashboard.institution.name}
        subtitle="Öğrenci gelişimini, son sınav katılımını ve destek bekleyen işleri tek yerde izleyin."
      >
        {dashboardQuery.isPending ? <LoadingState label="Kurum başarı görünümü yükleniyor…" /> : null}
        <TrialStatusBanner />

        <OperationSummary
          ariaLabel="Kurum başarı görünümü"
          items={buildMetrics(dashboard)}
        />

        {dashboard.activeStudentCount === 0 && !isSetupDismissed ? (
          <Panel
            actions={
              <div className="next-dashboard-onboarding__actions">
                <Link className="uh-button uh-button--primary uh-button--md" href="/kurum/kurulum">
                  Kuruluma git
                </Link>
                {/* KF-6: the two first steps of a trial, shown only when the user can open them. */}
                {firstStepLinks.filter((link) => canAccessHref(auth?.session.roles ?? [], link.href, auth?.session.activePersona)).map((link) => (
                  <Link className="uh-button uh-button--secondary uh-button--md" href={link.href} key={link.href}>
                    {link.label}
                  </Link>
                ))}
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

        <div className="campus-institution-board">
          <Panel
            aria-label="Bugün ilgilenmeniz gerekenler"
            className="next-attention-panel campus-institution-agenda"
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
                    key={item.title}
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

          <div className="next-institution-growth-layout campus-institution-report">
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
                        <dd>{latestReport?.resultCount ?? "Rapor bekliyor"}</dd>
                      </div>
                      <div>
                        <dt>Başarı %</dt>
                        <dd>{formatPercent(latestReport?.successRate)}</dd>
                      </div>
                    </dl>
                    {latestReport?.net !== undefined && latestReport.questionCount !== undefined ? (
                      <p className="campus-exam-context">{formatNumber(latestReport.net)} net / {formatNumber(latestReport.questionCount)} soru</p>
                    ) : null}
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

          </div>
        </div>

        <Panel
          actions={<Link href="/kurum/duyurular">Tüm duyuruları aç</Link>}
          aria-label="Kurum duyuruları"
          className="next-attention-panel campus-institution-announcements"
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

        {dashboardQuery.isError ? <p className="next-form-error">Kurum başarı görünümü güncellenemedi; son alınan bilgiler gösteriliyor.</p> : null}
      </PageFrame>
    </div>
  );
}

function buildMetrics(dashboard: InstitutionDashboardSummary): OperationSummaryItem[] {
  const items: OperationSummaryItem[] = [{
    key: "students",
    label: "Aktif öğrenci",
    value: dashboard.activeStudentCount,
    description: "Yetkili olduğunuz kapsam",
  }];
  const academicOps = dashboard.academicOps;
  if (academicOps) {
    items.push(
      { key: "rollCall", label: "Yoklaması eksik sınıf", value: academicOps.rollCallMissingClassCount, description: "Bugünkü dersler" },
      { key: "grades", label: "Eksik not girişi", value: academicOps.missingGradeEntryAssessmentCount, description: "Bu dönemdeki değerlendirmeler" },
      { key: "drafts", label: "Yayınlanmamış notlar", value: academicOps.unpublishedDraftAssessmentCount, description: "Taslak içeren değerlendirmeler" },
    );
  }
  return items;
}

function buildAttentionItems(dashboard: InstitutionDashboardSummary): DashboardAttentionItem[] {
  // DEC-20261102-04: akademik operasyon sayıları yalnız academic:manage rolüne ve aynı kampüs kapsamıyla gelir.
  const academicOps = dashboard.academicOps;
  const items: DashboardAttentionItem[] = [
    {
      title: "Yoklama alınmamış sınıflar",
      value: academicOps?.rollCallMissingClassCount ?? 0,
      description: "Bugün dersi olup yoklaması başlamamış sınıflar",
      href: "/kurum/devamsizlik",
    },
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
    {
      title: "Eksik not girişi",
      value: academicOps?.missingGradeEntryAssessmentCount ?? 0,
      description: "Girilen not sayısı sınıf mevcudundan az olan değerlendirmeler",
      href: "/kurum/not-defteri",
    },
    {
      title: "Yayınlanmamış notlar",
      value: academicOps?.unpublishedDraftAssessmentCount ?? 0,
      description: "Taslak notu yayın bekleyen değerlendirmeler",
      href: "/kurum/not-defteri",
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

function formatPercent(value: number | undefined): string {
  return value === undefined ? "Veri yok" : `%${formatNumber(value)}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
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

const firstStepLinks = [
  { href: "/kurum/ogrenciler", label: "Öğrenci listesini yükle" },
  { href: "/kurum/sinavlar", label: "İlk sınav sonucunu yükle" },
] as const;
