"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  AttendanceRecord,
  ClassRecord,
  ExamRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportSnapshotRecord,
  ReportStudentProgress,
  StudentRecord,
  SupportTicketRecord,
  TeacherRecord,
} from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiRequest } from "../../../src/api-client.js";

export interface KurumReportSummary {
  exam: ExamRecord | null;
  snapshot: ReportSnapshotRecord | null;
}

export interface KurumOverview {
  classCount: number;
  teacherCount: number;
  studentCount: number;
}

export interface KurumDecisionSignals {
  openSupportTickets: number;
  openImportQuarantines: number;
  overdueInstallments: number;
  attendanceAlerts: number;
}

export interface KurumDashboardData {
  decisionSignals: KurumDecisionSignals;
  overview: KurumOverview;
  report: KurumReportSummary;
}

interface ImportQuarantineSummary {
  openCount: number;
}

export function useKurumDashboardDataQuery(accessToken: string, tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["next-kurum-dashboard-data", tenantId],
    queryFn: () => loadKurumDashboardData(accessToken),
    enabled,
    refetchOnWindowFocus: false,
  });
}

export function useKurumStudentProgressQuery(
  accessToken: string,
  tenantId: string,
  examId: string,
  studentId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["next-kurum-student-progress", tenantId, examId, studentId ?? "none"],
    queryFn: () => loadReportStudentProgress(accessToken, examId, studentId ?? ""),
    enabled: enabled && Boolean(studentId),
    refetchOnWindowFocus: false,
  });
}

async function loadKurumDashboardData(accessToken: string): Promise<KurumDashboardData> {
  const [overview, decisionSignals, report] = await Promise.all([
    loadKurumOverview(accessToken),
    loadKurumDecisionSignals(accessToken),
    loadLatestReportSummary(accessToken),
  ]);
  return { decisionSignals, overview, report };
}

async function loadKurumDecisionSignals(accessToken: string): Promise<KurumDecisionSignals> {
  const [supportTickets, paymentPlans, attendance, importQuarantines] = await Promise.all([
    safeRequest<SupportTicketRecord[]>(accessToken, `${apiBaseUrl}/support-tickets`, []),
    safeRequest<PaymentPlanWithInstallmentsRecord[]>(accessToken, `${apiBaseUrl}/payment-plans`, []),
    safeRequest<AttendanceRecord[]>(accessToken, `${apiBaseUrl}/attendance`, []),
    safeRequest<ImportQuarantineSummary>(accessToken, `${apiBaseUrl}/import-quarantines/summary`, { openCount: 0 }),
  ]);

  return {
    openSupportTickets: supportTickets.filter((ticket) => ticket.status === "OPEN" || ticket.status === "IN_PROGRESS").length,
    openImportQuarantines: importQuarantines.openCount,
    overdueInstallments: paymentPlans.flatMap((plan) => plan.installments).filter((installment) => installment.status === "OVERDUE").length,
    attendanceAlerts: attendance.filter((record) => record.status === "ABSENT" || record.status === "LATE").length,
  };
}

async function loadKurumOverview(accessToken: string): Promise<KurumOverview> {
  const [classes, teachers, students] = await Promise.all([
    apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`),
    apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`),
    apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students`),
  ]);

  return {
    classCount: classes.length,
    teacherCount: teachers.length,
    studentCount: students.length,
  };
}

async function safeRequest<T>(accessToken: string, url: string, fallback: T): Promise<T> {
  try {
    return await apiRequest<T>(accessToken, url);
  } catch {
    return fallback;
  }
}

async function loadLatestReportSummary(accessToken: string): Promise<KurumReportSummary> {
  const exams = await apiRequest<ExamRecord[]>(accessToken, `${apiBaseUrl}/exams`);
  const publishedExams = exams.filter((exam) => exam.status === "PUBLISHED").sort(compareExamRecency);
  const latestExam = publishedExams[0] ?? null;

  for (const exam of publishedExams) {
    const snapshot = await loadLatestReadyReportSnapshot(accessToken, exam.id);
    if (snapshot) return { exam, snapshot };
  }

  return { exam: latestExam, snapshot: null };
}

async function loadLatestReadyReportSnapshot(accessToken: string, examId: string): Promise<ReportSnapshotRecord | null> {
  const snapshots = await apiRequest<ReportSnapshotRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots`,
  );

  return snapshots.find((snapshot) => snapshot.status === "READY") ?? null;
}

async function loadReportStudentProgress(accessToken: string, examId: string, studentId: string) {
  return apiRequest<ReportStudentProgress>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/progress`,
  );
}

function compareExamRecency(left: ExamRecord, right: ExamRecord) {
  return examTimestamp(right) - examTimestamp(left);
}

function examTimestamp(exam: ExamRecord) {
  const value = exam.startsAt ?? exam.createdAt ?? exam.updatedAt;
  const timestamp = value ? Date.parse(value) : 0;
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
