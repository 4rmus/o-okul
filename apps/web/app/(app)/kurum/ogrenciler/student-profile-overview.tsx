"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StudentPublishedGradeItem } from "@o-okul/shared-types";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Alert, Button } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { hasCapabilityForRoles } from "../../_shared/access.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import { appLocale, appTimeZone, formatDate } from "../../_shared/format.js";
import { formatNetNumber } from "../../_shared/outcome-net-table.js";
import { reportQuestionCount } from "../../_shared/report-metrics.js";
import { studentNetDomain, type StudentNetOverview } from "./student-profile-model.js";

const shortDate = new Intl.DateTimeFormat(appLocale, { day: "numeric", month: "short", timeZone: appTimeZone });

export function StudentNetHeadline({ model, loading, error }: { model: StudentNetOverview; loading: boolean; error: boolean }) {
  const delta = model.previousDelta;
  const Icon = delta === undefined || delta === 0 ? Minus : delta < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <section className="next-student-net-headline" aria-label="Son deneme neti">
      <span>{model.hasLatestReport ? "Son deneme / Toplam net" : "Hazır deneme raporu yok"}</span>
      <strong>{formatNetNumber(model.net)} {model.hasLatestReport ? <small>/ {model.questionCount ?? "Soru bilgisi yok"}</small> : null}</strong>
      <p data-direction={delta !== undefined && delta < 0 ? "down" : "up"}>
        {loading ? "Geçmiş sonuçlar yükleniyor..." : error ? "Geçmiş sonuçlar alınamadı" : delta === undefined ? "Karşılaştırılabilir önceki sonuç yok" : <><Icon aria-hidden="true" size={16} />{delta > 0 ? "+" : ""}{formatNetNumber(delta)} net</>}
      </p>
      {!loading && !error && delta !== undefined ? <span>Önceki uyumlu denemeye göre</span> : null}
    </section>
  );
}

export function StudentNetCharts({ model, loading, error, onRetry }: {
  model: StudentNetOverview;
  loading: boolean;
  error: boolean;
  onRetry(): void;
}) {
  const trendRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  useEffect(() => {
    const element = trendRef.current;
    if (!element) return;
    const resize = () => { if (element.clientWidth > 0) setWidth(element.clientWidth); };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const domain = studentNetDomain(model.points);
  const height = 72;
  const points = model.points.map((point, index) => ({
    ...point,
    x: model.points.length === 1 ? width / 2 : 7 + index * (width - 14) / (model.points.length - 1),
    y: height - 7 - (point.net - domain.low) / (domain.high - domain.low) * (height - 14),
  }));
  const branchRows = model.branches.map((branch) => ({ ...branch, questionCount: reportQuestionCount(branch) }));
  const low = Math.min(0, ...branchRows.flatMap((branch) => Number.isFinite(branch.net) ? [branch.net!] : []));
  const high = Math.max(1, ...branchRows.flatMap((branch) => [branch.questionCount ?? 0, Number.isFinite(branch.net) ? branch.net! : 0]));
  const scale = (value: number) => (value - low) / (high - low) * 100;
  return (
    <section className="next-student-net-charts" aria-label="Öğrenci net görünümü">
      {error ? <Alert className="next-student-net-charts__error" tone="warning">Geçmiş raporlar alınamadı. <Button onClick={onRetry} size="sm" type="button" variant="secondary">Tekrar dene</Button></Alert> : null}
      <div className="next-student-net-chart">
        <div className="next-student-net-chart__heading">
          <div><h2>Deneme gelişimi</h2><p>{model.points.length > 1 ? `${model.questionCount} soruluk son ${model.points.length} uyumlu deneme` : "Aynı kapsam ve soru dağılımındaki denemeler"}</p></div>
          {model.seriesDelta !== undefined ? <span>{model.seriesDelta > 0 ? "+" : ""}{formatNetNumber(model.seriesDelta)} net</span> : null}
        </div>
        <div className="next-student-net-trend-container" ref={trendRef}>
          {loading ? <p role="status">Net geçmişi yükleniyor...</p> : points.length > 0 ? (
            <>
              <svg className="next-student-net-trend" role="img" aria-label={`Deneme netleri: ${points.map((point) => `${point.title} · ${point.dateIsExam ? "" : "Rapor tarihi "}${formatDate(point.date)}: ${formatNetNumber(point.net)} / ${point.questionCount}`).join("; ")}`} viewBox={`0 0 ${width} ${height}`}>
                {points.length > 1 ? <polyline fill="none" points={points.map((point) => `${point.x},${point.y}`).join(" ")} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /> : null}
                {points.map((point) => <circle cx={point.x} cy={point.y} fill="currentColor" key={point.snapshotId} r={3}><title>{`${point.title} · ${formatNetNumber(point.net)} / ${point.questionCount}`}</title></circle>)}
              </svg>
              <ol className="next-student-net-trend__labels" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
                {points.map((point) => <li key={point.snapshotId}><time dateTime={point.date}>{point.dateIsExam ? "" : "Rapor · "}{shortDate.format(new Date(point.date))}</time><strong>{formatNetNumber(point.net)} net</strong></li>)}
              </ol>
              <p className="next-student-profile-hint">Grafik aralığı: {formatNetNumber(domain.low)}–{formatNetNumber(domain.high)} net.{points.length === 1 ? " Karşılaştırılabilir önceki sonuç yok." : ""}</p>
            </>
          ) : !error ? <p className="next-student-profile-hint">Net gelişimini göstermek için doğrulanmış rapor geçmişi bulunmuyor.</p> : null}
        </div>
      </div>
      <div className="next-student-net-chart">
        <div className="next-student-net-chart__heading"><div><h2>Ders netleri</h2><p>Son deneme · Net / Soru</p></div></div>
        {loading ? <p role="status">Ders netleri yükleniyor...</p> : branchRows.length > 0 ? (
          <ul className="next-student-net-branches" aria-label="Son denemenin ders netleri">
            {branchRows.map((branch, index) => {
              const net = Number.isFinite(branch.net) ? branch.net : undefined;
              return <li key={`${branch.branch}-${index}`}>
                <span>{formatCourseName(branch.branch)}</span>
                <span className="next-student-net-branch-track" aria-hidden="true">
                  {branch.questionCount !== undefined ? <span className="next-student-net-branch-limit" style={{ left: `${scale(0)}%`, width: `${branch.questionCount / (high - low) * 100}%` }} /> : null}
                  {net !== undefined ? <span className="next-student-net-branch-fill" data-negative={net < 0 || undefined} style={{ left: `${scale(Math.min(net, 0))}%`, width: `${Math.abs(net) / (high - low) * 100}%` }} /> : null}
                  {low < 0 ? <span className="next-student-net-branch-zero" style={{ left: `${scale(0)}%` }} /> : null}
                </span>
                <strong>{formatNetNumber(net)} / {branch.questionCount ?? "—"}</strong>
              </li>;
            })}
          </ul>
        ) : !error ? <p className="next-student-profile-hint">Son rapor sürümüne ait ders netleri bulunmuyor.</p> : null}
      </div>
    </section>
  );
}

export function StudentPublishedGrades({ studentId, courseNameById }: { studentId: string; courseNameById: ReadonlyMap<string, string> }) {
  const { auth } = useAuth();
  const canRead = hasCapabilityForRoles(auth?.session.roles ?? [], "academic:read");
  const query = useQuery({
    queryKey: ["next-student-timeline-grades", auth?.session.tenantId ?? "anonymous", studentId],
    queryFn: () => apiRequest<StudentPublishedGradeItem[]>(auth?.accessToken ?? "", `${apiBaseUrl}/grade-assessments/students/${encodeURIComponent(studentId)}/published`),
    enabled: Boolean(auth) && canRead,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  if (!canRead) return null;
  const grades = [...(query.data ?? [])].sort((left, right) => right.heldOn.localeCompare(left.heldOn) || right.publishedAt.localeCompare(left.publishedAt)).slice(0, 4);
  return (
    <section aria-label="Öğrencinin yayımlanmış okul notları" className="next-student-published-grades">
      <h2>Okul notları</h2>
      {query.isPending ? <p role="status">Okul notları yükleniyor...</p> : query.isError ? <Alert tone="warning">Okul notları alınamadı. <Button onClick={() => void query.refetch()} size="sm" type="button" variant="secondary">Tekrar dene</Button></Alert> : grades.length > 0 ? (
        <ul>{grades.map((grade) => <li key={grade.assessmentId}><span><strong>{courseNameById.get(grade.courseId) ?? "Ders"} · {grade.title}</strong><small>{formatDate(grade.heldOn)} · {grade.version}. sürüm</small></span><b>{grade.absent ? "Katılmadı" : grade.score === null ? "Not yok" : `${grade.score.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} / ${grade.maxScore.toLocaleString("tr-TR")}`}</b></li>)}</ul>
      ) : <p className="next-student-profile-hint">Yayımlanmış okul notu yok.</p>}
      <p className="next-student-profile-hint">Okul notları ve deneme netleri ayrı gösterilir.</p>
    </section>
  );
}
