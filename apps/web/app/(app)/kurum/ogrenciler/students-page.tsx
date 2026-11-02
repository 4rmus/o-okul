"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, CrudPage, DataTable, EmptyState, Field, FormModal, InfoGrid, InfoItem, Input, Select, type DataTableColumn, type DataTableSortDirection, useConfirmDialog } from "@o-okul/ui";
import type {
  AttendanceSummaryRecord,
  GuardianRecord,
  GradeLevelRecord,
  HomeworkMaterialAssignmentRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportErrorBooklet,
  ReportSnapshotRecord,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentEnrollmentRecord,
  StudentGuardianInvitationBulkResult,
  StudentImportDryRunResult,
  StudentImportResult,
  StudentProfileRecord,
  StudentRecord,
  TeacherNoteRecord,
} from "@o-okul/shared-types";
import { Eye, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { ApiRequestError, apiBaseUrl, apiCursorListRequest, apiRequest, authenticatedFetch, withQueryParams } from "../../../../src/api-client.js";
import {
  buildCursorListUrl,
  CursorListControls,
  initialCursorListQuery,
  loadCursorPageWithRecovery,
  readCursorListQueryFromUrl,
  resetListCursor,
  writeCursorListQueryParams,
  type CursorListQueryState,
} from "../../../../src/cursor-list-controls.js";
import { hasCapabilityForRoles } from "../../_shared/access.js";
import { formatAttendanceSummary } from "../../_shared/attendance-summary.js";
import { istanbulDateKey } from "../../_shared/istanbul-date.js";
import { formatPercentNumber, formatStudentProgressSummary, isComparableStudentProgress, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";
import { readReportExamId } from "../../_shared/report-exam-selection.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryItem } from "../_shared/operation-summary.js";
import { type EnrollmentActionState, StudentFormModal, useStudentReferences } from "./student-form-modal.js";

interface StudentDetail {
  attendanceSummary: AttendanceSummaryRecord | null;
  errorBooklet: ReportErrorBooklet | null;
  profile: StudentProfileRecord;
  guardians: GuardianRecord[];
  homeworkAssignments: HomeworkMaterialAssignmentRecord[];
  paymentPlans: PaymentPlanWithInstallmentsRecord[];
  progress: ReportStudentProgress | null;
  report: ReportStudentSnapshot | null;
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

interface BulkEnrollmentActionState extends EnrollmentActionState {
  studentIds: string[];
  classIdBySourceClassId: Record<string, string>;
  useAutomaticClassMapping: boolean;
}

const studentColumnKeys = ["studentNo", "name", "gradeLevel", "class", "responsibleTeacher", "status", "actions"] as const;

type StudentColumnKey = typeof studentColumnKeys[number];
type StudentTableDensity = "comfortable" | "compact";

interface QueryParamReader {
  get(name: string): string | null;
}

const requiredStudentColumnKeys = new Set<StudentColumnKey>(["name", "actions"]);
const defaultVisibleStudentColumnKeys = [...studentColumnKeys];
const studentImportMaxBytes = 5 * 1024 * 1024;
const studentImportAllowedExtensions = new Set(["CSV", "XLSX"]);

const studentColumnOptions: Array<{ key: StudentColumnKey; label: string }> = [
  { key: "studentNo", label: "Okul No" },
  { key: "name", label: "Ad Soyad" },
  { key: "gradeLevel", label: "Seviye" },
  { key: "class", label: "Sınıf" },
  { key: "responsibleTeacher", label: "Sorumlu" },
  { key: "status", label: "Durum" },
  { key: "actions", label: "İşlem" },
];

const emptyFilters: StudentListFilters = {
  classId: "",
  level: "",
  responsibleTeacherId: "",
  status: "",
  guardianLinked: "",
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
  const canRevealPhone = hasCapabilityForRoles(auth?.session.roles ?? [], "privacy:manage");
  // API ile hizalı: dönem geçişi student:manage, veli daveti student:manage + user:manage ister.
  const canManageStudents = hasCapabilityForRoles(auth?.session.roles ?? [], "student:manage");
  const canInviteGuardians = canManageStudents && hasCapabilityForRoles(auth?.session.roles ?? [], "user:manage");
  const canSelectStudents = canManageStudents || canInviteGuardians;
  const canManageClasses = hasCapabilityForRoles(auth?.session.roles ?? [], "class:manage");
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const reportExamId = readReportExamId(searchParams);
  const [listQuery, setListQuery] = useState<CursorListQueryState>(() => readStudentListQuery(searchParams));
  const [filters, setFilters] = useState<StudentListFilters>(() => readStudentFilters(searchParams));
  const [tableDensity, setTableDensity] = useState<StudentTableDensity>(() => readStudentTableDensity(searchParams));
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<StudentColumnKey[]>(() => readVisibleStudentColumnKeys(searchParams));
  const queryKey = ["next-students", auth?.session.tenantId ?? "anonymous", listQuery, filters];
  const listQueryKey = ["next-students", auth?.session.tenantId ?? "anonymous"];
  const studentsQuery = useQuery({
    queryKey,
    // A stale cursor (for example from a bookmarked URL) is dropped and the first page is shown instead.
    queryFn: () => loadCursorPageWithRecovery(
      listQuery,
      (state) => loadStudents(auth?.accessToken ?? "", state, filters),
      setListQuery,
    ),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isBulkEnrollmentSaving, setIsBulkEnrollmentSaving] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isImportChecking, setIsImportChecking] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFileBase64, setImportFileBase64] = useState("");
  const [importFileLabel, setImportFileLabel] = useState("");
  const [importIdempotencyKey, setImportIdempotencyKey] = useState("");
  const [importDryRun, setImportDryRun] = useState<StudentImportDryRunResult | null>(null);
  const [importError, setImportError] = useState("");
  const [bulkEnrollmentAction, setBulkEnrollmentAction] = useState<BulkEnrollmentActionState>({
    ...emptyBulkEnrollmentAction,
    startsAt: istanbulDateKey(),
  });
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [isGuardianInviting, setIsGuardianInviting] = useState(false);
  const [guardianInvitationResult, setGuardianInvitationResult] = useState<StudentGuardianInvitationBulkResult | null>(null);
  const [error, setError] = useState("");
  const rows = studentsQuery.data?.data ?? [];
  // Seçim yalnız görünen listeye aittir: arama, filtre, sıralama veya sayfa değişince temizlenir.
  const selectionScopeKey = JSON.stringify([listQuery, filters]);
  const [selectionScope, setSelectionScope] = useState(selectionScopeKey);
  if (selectionScope !== selectionScopeKey) {
    setSelectionScope(selectionScopeKey);
    setSelectedStudentIds([]);
  }
  const selectedStudents = rows.filter((student) => selectedStudentIds.includes(student.id));
  const bulkActionsPanelRef = useRef<HTMLDetailsElement>(null);
  const sourceClassIds = [...new Set(rows.map((student) => student.classId).filter((classId): classId is string => Boolean(classId)))].sort();

  const detailQuery = useQuery({
    queryKey: ["next-student-detail", auth?.session.tenantId ?? "anonymous", editingStudent?.id ?? "none", reportExamId],
    queryFn: () => loadStudentDetail(auth?.accessToken ?? "", editingStudent?.id ?? "", reportExamId),
    enabled: Boolean(auth && editingStudent),
    refetchOnWindowFocus: false,
  });
  const detail = editingStudent ? detailQuery.data : undefined;

  const referencesQuery = useStudentReferences();
  const classes = referencesQuery.data?.classes ?? [];
  const classNameById = new Map(classes.map((klass) => [klass.id, klass.name]));
  const gradeLevels = referencesQuery.data?.gradeLevels ?? [];
  const gradeLevelNameById = new Map(gradeLevels.map((gradeLevel) => [gradeLevel.id, gradeLevel.name]));
  const levelOptions = gradeLevels;

  const teachers = referencesQuery.data?.teachers ?? [];
  const teacherNameById = new Map(teachers.map((teacher) => [teacher.id, `${teacher.firstName} ${teacher.lastName}`]));

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  useEffect(() => {
    writeStudentListQuery({ filters, listQuery, tableDensity, visibleColumnKeys });
  }, [filters, listQuery, tableDensity, visibleColumnKeys]);

  const activeSort = resolveStudentSortDirection(listQuery.sort);
  // Başlık tıklaması "Sırala" seçimiyle aynı URL sıralama durumunu yazar; imleç sıfırlanır (UI/UX F12).
  const sortByHeader = (ascendingValue: string, direction: DataTableSortDirection) => {
    setListQuery((current) => resetListCursor(current, { sort: direction === "descending" ? `-${ascendingValue}` : ascendingValue }));
  };
  const columns: Array<DataTableColumn<StudentRecord> & { key: StudentColumnKey }> = [
    {
      key: "studentNo",
      header: "Okul No",
      onSort: (direction) => sortByHeader("studentNo", direction),
      sortDirection: activeSort.columnKey === "studentNo" ? activeSort.direction : undefined,
      priority: "optional",
      render: (student) => student.studentNo ?? "—",
    },
    {
      key: "name",
      header: "Ad Soyad",
      priority: "primary",
      // Ad Soyad başlığı adı sıralar; "Sırala" seçiminden soyad seçildiyse başlık soyad yönünü değiştirir.
      onSort: (direction) => sortByHeader(listQuery.sort.replace(/^-/, "") === "lastName" ? "lastName" : "firstName", direction),
      sortDirection: activeSort.columnKey === "name" ? activeSort.direction : undefined,
      render: (student) => <Link href={`/kurum/ogrenciler/${encodeURIComponent(student.id)}`}>{student.firstName} {student.lastName}</Link>,
      sticky: true,
    },
    {
      key: "gradeLevel",
      header: "Seviye",
      mobilePriority: "hidden",
      priority: "secondary",
      render: (student) => student.gradeLevelId ? (gradeLevelNameById.get(student.gradeLevelId) ?? "Seviye bulunamadı") : "Seviye atanmadı",
    },
    {
      key: "class",
      header: "Sınıf",
      onSort: (direction) => sortByHeader("classId", direction),
      sortDirection: activeSort.columnKey === "class" ? activeSort.direction : undefined,
      priority: "secondary",
      render: (student) => (student.classId ? (classNameById.get(student.classId) ?? "—") : "—"),
    },
    {
      key: "responsibleTeacher",
      header: "Sorumlu öğretmen",
      priority: "optional",
      render: (student) => formatResponsibleTeacher(student, teacherNameById),
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
          <Link href={`/kurum/ogrenciler/${encodeURIComponent(student.id)}`} aria-label={`${student.firstName} ${student.lastName} öğrenci özeti`}>
            <Eye size={17} aria-hidden="true" />
          </Link>
          <Button size="icon" variant="ghost" type="button" onClick={() => openEditForm(student)} aria-label={`${student.firstName} ${student.lastName} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" type="button" onClick={() => void handleDelete(student)} aria-label={`${student.firstName} ${student.lastName} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ];
  const visibleColumns = columns.filter((column) => visibleColumnKeys.includes(column.key));
  const pageClassName = tableDensity === "compact"
    ? "next-students-page next-students-page--compact next-student-growth-list"
    : "next-students-page next-student-growth-list";
  const activeRowCount = rows.filter((student) => student.status === "ACTIVE").length;
  const classCoverageCount = new Set(rows.map((student) => student.classId).filter(Boolean)).size;
  const unassignedClassCount = rows.filter((student) => !student.classId).length;
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
      description: filters.level ? `${levelLabel(filters.level, gradeLevels)} filtresi` : "Geçerli sayfa kapsamı",
      key: "classes",
      label: "Sınıf kapsamı",
      value: classCoverageCount > 0 ? `${classCoverageCount} sınıf` : "Sınıfsız",
    },
  ];
  const studentSummaryActions: OperationSummaryAction[] = rows.length === 0 ? [] : [
    {
      detail: unassignedClassCount > 0 ? "Sınıfı olmayan öğrenciyi düzenleyip bir sınıfa bağlayın" : "Bu sayfadaki her öğrencinin sınıfı var",
      key: "class-mapping",
      label: "Sınıf eşleştirme",
      status: unassignedClassCount > 0 ? "Sınıf atayın" : "Tamam",
      tone: unassignedClassCount > 0 ? "warning" : "success",
      value: unassignedClassCount > 0 ? `${formatCount(unassignedClassCount)} öğrenci sınıfsız` : "Tümü sınıflı",
    },
  ];

  function openCreateForm() {
    setEditingStudent(null);
    setError("");
    setIsFormOpen(true);
  }

  function toggleColumn(key: StudentColumnKey, checked: boolean) {
    if (requiredStudentColumnKeys.has(key)) return;
    setVisibleColumnKeys((current) => sortStudentColumnKeys(checked ? [...current, key] : current.filter((columnKey) => columnKey !== key)));
  }

  function updateFilters(nextFilters: StudentListFilters) {
    setFilters(nextFilters);
    setListQuery((current) => resetListCursor(current));
  }

  function openEditForm(student: StudentRecord) {
    setEditingStudent(student);
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingStudent(null);
    setError("");
  }

  function openImportModal() {
    setImportFileBase64("");
    setImportFileLabel("");
    setImportIdempotencyKey("");
    setImportDryRun(null);
    setImportError("");
    setIsImportOpen(true);
  }

  function closeImportModal() {
    setIsImportOpen(false);
    setImportFileBase64("");
    setImportFileLabel("");
    setImportIdempotencyKey("");
    setImportDryRun(null);
    setImportError("");
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

  function revealBulkEnrollmentSettings() {
    const panel = bulkActionsPanelRef.current;
    if (!panel) return;
    panel.open = true;
    panel.querySelector<HTMLInputElement>('input[type="date"]')?.focus();
  }

  // Çubuktaki düğme geçiş tarihi ve hedef sınıf görünmeden işlemi başlatmaz: kapalı panel önce açılır.
  function handleBulkBarRenewEnrollment() {
    if (!bulkActionsPanelRef.current?.open || !bulkEnrollmentAction.startsAt) {
      revealBulkEnrollmentSettings();
      return;
    }
    void handleBulkRenewEnrollment();
  }

  async function handleBulkRenewEnrollment() {
    const studentIds = selectedStudents.map((student) => student.id);
    if (!auth || isBulkEnrollmentSaving || studentIds.length === 0) return;
    if (!bulkEnrollmentAction.startsAt) {
      revealBulkEnrollmentSettings();
      return;
    }

    const confirmed = await confirm({
      confirmLabel: "Geçir",
      description: "Bu işlem yalnız seçili öğrencilerin kayıt dönemini günceller. Tarihi veya hedefi değiştirmek için vazgeçip Toplu işlemler bölümünü düzenleyin.",
      message: `${studentIds.length} seçili öğrenci ${bulkEnrollmentAction.startsAt} tarihinden itibaren ${
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
        studentIds,
        useAutomaticClassMapping: bulkEnrollmentAction.useAutomaticClassMapping,
      });
      setSelectedStudentIds([]);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-student-detail"] });
    } catch {
      setError("Toplu dönem geçişi yapılamadı.");
    } finally {
      setIsBulkEnrollmentSaving(false);
    }
  }

  async function handleBulkGuardianInvitation() {
    const studentIds = selectedStudents.map((student) => student.id);
    if (!auth || isGuardianInviting || studentIds.length === 0) return;

    const confirmed = await confirm({
      confirmLabel: "Davet et",
      description: "Seçili öğrencilerin yasal veli iletişim kayıtlarından veli hesabı açılır ve e-posta daveti gönderilir. Zaten bağlı veliye ikinci davet gönderilmez; SMS ve duyuru izinleri değişmez.",
      message: `${studentIds.length} seçili öğrencinin velisi davet edilsin mi?`,
      title: "Toplu veli davetini onayla",
    });
    if (!confirmed) return;

    setError("");
    setGuardianInvitationResult(null);
    setIsGuardianInviting(true);
    try {
      setGuardianInvitationResult(await inviteStudentGuardians(auth.accessToken, studentIds, globalThis.crypto.randomUUID()));
      setSelectedStudentIds([]);
    } catch {
      setError("Toplu veli daveti yapılamadı.");
    } finally {
      setIsGuardianInviting(false);
    }
  }

  async function handleStudentImportFile(file: File | undefined) {
    setImportFileBase64("");
    setImportFileLabel("");
    setImportIdempotencyKey("");
    setImportDryRun(null);
    setImportError("");
    if (!auth || !file) return;

    const extension = inferStudentImportExtension(file);
    if (!extension || !studentImportAllowedExtensions.has(extension)) {
      setImportError("CSV veya XLSX dosyası seçin.");
      return;
    }
    if (file.size <= 0) {
      setImportError("Dosya boş görünüyor.");
      return;
    }
    if (file.size > studentImportMaxBytes) {
      setImportError(`Dosya en fazla ${formatByteSize(studentImportMaxBytes)} olabilir.`);
      return;
    }

    setIsImportChecking(true);
    try {
      const fileBase64 = await readFileAsBase64(file);
      const dryRun = await dryRunStudentImport(auth.accessToken, fileBase64);
      setImportFileBase64(fileBase64);
      setImportFileLabel(`${extension} • ${formatByteSize(file.size)}`);
      setImportIdempotencyKey(globalThis.crypto.randomUUID());
      setImportDryRun(dryRun);
    } catch {
      setImportError("Dosya kontrol edilemedi. Sınıf adlarını, zorunlu alanları ve dosya biçimini kontrol edin.");
    } finally {
      setIsImportChecking(false);
    }
  }

  async function handleCommitStudentImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || isImporting) return;
    if (!importFileBase64 || !importDryRun || !importIdempotencyKey) {
      setImportError("Önce aktarım dosyası seçin.");
      return;
    }
    if (!importDryRun.wouldImport) {
      setImportError("Hatalar giderilmeden aktarım başlatılamaz.");
      return;
    }

    setImportError("");
    setIsImporting(true);
    try {
      await commitStudentImport(auth.accessToken, importFileBase64, importIdempotencyKey);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-student-detail"] });
      closeImportModal();
    } catch (error) {
      setImportError(error instanceof ApiRequestError && error.code === "STUDENT_NATIONAL_ID_CONFLICT"
        ? "Dosyadaki bir T.C. kimlik no kurumda daha önce kayıtlı (silinmiş öğrenci dahil). Ön izlemeyi yeniden çalıştırın."
        : "Aktarım tamamlanamadı. Aynı okul no, kota veya profil doğrulamalarını kontrol edin.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <CursorListControls
              meta={studentsQuery.data?.meta}
              onChange={setListQuery}
              searchPlaceholder="Ad, soyad veya okul no ara"
              sortOptions={studentSortOptions}
              state={listQuery}
            />
            <details className="next-list-disclosure">
              <summary>Filtreler ve görünüm</summary>
              <div className="next-list-disclosure__content">
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
                      {levelOptions.map((level) => (
                        <option key={level.id} value={level.id}>
                          {level.name}
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
                  <Field label="İletişim kişisi">
                    <Select
                      value={filters.guardianLinked}
                      onChange={(event) => updateFilters({
                        ...filters,
                        guardianLinked: event.target.value as StudentListFilters["guardianLinked"],
                      })}
                    >
                      <option value="">Tümü</option>
                      <option value="true">Var</option>
                      <option value="false">Yok</option>
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
              </div>
            </details>
            <details className="next-list-disclosure" ref={bulkActionsPanelRef}>
              <summary>Toplu işlemler</summary>
              <div className="next-list-disclosure__content">
                <p className="next-field-hint">
                  Tablodan öğrenci seçin; seçili öğrenciler için işlem çubuğu listenin altında açılır.
                </p>
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
                  <Button type="button" variant="secondary" onClick={() => void handleBulkRenewEnrollment()} disabled={isBulkEnrollmentSaving || selectedStudents.length === 0 || !bulkEnrollmentAction.startsAt}>
                    Seçilenleri geçir ({selectedStudents.length})
                  </Button>
                </div>
                {canInviteGuardians ? (
                  <div className="next-list-controls" aria-label="Toplu veli daveti">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handleBulkGuardianInvitation()}
                      disabled={isGuardianInviting || selectedStudents.length === 0}
                    >
                      Velileri davet et ({selectedStudents.length})
                    </Button>
                  </div>
                ) : null}
              </div>
            </details>
            <Button type="button" variant="secondary" onClick={openImportModal}>
              <Upload size={17} aria-hidden="true" />
              Toplu aktar
            </Button>
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
        hasActiveFilters={Boolean(listQuery.q.trim()) || Object.values(filters).some(Boolean)}
        loading={studentsQuery.isPending}
        rows={rows}
        selection={canSelectStudents ? {
          getRowLabel: (student) => `${student.firstName} ${student.lastName}`,
          onSelectionChange: setSelectedStudentIds,
          selectAllLabel: "Bu sayfadaki tüm öğrencileri seç",
          selectedKeys: selectedStudentIds,
        } : undefined}
        summary={
          <OperationSummary
            actions={studentSummaryActions}
            ariaLabel="Öğrenci operasyon özeti"
            items={studentSummaryItems}
          />
        }
        tableCaption="Öğrenci listesi"
        tableDescription="Sınıf ve kayıt durumu."
      />
      {selectedStudents.length > 0 || guardianInvitationResult ? (
        <section aria-label="Toplu işlem çubuğu" className="next-bulk-selection">
          <div className="next-bulk-selection__bar">
            {guardianInvitationResult ? (
              <p className="next-bulk-selection__result" role="status">{formatGuardianInvitationSummary(guardianInvitationResult)}</p>
            ) : null}
            {selectedStudents.length > 0 ? (
              <>
                <p aria-live="polite" className="next-bulk-selection__count">
                  {selectedStudents.length} öğrenci seçildi
                </p>
                <div className="next-bulk-selection__actions">
                  {canInviteGuardians ? (
                    <Button type="button" variant="secondary" onClick={() => void handleBulkGuardianInvitation()} disabled={isGuardianInviting}>
                      Veli daveti
                    </Button>
                  ) : null}
                  {canManageStudents ? (
                    <Button type="button" variant="secondary" onClick={handleBulkBarRenewEnrollment} disabled={isBulkEnrollmentSaving}>
                      Dönem geçişi
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" onClick={() => setSelectedStudentIds([])}>
                    Seçimi temizle
                  </Button>
                </div>
              </>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setGuardianInvitationResult(null)}>
                Sonucu kapat
              </Button>
            )}
          </div>
        </section>
      ) : null}
      <FormModal
        description="CSV veya XLSX dosyası seçildiğinde önce ön kontrol yapılır; hata yoksa aktarım tamamlanır."
        onCancel={closeImportModal}
        onSubmit={(event) => void handleCommitStudentImport(event)}
        open={isImportOpen}
        submitLabel={isImporting ? "Aktarılıyor…" : "Aktar"}
        title="Toplu öğrenci aktar"
      >
        <Field
          label="Aktarım dosyası"
          description={importFileLabel || `CSV/XLSX • en fazla ${formatByteSize(studentImportMaxBytes)}`}
        >
          <Input
            type="file"
            accept=".csv,.xlsx"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              void handleStudentImportFile(file);
              event.currentTarget.value = "";
            }}
          />
        </Field>
        {isImportChecking ? <span className="next-field-hint">Kontrol ediliyor…</span> : null}
        {importDryRun ? (
          <>
            <InfoGrid>
              <InfoItem label="Satır" value={formatCount(importDryRun.totalRows)} />
              <InfoItem label="Geçerli" value={formatCount(importDryRun.validRows.length)} />
              <InfoItem label="İletişim kişisi" value={formatCount(importDryRun.validRows.filter((row) => row.contact).length)} />
              <InfoItem label="Hata" value={formatCount(importDryRun.errors.length)} />
              <InfoItem label="Kota" value={`${importDryRun.quota.current}+${importDryRun.quota.incoming}/${importDryRun.quota.limit}`} />
            </InfoGrid>
            <p className="next-field-hint">Seviye dağılımı: {formatGradeLevelDistribution(importDryRun)}</p>
          </>
        ) : null}
        <p className="next-field-hint">Toplu aktarım portal hesabı oluşturmaz; erişimi Öğrenci Portal Erişimi ekranından ayrıca açabilirsiniz.</p>
        <p className="next-field-hint">Veli sütunları iletişim kişisi olarak yazılır; veli hesabı açılmaz, veli TC'si okunmaz. İletişim kişisi için contactFirstName, contactLastName, contactRelation, contactPhone ve contactEmail kolonlarını da kullanabilirsin. İzinler varsayılan kapalıdır.</p>
        {importDryRun && importDryRun.errors.length > 0 ? (
          <div className="next-form-guardians">
            <span className="next-field-hint">İlk hatalar</span>
            <ul>
              {importDryRun.errors.slice(0, 5).map((item, index) => (
                <li key={`${item.row}-${item.field}-${item.code}-${index}`}>{formatStudentImportError(item)}</li>
              ))}
            </ul>
            {/* UAT F-05: import never creates levels or classes; point to the screens that do. */}
            {importDryRun.errors.some((item) => schoolStructureImportErrorCodes.has(item.code)) ? (
              <p className="next-field-hint">
                İçe aktarma seviye ve sınıf oluşturmaz.{" "}
                {canManageClasses ? (
                  <>
                    Eksik kayıtları <Link href="/kurum/seviyeler">Seviyeler</Link> ve <Link href="/kurum/siniflar">Sınıflar</Link> ekranlarından ekleyip dosyayı yeniden kontrol edin.
                  </>
                ) : "Eksik seviye veya sınıfı kurum yöneticisine açtırın."}
              </p>
            ) : null}
          </div>
        ) : null}
        {importError ? <p className="uh-crud-page__error">{importError}</p> : null}
      </FormModal>
      <StudentFormModal
        canRevealPhone={canRevealPhone}
        detail={detail}
        detailLoading={detailQuery.isPending}
        onClose={closeForm}
        onCreated={setEditingStudent}
        open={isFormOpen}
        student={editingStudent}
      >
        {editingStudent ? <StudentDetailPanel classNameById={classNameById} detail={detail} loading={detailQuery.isPending} /> : null}
      </StudentFormModal>
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
  const scoreView = detail?.report ? preferredScoreView(detail.report) : undefined;
  const isModernReport = Boolean(detail?.report?.scoringProfileId || detail?.report?.scoreViews?.length);
  const score = scoreView?.practiceScore ?? (isModernReport ? undefined : legacyReportScore(detail?.report));
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
      <section className="next-form-section next-student-growth-brief" aria-label="Öğrenci 360">
        <p className="next-form-section-title">Öğrenci 360</p>
        <span className="next-field-hint">Yükleniyor…</span>
      </section>
    );
  }

  return (
    <section className="next-form-section next-student-growth-brief" aria-label="Öğrenci 360">
      <p className="next-form-section-title">Öğrenci 360</p>
      <InfoGrid className="next-student-360-summary" aria-label="Öğrenci 360 özeti" role="region">
        <InfoItem label="Kayıt durumu" value={detail?.profile.status ? formatStudentStatus(detail.profile.status) : "-"} />
        <InfoItem label="Devamsızlık" value={formatAttendanceSummary(detail?.attendanceSummary)} />
        <InfoItem label="Öğretmen notu" value={detail?.teacherNotes.length ?? 0} />
        <InfoItem label="Ödev" value={detail?.homeworkAssignments.length ?? 0} />
        <InfoItem label="Bekleyen ödeme" value={formatPendingPayment(detail?.paymentPlans ?? [])} />
        <InfoItem label="Başarı" value={formatPercentNumber(reportSuccessRate(detail?.report?.total))} />
        <InfoItem label="Soru" value={formatNumber(reportQuestionCount(detail?.report?.total))} />
        <InfoItem label={scoreView ? scoreViewLabel(scoreView) : isModernReport ? "Puan hesaplanamadı" : "Eski hesaplama"} value={formatNumber(score)} />
        <InfoItem label="Son net" value={formatNumber(detail?.report?.total?.net)} />
        <InfoItem label="Hata kitapçığı" value={detail?.errorBooklet?.items ? `${detail.errorBooklet.items.length} soru` : "-"} />
        <InfoItem
          label={isComparableStudentProgress(detail?.progress) ? "Başarı değişimi" : "Sınav geçmişi"}
          value={formatStudentProgressSummary(detail?.progress)}
        />
      </InfoGrid>
      {detail && detail.teacherNotes.length > 0 ? (
        <div className="next-form-guardians">
          <span className="next-field-hint">Son öğretmen notu</span>
          <ul>
            <li>{detail.teacherNotes[0]?.body}</li>
          </ul>
        </div>
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

// Liste kontrolündeki sıralama seçimi tablo başlığına aria-sort olarak yansır; başlık tıklaması aynı değeri yazar (UI/UX F12).
function resolveStudentSortDirection(sort: string): { columnKey?: StudentColumnKey; direction: "ascending" | "descending" } {
  const direction = sort.startsWith("-") ? "descending" : "ascending";
  const field = sort.replace(/^-/, "");
  const columnKey: StudentColumnKey | undefined = field === "studentNo" ? "studentNo"
    : field === "firstName" || field === "lastName" ? "name"
      : field === "classId" ? "class"
        : undefined;
  return { columnKey, direction };
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
const studentSortValues: ReadonlySet<string> = new Set(studentSortOptions.map((option) => option.value));

function readStudentListQuery(searchParams: QueryParamReader): CursorListQueryState {
  return readCursorListQueryFromUrl(searchParams, { sortValues: studentSortValues });
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
  listQuery: CursorListQueryState;
  tableDensity: StudentTableDensity;
  visibleColumnKeys: StudentColumnKey[];
}) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  writeCursorListQueryParams(params, listQuery, { defaultState: initialCursorListQuery });
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

async function loadStudents(accessToken: string, listQuery: CursorListQueryState, filters: StudentListFilters) {
  return apiCursorListRequest<StudentRecord>(accessToken, buildStudentListUrl(`${apiBaseUrl}/students`, listQuery, filters));
}

// limit is always sent, so GET /students runs in cursor mode (SQL registry) rather than the unpaged lookup list.
function buildStudentListUrl(baseUrl: string, state: CursorListQueryState, filters: StudentListFilters): string {
  return withQueryParams(buildCursorListUrl(baseUrl, state), filters);
}

function levelLabel(levelId: string, gradeLevels: GradeLevelRecord[]) {
  return gradeLevels.find((gradeLevel) => gradeLevel.id === levelId)?.name ?? "Seviye bilgisi alınamadı";
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
    enrollments,
    teacherNotes,
  ] = await Promise.all([
    apiRequestOrNull<AttendanceSummaryRecord>(accessToken, `${apiBaseUrl}/attendance/summary?studentId=${encodeURIComponent(id)}`),
    loadLatestErrorBooklet(accessToken, id, reportExamId),
    apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/profile`),
    apiRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardians`),
    loadStudentHomeworkAssignments(accessToken, id),
    apiRequest<PaymentPlanWithInstallmentsRecord[]>(accessToken, `${apiBaseUrl}/payment-plans?studentId=${encodeURIComponent(id)}`),
    reportExamId
      ? apiRequestOrNull<ReportStudentProgress>(accessToken, `${apiBaseUrl}/exams/${encodeURIComponent(reportExamId)}/reports/students/${encodeURIComponent(id)}/progress?scope=all`)
      : Promise.resolve(null),
    loadLatestStudentReport(accessToken, id, reportExamId),
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
    enrollments,
    teacherNotes,
  };
}

async function loadStudentHomeworkAssignments(accessToken: string, studentId: string) {
  return apiRequest<HomeworkMaterialAssignmentRecord[]>(
    accessToken,
    `${apiBaseUrl}/homework/material-assignments?studentId=${encodeURIComponent(studentId)}`,
  );
}

async function loadLatestStudentReport(accessToken: string, studentId: string, reportExamId: string): Promise<ReportStudentSnapshot | null> {
  if (!reportExamId) return null;
  const snapshot = await loadLatestSnapshot(accessToken, studentId, reportExamId);
  if (!snapshot) return null;
  return apiRequestOrNull<ReportStudentSnapshot>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(reportExamId)}/reports/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}`,
  );
}

async function loadLatestErrorBooklet(accessToken: string, studentId: string, reportExamId: string): Promise<ReportErrorBooklet | null> {
  if (!reportExamId) return null;
  const snapshot = await loadLatestSnapshot(accessToken, studentId, reportExamId);
  if (!snapshot) return null;
  return apiRequestOrNull<ReportErrorBooklet>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(reportExamId)}/reports/snapshots/${encodeURIComponent(snapshot.id)}/students/${encodeURIComponent(studentId)}/error-booklet`,
  );
}

async function loadLatestSnapshot(accessToken: string, studentId: string, reportExamId: string): Promise<ReportSnapshotRecord | null> {
  if (!reportExamId) return null;
  const snapshots = await apiRequest<ReportSnapshotRecord[]>(accessToken, `${apiBaseUrl}/exams/${encodeURIComponent(reportExamId)}/reports/snapshots`);
  return snapshots.find((snapshot) =>
    snapshot.status === "READY" && snapshot.snapshotData?.students?.some((student) => student.studentId === studentId),
  ) ?? null;
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL): Promise<T | null> {
  try {
    return await apiRequest<T>(accessToken, input);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

async function bulkRenewStudentEnrollments(accessToken: string, input: BulkEnrollmentActionState) {
  return apiRequest<{ updatedCount: number; enrollments: StudentEnrollmentRecord[] }>(accessToken, `${apiBaseUrl}/students/enrollments/bulk-renew`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function inviteStudentGuardians(accessToken: string, studentIds: string[], idempotencyKey: string) {
  return apiRequest<StudentGuardianInvitationBulkResult>(accessToken, `${apiBaseUrl}/students/guardian-invitations`, {
    body: JSON.stringify({ studentIds }),
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
    method: "POST",
  });
}

const guardianInvitationSkipLabels: Record<string, string> = {
  EMAIL_IN_USE: "e-posta başka hesapta/davette",
  EMAIL_MISSING: "e-posta yok",
  NO_LEGAL_GUARDIAN_CONTACT: "yasal veli iletişimi yok",
};

function formatGuardianInvitationSummary(result: StudentGuardianInvitationBulkResult): string {
  const reasons = new Map<string, number>();
  for (const row of result.results) {
    if (row.status === "SKIPPED" && row.reason) reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
  }
  const reasonText = [...reasons].map(([reason, count]) => `${guardianInvitationSkipLabels[reason] ?? reason}: ${count}`).join(", ");
  return `Davet gönderildi: ${result.createdCount} · Zaten var: ${result.alreadyExistsCount} · Atlandı: ${result.skippedCount}${reasonText ? ` (${reasonText})` : ""}`;
}

async function dryRunStudentImport(accessToken: string, fileBase64: string) {
  return apiRequest<StudentImportDryRunResult>(accessToken, `${apiBaseUrl}/students/imports/dry-run`, {
    body: JSON.stringify({ fileBase64 }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function commitStudentImport(accessToken: string, fileBase64: string, idempotencyKey: string) {
  return apiRequest<StudentImportResult>(accessToken, `${apiBaseUrl}/students/imports`, {
    body: JSON.stringify({ fileBase64 }),
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
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
        .filter((installment) => installment.status === "PENDING")
        .reduce((installmentSum, installment) => installmentSum + installment.amount, 0),
    0,
  );
  return formatMoney(total, plans[0]?.currency ?? "TRY");
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function legacyReportScore(report: ReportStudentSnapshot | null | undefined) {
  return report?.total.estimatedRawScore ?? report?.total.standardScore ?? report?.total.rawScore;
}

function scoreViewLabel(view: NonNullable<ReportStudentSnapshot["scoreViews"]>[number]) {
  if (view.status === "MISSING_TYT") return "Bağlı TYT deneme puanı yok";
  if (view.status === "NOT_ELIGIBLE") return `${view.type} hesaplanamadı`;
  return `${view.type} deneme puanı`;
}

function preferredScoreView(report: ReportStudentSnapshot) {
  return report.scoreViews?.find((view) => view.status === "CALCULATED") ?? report.scoreViews?.[0];
}

function formatCount(value: number) {
  return value.toLocaleString("tr-TR");
}

function formatByteSize(byteSize: number) {
  if (byteSize >= 1024 * 1024) {
    return `${(byteSize / (1024 * 1024)).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(byteSize / 1024)).toLocaleString("tr-TR")} KB`;
}

function inferStudentImportExtension(file: File): "CSV" | "XLSX" | undefined {
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLocaleUpperCase("tr-TR");
  if (extension === "CSV" || extension === "XLSX") return extension;
  if (file.type === "text/csv" || file.type === "text/plain") return "CSV";
  if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "XLSX";
  return undefined;
}

function formatGradeLevelDistribution(dryRun: StudentImportDryRunResult) {
  const counts = new Map<string, number>();
  for (const row of dryRun.validRows) {
    const label = row.gradeLevelName ?? "Seviye atanmadı";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size === 0) return "geçerli satır yok";
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "tr-TR"))
    .map(([label, count]) => `${label}: ${formatCount(count)}`)
    .join(" · ");
}

const schoolStructureImportErrorCodes = new Set(["CLASS_NOT_FOUND", "GRADE_LEVEL_NOT_FOUND", "CLASS_GRADE_LEVEL_MISMATCH"]);

function formatStudentImportError(error: StudentImportDryRunResult["errors"][number]) {
  const row = error.row > 0 ? `${error.row}. satır` : "Kota";
  if (error.code === "CLASS_GRADE_LEVEL_MISMATCH") return `${row}: sınıf ile seviye uyuşmuyor`;
  if (error.code === "CLASS_NOT_FOUND") return `${row}: sınıf bulunamadı (${error.value ?? "-"})`;
  if (error.code === "GRADE_LEVEL_AMBIGUOUS") return `${row}: seviye adı birden fazla kayıtla eşleşiyor`;
  if (error.code === "GRADE_LEVEL_NOT_FOUND") return `${row}: seviye bulunamadı (${error.value ?? "-"})`;
  if (error.code === "GRADE_LEVEL_REQUIRED") return `${row}: seviye veya seviyeye bağlı sınıf zorunlu`;
  if (error.code === "REQUIRED") return `${row}: ${studentImportFieldLabel(error.field)} zorunlu`;
  if (error.code === "STUDENT_NO_DUPLICATE") return `${row}: okul no tekrar ediyor`;
  if (error.code === "STUDENT_NATIONAL_ID_DUPLICATE") return `${row}: TC kimlik no dosyada tekrar ediyor veya kurumda kayıtlı (silinmiş öğrenci dahil)`;
  if (error.code === "INVALID_EMAIL") return `${row}: e-posta geçersiz`;
  if (error.code === "INVALID_DATE") return `${row}: tarih YYYY-AA-GG olmalı`;
  if (error.code === "INVALID_NATIONAL_ID") return `${row}: TC kimlik no geçersiz`;
  if (error.code === "INVALID_PHONE") return `${row}: telefon geçersiz`;
  if (error.code === "INVALID_RELATION_TYPE") return `${row}: iletişim kişisi ilişki türü geçersiz`;
  if (error.code === "CONTACT_COLUMNS_CONFLICT") return `${row}: veli ve iletişim kişisi sütunlarından yalnız biri dolu olmalı`;
  if (error.code === "ACTIVE_STUDENT_LIMIT_REACHED") return "Aktif öğrenci kotası aşılır";
  return `${row}: dosya satırı kontrol edilmeli`;
}

function studentImportFieldLabel(field: StudentImportDryRunResult["errors"][number]["field"]) {
  const labels: Record<StudentImportDryRunResult["errors"][number]["field"], string> = {
    className: "sınıf",
    contactEmail: "iletişim kişisi e-posta",
    contactFirstName: "iletişim kişisi adı",
    contactLastName: "iletişim kişisi soyadı",
    contactPhone: "iletişim kişisi telefonu",
    contactRelation: "iletişim kişisi ilişkisi",
    email: "e-posta",
    firstName: "ad",
    gradeLevelName: "seviye",
    guardian: "iletişim kişisi",
    lastName: "soyad",
    nationalId: "TC kimlik no",
    phone: "telefon",
    quota: "kota",
    studentNo: "okul no",
  };
  return labels[field];
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1] ?? "" : result);
    };
    reader.readAsDataURL(file);
  });
}

// UAT F-22: the stored responsibleTeacherId wins; otherwise the API's read-model fallback (the active CLASS_TEACHER of
// the student's class or a RESPONSIBLE_TEACHER assignment) is shown with its source, like the student detail lists it.
function formatResponsibleTeacher(student: StudentRecord, teacherNameById: ReadonlyMap<string, string>): string {
  if (student.responsibleTeacherId) return teacherNameById.get(student.responsibleTeacherId) ?? "—";
  if (!student.assignedTeacherId) return "—";
  const name = teacherNameById.get(student.assignedTeacherId);
  if (!name) return "—";
  return `${name} (${student.assignedTeacherRole === "CLASS_TEACHER" ? "sınıf öğretmeni" : "sorumlu ataması"})`;
}

function formatStudentStatus(status: StudentRecord["status"]) {
  const labels: Record<StudentRecord["status"], string> = {
    ACTIVE: "Aktif",
    GRADUATED: "Mezun",
    PASSIVE: "Pasif",
    TRANSFERRED: "Nakil",
  };
  return labels[status] ?? "Durum bilgisi alınamadı";
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
