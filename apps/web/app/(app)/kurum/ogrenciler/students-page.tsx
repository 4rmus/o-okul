"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
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
  StudentEnrollmentRecord,
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
  enrollments: StudentEnrollmentRecord[];
  teacherNotes: TeacherNoteRecord[];
}

interface StudentListFilters {
  classId: string;
  level: string;
  responsibleTeacherId: string;
  status: "" | StudentRecord["status"];
  guardianLinked: "" | "true" | "false";
}

interface StudentReferences {
  classes: ClassRecord[];
  teachers: TeacherRecord[];
}

interface EnrollmentActionState {
  startsAt: string;
  classId: string;
}

interface BulkEnrollmentActionState extends EnrollmentActionState {
  studentIds: string[];
  classIdBySourceClassId: Record<string, string>;
  useAutomaticClassMapping: boolean;
}

const studentColumnKeys = ["studentNo", "name", "class", "responsibleTeacher", "status", "actions"] as const;

type StudentColumnKey = typeof studentColumnKeys[number];
type StudentTableDensity = "comfortable" | "compact";

interface QueryParamReader {
  get(name: string): string | null;
}

const requiredStudentColumnKeys = new Set<StudentColumnKey>(["name", "actions"]);
const defaultVisibleStudentColumnKeys = [...studentColumnKeys];
const studentPageLimits = [5, 10, 20];

const studentColumnOptions: Array<{ key: StudentColumnKey; label: string }> = [
  { key: "studentNo", label: "Okul No" },
  { key: "name", label: "Ad Soyad" },
  { key: "class", label: "Sınıf" },
  { key: "responsibleTeacher", label: "Sorumlu" },
  { key: "status", label: "Durum" },
  { key: "actions", label: "İşlem" },
];

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

const emptyEnrollmentAction: EnrollmentActionState = {
  startsAt: "",
  classId: "",
};

const emptyBulkEnrollmentAction: BulkEnrollmentActionState = {
  startsAt: "",
  classId: "",
  studentIds: [],
  classIdBySourceClassId: {},
  useAutomaticClassMapping: false,
};

export function StudentsPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(() => readStudentListQuery(searchParams));
  const [filters, setFilters] = useState<StudentListFilters>(() => readStudentFilters(searchParams));
  const [tableDensity, setTableDensity] = useState<StudentTableDensity>(() => readStudentTableDensity(searchParams));
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<StudentColumnKey[]>(() => readVisibleStudentColumnKeys(searchParams));
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
  const [isEnrollmentSaving, setIsEnrollmentSaving] = useState(false);
  const [isBulkEnrollmentSaving, setIsBulkEnrollmentSaving] = useState(false);
  const [enrollmentAction, setEnrollmentAction] = useState<EnrollmentActionState>(emptyEnrollmentAction);
  const [bulkEnrollmentAction, setBulkEnrollmentAction] = useState<BulkEnrollmentActionState>({
    ...emptyBulkEnrollmentAction,
    startsAt: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState("");
  const rows = studentsQuery.data?.data ?? [];
  const sourceClassIds = [...new Set(rows.map((student) => student.classId).filter((classId): classId is string => Boolean(classId)))].sort();

  const detailQuery = useQuery({
    queryKey: ["next-student-detail", auth?.session.tenantId ?? "anonymous", editingStudent?.id ?? "none"],
    queryFn: () => loadStudentDetail(auth?.accessToken ?? "", editingStudent?.id ?? ""),
    enabled: Boolean(auth && editingStudent),
    refetchOnWindowFocus: false,
  });
  const detail = editingStudent ? detailQuery.data : undefined;

  const referencesQuery = useQuery({
    queryKey: ["next-student-refs", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadStudentReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const classes = referencesQuery.data?.classes ?? [];
  const classNameById = new Map(classes.map((klass) => [klass.id, klass.name]));
  const levels = [...new Set(classes.map((klass) => klass.level).filter((level): level is string => Boolean(level)))].sort();

  const teachers = referencesQuery.data?.teachers ?? [];
  const teacherNameById = new Map(teachers.map((teacher) => [teacher.id, `${teacher.firstName} ${teacher.lastName}`]));

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  useEffect(() => {
    writeStudentListQuery({ filters, listQuery, tableDensity, visibleColumnKeys });
  }, [filters, listQuery, tableDensity, visibleColumnKeys]);

  const columns: Array<DataTableColumn<StudentRecord> & { key: StudentColumnKey }> = [
    {
      key: "studentNo",
      header: "Okul No",
      render: (student) => student.studentNo ?? "—",
    },
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
  const visibleColumns = columns.filter((column) => visibleColumnKeys.includes(column.key));
  const pageClassName = tableDensity === "compact" ? "next-students-page next-students-page--compact" : "next-students-page";

  function openCreateForm() {
    setEditingStudent(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function toggleColumn(key: StudentColumnKey, checked: boolean) {
    if (requiredStudentColumnKeys.has(key)) return;
    setVisibleColumnKeys((current) => sortStudentColumnKeys(checked ? [...current, key] : current.filter((columnKey) => columnKey !== key)));
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
    setEnrollmentAction({
      startsAt: new Date().toISOString().slice(0, 10),
      classId: student.classId ?? "",
    });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingStudent(null);
    setForm(emptyForm);
    setEnrollmentAction(emptyEnrollmentAction);
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

  async function handleRenewEnrollment() {
    if (!auth || !editingStudent || isEnrollmentSaving) return;

    setError("");
    setIsEnrollmentSaving(true);
    try {
      await renewStudentEnrollment(auth.accessToken, editingStudent.id, {
        classId: enrollmentAction.classId,
        startsAt: enrollmentAction.startsAt,
      });
      setForm((current) => ({ ...current, classId: enrollmentAction.classId, status: "ACTIVE" }));
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-student-detail"] });
    } catch {
      setError("Kayıt yenileme yapılamadı.");
    } finally {
      setIsEnrollmentSaving(false);
    }
  }

  async function handleTransferEnrollment() {
    if (!auth || !editingStudent || isEnrollmentSaving) return;

    setError("");
    setIsEnrollmentSaving(true);
    try {
      await transferStudentEnrollment(auth.accessToken, editingStudent.id, {
        classId: enrollmentAction.classId,
        startsAt: enrollmentAction.startsAt,
      });
      setForm((current) => ({
        ...current,
        classId: enrollmentAction.classId,
        status: enrollmentAction.classId ? "ACTIVE" : "TRANSFERRED",
      }));
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-student-detail"] });
    } catch {
      setError("Nakil işlemi yapılamadı.");
    } finally {
      setIsEnrollmentSaving(false);
    }
  }

  async function handleBulkRenewEnrollment() {
    if (!auth || isBulkEnrollmentSaving || rows.length === 0) return;

    setError("");
    setIsBulkEnrollmentSaving(true);
    try {
      await bulkRenewStudentEnrollments(auth.accessToken, {
        classId: bulkEnrollmentAction.classId,
        classIdBySourceClassId: Object.fromEntries(
          Object.entries(bulkEnrollmentAction.classIdBySourceClassId).filter(([, classId]) => Boolean(classId)),
        ),
        startsAt: bulkEnrollmentAction.startsAt,
        studentIds: rows.map((student) => student.id),
        useAutomaticClassMapping: bulkEnrollmentAction.useAutomaticClassMapping,
      });
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-student-detail"] });
    } catch {
      setError("Toplu dönem geçişi yapılamadı.");
    } finally {
      setIsBulkEnrollmentSaving(false);
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
                  <option value="GRADUATED">Mezun</option>
                  <option value="TRANSFERRED">Nakil</option>
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
            <div className="next-list-controls" aria-label="Öğrenci tablo görünümü">
              <fieldset className="next-column-picker">
                <legend>Kolonlar</legend>
                {studentColumnOptions.map((option) => (
                  <label key={option.key}>
                    <input
                      type="checkbox"
                      checked={visibleColumnKeys.includes(option.key)}
                      disabled={requiredStudentColumnKeys.has(option.key)}
                      onChange={(event) => toggleColumn(option.key, event.target.checked)}
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
              <label>
                Görünüm
                <select value={tableDensity} onChange={(event) => setTableDensity(event.target.value as StudentTableDensity)}>
                  <option value="comfortable">Rahat</option>
                  <option value="compact">Yoğun</option>
                </select>
              </label>
            </div>
            <div className="next-list-controls" aria-label="Toplu dönem geçişi">
              <label>
                Geçiş tarihi
                <Input
                  type="date"
                  value={bulkEnrollmentAction.startsAt}
                  onChange={(event) => setBulkEnrollmentAction((current) => ({ ...current, startsAt: event.target.value }))}
                />
              </label>
              <label>
                Hedef sınıf
                <select
                  value={bulkEnrollmentAction.classId}
                  onChange={(event) => setBulkEnrollmentAction((current) => ({ ...current, classId: event.target.value }))}
                >
                  <option value="">Sınıfsız</option>
                  {classes.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="next-checkbox-row">
                <input
                  type="checkbox"
                  checked={bulkEnrollmentAction.useAutomaticClassMapping}
                  onChange={(event) => setBulkEnrollmentAction((current) => ({ ...current, useAutomaticClassMapping: event.target.checked }))}
                />
                Otomatik seviye yükselt
              </label>
              {sourceClassIds.map((sourceClassId) => (
                <label key={sourceClassId}>
                  {(classNameById.get(sourceClassId) ?? sourceClassId)} hedefi
                  <select
                    value={bulkEnrollmentAction.classIdBySourceClassId[sourceClassId] ?? ""}
                    onChange={(event) => setBulkEnrollmentAction((current) => ({
                      ...current,
                      classIdBySourceClassId: {
                        ...current.classIdBySourceClassId,
                        [sourceClassId]: event.target.value,
                      },
                    }))}
                  >
                    <option value="">Varsayılan</option>
                    {classes.map((klass) => (
                      <option key={klass.id} value={klass.id}>
                        {klass.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <Button type="button" variant="secondary" onClick={() => void handleBulkRenewEnrollment()} disabled={isBulkEnrollmentSaving || rows.length === 0}>
                Listelenenleri geçir
              </Button>
            </div>
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Öğrenci ekle
            </Button>
          </>
        }
        aria-label="Öğrenci yönetimi"
        className={pageClassName}
        columns={visibleColumns}
        description="Kurum öğrencilerini listele; ad-soyad, TC, iletişim ve veli bilgileriyle ekle veya düzenle."
        emptyState={
          <EmptyState
            title="Henüz öğrenci yok"
            description="İlk öğrenciyi ekleyerek kurum kurulumunun çekirdek akışını tamamla."
            hint={classes.length === 0 ? "Öğrenciyi sınıfsız ekleyebilir veya önce sınıf oluşturabilirsin." : undefined}
            primaryAction={{ label: "Öğrenci ekle", onClick: openCreateForm }}
            secondaryAction={{ label: "Kuruluma dön", href: "/kurum/kurulum" }}
          />
        }
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
            <option value="GRADUATED">Mezun</option>
            <option value="TRANSFERRED">Nakil</option>
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
        {editingStudent ? (
          <section className="next-form-section" aria-label="Kayıt işlemleri">
            <p className="next-form-section-title">Kayıt işlemleri</p>
            <label>
              İşlem tarihi
              <Input
                type="date"
                value={enrollmentAction.startsAt}
                onChange={(event) => setEnrollmentAction((current) => ({ ...current, startsAt: event.target.value }))}
              />
            </label>
            <label>
              Yeni sınıf
              <select
                value={enrollmentAction.classId}
                onChange={(event) => setEnrollmentAction((current) => ({ ...current, classId: event.target.value }))}
              >
                <option value="">Kurumdan ayrıldı</option>
                {classes.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="next-form-list">
              <Button type="button" onClick={() => void handleRenewEnrollment()} disabled={isEnrollmentSaving}>
                Kayıt yenile
              </Button>
              <Button type="button" variant="secondary" onClick={() => void handleTransferEnrollment()} disabled={isEnrollmentSaving}>
                Nakil işle
              </Button>
            </div>
          </section>
        ) : null}
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
          <dd>{formatNumber(detail?.report?.total?.net)}</dd>
        </div>
        <div>
          <dt>Hata kitapçığı</dt>
          <dd>{detail?.errorBooklet?.items ? `${detail.errorBooklet.items.length} soru` : "-"}</dd>
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
                {record.classId ?? "Sınıfsız"} · {formatClassHistoryAcademicContext(record)} · {formatDate(record.startsAt)}
                {record.endsAt ? ` - ${formatDate(record.endsAt)}` : " - devam ediyor"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {detail && detail.enrollments.length > 0 ? (
        <div className="next-form-guardians">
          <span className="next-field-hint">Kayıt geçmişi</span>
          <ul>
            {detail.enrollments.map((record) => (
              <li key={record.id}>
                {formatEnrollmentReason(record.reason)} · {formatStudentStatus(record.status)} · {record.classId ?? "Sınıfsız"} · {formatClassHistoryAcademicContext(record)} · {formatDate(record.startsAt)}
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
  { label: "Okul No artan", value: "studentNo" },
  { label: "Okul No azalan", value: "-studentNo" },
  { label: "Ad A-Z", value: "firstName" },
  { label: "Ad Z-A", value: "-firstName" },
  { label: "Soyad A-Z", value: "lastName" },
  { label: "Soyad Z-A", value: "-lastName" },
  { label: "Sınıf A-Z", value: "classId" },
  { label: "Sınıf Z-A", value: "-classId" },
];

function readStudentListQuery(searchParams: QueryParamReader): ListQueryState {
  const page = Number(searchParams.get("page"));
  const limit = Number(searchParams.get("limit"));
  return {
    page: Number.isFinite(page) && page > 0 ? page : initialListQuery.page,
    limit: studentPageLimits.includes(limit) ? limit : initialListQuery.limit,
    q: searchParams.get("q") ?? initialListQuery.q,
    sort: readStudentSort(searchParams.get("sort")),
  };
}

function readStudentSort(value: string | null): string {
  return value && studentSortOptions.some((option) => option.value === value) ? value : initialListQuery.sort;
}

function readStudentFilters(searchParams: QueryParamReader): StudentListFilters {
  return {
    classId: searchParams.get("classId") ?? emptyFilters.classId,
    level: searchParams.get("level") ?? emptyFilters.level,
    responsibleTeacherId: searchParams.get("responsibleTeacherId") ?? emptyFilters.responsibleTeacherId,
    status: readStudentStatusFilter(searchParams.get("status")),
    guardianLinked: readGuardianLinkedFilter(searchParams.get("guardianLinked")),
  };
}

function readStudentStatusFilter(value: string | null): StudentListFilters["status"] {
  return value === "ACTIVE" || value === "PASSIVE" || value === "GRADUATED" || value === "TRANSFERRED" ? value : "";
}

function readGuardianLinkedFilter(value: string | null): StudentListFilters["guardianLinked"] {
  return value === "true" || value === "false" ? value : "";
}

function readStudentTableDensity(searchParams: QueryParamReader): StudentTableDensity {
  return searchParams.get("density") === "compact" ? "compact" : "comfortable";
}

function readVisibleStudentColumnKeys(searchParams: QueryParamReader): StudentColumnKey[] {
  const rawValue = searchParams.get("columns");
  if (!rawValue) return [...defaultVisibleStudentColumnKeys];
  const requestedKeys = rawValue.split(",").filter(isStudentColumnKey);
  return sortStudentColumnKeys([...new Set([...requestedKeys, ...requiredStudentColumnKeys])]);
}

function isStudentColumnKey(value: string): value is StudentColumnKey {
  return studentColumnKeys.includes(value as StudentColumnKey);
}

function sortStudentColumnKeys(keys: StudentColumnKey[]): StudentColumnKey[] {
  const uniqueKeys = new Set(keys);
  return studentColumnKeys.filter((key) => uniqueKeys.has(key));
}

function writeStudentListQuery({
  filters,
  listQuery,
  tableDensity,
  visibleColumnKeys,
}: {
  filters: StudentListFilters;
  listQuery: ListQueryState;
  tableDensity: StudentTableDensity;
  visibleColumnKeys: StudentColumnKey[];
}) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  setQueryParam(params, "page", listQuery.page === initialListQuery.page ? "" : String(listQuery.page));
  setQueryParam(params, "limit", listQuery.limit === initialListQuery.limit ? "" : String(listQuery.limit));
  setQueryParam(params, "q", listQuery.q.trim());
  setQueryParam(params, "sort", listQuery.sort);
  setQueryParam(params, "classId", filters.classId);
  setQueryParam(params, "level", filters.level);
  setQueryParam(params, "responsibleTeacherId", filters.responsibleTeacherId);
  setQueryParam(params, "status", filters.status);
  setQueryParam(params, "guardianLinked", filters.guardianLinked);
  setQueryParam(params, "density", tableDensity === "compact" ? tableDensity : "");
  setQueryParam(
    params,
    "columns",
    isDefaultStudentColumnSet(visibleColumnKeys) ? "" : visibleColumnKeys.join(","),
  );

  const queryString = params.toString();
  const nextPath = `${window.location.pathname}${queryString ? `?${queryString}` : ""}`;
  const currentPath = `${window.location.pathname}${window.location.search}`;
  if (nextPath !== currentPath) {
    window.history.replaceState(null, "", nextPath);
  }
}

function setQueryParam(params: URLSearchParams, key: string, value: string) {
  if (value) {
    params.set(key, value);
    return;
  }
  params.delete(key);
}

function isDefaultStudentColumnSet(keys: StudentColumnKey[]) {
  return keys.length === defaultVisibleStudentColumnKeys.length && defaultVisibleStudentColumnKeys.every((key) => keys.includes(key));
}

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

async function loadStudentReferences(accessToken: string): Promise<StudentReferences> {
  const [classes, teachers] = await Promise.all([
    apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`),
    apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`),
  ]);
  return { classes, teachers };
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
    enrollments,
    teacherNotes,
  ] = await Promise.all([
    apiRequestOrNull<AttendanceSummaryRecord>(accessToken, `${apiBaseUrl}/attendance/summary?studentId=${encodeURIComponent(id)}`),
    loadLatestErrorBooklet(accessToken, id),
    apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/profile`),
    apiRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardians`),
    loadStudentHomeworkAssignments(accessToken, id),
    apiRequest<PaymentPlanWithInstallmentsRecord[]>(accessToken, `${apiBaseUrl}/payment-plans?studentId=${encodeURIComponent(id)}`),
    apiRequestOrNull<ReportStudentProgress>(accessToken, `${apiBaseUrl}/exams/exam-demo-isem-lgs-1/reports/students/${encodeURIComponent(id)}/progress`),
    loadLatestStudentReport(accessToken, id),
    apiRequest<StudentClassHistoryRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/class-history`),
    apiRequest<StudentEnrollmentRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/enrollments`),
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
    enrollments,
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
    `${apiBaseUrl}/exams/exam-demo-isem-lgs-1/reports/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}`,
  );
}

async function loadLatestErrorBooklet(accessToken: string, studentId: string): Promise<ReportErrorBooklet | null> {
  const snapshot = await loadLatestSnapshot(accessToken, studentId);
  if (!snapshot) return null;
  return apiRequestOrNull<ReportErrorBooklet>(
    accessToken,
    `${apiBaseUrl}/exams/exam-demo-isem-lgs-1/reports/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}/error-booklet`,
  );
}

async function loadLatestSnapshot(accessToken: string, studentId: string): Promise<ReportSnapshotRecord | null> {
  const snapshots = await apiRequest<ReportSnapshotRecord[]>(accessToken, `${apiBaseUrl}/exams/exam-demo-isem-lgs-1/reports/snapshots`);
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

async function renewStudentEnrollment(accessToken: string, id: string, input: EnrollmentActionState) {
  return apiRequest<StudentEnrollmentRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/enrollments/renew`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function transferStudentEnrollment(accessToken: string, id: string, input: EnrollmentActionState) {
  return apiRequest<StudentEnrollmentRecord | null>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/enrollments/transfer`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function bulkRenewStudentEnrollments(accessToken: string, input: BulkEnrollmentActionState) {
  return apiRequest<{ updatedCount: number; enrollments: StudentEnrollmentRecord[] }>(accessToken, `${apiBaseUrl}/students/enrollments/bulk-renew`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
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
  const labels: Record<StudentRecord["status"], string> = {
    ACTIVE: "Aktif",
    GRADUATED: "Mezun",
    PASSIVE: "Pasif",
    TRANSFERRED: "Nakil",
  };
  return labels[status] ?? status;
}

function formatClassHistoryAcademicContext(record: StudentClassHistoryRecord) {
  return [record.academicYearId, record.termId].filter(Boolean).join(" / ") || "Akademik bağlam yok";
}

function formatEnrollmentReason(reason: string | undefined) {
  const labels: Record<string, string> = {
    CLASS_CHANGED: "Sınıf değişikliği",
    CREATED: "İlk kayıt",
    RENEWED: "Kayıt yenileme",
    TRANSFERRED: "Nakil",
  };
  return reason ? labels[reason] ?? reason : "Kayıt";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("tr-TR");
}
