"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@uzman-hocam/ui";
import type {
  AttendanceRecord,
  AttendanceSummaryRecord,
  HomeworkMaterialAssignmentRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportErrorBooklet,
  ReportStudentProgress,
  ReportStudentSnapshot,
  ScheduleLessonRecord,
  StudentProfileRecord,
  StudentRecord,
  TeacherNoteRecord,
  TeacherRecord,
} from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetch, readData } from "../../src/api-client.js";
import { useAuth } from "../providers.js";

const portalExamId = "exam-demo";

export function StudentPortalPage() {
  const { auth } = useAuth();
  const query = useQuery({
    queryKey: ["next-student-portal", auth?.session.userId ?? "anonymous"],
    queryFn: () => loadStudentPortal(auth?.accessToken ?? ""),
    enabled: Boolean(auth && auth.session.subjectType === "STUDENT"),
    refetchOnWindowFocus: false,
  });

  if (auth?.session.subjectType !== "STUDENT") {
    return <AccessPanel title="Öğrenci Portalı" demoEmail="student-a@example.test" demoLabel="Demo öğrenci" />;
  }

  const data = query.data;
  return (
    <PortalFrame title="Öğrenci Portalı" subtitle={data?.profile ? `${data.profile.firstName} ${data.profile.lastName}` : "Öğrenci özeti"}>
      <MetricGrid
        items={[
          { label: "Toplam devamsızlık", value: data?.attendanceSummary.total ?? 0 },
          { label: "Geç kalma", value: data?.attendanceSummary.late ?? 0 },
          { label: "Not", value: data?.teacherNotes.length ?? 0 },
          { label: "Ödev", value: data?.homeworkAssignments.length ?? 0 },
          { label: "Net", value: formatNumber(data?.report?.total.net) },
        ]}
      />
      <ProfilePanel profile={data?.profile} />
      <HomeworkAssignmentsPanel assignments={data?.homeworkAssignments ?? []} />
      <ReportPanel
        errorBooklet={data?.errorBooklet ?? null}
        progress={data?.progress ?? null}
        report={data?.report ?? null}
      />
      <AttendancePanel records={data?.attendance ?? []} />
      <TeacherNotesPanel notes={data?.teacherNotes ?? []} />
      {query.isError ? <p className="next-form-error">Öğrenci portal verisi alınamadı.</p> : null}
    </PortalFrame>
  );
}

export function GuardianPortalPage() {
  const { auth } = useAuth();
  const studentsQuery = useQuery({
    queryKey: ["next-guardian-students", auth?.session.userId ?? "anonymous"],
    queryFn: () => apiRequest<StudentRecord[]>(auth?.accessToken ?? "", `${apiBaseUrl}/me/guardian/students`),
    enabled: Boolean(auth && auth.session.subjectType === "GUARDIAN"),
    refetchOnWindowFocus: false,
  });
  const students = studentsQuery.data ?? [];
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const resolvedStudentId = selectedStudentId ?? students[0]?.id;
  const studentQuery = useQuery({
    queryKey: ["next-guardian-portal", auth?.session.userId ?? "anonymous", resolvedStudentId ?? "none"],
    queryFn: () => loadGuardianStudentPortal(auth?.accessToken ?? "", resolvedStudentId ?? ""),
    enabled: Boolean(auth && auth.session.subjectType === "GUARDIAN" && resolvedStudentId),
    refetchOnWindowFocus: false,
  });
  const selectedStudent = useMemo(
    () => students.find((student) => student.id === resolvedStudentId),
    [resolvedStudentId, students],
  );

  if (auth?.session.subjectType !== "GUARDIAN") {
    return <AccessPanel title="Veli Portalı" demoEmail="guardian-a@example.test" demoLabel="Demo veli" />;
  }

  const data = studentQuery.data;
  return (
    <PortalFrame title="Veli Portalı" subtitle={selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "Bağlı öğrenci özeti"}>
      <div className="next-segmented" aria-label="Öğrenci seçimi">
        {students.map((student) => (
          <button
            aria-pressed={student.id === resolvedStudentId}
            key={student.id}
            onClick={() => setSelectedStudentId(student.id)}
            type="button"
          >
            {student.firstName} {student.lastName}
          </button>
        ))}
      </div>
      <MetricGrid
        items={[
          { label: "Devamsızlık", value: data?.attendanceSummary.total ?? 0 },
          { label: "Ödeme planı", value: data?.paymentPlans.length ?? 0 },
          { label: "Öğretmen notu", value: data?.teacherNotes.length ?? 0 },
          { label: "Ödev", value: data?.homeworkAssignments.length ?? 0 },
          { label: "Bekleyen ödeme", value: formatPendingPayment(data?.paymentPlans ?? []) },
        ]}
      />
      <ProfilePanel profile={data?.profile} />
      <HomeworkAssignmentsPanel assignments={data?.homeworkAssignments ?? []} />
      <ReportPanel
        errorBooklet={data?.errorBooklet ?? null}
        progress={data?.progress ?? null}
        report={data?.report ?? null}
      />
      <PaymentPlansPanel plans={data?.paymentPlans ?? []} />
      <TeacherNotesPanel notes={data?.teacherNotes ?? []} />
      <AttendancePanel records={data?.attendance ?? []} />
      {studentsQuery.isError || studentQuery.isError ? <p className="next-form-error">Veli portal verisi alınamadı.</p> : null}
    </PortalFrame>
  );
}

export function TeacherPortalPage() {
  const { auth } = useAuth();
  const query = useQuery({
    queryKey: ["next-teacher-portal", auth?.session.userId ?? "anonymous"],
    queryFn: () => loadTeacherPortal(auth?.accessToken ?? ""),
    enabled: Boolean(auth && auth.session.subjectType === "TEACHER"),
    refetchOnWindowFocus: false,
  });

  if (auth?.session.subjectType !== "TEACHER") {
    return <AccessPanel title="Öğretmen Portalı" demoEmail="teacher-a@example.test" demoLabel="Demo öğretmen" />;
  }

  const data = query.data;
  return (
    <PortalFrame title="Öğretmen Portalı" subtitle={data?.teacher ? `${data.teacher.firstName} ${data.teacher.lastName}` : "Ders programı"}>
      <MetricGrid
        items={[
          { label: "Ders", value: data?.schedule.length ?? 0 },
          { label: "Branş", value: data?.teacher.branch ?? "-" },
        ]}
      />
      <section className="next-list-panel" aria-label="Ders programı">
        <h2>Program</h2>
        <table className="uh-data-table">
          <thead>
            <tr>
              <th>Ders</th>
              <th>Başlangıç</th>
              <th>Bitiş</th>
            </tr>
          </thead>
          <tbody>
            {(data?.schedule ?? []).map((lesson) => (
              <tr key={lesson.id}>
                <td>{lesson.title}</td>
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

function PortalFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <>
      <header className="next-topbar">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </header>
      <div className="next-portal-stack">{children}</div>
    </>
  );
}

function AccessPanel({ title, demoEmail, demoLabel }: { title: string; demoEmail: string; demoLabel: string }) {
  const { login } = useAuth();
  const [error, setError] = useState("");

  async function previewAs() {
    setError("");
    try {
      await login(demoEmail, "password");
    } catch {
      setError("Demo girişi başarısız.");
    }
  }

  return (
    <PortalFrame title={title} subtitle="Bu portal kişiye özeldir; kurum hesabıyla içerik görünmez.">
      <section className="next-list-panel">
        <p className="next-status-note">
          Portalı görmek için ilgili kişi hesabıyla giriş yapın. Demo ortamda hızlı önizleme için aşağıdaki düğmeyi kullanın.
        </p>
        <div className="next-portal-preview-action">
          <Button onClick={() => void previewAs()}>{demoLabel} olarak önizle</Button>
        </div>
        <p className="next-status-note">Demo hesap: {demoEmail} / password</p>
        {error ? <p className="next-form-error">{error}</p> : null}
      </section>
    </PortalFrame>
  );
}

function MetricGrid({ items }: { items: Array<{ label: string; value: number | string }> }) {
  return (
    <section className="next-dashboard-grid" aria-label="Portal özeti">
      {items.map((item) => (
        <article className="next-metric" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </section>
  );
}

function ProfilePanel({ profile }: { profile?: StudentProfileRecord }) {
  return (
    <section className="next-list-panel" aria-label="Profil">
      <h2>Profil</h2>
      <dl className="next-definition-list">
        <div>
          <dt>Ad soyad</dt>
          <dd>{profile ? `${profile.firstName} ${profile.lastName}` : "-"}</dd>
        </div>
        <div>
          <dt>TC</dt>
          <dd>{profile?.nationalIdMasked ?? "-"}</dd>
        </div>
        <div>
          <dt>Telefon</dt>
          <dd>{profile?.phone ?? "-"}</dd>
        </div>
      </dl>
    </section>
  );
}

function AttendancePanel({ records }: { records: AttendanceRecord[] }) {
  return (
    <section className="next-list-panel" aria-label="Devamsızlık">
      <h2>Devamsızlık</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>{record.date}</td>
              <td>{record.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TeacherNotesPanel({ notes }: { notes: TeacherNoteRecord[] }) {
  return (
    <section className="next-list-panel" aria-label="Öğretmen notları">
      <h2>Öğretmen Notları</h2>
      <div className="next-note-list">
        {notes.map((note) => (
          <article key={note.id}>
            <strong>{note.developmentStatus ?? "Not"}</strong>
            <p>{note.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function HomeworkAssignmentsPanel({ assignments }: { assignments: HomeworkMaterialAssignmentRecord[] }) {
  return (
    <section className="next-list-panel" aria-label="Ödevler">
      <h2>Ödevler</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Materyal</th>
            <th>Not</th>
            <th>Teslim</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((assignment) => (
            <tr key={assignment.id}>
              <td>{assignment.materialId}</td>
              <td>{assignment.note ?? "-"}</td>
              <td>{assignment.dueAt ? formatDateTime(assignment.dueAt) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PaymentPlansPanel({ plans }: { plans: PaymentPlanWithInstallmentsRecord[] }) {
  return (
    <section className="next-list-panel" aria-label="Ödeme planları">
      <h2>Ödeme Planları</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Plan</th>
            <th>Tutar</th>
            <th>Taksit</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.id}>
              <td>{plan.title}</td>
              <td>{formatMoney(plan.totalAmount, plan.currency)}</td>
              <td>{plan.installments.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ReportPanel({
  errorBooklet,
  progress,
  report,
}: {
  errorBooklet: ReportErrorBooklet | null;
  progress: ReportStudentProgress | null;
  report: ReportStudentSnapshot | null;
}) {
  return (
    <section className="next-list-panel" aria-label="Sınav raporu">
      <h2>Sınav Raporu</h2>
      <dl className="next-definition-list">
        <div>
          <dt>Son net</dt>
          <dd>{formatNumber(report?.total.net)}</dd>
        </div>
        <div>
          <dt>Standart puan</dt>
          <dd>{formatNumber(report?.total.standardScore)}</dd>
        </div>
        <div>
          <dt>Net gelişimi</dt>
          <dd>{formatDelta(progress?.netDelta)}</dd>
        </div>
        <div>
          <dt>Hata kitapçığı</dt>
          <dd>{errorBooklet ? `${errorBooklet.items.length} soru` : "-"}</dd>
        </div>
      </dl>
    </section>
  );
}

async function loadStudentPortal(accessToken: string) {
  const [profile, homeworkAssignments, attendance, attendanceSummary, teacherNotes, report, errorBooklet, progress] = await Promise.all([
    apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/me/student/profile`),
    apiRequest<HomeworkMaterialAssignmentRecord[]>(
      accessToken,
      `${apiBaseUrl}/me/student/homework/material-assignments`,
    ),
    apiRequest<AttendanceRecord[]>(accessToken, `${apiBaseUrl}/me/student/attendance`),
    apiRequest<AttendanceSummaryRecord>(accessToken, `${apiBaseUrl}/me/student/attendance/summary`),
    apiRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/me/student/teacher-notes`),
    apiRequestOrNull<ReportStudentSnapshot>(accessToken, `${apiBaseUrl}/me/student/reports/${portalExamId}/latest`),
    apiRequestOrNull<ReportErrorBooklet>(
      accessToken,
      `${apiBaseUrl}/me/student/reports/${portalExamId}/latest/error-booklet`,
    ),
    apiRequestOrNull<ReportStudentProgress>(accessToken, `${apiBaseUrl}/me/student/reports/${portalExamId}/progress`),
  ]);

  return { profile, homeworkAssignments, attendance, attendanceSummary, teacherNotes, report, errorBooklet, progress };
}

async function loadGuardianStudentPortal(accessToken: string, studentId: string) {
  const [profile, homeworkAssignments, attendance, attendanceSummary, teacherNotes, paymentPlans, report, errorBooklet, progress] = await Promise.all([
    apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/profile`),
    apiRequest<HomeworkMaterialAssignmentRecord[]>(
      accessToken,
      `${apiBaseUrl}/me/guardian/homework/material-assignments`,
    ),
    apiRequest<AttendanceRecord[]>(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/attendance`),
    apiRequest<AttendanceSummaryRecord>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/attendance/summary`,
    ),
    apiRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/teacher-notes`),
    apiRequestOrEmptyPaymentPlans(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/payment-plans`,
    ),
    apiRequestOrNull<ReportStudentSnapshot>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/reports/${portalExamId}/latest`,
    ),
    apiRequestOrNull<ReportErrorBooklet>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/reports/${portalExamId}/latest/error-booklet`,
    ),
    apiRequestOrNull<ReportStudentProgress>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/reports/${portalExamId}/progress`,
    ),
  ]);

  return {
    profile,
    homeworkAssignments: homeworkAssignments.filter((assignment) => assignment.studentId === studentId),
    attendance,
    attendanceSummary,
    teacherNotes,
    paymentPlans,
    report,
    errorBooklet,
    progress,
  };
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL): Promise<T | null> {
  const response = await authenticatedFetch(accessToken, input);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("API_REQUEST_FAILED");
  return readData<T>(response);
}

async function apiRequestOrEmptyPaymentPlans(accessToken: string, input: RequestInfo | URL): Promise<PaymentPlanWithInstallmentsRecord[]> {
  const response = await authenticatedFetch(accessToken, input);
  if (response.status === 403 || response.status === 404) return [];
  if (!response.ok) throw new Error("API_REQUEST_FAILED");
  return readData<PaymentPlanWithInstallmentsRecord[]>(response);
}

async function loadTeacherPortal(accessToken: string) {
  const [teacher, schedule] = await Promise.all([
    apiRequest<TeacherRecord>(accessToken, `${apiBaseUrl}/me/teacher`),
    apiRequest<ScheduleLessonRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/schedule`),
  ]);

  return { teacher, schedule };
}

function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${currency}`;
}

function formatPendingPayment(plans: PaymentPlanWithInstallmentsRecord[]) {
  const total = plans.reduce(
    (sum, plan) =>
      sum + plan.installments
        .filter((installment) => installment.status === "PENDING" || installment.status === "OVERDUE")
        .reduce((installmentSum, installment) => installmentSum + installment.amount, 0),
    0,
  );
  return formatMoney(total, plans[0]?.currency ?? "TRY");
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function formatDelta(value: number | undefined) {
  if (value === undefined) return "-";
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
