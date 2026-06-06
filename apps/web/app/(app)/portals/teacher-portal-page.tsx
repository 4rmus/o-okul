"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@uzman-hocam/ui";
import type {
  AcademicTermRecord,
  AnnouncementRecord,
  AttendanceRecord,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  GradeLevelRecord,
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  ReportErrorBooklet,
  ReportSnapshotRecord,
  ReportStudentProgress,
  ReportStudentSnapshot,
  ScheduleLessonRecord,
  StudentClassHistoryRecord,
  StudentEnrollmentRecord,
  StudentRecord,
  SupportTicketRecord,
  TeacherNoteRecord,
  TeacherRecord,
} from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetch, readData } from "../../../src/api-client.js";
import {
  attendanceFormSchema,
  firstFormError,
  materialAssignmentFormSchema,
  teacherNoteFormSchema,
  type AttendanceFormPayload,
  type MaterialAssignmentFormPayload,
  type SupportTicketFormPayload,
  type TeacherNoteFormPayload,
} from "../../../src/form-validation.js";
import { useAuth } from "../../providers.js";
import { TeacherAttendancePanel, TeacherNotesPanel } from "./_shared/activity-panels.js";
import { AnnouncementsPanel } from "./_shared/announcements-panel.js";
import { TeacherHomeworkPanel, TeacherMaterialAssignmentsPanel } from "./_shared/homework-panels.js";
import { AccessPanel, MetricGrid, PortalFrame } from "./_shared/portal-shell.js";
import { ReportPanel } from "./_shared/report-panel.js";
import { StudentHistoryPanel } from "./_shared/student-panels.js";
import { SupportTicketsPanel } from "./_shared/support-tickets-panel.js";
import { TeacherClassReportsPanel, TeacherProfileSummaryPanel, TeacherTodaySchedulePanel } from "./_shared/teacher-panels.js";

const portalExamId = "exam-demo-isem-lgs-1";

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
}

interface TeacherStudentReportData {
  errorBooklet: ReportErrorBooklet | null;
  progress: ReportStudentProgress | null;
  report: ReportStudentSnapshot | null;
  reportContext?: ReportContext;
}

interface TeacherStudentHistoryData {
  classHistory: StudentClassHistoryRecord[];
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

export function TeacherPortalPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const rolePreviewToken = searchParams.get("rolePreviewToken")?.trim() ?? "";
  const isRolePreview = Boolean(rolePreviewToken);
  const canReadPortal = Boolean(auth && (auth.session.subjectType === "TEACHER" || isRolePreview));
  const queryKey = ["next-teacher-portal", auth?.session.userId ?? "anonymous", rolePreviewToken || "session"];
  const query = useQuery({
    queryKey,
    queryFn: () => loadTeacherPortal(auth?.accessToken ?? "", rolePreviewToken),
    enabled: canReadPortal,
    refetchOnWindowFocus: false,
  });
  const today = todayInputValue();
  const [attendanceForm, setAttendanceForm] = useState<AttendanceFormPayload>({
    studentId: "",
    courseId: "",
    termId: "",
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
    const visibleStudentIds = new Set(query.data.students.map((student) => student.id));
    const visibleCourseIds = new Set(query.data.schedule.map((lesson) => lesson.courseId).filter((courseId): courseId is string => Boolean(courseId)));
    const visibleTermIds = new Set(query.data.schedule.map((lesson) => lesson.termId).filter((termId): termId is string => Boolean(termId)));
    setAttendanceForm((current) => ({
      ...current,
      studentId: current.studentId && visibleStudentIds.has(current.studentId) ? current.studentId : firstStudentId,
      courseId: current.courseId && visibleCourseIds.has(current.courseId) ? current.courseId : firstCourseId,
      termId: current.termId && visibleTermIds.has(current.termId) ? current.termId : firstTermId,
    }));
    setNoteForm((current) => ({
      ...current,
      studentId: current.studentId && visibleStudentIds.has(current.studentId) ? current.studentId : firstStudentId,
      courseId: current.courseId && visibleCourseIds.has(current.courseId) ? current.courseId : firstCourseId,
      termId: current.termId && visibleTermIds.has(current.termId) ? current.termId : firstTermId,
    }));
    setMaterialForm((current) => ({
      ...current,
      materialId: current.materialId || firstMaterialId,
      studentId: current.studentId && visibleStudentIds.has(current.studentId) ? current.studentId : firstStudentId,
      courseId: current.courseId && visibleCourseIds.has(current.courseId) ? current.courseId : firstCourseId,
      termId: current.termId && visibleTermIds.has(current.termId) ? current.termId : firstTermId,
    }));
  }, [query.data, query.isSuccess]);

  const data = query.data;
  const students = data?.students ?? [];
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
  const selectedStudentId = attendanceForm.studentId || noteForm.studentId || materialForm.studentId || students[0]?.id;
  const selectedStudent = students.find((student) => student.id === selectedStudentId);
  const selectedClass = selectedStudent?.classId ? classById.get(selectedStudent.classId) : undefined;
  const todayLessons = useMemo(() => selectTodayLessons(data?.schedule ?? []), [data?.schedule]);
  const nextLesson = useMemo(() => selectNextLesson(data?.schedule ?? []), [data?.schedule]);
  const reportQuery = useQuery({
    queryKey: ["next-teacher-student-report", auth?.session.userId ?? "anonymous", selectedStudentId ?? "none", rolePreviewToken || "session"],
    queryFn: () => loadTeacherStudentReport(auth?.accessToken ?? "", selectedStudentId ?? "", rolePreviewToken),
    enabled: Boolean(canReadPortal && selectedStudentId),
    refetchOnWindowFocus: false,
  });
  const historyQuery = useQuery({
    queryKey: ["next-teacher-student-history", auth?.session.userId ?? "anonymous", selectedStudentId ?? "none", rolePreviewToken || "session"],
    queryFn: () => loadTeacherStudentHistory(auth?.accessToken ?? "", selectedStudentId ?? "", rolePreviewToken),
    enabled: Boolean(canReadPortal && selectedStudentId),
    refetchOnWindowFocus: false,
  });

  if (!canReadPortal) {
    return <AccessPanel title="Öğretmen Portalı" demoEmail="teacher-a@example.test" demoLabel="Demo öğretmen" />;
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
    const parsedForm = attendanceFormSchema.safeParse(attendanceForm);
    if (!parsedForm.success) {
      setActionError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const record = await createAttendance(auth.accessToken, parsedForm.data);
      queryClient.setQueryData<TeacherPortalData>(queryKey, (current) =>
        current ? { ...current, attendance: [record, ...current.attendance] } : current,
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

  return (
    <PortalFrame title="Öğretmen Portalı" subtitle={data?.teacher ? `${data.teacher.firstName} ${data.teacher.lastName}` : "Ders programı"}>
      <MetricGrid
        items={[
          { label: "Ders", value: data?.schedule.length ?? 0 },
          { label: "Öğrenci", value: students.length },
          { label: "Yoklama", value: data?.attendance.length ?? 0 },
          { label: "Ödev", value: data?.homework.length ?? 0 },
          { label: "Not", value: data?.teacherNotes.length ?? 0 },
          { label: "Destek", value: data?.supportTickets.length ?? 0 },
        ]}
      />
      {isRolePreview ? (
        <section className="next-list-panel" aria-label="Rol önizleme modu">
          <h2>Salt-okuma Önizleme</h2>
          <p>Bu ekran kurum yöneticisi için geçici rol önizleme modunda açıldı.</p>
        </section>
      ) : null}
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
      <TeacherTodaySchedulePanel
        classNames={classNameById}
        courseNames={courseNameById}
        lessons={todayLessons}
        nextLesson={nextLesson}
        termNames={termNameById}
      />
      <section className="next-list-panel" aria-label="Öğretmen öğrenci kapsamı">
        <h2>Öğrenciler</h2>
        <div className="next-segmented">
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
        </div>
      </section>
      {!isRolePreview ? (
      <section className="next-support-tools" aria-label="Öğretmen günlük işlemleri">
        <form className="next-support-tool" onSubmit={(event) => void submitAttendance(event)}>
          <h2>Yoklama</h2>
          <label>
            Öğrenci
            <select
              value={attendanceForm.studentId}
              onChange={(event) => selectStudent(event.target.value)}
              required
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {formatTeacherStudentLabel(student, classNameById)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tarih
            <Input
              type="date"
              required
              value={attendanceForm.date}
              onChange={(event) => setAttendanceForm((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
          <label>
            Yoklama branşı
            <select
              value={attendanceForm.courseId ?? ""}
              onChange={(event) => setAttendanceForm((current) => ({ ...current, courseId: event.target.value }))}
            >
              <option value="">Branş seçilmedi</option>
              {courseOptions.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Yoklama dönemi
            <select
              value={attendanceForm.termId ?? ""}
              onChange={(event) => setAttendanceForm((current) => ({ ...current, termId: event.target.value }))}
            >
              <option value="">Dönem seçilmedi</option>
              {termOptions.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Durum
            <select
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
            </select>
          </label>
          <Button disabled={!attendanceForm.studentId} type="submit">Yoklama kaydet</Button>
        </form>
        <form className="next-support-tool" onSubmit={(event) => void submitTeacherNote(event)}>
          <h2>Öğretmen Notu</h2>
          <label>
            Öğrenci
            <select value={noteForm.studentId} onChange={(event) => selectStudent(event.target.value)} required>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {formatTeacherStudentLabel(student, classNameById)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Not branşı
            <select
              value={noteForm.courseId ?? ""}
              onChange={(event) => setNoteForm((current) => ({ ...current, courseId: event.target.value }))}
            >
              <option value="">Branş seçilmedi</option>
              {courseOptions.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Not dönemi
            <select
              value={noteForm.termId ?? ""}
              onChange={(event) => setNoteForm((current) => ({ ...current, termId: event.target.value }))}
            >
              <option value="">Dönem seçilmedi</option>
              {termOptions.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Görünürlük
            <select
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
            </select>
          </label>
          <label>
            Gelişim durumu
            <Input
              value={noteForm.developmentStatus ?? ""}
              onChange={(event) => setNoteForm((current) => ({ ...current, developmentStatus: event.target.value }))}
            />
          </label>
          <label>
            Not
            <Input
              required
              value={noteForm.body}
              onChange={(event) => setNoteForm((current) => ({ ...current, body: event.target.value }))}
            />
          </label>
          <Button disabled={!noteForm.studentId} type="submit">Not ekle</Button>
        </form>
        <form className="next-support-tool" onSubmit={(event) => void submitMaterialAssignment(event)}>
          <h2>Materyal Atama</h2>
          <label>
            Öğrenci
            <select
              value={materialForm.studentId}
              onChange={(event) => selectStudent(event.target.value)}
              required
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {formatTeacherStudentLabel(student, classNameById)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Materyal
            <select
              value={materialForm.materialId}
              onChange={(event) => setMaterialForm((current) => ({ ...current, materialId: event.target.value }))}
              required
            >
              {(data?.materials ?? []).map((material) => (
                <option key={material.id} value={material.id}>
                  {material.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Teslim
            <Input
              type="date"
              value={materialForm.dueAt ?? ""}
              onChange={(event) => setMaterialForm((current) => ({ ...current, dueAt: event.target.value }))}
            />
          </label>
          <label>
            Materyal branşı
            <select
              value={materialForm.courseId ?? ""}
              onChange={(event) => setMaterialForm((current) => ({ ...current, courseId: event.target.value }))}
            >
              <option value="">Branş seçilmedi</option>
              {courseOptions.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Materyal dönemi
            <select
              value={materialForm.termId ?? ""}
              onChange={(event) => setMaterialForm((current) => ({ ...current, termId: event.target.value }))}
            >
              <option value="">Dönem seçilmedi</option>
              {termOptions.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Atama notu
            <Input
              value={materialForm.note ?? ""}
              onChange={(event) => setMaterialForm((current) => ({ ...current, note: event.target.value }))}
            />
          </label>
          <Button disabled={!materialForm.studentId || !materialForm.materialId} type="submit">Materyal ata</Button>
        </form>
      </section>
      ) : null}
      {actionError ? <p className="next-form-error">{actionError}</p> : null}
      <AnnouncementsPanel
        announcements={data?.announcements ?? []}
        readOnly={isRolePreview}
        onMarkRead={(announcement) =>
          auth && !isRolePreview ? markAnnouncementRead(auth.accessToken, `me/teacher/announcements/${encodeURIComponent(announcement.id)}/read`).then(() => query.refetch()) : undefined
        }
      />
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
                courseId: noteForm.courseId || attendanceForm.courseId || materialForm.courseId,
                gradeLevelId: selectedClass?.gradeLevelId ?? "",
                termId: noteForm.termId || attendanceForm.termId || materialForm.termId,
              }).then(() => query.refetch())
            : undefined
        }
      />
      <TeacherHomeworkPanel homework={data?.homework ?? []} onToggle={(homework) => void toggleHomeworkCheck(homework)} readOnly={isRolePreview} />
      <TeacherMaterialAssignmentsPanel
        assignments={(data?.materialAssignments ?? []).filter((assignment) => assignment.studentId === selectedStudentId)}
        courseNames={courseNameById}
        materials={data?.materials ?? []}
        students={students}
        termNames={termNameById}
      />
      <StudentHistoryPanel
        classHistory={historyQuery.data?.classHistory ?? []}
        enrollments={historyQuery.data?.enrollments ?? []}
        termNames={termNameById}
      />
      {historyQuery.isError ? <p className="next-form-error">Öğrenci geçmişi alınamadı.</p> : null}
      <ReportPanel
        context={reportQuery.data?.reportContext}
        courseNames={courseNameById}
        errorBooklet={reportQuery.data?.errorBooklet ?? null}
        progress={reportQuery.data?.progress ?? null}
        report={reportQuery.data?.report ?? null}
        termNames={termNameById}
      />
      {reportQuery.isError ? <p className="next-form-error">Öğrenci raporu alınamadı.</p> : null}
      <TeacherClassReportsPanel
        courseNames={courseNameById}
        reports={data?.classReports ?? []}
        termNames={termNameById}
      />
      <TeacherAttendancePanel records={data?.attendance ?? []} students={students} courseNames={courseNameById} termNames={termNameById} />
      <TeacherNotesPanel notes={data?.teacherNotes ?? []} students={students} courseNames={courseNameById} termNames={termNameById} />
      <section className="next-list-panel" aria-label="Ders programı">
        <h2>Program</h2>
        <table className="uh-data-table">
          <thead>
            <tr>
              <th>Ders</th>
              <th>Sınıf</th>
              <th>Branş</th>
              <th>Dönem</th>
              <th>Başlangıç</th>
              <th>Bitiş</th>
            </tr>
          </thead>
          <tbody>
            {(data?.schedule ?? []).map((lesson) => (
              <tr key={lesson.id}>
                <td>{lesson.title}</td>
                <td>{lesson.classId ? classNameById.get(lesson.classId) ?? lesson.classId : "-"}</td>
                <td>{lesson.courseId ? courseNameById.get(lesson.courseId) ?? lesson.courseId : "-"}</td>
                <td>{lesson.termId ? termNameById.get(lesson.termId) ?? lesson.termId : "-"}</td>
                <td>{formatDateTime(lesson.startsAt)}</td>
                <td>{formatDateTime(lesson.endsAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {query.isError ? <p className="next-form-error">Öğretmen portal verisi alınamadı.</p> : null}
    </PortalFrame>
  );
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL, rolePreviewToken = ""): Promise<T | null> {
  const response = await authenticatedFetch(accessToken, input, withRolePreview({}, rolePreviewToken));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("API_REQUEST_FAILED");
  return readData<T>(response);
}

async function loadTeacherPortal(accessToken: string, rolePreviewToken = ""): Promise<TeacherPortalData> {
  const [teacher, announcements, schedule, students, attendance, homework, materials, teacherNotes, supportTickets, snapshots, campuses, classes, courses, gradeLevels, terms] = await Promise.all([
    readOnlyRequest<TeacherRecord>(accessToken, `${apiBaseUrl}/me/teacher`, rolePreviewToken),
    readOnlyRequest<AnnouncementRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/announcements`, rolePreviewToken),
    readOnlyRequest<ScheduleLessonRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/schedule`, rolePreviewToken),
    readOnlyRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students`, rolePreviewToken),
    readOnlyRequest<AttendanceRecord[]>(accessToken, `${apiBaseUrl}/attendance`, rolePreviewToken),
    readOnlyRequest<HomeworkRecord[]>(accessToken, `${apiBaseUrl}/homework`, rolePreviewToken),
    readOnlyRequest<HomeworkMaterialRecord[]>(accessToken, `${apiBaseUrl}/homework/materials`, rolePreviewToken),
    readOnlyRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/teacher-notes`, rolePreviewToken),
    readOnlyRequest<SupportTicketRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/support-tickets`, rolePreviewToken),
    readOnlyRequest<ReportSnapshotRecord[]>(accessToken, `${apiBaseUrl}/exams/${portalExamId}/reports/snapshots`, rolePreviewToken),
    readOnlyRequest<CampusRecord[]>(accessToken, `${apiBaseUrl}/campuses`, rolePreviewToken),
    readOnlyRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`, rolePreviewToken),
    readOnlyRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`, rolePreviewToken),
    readOnlyRequest<GradeLevelRecord[]>(accessToken, `${apiBaseUrl}/grade-levels`, rolePreviewToken),
    readOnlyRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`, rolePreviewToken),
  ]);
  const materialAssignments = (
    await Promise.all(
      materials.map((material) =>
        readOnlyRequest<HomeworkMaterialAssignmentRecord[]>(
          accessToken,
          `${apiBaseUrl}/homework/materials/${encodeURIComponent(material.id)}/assignments`,
          rolePreviewToken,
        ),
      ),
    )
  ).flat();

  return {
    teacher,
    announcements,
    schedule,
    students,
    attendance,
    homework,
    materials,
    materialAssignments,
    campuses,
    classes,
    courses,
    gradeLevels,
    terms,
    classReports: selectTeacherClassReports(snapshots, students),
    supportTickets,
    teacherNotes,
  };
}

async function createAttendance(accessToken: string, input: AttendanceFormPayload) {
  return apiRequest<AttendanceRecord>(accessToken, `${apiBaseUrl}/attendance`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
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

async function loadTeacherStudentReport(accessToken: string, studentId: string, rolePreviewToken = ""): Promise<TeacherStudentReportData> {
  const snapshots = await readOnlyRequest<ReportSnapshotRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${portalExamId}/reports/snapshots`,
    rolePreviewToken,
  );
  const snapshot = selectLatestReadySnapshot(snapshots);
  if (!snapshot) {
    return { errorBooklet: null, progress: null, report: null };
  }

  const [report, errorBooklet, progress] = await Promise.all([
    apiRequestOrNull<ReportStudentSnapshot>(
      accessToken,
      `${apiBaseUrl}/exams/${portalExamId}/reports/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}`,
      rolePreviewToken,
    ),
    apiRequestOrNull<ReportErrorBooklet>(
      accessToken,
      `${apiBaseUrl}/exams/${portalExamId}/reports/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}/error-booklet`,
      rolePreviewToken,
    ),
    apiRequestOrNull<ReportStudentProgress>(
      accessToken,
      `${apiBaseUrl}/exams/${portalExamId}/reports/students/${encodeURIComponent(studentId)}/progress`,
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
  const [classHistory, enrollments] = await Promise.all([
    readOnlyRequest<StudentClassHistoryRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(studentId)}/class-history`, rolePreviewToken),
    readOnlyRequest<StudentEnrollmentRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(studentId)}/enrollments`, rolePreviewToken),
  ]);
  return { classHistory, enrollments };
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

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function toTime(value: string | undefined) {
  return value ? new Date(value).getTime() : 0;
}
