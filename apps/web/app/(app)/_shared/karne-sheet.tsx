"use client";

import type { ReactNode } from "react";
import { InfoGrid, InfoItem, MetricCard, MetricGrid, StatusBadge, type StatusBadgeProps } from "@o-okul/ui";
import type {
  ExamScoreType,
  ReportErrorBooklet,
  ReportScopeRank,
  ReportStudentProgress,
  ReportStudentSnapshot,
} from "@o-okul/shared-types";
import {
  reportCourseMatchesScoreType,
  reportCourseShortName,
  reportCourseSortOrder,
} from "@o-okul/shared-types";
import { formatCourseName, formatOutcomeCode } from "./academic-labels.js";
import { clampSuccessRate, formatPercentDelta, formatPercentNumber, reportQuestionCount, reportSuccessRate } from "./report-metrics.js";

type KarneHeadingLevel = "h2" | "h3" | "h4";

interface KarneSheetProps {
  ariaLabel: string;
  branchCaption: string;
  emptyClassName: string;
  emptyTitle: string;
  emptyTitleLevel: KarneHeadingLevel;
  errorBooklet: ReportErrorBooklet | null;
  outcomeAriaLabel: string;
  outcomeCaption: string;
  outcomeHeadingLevel: KarneHeadingLevel;
  outcomeSectionClassName: string;
  outputStatusLabel: string;
  progress: ReportStudentProgress | null;
  report: ReportStudentSnapshot | null;
  reportLabel: string;
  scoreType?: "LGS" | "TYT" | "SAY" | "EA" | "SOZ";
  sheetClassName: string;
  showEmptyOutcomes?: boolean;
  showProgressHistory?: boolean;
  summaryExtra: string;
  titleLevel: KarneHeadingLevel;
}

export function KarneSheet({
  ariaLabel,
  branchCaption,
  emptyClassName,
  emptyTitle,
  emptyTitleLevel,
  errorBooklet,
  outcomeAriaLabel,
  outcomeCaption,
  outcomeHeadingLevel,
  outcomeSectionClassName,
  outputStatusLabel,
  progress,
  report,
  reportLabel,
  scoreType,
  sheetClassName,
  showEmptyOutcomes = false,
  showProgressHistory = false,
  summaryExtra,
  titleLevel,
}: KarneSheetProps) {
  if (!report) {
    return (
      <section className={emptyClassName} aria-label={ariaLabel}>
        <KarneHeading level={emptyTitleLevel}>{emptyTitle}</KarneHeading>
        <p>Öğrenci raporu bekleniyor.</p>
        <p>Çıktı: {outputStatusLabel}</p>
      </section>
    );
  }

  const branchProgressPoints = progress?.points.filter((point) => point.branches?.length).slice(-5) ?? [];
  const recentProgressPoints = progress?.points.length ? progress.points.slice(-5) : [];
  const reportDate = formatKarneDate(report.examStartsAt ?? report.generatedAt);
  const participantLine = report.participantNo
    ? `ÖĞRENCİ NO : ${report.participantNo}${reportDate ? ` / ${reportDate}` : ""}`
    : report.className ?? (report.classId ? "Sınıf bilgisi yok" : "-");
  const bookletLine = report.bookletType
    ? `${report.bookletType.toLocaleUpperCase("tr-TR")} KİTAPÇIĞI${reportDate ? ` / ${reportDate}` : ""}`
    : reportDate ? `TARİH : ${reportDate}` : reportLabel;
  const scoreExtra = showProgressHistory ? "" : summaryExtra.replace(/^Gelişim\s+/u, "");
  const contextExtra = showProgressHistory ? formatKarneSummaryExtra(summaryExtra) : "";
  const institutionName = report.institutionName ?? reportLabel;
  const scoreView = scoreType ? report.scoreViews?.find((view) => view.type === scoreType) : report.scoreViews?.[0];
  const isModernReport = Boolean(report.scoringProfileId || report.scoreViews?.length);
  const scoreRanking = report.scoreRankings?.find((ranking) => ranking.type === scoreView?.type);
  const institutionRank = scoreView ? scoreRanking?.institution : report.statistics?.general;
  const classRank = scoreView ? scoreRanking?.class : report.statistics?.class;
  const score = scoreView?.practiceScore ?? (isModernReport ? undefined : report.total.estimatedRawScore ?? report.total.standardScore ?? report.total.rawScore);
  const scoreMetrics = scoreView?.metrics ?? report.total;
  const scoreRows = report.scoreViews?.length
    ? report.scoreViews.map((view) => ({
      type: view.type,
      status: formatScoreViewStatus(view.status),
      score: view.practiceScore,
      courses: formatScoreCourseNets(report.branches, view.type),
      institutionRank: report.scoreRankings?.find((ranking) => ranking.type === view.type)?.institution,
      classRank: report.scoreRankings?.find((ranking) => ranking.type === view.type)?.class,
    }))
    : [{
      type: isModernReport ? scoreType ?? "Puan" : "Eski hesaplama",
      status: score === undefined ? "Hesaplanamadı" : "Hesaplandı",
      score,
      courses: "-",
      institutionRank,
      classRank,
    }];
  const totalQuestionCount = reportQuestionCount(scoreMetrics);
  const totalSuccessRate = reportSuccessRate(scoreMetrics);
  const outcomeRows = (report.outcomes ?? []).filter((outcome) => outcome.outcomeCode || outcome.branch);
  const questionRows = [...(report.questions ?? [])].sort((left, right) => left.questionNo - right.questionNo);
  const contextItems = [
    { label: "Rapor kaydı", value: formatKarneSnapshotLabel(report.snapshotId) },
    { label: "Üretim", value: formatKarneDateTime(report.generatedAt) },
    { label: "Sınav", value: reportDate ?? "-" },
    { label: "Kitapçık", value: formatBookletContext(report.bookletType) },
    ...(contextExtra ? [{ label: "Açıklama", value: contextExtra }] : []),
    { label: "Soru", value: formatNumber(totalQuestionCount) },
    { label: "Çıktı", value: outputStatusLabel },
  ];
  const summaryItems = [
    { label: "Başarı %", value: formatPercentNumber(totalSuccessRate) },
    { label: "Soru", value: formatNumber(totalQuestionCount) },
    { label: "Net", value: formatNetNumber(scoreMetrics.net) },
    { label: scoreView ? `${scoreView.type} deneme puanı` : isModernReport ? `${scoreType ?? "Puan"} hesaplanamadı` : "Eski hesaplama", value: formatNumber(score) },
    { label: "Kurum başarı sırası", value: formatRank(institutionRank) },
    { label: "Sınıf başarı sırası", value: formatRank(classRank) },
  ];

  return (
    <section className="next-karne-document" aria-label={ariaLabel}>
      <section className={sheetClassName} aria-label={`${ariaLabel} özet sayfası`}>
        <KarneReportHeader
          bookletLine={bookletLine}
          institutionName={institutionName}
          participantLine={participantLine}
          report={report}
          titleLevel={titleLevel}
        />
        <KarneContextStrip items={contextItems} />
        <KarneSummaryStrip items={summaryItems} />
        {isModernReport ? (
          <p className="next-karne-score-warning">
            Standart sapma kullanılmadan hesaplanan deneme puanıdır. Resmî MEB/ÖSYM sınav puanı değildir.
          </p>
        ) : null}
        <div className="next-karne-grid">
          <KarneBlock className="next-karne-block next-karne-block--wide" title="BÖLÜM ANALİZİ">
            <table className="next-karne-table">
              <caption>{branchCaption}</caption>
              <thead>
                <tr>
                  <th>No</th>
                  <th>Branş</th>
                  <th>Başarı %</th>
                  <th>Soru sayısı</th>
                  <th>Doğru</th>
                  <th>Yanlış</th>
                  <th>Boş</th>
                  <th>Net</th>
                  <th>Sınıf net ort</th>
                  <th>Okul net ort</th>
                  <th>Genel net ort</th>
                </tr>
              </thead>
              <tbody>
                {report.branches.map((branch, index) => (
                  <tr key={branch.branch}>
                    <td>{index + 1}</td>
                    <td>{formatCourseName(branch.branch)}</td>
                    <td>
                      <SuccessMeter value={branchSuccessRate(branch)} />
                    </td>
                    <td>{formatNumber(branchQuestionCount(branch))}</td>
                    <td>{formatNumber(branch.correct)}</td>
                    <td>{formatNumber(branch.wrong)}</td>
                    <td>{formatNumber(branch.blank)}</td>
                    <td>{formatNetNumber(branch.net)}</td>
                    <td>{formatNetNumber(branch.classNetAverage)}</td>
                    <td>{formatNetNumber(branch.schoolNetAverage)}</td>
                    <td>{formatNetNumber(branch.generalNetAverage)}</td>
                  </tr>
                ))}
                <tr>
                  <td></td>
                  <td>TOPLAM</td>
                  <td>
                    <SuccessMeter value={totalSuccessRate} />
                  </td>
                  <td>{formatNumber(totalQuestionCount)}</td>
                  <td>{formatNumber(report.total.correct)}</td>
                  <td>{formatNumber(report.total.wrong)}</td>
                  <td>{formatNumber(report.total.blank)}</td>
                  <td>{formatNetNumber(report.total.net)}</td>
                  <td>-</td>
                  <td>-</td>
                  <td>-</td>
                </tr>
              </tbody>
            </table>
          </KarneBlock>
          <KarneBlock className="next-karne-block" title="PUAN - SIRA ANALİZİ">
            <table className="next-karne-score-table">
              <thead>
                <tr>
                  <th>PUAN TİPİ</th>
                  <th>DURUM</th>
                  <th>DENEME PUANI</th>
                  <th>DERS NETLERİ</th>
                  <th>KURUM BAŞARI SIRASI</th>
                  <th>SINIF BAŞARI SIRASI</th>
                </tr>
              </thead>
              <tbody>
                {scoreRows.map((row) => (
                  <tr key={row.type}>
                    <th>{formatScoreType(row.type)}</th>
                    <td>{row.status}</td>
                    <td>{formatNumber(row.score)}</td>
                    <td className="next-karne-score-courses">{row.courses}</td>
                    <td>{formatRank(row.institutionRank)}</td>
                    <td>{formatRank(row.classRank)}</td>
                  </tr>
                ))}
                <tr>
                  <th>BAŞARI %</th>
                  <td colSpan={5}>{formatPercentNumber(totalSuccessRate)}</td>
                </tr>
                <tr>
                  <th>GELİŞİM</th>
                  <td colSpan={5}>{showProgressHistory ? formatPercentDelta(progress?.successRateDelta) : scoreExtra}</td>
                </tr>
              </tbody>
            </table>
          </KarneBlock>
        </div>
        <KarneOutcomeRadar
          ariaLabel={outcomeAriaLabel}
          caption={outcomeCaption}
          headingLevel={outcomeHeadingLevel}
          outcomes={report.outcomes ?? []}
          sectionClassName={outcomeSectionClassName}
          showEmpty={showEmptyOutcomes}
        />
        <KarneBlock className="next-karne-block" title="SON SINAV NETLERİ">
          <div className="next-karne-last-grid">
            <div className="next-karne-last-stack">
              {showProgressHistory && recentProgressPoints.length ? (
                <div className="next-report-progress">
                  <h3>Öğrenci gelişim grafiği</h3>
                </div>
              ) : null}
              <table className="next-karne-table">
                <thead>
                  <tr>
                    <th>No</th>
                    <th>Deneme</th>
                    <th>Başarı</th>
                    <th>Net</th>
                    <th>Soru</th>
                    <th>Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {(recentProgressPoints.length ? recentProgressPoints : [buildCurrentProgressPoint(report)]).map((point, index) => (
                    <tr key={point.snapshotId ?? point.generatedAt ?? index}>
                      <td>{index + 1}</td>
                      <td>{point.examTitle ?? (recentProgressPoints.length ? `Deneme ${index + 1}` : "Son rapor")}</td>
                      <td>{formatPercentNumber(reportSuccessRate(point.total))}</td>
                      <td>{formatNetNumber(point.total.net)}</td>
                      <td>{formatNumber(reportQuestionCount(point.total))}</td>
                      <td>{formatProgressDate(point.generatedAt, index)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <table className="next-karne-table" aria-label="Son sınav branş netleri">
              <thead>
                <tr>
                  <th>Branş</th>
                  {branchProgressPoints.length > 0 ? (
                    branchProgressPoints.map((point, index) => (
                      <th key={point.snapshotId ?? point.generatedAt ?? index}>{index + 1}</th>
                    ))
                  ) : (
                    <th>Son net</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {report.branches.map((branch) => (
                  <tr key={branch.branch}>
                    <td>{formatCourseName(branch.branch)}</td>
                    {branchProgressPoints.length > 0 ? (
                      branchProgressPoints.map((point, index) => (
                        <td key={`${point.snapshotId ?? point.generatedAt ?? index}-${branch.branch}`}>
                          {formatNetNumber(findBranchNet(point, branch.branch))}
                        </td>
                      ))
                    ) : (
                      <td>{formatNetNumber(branch.net)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </KarneBlock>
        <p>{errorBooklet ? `${errorBooklet.items.length} soru inceleme gerektiriyor.` : "Hata kitapçığı bekleniyor."}</p>
      </section>
      <section className={`${sheetClassName} next-karne-sheet--analysis`} aria-label={`${ariaLabel} detaylı deneme analizi`}>
        <KarneReportHeader
          bookletLine={bookletLine}
          institutionName={institutionName}
          isAnalysisPage
          participantLine={participantLine}
          report={report}
          titleLevel={titleLevel}
        />
        <KarneContextStrip items={contextItems} />
        <KarneBlock className="next-karne-block next-karne-block--wide" title="DETAYLI DENEME ANALİZİ">
          <table className="next-karne-table next-karne-detail-table">
            <caption>Kazanım ve soru cevap özeti</caption>
            <thead>
              <tr>
                <th>Toplam soru</th>
                <th>Başarı %</th>
                <th>Doğru</th>
                <th>Yanlış</th>
                <th>Boş</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatNumber(totalQuestionCount)}</td>
                <td><SuccessMeter value={totalSuccessRate} /></td>
                <td>{formatNumber(report.total.correct)}</td>
                <td>{formatNumber(report.total.wrong)}</td>
                <td>{formatNumber(report.total.blank)}</td>
                <td>{formatNetNumber(report.total.net)}</td>
              </tr>
            </tbody>
          </table>
        </KarneBlock>
        <KarneBlock className="next-karne-block next-karne-block--wide" title="KAZANIM DETAYI">
          {outcomeRows.length ? (
            <table className="next-karne-table next-karne-detail-table">
              <caption>Deneme kazanımları</caption>
              <thead>
                <tr>
                  <th>Kazanım</th>
                  <th>Ders</th>
                  <th>Soru</th>
                  <th>Başarı %</th>
                  <th>Doğru</th>
                  <th>Yanlış</th>
                  <th>Boş</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {outcomeRows.map((outcome, index) => (
                  <tr key={`${outcome.outcomeCode}-${outcome.branch}-${index}`}>
                    <td>{formatOutcomeCode(outcome.outcomeCode)}</td>
                    <td>{formatCourseName(outcome.branch)}</td>
                    <td>{formatNumber(branchQuestionCount(outcome))}</td>
                    <td><SuccessMeter value={branchSuccessRate(outcome)} /></td>
                    <td>{formatNumber(outcome.correct)}</td>
                    <td>{formatNumber(outcome.wrong)}</td>
                    <td>{formatNumber(outcome.blank)}</td>
                    <td>{formatNetNumber(outcome.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="next-karne-empty-note">Kazanım verisi bekleniyor.</p>
          )}
        </KarneBlock>
        <KarneBlock className="next-karne-block next-karne-block--wide" title="SORU CEVAP ANALİZİ">
          {questionRows.length ? (
            <table className="next-karne-table next-karne-detail-table">
              <caption>Öğrencinin cevap durumu</caption>
              <thead>
                <tr>
                  <th>Soru</th>
                  <th>Ders</th>
                  <th>Kazanım</th>
                  <th>Öğrenci cevabı</th>
                  <th>Doğru cevap</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {questionRows.map((question, index) => (
                  <tr key={`${question.questionNo}-${question.branch}-${index}`}>
                    <td>{formatNumber(question.questionNo)}</td>
                    <td>{formatCourseName(question.branch)}</td>
                    <td>{formatOutcomeCode(question.outcomeCode)}</td>
                    <td>{formatAnswer(question.answer)}</td>
                    <td>{formatAnswer(question.correctAnswer)}</td>
                    <td>
                      <StatusBadge
                        className={`next-karne-status ${questionStatusClassName(question.status)}`}
                        tone={questionStatusTone(question.status)}
                      >
                        {formatQuestionStatus(question.status)}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="next-karne-empty-note">Soru cevap analizi bekleniyor.</p>
          )}
        </KarneBlock>
      </section>
    </section>
  );
}

function KarneContextStrip({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <section className="next-karne-context-strip" aria-label="Karne rapor bilgileri">
      <strong>Rapor bağlamı</strong>
      <InfoGrid className="next-karne-context-strip__grid" aria-label="Karne rapor ölçüleri" role="group">
        {items.map((item) => (
          <InfoItem key={item.label} label={item.label} value={item.value || "-"} />
        ))}
      </InfoGrid>
    </section>
  );
}

function KarneSummaryStrip({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <MetricGrid className="next-karne-summary-strip" aria-label="Karne başarı özeti" role="region">
      {items.map((item) => (
        <MetricCard key={item.label} label={item.label} value={item.value || "-"} tone={item.label === "Başarı %" ? "info" : "default"} />
      ))}
    </MetricGrid>
  );
}

function KarneOutcomeRadar({
  ariaLabel,
  caption,
  headingLevel,
  outcomes,
  sectionClassName,
  showEmpty,
}: {
  ariaLabel: string;
  caption: string;
  headingLevel: KarneHeadingLevel;
  outcomes: NonNullable<ReportStudentSnapshot["outcomes"]>;
  sectionClassName: string;
  showEmpty: boolean;
}) {
  const rows = outcomes.filter((outcome) => outcome.outcomeCode).slice(0, 6);
  if (rows.length === 0 && !showEmpty) return null;

  if (rows.length === 0) {
    return (
      <KarneBlock ariaLabel={ariaLabel} className={sectionClassName} title="Kazanım Radar" titleLevel={headingLevel}>
        <p>Kazanım verisi bekleniyor.</p>
      </KarneBlock>
    );
  }

  return (
    <KarneBlock ariaLabel={ariaLabel} className={sectionClassName} title="BÖLÜM BAŞARI YÜZDELERİ" titleLevel={headingLevel}>
      <table className="uh-chart-table uh-outcome-net-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th>Kazanım</th>
            <th>Branş</th>
            <th>Soru</th>
            <th>Başarı %</th>
            <th>Doğru</th>
            <th>Yanlış</th>
            <th>Boş</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((outcome) => (
            <tr key={outcome.outcomeCode}>
              <th scope="row">{formatOutcomeCode(outcome.outcomeCode)}</th>
              <td>{formatCourseName(outcome.branch)}</td>
              <td>{formatNumber(branchQuestionCount(outcome))}</td>
              <td>
                <SuccessMeter value={branchSuccessRate(outcome)} />
              </td>
              <td>{formatNumber(outcome.correct)}</td>
              <td>{formatNumber(outcome.wrong)}</td>
              <td>{formatNumber(outcome.blank)}</td>
              <td>{formatNetNumber(outcome.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </KarneBlock>
  );
}

function KarneBlock({
  ariaLabel,
  children,
  className,
  title,
  titleLevel = "h4",
}: {
  ariaLabel?: string;
  children: ReactNode;
  className: string;
  title: string;
  titleLevel?: KarneHeadingLevel;
}) {
  return (
    <section className={className} aria-label={ariaLabel}>
      <KarneHeading level={titleLevel}>{title}</KarneHeading>
      {children}
    </section>
  );
}

function KarneReportHeader({
  bookletLine,
  institutionName,
  isAnalysisPage = false,
  participantLine,
  report,
  titleLevel,
}: {
  bookletLine: string;
  institutionName: string;
  isAnalysisPage?: boolean;
  participantLine: string;
  report: ReportStudentSnapshot;
  titleLevel: KarneHeadingLevel;
}) {
  return (
    <header className="next-karne-header">
      <div>
        <KarneHeading level={titleLevel}>{report.examTitle ?? "Sınav raporu"}</KarneHeading>
        <p>{isAnalysisPage ? "DETAYLI DENEME ANALİZİ" : report.studentName || "Öğrenci adı bulunamadı"}</p>
        <span>{institutionName}</span>
        <span>{isAnalysisPage ? report.studentName || "Öğrenci adı bulunamadı" : participantLine}</span>
        <span>{bookletLine}</span>
      </div>
      <InstitutionBrand logoUrl={report.institutionLogoUrl} name={institutionName} />
    </header>
  );
}

function InstitutionBrand({ logoUrl, name }: { logoUrl: string | undefined; name: string }) {
  if (logoUrl) {
    return (
      <div className="next-karne-brand next-karne-brand--logo">
        <img src={logoUrl} alt={`${name} logosu`} />
      </div>
    );
  }

  const [primary, secondary] = splitInstitutionName(name);
  return (
    <div className="next-karne-brand">
      <span>{primary}</span>
      {secondary ? <strong>{secondary}</strong> : null}
    </div>
  );
}

function KarneHeading({ children, level }: { children: string; level: KarneHeadingLevel }) {
  if (level === "h4") return <h4>{children}</h4>;
  return level === "h2" ? <h2>{children}</h2> : <h3>{children}</h3>;
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function formatNetNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function formatAnswer(value: string) {
  return value ? value : "-";
}

function formatQuestionStatus(status: NonNullable<ReportStudentSnapshot["questions"]>[number]["status"]) {
  if (status === "WRONG") return "Yanlış";
  if (status === "BLANK") return "Boş";
  if (status === "CANCELLED") return "İptal";
  return "Doğru";
}

function questionStatusTone(status: NonNullable<ReportStudentSnapshot["questions"]>[number]["status"]): StatusBadgeProps["tone"] {
  if (status === "WRONG") return "danger";
  if (status === "BLANK" || status === "CANCELLED") return "neutral";
  return "success";
}

function questionStatusClassName(status: NonNullable<ReportStudentSnapshot["questions"]>[number]["status"]) {
  if (status === "WRONG") return "next-karne-status--wrong";
  if (status === "BLANK" || status === "CANCELLED") return "next-karne-status--blank";
  return "next-karne-status--correct";
}

function formatRank(rank: ReportScopeRank | undefined) {
  if (!rank) return "-";
  return `${formatNumber(rank.rank)}/${formatNumber(rank.outOf)}`;
}

function formatScoreCourseNets(
  branches: ReportStudentSnapshot["branches"],
  type: ExamScoreType,
): string {
  const matching = branches
    .filter((branch) => reportCourseMatchesScoreType(type, branch.branch))
    .sort((left, right) => reportCourseSortOrder(type, left.branch) - reportCourseSortOrder(type, right.branch));

  return matching.length
    ? matching.map((branch) => `${reportCourseShortName(branch.branch)} ${formatNetNumber(branch.net)}`).join(" · ")
    : "-";
}

function formatScoreType(type: string) {
  if (type === "SAY") return "SAYISAL";
  if (type === "SOZ") return "SÖZEL";
  return type.toLocaleUpperCase("tr-TR");
}

function formatScoreViewStatus(status: "CALCULATED" | "NOT_ELIGIBLE" | "MISSING_TYT") {
  if (status === "CALCULATED") return "Hesaplandı";
  if (status === "MISSING_TYT") return "Bağlı TYT yok";
  return "Hesaplanamadı";
}

function formatDelta(value: number | undefined) {
  if (value === undefined) return "-";
  return `${value > 0 ? "+" : ""}${formatNetNumber(value)}`;
}

function SuccessMeter({ value }: { value: number | undefined }) {
  return (
    <span className="next-success-meter">
      <span className="next-success-meter__track" aria-hidden="true">
        <span className="next-success-meter__fill" style={{ width: `${clampSuccessRate(value)}%` }} />
      </span>
      <span>{formatPercentNumber(value)}</span>
    </span>
  );
}

function formatProgressDate(value: string | undefined, index: number) {
  return value ? new Date(value).toLocaleDateString("tr-TR") : `Ölçüm ${index + 1}`;
}

function buildCurrentProgressPoint(report: ReportStudentSnapshot): ReportStudentProgress["points"][number] {
  return {
    snapshotId: report.snapshotId,
    examTitle: "Son rapor",
    generatedAt: report.generatedAt,
    total: report.total,
  };
}

function formatKarneDate(value: string | undefined) {
  return value ? new Date(value).toLocaleDateString("tr-TR") : undefined;
}

function formatKarneDateTime(value: string | undefined) {
  return value ? new Date(value).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "-";
}

function formatKarneSnapshotLabel(value: string | undefined) {
  return value ? "Rapor kaydı hazır · Rapor hazır" : "-";
}

function formatKarneSummaryExtra(value: string) {
  const normalized = value.trim();
  return normalized && normalized !== "-" ? normalized : "";
}

function formatBookletContext(value: string | undefined) {
  return value ? `${value.toLocaleUpperCase("tr-TR")} kitapçık` : "-";
}

function branchQuestionCount(value: { blank?: number; correct?: number; questionCount?: number; wrong?: number }) {
  return reportQuestionCount(value);
}

function branchSuccessRate(value: { blank?: number; correct?: number; net?: number; questionCount?: number; successRate?: number; wrong?: number }) {
  return reportSuccessRate(value);
}

function findBranchNet(point: ReportStudentProgress["points"][number], branchName: string) {
  return point.branches?.find((branch) => branch.branch === branchName)?.net;
}

function splitInstitutionName(name: string) {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (words.length === 0) return ["KURUM", ""] as const;
  if (words.length === 1) return [words[0]!, ""] as const;

  const initials = words
    .slice(0, 3)
    .map((word) => word.charAt(0))
    .join("")
    .toLocaleUpperCase("tr-TR");
  return [initials, words.join(" ")] as const;
}
