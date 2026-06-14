"use client";

import type { HTMLAttributes } from "react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { classNames } from "../class-names.js";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
);

const defaultChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    tooltip: {
      enabled: true,
    },
  },
  animation: {
    duration: 150,
  },
} as const;

const chartBlue = "#155eef";
const chartBlueSoft = "rgba(21, 94, 239, 0.16)";
const chartGreen = "#15803d";
const chartRed = "#b42318";
const chartGray = "#667085";
const chartGrid = "rgba(16, 24, 40, 0.08)";
const chartText = "#475467";

function formatChartNumber(value: number | undefined) {
  return value === undefined ? "-" : new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
}

function formatNetNumber(value: number | undefined) {
  return value === undefined ? "-" : new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value);
}

function formatPercentNumber(value: number | undefined) {
  return value === undefined ? "-" : `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value)}`;
}

function formatQuestionCount(value: number | undefined) {
  return value === undefined ? "-" : new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(value);
}

function shortLabel(label: string, maxLength = 20) {
  return label.length > maxLength ? `${label.slice(0, maxLength - 3)}...` : label;
}

function tooltipNumber(value: unknown) {
  return typeof value === "number" ? formatChartNumber(value) : String(value ?? "-");
}

function ChartEmptyState({ label }: { label: string }) {
  return <div className="uh-chart-empty-state">{label}</div>;
}

function scoreQuestionCount(value: { blank?: number; correct?: number; questionCount?: number; wrong?: number }) {
  if (typeof value.questionCount === "number" && Number.isFinite(value.questionCount)) return value.questionCount;
  if (typeof value.correct !== "number" || typeof value.wrong !== "number" || typeof value.blank !== "number") return undefined;
  return Number((value.correct + value.wrong + value.blank).toFixed(4));
}

function scoreSuccessRate(value: { blank?: number; correct?: number; net?: number; questionCount?: number; successRate?: number; wrong?: number }) {
  if (typeof value.successRate === "number" && Number.isFinite(value.successRate)) return value.successRate;
  const questionCount = scoreQuestionCount(value);
  if (typeof value.net !== "number" || !Number.isFinite(value.net) || !questionCount || questionCount <= 0) return undefined;
  return Number(((value.net / questionCount) * 100).toFixed(4));
}

function clampPercent(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function EmptyTableRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan}>{label}</td>
    </tr>
  );
}

export interface ExamResultDonutInput {
  blank?: number;
  correct?: number;
  net?: number;
  questionCount?: number;
  successRate?: number;
  wrong?: number;
}

export interface ExamResultDonutProps extends HTMLAttributes<HTMLDivElement> {
  result: ExamResultDonutInput;
}

export function ExamResultDonut({ className, result, ...props }: ExamResultDonutProps) {
  const correct = result.correct ?? 0;
  const wrong = result.wrong ?? 0;
  const blank = result.blank ?? 0;
  const total = scoreQuestionCount({ blank, correct, questionCount: result.questionCount, wrong }) ?? 0;
  const successRate = scoreSuccessRate({
    blank,
    correct,
    net: result.net ?? correct,
    questionCount: result.questionCount,
    successRate: result.successRate,
    wrong,
  });
  const data: ChartData<"doughnut", number[], string> = {
    labels: ["Doğru", "Yanlış", "Boş"],
    datasets: [
      {
        data: [correct, wrong, blank],
        backgroundColor: [chartGreen, chartRed, chartGray],
        borderColor: "#ffffff",
        borderWidth: 2,
        hoverOffset: 3,
      },
    ],
  };
  const options: ChartOptions<"doughnut"> = {
    ...defaultChartOptions,
    cutout: "62%",
    plugins: {
      ...defaultChartOptions.plugins,
      legend: {
        position: "bottom",
        labels: {
          boxWidth: 10,
          color: chartText,
          usePointStyle: true,
        },
      },
      tooltip: {
        callbacks: {
          label: (item: TooltipItem<"doughnut">) => `${item.label}: ${tooltipNumber(item.raw)}`,
        },
      },
    },
  };

  return (
    <div {...props} className={classNames("uh-exam-result-donut", className)}>
      {total > 0 ? (
        <div className="uh-chart-canvas-shell uh-chart-canvas-shell--donut">
          <Doughnut data={data} options={options} />
          <div className="uh-chart-center-label" aria-hidden="true">
            <strong>{formatPercentNumber(successRate)}</strong>
            <span>Başarı</span>
          </div>
        </div>
      ) : (
        <ChartEmptyState label="Sonuç verisi yok" />
      )}
      <table className="uh-chart-table">
        <caption>{total > 0 ? `Toplam ${formatQuestionCount(total)} soru / Başarı ${formatPercentNumber(successRate)}` : "Sonuç verisi yok"}</caption>
        <thead>
          <tr>
            <th scope="col">Durum</th>
            <th scope="col">Sayı</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Doğru</th>
            <td>{correct}</td>
          </tr>
          <tr>
            <th scope="row">Yanlış</th>
            <td>{wrong}</td>
          </tr>
          <tr>
            <th scope="row">Boş</th>
            <td>{blank}</td>
          </tr>
          <tr>
            <th scope="row">Başarı</th>
            <td>{formatPercentNumber(successRate)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export interface ClassCompareBarInput {
  chartLabel?: string | null;
  classId?: string | null;
  className?: string | null;
  net?: number;
  questionCount?: number;
  standardScore?: number;
  successRate?: number;
}

export interface ClassCompareBarProps extends HTMLAttributes<HTMLDivElement> {
  caption?: string;
  classes: ClassCompareBarInput[];
  emptyLabel?: string;
  valueLabel?: string;
}

export function ClassCompareBar({
  caption = "Sınıf başarı karşılaştırması",
  className,
  classes,
  emptyLabel = "Sınıf verisi yok",
  valueLabel = "Başarı %",
  ...props
}: ClassCompareBarProps) {
  const rows = classes.map((record) => ({
    chartLabel: record.chartLabel ?? record.className ?? "Sınıfsız",
    id: record.classId ?? record.className ?? "no-class",
    name: record.className ?? "Sınıfsız",
    net: record.net ?? 0,
    questionCount: record.questionCount,
    standardScore: record.standardScore ?? 0,
    successRate: scoreSuccessRate(record),
  }));
  const data: ChartData<"bar", number[], string> = {
    labels: rows.map((record) => shortLabel(record.chartLabel)),
    datasets: [
      {
        label: valueLabel,
        data: rows.map((record) => clampPercent(record.successRate)),
        backgroundColor: chartBlue,
        borderRadius: 6,
        maxBarThickness: 42,
      },
    ],
  };
  const options: ChartOptions<"bar"> = {
    ...defaultChartOptions,
    plugins: {
      ...defaultChartOptions.plugins,
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          title: (items: TooltipItem<"bar">[]) => rows[items[0]?.dataIndex ?? -1]?.name ?? "",
          label: (item: TooltipItem<"bar">) => `${valueLabel}: ${typeof item.raw === "number" ? formatPercentNumber(item.raw) : tooltipNumber(item.raw)}`,
          afterLabel: (item: TooltipItem<"bar">) => {
            const row = rows[item.dataIndex];
            return row
              ? [`Net: ${formatNetNumber(row.net)}`, `Soru: ${formatQuestionCount(row.questionCount)}`, `Standart puan: ${formatChartNumber(row.standardScore)}`]
              : [];
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: chartText,
          maxRotation: 0,
        },
      },
      y: {
        beginAtZero: true,
        max: 100,
        grid: {
          color: chartGrid,
        },
        ticks: {
          color: chartText,
          callback: (value) => formatPercentNumber(Number(value)),
        },
        title: {
          display: true,
          text: valueLabel,
        },
      },
    },
  };

  return (
    <div {...props} className={classNames("uh-class-compare-bar", className)}>
      {rows.length > 0 ? <Bar data={data} options={options} /> : <ChartEmptyState label={emptyLabel} />}
      <table className="uh-chart-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Başlık</th>
            <th scope="col">Başarı</th>
            <th scope="col">Net</th>
            <th scope="col">Soru</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((record) => (
              <tr key={record.id}>
                <th scope="row">{record.name}</th>
                <td>{formatPercentNumber(record.successRate)}</td>
                <td>{formatNetNumber(record.net)}</td>
                <td>{formatQuestionCount(record.questionCount)}</td>
              </tr>
            ))
          ) : (
            <EmptyTableRow colSpan={4} label="Kayıt yok" />
          )}
        </tbody>
      </table>
    </div>
  );
}

export interface ProgressLineChartPoint {
  snapshotId?: string;
  generatedAt?: string;
  total: {
    blank?: number;
    correct?: number;
    net?: number;
    questionCount?: number;
    standardScore?: number;
    successRate?: number;
    wrong?: number;
  };
}

export interface ProgressLineChartProps extends HTMLAttributes<HTMLDivElement> {
  caption?: string;
  emptyLabel?: string;
  points: ProgressLineChartPoint[];
}

export function ProgressLineChart({
  caption = "Öğrenci gelişim grafiği",
  className,
  emptyLabel = "Gelişim verisi yok",
  points,
  ...props
}: ProgressLineChartProps) {
  const rows = points.map((point, index) => ({
    id: point.snapshotId ?? point.generatedAt ?? String(index),
    label: point.generatedAt ? new Date(point.generatedAt).toLocaleDateString("tr-TR") : `Ölçüm ${index + 1}`,
    net: point.total.net ?? 0,
    questionCount: scoreQuestionCount(point.total),
    standardScore: point.total.standardScore ?? 0,
    successRate: scoreSuccessRate(point.total),
  }));
  const data: ChartData<"line", number[], string> = {
    labels: rows.map((point) => point.label),
    datasets: [
      {
        label: "Başarı %",
        data: rows.map((point) => clampPercent(point.successRate)),
        borderColor: chartBlue,
        backgroundColor: chartBlueSoft,
        pointBackgroundColor: chartBlue,
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
        pointRadius: 4,
        tension: 0.3,
      },
    ],
  };
  const options: ChartOptions<"line"> = {
    ...defaultChartOptions,
    plugins: {
      ...defaultChartOptions.plugins,
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (item: TooltipItem<"line">) => `Başarı: ${typeof item.raw === "number" ? formatPercentNumber(item.raw) : tooltipNumber(item.raw)}`,
          afterLabel: (item: TooltipItem<"line">) => {
            const row = rows[item.dataIndex];
            return row
              ? [`Net: ${formatNetNumber(row.net)}`, `Soru: ${formatQuestionCount(row.questionCount)}`, `Standart puan: ${formatChartNumber(row.standardScore)}`]
              : [];
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: chartText,
          maxRotation: 0,
        },
      },
      y: {
        beginAtZero: true,
        max: 100,
        grid: {
          color: chartGrid,
        },
        ticks: {
          color: chartText,
          callback: (value) => formatPercentNumber(Number(value)),
        },
        title: {
          display: true,
          text: "Başarı %",
        },
      },
    },
  };

  return (
    <div {...props} className={classNames("uh-progress-line-chart", className)}>
      {rows.length > 0 ? <Line data={data} options={options} /> : <ChartEmptyState label={emptyLabel} />}
      <table className="uh-chart-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Ölçüm</th>
            <th scope="col">Başarı</th>
            <th scope="col">Net</th>
            <th scope="col">Soru</th>
            <th scope="col">Standart puan</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((point) => (
              <tr key={point.id}>
                <th scope="row">{point.label}</th>
                <td>{formatPercentNumber(point.successRate)}</td>
                <td>{formatNetNumber(point.net)}</td>
                <td>{formatQuestionCount(point.questionCount)}</td>
                <td>{formatChartNumber(point.standardScore)}</td>
              </tr>
            ))
          ) : (
            <EmptyTableRow colSpan={5} label="Kayıt yok" />
          )}
        </tbody>
      </table>
    </div>
  );
}

export interface TopicRadarChartInput {
  branch: string;
  chartLabel?: string;
  blank?: number;
  correct?: number;
  net?: number;
  questionCount?: number;
  resultCount?: number;
  successRate?: number;
  wrong?: number;
}

export interface TopicRadarChartProps extends HTMLAttributes<HTMLDivElement> {
  branches: TopicRadarChartInput[];
  caption?: string;
  emptyLabel?: string;
}

export function TopicRadarChart({
  branches,
  caption = "Branş başarı analizi",
  className,
  emptyLabel = "Branş verisi yok",
  ...props
}: TopicRadarChartProps) {
  const rows = branches.map((branch) => ({
    chartLabel: branch.chartLabel ?? branch.branch,
    name: branch.branch,
    net: branch.net ?? 0,
    questionCount: scoreQuestionCount(branch),
    resultCount: branch.resultCount ?? 0,
    successRate: scoreSuccessRate(branch),
  }));
  const barData: ChartData<"bar", number[], string> = {
    labels: rows.map((branch) => shortLabel(branch.chartLabel, 18)),
    datasets: [
      {
        label: "Başarı %",
        data: rows.map((branch) => clampPercent(branch.successRate)),
        backgroundColor: chartBlue,
        borderRadius: 6,
        maxBarThickness: 34,
      },
    ],
  };
  const barOptions: ChartOptions<"bar"> = {
    ...defaultChartOptions,
    indexAxis: "y",
    plugins: {
      ...defaultChartOptions.plugins,
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          title: (items: TooltipItem<"bar">[]) => rows[items[0]?.dataIndex ?? -1]?.name ?? "",
          label: (item: TooltipItem<"bar">) => `Başarı: ${typeof item.raw === "number" ? formatPercentNumber(item.raw) : tooltipNumber(item.raw)}`,
          afterLabel: (item: TooltipItem<"bar">) => {
            const row = rows[item.dataIndex];
            return row
              ? [`Net: ${formatNetNumber(row.net)}`, `Soru: ${formatQuestionCount(row.questionCount)}`, `Sonuç: ${formatChartNumber(row.resultCount)}`]
              : [];
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        max: 100,
        grid: {
          color: chartGrid,
        },
        ticks: {
          color: chartText,
          callback: (value) => formatPercentNumber(Number(value)),
        },
      },
      y: {
        grid: {
          display: false,
        },
        ticks: {
          color: chartText,
        },
      },
    },
  };

  return (
    <div {...props} className={classNames("uh-topic-radar-chart", className)}>
      {rows.length > 0 ? <Bar data={barData} options={barOptions} /> : <ChartEmptyState label={emptyLabel} />}
      <table className="uh-chart-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Branş</th>
            <th scope="col">Başarı</th>
            <th scope="col">Net</th>
            <th scope="col">Soru</th>
            <th scope="col">Sonuç</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((branch) => (
              <tr key={branch.name}>
                <th scope="row">{branch.name}</th>
                <td>{formatPercentNumber(branch.successRate)}</td>
                <td>{formatNetNumber(branch.net)}</td>
                <td>{formatQuestionCount(branch.questionCount)}</td>
                <td>{formatChartNumber(branch.resultCount)}</td>
              </tr>
            ))
          ) : (
            <EmptyTableRow colSpan={5} label="Kayıt yok" />
          )}
        </tbody>
      </table>
    </div>
  );
}
