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
  RadialLinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { Bar, Doughnut, Line, Radar } from "react-chartjs-2";
import { classNames } from "../class-names.js";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  RadialLinearScale,
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

function shortLabel(label: string, maxLength = 20) {
  return label.length > maxLength ? `${label.slice(0, maxLength - 3)}...` : label;
}

function tooltipNumber(value: unknown) {
  return typeof value === "number" ? formatChartNumber(value) : String(value ?? "-");
}

function ChartEmptyState({ label }: { label: string }) {
  return <div className="uh-chart-empty-state">{label}</div>;
}

function EmptyTableRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan}>{label}</td>
    </tr>
  );
}

export interface ExamResultDonutInput {
  correct?: number;
  wrong?: number;
  blank?: number;
}

export interface ExamResultDonutProps extends HTMLAttributes<HTMLDivElement> {
  result: ExamResultDonutInput;
}

export function ExamResultDonut({ className, result, ...props }: ExamResultDonutProps) {
  const correct = result.correct ?? 0;
  const wrong = result.wrong ?? 0;
  const blank = result.blank ?? 0;
  const total = correct + wrong + blank;
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
      {total > 0 ? <Doughnut data={data} options={options} /> : <ChartEmptyState label="Sonuç verisi yok" />}
      <table className="uh-chart-table">
        <caption>{total > 0 ? `Toplam ${total} soru` : "Sonuç verisi yok"}</caption>
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
  standardScore?: number;
}

export interface ClassCompareBarProps extends HTMLAttributes<HTMLDivElement> {
  caption?: string;
  classes: ClassCompareBarInput[];
  emptyLabel?: string;
  valueLabel?: string;
}

export function ClassCompareBar({
  caption = "Sınıf net karşılaştırması",
  className,
  classes,
  emptyLabel = "Sınıf verisi yok",
  valueLabel = "Net",
  ...props
}: ClassCompareBarProps) {
  const rows = classes.map((record) => ({
    chartLabel: record.chartLabel ?? record.className ?? "Sınıfsız",
    id: record.classId ?? record.className ?? "no-class",
    name: record.className ?? "Sınıfsız",
    net: record.net ?? 0,
    standardScore: record.standardScore ?? 0,
  }));
  const data: ChartData<"bar", number[], string> = {
    labels: rows.map((record) => shortLabel(record.chartLabel)),
    datasets: [
      {
        label: valueLabel,
        data: rows.map((record) => record.net),
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
          label: (item: TooltipItem<"bar">) => `${valueLabel}: ${typeof item.raw === "number" ? formatNetNumber(item.raw) : tooltipNumber(item.raw)}`,
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
        grid: {
          color: chartGrid,
        },
        ticks: {
          color: chartText,
          callback: (value) => formatNetNumber(Number(value)),
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
            <th scope="col">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((record) => (
              <tr key={record.id}>
                <th scope="row">{record.name}</th>
                <td>{formatNetNumber(record.net)}</td>
              </tr>
            ))
          ) : (
            <EmptyTableRow colSpan={2} label="Kayıt yok" />
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
    net?: number;
    standardScore?: number;
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
    standardScore: point.total.standardScore ?? 0,
  }));
  const data: ChartData<"line", number[], string> = {
    labels: rows.map((point) => point.label),
    datasets: [
      {
        label: "Net",
        data: rows.map((point) => point.net),
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
          label: (item: TooltipItem<"line">) => `Net: ${typeof item.raw === "number" ? formatNetNumber(item.raw) : tooltipNumber(item.raw)}`,
          afterLabel: (item: TooltipItem<"line">) => {
            const row = rows[item.dataIndex];
            return row ? `Standart puan: ${formatChartNumber(row.standardScore)}` : "";
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
        grid: {
          color: chartGrid,
        },
        ticks: {
          color: chartText,
          callback: (value) => formatNetNumber(Number(value)),
        },
        title: {
          display: true,
          text: "Net",
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
            <th scope="col">Net</th>
            <th scope="col">Standart puan</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((point) => (
              <tr key={point.id}>
                <th scope="row">{point.label}</th>
                <td>{formatNetNumber(point.net)}</td>
                <td>{formatChartNumber(point.standardScore)}</td>
              </tr>
            ))
          ) : (
            <EmptyTableRow colSpan={3} label="Kayıt yok" />
          )}
        </tbody>
      </table>
    </div>
  );
}

export interface TopicRadarChartInput {
  branch: string;
  chartLabel?: string;
  net?: number;
  resultCount?: number;
}

export interface TopicRadarChartProps extends HTMLAttributes<HTMLDivElement> {
  branches: TopicRadarChartInput[];
  caption?: string;
  emptyLabel?: string;
}

export function TopicRadarChart({
  branches,
  caption = "Branş net analizi",
  className,
  emptyLabel = "Branş verisi yok",
  ...props
}: TopicRadarChartProps) {
  const rows = branches.map((branch) => ({
    chartLabel: branch.chartLabel ?? branch.branch,
    name: branch.branch,
    net: branch.net ?? 0,
    resultCount: branch.resultCount ?? 0,
  }));
  const useCompactBar = rows.length > 0 && rows.length < 3;
  const radarData: ChartData<"radar", number[], string> = {
    labels: rows.map((branch) => shortLabel(branch.chartLabel, 18)),
    datasets: [
      {
        label: "Net",
        data: rows.map((branch) => branch.net),
        backgroundColor: chartBlueSoft,
        borderColor: chartBlue,
        pointBackgroundColor: chartBlue,
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
      },
    ],
  };
  const compactBarData: ChartData<"bar", number[], string> = {
    labels: rows.map((branch) => shortLabel(branch.chartLabel, 18)),
    datasets: [
      {
        label: "Net",
        data: rows.map((branch) => branch.net),
        backgroundColor: chartBlue,
        borderRadius: 6,
        maxBarThickness: 34,
      },
    ],
  };
  const radarOptions: ChartOptions<"radar"> = {
    ...defaultChartOptions,
    plugins: {
      ...defaultChartOptions.plugins,
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          title: (items: TooltipItem<"radar">[]) => rows[items[0]?.dataIndex ?? -1]?.name ?? "",
          label: (item: TooltipItem<"radar">) => `Net: ${typeof item.raw === "number" ? formatNetNumber(item.raw) : tooltipNumber(item.raw)}`,
          afterLabel: (item: TooltipItem<"radar">) => {
            const row = rows[item.dataIndex];
            return row ? `Sonuç: ${formatChartNumber(row.resultCount)}` : "";
          },
        },
      },
    },
    scales: {
      r: {
        beginAtZero: true,
        grid: {
          color: chartGrid,
        },
        pointLabels: {
          color: chartText,
          font: {
            size: 12,
          },
        },
        ticks: {
          backdropColor: "transparent",
          color: chartText,
          callback: (value) => formatNetNumber(Number(value)),
          showLabelBackdrop: false,
        },
      },
    },
  };
  const compactBarOptions: ChartOptions<"bar"> = {
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
          label: (item: TooltipItem<"bar">) => `Net: ${typeof item.raw === "number" ? formatNetNumber(item.raw) : tooltipNumber(item.raw)}`,
          afterLabel: (item: TooltipItem<"bar">) => {
            const row = rows[item.dataIndex];
            return row ? `Sonuç: ${formatChartNumber(row.resultCount)}` : "";
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: {
          color: chartGrid,
        },
        ticks: {
          color: chartText,
          callback: (value) => formatNetNumber(Number(value)),
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
      {rows.length > 0 ? (
        useCompactBar ? (
          <Bar data={compactBarData} options={compactBarOptions} />
        ) : (
          <Radar data={radarData} options={radarOptions} />
        )
      ) : (
        <ChartEmptyState label={emptyLabel} />
      )}
      <table className="uh-chart-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Branş</th>
            <th scope="col">Net</th>
            <th scope="col">Sonuç</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((branch) => (
              <tr key={branch.name}>
                <th scope="row">{branch.name}</th>
                <td>{formatNetNumber(branch.net)}</td>
                <td>{branch.resultCount}</td>
              </tr>
            ))
          ) : (
            <EmptyTableRow colSpan={3} label="Kayıt yok" />
          )}
        </tbody>
      </table>
    </div>
  );
}
