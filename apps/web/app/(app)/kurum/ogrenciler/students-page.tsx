"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, CrudPage, DataTable, EmptyState, Field, FormModal, Input, Select, type DataTableColumn, useConfirmDialog } from "@uzman-hocam/ui";
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
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";
import { readReportExamId } from "../../_shared/report-exam-selection.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

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
  const { confirm, confirmationDialog } = useConfirmDialog();
  const reportExamId = readReportExamId(searchParams);
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
    queryKey: ["next-student-detail", auth?.session.tenantId ?? "anonymous", editingStudent?.id ?? "none", reportExamId],
    queryFn: () => loadStudentDetail(auth?.accessToken ?? "", editingStudent?.id ?? "", reportExamId),
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
      priority: "optional",
      render: (student) => student.studentNo ?? "—",
    },
    {
      key: "name",
      header: "Ad Soyad",
      priority: "primary",
      render: (student) => `${student.firstName} ${student.lastName}`,
      sticky: true,
    },
    {
      key: "class",
      header: "Sınıf",
      priority: "secondary",
      render: (student) => (student.classId ? (classNameById.get(student.classId) ?? "—") : "—"),
    },
    {
      key: "responsibleTeacher",
      header: "Sorumlu öğretmen",
      priority: "optional",
      render: (student) =>
        student.responsibleTeacherId ? (teacherNameById.get(student.responsibleTeacherId) ?? "—") : "—",
    },
    {
      key: "status",
      header: "Durum",
      priority: "secondary",
      render: (student) => formatStudentStatus(student.status),
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      priority: "primary",
      render: (student) => (
        <span className="next-row-actions">
          <Link href={`/kurum/ogrenciler/${encodeURIComponent(student.id)}`} aria-label={`${student.firstName} öğrenci dashboard`}>
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
  const activeRowCount = rows.filter((student) => student.status === "ACTIVE").length;
  const classCoverageCount = new Set(rows.map((student) => student.classId).filter(Boolean)).size;
  const studentSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Öğrenci toplamı",
      value: formatCount(studentsQuery.data?.meta?.total ?? rows.length),
    },
    {
      description: "Geçerli sayfada aktif kayıt",
      key: "active",
      label: "Aktif kayıt",
      tone: activeRowCount === rows.length && rows.length > 0 ? "success" : "default",
      value: `${activeRowCount}/${rows.length}`,
    },
    {
      description: filters.level ? `${filters.level}. seviye filtresi` : "Geçerli sayfa kapsamı",
      key: "classes",
      label: "Sınıf kapsamı",
      value: classCoverageCount > 0 ? `${classCoverageCount} sınıf` : "Sınıfsız",
    },
    {
      description: `${visibleColumns.length}/${studentColumnKeys.length} kolon`,
      key: "view",
      label: "Tablo görünümü",
      tone: tableDensity === "compact" ? "info" : "default",
      value: tableDensity === "compact" ? "Yoğun" : "Rahat",
    },
  ];
  const studentSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "guardian",
      label: `Veli: ${formatGuardianLinkedFilter(filters.guardianLinked)}`,
      tone: filters.guardianLinked === "true" ? "success" : filters.guardianLinked === "false" ? "warning" : "neutral",
    },
    {
      key: "teacher",
      label: filters.responsibleTeacherId ? "Sorumlu filtreli" : "Tüm sorumlular",
      tone: filters.responsibleTeacherId ? "info" : "neutral",
    },
    {
      key: "bulk",
      label: bulkEnrollmentAction.useAutomaticClassMapping ? "Toplu geçiş: otomatik" : "Toplu geçiş: manuel",
      tone: bulkEnrollmentAction.useAutomaticClassMapping ? "info" : "neutral",
    },
  ];
  const studentSummaryActions: OperationSummaryAction[] = [
    {
      detail: filters.level ? `${filters.level}. seviye görünümü` : "Bu sayfadaki sınıf dağılımı",
      key: "class-mapping",
      label: "Sınıf eşleştirme",
      status: classCoverageCount > 0 ? "İzleniyor" : "Kontrol",
      tone: classCoverageCount > 0 ? "info" : "warning",
      value: classCoverageCount > 0 ? `${classCoverageCount} sınıf` : "Sınıfsız",
    },
    {
      detail: "Filtre ve tablo kolonu birlikte izlenir",
      key: "responsible-teacher",
      label: "Sorumlu öğretmen",
      status: filters.responsibleTeacherId ? "Odak" : "Genel",
      tone: filters.responsibleTeacherId ? "info" : "neutral",
      value: filters.responsibleTeacherId ? "Filtreli" : "Tüm sorumlular",
    },
    {
      detail: `${sourceClassIds.length} kaynak sınıf`,
      key: "bulk-transition",
      label: "Toplu dönem geçişi",
      status: bulkEnrollmentAction.useAutomaticClassMapping ? "Hazır" : "Kontrol",
      tone: bulkEnrollmentAction.useAutomaticClassMapping ? "success" : "neutral",
      value: bulkEnrollmentAction.useAutomaticClassMapping ? "Otomatik" : "Manuel",
    },
  ];

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
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${student.firstName} ${student.lastName} öğrencisi silinsin mi?`,
      title: "Öğrenciyi sil",
    });
    if (!confirmed) return;

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

    const confirmed = await confirm({
      confirmLabel: "Geçir",
      description: "Bu işlem mevcut filtrede listelenen öğrencilerin kayıt dönemini toplu günceller.",
      message: `${rows.length} öğrenci ${bulkEnrollmentAction.startsAt} tarihinden itibaren ${
        bulkEnrollmentAction.useAutomaticClassMapping
          ? "otomatik seviye yükseltme ile"
          : bulkEnrollmentAction.classId
            ? `${classNameById.get(bulkEnrollmentAction.classId) ?? "seçili sınıf"} hedefine`
            : "sınıfsız hedefe"
      } geçirilsin mi?`,
      title: "Toplu dönem geçişini onayla",
    });
    if (!confirmed) return;

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
              searchPlaceholder="Ad, okul no, TC veya veli ara"
              sortOptions={studentSortOptions}
              state={listQuery}
            />
            <div className="next-list-controls" aria-label="Öğrenci filtreleri">
              <Field label="Sınıf">
                <Select
                  value={filters.classId}
                  onChange={(event) => updateFilters({ ...filters, classId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {classes.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Seviye">
                <Select
                  value={filters.level}
                  onChange={(event) => updateFilters({ ...filters, level: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {levels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sorumlu">
                <Select
                  value={filters.responsibleTeacherId}
                  onChange={(event) => updateFilters({ ...filters, responsibleTeacherId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.firstName} {teacher.lastName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Durum">
                <Select
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
                </Select>
              </Field>
              <Field label="Veli">
                <Select
                  value={filters.guardianLinked}
                  onChange={(event) => updateFilters({
                    ...filters,
                    guardianLinked: event.target.value as StudentListFilters["guardianLinked"],
                  })}
                >
                  <option value="">Tümü</option>
                  <option value="true">Bağlı</option>
                  <option value="false">Bağlı değil</option>
                </Select>
              </Field>
            </div>
            <div className="next-list-controls" aria-label="Öğrenci tablo görünümü">
              <fieldset className="next-column-picker">
                <legend>Kolonlar</legend>
                {studentColumnOptions.map((option) => (
                  <Checkbox
                    checked={visibleColumnKeys.includes(option.key)}
                    disabled={requiredStudentColumnKeys.has(option.key)}
                    key={option.key}
                    label={option.label}
                    onChange={(event) => toggleColumn(option.key, event.target.checked)}
                  />
                ))}
              </fieldset>
              <Field label="Görünüm">
                <Select value={tableDensity} onChange={(event) => setTableDensity(event.target.value as StudentTableDensity)}>
                  <option value="comfortable">Rahat</option>
                  <option value="compact">Yoğun</option>
                </Select>
              </Field>
            </div>
            <div className="next-list-controls" aria-label="Toplu dönem geçişi">
              <Field label="Geçiş tarihi">
                <Input
                  type="date"
                  value={bulkEnrollmentAction.startsAt}
                  onChange={(event) => setBulkEnrollmentAction((current) => ({ ...current, startsAt: event.target.value }))}
                />
              </Field>
              <Field label="Hedef sınıf">
                <Select
                  value={bulkEnrollmentAction.classId}
                  onChange={(event) => setBulkEnrollmentAction((current) => ({ ...current, classId: event.target.value }))}
                >
                  <option value="">Sınıfsız</option>
                  {classes.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Checkbox
                checked={bulkEnrollmentAction.useAutomaticClassMapping}
                label="Otomatik seviye yükselt"
                onChange={(event) => setBulkEnrollmentAction((current) => ({ ...current, useAutomaticClassMapping: event.target.checked }))}
              />
              {sourceClassIds.map((sourceClassId) => (
                <Field key={sourceClassId} label={`${classNameById.get(sourceClassId) ?? "Sınıf eşleşmedi"} hedefi`}>
                  <Select
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
                  </Select>
                </Field>
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
        density={tableDensity}
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
        summary={
          <OperationSummary
            actions={studentSummaryActions}
            ariaLabel="Öğrenci operasyon özeti"
            badges={studentSummaryBadges}
            items={studentSummaryItems}
          />
        }
        tableCaption="Öğrenci listesi"
        tableDescription="Filtreler, kolon görünürlüğü ve yoğunluk seçimi URL durumuyla korunur."
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
        <Field label="Ad">
          <Input
            required
            value={form.firstName}
            onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
          />
        </Field>
        <Field label="Soyad">
          <Input
            required
            value={form.lastName}
            onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
          />
        </Field>
        <Field label="Sınıf" description="Sınıf bağlantısı rapor, devamsızlık, ödeme ve portal bağlamını besler.">
          <Select
            value={form.classId}
            onChange={(event) => setForm((current) => ({ ...current, classId: event.target.value }))}
          >
            <option value="">Sınıfsız</option>
            {classes.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sorumlu öğretmen">
          <Select
            value={form.responsibleTeacherId}
            onChange={(event) => setForm((current) => ({ ...current, responsibleTeacherId: event.target.value }))}
          >
            <option value="">Atanmadı</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.firstName} {teacher.lastName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kayıt durumu">
          <Select
            value={form.status}
            onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as StudentRecord["status"] }))}
          >
            <option value="ACTIVE">Aktif</option>
            <option value="PASSIVE">Pasif</option>
            <option value="GRADUATED">Mezun</option>
            <option value="TRANSFERRED">Nakil</option>
          </Select>
        </Field>
        <Field
          label="TC Kimlik No"
          description={detail?.profile.nationalIdMasked ? `Kayıtlı: ${detail.profile.nationalIdMasked}` : undefined}
        >
          <Input
            inputMode="numeric"
            maxLength={11}
            value={form.nationalId}
            onChange={(event) => setForm((current) => ({ ...current, nationalId: event.target.value }))}
          />
        </Field>
        <Field
          label="Telefon"
          description={detail?.profile.phone ? `Kayıtlı: ${maskPhoneNumber(detail.profile.phone)}` : undefined}
        >
          <Input
            inputMode="tel"
            value={form.phone}
            onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
          />
        </Field>
        <Field
          label="E-posta"
          description={detail?.profile.email ? `Kayıtlı: ${maskEmail(detail.profile.email)}` : undefined}
        >
          <Input
            type="email"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          />
        </Field>
        <Field label="Doğum tarihi">
          <Input
            type="date"
            value={form.birthDate}
            onChange={(event) => setForm((current) => ({ ...current, birthDate: event.target.value }))}
          />
          {detail?.profile.birthDate ? (
            <span className="next-field-hint">Kayıtlı: {detail.profile.birthDate}</span>
          ) : null}
        </Field>
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
                      {guardian.phone ? ` · ${maskPhoneNumber(guardian.phone)}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="next-field-hint">{detailQuery.isPending ? "Yükleniyor…" : "Bağlı veli yok"}</span>
              )}
            </div>
          ) : null}
          <Field label="Veli adı">
            <Input
              value={form.guardianFirstName}
              onChange={(event) => setForm((current) => ({ ...current, guardianFirstName: event.target.value }))}
            />
          </Field>
          <Field label="Veli soyadı">
            <Input
              value={form.guardianLastName}
              onChange={(event) => setForm((current) => ({ ...current, guardianLastName: event.target.value }))}
            />
          </Field>
          <Field label="Veli telefonu" description="Bağlı veli listelerinde telefon maskeli gösterilir.">
            <Input
              inputMode="tel"
              value={form.guardianPhone}
              onChange={(event) => setForm((current) => ({ ...current, guardianPhone: event.target.value }))}
            />
          </Field>
        </div>
        {editingStudent ? (
          <section className="next-form-section" aria-label="Kayıt işlemleri">
            <p className="next-form-section-title">Kayıt işlemleri</p>
            <Field label="İşlem tarihi">
              <Input
                type="date"
                value={enrollmentAction.startsAt}
                onChange={(event) => setEnrollmentAction((current) => ({ ...current, startsAt: event.target.value }))}
              />
            </Field>
            <Field label="Yeni sınıf">
              <Select
                value={enrollmentAction.classId}
                onChange={(event) => setEnrollmentAction((current) => ({ ...current, classId: event.target.value }))}
              >
                <option value="">Kurumdan ayrıldı</option>
                {classes.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="next-form-actions">
              <Button type="button" onClick={() => void handleRenewEnrollment()} disabled={isEnrollmentSaving}>
                Kayıt yenile
              </Button>
              <Button type="button" variant="secondary" onClick={() => void handleTransferEnrollment()} disabled={isEnrollmentSaving}>
                Nakil işle
              </Button>
            </div>
          </section>
        ) : null}
        {editingStudent ? <StudentDetailPanel classNameById={classNameById} detail={detail} loading={detailQuery.isPending} /> : null}
      </FormModal>
      {confirmationDialog}
    </>
  );
}

function StudentDetailPanel({
  classNameById,
  detail,
  loading,
}: {
  classNameById: ReadonlyMap<string, string>;
  detail?: StudentDetail;
  loading: boolean;
}) {
  const classHistoryColumns: Array<DataTableColumn<StudentClassHistoryRecord>> = [
    {
      key: "class",
      header: "Sınıf",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => formatStudentClassLabel(record, classNameById),
      sticky: true,
    },
    {
      key: "context",
      header: "Bağlam",
      mobilePriority: "secondary",
      priority: "secondary",
      render: formatStudentAcademicContext,
    },
    {
      key: "dates",
      header: "Tarih",
      mobilePriority: "secondary",
      priority: "secondary",
      render: formatStudentRecordDateRange,
    },
  ];
  const enrollmentColumns: Array<DataTableColumn<StudentEnrollmentRecord>> = [
    {
      key: "reason",
      header: "İşlem",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => formatEnrollmentReason(record.reason),
      sticky: true,
    },
    {
      key: "status",
      header: "Durum",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (record) => formatStudentStatus(record.status),
    },
    {
      key: "class",
      header: "Sınıf",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (record) => formatStudentClassLabel(record, classNameById),
    },
    {
      key: "context",
      header: "Bağlam",
      mobilePriority: "hidden",
      priority: "optional",
      render: formatStudentAcademicContext,
    },
    {
      key: "dates",
      header: "Tarih",
      mobilePriority: "secondary",
      priority: "secondary",
      render: formatStudentRecordDateRange,
    },
  ];

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
          <dt>Başarı</dt>
          <dd>{formatPercentNumber(reportSuccessRate(detail?.report?.total))}</dd>
        </div>
        <div>
          <dt>Soru</dt>
          <dd>{formatNumber(reportQuestionCount(detail?.report?.total))}</dd>
        </div>
        <div>
          <dt>LGS puanı</dt>
          <dd>{formatNumber(readLgsScore(detail?.report?.total))}</dd>
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
        <DataTable
          caption="Sınıf geçmişi"
          columns={classHistoryColumns}
          density="compact"
          description="Öğrencinin sınıf geçişleri ve akademik bağlamı"
          getRowKey={(record) => record.id}
          rows={detail.classHistory}
        />
      ) : null}
      {detail && detail.enrollments.length > 0 ? (
        <DataTable
          caption="Kayıt geçmişi"
          columns={enrollmentColumns}
          density="compact"
          description="Yenileme, nakil ve ayrılış işlemleri"
          getRowKey={(record) => record.id}
          rows={detail.enrollments}
        />
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

async function loadStudentDetail(accessToken: string, id: string, reportExamId: string): Promise<StudentDetail> {
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
    loadLatestErrorBooklet(accessToken, id, reportExamId),
    apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/profile`),
    apiRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardians`),
    loadStudentHomeworkAssignments(accessToken, id),
    apiRequest<PaymentPlanWithInstallmentsRecord[]>(accessToken, `${apiBaseUrl}/payment-plans?studentId=${encodeURIComponent(id)}`),
    apiRequestOrNull<ReportStudentProgress>(accessToken, `${apiBaseUrl}/exams/${encodeURIComponent(reportExamId)}/reports/students/${encodeURIComponent(id)}/progress?scope=all`),
    loadLatestStudentReport(accessToken, id, reportExamId),
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

async function loadLatestStudentReport(accessToken: string, studentId: string, reportExamId: string): Promise<ReportStudentSnapshot | null> {
  const snapshot = await loadLatestSnapshot(accessToken, studentId, reportExamId);
  if (!snapshot) return null;
  return apiRequestOrNull<ReportStudentSnapshot>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(reportExamId)}/reports/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}`,
  );
}

async function loadLatestErrorBooklet(accessToken: string, studentId: string, reportExamId: string): Promise<ReportErrorBooklet | null> {
  const snapshot = await loadLatestSnapshot(accessToken, studentId, reportExamId);
  if (!snapshot) return null;
  return apiRequestOrNull<ReportErrorBooklet>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(reportExamId)}/reports/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}/error-booklet`,
  );
}

async function loadLatestSnapshot(accessToken: string, studentId: string, reportExamId: string): Promise<ReportSnapshotRecord | null> {
  const snapshots = await apiRequest<ReportSnapshotRecord[]>(accessToken, `${apiBaseUrl}/exams/${encodeURIComponent(reportExamId)}/reports/snapshots`);
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

function readLgsScore(total: { estimatedRawScore?: number; standardScore?: number } | undefined) {
  return total?.estimatedRawScore ?? total?.standardScore;
}

function formatDelta(value: number | undefined) {
  if (value === undefined) return "-";
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function formatCount(value: number) {
  return value.toLocaleString("tr-TR");
}

function formatGuardianLinkedFilter(value: StudentListFilters["guardianLinked"]) {
  if (value === "true") return "Bağlı";
  if (value === "false") return "Bağlı değil";
  return "Tümü";
}

function maskPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "Telefon kayıtlı";
  const suffix = digits.slice(-2).padStart(2, "•");
  return `••• ••• ••${suffix}`;
}

function maskEmail(value: string) {
  const [localPart = "", domain = ""] = value.split("@");
  if (!localPart || !domain) return "E-posta kayıtlı";
  const visiblePrefix = localPart.slice(0, 2);
  return `${visiblePrefix}${"•".repeat(Math.max(localPart.length - 2, 2))}@${domain}`;
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

interface StudentAcademicContextRecord {
  academicYearId?: string;
  campusName?: string;
  classId?: string;
  className?: string;
  endsAt?: string;
  gradeLevelName?: string;
  section?: string;
  startsAt: string;
  termId?: string;
}

function formatStudentClassLabel(record: Pick<StudentAcademicContextRecord, "classId" | "className">, classNameById: ReadonlyMap<string, string>) {
  if (record.className) return record.className;
  if (record.classId) return classNameById.get(record.classId) ?? "Sınıf eşleşmedi";
  return "Sınıfsız";
}

function formatStudentAcademicContext(record: StudentAcademicContextRecord) {
  const resolvedContext = [
    record.campusName,
    record.gradeLevelName,
    record.section ? `${record.section} şube` : undefined,
  ].filter(Boolean);
  if (resolvedContext.length > 0) return resolvedContext.join(" / ");

  const unresolvedContext = [
    record.academicYearId ? "Akademik yıl eşleşmedi" : undefined,
    record.termId ? "Dönem eşleşmedi" : undefined,
  ].filter(Boolean);
  return unresolvedContext.join(" / ") || "Akademik bağlam yok";
}

function formatStudentRecordDateRange(record: Pick<StudentAcademicContextRecord, "endsAt" | "startsAt">) {
  return `${formatDate(record.startsAt)}${record.endsAt ? ` - ${formatDate(record.endsAt)}` : " - devam ediyor"}`;
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
