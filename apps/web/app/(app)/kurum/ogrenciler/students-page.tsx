"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import type {
  AttendanceSummaryRecord,
  ClassRecord,
  GuardianRecord,
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportErrorBooklet,
  ReportSnapshotRecord,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentClassHistoryRecord,
  StudentProfileRecord,
  StudentRecord,
  TeacherNoteRecord,
  TeacherRecord,
} from "@uzman-hocam/shared-types";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  firstFormError,
  studentFormSchema,
  type StudentFormPayload,
  type StudentFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

interface StudentProfilePayload {
  nationalId?: string;
  phone?: string;
  email?: string;
  birthDate?: string;
}

interface StudentDetail {
  attendanceSummary: AttendanceSummaryRecord | null;
  errorBooklet: ReportErrorBooklet | null;
  profile: StudentProfileRecord;
  guardians: GuardianRecord[];
  homeworkAssignments: HomeworkMaterialAssignmentRecord[];
  paymentPlans: PaymentPlanWithInstallmentsRecord[];
  progress: ReportStudentProgress | null;
  report: ReportStudentSnapshot | null;
  classHistory: StudentClassHistoryRecord[];
  teacherNotes: TeacherNoteRecord[];
}

interface StudentListFilters {
  classId: string;
  level: string;
  responsibleTeacherId: string;
  status: "" | StudentRecord["status"];
  guardianLinked: "" | "true" | "false";
}

const emptyForm: StudentFormState = {
  firstName: "",
  lastName: "",
  classId: "",
  responsibleTeacherId: "",
  status: "ACTIVE",
  nationalId: "",
  phone: "",
  email: "",
  birthDate: "",
  guardianFirstName: "",
  guardianLastName: "",
  guardianPhone: "",
};

const emptyFilters: StudentListFilters = {
  classId: "",
  level: "",
  responsibleTeacherId: "",
  status: "",
  guardianLinked: "",
};

export function StudentsPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const [filters, setFilters] = useState<StudentListFilters>(emptyFilters);
  const queryKey = ["next-students", auth?.session.tenantId ?? "anonymous", listQuery, filters];
  const listQueryKey = ["next-students", auth?.session.tenantId ?? "anonymous"];
  const studentsQuery = useQuery({
    queryKey,
    queryFn: () => loadStudents(auth?.accessToken ?? "", listQuery, filters),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [form, setForm] = useState<StudentFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const rows = studentsQuery.data?.data ?? [];

  const detailQuery = useQuery({
    queryKey: ["next-student-detail", auth?.session.tenantId ?? "anonymous", editingStudent?.id ?? "none"],
    queryFn: () => loadStudentDetail(auth?.accessToken ?? "", editingStudent?.id ?? ""),
    enabled: Boolean(auth && editingStudent),
    refetchOnWindowFocus: false,
  });
  const detail = editingStudent ? detailQuery.data : undefined;

  const classesQuery = useQuery({
    queryKey: ["next-classes", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadClasses(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const classes = classesQuery.data ?? [];
  const classNameById = new Map(classes.map((klass) => [klass.id, klass.name]));
  const levels = [...new Set(classes.map((klass) => klass.level).filter((level): level is string => Boolean(level)))].sort();

  const teachersQuery = useQuery({
    queryKey: ["next-teachers", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadTeachers(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const teachers = teachersQuery.data ?? [];
  const teacherNameById = new Map(teachers.map((teacher) => [teacher.id, `${teacher.firstName} ${teacher.lastName}`]));

  const columns: Array<DataTableColumn<StudentRecord>> = [
    {
      key: "name",
      header: "Ad Soyad",
      render: (student) => `${student.firstName} ${student.lastName}`,
    },
    {
      key: "class",
      header: "Sınıf",
      render: (student) => (student.classId ? (classNameById.get(student.classId) ?? "—") : "—"),
    },
    {
      key: "responsibleTeacher",
      header: "Sorumlu öğretmen",
      render: (student) =>
        student.responsibleTeacherId ? (teacherNameById.get(student.responsibleTeacherId) ?? "—") : "—",
    },
    {
      key: "status",
      header: "Durum",
      render: (student) => formatStudentStatus(student.status),
    },
    {
      key: "actions",
      header: "İşlem",
      render: (student) => (
        <span className="next-row-actions">
          <Link href={`/kurum/ogrenciler/${encodeURIComponent(student.id)}`} aria-label={`${student.firstName} 360 detay`}>
            <Eye size={17} aria-hidden="true" />
          </Link>
          <button type="button" onClick={() => openEditForm(student)} aria-label={`${student.firstName} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(student)} aria-label={`${student.firstName} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingStudent(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function updateFilters(nextFilters: StudentListFilters) {
    setFilters(nextFilters);
    setListQuery((current) => ({ ...current, page: 1 }));
  }

  function openEditForm(student: StudentRecord) {
    setEditingStudent(student);
    setForm({
      ...emptyForm,
      firstName: student.firstName,
      lastName: student.lastName,
      classId: student.classId ?? "",
      responsibleTeacherId: student.responsibleTeacherId ?? "",
      status: student.status,
    });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingStudent(null);
    setForm(emptyForm);
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || isSaving) return;

    const wasEditing = editingStudent;
    setError("");
    const parsedForm = studentFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    setIsSaving(true);
    try {
      const studentForm = parsedForm.data;
      const savedStudent = wasEditing
        ? await updateStudent(auth.accessToken, wasEditing.id, {
            firstName: studentForm.firstName,
            lastName: studentForm.lastName,
            classId: studentForm.classId,
            responsibleTeacherId: studentForm.responsibleTeacherId,
            status: studentForm.status,
          })
        : await createStudent(auth.accessToken, {
            firstName: studentForm.firstName,
            lastName: studentForm.lastName,
            classId: studentForm.classId || undefined,
            responsibleTeacherId: studentForm.responsibleTeacherId || undefined,
            status: studentForm.status,
          });

      if (!wasEditing) {
        setEditingStudent(savedStudent);
      }
      void queryClient.invalidateQueries({ queryKey: listQueryKey });

      const profilePayload = buildProfilePayload(studentForm);
      if (profilePayload) {
        await updateStudentProfile(auth.accessToken, savedStudent.id, profilePayload);
      }

      if (studentForm.guardianFirstName) {
        const guardian = await createGuardian(auth.accessToken, {
          firstName: studentForm.guardianFirstName,
          lastName: studentForm.guardianLastName,
          phone: studentForm.guardianPhone || undefined,
        });
        await linkGuardian(auth.accessToken, guardian.id, savedStudent.id);
        void queryClient.invalidateQueries({ queryKey: ["next-guardians"] });
      }

      void queryClient.invalidateQueries({ queryKey: ["next-student-detail"] });
      closeForm();
    } catch {
      setError("Öğrenci kaydedilemedi. TC geçerli ve benzersiz olmalı, e-posta geçerli olmalı, kota dolmamalı.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(student: StudentRecord) {
    if (!auth) return;
    if (!window.confirm(`${student.firstName} ${student.lastName} silinsin mi?`)) return;

    setError("");
    try {
      await deleteStudent(auth.accessToken, student.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Öğrenci silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={studentsQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={studentSortOptions}
              state={listQuery}
            />
            <div className="next-list-controls" aria-label="Öğrenci filtreleri">
              <label>
                Sınıf
                <select
                  value={filters.classId}
                  onChange={(event) => updateFilters({ ...filters, classId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {classes.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Seviye
                <select
                  value={filters.level}
                  onChange={(event) => updateFilters({ ...filters, level: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {levels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sorumlu
                <select
                  value={filters.responsibleTeacherId}
                  onChange={(event) => updateFilters({ ...filters, responsibleTeacherId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.firstName} {teacher.lastName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Durum
                <select
                  value={filters.status}
                  onChange={(event) => updateFilters({
                    ...filters,
                    status: event.target.value as StudentListFilters["status"],
                  })}
                >
                  <option value="">Tümü</option>
                  <option value="ACTIVE">Aktif</option>
                  <option value="PASSIVE">Pasif</option>
                </select>
              </label>
              <label>
                Veli
                <select
                  value={filters.guardianLinked}
                  onChange={(event) => updateFilters({
                    ...filters,
                    guardianLinked: event.target.value as StudentListFilters["guardianLinked"],
                  })}
                >
                  <option value="">Tümü</option>
                  <option value="true">Bağlı</option>
                  <option value="false">Bağlı değil</option>
                </select>
              </label>
            </div>
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Öğrenci ekle
            </Button>
          </>
        }
        aria-label="Öğrenci yönetimi"
        columns={columns}
        description="Kurum öğrencilerini listele; ad-soyad, TC, iletişim ve veli bilgileriyle ekle veya düzenle."
        emptyText="Öğrenci kaydı yok"
        error={error || (studentsQuery.isError ? "Öğrenciler alınamadı." : undefined)}
        getRowKey={(student) => student.id}
        loading={studentsQuery.isPending}
        rows={rows}
        title="Öğrenciler"
      />
      <FormModal
        description="Ad ve soyad zorunludur. Diğer alanlar opsiyoneldir."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={isSaving ? "Kaydediliyor…" : editingStudent ? "Kaydet" : "Ekle"}
        title={editingStudent ? "Öğrenci düzenle" : "Öğrenci ekle"}
      >
        <label>
          Ad
          <Input
            required
            value={form.firstName}
            onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
          />
        </label>
        <label>
          Soyad
          <Input
            required
            value={form.lastName}
            onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
          />
        </label>
        <label>
          Sınıf
          <select
            value={form.classId}
            onChange={(event) => setForm((current) => ({ ...current, classId: event.target.value }))}
          >
            <option value="">Sınıfsız</option>
            {classes.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sorumlu öğretmen
          <select
            value={form.responsibleTeacherId}
            onChange={(event) => setForm((current) => ({ ...current, responsibleTeacherId: event.target.value }))}
          >
            <option value="">Atanmadı</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.firstName} {teacher.lastName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kayıt durumu
          <select
            value={form.status}
            onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as StudentRecord["status"] }))}
          >
            <option value="ACTIVE">Aktif</option>
            <option value="PASSIVE">Pasif</option>
          </select>
        </label>
        <label>
          TC Kimlik No
          <Input
            inputMode="numeric"
            maxLength={11}
            value={form.nationalId}
            onChange={(event) => setForm((current) => ({ ...current, nationalId: event.target.value }))}
          />
          {detail?.profile.nationalIdMasked ? (
            <span className="next-field-hint">Kayıtlı: {detail.profile.nationalIdMasked}</span>
          ) : null}
        </label>
        <label>
          Telefon
          <Input
            inputMode="tel"
            value={form.phone}
            onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
          />
          {detail?.profile.phone ? <span className="next-field-hint">Kayıtlı: {detail.profile.phone}</span> : null}
        </label>
        <label>
          E-posta
          <Input
            type="email"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          />
          {detail?.profile.email ? <span className="next-field-hint">Kayıtlı: {detail.profile.email}</span> : null}
        </label>
        <label>
          Doğum tarihi
          <Input
            type="date"
            value={form.birthDate}
            onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))}
          />
          {detail?.profile.birthDate ? (
            <span className="next-field-hint">Kayıtlı: {detail.profile.birthDate}</span>
          ) : null}
        </label>
        <div className="next-form-section">
          <p className="next-form-section-title">Veli</p>
          {editingStudent ? (
            <div className="next-form-guardians">
              <span className="next-field-hint">Bağlı veliler</span>
              {detail && detail.guardians.length > 0 ? (
                <ul>
                  {detail.guardians.map((guardian) => (
                    <li key={guardian.id}>
                      {guardian.firstName} {guardian.lastName}
                      {guardian.phone ? ` · ${guardian.phone}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="next-field-hint">{detailQuery.isPending ? "Yükleniyor…" : "Bağlı veli yok"}</span>
              )}
            </div>
          ) : null}
          <label>
            Veli adı
            <Input
              value={form.guardianFirstName}
              onChange={(event) => setForm((current) => ({ ...current, guardianFirstName: event.target.value }))}
            />
          </label>
          <label>
            Veli soyadı
            <Input
              value={form.guardianLastName}
              onChange={(event) => setForm((current) => ({ ...current, guardianLastName: event.target.value }))}
            />
          </label>
          <label>
            Veli telefonu
            <Input
              inputMode="tel"
              value={form.guardianPhone}
              onChange={(event) => setForm((current) => ({ ...current, guardianPhone: event.target.value }))}
            />
          </label>
        </div>
        {editingStudent ? <StudentDetailPanel detail={detail} loading={detailQuery.isPending} /> : null}
      </FormModal>
    </>
  );
}

function StudentDetailPanel({ detail, loading }: { detail?: StudentDetail; loading: boolean }) {
  if (loading) {
    return (
      <section className="next-form-section" aria-label="Öğrenci 360">
        <p className="next-form-section-title">Öğrenci 360</p>
        <span className="next-field-hint">Yükleniyor…</span>
      </section>
    );
  }

  return (
    <section className="next-form-section" aria-label="Öğrenci 360">
      <p className="next-form-section-title">Öğrenci 360</p>
      <dl className="next-definition-list">
        <div>
          <dt>Kayıt durumu</dt>
          <dd>{detail?.profile.status ? formatStudentStatus(detail.profile.status) : "-"}</dd>
        </div>
        <div>
          <dt>Devamsızlık</dt>
          <dd>{detail?.attendanceSummary?.total ?? 0}</dd>
        </div>
        <div>
          <dt>Öğretmen notu</dt>
          <dd>{detail?.teacherNotes.length ?? 0}</dd>
        </div>
        <div>
          <dt>Ödev</dt>
          <dd>{detail?.homeworkAssignments.length ?? 0}</dd>
        </div>
        <div>
          <dt>Bekleyen ödeme</dt>
          <dd>{formatPendingPayment(detail?.paymentPlans ?? [])}</dd>
        </div>
        <div>
          <dt>Son net</dt>
          <dd>{formatNumber(detail?.report?.total.net)}</dd>
        </div>
        <div>
          <dt>Hata kitapçığı</dt>
          <dd>{detail?.errorBooklet ? `${detail.errorBooklet.items.length} soru` : "-"}</dd>
        </div>
        <div>
          <dt>Net gelişimi</dt>
          <dd>{formatDelta(detail?.progress?.netDelta)}</dd>
        </div>
      </dl>
      {detail && detail.teacherNotes.length > 0 ? (
        <div className="next-form-guardians">
          <span className="next-field-hint">Son öğretmen notu</span>
          <ul>
            <li>{detail.teacherNotes[0]?.body}</li>
          </ul>
        </div>
      ) : null}
      {detail && detail.classHistory.length > 0 ? (
        <div className="next-form-guardians">
          <span className="next-field-hint">Sınıf geçmişi</span>
          <ul>
            {detail.classHistory.map((record) => (
              <li key={record.id}>
                {record.classId ?? "Sınıfsız"} · {formatDate(record.startsAt)}
                {record.endsAt ? ` - ${formatDate(record.endsAt)}` : " - devam ediyor"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function buildProfilePayload(form: StudentFormPayload): StudentProfilePayload | null {
  const payload: StudentProfilePayload = {};
  if (form.nationalId.trim()) payload.nationalId = form.nationalId.trim();
  if (form.phone.trim()) payload.phone = form.phone.trim();
  if (form.email.trim()) payload.email = form.email.trim();
  if (form.birthDate.trim()) payload.birthDate = form.birthDate.trim();
  return Object.keys(payload).length > 0 ? payload : null;
}

const studentSortOptions = [
  { label: "Ad A-Z", value: "firstName" },
  { label: "Ad Z-A", value: "-firstName" },
  { label: "Soyad A-Z", value: "lastName" },
  { label: "Soyad Z-A", value: "-lastName" },
  { label: "Sınıf A-Z", value: "classId" },
  { label: "Sınıf Z-A", value: "-classId" },
];

async function loadStudents(accessToken: string, listQuery: ListQueryState, filters: StudentListFilters) {
  return apiListRequest<StudentRecord>(accessToken, buildStudentListUrl(`${apiBaseUrl}/students`, listQuery, filters));
}

function buildStudentListUrl(baseUrl: string, state: ListQueryState, filters: StudentListFilters): string {
  const url = new URL(buildListUrl(baseUrl, state));
  if (filters.classId) url.searchParams.set("classId", filters.classId);
  if (filters.level) url.searchParams.set("level", filters.level);
  if (filters.responsibleTeacherId) url.searchParams.set("responsibleTeacherId", filters.responsibleTeacherId);
  if (filters.status) url.searchParams.set("status", filters.status);
  if (filters.guardianLinked) url.searchParams.set("guardianLinked", filters.guardianLinked);
  return url.toString();
}

async function loadClasses(accessToken: string) {
  return apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`);
}

async function loadTeachers(accessToken: string) {
  return apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`);
}

async function loadStudentDetail(accessToken: string, id: string): Promise<StudentDetail> {
  const [
    attendanceSummary,
    errorBooklet,
    profile,
    guardians,
    homeworkAssignments,
    paymentPlans,
    progress,
    report,
    classHistory,
    teacherNotes,
  ] = await Promise.all([
    apiRequestOrNull<AttendanceSummaryRecord>(accessToken, `${apiBaseUrl}/attendance/summary?studentId=${encodeURIComponent(id)}`),
    loadLatestErrorBooklet(accessToken, id),
    apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/profile`),
    apiRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardians`),
    loadStudentHomeworkAssignments(accessToken, id),
    apiRequest<PaymentPlanWithInstallmentsRecord[]>(accessToken, `${apiBaseUrl}/payment-plans?studentId=${encodeURIComponent(id)}`),
    apiRequestOrNull<ReportStudentProgress>(accessToken, `${apiBaseUrl}/exams/exam-demo/reports/students/${encodeURIComponent(id)}/progress`),
    loadLatestStudentReport(accessToken, id),
    apiRequest<StudentClassHistoryRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/class-history`),
    apiRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/teacher-notes?studentId=${encodeURIComponent(id)}`),
  ]);
  return {
    attendanceSummary,
    errorBooklet,
    guardians,
    homeworkAssignments,
    paymentPlans,
    profile,
    progress,
    report,
    classHistory,
    teacherNotes,
  };
}

async function loadStudentHomeworkAssignments(accessToken: string, studentId: string) {
  const materials = await apiRequest<HomeworkMaterialRecord[]>(accessToken, `${apiBaseUrl}/homework/materials`);
  const assignmentLists = await Promise.all(
    materials.map((material) =>
      apiRequest<HomeworkMaterialAssignmentRecord[]>(
        accessToken,
        `${apiBaseUrl}/homework/materials/${encodeURIComponent(material.id)}/assignments`,
      ),
    ),
  );
  return assignmentLists.flat().filter((assignment) => assignment.studentId === studentId);
}

async function loadLatestStudentReport(accessToken: string, studentId: string): Promise<ReportStudentSnapshot | null> {
  const snapshot = await loadLatestSnapshot(accessToken, studentId);
  if (!snapshot) return null;
  return apiRequestOrNull<ReportStudentSnapshot>(
    accessToken,
    `${apiBaseUrl}/exams/exam-demo/reports/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}`,
  );
}

async function loadLatestErrorBooklet(accessToken: string, studentId: string): Promise<ReportErrorBooklet | null> {
  const snapshot = await loadLatestSnapshot(accessToken, studentId);
  if (!snapshot) return null;
  return apiRequestOrNull<ReportErrorBooklet>(
    accessToken,
    `${apiBaseUrl}/exams/exam-demo/reports/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}/error-booklet`,
  );
}

async function loadLatestSnapshot(accessToken: string, studentId: string): Promise<ReportSnapshotRecord | null> {
  const snapshots = await apiRequest<ReportSnapshotRecord[]>(accessToken, `${apiBaseUrl}/exams/exam-demo/reports/snapshots`);
  return snapshots.find((snapshot) =>
    snapshot.status === "READY" && snapshot.snapshotData?.students?.some((student) => student.studentId === studentId),
  ) ?? null;
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL): Promise<T | null> {
  try {
    return await apiRequest<T>(accessToken, input);
  } catch {
    return null;
  }
}

async function createStudent(
  accessToken: string,
  input: { firstName: string; lastName: string; classId?: string; responsibleTeacherId?: string; status: StudentRecord["status"] },
) {
  return apiRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateStudent(
  accessToken: string,
  id: string,
  input: { firstName: string; lastName: string; classId?: string; responsibleTeacherId?: string; status: StudentRecord["status"] },
) {
  return apiRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function updateStudentProfile(accessToken: string, id: string, input: StudentProfilePayload) {
  return apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/profile`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function createGuardian(
  accessToken: string,
  input: { firstName: string; lastName: string; phone?: string },
) {
  return apiRequest<GuardianRecord>(accessToken, `${apiBaseUrl}/guardians`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function linkGuardian(accessToken: string, guardianId: string, studentId: string) {
  await apiRequest<unknown>(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(guardianId)}/students`, {
    body: JSON.stringify({ studentId }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function deleteStudent(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("STUDENT_DELETE_FAILED");
  }
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

function formatStudentStatus(status: StudentRecord["status"]) {
  return status === "PASSIVE" ? "Pasif" : "Aktif";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("tr-TR");
}
