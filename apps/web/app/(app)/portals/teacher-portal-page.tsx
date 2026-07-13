"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DataTable, Field, Input, Panel, SegmentedControl, Select, Textarea, type DataTableColumn } from "@o-okul/ui";
import type {
  AcademicTermRecord,
  AnnouncementRecord,
  AttendanceDailyRosterResponse,
  AttendanceDailyUpsertResponse,
  AttendanceRecord,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  GradeLevelRecord,
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  PortalReportIndexItem,
  ReportErrorBooklet,
  ReportSnapshotRecord,
  ReportStudentProgress,
  ReportStudentSnapshot,
  ScheduleLessonRecord,
  StudentEnrollmentRecord,
  StudentRecord,
  SupportTicketRecord,
  TeacherNoteRecord,
  TeacherPortalLookupsResponse,
  TeacherRecord,
} from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetch, readData } from "../../../src/api-client.js";
import {
  firstFormError,
  materialAssignmentFormSchema,
  teacherNoteFormSchema,
  type MaterialAssignmentFormPayload,
  type SupportTicketFormPayload,
  type TeacherNoteFormPayload,
} from "../../../src/form-validation.js";
import { useAuth } from "../../providers.js";
import { TeacherAttendancePanel, TeacherNotesPanel } from "./_shared/activity-panels.js";
import { AnnouncementsPanel } from "./_shared/announcements-panel.js";
import { TeacherHomeworkPanel, TeacherMaterialAssignmentsPanel } from "./_shared/homework-panels.js";
import {
  AccessPanel,
  MetricGrid,
  PortalActionStrip,
  PortalDailyBrief,
  PortalFrame,
  PortalStatePanel,
  RolePreviewNotice,
  type PortalActionItem,
  readRolePreviewToken,
} from "./_shared/portal-shell.js";
import { ReportPanel } from "./_shared/report-panel.js";
import { StudentHistoryPanel } from "./_shared/student-panels.js";
import { SupportTicketsPanel } from "./_shared/support-tickets-panel.js";
import {
  TeacherClassReportsPanel,
  TeacherFocusPanel,
  TeacherProfileSummaryPanel,
  TeacherTodaySchedulePanel,
} from "./_shared/teacher-panels.js";
import { readReportExamId } from "../_shared/report-exam-selection.js";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../_shared/report-metrics.js";

interface TeacherPortalData {
  teacher: TeacherRecord;
  announcements: AnnouncementRecord[];
  schedule: ScheduleLessonRecord[];
  students: StudentRecord[];
  attendance: AttendanceRecord[];
  homework: HomeworkRecord[];
  materials: HomeworkMaterialRecord[];
  materialAssignments: HomeworkMaterialAssignmentRecord[];
  campuses: CampusRecord[];
  classes: ClassRecord[];
  courses: CourseRecord[];
  gradeLevels: GradeLevelRecord[];
  terms: AcademicTermRecord[];
  classReports: TeacherClassReportSummary[];
  supportTickets: SupportTicketRecord[];
  teacherNotes: TeacherNoteRecord[];
  reportIndex: PortalReportIndexItem[];
  reportSnapshots: ReportSnapshotRecord[];
  selectedReportExamId: string;
}

interface TeacherStudentReportData {
  errorBooklet: ReportErrorBooklet | null;
  progress: ReportStudentProgress | null;
  report: ReportStudentSnapshot | null;
  reportContext?: ReportContext;
}

interface TeacherStudentHistoryData {
  enrollments: StudentEnrollmentRecord[];
}

interface TeacherClassReportSummary {
  snapshotId: string;
  generatedAt?: string;
  classId: string | null;
  className: string | null;
  courseId?: string;
  resultCount: number;
  termId?: string;
  averages: {
    correct?: number;
    wrong?: number;
    blank?: number;
    net?: number;
    estimatedRawScore?: number;
    standardScore?: number;
  };
}

interface ReportContext {
  courseId?: string;
  termId?: string;
}

interface TeacherAttendanceForm {
  classId: string;
  date: string;
  status: AttendanceRecord["status"];
  studentId: string;
}

export type TeacherPortalView = "announcements" | "homework" | "overview" | "reports" | "schedule" | "student" | "support";

export function TeacherPortalPage({ view = "overview" }: { view?: TeacherPortalView } = {}) {
  const { auth } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const rolePreviewToken = readRolePreviewToken(searchParams);
  const reportExamId = readReportExamId(searchParams);
  const requestedStudentId = readRequestedStudentId(searchParams);
  const isRolePreview = Boolean(rolePreviewToken);
  const canReadPortal = Boolean(auth && (auth.session.subjectType === "TEACHER" || isRolePreview));
  const queryKey = ["next-teacher-portal", auth?.session.userId ?? "anonymous", rolePreviewToken || "session", view, reportExamId];
  const query = useQuery({
    queryKey,
    queryFn: () => loadTeacherPortal(auth?.accessToken ?? "", rolePreviewToken, reportExamId, view),
    enabled: canReadPortal,
    refetchOnWindowFocus: false,
  });
  const today = todayInputValue();
  const [attendanceForm, setAttendanceForm] = useState<TeacherAttendanceForm>({
    classId: "",
    studentId: "",
    date: today,
    status: "PRESENT",
  });
  const [noteForm, setNoteForm] = useState<TeacherNoteFormPayload>({
    studentId: "",
    teacherId: "",
    courseId: "",
    termId: "",
    visibility: "GUARDIAN_STUDENT",
    body: "",
    developmentStatus: "",
  });
  const [materialForm, setMaterialForm] = useState<MaterialAssignmentFormPayload>({
    materialId: "",
    studentId: "",
    courseId: "",
    termId: "",
    note: "",
    dueAt: "",
  });
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!query.isSuccess) return;
    const firstStudentId = query.data.students[0]?.id ?? "";
    const firstMaterialId = query.data.materials[0]?.id ?? "";
    const firstCourseId = query.data.schedule.find((lesson) => lesson.courseId)?.courseId ?? "";
    const firstTermId = query.data.schedule.find((lesson) => lesson.termId)?.termId ?? "";
    const firstClassId = query.data.schedule.find((lesson) => lesson.classId)?.classId ?? query.data.classes[0]?.id ?? "";
    const visibleStudentIds = new Set(query.data.students.map((student) => student.id));
    const visibleCourseIds = new Set(query.data.schedule.map((lesson) => lesson.courseId).filter((courseId): courseId is string => Boolean(courseId)));
    const visibleTermIds = new Set(query.data.schedule.map((lesson) => lesson.termId).filter((termId): termId is string => Boolean(termId)));
    setAttendanceForm((current) => ({
      ...current,
      classId: current.classId || firstClassId,
      studentId: resolveRequestedStudentId(requestedStudentId, current.studentId, firstStudentId, visibleStudentIds),
    }));
    setNoteForm((current) => ({
      ...current,
      studentId: resolveRequestedStudentId(requestedStudentId, current.studentId, firstStudentId, visibleStudentIds),
      courseId: current.courseId && visibleCourseIds.has(current.courseId) ? current.courseId : firstCourseId,
      termId: current.termId && visibleTermIds.has(current.termId) ? current.termId : firstTermId,
    }));
    setMaterialForm((current) => ({
      ...current,
      materialId: current.materialId || firstMaterialId,
      studentId: resolveRequestedStudentId(requestedStudentId, current.studentId, firstStudentId, visibleStudentIds),
      courseId: current.courseId && visibleCourseIds.has(current.courseId) ? current.courseId : firstCourseId,
      termId: current.termId && visibleTermIds.has(current.termId) ? current.termId : firstTermId,
    }));
  }, [query.data, query.isSuccess, requestedStudentId]);

  const data = query.data;
  const students = data?.students ?? [];
  const teacherDailyAttendanceQuery = useQuery({
    queryKey: ["next-teacher-daily-attendance", auth?.session.userId ?? "anonymous", attendanceForm.classId, attendanceForm.date],
    queryFn: () => loadTeacherDailyAttendance(auth?.accessToken ?? "", attendanceForm.classId, attendanceForm.date),
    enabled: Boolean(canReadPortal && !isRolePreview && attendanceForm.classId && attendanceForm.date && (view === "overview" || view === "student")),
    refetchOnWindowFocus: false,
  });
  const attendanceRoster = teacherDailyAttendanceQuery.data?.students ?? [];
  const scheduleClassIds = useMemo(
    () => new Set((data?.schedule ?? []).map((lesson) => lesson.classId).filter((classId): classId is string => Boolean(classId))),
    [data?.schedule],
  );
  const attendanceClassOptions = (data?.classes ?? []).filter((record) => scheduleClassIds.has(record.id));
  const scheduleCourseIds = useMemo(
    () => new Set((data?.schedule ?? []).map((lesson) => lesson.courseId).filter((courseId): courseId is string => Boolean(courseId))),
    [data?.schedule],
  );
  const scheduleTermIds = useMemo(
    () => new Set((data?.schedule ?? []).map((lesson) => lesson.termId).filter((termId): termId is string => Boolean(termId))),
    [data?.schedule],
  );
  const courseOptions = (data?.courses ?? []).filter((course) => scheduleCourseIds.has(course.id));
  const termOptions = (data?.terms ?? []).filter((term) => scheduleTermIds.has(term.id));
  const campusNameById = useMemo(() => new Map((data?.campuses ?? []).map((campus) => [campus.id, campus.name])), [data?.campuses]);
  const classById = useMemo(() => new Map((data?.classes ?? []).map((schoolClass) => [schoolClass.id, schoolClass])), [data?.classes]);
  const classNameById = useMemo(() => new Map((data?.classes ?? []).map((schoolClass) => [schoolClass.id, schoolClass.name])), [data?.classes]);
  const courseNameById = useMemo(() => new Map((data?.courses ?? []).map((course) => [course.id, course.name])), [data?.courses]);
  const gradeLevelNameById = useMemo(() => new Map((data?.gradeLevels ?? []).map((gradeLevel) => [gradeLevel.id, gradeLevel.name])), [data?.gradeLevels]);
  const termNameById = useMemo(() => new Map((data?.terms ?? []).map((term) => [term.id, term.name])), [data?.terms]);
  const selectedStudentId = noteForm.studentId || materialForm.studentId || attendanceForm.studentId || students[0]?.id;
  const selectedStudent = students.find((student) => student.id === selectedStudentId);
  const selectedClass = selectedStudent?.classId ? classById.get(selectedStudent.classId) : undefined;
  const todayLessons = useMemo(() => selectTodayLessons(data?.schedule ?? []), [data?.schedule]);
  const nextLesson = useMemo(() => selectNextLesson(data?.schedule ?? []), [data?.schedule]);
  const reportQuery = useQuery({
    queryKey: ["next-teacher-student-report", auth?.session.userId ?? "anonymous", selectedStudentId ?? "none", rolePreviewToken || "session", data?.selectedReportExamId ?? "none"],
    queryFn: () => loadTeacherStudentReport(
      auth?.accessToken ?? "",
      selectedStudentId ?? "",
      rolePreviewToken,
      data?.selectedReportExamId ?? "",
      data?.reportSnapshots ?? [],
    ),
    enabled: Boolean(canReadPortal && selectedStudentId && data?.selectedReportExamId && (view === "overview" || view === "reports")),
    refetchOnWindowFocus: false,
  });
  const selectedReportTotal = reportQuery.data?.report?.total;
  const selectedReportSuccess = reportSuccessRate(selectedReportTotal);
  const selectedCourseId = noteForm.courseId || materialForm.courseId || reportQuery.data?.reportContext?.courseId;
  const selectedTermId = noteForm.termId || materialForm.termId || reportQuery.data?.reportContext?.termId;
  const selectedCourseName = selectedCourseId ? courseNameById.get(selectedCourseId) ?? selectedCourseId : undefined;
  const selectedTermName = selectedTermId ? termNameById.get(selectedTermId) ?? selectedTermId : undefined;
  const uncheckedHomework = (data?.homework ?? []).filter((homework) => !homework.checkedAt).length;
  const openSupportTickets = (data?.supportTickets ?? []).filter(isOpenSupportTicket).length;
  const selectedStudentLabel = selectedStudent ? formatTeacherStudentLabel(selectedStudent, classNameById) : "Seçili öğrenci yok";
  const selectedMaterial = (data?.materials ?? []).find((material) => material.id === materialForm.materialId);
  const historyQuery = useQuery({
    queryKey: ["next-teacher-student-history", auth?.session.userId ?? "anonymous", selectedStudentId ?? "none", rolePreviewToken || "session"],
    queryFn: () => loadTeacherStudentHistory(auth?.accessToken ?? "", selectedStudentId ?? "", rolePreviewToken),
    enabled: Boolean(canReadPortal && selectedStudentId && (view === "overview" || view === "student")),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!teacherDailyAttendanceQuery.data) return;
    setAttendanceForm((current) => {
      const studentId = teacherDailyAttendanceQuery.data.students.some((student) => student.id === current.studentId)
        ? current.studentId
        : teacherDailyAttendanceQuery.data.students[0]?.id ?? "";
      const existingRecord = teacherDailyAttendanceQuery.data.records.find((record) => record.studentId === studentId);
      return { ...current, studentId, status: existingRecord?.status ?? "PRESENT" };
    });
  }, [teacherDailyAttendanceQuery.data]);

  if (!canReadPortal) {
    return <AccessPanel title="Öğretmen Portalı" />;
  }

  if (query.isPending) {
    return (
      <PortalFrame title="Öğretmen Portalı" subtitle="Ders programı">
        <PortalStatePanel
          state="loading"
          title="Öğretmen portal verileri hazırlanıyor"
          description="Ders programı, öğrenci kapsamı, yoklama ve rapor bağlamı güvenli oturumdan yükleniyor."
        />
      </PortalFrame>
    );
  }

  if (query.isError) {
    return (
      <PortalFrame title="Öğretmen Portalı" subtitle="Ders programı">
        <PortalStatePanel
          state="error"
          title="Öğretmen portal verisi alınamadı"
          description="Portal verileri gösterilemiyor. Öğrenci, yoklama ve rapor ayrıntıları hata durumunda açılmaz."
        />
      </PortalFrame>
    );
  }

  function selectReportExam(examId: string) {
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    if (examId) nextSearchParams.set("examId", examId);
    else nextSearchParams.delete("examId");
    router.replace(`?${nextSearchParams.toString()}`);
  }

  function selectStudent(studentId: string) {
    setAttendanceForm((current) => ({ ...current, studentId }));
    setNoteForm((current) => ({ ...current, studentId }));
    setMaterialForm((current) => ({ ...current, studentId }));
  }

  async function submitAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    if (isRolePreview) {
      setActionError("Rol önizleme salt-okuma modundadır.");
      return;
    }

    setActionError("");
    const student = attendanceRoster.find((candidate) => candidate.id === attendanceForm.studentId);
    if (!student || !attendanceForm.classId || !attendanceForm.date) {
      setActionError("Sınıfı bulunan bir öğrenci ve tarih seçilmelidir.");
      return;
    }

    try {
      const response = await saveDailyAttendance(auth.accessToken, {
        classId: attendanceForm.classId,
        date: attendanceForm.date,
        entries: [{ studentId: student.id, status: attendanceForm.status }],
      });
      queryClient.setQueryData<TeacherPortalData>(queryKey, (current) =>
        current
          ? {
              ...current,
              attendance: [
                ...response.records,
                ...current.attendance.filter(
                  (record) => !response.records.some((saved) => saved.id === record.id),
                ),
              ],
            }
          : current,
      );
    } catch {
      setActionError("Yoklama kaydı eklenemedi.");
    }
  }

  async function submitTeacherNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    if (isRolePreview) {
      setActionError("Rol önizleme salt-okuma modundadır.");
      return;
    }

    setActionError("");
    const parsedForm = teacherNoteFormSchema.safeParse(noteForm);
    if (!parsedForm.success) {
      setActionError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const note = await createTeacherNote(auth.accessToken, parsedForm.data);
      queryClient.setQueryData<TeacherPortalData>(queryKey, (current) =>
        current ? { ...current, teacherNotes: [note, ...current.teacherNotes] } : current,
      );
      setNoteForm((current) => ({ ...current, body: "", developmentStatus: "" }));
    } catch {
      setActionError("Öğretmen notu eklenemedi.");
    }
  }

  async function toggleHomeworkCheck(homework: HomeworkRecord) {
    if (!auth) return;
    if (isRolePreview) {
      setActionError("Rol önizleme salt-okuma modundadır.");
      return;
    }

    setActionError("");
    try {
      const record = await updateHomeworkCheckStatus(auth.accessToken, homework.id, !homework.checkedAt);
      queryClient.setQueryData<TeacherPortalData>(queryKey, (current) =>
        current
          ? {
              ...current,
              homework: current.homework.map((candidate) => (candidate.id === record.id ? record : candidate)),
            }
          : current,
      );
    } catch {
      setActionError("Ödev kontrol durumu kaydedilemedi.");
    }
  }

  async function submitMaterialAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    if (isRolePreview) {
      setActionError("Rol önizleme salt-okuma modundadır.");
      return;
    }

    setActionError("");
    const parsedForm = materialAssignmentFormSchema.safeParse(materialForm);
    if (!parsedForm.success) {
      setActionError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const assignment = await createMaterialAssignment(auth.accessToken, parsedForm.data);
      queryClient.setQueryData<TeacherPortalData>(queryKey, (current) =>
        current
          ? {
              ...current,
              materialAssignments: [assignment, ...current.materialAssignments],
            }
          : current,
      );
      setMaterialForm((current) => ({ ...current, note: "", dueAt: "" }));
    } catch {
      setActionError("Materyal ataması kaydedilemedi.");
    }
  }

  const scheduleColumns: Array<DataTableColumn<ScheduleLessonRecord>> = [
    {
      header: "Ders",
      key: "lesson",
      priority: "primary",
      render: (lesson) => lesson.title,
      sticky: "left",
    },
    {
      header: "Sınıf",
      key: "class",
      priority: "primary",
      render: (lesson) => (lesson.classId ? classNameById.get(lesson.classId) ?? lesson.classId : "-"),
    },
    {
      header: "Branş",
      key: "course",
      priority: "secondary",
      render: (lesson) => (lesson.courseId ? courseNameById.get(lesson.courseId) ?? lesson.courseId : "-"),
    },
    {
      header: "Dönem",
      key: "term",
      priority: "optional",
      render: (lesson) => (lesson.termId ? termNameById.get(lesson.termId) ?? lesson.termId : "-"),
    },
    {
      header: "Başlangıç",
      key: "startsAt",
      priority: "primary",
      render: (lesson) => formatDateTime(lesson.startsAt),
    },
    {
      header: "Bitiş",
      key: "endsAt",
      priority: "optional",
      render: (lesson) => formatDateTime(lesson.endsAt),
    },
  ];
  const teacherActionItems: PortalActionItem[] = [
    {
      actionLabel: "Seç",
      contextLabel: "Öğrenci",
      detail: selectedCourseName && selectedTermName ? `${selectedCourseName} / ${selectedTermName}` : "Öğrenci çalışma bağlamı",
      href: teacherPortalHref("/ogretmen/ogrenci-takibi", isRolePreview),
      key: "student",
      label: "Öğrenci seç",
      statusLabel: selectedStudent ? "Seçili" : "Bekliyor",
      tone: selectedStudent ? "info" : "neutral",
      value: selectedStudentLabel,
    },
    {
      actionLabel: isRolePreview ? "Salt-okuma" : "Kaydet",
      contextLabel: "Yoklama",
      detail: isRolePreview ? "Yoklama formu kapalı" : `${attendanceForm.date} için yoklama`,
      href: teacherPortalHref(isRolePreview ? "/ogretmen" : "/ogretmen/ogrenci-takibi", isRolePreview),
      key: "attendance",
      label: "Yoklama kaydet",
      statusLabel: isRolePreview ? "Salt-okuma" : "Bugün",
      tone: isRolePreview ? "neutral" : "info",
      value: isRolePreview ? "Salt-okuma" : `${data?.attendance.length ?? 0} kayıt`,
    },
    {
      actionLabel: isRolePreview ? "Salt-okuma" : "Ekle",
      contextLabel: "Not",
      detail: isRolePreview ? "Not formu kapalı" : selectedStudentLabel,
      href: teacherPortalHref(isRolePreview ? "/ogretmen" : "/ogretmen/ogrenci-takibi", isRolePreview),
      key: "note",
      label: "Not ekle",
      statusLabel: isRolePreview ? "Salt-okuma" : "Günlük takip",
      tone: isRolePreview ? "neutral" : "info",
      value: isRolePreview ? "Salt-okuma" : `${data?.teacherNotes.length ?? 0} not`,
    },
    {
      actionLabel: isRolePreview ? "Salt-okuma" : "Ata",
      contextLabel: "Materyal",
      detail: isRolePreview ? "Materyal atama kapalı" : selectedMaterial?.title ?? "Materyal seçimi",
      href: teacherPortalHref(isRolePreview ? "/ogretmen" : "/ogretmen/ogrenci-takibi", isRolePreview),
      key: "material",
      label: "Materyal ata",
      statusLabel: isRolePreview ? "Salt-okuma" : "Atama",
      tone: isRolePreview ? "neutral" : "info",
      value: isRolePreview ? "Salt-okuma" : `${data?.materials.length ?? 0} materyal`,
    },
    {
      actionLabel: uncheckedHomework > 0 ? "Kontrol" : "Tamam",
      contextLabel: "Ödev",
      detail: "Kontrol edilmeyen ödevler",
      href: teacherPortalHref("/ogretmen/odevler", isRolePreview),
      key: "homework",
      label: "Ödev kontrol et",
      statusLabel: uncheckedHomework > 0 ? "Bekliyor" : "Tamam",
      tone: uncheckedHomework > 0 ? "warning" : "success",
      value: uncheckedHomework > 0 ? `${uncheckedHomework} bekliyor` : "Tamam",
    },
    {
      actionLabel: "İncele",
      contextLabel: "Rapor",
      detail: `${formatNetNumber(selectedReportTotal?.net)} net / ${formatNetNumber(reportQuestionCount(selectedReportTotal))} soru`,
      href: teacherPortalHref("/ogretmen/raporlar", isRolePreview),
      key: "report",
      label: "Raporu incele",
      statusLabel: "Başarı %",
      tone: (selectedReportSuccess ?? 0) >= 75 ? "success" : "info",
      value: formatPercentNumber(selectedReportSuccess),
    },
    {
      actionLabel: openSupportTickets > 0 ? "Takip" : "Hazır",
      contextLabel: "Destek",
      detail: "Öğretmen destek takibi",
      href: teacherPortalHref("/ogretmen/destek", isRolePreview),
      key: "support",
      label: "Destek talebini takip et",
      statusLabel: openSupportTickets > 0 ? "Açık" : "Hazır",
      tone: openSupportTickets > 0 ? "warning" : "success",
      value: openSupportTickets > 0 ? `${openSupportTickets} açık` : "Açık talep yok",
    },
    {
      actionLabel: isRolePreview ? "Salt-okuma" : "Canlı",
      contextLabel: "Erişim",
      detail: isRolePreview ? "Yoklama, not ve materyal kapalı" : "Yoklama, not ve materyal açık",
      href: teacherPortalHref(isRolePreview ? "/ogretmen" : "/ogretmen/ogrenci-takibi", isRolePreview),
      key: "preview",
      label: "Önizleme durumu",
      statusLabel: isRolePreview ? "Salt-okuma" : "Canlı",
      tone: isRolePreview ? "neutral" : "info",
      value: isRolePreview ? "Salt-okuma" : "İşlem açık",
    },
  ];
  const showOverview = view === "overview";
  const showStudentWorkspace = view === "overview" || view === "student" || view === "homework" || view === "reports" || view === "support";
  const showStudentTracking = view === "overview" || view === "student";
  const portalSubtitle = teacherPortalSubtitle(view, data?.teacher ? `${data.teacher.firstName} ${data.teacher.lastName}` : "Ders programı");

  return (
    <PortalFrame
      title="Öğretmen Portalı"
      subtitle={portalSubtitle}
      context={teacherPortalContext(view, portalSubtitle, selectedStudentLabel, isRolePreview)}
    >
      {showOverview ? (
        <>
          <PortalDailyBrief
            title="Günlük ders akışı"
            summary="Ders akışı, seçili öğrenci ve sınıf içi takip işleri aynı yüzeyde kalır; öğretmen portali günün operasyonlarını öne alır."
            scope={{
              detail: selectedCourseName && selectedTermName ? `${selectedCourseName} / ${selectedTermName}` : "Ders bağlamı bekliyor",
              label: "Seçili öğrenci",
              value: selectedStudentLabel,
            }}
            items={[
              {
                label: "Sıradaki ders",
                value: nextLesson ? nextLesson.title : "Planlı ders yok",
                detail: nextLesson ? formatDateTime(nextLesson.startsAt) : `${todayLessons.length} bugünkü ders`,
                tone: nextLesson ? "info" : "neutral",
              },
              {
                label: "Öğrenci kapsamı",
                value: `${students.length} öğrenci`,
                detail: selectedStudent ? formatTeacherStudentLabel(selectedStudent, classNameById) : "Seçili öğrenci yok",
                tone: students.length > 0 ? "info" : "neutral",
              },
              {
                label: "Ödev kontrolü",
                value: uncheckedHomework > 0 ? `${uncheckedHomework} bekliyor` : "Tamam",
                detail: "Kontrol edilmeyen ödevler",
                tone: uncheckedHomework > 0 ? "warning" : "success",
              },
              {
                label: "Destek",
                value: openSupportTickets > 0 ? `${openSupportTickets} açık` : "Açık talep yok",
                detail: "Öğretmen destek takibi",
                tone: openSupportTickets > 0 ? "warning" : "success",
              },
              {
                label: "Seçili başarı",
                value: formatPercentNumber(selectedReportSuccess),
                detail: `${formatNetNumber(selectedReportTotal?.net)} net / ${formatNetNumber(reportQuestionCount(selectedReportTotal))} soru`,
                tone: (selectedReportSuccess ?? 0) >= 75 ? "success" : "info",
              },
              {
                label: "Önizleme",
                value: isRolePreview ? "Salt-okuma" : "İşlem açık",
                detail: isRolePreview ? "Yoklama, not ve materyal kapalı" : "Yoklama, not ve materyal formları aktif",
                tone: isRolePreview ? "neutral" : "info",
              },
            ]}
          />
          <PortalActionStrip ariaLabel="Öğretmen günlük aksiyonları" items={teacherActionItems} />
          <MetricGrid
            items={[
              { label: "Ders", value: data?.schedule.length ?? 0 },
              { label: "Öğrenci", value: students.length },
              { label: "Yoklama", value: data?.attendance.length ?? 0 },
              { label: "Ödev", value: data?.homework.length ?? 0 },
              { label: "Başarı", value: formatPercentNumber(reportSuccessRate(selectedReportTotal)) },
              { label: "Net", value: formatNetNumber(selectedReportTotal?.net) },
              { label: "Soru", value: formatNetNumber(reportQuestionCount(selectedReportTotal)) },
              { label: "Destek", value: data?.supportTickets.length ?? 0 },
            ]}
          />
        </>
      ) : null}
      {isRolePreview ? (
        <div id="portal-teacher-preview">
          <RolePreviewNotice />
        </div>
      ) : null}
      {view === "overview" ? <div id="portal-teacher-profile">
        <TeacherProfileSummaryPanel
          campusNames={campusNameById}
          classes={classById}
          classNames={classNameById}
          courseNames={courseNameById}
          gradeLevelNames={gradeLevelNameById}
          schedule={data?.schedule ?? []}
          students={students}
          teacher={data?.teacher}
          termNames={termNameById}
        />
      </div> : null}
      {view === "overview" || view === "schedule" ? <div id="portal-teacher-today-schedule">
        <TeacherTodaySchedulePanel
          classNames={classNameById}
          courseNames={courseNameById}
          lessons={todayLessons}
          nextLesson={nextLesson}
          termNames={termNameById}
        />
      </div> : null}
      {view === "overview" || view === "announcements" ? <div id="portal-teacher-announcements">
        <AnnouncementsPanel
          announcements={data?.announcements ?? []}
          readOnly={isRolePreview}
          onMarkRead={(announcement) =>
            auth && !isRolePreview
              ? markAnnouncementRead(auth.accessToken, `me/teacher/announcements/${encodeURIComponent(announcement.id)}/read`).then(() =>
                  query.refetch(),
                )
              : undefined
          }
        />
      </div> : null}
      {showStudentWorkspace ? <section className="next-teacher-workspace" aria-label="Öğrenci çalışma alanı" id="portal-teacher-workspace">
        {showStudentTracking ? <header className="next-teacher-workspace__header">
          <div>
            <p className="next-section-eyebrow">Öğrenci çalışma alanı</p>
            <h2>Öğrenci Takibi</h2>
          </div>
          <p>{selectedStudent ? formatTeacherStudentLabel(selectedStudent, classNameById) : "Seçili öğrenci yok"}</p>
        </header> : null}
        {showStudentTracking ? <Panel
          aria-label="Öğretmen öğrenci kapsamı"
          description="Öğretmenin işlem yapabildiği öğrenci kapsamı."
          id="portal-teacher-student-picker"
          title="Öğrenciler"
        >
          <SegmentedControl className="next-segmented" label="Öğrenci seçimi">
            {students.map((student) => (
              <button
                aria-pressed={student.id === selectedStudentId}
                key={student.id}
                onClick={() => selectStudent(student.id)}
                type="button"
              >
                {formatTeacherStudentLabel(student, classNameById)}
              </button>
            ))}
          </SegmentedControl>
        </Panel> : null}
        {showStudentTracking ? <div id="portal-teacher-focus">
          <TeacherFocusPanel
            campusNames={campusNameById}
            courseName={selectedCourseName}
            gradeLevelNames={gradeLevelNameById}
            mode={isRolePreview ? "read-only" : "write"}
            net={selectedReportTotal?.net}
            openSupportTicketCount={openSupportTickets}
            questionCount={reportQuestionCount(selectedReportTotal)}
            selectedClass={selectedClass}
            selectedStudent={selectedStudent}
            successRate={selectedReportSuccess}
            termName={selectedTermName}
          />
        </div> : null}
        {showStudentTracking && !isRolePreview ? (
          <section className="next-teacher-action-grid" aria-label="Öğretmen günlük işlemleri" id="portal-teacher-actions">
            <Panel
              as="form"
              aria-label="Yoklama kaydet"
              className="next-teacher-action-panel"
              description="Seçili öğrencinin sınıfı ve tarih için günlük yoklama kaydı."
              id="portal-teacher-attendance"
              title="Yoklama"
              onSubmit={(event) => void submitAttendance(event)}
            >
              <Field label="Yoklama sınıfı">
                <Select
                  required
                  value={attendanceForm.classId}
                  onChange={(event) => setAttendanceForm((current) => ({ ...current, classId: event.target.value, studentId: "" }))}
                >
                  <option value="">Sınıf seçiniz</option>
                  {attendanceClassOptions.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
                </Select>
              </Field>
              <Field label="Öğrenci">
                <Select
                  value={attendanceForm.studentId}
                  onChange={(event) => {
                    const studentId = event.target.value;
                    const existingRecord = teacherDailyAttendanceQuery.data?.records.find((record) => record.studentId === studentId);
                    setAttendanceForm((current) => ({ ...current, studentId, status: existingRecord?.status ?? "PRESENT" }));
                  }}
                  required
                >
                  {attendanceRoster.length === 0 ? <option value="">Seçili tarihte öğrenci yok</option> : null}
                  {attendanceRoster.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.firstName} {student.lastName}{student.studentNo ? ` / ${student.studentNo}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tarih">
                <Input
                  type="date"
                  required
                  value={attendanceForm.date}
                  onChange={(event) => setAttendanceForm((current) => ({ ...current, date: event.target.value }))}
                />
              </Field>
              <Field label="Durum">
                <Select
                  aria-label="Yoklama durumu"
                  value={attendanceForm.status}
                  onChange={(event) =>
                    setAttendanceForm((current) => ({
                      ...current,
                      status: event.target.value as AttendanceRecord["status"],
                    }))
                  }
                >
                  <option value="PRESENT">Var</option>
                  <option value="ABSENT">Yok</option>
                  <option value="LATE">Geç</option>
                  <option value="EXCUSED">İzinli</option>
                </Select>
              </Field>
              {teacherDailyAttendanceQuery.isError ? <p className="next-form-error" role="alert">Tarihsel sınıf listesi alınamadı.</p> : null}
              <Button disabled={!attendanceForm.studentId} type="submit">Yoklama kaydet</Button>
            </Panel>
            <Panel
              as="form"
              aria-label="Not ekle"
              className="next-teacher-action-panel"
              description="Gelişim notunu branş, dönem ve görünürlük kapsamıyla kaydet."
              id="portal-teacher-note"
              title="Öğretmen Notu"
              onSubmit={(event) => void submitTeacherNote(event)}
            >
              <Field label="Öğrenci">
                <Select value={noteForm.studentId} onChange={(event) => selectStudent(event.target.value)} required>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {formatTeacherStudentLabel(student, classNameById)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Not branşı">
                <Select
                  value={noteForm.courseId ?? ""}
                  onChange={(event) => setNoteForm((current) => ({ ...current, courseId: event.target.value }))}
                >
                  <option value="">Branş seçilmedi</option>
                  {courseOptions.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Not dönemi">
                <Select
                  value={noteForm.termId ?? ""}
                  onChange={(event) => setNoteForm((current) => ({ ...current, termId: event.target.value }))}
                >
                  <option value="">Dönem seçilmedi</option>
                  {termOptions.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Görünürlük">
                <Select
                  value={noteForm.visibility}
                  onChange={(event) =>
                    setNoteForm((current) => ({
                      ...current,
                      visibility: event.target.value as TeacherNoteRecord["visibility"],
                    }))
                  }
                >
                  <option value="GUARDIAN_STUDENT">Veli ve öğrenci</option>
                  <option value="INTERNAL">İç not</option>
                </Select>
              </Field>
              <Field label="Gelişim durumu">
                <Input
                  value={noteForm.developmentStatus ?? ""}
                  onChange={(event) => setNoteForm((current) => ({ ...current, developmentStatus: event.target.value }))}
                />
              </Field>
              <Field label="Not" description="Veli/öğrenci görünürlüğüne göre paylaşılacak gelişim notu.">
                <Textarea
                  required
                  rows={4}
                  value={noteForm.body}
                  onChange={(event) => setNoteForm((current) => ({ ...current, body: event.target.value }))}
                />
              </Field>
              <Button disabled={!noteForm.studentId} type="submit">Not ekle</Button>
            </Panel>
            <Panel
              as="form"
              aria-label="Materyal ata"
              className="next-teacher-action-panel"
              description="Seçili öğrenciye materyal, teslim tarihi, branş ve dönem bağlamı ata."
              id="portal-teacher-material"
              title="Materyal Atama"
              onSubmit={(event) => void submitMaterialAssignment(event)}
            >
              <Field label="Öğrenci">
                <Select
                  value={materialForm.studentId}
                  onChange={(event) => selectStudent(event.target.value)}
                  required
                >
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {formatTeacherStudentLabel(student, classNameById)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Materyal">
                <Select
                  value={materialForm.materialId}
                  onChange={(event) => setMaterialForm((current) => ({ ...current, materialId: event.target.value }))}
                  required
                >
                  {(data?.materials ?? []).map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Teslim">
                <Input
                  type="date"
                  value={materialForm.dueAt ?? ""}
                  onChange={(event) => setMaterialForm((current) => ({ ...current, dueAt: event.target.value }))}
                />
              </Field>
              <Field label="Materyal branşı">
                <Select
                  value={materialForm.courseId ?? ""}
                  onChange={(event) => setMaterialForm((current) => ({ ...current, courseId: event.target.value }))}
                >
                  <option value="">Branş seçilmedi</option>
                  {courseOptions.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Materyal dönemi">
                <Select
                  value={materialForm.termId ?? ""}
                  onChange={(event) => setMaterialForm((current) => ({ ...current, termId: event.target.value }))}
                >
                  <option value="">Dönem seçilmedi</option>
                  {termOptions.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Atama notu" description="Öğrenciye iletilecek çalışma yönergesi veya kısa takip notu.">
                <Textarea
                  rows={3}
                  value={materialForm.note ?? ""}
                  onChange={(event) => setMaterialForm((current) => ({ ...current, note: event.target.value }))}
                />
              </Field>
              <Button disabled={!materialForm.studentId || !materialForm.materialId} type="submit">Materyal ata</Button>
            </Panel>
            {actionError ? (
              <Alert tone="danger" title="İşlem kaydedilemedi">
                {actionError}
              </Alert>
            ) : null}
          </section>
        ) : null}
        {view === "overview" || view === "support" ? <div id="portal-teacher-support">
          <SupportTicketsPanel
            readOnly={isRolePreview}
            tickets={data?.supportTickets ?? []}
            onCreate={(input) =>
              auth && !isRolePreview
                ? createPortalSupportTicket(auth.accessToken, "me/teacher/support-tickets", {
                    ...input,
                    studentId: selectedStudent?.id ?? "",
                    campusId: selectedClass?.campusId ?? "",
                    classId: selectedClass?.id ?? "",
                    courseId: noteForm.courseId || materialForm.courseId,
                    gradeLevelId: selectedClass?.gradeLevelId ?? "",
                    termId: noteForm.termId || materialForm.termId,
                  }).then(() => query.refetch())
                : undefined
            }
          />
        </div> : null}
        {view === "overview" || view === "homework" ? <div id="portal-teacher-homework">
          <TeacherHomeworkPanel homework={data?.homework ?? []} onToggle={(homework) => void toggleHomeworkCheck(homework)} readOnly={isRolePreview} />
        </div> : null}
        {view === "overview" || view === "homework" || view === "student" ? <TeacherMaterialAssignmentsPanel
          assignments={(data?.materialAssignments ?? []).filter((assignment) => assignment.studentId === selectedStudentId)}
          courseNames={courseNameById}
          materials={data?.materials ?? []}
          students={students}
          termNames={termNameById}
        /> : null}
        {showStudentTracking ? <StudentHistoryPanel
          enrollments={historyQuery.data?.enrollments ?? []}
          termNames={termNameById}
        /> : null}
        {historyQuery.isError ? <p className="next-form-error">Öğrenci geçmişi alınamadı.</p> : null}
        {view === "overview" || view === "reports" ? <div id="portal-teacher-report">
          {view === "reports" && (data?.reportIndex.length ?? 0) > 0 ? (
            <Field label="Sınav raporu">
              <Select value={data?.selectedReportExamId ?? ""} onChange={(event) => selectReportExam(event.target.value)}>
                {(data?.reportIndex ?? []).map((exam) => <option key={exam.examId} value={exam.examId}>{exam.title}</option>)}
              </Select>
            </Field>
          ) : null}
          <ReportPanel
            context={reportQuery.data?.reportContext}
            courseNames={courseNameById}
            errorBooklet={reportQuery.data?.errorBooklet ?? null}
            progress={reportQuery.data?.progress ?? null}
            report={reportQuery.data?.report ?? null}
            termNames={termNameById}
          />
        </div> : null}
        {reportQuery.isError ? <p className="next-form-error">Öğrenci raporu alınamadı.</p> : null}
      </section> : null}
      {view === "overview" || view === "reports" ? <TeacherClassReportsPanel
        courseNames={courseNameById}
        reports={data?.classReports ?? []}
        termNames={termNameById}
      /> : null}
      {showStudentTracking ? <TeacherAttendancePanel records={data?.attendance ?? []} students={students} courseNames={courseNameById} termNames={termNameById} /> : null}
      {showStudentTracking ? <TeacherNotesPanel notes={data?.teacherNotes ?? []} students={students} courseNames={courseNameById} termNames={termNameById} /> : null}
      {view === "overview" || view === "schedule" ? <Panel
        aria-label="Ders programı"
        description="Öğretmenin portaldan izlediği ders, sınıf, branş ve dönem akışı."
        title="Program"
      >
        <DataTable
          caption="Ders programı"
          columns={scheduleColumns}
          description="Öğretmenin portaldan izlediği ders, sınıf, branş ve dönem akışı."
          density="compact"
          emptyText="Program kaydı yok."
          getRowKey={(lesson) => lesson.id}
          rows={data?.schedule ?? []}
        />
      </Panel> : null}
    </PortalFrame>
  );
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL, rolePreviewToken = ""): Promise<T | null> {
  const response = await authenticatedFetch(accessToken, input, withRolePreview({}, rolePreviewToken));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("API_REQUEST_FAILED");
  return readData<T>(response);
}

async function loadTeacherPortal(
  accessToken: string,
  rolePreviewToken = "",
  requestedReportExamId = "",
  view: TeacherPortalView = "overview",
): Promise<TeacherPortalData> {
  const showOverview = view === "overview";
  const showStudent = showOverview || view === "student";
  const showReports = showOverview || view === "reports";
  const showHomework = showOverview || view === "homework";
  const showSchedule = showOverview || view === "schedule" || showStudent || showHomework;
  const showAnnouncements = showOverview || view === "announcements";
  const showSupport = showOverview || view === "support";
  const showStudentWorkspace = showStudent || showReports || showHomework || showSupport;
  const reportIndex = showReports
    ? await apiRequestOrNull<PortalReportIndexItem[]>(accessToken, `${apiBaseUrl}/me/teacher/reports`, rolePreviewToken) ?? []
    : [];
  const selectedReportExamId = reportIndex.some((record) => record.examId === requestedReportExamId)
    ? requestedReportExamId
    : reportIndex[0]?.examId ?? "";
  const [teacher, announcements, schedule, students, attendance, homework, materials, materialAssignments, teacherNotes, supportTickets, snapshots, lookups] = await Promise.all([
    readOnlyRequest<TeacherRecord>(accessToken, `${apiBaseUrl}/me/teacher`, rolePreviewToken),
    showAnnouncements ? readOnlyRequest<AnnouncementRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/announcements`, rolePreviewToken) : Promise.resolve([]),
    showSchedule ? readOnlyRequest<ScheduleLessonRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/schedule`, rolePreviewToken) : Promise.resolve([]),
    showStudentWorkspace ? readOnlyRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/students`, rolePreviewToken) : Promise.resolve([]),
    showStudent ? readOnlyRequest<AttendanceRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/attendance`, rolePreviewToken) : Promise.resolve([]),
    showHomework ? readOnlyRequest<HomeworkRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/homework`, rolePreviewToken) : Promise.resolve([]),
    showHomework || showStudent ? readOnlyRequest<HomeworkMaterialRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/homework/materials`, rolePreviewToken) : Promise.resolve([]),
    showHomework || showStudent ? readOnlyRequest<HomeworkMaterialAssignmentRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/homework/material-assignments`, rolePreviewToken) : Promise.resolve([]),
    showStudent ? readOnlyRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/teacher-notes`, rolePreviewToken) : Promise.resolve([]),
    showSupport ? readOnlyRequest<SupportTicketRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/support-tickets`, rolePreviewToken) : Promise.resolve([]),
    selectedReportExamId
      ? readOnlyRequest<ReportSnapshotRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/reports/${encodeURIComponent(selectedReportExamId)}/snapshots`, rolePreviewToken)
      : Promise.resolve([]),
    showStudentWorkspace || showSchedule
      ? readOnlyRequest<TeacherPortalLookupsResponse>(accessToken, `${apiBaseUrl}/me/teacher/lookups`, rolePreviewToken)
      : Promise.resolve({ campuses: [], classes: [], courses: [], gradeLevels: [], terms: [] }),
  ]);
  return {
    teacher,
    announcements,
    schedule,
    students,
    attendance,
    homework,
    materials,
    materialAssignments,
    campuses: lookups.campuses,
    classes: lookups.classes,
    courses: lookups.courses,
    gradeLevels: lookups.gradeLevels,
    terms: lookups.terms,
    classReports: selectTeacherClassReports(snapshots, students),
    reportIndex,
    reportSnapshots: snapshots,
    selectedReportExamId,
    supportTickets,
    teacherNotes,
  };
}

async function saveDailyAttendance(
  accessToken: string,
  input: { classId: string; date: string; entries: Array<{ studentId: string; status: AttendanceRecord["status"] }> },
) {
  return apiRequest<AttendanceDailyUpsertResponse>(accessToken, `${apiBaseUrl}/attendance/daily`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

async function loadTeacherDailyAttendance(accessToken: string, classId: string, date: string) {
  const query = new URLSearchParams({ classId, date });
  return apiRequest<AttendanceDailyRosterResponse>(accessToken, `${apiBaseUrl}/attendance/daily?${query.toString()}`);
}

async function createTeacherNote(accessToken: string, input: TeacherNoteFormPayload) {
  return apiRequest<TeacherNoteRecord>(accessToken, `${apiBaseUrl}/teacher-notes`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateHomeworkCheckStatus(accessToken: string, id: string, checked: boolean) {
  return apiRequest<HomeworkRecord>(accessToken, `${apiBaseUrl}/homework/${encodeURIComponent(id)}/check-status`, {
    body: JSON.stringify({ checked }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function createMaterialAssignment(accessToken: string, input: MaterialAssignmentFormPayload) {
  return apiRequest<HomeworkMaterialAssignmentRecord>(
    accessToken,
    `${apiBaseUrl}/homework/materials/${encodeURIComponent(input.materialId)}/assignments`,
    {
      body: JSON.stringify({
        studentId: input.studentId,
        courseId: input.courseId,
        termId: input.termId,
        note: input.note,
        dueAt: input.dueAt,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function markAnnouncementRead(accessToken: string, path: string) {
  return apiRequest<AnnouncementRecord>(accessToken, `${apiBaseUrl}/${path}`, {
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function createPortalSupportTicket(accessToken: string, path: string, input: SupportTicketFormPayload) {
  return apiRequest<SupportTicketRecord>(accessToken, `${apiBaseUrl}/${path}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function loadTeacherStudentReport(
  accessToken: string,
  studentId: string,
  rolePreviewToken = "",
  reportExamId = "",
  snapshots: ReportSnapshotRecord[] = [],
): Promise<TeacherStudentReportData> {
  if (!reportExamId) return { errorBooklet: null, progress: null, report: null };
  const snapshot = selectLatestReadySnapshot(snapshots);
  if (!snapshot) {
    return { errorBooklet: null, progress: null, report: null };
  }

  const [report, errorBooklet, progress] = await Promise.all([
    apiRequestOrNull<ReportStudentSnapshot>(
      accessToken,
      `${apiBaseUrl}/me/teacher/reports/${encodeURIComponent(reportExamId)}/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}`,
      rolePreviewToken,
    ),
    apiRequestOrNull<ReportErrorBooklet>(
      accessToken,
      `${apiBaseUrl}/me/teacher/reports/${encodeURIComponent(reportExamId)}/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}/error-booklet`,
      rolePreviewToken,
    ),
    apiRequestOrNull<ReportStudentProgress>(
      accessToken,
      `${apiBaseUrl}/me/teacher/reports/${encodeURIComponent(reportExamId)}/students/${encodeURIComponent(studentId)}/progress?scope=all`,
      rolePreviewToken,
    ),
  ]);

  return {
    errorBooklet,
    progress,
    report,
    reportContext: {
      courseId: snapshot.courseId,
      termId: snapshot.termId,
    },
  };
}

async function loadTeacherStudentHistory(accessToken: string, studentId: string, rolePreviewToken = ""): Promise<TeacherStudentHistoryData> {
  const enrollments = await apiRequestOrNull<StudentEnrollmentRecord[]>(
    accessToken,
    `${apiBaseUrl}/me/teacher/students/${encodeURIComponent(studentId)}/enrollments`,
    rolePreviewToken,
  );
  return {
    enrollments: enrollments ?? [],
  };
}

function readOnlyRequest<T>(accessToken: string, input: RequestInfo | URL, rolePreviewToken = ""): Promise<T> {
  return apiRequest<T>(accessToken, input, withRolePreview({}, rolePreviewToken));
}

function withRolePreview(init: RequestInit, rolePreviewToken: string): RequestInit {
  if (!rolePreviewToken) return init;
  return {
    ...init,
    headers: {
      ...toHeaderRecord(init.headers),
      "x-role-preview-token": rolePreviewToken,
    },
  };
}

function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}

function selectTeacherClassReports(
  snapshots: ReportSnapshotRecord[],
  students: StudentRecord[],
): TeacherClassReportSummary[] {
  const classIds = new Set(students.map((student) => student.classId).filter((classId): classId is string => Boolean(classId)));
  const snapshot = selectLatestReadySnapshot(snapshots);
  if (!snapshot) {
    return [];
  }

  return (snapshot.snapshotData?.classes ?? [])
    .filter((classSummary) => Boolean(classSummary.classId && classIds.has(classSummary.classId)))
    .map((classSummary) => ({
      snapshotId: snapshot.id,
      generatedAt: snapshot.generatedAt ?? snapshot.snapshotData?.generatedAt ?? snapshot.createdAt,
      classId: classSummary.classId,
      className: classSummary.className,
      courseId: snapshot.courseId,
      resultCount: classSummary.resultCount,
      termId: snapshot.termId,
      averages: classSummary.averages,
    }));
}

function selectLatestReadySnapshot<TSnapshot extends { status: string; generatedAt?: string; createdAt?: string }>(
  snapshots: TSnapshot[],
): TSnapshot | undefined {
  return snapshots
    .filter((snapshot) => snapshot.status === "READY")
    .sort((left, right) => toTime(right.generatedAt ?? right.createdAt) - toTime(left.generatedAt ?? left.createdAt))[0];
}

function selectTodayLessons(lessons: ScheduleLessonRecord[], now = new Date()): ScheduleLessonRecord[] {
  const todayKey = toLocalDateKey(now);
  return lessons
    .filter((lesson) => toLocalDateKey(new Date(lesson.startsAt)) === todayKey)
    .sort((left, right) => toTime(left.startsAt) - toTime(right.startsAt));
}

function selectNextLesson(lessons: ScheduleLessonRecord[], now = new Date()): ScheduleLessonRecord | undefined {
  const currentTime = now.getTime();
  return lessons
    .filter((lesson) => toTime(lesson.startsAt) >= currentTime)
    .sort((left, right) => toTime(left.startsAt) - toTime(right.startsAt))[0];
}

function toLocalDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTeacherStudentLabel(student: StudentRecord, classNames: ReadonlyMap<string, string>) {
  const name = `${student.firstName} ${student.lastName}`;
  const className = student.classId ? classNames.get(student.classId) ?? student.classId : undefined;
  return className ? `${name} / ${className}` : name;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatNetNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function isOpenSupportTicket(ticket: SupportTicketRecord) {
  return ticket.status === "OPEN" || ticket.status === "IN_PROGRESS";
}

function teacherPortalHref(path: string, isRolePreview: boolean) {
  return isRolePreview ? `${path}?rolePreview=1` : path;
}

function teacherPortalSubtitle(view: TeacherPortalView, fallback: string) {
  const subtitleByView: Record<TeacherPortalView, string> = {
    announcements: "Duyurular",
    homework: "Ödev kontrolü",
    overview: fallback,
    reports: "Sınav raporu",
    schedule: "Ders akışı",
    student: "Öğrenci takibi",
    support: "Destek talepleri",
  };

  return subtitleByView[view];
}

function teacherPortalContext(view: TeacherPortalView, label: string, selectedStudentLabel: string, isRolePreview: boolean) {
  const detailByView: Record<TeacherPortalView, string> = {
    announcements: "Öğretmen duyuruları ve okuma durumu",
    homework: "Ödev kontrolü ve materyal atamaları",
    overview: "Ders, öğrenci, ödev, rapor ve destek özeti",
    reports: `${selectedStudentLabel} için başarı %, net ve soru bağlamı`,
    schedule: "Bugünkü ders akışı ve program listesi",
    student: `${selectedStudentLabel} için yoklama, not ve materyal işlemleri`,
    support: "Destek talepleri ve yanıt akışı",
  };

  return {
    detail: detailByView[view],
    label,
    meta: isRolePreview ? "Salt-okuma" : "Canlı öğretmen hesabı",
  };
}

function readRequestedStudentId(searchParams: Pick<URLSearchParams, "get">): string {
  return searchParams.get("studentId")?.trim() ?? "";
}

function resolveRequestedStudentId(
  requestedStudentId: string,
  currentStudentId: string,
  firstStudentId: string,
  visibleStudentIds: ReadonlySet<string>,
): string {
  if (requestedStudentId && visibleStudentIds.has(requestedStudentId)) return requestedStudentId;
  if (currentStudentId && visibleStudentIds.has(currentStudentId)) return currentStudentId;
  return firstStudentId;
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function toTime(value: string | undefined) {
  return value ? new Date(value).getTime() : 0;
}
