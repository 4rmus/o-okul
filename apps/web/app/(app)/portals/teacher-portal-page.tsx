"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DataTable, Field, Input, Panel, SegmentedControl, Select, Textarea, type DataTableColumn } from "@o-okul/ui";
import type {
  AcademicTermRecord,
  AnnouncementRecord,
  AttendanceDailyRosterResponse,
  AttendanceDailyUpsertResponse,
  AttendanceRecord,
  AttendanceStatus,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  GradeLevelRecord,
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  HomeworkSubmissionRecord,
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
import { AttendanceRoster } from "../_shared/attendance-status-picker.js";
import { formatDateKey, istanbulDateKey, readDateKeyParam } from "../_shared/istanbul-date.js";
import { TeacherAttendancePanel, TeacherNotesPanel } from "./_shared/activity-panels.js";
import { AnnouncementsPanel } from "./_shared/announcements-panel.js";
import {
  resolveSubmissionHomeworkId,
  TeacherHomeworkPanel,
  TeacherHomeworkSubmissionsPanel,
  TeacherMaterialAssignmentsPanel,
} from "./_shared/homework-panels.js";
import { TeacherHomeworkCreatePanel } from "./teacher-homework-create.js";
import {
  AccessPanel,
  PortalFrame,
  PortalStatePanel,
  RolePreviewNotice,
  readRolePreviewToken,
} from "./_shared/portal-shell.js";
import {
  PortalPanelGate,
  allPanelsFailed,
  emptyList,
  panelStatus,
  retryFailedPanels,
  usePortalPanelQuery,
  type PanelQuery,
} from "./_shared/portal-panel-state.js";
import { ReportPanel } from "./_shared/report-panel.js";
import { StudentHistoryPanel } from "./_shared/student-panels.js";
import { SupportTicketsPanel } from "./_shared/support-tickets-panel.js";
import {
  TeacherClassReportsPanel,
  TeacherFocusPanel,
  TeacherProfileSummaryPanel,
  TeacherSectionError,
  TeacherTodaySchedulePanel,
} from "./_shared/teacher-panels.js";
import { readReportExamId } from "../_shared/report-exam-selection.js";
import { reportQuestionCount, reportSuccessRate } from "../_shared/report-metrics.js";

// Her bölüm kendi sorgusudur; biri düşerse yalnız o bölüm "Bu bölüm yüklenemedi" satırına döner ve
// "Tekrar dene" yalnız o bölümün isteğini yeniler.
type TeacherPortalSection =
  | "announcements"
  | "attendance"
  | "homework"
  | "lookups"
  | "materialAssignments"
  | "materials"
  | "profile"
  | "reports"
  | "schedule"
  | "students"
  | "supportTickets"
  | "teacherNotes";

interface TeacherPortalData {
  teacher?: TeacherRecord;
  announcements: AnnouncementRecord[];
  schedule: ScheduleLessonRecord[];
  students: StudentRecord[];
  attendance: AttendanceRecord[];
  homework: HomeworkRecord[];
  materials: HomeworkMaterialRecord[];
  materialAssignments: HomeworkMaterialAssignmentRecord[];
  attendanceClassIds: string[];
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
}

export type TeacherPortalView = "announcements" | "homework" | "reports" | "schedule" | "student" | "support";

export function TeacherPortalPage({ view }: { view: TeacherPortalView }) {
  const { auth } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const rolePreviewToken = readRolePreviewToken(searchParams);
  const reportExamId = readReportExamId(searchParams);
  const requestedStudentId = readRequestedStudentId(searchParams);
  const isRolePreview = Boolean(rolePreviewToken);
  const canReadPortal = Boolean(auth && (auth.session.subjectType === "TEACHER" || isRolePreview));
  const accessToken = auth?.accessToken ?? "";
  const sections = teacherPortalSections(view);
  const sectionKey = (section: TeacherPortalSection, ...rest: string[]) =>
    ["next-teacher-portal", auth?.session.userId ?? "anonymous", rolePreviewToken || "session", section, ...rest];
  const get = <T,>(path: string) => () => readOnlyRequest<T>(accessToken, `${apiBaseUrl}${path}`, rolePreviewToken);
  const profileQuery = usePortalPanelQuery(sectionKey("profile"), canReadPortal, get<TeacherRecord>("/me/teacher"));
  const announcementsQuery = usePortalPanelQuery(sectionKey("announcements"), canReadPortal && sections.announcements, get<AnnouncementRecord[]>("/me/teacher/announcements"));
  const scheduleQuery = usePortalPanelQuery(sectionKey("schedule"), canReadPortal && sections.schedule, get<ScheduleLessonRecord[]>("/me/teacher/schedule"));
  const studentsQuery = usePortalPanelQuery(sectionKey("students"), canReadPortal && sections.students, get<StudentRecord[]>("/me/teacher/students"));
  const attendanceQuery = usePortalPanelQuery(sectionKey("attendance"), canReadPortal && sections.attendance, get<AttendanceRecord[]>("/me/teacher/attendance"));
  const homeworkQuery = usePortalPanelQuery(sectionKey("homework"), canReadPortal && sections.homework, get<HomeworkRecord[]>("/me/teacher/homework"));
  const materialsQuery = usePortalPanelQuery(sectionKey("materials"), canReadPortal && sections.materials, get<HomeworkMaterialRecord[]>("/me/teacher/homework/materials"));
  const materialAssignmentsQuery = usePortalPanelQuery(
    sectionKey("materialAssignments"),
    canReadPortal && sections.materials,
    get<HomeworkMaterialAssignmentRecord[]>("/me/teacher/homework/material-assignments"),
  );
  const teacherNotesQuery = usePortalPanelQuery(sectionKey("teacherNotes"), canReadPortal && sections.attendance, get<TeacherNoteRecord[]>("/me/teacher/teacher-notes"));
  const supportTicketsQuery = usePortalPanelQuery(sectionKey("supportTickets"), canReadPortal && sections.supportTickets, get<SupportTicketRecord[]>("/me/teacher/support-tickets"));
  const reportsQuery = usePortalPanelQuery(
    sectionKey("reports", reportExamId),
    canReadPortal && sections.reports,
    () => loadTeacherReports(accessToken, rolePreviewToken, reportExamId),
  );
  const lookupsQuery = usePortalPanelQuery(sectionKey("lookups"), canReadPortal && sections.lookups, get<TeacherPortalLookupsResponse>("/me/teacher/lookups"));
  const sectionQueries: Record<TeacherPortalSection, PanelQuery> = {
    announcements: announcementsQuery,
    attendance: attendanceQuery,
    homework: homeworkQuery,
    lookups: lookupsQuery,
    materialAssignments: materialAssignmentsQuery,
    materials: materialsQuery,
    profile: profileQuery,
    reports: reportsQuery,
    schedule: scheduleQuery,
    students: studentsQuery,
    supportTickets: supportTicketsQuery,
    teacherNotes: teacherNotesQuery,
  };
  const students = studentsQuery.data ?? emptyList<StudentRecord>();
  const lookups = lookupsQuery.data;
  const reportSnapshots = reportsQuery.data?.snapshots ?? emptyList<ReportSnapshotRecord>();
  const data: TeacherPortalData = {
    teacher: profileQuery.data,
    announcements: announcementsQuery.data ?? emptyList<AnnouncementRecord>(),
    schedule: scheduleQuery.data ?? emptyList<ScheduleLessonRecord>(),
    students,
    attendance: attendanceQuery.data ?? emptyList<AttendanceRecord>(),
    homework: homeworkQuery.data ?? emptyList<HomeworkRecord>(),
    materials: materialsQuery.data ?? emptyList<HomeworkMaterialRecord>(),
    materialAssignments: materialAssignmentsQuery.data ?? emptyList<HomeworkMaterialAssignmentRecord>(),
    attendanceClassIds: lookups?.attendanceClassIds ?? emptyList<string>(),
    campuses: lookups?.campuses ?? emptyList<CampusRecord>(),
    classes: lookups?.classes ?? emptyList<ClassRecord>(),
    courses: lookups?.courses ?? emptyList<CourseRecord>(),
    gradeLevels: lookups?.gradeLevels ?? emptyList<GradeLevelRecord>(),
    terms: lookups?.terms ?? emptyList<AcademicTermRecord>(),
    classReports: selectTeacherClassReports(reportSnapshots, students),
    reportIndex: reportsQuery.data?.reportIndex ?? emptyList<PortalReportIndexItem>(),
    reportSnapshots,
    selectedReportExamId: reportsQuery.data?.selectedReportExamId ?? "",
    supportTickets: supportTicketsQuery.data ?? emptyList<SupportTicketRecord>(),
    teacherNotes: teacherNotesQuery.data ?? emptyList<TeacherNoteRecord>(),
  };
  // Bugün ekranındaki "Yoklama al" bağlantısı dersin sınıfını ve gününü taşır.
  const requestedAttendanceClassId = searchParams.get("classId")?.trim() ?? "";
  const requestedAttendanceDate = readDateKeyParam(searchParams.get("date"));
  const [attendanceForm, setAttendanceForm] = useState<TeacherAttendanceForm>({
    classId: "",
    date: requestedAttendanceDate || istanbulDateKey(),
  });
  const [attendanceNotice, setAttendanceNotice] = useState("");
  const [isSavingAttendance, setIsSavingAttendance] = useState(false);
  const [attendanceStatuses, setAttendanceStatuses] = useState<Record<string, AttendanceStatus | "">>({});
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
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterClassId, setRosterClassId] = useState("");
  const [selectedHomeworkId, setSelectedHomeworkId] = useState("");

  // Form varsayılanları her bölüm geldikçe yeniden çözülür; bölümler birbirini beklemez.
  useEffect(() => {
    if (!studentsQuery.data && !materialsQuery.data && !scheduleQuery.data && !lookupsQuery.data) return;
    const schedule = scheduleQuery.data ?? [];
    const visibleStudents = studentsQuery.data ?? [];
    const attendanceClassIds = lookupsQuery.data?.attendanceClassIds ?? [];
    const firstStudentId = visibleStudents[0]?.id ?? "";
    const firstMaterialId = materialsQuery.data?.[0]?.id ?? "";
    const firstCourseId = schedule.find((lesson) => lesson.courseId)?.courseId ?? "";
    const firstTermId = schedule.find((lesson) => lesson.termId)?.termId ?? "";
    const firstClassId = (lookupsQuery.data?.classes ?? []).find((record) => attendanceClassIds.includes(record.id))?.id ?? "";
    const visibleStudentIds = new Set(visibleStudents.map((student) => student.id));
    const visibleCourseIds = new Set(schedule.map((lesson) => lesson.courseId).filter((courseId): courseId is string => Boolean(courseId)));
    const visibleTermIds = new Set(schedule.map((lesson) => lesson.termId).filter((termId): termId is string => Boolean(termId)));
    setAttendanceForm((current) => ({
      ...current,
      // İstenen sınıf atanmış sınıflardan değilse başka bir sınıfa sessizce düşülmez; form boş kalır ve uyarı görünür.
      classId: current.classId
        || (requestedAttendanceClassId
          ? (attendanceClassIds.includes(requestedAttendanceClassId) ? requestedAttendanceClassId : "")
          : firstClassId),
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
  }, [lookupsQuery.data, materialsQuery.data, requestedAttendanceClassId, requestedStudentId, scheduleQuery.data, studentsQuery.data]);

  useEffect(() => {
    setAttendanceNotice("");
  }, [attendanceForm.classId, attendanceForm.date]);

  // Bugün ekranından "#portal-teacher-attendance" ile gelindiğinde form ancak veri yüklenince oluşur; tarayıcının
  // ilk kaydırması hedefi bulamaz, bu yüzden Ders akışı bölümleri yerleşince form görünür kılınıp odaklanır.
  const rollCallReady = lookupsQuery.isSuccess && !scheduleQuery.isLoading && !profileQuery.isLoading && !studentsQuery.isLoading;
  useEffect(() => {
    if (!rollCallReady || window.location.hash !== "#portal-teacher-attendance") return;
    const target = document.getElementById("portal-teacher-attendance");
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }, [rollCallReady]);

  const teacherDailyAttendanceQuery = useQuery({
    queryKey: ["next-teacher-daily-attendance", auth?.session.userId ?? "anonymous", attendanceForm.classId, attendanceForm.date],
    queryFn: () => loadTeacherDailyAttendance(auth?.accessToken ?? "", attendanceForm.classId, attendanceForm.date),
    enabled: Boolean(canReadPortal && !isRolePreview && attendanceForm.classId && attendanceForm.date && view === "schedule"),
    refetchOnWindowFocus: false,
  });
  const attendanceRoster = teacherDailyAttendanceQuery.data?.students ?? [];
  const attendanceClassIds = new Set(data?.attendanceClassIds ?? []);
  const attendanceClassOptions = (data?.classes ?? []).filter((record) => attendanceClassIds.has(record.id));
  const requestedAttendanceClassDenied = Boolean(
    requestedAttendanceClassId && lookupsQuery.isSuccess && !data.attendanceClassIds.includes(requestedAttendanceClassId),
  );
  const attendanceRosterComplete = attendanceRoster.length > 0 && attendanceRoster.every((student) => Boolean(attendanceStatuses[student.id]));
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
  const selectedStudentId = noteForm.studentId || materialForm.studentId || students[0]?.id;
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
    enabled: Boolean(canReadPortal && selectedStudentId && data?.selectedReportExamId && (view === "student" || view === "reports")),
    refetchOnWindowFocus: false,
  });
  const selectedReportTotal = reportQuery.data?.report?.total;
  const selectedReportSuccess = reportSuccessRate(selectedReportTotal);
  const selectedCourseId = noteForm.courseId || materialForm.courseId || reportQuery.data?.reportContext?.courseId;
  const selectedTermId = noteForm.termId || materialForm.termId || reportQuery.data?.reportContext?.termId;
  const selectedCourseName = selectedCourseId ? courseNameById.get(selectedCourseId) : undefined;
  const selectedTermName = selectedTermId ? termNameById.get(selectedTermId) : undefined;
  const selectedStudentLabel = selectedStudent ? formatTeacherStudentLabel(selectedStudent, classNameById) : "Seçili öğrenci yok";
  const rosterClassOptions = useMemo(() => {
    const classIds = new Set(students.map((student) => student.classId).filter((classId): classId is string => Boolean(classId)));
    return (data?.classes ?? []).filter((schoolClass) => classIds.has(schoolClass.id));
  }, [data?.classes, students]);
  const filteredStudents = useMemo(
    () => filterTeacherStudents(students, rosterSearch, rosterClassId),
    [rosterClassId, rosterSearch, students],
  );
  const historyQuery = useQuery({
    queryKey: ["next-teacher-student-history", auth?.session.userId ?? "anonymous", selectedStudentId ?? "none", rolePreviewToken || "session"],
    queryFn: () => loadTeacherStudentHistory(auth?.accessToken ?? "", selectedStudentId ?? "", rolePreviewToken),
    enabled: Boolean(canReadPortal && selectedStudentId && view === "student"),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!teacherDailyAttendanceQuery.data) {
      setAttendanceStatuses({});
      return;
    }
    const statusByStudentId = new Map(
      teacherDailyAttendanceQuery.data.records.map((record) => [record.studentId, record.status]),
    );
    setAttendanceStatuses(Object.fromEntries(
      teacherDailyAttendanceQuery.data.students.map((student) => [student.id, statusByStudentId.get(student.id) ?? ""]),
    ));
  }, [teacherDailyAttendanceQuery.data]);

  if (!canReadPortal) {
    return <AccessPanel title="Öğretmen Portalı" />;
  }

  if (allPanelsFailed(Object.values(sectionQueries))) {
    return (
      <PortalFrame title="Öğretmen Portalı" subtitle="Ders programı">
        <PortalStatePanel
          state="error"
          title="Öğretmen portal verisi alınamadı"
          description="Portal bilgileri şu anda gösterilemiyor. Bağlantınızı kontrol edip tekrar deneyin."
          onRetry={() => retryFailedPanels(...Object.values(sectionQueries))}
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
    setNoteForm((current) => ({ ...current, studentId }));
    setMaterialForm((current) => ({ ...current, studentId }));
  }

  function markAttendanceRosterPresent() {
    setAttendanceStatuses(Object.fromEntries(attendanceRoster.map((student) => [student.id, "PRESENT"] as const)));
  }

  async function submitAttendance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    if (isRolePreview) {
      setActionError("Bu önizlemede işlem yapılamaz.");
      return;
    }

    setActionError("");
    setAttendanceNotice("");
    if (!attendanceForm.classId || !attendanceForm.date || !attendanceRosterComplete) {
      setActionError("Sınıf listesindeki tüm öğrencilerin durumu seçilmelidir.");
      return;
    }
    if (isSavingAttendance) return;

    setIsSavingAttendance(true);
    try {
      await saveDailyAttendance(auth.accessToken, {
        classId: attendanceForm.classId,
        date: attendanceForm.date,
        entries: attendanceRoster.map((student) => ({
          studentId: student.id,
          status: attendanceStatuses[student.id] as AttendanceStatus,
        })),
      });
      // Yoklama kayıtları Öğrenci takibi görünümündedir; o görünüm bir sonraki açılışta yeniden okunur.
      await queryClient.invalidateQueries({ queryKey: sectionKey("attendance"), refetchType: "none" });
      await queryClient.invalidateQueries({
        queryKey: ["next-teacher-daily-attendance", auth.session.userId, attendanceForm.classId, attendanceForm.date],
      });
      const savedClassName = attendanceClassOptions.find((record) => record.id === attendanceForm.classId)?.name ?? "Sınıf";
      setAttendanceNotice(`${savedClassName} yoklaması kaydedildi (${formatDateKey(attendanceForm.date)}).`);
    } catch {
      setActionError("Yoklama kaydedilemedi.");
    } finally {
      setIsSavingAttendance(false);
    }
  }

  async function submitTeacherNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    if (isRolePreview) {
      setActionError("Bu önizlemede işlem yapılamaz.");
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
      queryClient.setQueryData<TeacherNoteRecord[]>(sectionKey("teacherNotes"), (current) =>
        current ? [note, ...current] : current,
      );
      setNoteForm((current) => ({ ...current, body: "", developmentStatus: "" }));
    } catch {
      setActionError("Öğretmen notu eklenemedi.");
    }
  }

  async function toggleHomeworkCheck(homework: HomeworkRecord) {
    if (!auth) return;
    if (isRolePreview) {
      setActionError("Bu önizlemede işlem yapılamaz.");
      return;
    }

    setActionError("");
    try {
      const record = await updateHomeworkCheckStatus(auth.accessToken, homework.id, !homework.checkedAt);
      queryClient.setQueryData<HomeworkRecord[]>(sectionKey("homework"), (current) =>
        current?.map((candidate) => (candidate.id === record.id ? record : candidate)),
      );
    } catch {
      setActionError("Ödev kontrol durumu kaydedilemedi.");
    }
  }

  async function submitMaterialAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    if (isRolePreview) {
      setActionError("Bu önizlemede işlem yapılamaz.");
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
      queryClient.setQueryData<HomeworkMaterialAssignmentRecord[]>(sectionKey("materialAssignments"), (current) =>
        current ? [assignment, ...current] : current,
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
      render: (lesson) => (lesson.classId ? classNameById.get(lesson.classId) ?? "Sınıf bilgisi yok" : "-"),
    },
    {
      header: "Branş",
      key: "course",
      priority: "secondary",
      render: (lesson) => (lesson.courseId ? courseNameById.get(lesson.courseId) ?? "Ders bilgisi yok" : "-"),
    },
    {
      header: "Dönem",
      key: "term",
      priority: "optional",
      render: (lesson) => (lesson.termId ? termNameById.get(lesson.termId) ?? "Dönem bilgisi yok" : "-"),
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
  // Berrak §5: yazma formları günlük özetten çıktı. Ders akışı = program + yoklama; Öğrenci takibi = öğrenci
  // listesi, seçili öğrenci özeti, not ve materyal formları. Özet /ogretmen için teacher-today-page.tsx'tedir.
  const showStudentWorkspace = view === "student" || view === "homework" || view === "reports" || view === "support";
  const showStudentTracking = view === "student";
  const showRollCall = view === "schedule";
  const portalSubtitle = teacherPortalSubtitle(view);
  const sectionReady = (section: TeacherPortalSection) => panelStatus(sectionQueries[section]) === "ready";
  const sectionError = (section: TeacherPortalSection, label: string, title: string, id?: string) =>
    sectionQueries[section].isError ? (
      <TeacherSectionError
        id={id}
        label={label}
        onRetry={() => void sectionQueries[section].refetch()}
        retrying={sectionQueries[section].isFetching}
        title={title}
      />
    ) : null;
  // Bölüm yüklenirken yer tutucu, düşünce yalnız o bölümü yenileyen "Tekrar dene" satırı gösterilir.
  const sectionGate = (section: TeacherPortalSection | TeacherPortalSection[], label: string, title: string, content: ReactNode, id?: string) => (
    <PortalPanelGate
      error={(retry, retrying) => <TeacherSectionError id={id} label={label} onRetry={retry} retrying={retrying} title={title} />}
      id={id}
      label={label}
      queries={(Array.isArray(section) ? section : [section]).map((key) => sectionQueries[key])}
      subject={title}
      title={title}
    >
      {content}
    </PortalPanelGate>
  );
  const visibleHomework = data?.homework ?? [];
  const activeHomeworkId = resolveSubmissionHomeworkId(visibleHomework, selectedHomeworkId);

  function selectHomework(homeworkId: string) {
    setSelectedHomeworkId(homeworkId);
    // Telefonda Teslim Durumu tablonun altında kalır; seçim yapılınca görünür alana getirilir.
    window.requestAnimationFrame(() => {
      document.getElementById("portal-teacher-homework-submissions")?.scrollIntoView({ block: "nearest" });
    });
  }

  const attendancePanel = sectionGate("lookups", "Yoklama kaydet", "Yoklama", (
    <Panel
      as="form"
      aria-label="Yoklama kaydet"
      className="next-teacher-action-panel"
      description="Atandığınız sınıfın tam öğrenci listesini tarih için tek işlemde kaydedin."
      id="portal-teacher-attendance"
      title="Yoklama"
      onSubmit={(event) => void submitAttendance(event)}
    >
      <Field label="Yoklama sınıfı">
        <Select
          required
          value={attendanceForm.classId}
          onChange={(event) => setAttendanceForm((current) => ({ ...current, classId: event.target.value }))}
        >
          <option value="">Sınıf seçiniz</option>
          {attendanceClassOptions.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
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
      {requestedAttendanceClassDenied && !attendanceForm.classId ? (
        <p className="next-field-hint" role="status">Bu dersin sınıfı için yoklama yetkiniz yok; listeden atandığınız bir sınıfı seçin.</p>
      ) : null}
      {attendanceNotice ? <p className="next-field-hint" role="status">{attendanceNotice}</p> : null}
      {attendanceForm.classId ? (
        <AttendanceRoster
          disabled={isSavingAttendance}
          emptyText="Seçili tarihte öğrenci yok"
          error={teacherDailyAttendanceQuery.isError ? "Tarihsel sınıf listesi alınamadı." : undefined}
          label="Öğretmen günlük yoklama listesi"
          loading={teacherDailyAttendanceQuery.isPending}
          onMarkAllPresent={markAttendanceRosterPresent}
          onStatusChange={(studentId, status) => setAttendanceStatuses((current) => ({ ...current, [studentId]: status }))}
          saveAction={(
            <Button
              aria-describedby="teacher-attendance-summary"
              disabled={!attendanceRosterComplete}
              loading={isSavingAttendance}
              loadingLabel="Yoklama kaydediliyor"
              type="submit"
            >
              Yoklamayı kaydet
            </Button>
          )}
          statuses={attendanceStatuses}
          students={attendanceRoster}
          summaryId="teacher-attendance-summary"
        />
      ) : (
        <p className="next-field-hint">Yoklama listesi için sınıf seçin.</p>
      )}
    </Panel>
  ), "portal-teacher-attendance");

  return (
    <PortalFrame
      title="Öğretmen Portalı"
      subtitle={portalSubtitle}
      context={teacherPortalContext(view, portalSubtitle, Boolean(selectedStudent), isRolePreview)}
    >
      {isRolePreview ? (
        <div id="portal-teacher-preview">
          <RolePreviewNotice />
        </div>
      ) : null}
      {view === "schedule" ? <div id="portal-teacher-today-schedule">
        {sectionGate("schedule", "Bugünkü dersler", "Bugünkü Dersler", <TeacherTodaySchedulePanel
          classNames={classNameById}
          courseNames={courseNameById}
          lessons={todayLessons}
          nextLesson={nextLesson}
          termNames={termNameById}
        />)}
      </div> : null}
      {showRollCall && !isRolePreview ? (
        <section className="next-teacher-action-grid" aria-label="Öğretmen günlük işlemleri" id="portal-teacher-actions">
          {attendancePanel}
          {actionError ? (
            <Alert tone="danger" title="İşlem kaydedilemedi">
              {actionError}
            </Alert>
          ) : null}
        </section>
      ) : null}
      {view === "announcements" ? <div id="portal-teacher-announcements">
        {sectionGate("announcements", "Duyurular", "Duyurular", <AnnouncementsPanel
          announcements={data?.announcements ?? []}
          readOnly={isRolePreview}
          onMarkRead={(announcement) =>
            auth && !isRolePreview
              ? markAnnouncementRead(auth.accessToken, `me/teacher/announcements/${encodeURIComponent(announcement.id)}/read`).then(() =>
                  announcementsQuery.refetch(),
                )
              : undefined
          }
        />)}
      </div> : null}
      {showStudentWorkspace ? sectionError("lookups", "Sınıf ve ders bilgileri", "Sınıf ve Ders Bilgileri") : null}
      {showStudentWorkspace ? <section className="next-teacher-workspace" aria-label="Öğrenci çalışma alanı" id="portal-teacher-workspace">
        {showStudentTracking ? <header className="next-teacher-workspace__header">
          <div>
            <p className="next-section-eyebrow">Öğrenci çalışma alanı</p>
            <h2>Öğrenci Takibi</h2>
          </div>
          <p>{selectedStudentLabel}</p>
        </header> : null}
        {showStudentTracking ? sectionGate("students", "Öğretmen öğrenci kapsamı", "Öğrenciler", <Panel
          aria-label="Öğretmen öğrenci kapsamı"
          description="Öğretmenin işlem yapabildiği öğrenci kapsamı; ad, soyad veya numarayla arayın."
          id="portal-teacher-student-picker"
          title="Öğrenciler"
        >
          <div className="next-teacher-roster__filters">
            <Field label="Öğrenci ara">
              <Input
                autoComplete="off"
                placeholder="Ad, soyad veya numara"
                type="search"
                value={rosterSearch}
                onChange={(event) => setRosterSearch(event.target.value)}
              />
            </Field>
            {rosterClassOptions.length > 1 ? (
              <Field label="Sınıf">
                <Select value={rosterClassId} onChange={(event) => setRosterClassId(event.target.value)}>
                  <option value="">Tüm sınıflar</option>
                  {rosterClassOptions.map((schoolClass) => <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>)}
                </Select>
              </Field>
            ) : null}
          </div>
          <p className="next-field-hint next-teacher-roster__count" role="status">
            {filteredStudents.length === students.length
              ? `${students.length} öğrenci`
              : `${filteredStudents.length} / ${students.length} öğrenci`}
          </p>
          {filteredStudents.length > 0 ? (
            <SegmentedControl className="next-teacher-roster__list" label="Öğrenci seçimi">
              {filteredStudents.map((student) => (
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
          ) : (
            <p className="next-field-hint">{students.length > 0 ? "Aramaya uyan öğrenci yok." : "Öğrenci kapsamı boş."}</p>
          )}
        </Panel>, "portal-teacher-student-picker") : null}
        {showStudentTracking ? <div id="portal-teacher-focus">
          <TeacherFocusPanel
            campusNames={campusNameById}
            courseName={selectedCourseName}
            gradeLevelNames={gradeLevelNameById}
            mode={isRolePreview ? "read-only" : "write"}
            net={selectedReportTotal?.net}
            questionCount={reportQuestionCount(selectedReportTotal)}
            selectedClass={selectedClass}
            selectedStudent={selectedStudent}
            successRate={selectedReportSuccess}
            termName={selectedTermName}
          />
        </div> : null}
        {showStudentTracking && !isRolePreview && sectionReady("students") ? (
          <section className="next-teacher-action-grid" aria-label="Öğretmen günlük işlemleri" id="portal-teacher-actions">
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
        {view === "support" ? <div id="portal-teacher-support">
          {sectionGate("supportTickets", "Destek talepleri", "Destek Talepleri", <SupportTicketsPanel
            accessToken={auth?.accessToken}
            commentsPath="me/teacher/support-tickets"
            readOnly={isRolePreview}
            tickets={data?.supportTickets ?? []}
            onTicketChange={() => supportTicketsQuery.refetch()}
            studentOptions={students.map((student) => ({ id: student.id, label: formatTeacherStudentLabel(student, classNameById) }))}
            onCreate={(input) =>
              auth && !isRolePreview
                ? createPortalSupportTicket(
                    auth.accessToken,
                    "me/teacher/support-tickets",
                    withTeacherTicketStudentContext(input, students, data?.classes ?? []),
                  ).then(() => supportTicketsQuery.refetch())
                : undefined
            }
          />)}
        </div> : null}
        {view === "homework" ? <div id="portal-teacher-homework">
          {auth && !isRolePreview ? <TeacherHomeworkCreatePanel accessToken={auth.accessToken} onCreated={() => void homeworkQuery.refetch()} /> : null}
          {sectionGate("homework", "Öğretmen ödev kontrolü", "Ödev Kontrolü", <>
            <TeacherHomeworkPanel
              classNames={classNameById}
              homework={visibleHomework}
              onSelect={(homework) => selectHomework(homework.id)}
              onToggle={(homework) => void toggleHomeworkCheck(homework)}
              readOnly={isRolePreview}
              selectedHomeworkId={activeHomeworkId}
            />
            {auth ? <TeacherHomeworkSubmissionsPanel
              classNames={classNameById}
              homework={visibleHomework}
              loadSubmissions={(homeworkId) => listHomeworkSubmissions(auth.accessToken, homeworkId, rolePreviewToken)}
              onCheck={(homeworkId, studentIds) => checkHomeworkSubmissions(auth.accessToken, homeworkId, studentIds)}
              onSelectHomework={setSelectedHomeworkId}
              readOnly={isRolePreview}
              selectedHomeworkId={activeHomeworkId}
              students={students}
            /> : null}
          </>)}
        </div> : null}
        {view === "homework" || view === "student"
          ? sectionGate(["materialAssignments", "materials"], "Öğretmen materyal atamaları", "Materyal Atamaları", <TeacherMaterialAssignmentsPanel
            assignments={(data?.materialAssignments ?? []).filter((assignment) => assignment.studentId === selectedStudentId)}
            courseNames={courseNameById}
            materials={data?.materials ?? []}
            students={students}
            termNames={termNameById}
          />)
          : null}
        {showStudentTracking ? <StudentHistoryPanel
          enrollments={historyQuery.data?.enrollments ?? []}
          termNames={termNameById}
        /> : null}
        {historyQuery.isError ? <p className="next-form-error">Öğrenci geçmişi alınamadı.</p> : null}
        {view === "reports" ? <div id="portal-teacher-report">
          {sectionGate("reports", "Portal rapor özeti", "Sınav Raporu", <>
            {(data?.reportIndex.length ?? 0) > 0 ? (
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
          </>)}
        </div> : null}
        {reportQuery.isError ? <p className="next-form-error">Öğrenci raporu alınamadı.</p> : null}
      </section> : null}
      {view === "reports" && sectionReady("reports") ? <TeacherClassReportsPanel
        courseNames={courseNameById}
        reports={data?.classReports ?? []}
        termNames={termNameById}
      /> : null}
      {showStudentTracking
        ? sectionGate("attendance", "Öğretmen yoklama kayıtları", "Yoklama Kayıtları", <TeacherAttendancePanel records={data?.attendance ?? []} students={students} courseNames={courseNameById} termNames={termNameById} />)
        : null}
      {showStudentTracking
        ? sectionGate("teacherNotes", "Öğretmen notları", "Öğretmen Notları", <TeacherNotesPanel notes={data?.teacherNotes ?? []} students={students} courseNames={courseNameById} termNames={termNameById} />)
        : null}
      {view === "schedule" ? sectionGate("schedule", "Ders programı", "Program", <Panel
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
      </Panel>) : null}
      {view === "schedule" ? <div id="portal-teacher-profile">
        {sectionGate("profile", "Öğretmen profil özeti", "Profil Özeti", <TeacherProfileSummaryPanel
          campusNames={campusNameById}
          classes={classById}
          classNames={classNameById}
          courseNames={courseNameById}
          gradeLevelNames={gradeLevelNameById}
          schedule={data?.schedule ?? []}
          students={students}
          teacher={data?.teacher}
          termNames={termNameById}
        />)}
      </div> : null}
    </PortalFrame>
  );
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL, rolePreviewToken = ""): Promise<T | null> {
  const response = await authenticatedFetch(accessToken, input, withRolePreview({}, rolePreviewToken));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("API_REQUEST_FAILED");
  return readData<T>(response);
}

function teacherPortalSections(view: TeacherPortalView) {
  const student = view === "student";
  const rollCall = view === "schedule";
  const homework = view === "homework";
  const support = view === "support";
  // Öğrenci takibindeki seçili öğrenci özeti Başarı % gösterir; rapor verisi orada da yüklenir.
  const reports = view === "reports" || student;
  // Destek talebi ders/dönem bağlamını ders programından alır.
  const schedule = rollCall || student || homework || support;
  // Ders akışındaki profil özeti öğrenci sayısını gösterir.
  const students = rollCall || student || reports || homework || support;
  return {
    announcements: view === "announcements",
    attendance: student,
    homework,
    lookups: students || schedule,
    materials: homework || student,
    reports,
    schedule,
    students,
    supportTickets: support,
  };
}

async function loadTeacherReports(accessToken: string, rolePreviewToken: string, requestedReportExamId: string) {
  const reportIndex = await apiRequestOrNull<PortalReportIndexItem[]>(accessToken, `${apiBaseUrl}/me/teacher/reports`, rolePreviewToken) ?? [];
  const selectedReportExamId = reportIndex.some((record) => record.examId === requestedReportExamId)
    ? requestedReportExamId
    : reportIndex[0]?.examId ?? "";
  const snapshots = selectedReportExamId
    ? await readOnlyRequest<ReportSnapshotRecord[]>(
        accessToken,
        `${apiBaseUrl}/me/teacher/reports/${encodeURIComponent(selectedReportExamId)}/snapshots`,
        rolePreviewToken,
      )
    : [];
  return { reportIndex, selectedReportExamId, snapshots };
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

async function listHomeworkSubmissions(accessToken: string, homeworkId: string, rolePreviewToken: string) {
  return readOnlyRequest<HomeworkSubmissionRecord[]>(accessToken, `${apiBaseUrl}/homework/${encodeURIComponent(homeworkId)}/submissions`, rolePreviewToken);
}

async function checkHomeworkSubmissions(accessToken: string, homeworkId: string, studentIds: string[]) {
  return apiRequest<HomeworkSubmissionRecord[]>(accessToken, `${apiBaseUrl}/homework/${encodeURIComponent(homeworkId)}/submissions/check`, {
    body: JSON.stringify({ studentIds }),
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

// Arama ad, soyad ve öğrenci numarasında Türkçe büyük/küçük harf duyarsız eşleşir.
function filterTeacherStudents(students: StudentRecord[], search: string, classId: string): StudentRecord[] {
  const needle = search.trim().toLocaleLowerCase("tr-TR");
  return students.filter((student) => {
    if (classId && student.classId !== classId) return false;
    if (!needle) return true;
    const haystack = `${student.firstName} ${student.lastName} ${student.studentNo ?? ""}`.toLocaleLowerCase("tr-TR");
    return haystack.includes(needle);
  });
}

function formatTeacherStudentLabel(student: StudentRecord, classNames: ReadonlyMap<string, string>) {
  const name = `${student.firstName} ${student.lastName}`;
  const className = student.classId ? classNames.get(student.classId) ?? "Sınıf bilgisi yok" : undefined;
  return className ? `${name} / ${className}` : name;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function teacherPortalHref(path: string, isRolePreview: boolean) {
  return isRolePreview ? `${path}?rolePreview=1` : path;
}

function teacherPortalSubtitle(view: TeacherPortalView) {
  const subtitleByView: Record<TeacherPortalView, string> = {
    announcements: "Duyurular",
    homework: "Ödev kontrolü",
    reports: "Sınav raporu",
    schedule: "Ders akışı",
    student: "Öğrenci takibi",
    support: "Destek talepleri",
  };

  return subtitleByView[view];
}

function teacherPortalContext(view: TeacherPortalView, label: string, hasSelectedStudent: boolean, isRolePreview: boolean) {
  const detailByView: Record<TeacherPortalView, string> = {
    announcements: "Öğretmen duyuruları ve okuma durumu",
    homework: "Ödev kontrolü ve materyal atamaları",
    reports: hasSelectedStudent ? "Seçili öğrenci için başarı %, net ve soru bağlamı" : "Başarı %, net ve soru bağlamı",
    schedule: "Bugünkü dersler, yoklama ve program listesi",
    student: hasSelectedStudent ? "Seçili öğrenci için not, materyal ve yoklama geçmişi" : "Öğrenci listesi, not ve materyal işlemleri",
    support: "Destek talepleri ve yanıt akışı",
  };

  return {
    detail: detailByView[view],
    label,
    meta: isRolePreview ? "Yalnızca görüntüleme" : "Canlı öğretmen hesabı",
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

// Destek talebi yalnız öğretmenin açıkça seçtiği öğrenciye bağlanır; seçilmezse öğrenci ve sınıf bağlamı gönderilmez.
function withTeacherTicketStudentContext(
  input: SupportTicketFormPayload,
  students: StudentRecord[],
  classes: ClassRecord[],
): SupportTicketFormPayload {
  const student = input.studentId ? students.find((record) => record.id === input.studentId) : undefined;
  const studentClass = student?.classId ? classes.find((record) => record.id === student.classId) : undefined;
  return {
    ...input,
    campusId: studentClass?.campusId ?? "",
    classId: studentClass?.id ?? "",
    courseId: "",
    gradeLevelId: studentClass?.gradeLevelId ?? "",
    studentId: student?.id ?? "",
    termId: "",
  };
}

function toTime(value: string | undefined) {
  return value ? new Date(value).getTime() : 0;
}
