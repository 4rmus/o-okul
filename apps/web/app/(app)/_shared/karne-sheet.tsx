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
  const institutionName = report.institutionName ?? reportLabel;
  const lgsScore = report.total.estimatedRawScore ?? report.total.standardScore;
  const outcomeRows = (report.outcomes ?? []).filter((outcome) => outcome.outcomeCode || outcome.branch);
  const questionRows = [...(report.questions ?? [])].sort((left, right) => left.questionNo - right.questionNo);

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
                <th>LGS PUANI</th>
                <td colSpan={2}>{formatNumber(lgsScore)}</td>
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
      <section className={`${sheetClassName} next-karne-sheet--analysis`} aria-label={`${ariaLabel} detaylı deneme analizi`}>
        <KarneReportHeader
          bookletLine={bookletLine}
          institutionName={institutionName}
          isAnalysisPage
          participantLine={participantLine}
          report={report}
          titleLevel={titleLevel}
        />
        <section className="next-karne-block next-karne-block--wide">
          <h4>DETAYLI DENEME ANALİZİ</h4>
          <table className="next-karne-table next-karne-detail-table">
            <caption>Kazanım ve soru cevap özeti</caption>
            <thead>
              <tr>
                <th>Toplam soru</th>
                <th>Doğru</th>
                <th>Yanlış</th>
                <th>Boş</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatNumber(branchQuestionCount(report.total))}</td>
                <td>{formatNumber(report.total.correct)}</td>
                <td>{formatNumber(report.total.wrong)}</td>
                <td>{formatNumber(report.total.blank)}</td>
                <td>{formatNumber(report.total.net)}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="next-karne-block next-karne-block--wide">
          <h4>KAZANIM DETAYI</h4>
          {outcomeRows.length ? (
            <table className="next-karne-table next-karne-detail-table">
              <caption>Deneme kazanımları</caption>
              <thead>
                <tr>
                  <th>Kazanım</th>
                  <th>Ders</th>
                  <th>Doğru</th>
                  <th>Yanlış</th>
                  <th>Boş</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {outcomeRows.map((outcome, index) => (
                  <tr key={`${outcome.outcomeCode}-${outcome.branch}-${index}`}>
                    <td>{outcome.outcomeCode || "-"}</td>
                    <td>{outcome.branch || "-"}</td>
                    <td>{formatNumber(outcome.correct)}</td>
                    <td>{formatNumber(outcome.wrong)}</td>
                    <td>{formatNumber(outcome.blank)}</td>
                    <td>{formatNumber(outcome.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="next-karne-empty-note">Kazanım verisi bekleniyor.</p>
          )}
        </section>
        <section className="next-karne-block next-karne-block--wide">
          <h4>SORU CEVAP ANALİZİ</h4>
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
                    <td>{question.branch || "-"}</td>
                    <td>{question.outcomeCode || "-"}</td>
                    <td>{formatAnswer(question.answer)}</td>
                    <td>{formatAnswer(question.correctAnswer)}</td>
                    <td>
                      <span className={`next-karne-status ${questionStatusClassName(question.status)}`}>
                        {formatQuestionStatus(question.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="next-karne-empty-note">Soru cevap analizi bekleniyor.</p>
          )}
        </section>
      </section>
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
                <span title={branch.branch}>{shortBranchLabel(branch.branch)}</span>
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
              <th>Doğru</th>
              <th>Yanlış</th>
              <th>Boş</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((outcome) => (
              <tr key={outcome.outcomeCode}>
                <td>{outcome.outcomeCode}</td>
                <td>{outcome.branch}</td>
                <td>{formatNumber(outcome.correct)}</td>
                <td>{formatNumber(outcome.wrong)}</td>
                <td>{formatNumber(outcome.blank)}</td>
                <td>{formatNumber(outcome.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
        <KarneHeading level={titleLevel}>{report.examTitle ?? "İSEM - LGS - 1"}</KarneHeading>
        <p>{isAnalysisPage ? "DETAYLI DENEME ANALİZİ" : report.studentName ?? report.studentId}</p>
        <span>{institutionName}</span>
        <span>{isAnalysisPage ? report.studentName ?? report.studentId : participantLine}</span>
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

function formatAnswer(value: string) {
  return value ? value : "-";
}

function formatQuestionStatus(status: NonNullable<ReportStudentSnapshot["questions"]>[number]["status"]) {
  if (status === "WRONG") return "Yanlış";
  if (status === "BLANK") return "Boş";
  return "Doğru";
}

function questionStatusClassName(status: NonNullable<ReportStudentSnapshot["questions"]>[number]["status"]) {
  if (status === "WRONG") return "next-karne-status--wrong";
  if (status === "BLANK") return "next-karne-status--blank";
  return "next-karne-status--correct";
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

function shortBranchLabel(value: string) {
  const upper = value.toLocaleUpperCase("tr-TR");
  if (upper.includes("TÜRKÇE")) return "Türkçe";
  if (upper.includes("İNKILAP") || upper.includes("ATATÜRK")) return "İnkılap";
  if (upper.includes("DİN")) return "Din";
  if (upper.includes("İNGİLİZCE")) return "İng.";
  if (upper.includes("MATEMATİK")) return "Mat.";
  if (upper.includes("FEN")) return "Fen";

  const cleaned = value.replace(/^LGS\s+/iu, "").trim();
  return cleaned.length > 10 ? `${cleaned.slice(0, 10)}.` : cleaned || "-";
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
