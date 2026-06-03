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
        backgroundColor: ["#15803d", "#b42318", "#667085"],
        borderColor: "#ffffff",
        borderWidth: 2,
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
      },
    },
  };

  return (
    <div {...props} className={classNames("uh-exam-result-donut", className)}>
      <Doughnut data={data} options={options} />
      <table className="uh-chart-table">
        <caption>{total > 0 ? `Toplam ${total} soru` : "Sonuç verisi yok"}</caption>
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
  classId?: string | null;
  className?: string | null;
  net?: number;
  standardScore?: number;
}

export interface ClassCompareBarProps extends HTMLAttributes<HTMLDivElement> {
  classes: ClassCompareBarInput[];
}

export function ClassCompareBar({ className, classes, ...props }: ClassCompareBarProps) {
  const rows = classes.map((record) => ({
    id: record.classId ?? record.className ?? "no-class",
    name: record.className ?? "Sınıfsız",
    net: record.net ?? 0,
    standardScore: record.standardScore ?? 0,
  }));
  const data: ChartData<"bar", number[], string> = {
    labels: rows.map((record) => record.name),
    datasets: [
      {
        label: "Net",
        data: rows.map((record) => record.net),
        backgroundColor: "#155eef",
        borderRadius: 4,
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
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  return (
    <div {...props} className={classNames("uh-class-compare-bar", className)}>
      <Bar data={data} options={options} />
      <table className="uh-chart-table">
        <caption>{rows.length > 0 ? "Sınıf net karşılaştırması" : "Sınıf verisi yok"}</caption>
        <tbody>
          {rows.map((record) => (
            <tr key={record.id}>
              <th scope="row">{record.name}</th>
              <td>{record.net}</td>
            </tr>
          ))}
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
  points: ProgressLineChartPoint[];
}

export function ProgressLineChart({ className, points, ...props }: ProgressLineChartProps) {
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
        borderColor: "#155eef",
        backgroundColor: "rgba(21, 94, 239, 0.16)",
        pointBackgroundColor: "#155eef",
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
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  return (
    <div {...props} className={classNames("uh-progress-line-chart", className)}>
      <Line data={data} options={options} />
      <table className="uh-chart-table">
        <caption>{rows.length > 0 ? "Öğrenci gelişim grafiği" : "Gelişim verisi yok"}</caption>
        <tbody>
          {rows.map((point) => (
            <tr key={point.id}>
              <th scope="row">{point.label}</th>
              <td>{point.net}</td>
              <td>{point.standardScore}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface TopicRadarChartInput {
  branch: string;
  net?: number;
  resultCount?: number;
}

export interface TopicRadarChartProps extends HTMLAttributes<HTMLDivElement> {
  branches: TopicRadarChartInput[];
}

export function TopicRadarChart({ branches, className, ...props }: TopicRadarChartProps) {
  const rows = branches.map((branch) => ({
    name: branch.branch,
    net: branch.net ?? 0,
    resultCount: branch.resultCount ?? 0,
  }));
  const data: ChartData<"radar", number[], string> = {
    labels: rows.map((branch) => branch.name),
    datasets: [
      {
        label: "Net",
        data: rows.map((branch) => branch.net),
        backgroundColor: "rgba(21, 94, 239, 0.16)",
        borderColor: "#155eef",
        pointBackgroundColor: "#155eef",
      },
    ],
  };
  const options: ChartOptions<"radar"> = {
    ...defaultChartOptions,
    plugins: {
      ...defaultChartOptions.plugins,
      legend: {
        display: false,
      },
    },
    scales: {
      r: {
        beginAtZero: true,
      },
    },
  };

  return (
    <div {...props} className={classNames("uh-topic-radar-chart", className)}>
      <Radar data={data} options={options} />
      <table className="uh-chart-table">
        <caption>{rows.length > 0 ? "Branş net analizi" : "Branş verisi yok"}</caption>
        <tbody>
          {rows.map((branch) => (
            <tr key={branch.name}>
              <th scope="row">{branch.name}</th>
              <td>{branch.net}</td>
              <td>{branch.resultCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
