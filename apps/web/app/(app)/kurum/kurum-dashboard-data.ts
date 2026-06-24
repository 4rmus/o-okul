"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  AttendanceRecord,
  AnnouncementRecord,
  ClassRecord,
  ExamRecord,
  GuardianRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportSnapshotRecord,
  ReportStudentProgress,
  StudentRecord,
  SupportTicketRecord,
  TeacherRecord,
} from "@o-okul/shared-types";
import { apiBaseUrl, apiListRequest, apiRequest, apiUrl } from "../../../src/api-client.js";

export interface KurumReportSummary {
  exam: ExamRecord | null;
  snapshot: ReportSnapshotRecord | null;
}

export interface KurumOverview {
  classCount: number;
  guardianCount: number;
  teacherCount: number;
  studentCount: number;
}

export interface KurumDecisionSignals {
  openSupportTickets: number;
  openImportQuarantines: number;
  overdueInstallments: number;
  attendanceAlerts: number;
}

export interface KurumAnnouncementSummary {
  latestPublishedAt?: string;
  latestTitle?: string;
  publishedCount: number;
}

export interface KurumSystemHealthSummary {
  apiOk: boolean;
  postgresOk: boolean;
  redisOk: boolean;
  readyOk: boolean;
}

export interface KurumDashboardData {
  announcements: KurumAnnouncementSummary;
  decisionSignals: KurumDecisionSignals;
  overview: KurumOverview;
  report: KurumReportSummary;
  systemHealth: KurumSystemHealthSummary;
}

interface ImportQuarantineSummary {
  openCount: number;
}

interface HealthStatus {
  status: "ok";
}

interface ReadyStatus {
  status: "ready";
  dependencies?: {
    postgres?: "ok" | "down";
    redis?: "ok" | "down";
  };
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
  const [overview, decisionSignals, report, announcements, systemHealth] = await Promise.all([
    loadKurumOverview(accessToken),
    loadKurumDecisionSignals(accessToken),
    loadLatestReportSummary(accessToken),
    loadAnnouncementSummary(accessToken),
    loadSystemHealthSummary(),
  ]);
  return { announcements, decisionSignals, overview, report, systemHealth };
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
  const [classes, teachers, students, guardians] = await Promise.all([
    apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`),
    apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`),
    apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students`),
    safeListRequest<GuardianRecord>(accessToken, `${apiBaseUrl}/guardians?page=1&limit=1`),
  ]);

  return {
    classCount: classes.length,
    guardianCount: guardians.meta.total,
    teacherCount: teachers.length,
    studentCount: students.length,
  };
}

async function loadAnnouncementSummary(accessToken: string): Promise<KurumAnnouncementSummary> {
  const announcements = await safeListRequest<AnnouncementRecord>(
    accessToken,
    `${apiBaseUrl}/announcements?page=1&limit=5&sort=-publishedAt`,
  );
  const latestAnnouncement = announcements.data[0];
  return {
    latestPublishedAt: latestAnnouncement?.publishedAt,
    latestTitle: latestAnnouncement?.title,
    publishedCount: announcements.meta.total,
  };
}

async function loadSystemHealthSummary(): Promise<KurumSystemHealthSummary> {
  const [health, ready] = await Promise.all([
    safeFetchJson<HealthStatus>(`${apiUrl}/health`),
    safeFetchJson<ReadyStatus>(`${apiUrl}/health/ready`),
  ]);

  return {
    apiOk: health.ok && health.data?.status === "ok",
    readyOk: ready.ok && ready.data?.status === "ready",
    postgresOk: ready.ok && ready.data?.dependencies?.postgres === "ok",
    redisOk: ready.ok && ready.data?.dependencies?.redis === "ok",
  };
}

async function safeFetchJson<TData>(url: string): Promise<{ data: TData | null; ok: boolean }> {
  try {
    const response = await fetch(url);
    const data = await response.json().catch(() => null);
    return { data: response.ok ? (data as TData) : null, ok: response.ok };
  } catch {
    return { data: null, ok: false };
  }
}

async function safeRequest<T>(accessToken: string, url: string, fallback: T): Promise<T> {
  try {
    return await apiRequest<T>(accessToken, url);
  } catch {
    return fallback;
  }
}

async function safeListRequest<T>(accessToken: string, url: string) {
  try {
    return await apiListRequest<T>(accessToken, url);
  } catch {
    return {
      data: [],
      meta: {
        limit: 0,
        page: 1,
        total: 0,
        totalPages: 0,
      },
    };
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
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/progress?scope=all`,
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
