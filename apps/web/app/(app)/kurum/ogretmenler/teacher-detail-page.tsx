"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { AcademicTermRecord, ClassRecord, CourseRecord, StudentRecord, TeacherAssignmentRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { ArrowLeft, BookOpen, ClipboardList, FileText, NotebookTabs } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";
import { formatCourseName } from "../../_shared/academic-labels.js";

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
                { label: "Sınıf", value: assignedScopeCount(detail.assignments, "classId") },
                { label: "Öğrenci", value: assignedScopeCount(detail.assignments, "studentId") },
                { label: "Portal", value: detail.teacher.userId ? "Bağlı" : "Yok" },
              ]}
            />
            <section className="next-report-list" aria-label="Öğretmen atamaları">
              <h2>Atamalar</h2>
              {detail.assignments.length > 0 ? (
                <div className="next-relationship-list">
                  {detail.assignments.map((assignment) => (
                    <article className="next-relationship-item" key={assignment.id}>
                      <header>
                        <div>
                          <h3>{formatAssignmentSummary(assignment, detail.classNameById, detail.studentNameById, detail.courseNameById, detail.termNameById)}</h3>
                          <p>{formatAssignmentDateRange(assignment)}</p>
                        </div>
                        <span className="next-reference-badge">{formatAssignmentRole(assignment.role)}</span>
                      </header>
                      <dl className="next-definition-list">
                        <div>
                          <dt>Sınıf</dt>
                          <dd>{assignment.classId ? detail.classNameById.get(assignment.classId) ?? assignment.classId : "-"}</dd>
                        </div>
                        <div>
                          <dt>Öğrenci</dt>
                          <dd>{assignment.studentId ? detail.studentNameById.get(assignment.studentId) ?? assignment.studentId : "-"}</dd>
                        </div>
                        <div>
                          <dt>Ders</dt>
                          <dd>{assignment.courseId ? detail.courseNameById.get(assignment.courseId) ?? assignment.courseId : "-"}</dd>
                        </div>
                        <div>
                          <dt>Dönem</dt>
                          <dd>{assignment.termId ? detail.termNameById.get(assignment.termId) ?? assignment.termId : "-"}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              ) : (
                <p>Atama yok</p>
              )}
            </section>
            <section className="next-report-list" aria-label="Öğretmen çalışma alanları">
              <h2>Çalışma alanları</h2>
              <div className="next-action-link-grid">
                <Link className="next-action-link" href="/kurum/notlar">
                  <NotebookTabs size={17} aria-hidden="true" />
                  Öğretmen Notları
                </Link>
                <Link className="next-action-link" href="/kurum/devamsizlik">
                  <ClipboardList size={17} aria-hidden="true" />
                  Yoklama
                </Link>
                <Link className="next-action-link" href="/kurum/materyaller">
                  <BookOpen size={17} aria-hidden="true" />
                  Ödev ve Materyal
                </Link>
                <Link className="next-action-link" href="/kurum/raporlar">
                  <FileText size={17} aria-hidden="true" />
                  Raporlar
                </Link>
              </div>
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
    courseNameById: new Map(courses.data.map((record) => [record.id, formatCourseName(record.name)])),
    studentNameById: new Map(students.data.map((record) => [record.id, `${record.firstName} ${record.lastName}`])),
    teacher,
    termNameById: new Map(terms.data.map((record) => [record.id, record.name])),
  };
}

function formatAssignmentRole(role: TeacherAssignmentRecord["role"]) {
  if (role === "CLASS_TEACHER") return "Sınıf öğretmeni";
  if (role === "BRANCH_TEACHER") return "Branş öğretmeni";
  if (role === "GUIDANCE_COUNSELOR") return "Rehber öğretmen";
  if (role === "RESPONSIBLE_TEACHER") return "Sorumlu öğretmen";
  return role;
}

function assignedScopeCount(assignments: TeacherAssignmentRecord[], key: "classId" | "studentId") {
  return new Set(assignments.map((assignment) => assignment[key]).filter(Boolean)).size;
}

function formatAssignmentSummary(
  assignment: TeacherAssignmentRecord,
  classNameById: ReadonlyMap<string, string>,
  studentNameById: ReadonlyMap<string, string>,
  courseNameById: ReadonlyMap<string, string>,
  termNameById: ReadonlyMap<string, string>,
) {
  const parts = [
    formatAssignmentRole(assignment.role),
    assignment.classId ? classNameById.get(assignment.classId) ?? assignment.classId : undefined,
    assignment.studentId ? studentNameById.get(assignment.studentId) ?? assignment.studentId : undefined,
    assignment.courseId ? courseNameById.get(assignment.courseId) ?? assignment.courseId : undefined,
    assignment.termId ? termNameById.get(assignment.termId) ?? assignment.termId : undefined,
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatAssignmentDateRange(assignment: TeacherAssignmentRecord) {
  const dates = [
    assignment.startsAt ? formatDate(assignment.startsAt) : undefined,
    assignment.endsAt ? formatDate(assignment.endsAt) : undefined,
  ].filter(Boolean);
  return dates.length > 0 ? dates.join(" - ") : "Tarih sınırı yok";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short" }).format(new Date(value));
}
