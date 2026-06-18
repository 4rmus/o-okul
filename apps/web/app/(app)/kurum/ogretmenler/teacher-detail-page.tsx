"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { AcademicTermRecord, ClassRecord, CourseRecord, StudentRecord, TeacherAssignmentRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { ArrowLeft, BookOpen, ClipboardList, FileText, NotebookTabs, Send } from "lucide-react";
import { DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@uzman-hocam/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import { hasCapabilityForRoles } from "../../_shared/access.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

interface TeacherDetailData {
  assignments: TeacherAssignmentRecord[];
  classNameById: Map<string, string>;
  courseNameById: Map<string, string>;
  studentNameById: Map<string, string>;
  teacher: TeacherRecord;
  termNameById: Map<string, string>;
}

export function TeacherDetailPage({ teacherId }: { teacherId: string }) {
  const { auth } = useAuth();
  const canManageUsers = auth ? hasCapabilityForRoles(auth.session.roles, "user:manage") : false;
  const detailQuery = useQuery({
    queryKey: ["next-teacher-detail", auth?.session.tenantId ?? "anonymous", teacherId],
    queryFn: () => loadTeacherDetail(auth?.accessToken ?? "", teacherId),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const detail = detailQuery.data;
  const teacherName = detail ? `${detail.teacher.firstName} ${detail.teacher.lastName}` : "Öğretmen detayı";
  const teacherBranch = detail?.teacher.branch?.trim() || "Branş bilgisi yok";
  const teacherSummaryItems = detail ? buildTeacherSummaryItems(detail) : [];
  const teacherSummaryBadges = detail ? buildTeacherSummaryBadges(detail) : [];
  const teacherSummaryActions = detail ? buildTeacherSummaryActions(detail) : [];
  const assignmentColumns = detail ? buildAssignmentColumns(detail) : [];

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
      <section className="next-detail-workspace" aria-label="Öğretmen detayı">
        {detailQuery.isPending ? <p>Yükleniyor...</p> : null}
        {detailQuery.isError ? <p className="uh-crud-page__error">Öğretmen detayı alınamadı.</p> : null}
        {detail ? (
          <>
            <OperationSummary
              actions={teacherSummaryActions}
              ariaLabel="Öğretmen detay operasyon özeti"
              badges={teacherSummaryBadges}
              items={teacherSummaryItems}
            />
            <Panel
              aria-label="Öğretmen profil kartı"
              description="Branş, portal ve görev kapsamı tek görünümde okunur; ham tenant veya kayıt anahtarı gösterilmez."
              title="Profil"
            >
              <dl className="next-definition-list">
                <div>
                  <dt>Branş</dt>
                  <dd>{teacherBranch}</dd>
                </div>
                <div>
                  <dt>Portal</dt>
                  <dd>{detail.teacher.userId ? "Bağlı" : "Yok"}</dd>
                </div>
                <div>
                  <dt>Görev kapsamı</dt>
                  <dd>{formatCount(detail.assignments.length)} atama</dd>
                </div>
              </dl>
            </Panel>
            <Panel
              aria-label="Öğretmen atama ilişkileri"
              description="Sınıf, öğrenci, ders ve dönem ilişkileri yoğun tablo düzeninde izlenir."
              title="Atama ilişkileri"
            >
              <DataTable
                caption="Öğretmen atama ilişkileri"
                columns={assignmentColumns}
                density="compact"
                description="Öğretmen rolü, kapsamı, ders/dönem ve tarih aralığı."
                emptyText="Atama yok"
                getRowKey={(assignment) => assignment.id}
                rows={detail.assignments}
              />
            </Panel>
            <Panel
              aria-label="Öğretmen çalışma alanları"
              description="Bu öğretmenin günlük operasyonlarının bağlı olduğu kurum ekranları."
              title="Çalışma alanları"
            >
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
                {canManageUsers ? (
                  <Link className="next-action-link" href={`/kurum/kullanicilar?invite=teacher&subjectId=${encodeURIComponent(teacherId)}`}>
                    <Send size={17} aria-hidden="true" />
                    Portal daveti gönder
                  </Link>
                ) : null}
              </div>
            </Panel>
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

function buildTeacherSummaryItems(detail: TeacherDetailData): OperationSummaryItem[] {
  const classCount = assignedScopeCount(detail.assignments, "classId");
  const studentCount = assignedScopeCount(detail.assignments, "studentId");
  const branchAssignmentCount = detail.assignments.filter((assignment) => assignment.role === "BRANCH_TEACHER").length;
  return [
    {
      description: detail.teacher.branch?.trim() || "Branş bilgisi yok",
      key: "assignment",
      label: "Atama toplamı",
      value: formatCount(detail.assignments.length),
    },
    {
      description: "Sınıf ve öğrenci kapsamı",
      key: "scope",
      label: "Kapsam",
      tone: classCount + studentCount > 0 ? "info" : "default",
      value: `${formatCount(classCount)} / ${formatCount(studentCount)}`,
    },
    {
      description: "Ders öğretmenliği ilişkileri",
      key: "branch",
      label: "Branş görevi",
      tone: branchAssignmentCount > 0 ? "success" : "default",
      value: formatCount(branchAssignmentCount),
    },
  ];
}

function buildTeacherSummaryBadges(detail: TeacherDetailData): OperationSummaryBadge[] {
  const missingReferenceCount = countMissingAssignmentReferences(detail);
  return [
    {
      key: "portal",
      label: detail.teacher.userId ? "Portal bağlı" : "Portal daveti bekliyor",
      tone: detail.teacher.userId ? "success" : "warning",
    },
    {
      key: "references",
      label: missingReferenceCount > 0 ? `${formatCount(missingReferenceCount)} eşleşme kontrolü` : "Referanslar temiz",
      tone: missingReferenceCount > 0 ? "warning" : "success",
    },
  ];
}

function buildTeacherSummaryActions(detail: TeacherDetailData): OperationSummaryAction[] {
  const classCount = assignedScopeCount(detail.assignments, "classId");
  const courseCount = assignedScopeCount(detail.assignments, "courseId");
  const studentCount = assignedScopeCount(detail.assignments, "studentId");
  return [
    {
      detail: "Sınıf öğretmenliği ve rehberlik kapsamı",
      key: "class-scope",
      label: "Sınıf kapsamı",
      status: classCount > 0 ? "Bağlı" : "Bekliyor",
      tone: classCount > 0 ? "info" : "neutral",
      value: `${formatCount(classCount)} sınıf`,
    },
    {
      detail: "Ders programı ve rapor kırılımı için branş bağı",
      key: "course-scope",
      label: "Ders kapsamı",
      status: courseCount > 0 ? "İzleniyor" : "Opsiyonel",
      tone: courseCount > 0 ? "info" : "neutral",
      value: `${formatCount(courseCount)} ders`,
    },
    {
      detail: "Bireysel öğrenci sorumlulukları",
      key: "student-scope",
      label: "Öğrenci sorumluluğu",
      status: studentCount > 0 ? "Bağlı" : "Yok",
      tone: studentCount > 0 ? "success" : "neutral",
      value: `${formatCount(studentCount)} öğrenci`,
    },
  ];
}

function buildAssignmentColumns(detail: TeacherDetailData): Array<DataTableColumn<TeacherAssignmentRecord>> {
  return [
    {
      key: "role",
      header: "Rol",
      mobilePriority: "primary",
      priority: "primary",
      render: (assignment) => <StatusBadge tone={assignmentRoleTone(assignment.role)}>{formatAssignmentRole(assignment.role)}</StatusBadge>,
      sticky: "left",
    },
    {
      key: "scope",
      header: "Kapsam",
      mobilePriority: "primary",
      priority: "primary",
      render: (assignment) => formatAssignmentScope(assignment, detail.classNameById, detail.studentNameById),
    },
    {
      key: "course",
      header: "Ders",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (assignment) => courseLabel(assignment.courseId, detail.courseNameById),
    },
    {
      key: "term",
      header: "Dönem",
      mobilePriority: "hidden",
      priority: "optional",
      render: (assignment) => termLabel(assignment.termId, detail.termNameById),
    },
    {
      key: "dates",
      header: "Tarih",
      mobilePriority: "hidden",
      priority: "optional",
      render: (assignment) => formatAssignmentDateRange(assignment),
    },
  ];
}

function formatAssignmentRole(role: TeacherAssignmentRecord["role"]) {
  if (role === "CLASS_TEACHER") return "Sınıf öğretmeni";
  if (role === "BRANCH_TEACHER") return "Branş öğretmeni";
  if (role === "GUIDANCE_COUNSELOR") return "Rehber öğretmen";
  if (role === "RESPONSIBLE_TEACHER") return "Sorumlu öğretmen";
  return role;
}

function assignmentRoleTone(role: TeacherAssignmentRecord["role"]): StatusBadgeProps["tone"] {
  if (role === "CLASS_TEACHER" || role === "RESPONSIBLE_TEACHER") return "success";
  if (role === "BRANCH_TEACHER") return "info";
  if (role === "GUIDANCE_COUNSELOR") return "warning";
  return "neutral";
}

function assignedScopeCount(assignments: TeacherAssignmentRecord[], key: "classId" | "courseId" | "studentId") {
  return new Set(assignments.map((assignment) => assignment[key]).filter(Boolean)).size;
}

function formatAssignmentScope(
  assignment: TeacherAssignmentRecord,
  classNameById: ReadonlyMap<string, string>,
  studentNameById: ReadonlyMap<string, string>,
) {
  const parts = [
    assignment.classId ? classLabel(assignment.classId, classNameById) : undefined,
    assignment.studentId ? studentLabel(assignment.studentId, studentNameById) : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "Genel görev";
}

function classLabel(classId: string, classNameById: ReadonlyMap<string, string>) {
  return classNameById.get(classId) ?? "Sınıf eşleşmedi";
}

function studentLabel(studentId: string, studentNameById: ReadonlyMap<string, string>) {
  return studentNameById.get(studentId) ?? "Öğrenci eşleşmedi";
}

function courseLabel(courseId: string | undefined, courseNameById: ReadonlyMap<string, string>) {
  return courseId ? courseNameById.get(courseId) ?? "Ders eşleşmedi" : "-";
}

function termLabel(termId: string | undefined, termNameById: ReadonlyMap<string, string>) {
  return termId ? termNameById.get(termId) ?? "Dönem eşleşmedi" : "-";
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

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function countMissingAssignmentReferences(detail: TeacherDetailData) {
  return detail.assignments.reduce((total, assignment) => {
    const missingClass = assignment.classId && !detail.classNameById.has(assignment.classId) ? 1 : 0;
    const missingStudent = assignment.studentId && !detail.studentNameById.has(assignment.studentId) ? 1 : 0;
    const missingCourse = assignment.courseId && !detail.courseNameById.has(assignment.courseId) ? 1 : 0;
    const missingTerm = assignment.termId && !detail.termNameById.has(assignment.termId) ? 1 : 0;
    return total + missingClass + missingStudent + missingCourse + missingTerm;
  }, 0);
}
