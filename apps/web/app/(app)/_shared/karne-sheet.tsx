"use client";

import type {
  ReportErrorBooklet,
  ReportScopeRank,
  ReportStudentProgress,
  ReportStudentSnapshot,
} from "@uzman-hocam/shared-types";

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
  progress: ReportStudentProgress | null;
  rankFormat: "simple" | "percentile";
  report: ReportStudentSnapshot | null;
  reportLabel: string;
  scoreGeneralLabel: string;
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
  progress,
  rankFormat,
  report,
  reportLabel,
  scoreGeneralLabel,
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
      </section>
    );
  }

  const branchProgressPoints = progress?.points.filter((point) => point.branches?.length).slice(-5) ?? [];
  const recentProgressPoints = progress?.points.length ? progress.points.slice(-5) : [];
  const reportDate = formatKarneDate(report.examStartsAt ?? report.generatedAt);
  const participantLine = report.participantNo
    ? `ÖĞRENCİ NO : ${report.participantNo}${reportDate ? ` / ${reportDate}` : ""}`
    : report.className ?? report.classId ?? "-";
  const bookletLine = report.bookletType
    ? `${report.bookletType.toLocaleUpperCase("tr-TR")} KİTAPÇIĞI${reportDate ? ` / ${reportDate}` : ""}`
    : reportDate ? `TARİH : ${reportDate}` : reportLabel;
  const scoreExtra = showProgressHistory ? "" : summaryExtra.replace(/^Gelişim\s+/u, "");

  return (
    <section className={sheetClassName} aria-label={ariaLabel}>
      <header className="next-karne-header">
        <div>
          <KarneHeading level={titleLevel}>{report.examTitle ?? "İSEM - LGS - 1"}</KarneHeading>
          <p>{report.studentName ?? report.studentId}</p>
          <span>{report.institutionName ?? reportLabel}</span>
          <span>{participantLine}</span>
          <span>{bookletLine}</span>
        </div>
        <div className="next-karne-brand">
          <span>DNA</span>
          <strong>EĞİTİM</strong>
          <small>KİŞİSEL GELİŞİM KURSU</small>
        </div>
      </header>
      <div className="next-karne-grid">
        <section className="next-karne-block next-karne-block--wide">
          <h4>BÖLÜM ANALİZİ</h4>
          <table className="next-karne-table">
            <caption>{branchCaption}</caption>
            <thead>
              <tr>
                <th>No</th>
                <th>Branş</th>
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
                  <td>{branch.branch}</td>
                  <td>{formatNumber(branchQuestionCount(branch))}</td>
                  <td>{formatNumber(branch.correct)}</td>
                  <td>{formatNumber(branch.wrong)}</td>
                  <td>{formatNumber(branch.blank)}</td>
                  <td>{formatNumber(branch.net)}</td>
                  <td>{formatNumber(branch.classNetAverage)}</td>
                  <td>{formatNumber(branch.schoolNetAverage)}</td>
                  <td>{formatNumber(branch.generalNetAverage)}</td>
                </tr>
              ))}
              <tr>
                <td></td>
                <td>TOPLAM</td>
                <td>{formatNumber(branchQuestionCount(report.total))}</td>
                <td>{formatNumber(report.total.correct)}</td>
                <td>{formatNumber(report.total.wrong)}</td>
                <td>{formatNumber(report.total.blank)}</td>
                <td>{formatNumber(report.total.net)}</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="next-karne-block">
          <h4>PUAN - SIRA ANALİZİ</h4>
          <table className="next-karne-score-table">
            <thead>
              <tr>
                <th colSpan={2}>PUAN TİPİ</th>
                <th>LGS</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>PUAN</th>
                <td colSpan={2}>{formatNumber(report.total.standardScore)}</td>
              </tr>
              <tr>
                <th className="next-karne-score-scope" rowSpan={2}>{scoreGeneralLabel === "SIRA" ? "GENEL" : scoreGeneralLabel}</th>
                <th>SIRA</th>
                <td>{formatRank(report.statistics?.general, rankFormat)}</td>
              </tr>
              <tr>
                <th>KATILIM</th>
                <td>{formatRankOutOf(report.statistics?.general)}</td>
              </tr>
              <tr>
                <th className="next-karne-score-scope" rowSpan={2}>SINIF</th>
                <th>SIRA</th>
                <td>{formatRank(report.statistics?.class, rankFormat)}</td>
              </tr>
              <tr>
                <th>KATILIM</th>
                <td>{formatRankOutOf(report.statistics?.class)}</td>
              </tr>
              <tr>
                <th colSpan={2}>GELİŞİM</th>
                <td>{showProgressHistory ? formatDelta(progress?.netDelta) : scoreExtra}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      <KarneOutcomeRadar
        ariaLabel={outcomeAriaLabel}
        branches={report.branches}
        caption={outcomeCaption}
        headingLevel={outcomeHeadingLevel}
        outcomes={report.outcomes ?? []}
        sectionClassName={outcomeSectionClassName}
        showEmpty={showEmptyOutcomes}
      />
      <section className="next-karne-block">
        <h4>SON SINAV NETLERİ</h4>
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
                  <th>Net</th>
                  <th>Tarih</th>
                </tr>
              </thead>
              <tbody>
                {(recentProgressPoints.length ? recentProgressPoints : [buildCurrentProgressPoint(report)]).map((point, index) => (
                  <tr key={point.snapshotId ?? point.generatedAt ?? index}>
                    <td>{index + 1}</td>
                    <td>{point.examTitle ?? (recentProgressPoints.length ? `Deneme ${index + 1}` : "Son rapor")}</td>
                    <td>{formatNumber(point.total.net)}</td>
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
                  <td>{branch.branch}</td>
                  {branchProgressPoints.length > 0 ? (
                    branchProgressPoints.map((point, index) => (
                      <td key={`${point.snapshotId ?? point.generatedAt ?? index}-${branch.branch}`}>
                        {formatNumber(findBranchNet(point, branch.branch))}
                      </td>
                    ))
                  ) : (
                    <td>{formatNumber(branch.net)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p>{errorBooklet ? `${errorBooklet.items.length} soru inceleme gerektiriyor.` : "Hata kitapçığı bekleniyor."}</p>
    </section>
  );
}

function KarneOutcomeRadar({
  ariaLabel,
  branches,
  caption,
  headingLevel,
  outcomes,
  sectionClassName,
  showEmpty,
}: {
  ariaLabel: string;
  branches: ReportStudentSnapshot["branches"];
  caption: string;
  headingLevel: KarneHeadingLevel;
  outcomes: NonNullable<ReportStudentSnapshot["outcomes"]>;
  sectionClassName: string;
  showEmpty: boolean;
}) {
  const rows = outcomes.filter((outcome) => outcome.outcomeCode).slice(0, 6);
  const chartBranches = branches.slice(0, 6);
  if (rows.length === 0 && !showEmpty) return null;

  if (rows.length === 0) {
    return (
      <section className={sectionClassName} aria-label={ariaLabel}>
        <KarneHeading level={headingLevel}>Kazanım Radar</KarneHeading>
        <p>Kazanım verisi bekleniyor.</p>
      </section>
    );
  }

  const maxNet = Math.max(1, ...rows.map((outcome) => Math.max(0, outcome.net ?? 0)));
  const axisPoints = rows.map((_outcome, index) => radarPoint(index, rows.length, maxNet, maxNet));
  const polygonPoints = rows.map((outcome, index) => radarPoint(index, rows.length, Math.max(0, outcome.net ?? 0), maxNet)).join(" ");

  return (
    <section className={sectionClassName} aria-label={ariaLabel}>
      <KarneHeading level={headingLevel}>BÖLÜM BAŞARI YÜZDELERİ</KarneHeading>
      <div className="next-outcome-radar">
        <svg viewBox="0 0 220 220" role="img" aria-label={`${caption} grafiği`}>
          <polygon className="next-outcome-radar__grid" points={axisPoints.join(" ")} />
          {axisPoints.map((point, index) => (
            <line key={rows[index]?.outcomeCode} className="next-outcome-radar__axis" x1="110" y1="110" x2={point.split(",")[0]} y2={point.split(",")[1]} />
          ))}
          <polygon className="next-outcome-radar__shape" points={polygonPoints} />
          {rows.map((outcome, index) => {
            const [x, y] = radarPoint(index, rows.length, maxNet, maxNet, 100).split(",");
            return (
              <text key={outcome.outcomeCode} x={x} y={y} textAnchor="middle">
                {shortOutcomeLabel(outcome.outcomeCode)}
              </text>
            );
          })}
        </svg>
        <div className="next-outcome-legend" aria-hidden="true">
          <span className="next-outcome-legend__student">ÖĞRENCİ</span>
          <span className="next-outcome-legend__class">SINIF</span>
          <span className="next-outcome-legend__school">OKUL</span>
          <span className="next-outcome-legend__general">GENEL</span>
        </div>
        <div className="next-outcome-bar-chart" aria-hidden="true">
          {chartBranches.map((branch, index) => {
            const questionCount = Math.max(1, branchQuestionCount(branch));
            return (
              <div key={branch.branch} className="next-outcome-bar-group">
                <i className="next-outcome-bar next-outcome-bar--student" style={{ height: `${percentFromNet(branch.net, questionCount)}%` }} />
                <i className="next-outcome-bar next-outcome-bar--class" style={{ height: `${percentFromNet(branch.classNetAverage, questionCount)}%` }} />
                <i className="next-outcome-bar next-outcome-bar--school" style={{ height: `${percentFromNet(branch.schoolNetAverage, questionCount)}%` }} />
                <i className="next-outcome-bar next-outcome-bar--general" style={{ height: `${percentFromNet(branch.generalNetAverage, questionCount)}%` }} />
                <span>{index + 1}</span>
              </div>
            );
          })}
        </div>
        <table className="uh-chart-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th>Kazanım</th>
              <th>Branş</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((outcome) => (
              <tr key={outcome.outcomeCode}>
                <td>{outcome.outcomeCode}</td>
                <td>{outcome.branch}</td>
                <td>{formatNumber(outcome.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KarneHeading({ children, level }: { children: string; level: KarneHeadingLevel }) {
  if (level === "h4") return <h4>{children}</h4>;
  return level === "h2" ? <h2>{children}</h2> : <h3>{children}</h3>;
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function formatRank(rank: ReportScopeRank | undefined, rankFormat: "simple" | "percentile") {
  if (!rank) return "-";
  if (rankFormat === "simple") return `${formatNumber(rank.rank)}/${formatNumber(rank.outOf)}`;
  return `${formatNumber(rank.rank)}/${formatNumber(rank.outOf)} (%${formatNumber(rank.percentile)})`;
}

function formatRankOutOf(rank: ReportScopeRank | undefined) {
  return rank ? formatNumber(rank.outOf) : "-";
}

function formatDelta(value: number | undefined) {
  if (value === undefined) return "-";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
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

function branchQuestionCount(value: { blank?: number; correct?: number; wrong?: number }) {
  return (value.correct ?? 0) + (value.wrong ?? 0) + (value.blank ?? 0);
}

function percentFromNet(value: number | undefined, questionCount: number) {
  if (value === undefined) return 0;
  return Math.max(0, Math.min(100, value / questionCount * 100));
}

function findBranchNet(point: ReportStudentProgress["points"][number], branchName: string) {
  return point.branches?.find((branch) => branch.branch === branchName)?.net;
}

function radarPoint(index: number, total: number, value: number, maxValue: number, radius = 78) {
  const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
  const distance = maxValue === 0 ? 0 : (value / maxValue) * radius;
  const x = 110 + Math.cos(angle) * distance;
  const y = 110 + Math.sin(angle) * distance;
  return `${Math.round(x)},${Math.round(y)}`;
}

function shortOutcomeLabel(value: string) {
  return value.length > 8 ? `${value.slice(0, 8)}.` : value;
}
