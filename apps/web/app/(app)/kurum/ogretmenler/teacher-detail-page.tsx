"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { AcademicTermRecord, ClassRecord, CourseRecord, StudentRecord, TeacherAssignmentRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";

export function TeacherDetailPage({ teacherId }: { teacherId: string }) {
  const { auth } = useAuth();
  const detailQuery = useQuery({
    queryKey: ["next-teacher-detail", auth?.session.tenantId ?? "anonymous", teacherId],
    queryFn: () => loadTeacherDetail(auth?.accessToken ?? "", teacherId),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const detail = detailQuery.data;
  const teacherName = detail ? `${detail.teacher.firstName} ${detail.teacher.lastName}` : "Öğretmen detayı";

  return (
    <PageFrame
      title={teacherName}
      subtitle="Öğretmen detayı"
      actions={
        <Link className="uh-button uh-button--secondary" href="/kurum/ogretmenler">
          <ArrowLeft size={17} aria-hidden="true" />
          Öğretmenlere dön
        </Link>
      }
    >
      <section className="next-report-panel" aria-label="Öğretmen detayı">
        {detailQuery.isPending ? <p>Yükleniyor...</p> : null}
        {detailQuery.isError ? <p className="uh-crud-page__error">Öğretmen detayı alınamadı.</p> : null}
        {detail ? (
          <>
            <MetricPanelGrid
              ariaLabel="Öğretmen özeti"
              metrics={[
                { label: "Branş", value: detail.teacher.branch ?? "-" },
                { label: "Atama", value: detail.assignments.length },
                { label: "Portal", value: detail.teacher.userId ? "Bağlı" : "Yok" },
              ]}
            />
            <section className="next-report-list" aria-label="Öğretmen atamaları">
              <h2>Atamalar</h2>
              {detail.assignments.length > 0 ? (
                detail.assignments.map((assignment) => (
                  <p key={assignment.id}>
                    {formatAssignmentRole(assignment.role)} - {assignment.classId ? detail.classNameById.get(assignment.classId) ?? assignment.classId : "Sınıf yok"}
                    {assignment.studentId ? ` / ${detail.studentNameById.get(assignment.studentId) ?? assignment.studentId}` : ""}
                    {assignment.courseId ? ` / ${detail.courseNameById.get(assignment.courseId) ?? assignment.courseId}` : ""}
                    {assignment.termId ? ` / ${detail.termNameById.get(assignment.termId) ?? assignment.termId}` : ""}
                  </p>
                ))
              ) : (
                <p>Atama yok</p>
              )}
            </section>
          </>
        ) : null}
      </section>
    </PageFrame>
  );
}

async function loadTeacherDetail(accessToken: string, teacherId: string) {
  const [teacher, assignments, classes, students, courses, terms] = await Promise.all([
    apiRequest<TeacherRecord>(accessToken, `${apiBaseUrl}/teachers/${encodeURIComponent(teacherId)}`),
    apiRequest<TeacherAssignmentRecord[]>(accessToken, `${apiBaseUrl}/teachers/${encodeURIComponent(teacherId)}/assignments`),
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`),
    apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`),
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);

  return {
    assignments,
    classNameById: new Map(classes.data.map((record) => [record.id, record.name])),
    courseNameById: new Map(courses.data.map((record) => [record.id, record.name])),
    studentNameById: new Map(students.data.map((record) => [record.id, `${record.firstName} ${record.lastName}`])),
    teacher,
    termNameById: new Map(terms.data.map((record) => [record.id, record.name])),
  };
}

function formatAssignmentRole(role: TeacherAssignmentRecord["role"]) {
  if (role === "CLASS_TEACHER") return "Sınıf öğretmeni";
  if (role === "BRANCH_TEACHER") return "Branş öğretmeni";
  if (role === "GUIDANCE_COUNSELOR") return "Rehberlik";
  if (role === "RESPONSIBLE_TEACHER") return "Sorumlu öğretmen";
  return role;
}
