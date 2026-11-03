"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DataTable, InfoGrid, InfoItem, LoadingState, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import type {
  ClassOverview,
  ClassOverviewAssessmentStatus,
  ClassOverviewTeacherAssignment,
  TeacherAssignmentRole,
} from "@o-okul/shared-types";
import { useAuth } from "../../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../../src/api-client.js";
import { canAccessHref, hasCapabilityForRoles } from "../../../_shared/access.js";
import { formatDateKey } from "../../../_shared/format.js";

// DEC-20261102-04 Sınıf 360: yoklama, ödev ve not girişi yalnız sayı olarak okunur; taslak puan veya ortalama gösterilmez.
export function ClassOverviewPanels({ classId }: { classId: string }) {
  const { auth } = useAuth();
  const roles = auth?.session.roles ?? [];
  const canReadAcademicOps = hasCapabilityForRoles(roles, "academic:manage");
  const overviewQuery = useQuery({
    queryKey: ["next-class-overview", auth?.session.tenantId ?? "anonymous", classId],
    queryFn: () => apiRequest<ClassOverview>(auth?.accessToken ?? "", `${apiBaseUrl}/classes/${encodeURIComponent(classId)}/overview`),
    enabled: Boolean(auth && canReadAcademicOps),
    refetchOnWindowFocus: false,
  });

  if (!canReadAcademicOps) return null;
  if (overviewQuery.isPending) return <LoadingState label="Sınıfın akademik durumu yükleniyor…" />;
  if (overviewQuery.isError || !isClassOverview(overviewQuery.data)) {
    return (
      <Panel
        aria-label="Sınıf akademik durumu"
        description="Yoklama, ödev ve not girişi sayıları şu anda alınamadı."
        title="Akademik durum"
        tone="warning"
      />
    );
  }

  const overview = overviewQuery.data;
  const activePersona = auth?.session.activePersona;
  // Sınıfın bu dönemki tüm değerlendirmeleri; canlı not giren ataması olmayanlar da listede kalır.
  const assessments = sortAssessments(overview.assessments);
  const rollCall = rollCallLabel(overview);
  // UAT U5: aynı öğretmenin sınıf ve branş atamaları tek satırda birleşir; değerlendirmeler bir kez sayılır.
  const teacherRows = groupTeacherAssignments(overview.teacherAssignments);

  const teacherColumns: Array<DataTableColumn<TeacherGradeEntryRow>> = [
    {
      key: "teacher",
      header: "Öğretmen",
      mobilePriority: "primary",
      priority: "primary",
      sticky: "left",
      render: (row) => (
        <span>
          {row.teacherName}
          <small> {row.roles.map(assignmentRoleLabel).join(" · ")}</small>
        </span>
      ),
    },
    {
      key: "course",
      header: "Ders",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (row) => row.courseLabel,
    },
    {
      key: "assessments",
      header: "Değerlendirme",
      align: "right",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (assignment) => formatCount(assignment.assessmentCount),
    },
    {
      key: "missing",
      header: "Eksik giriş",
      align: "right",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (assignment) => formatCount(assignment.missingEntryAssessmentCount),
    },
    {
      key: "drafts",
      header: "Yayın bekleyen",
      align: "right",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (assignment) => formatCount(assignment.unpublishedDraftAssessmentCount),
    },
    {
      key: "status",
      header: "Durum",
      mobilePriority: "primary",
      priority: "primary",
      render: (assignment) => {
        const status = assignmentStatus(assignment);
        return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
      },
    },
  ];

  const assessmentColumns: Array<DataTableColumn<ClassOverviewAssessmentStatus>> = [
    {
      key: "assessment",
      header: "Değerlendirme",
      mobilePriority: "primary",
      priority: "primary",
      sticky: "left",
      render: (assessment) => (
        <span>
          {assessment.title}
          {assessment.courseName ? <small> {assessment.courseName}</small> : null}
        </span>
      ),
    },
    {
      key: "heldOn",
      header: "Tarih",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (assessment) => formatDateKey(assessment.heldOn),
    },
    {
      key: "entries",
      header: "Giriş",
      align: "right",
      mobilePriority: "primary",
      priority: "primary",
      render: (assessment) => `${formatCount(assessment.enteredCount)}/${formatCount(assessment.rosterCount)}`,
    },
    {
      key: "publication",
      header: "Yayın",
      mobilePriority: "primary",
      priority: "primary",
      render: (assessment) => {
        const status = publicationStatus(assessment);
        return <StatusBadge tone={status.tone}>{status.label}</StatusBadge>;
      },
    },
  ];

  return (
    <>
      <Panel
        actions={canAccessHref(roles, "/kurum/devamsizlik", activePersona)
          ? <Link href={`/kurum/devamsizlik?classId=${encodeURIComponent(classId)}`}>Yoklamayı aç</Link>
          : undefined}
        aria-label="Sınıf akademik durumu"
        description="Bugünün yoklaması, açık ödevler ve not girişi sınıf mevcuduna göre okunur."
        title="Akademik durum"
      >
        <InfoGrid aria-label="Sınıf akademik durum özeti" role="region">
          <InfoItem label="Sınıf mevcudu" value={`${formatCount(overview.rosterCount)} öğrenci`} description={`${formatDateKey(overview.date)} itibarıyla`} />
          <InfoItem
            label="Bugünkü yoklama"
            value={<StatusBadge tone={rollCall.tone}>{rollCall.label}</StatusBadge>}
            description={rollCall.description}
          />
          <InfoItem
            label="Açık ödev"
            value={formatCount(overview.homework.openCount)}
            description={`${formatCount(overview.homework.waitingSubmissionCount)} teslim kontrol bekliyor`}
          />
          <InfoItem
            label="Not girişi"
            value={`${formatCount(overview.gradeEntry.missingEntryAssessmentCount)} eksik`}
            description={`${formatCount(overview.gradeEntry.assessmentCount)} değerlendirme · ${formatCount(overview.gradeEntry.unpublishedDraftAssessmentCount)} yayın bekliyor`}
          />
        </InfoGrid>
      </Panel>
      <Panel
        actions={canAccessHref(roles, "/kurum/not-defteri", activePersona) ? <Link href="/kurum/not-defteri">Not defterini aç</Link> : undefined}
        aria-label="Öğretmen not girişi durumu"
        description="Sınıfa atanmış sınıf ve branş öğretmenlerinin ders ve dönem kapsamına giren değerlendirmeler ve giriş durumu."
        title="Not girişi"
      >
        <DataTable
          caption="Öğretmen başına not girişi"
          columns={teacherColumns}
          density="compact"
          description="Değerlendirme sayısı, eksik giriş ve yayın bekleyen taslaklar; puanlar gösterilmez."
          emptyText="Sınıfa atanmış not giren öğretmen yok"
          getRowKey={(row) => row.teacherId}
          rows={teacherRows}
        />
        <DataTable
          caption="Değerlendirme giriş durumu"
          columns={assessmentColumns}
          density="compact"
          description="Sınıfın bu dönemki tüm değerlendirmeleri; girilen öğrenci sayısı sınıf mevcuduyla karşılaştırılır, tarihi gelmemiş değerlendirme eksik sayılmaz."
          emptyText="Bu dönem açılmış değerlendirme yok"
          getRowKey={(assessment) => assessment.assessmentId}
          rows={assessments}
        />
      </Panel>
    </>
  );
}

function isClassOverview(value: unknown): value is ClassOverview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ClassOverview>;
  return typeof record.rosterCount === "number"
    && Boolean(record.homework)
    && Boolean(record.gradeEntry)
    && Array.isArray(record.assessments)
    && Array.isArray(record.teacherAssignments);
}

function sortAssessments(assessments: readonly ClassOverviewAssessmentStatus[]): ClassOverviewAssessmentStatus[] {
  return [...assessments].sort((left, right) => right.heldOn.localeCompare(left.heldOn) || left.title.localeCompare(right.title, "tr"));
}

function rollCallLabel(overview: ClassOverview): { description: string; label: string; tone: StatusBadgeProps["tone"] } {
  const rollCall = overview.rollCall;
  if (!rollCall) return { description: "Programda bugün ders yok", label: "Ders yok", tone: "neutral" };
  if (rollCall.state === "EMPTY_ROSTER") return { description: "Sınıf mevcudu boş; işaretlenecek öğrenci yok", label: "Öğrenci yok", tone: "neutral" };
  const marked = `${formatCount(rollCall.markedCount)}/${formatCount(overview.rosterCount)} öğrenci işaretlendi`;
  if (rollCall.state === "TAKEN") return { description: marked, label: "Alındı", tone: "success" };
  if (rollCall.state === "PARTIAL") return { description: marked, label: "Eksik", tone: "warning" };
  return { description: `${formatCount(rollCall.lessonCount)} ders programda`, label: "Alınmadı", tone: "danger" };
}

interface TeacherGradeEntryRow {
  teacherId: string;
  teacherName: string;
  roles: TeacherAssignmentRole[];
  courseLabel: string;
  assessmentCount: number;
  missingEntryAssessmentCount: number;
  unpublishedDraftAssessmentCount: number;
}

function groupTeacherAssignments(assignments: readonly ClassOverviewTeacherAssignment[]): TeacherGradeEntryRow[] {
  const groups = new Map<string, ClassOverviewTeacherAssignment[]>();
  // API sırası (soyad, ad) korunur; öğretmen ilk göründüğü yerde kalır.
  for (const assignment of assignments) {
    const group = groups.get(assignment.teacherId);
    if (group) group.push(assignment);
    else groups.set(assignment.teacherId, [assignment]);
  }
  return [...groups.entries()].map(([teacherId, group]) => {
    const assessments = new Map<string, ClassOverviewAssessmentStatus>();
    for (const assignment of group) {
      for (const assessment of assignment.assessments) assessments.set(assessment.assessmentId, assessment);
    }
    const covered = [...assessments.values()];
    // Sınıf öğretmeni önce gelir; aynı rol bir kez yazılır.
    const roles = [...new Set(group.map((assignment) => assignment.role))]
      .sort((left, right) => (left === "CLASS_TEACHER" ? 0 : 1) - (right === "CLASS_TEACHER" ? 0 : 1));
    return {
      teacherId,
      teacherName: group[0]?.teacherName ?? "",
      roles,
      courseLabel: courseLabel(group),
      assessmentCount: covered.length,
      missingEntryAssessmentCount: covered.filter((assessment) => assessment.missingEntries).length,
      unpublishedDraftAssessmentCount: covered.filter((assessment) => assessment.hasUnpublishedDraft).length,
    };
  });
}

function courseLabel(group: readonly ClassOverviewTeacherAssignment[]): string {
  const coversAllCourses = group.some((assignment) => !assignment.courseId);
  const courseNames = [...new Set(group.flatMap((assignment) => (assignment.courseId ? [assignment.courseName ?? "Ders eşleşmedi"] : [])))]
    .sort((left, right) => left.localeCompare(right, "tr", { sensitivity: "base" }));
  if (coversAllCourses) return courseNames.length > 0 ? `Tüm dersler · branş: ${courseNames.join(", ")}` : "Tüm dersler";
  return courseNames.join(", ");
}

function assignmentStatus(assignment: TeacherGradeEntryRow): { label: string; tone: StatusBadgeProps["tone"] } {
  if (assignment.assessmentCount === 0) return { label: "Kapsamda değerlendirme yok", tone: "warning" };
  if (assignment.missingEntryAssessmentCount > 0) return { label: "Eksik giriş", tone: "warning" };
  if (assignment.unpublishedDraftAssessmentCount > 0) return { label: "Yayın bekliyor", tone: "info" };
  return { label: "Tamam", tone: "success" };
}

function publicationStatus(assessment: ClassOverviewAssessmentStatus): { label: string; tone: StatusBadgeProps["tone"] } {
  if (assessment.hasUnpublishedDraft) {
    return assessment.publishedVersion
      ? { label: `Düzeltme bekliyor · sürüm ${assessment.publishedVersion}`, tone: "info" }
      : { label: "Yayınlanmadı", tone: "warning" };
  }
  return assessment.publishedVersion
    ? { label: `Yayında · sürüm ${assessment.publishedVersion}`, tone: "success" }
    : { label: "Giriş yok", tone: "neutral" };
}

function assignmentRoleLabel(role: TeacherAssignmentRole) {
  return role === "CLASS_TEACHER" ? "Sınıf öğretmeni" : "Branş öğretmeni";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}
