"use client";

import { useQuery } from "@tanstack/react-query";
import type { ClassRecord, ReportSnapshotRecord, ReportStudentProgress, StudentRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiRequest } from "../../../src/api-client.js";

export function useKurumOverviewQuery(accessToken: string, tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["next-kurum-overview", tenantId],
    queryFn: () => loadKurumOverview(accessToken),
    enabled,
    refetchOnWindowFocus: false,
  });
}

export function useKurumReportSummaryQuery(accessToken: string, tenantId: string, examId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["next-kurum-report-summary", tenantId, examId],
    queryFn: () => loadLatestReportSnapshot(accessToken, examId),
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

async function loadKurumOverview(accessToken: string) {
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

async function loadLatestReportSnapshot(accessToken: string, examId: string): Promise<ReportSnapshotRecord | null> {
  const snapshots = await apiRequest<ReportSnapshotRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots`,
  );

  return snapshots[0] ?? null;
}

async function loadReportStudentProgress(accessToken: string, examId: string, studentId: string) {
  return apiRequest<ReportStudentProgress>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/progress`,
  );
}
