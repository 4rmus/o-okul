"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { CampusRecord, ClassRecord, ExamRecord, GradeLevelRecord, ReportSnapshotRecord, StudentRecord } from "@uzman-hocam/shared-types";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";

export function ClassDetailPage({ classId }: { classId: string }) {
  const { auth } = useAuth();
  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const detailQuery = useQuery({
    queryKey: ["next-class-detail", auth?.session.tenantId ?? "anonymous", classId],
    queryFn: () => loadClassDetail(auth?.accessToken ?? "", classId),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const detail = detailQuery.data;
  const exams = detail?.exams ?? [];
  const reportQuery = useQuery({
    queryKey: ["next-class-detail-report", auth?.session.tenantId ?? "anonymous", classId, selectedExamId, selectedSnapshotId || "auto"],
    queryFn: () => loadClassReport(auth?.accessToken ?? "", classId, selectedExamId, selectedSnapshotId),
    enabled: Boolean(auth && selectedExamId),
    refetchOnWindowFocus: false,
  });
  const selectedSnapshot = reportQuery.data?.selectedSnapshot ?? null;
  const classReport = toClassReport(selectedSnapshot, classId);
  const studentNameById = new Map((detail?.students ?? []).map((student) => [student.id, `${student.firstName} ${student.lastName}`]));

  useEffect(() => {
    if (exams.length === 0 || exams.some((exam) => exam.id === selectedExamId)) return;
    setSelectedExamId(exams[0]?.id ?? "");
    setSelectedSnapshotId("");
  }, [exams, selectedExamId]);

  return (
    <PageFrame
      title={detail?.record.name ?? "Sınıf detayı"}
      subtitle="Sınıf detayı"
      actions={
        <Link className="uh-button uh-button--secondary" href="/kurum/siniflar">
          <ArrowLeft size={17} aria-hidden="true" />
          Sınıflara dön
        </Link>
      }
    >
      <section className="next-report-panel" aria-label="Sınıf detayı">
        {detailQuery.isPending ? <p>Yükleniyor...</p> : null}
        {detailQuery.isError ? <p className="uh-crud-page__error">Sınıf detayı alınamadı.</p> : null}
        {detail ? (
          <>
            <div className="next-detail-selects">
              <label>
                Sınav
                <select
                  aria-label="Sınav"
                  value={selectedExamId}
                  onChange={(event) => {
                    setSelectedExamId(event.target.value);
                    setSelectedSnapshotId("");
                  }}
                >
                  {exams.length === 0 ? <option value="">Sınav yok</option> : null}
                  {exams.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rapor
                <select
                  aria-label="Sınıf sınav raporu"
                  disabled={(reportQuery.data?.snapshots ?? []).length === 0}
                  value={selectedSnapshot?.id ?? ""}
                  onChange={(event) => setSelectedSnapshotId(event.target.value)}
                >
                  {(reportQuery.data?.snapshots ?? []).length === 0 ? <option value="">Hazır rapor yok</option> : null}
                  {(reportQuery.data?.snapshots ?? []).map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.id}>
                      {formatSnapshotLabel(snapshot)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <MetricPanelGrid
              ariaLabel="Sınıf özeti"
              metrics={[
                { label: "Seviye", value: detail.gradeLevelName ?? detail.record.level ?? "-" },
                { label: "Şube", value: detail.record.section ?? "-" },
                { label: "Kampüs", value: detail.campusName ?? "-" },
                { label: "Öğrenci", value: detail.students.length },
                { label: "Sınav net", value: formatNumber(classReport?.averages.net) },
                { label: "Sınav puanı", value: formatNumber(classReport?.averages.standardScore) },
              ]}
            />
            <section className="next-report-list" aria-label="Sınıf öğrencileri">
              <h2>Öğrenciler</h2>
              {detail.students.length > 0 ? (
                detail.students.map((student) => (
                  <p key={student.id}>
                    <Link href={`/kurum/ogrenciler/${encodeURIComponent(student.id)}`}>
                      {student.firstName} {student.lastName}
                    </Link>
                  </p>
                ))
              ) : (
                <p>Öğrenci yok</p>
              )}
            </section>
            <section className="next-report-list" aria-label="Sınıf sınav sonuçları">
              <h2>Sınav sonuçları</h2>
              {toClassStudentResults(selectedSnapshot, classId).length > 0 ? (
                toClassStudentResults(selectedSnapshot, classId).map((student) => (
                  <p key={student.studentId}>
                    {studentNameById.get(student.studentId) ?? student.studentId}: {formatNumber(student.net)} net · {formatNumber(student.standardScore)} puan
                  </p>
                ))
              ) : (
                <p>Hazır sınav sonucu yok</p>
              )}
            </section>
            <section className="next-report-list" aria-label="Sınıf kazanım kırılımı">
              <h2>Kazanım kırılımı</h2>
              {toClassOutcomeRows(selectedSnapshot, classId).length > 0 ? (
                toClassOutcomeRows(selectedSnapshot, classId).map((outcome) => (
                  <p key={`${outcome.branch}-${outcome.outcomeCode}`}>
                    {outcome.branch} / {outcome.outcomeCode}: {formatNumber(outcome.net)} net
                  </p>
                ))
              ) : (
                <p>Kazanım verisi yok</p>
              )}
            </section>
          </>
        ) : null}
      </section>
    </PageFrame>
  );
}

async function loadClassDetail(accessToken: string, classId: string) {
  const [record, campuses, gradeLevels, students, exams] = await Promise.all([
    apiRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes/${encodeURIComponent(classId)}`),
    apiListRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses`),
    apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`),
    apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`),
    apiRequestOrNull<ExamRecord[]>(accessToken, `${apiBaseUrl}/exams`),
  ]);

  return {
    campusName: campuses.data.find((campus) => campus.id === record.campusId)?.name,
    gradeLevelName: gradeLevels.data.find((gradeLevel) => gradeLevel.id === record.gradeLevelId)?.name,
    record,
    students: students.data.filter((student) => student.classId === classId),
    exams: exams ?? [],
  };
}

async function loadClassReport(accessToken: string, classId: string, examId: string, selectedSnapshotId: string) {
  const snapshots = (await apiRequestOrNull<ReportSnapshotRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots?classId=${encodeURIComponent(classId)}`,
  )) ?? [];
  const readySnapshots = snapshots.filter((snapshot) => snapshot.status === "READY");
  return {
    snapshots: readySnapshots,
    selectedSnapshot: readySnapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? readySnapshots[0] ?? null,
  };
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL): Promise<T | null> {
  try {
    return await apiRequest<T>(accessToken, input);
  } catch {
    return null;
  }
}

function toClassReport(snapshot: ReportSnapshotRecord | null, classId: string) {
  return snapshot?.snapshotData?.classes?.find((record) => record.classId === classId) ?? null;
}

function toClassStudentResults(snapshot: ReportSnapshotRecord | null, classId: string) {
  return (snapshot?.snapshotData?.students ?? [])
    .filter((student) => student.classId === classId)
    .map((student) => ({
      studentId: student.studentId,
      net: student.total?.net,
      standardScore: student.total?.standardScore,
    }));
}

function toClassOutcomeRows(snapshot: ReportSnapshotRecord | null, classId: string) {
  const totals = new Map<string, { branch: string; outcomeCode: string; net: number; count: number }>();
  for (const student of snapshot?.snapshotData?.students ?? []) {
    if (student.classId !== classId) continue;
    for (const outcome of student.outcomes ?? []) {
      const key = `${outcome.branch}:${outcome.outcomeCode}`;
      const current = totals.get(key) ?? { branch: outcome.branch, outcomeCode: outcome.outcomeCode, net: 0, count: 0 };
      current.net += outcome.net ?? 0;
      current.count += 1;
      totals.set(key, current);
    }
  }
  return [...totals.values()]
    .map((item) => ({ branch: item.branch, outcomeCode: item.outcomeCode, net: item.count ? item.net / item.count : 0 }))
    .sort((first, second) => second.net - first.net)
    .slice(0, 12);
}

function formatSnapshotLabel(snapshot: ReportSnapshotRecord) {
  const date = snapshot.generatedAt ?? snapshot.snapshotData?.generatedAt ?? snapshot.createdAt;
  return date ? new Date(date).toLocaleDateString("tr-TR") : snapshot.id;
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}
