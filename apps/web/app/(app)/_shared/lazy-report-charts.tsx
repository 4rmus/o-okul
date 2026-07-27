"use client";

import { lazy, Suspense } from "react";
import type {
  ClassCompareBarProps,
  ExamResultDonutProps,
  PracticeScoreBarProps,
  ProgressLineChartProps,
  TopicRadarChartProps,
} from "@o-okul/ui/charts";

function ChartLoadingState() {
  return <div className="uh-chart-loading">Grafik yükleniyor...</div>;
}

const ClassCompareBarComponent = lazy(() => import("@o-okul/ui/charts").then((module) => ({ default: module.ClassCompareBar })));
const ExamResultDonutComponent = lazy(() => import("@o-okul/ui/charts").then((module) => ({ default: module.ExamResultDonut })));
const PracticeScoreBarComponent = lazy(() => import("@o-okul/ui/charts").then((module) => ({ default: module.PracticeScoreBar })));
const ProgressLineChartComponent = lazy(() => import("@o-okul/ui/charts").then((module) => ({ default: module.ProgressLineChart })));
const TopicRadarChartComponent = lazy(() => import("@o-okul/ui/charts").then((module) => ({ default: module.TopicRadarChart })));

export function ClassCompareBar(props: ClassCompareBarProps) {
  return (
    <Suspense fallback={<ChartLoadingState />}>
      <ClassCompareBarComponent {...props} />
    </Suspense>
  );
}

export function ExamResultDonut(props: ExamResultDonutProps) {
  return (
    <Suspense fallback={<ChartLoadingState />}>
      <ExamResultDonutComponent {...props} />
    </Suspense>
  );
}

export function PracticeScoreBar(props: PracticeScoreBarProps) {
  return (
    <Suspense fallback={<ChartLoadingState />}>
      <PracticeScoreBarComponent {...props} />
    </Suspense>
  );
}

export function ProgressLineChart(props: ProgressLineChartProps) {
  return (
    <Suspense fallback={<ChartLoadingState />}>
      <ProgressLineChartComponent {...props} />
    </Suspense>
  );
}

export function TopicRadarChart(props: TopicRadarChartProps) {
  return (
    <Suspense fallback={<ChartLoadingState />}>
      <TopicRadarChartComponent {...props} />
    </Suspense>
  );
}
