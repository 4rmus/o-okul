"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  CrudPage,
  DataTable,
  EmptyState,
  Field,
  FormModal,
  Input,
  Panel,
  Select,
  StatusBadge,
  type DataTableColumn,
  type DataTableSortDirection,
  useConfirmDialog,
} from "@o-okul/ui";
import type { AcademicTermRecord, ClassRecord, CourseRecord, StudentRecord, TeacherAssignmentRecord, TeacherRecord } from "@o-okul/shared-types";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { ApiRequestError, apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import {
  firstFormError,
  teacherAssignmentFormSchema,
  teacherFormSchema,
  type TeacherAssignmentFormPayload,
  type TeacherAssignmentFormState,
  type TeacherFormPayload,
  type TeacherFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";
import { hasCapabilityForRoles } from "../../_shared/access.js";
import { loadPendingTeacherInvitations, teacherAccountLabels, teacherAccountState, teacherAccountTones } from "./teacher-account.js";

interface TeacherAssignmentReferences {
  classes: ClassRecord[];
  courses: CourseRecord[];
  students: StudentRecord[];
  terms: AcademicTermRecord[];
}

const emptyForm: TeacherFormState = {
  firstName: "",
  lastName: "",
  branch: "",
};

const emptyAssignmentForm: TeacherAssignmentFormState = {
  role: "CLASS_TEACHER",
  classId: "",
  studentId: "",
  courseId: "",
  termId: "",
  startsAt: "",
  endsAt: "",
};

const emptyReferences: TeacherAssignmentReferences = {
  classes: [],
  courses: [],
  students: [],
  terms: [],
};

export function TeachersPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: teacherSortOptions });
  const queryKey = ["next-teachers", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-teachers", auth?.session.tenantId ?? "anonymous"];
  const teachersQuery = useQuery({
    queryKey,
    queryFn: () => loadTeachers(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingTeacher, setEditingTeacher] = useState<TeacherRecord | null>(null);
  const [form, setForm] = useState<TeacherFormState>(emptyForm);
  const [assignmentForm, setAssignmentForm] = useState<TeacherAssignmentFormState>(emptyAssignmentForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const rows = teachersQuery.data?.data ?? [];
  const canManageAccounts = auth ? hasCapabilityForRoles(auth.session.roles, "user:manage") : false;
  const invitationsQuery = useQuery({
    queryKey: ["next-teacher-invitations", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadPendingTeacherInvitations(auth?.accessToken ?? ""),
    enabled: Boolean(auth && canManageAccounts && rows.some((teacher) => !teacher.hasAccount)),
    refetchOnWindowFocus: false,
  });
  const pendingInvitations = invitationsQuery.data ?? new Map();

  const referencesQuery = useQuery({
    queryKey: ["next-teacher-assignment-refs", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadTeacherAssignmentReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const references = referencesQuery.data ?? emptyReferences;
  const classes = references.classes;
  const classNameById = new Map(classes.map((klass) => [klass.id, klass.name]));
  const courses = references.courses;
  const courseNameById = new Map(courses.map((course) => [course.id, formatCourseName(course.name)]));
  const terms = references.terms;
  const termNameById = new Map(terms.map((term) => [term.id, term.name]));
  const students = references.students;
  const studentNameById = new Map(students.map((student) => [student.id, `${student.firstName} ${student.lastName}`]));
  const branchReadyCount = rows.filter((teacher) => Boolean(teacher.branch)).length;
  const teacherPortalReadyCount = rows.filter((teacher) => Boolean(teacher.hasAccount)).length;
  // UAT F-22: the assignment card sums the read-model counts GET /teachers carries (the same rows the detail lists),
  // not the size of the class/course/student catalogs.
  const assignmentTotals = rows.reduce(
    (totals, teacher) => ({
      total: totals.total + (teacher.assignmentSummary?.total ?? 0),
      classCount: totals.classCount + (teacher.assignmentSummary?.classCount ?? 0),
      courseCount: totals.courseCount + (teacher.assignmentSummary?.courseCount ?? 0),
    }),
    { total: 0, classCount: 0, courseCount: 0 },
  );
  const referencesUnavailable = referencesQuery.isError;
  const teacherSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Öğretmen toplamı",
      value: formatCount(teachersQuery.data?.meta?.total ?? rows.length),
    },
    {
      description: "Bu sayfada branş etiketi",
      key: "branch",
      label: "Branş kapsamı",
      tone: branchReadyCount > 0 ? "info" : "warning",
      value: `${branchReadyCount}/${rows.length}`,
    },
    {
      description: "Portal kullanıcısı bağlı",
      key: "portal",
      label: "Portal hazır",
      tone: teacherPortalReadyCount > 0 ? "success" : "default",
      value: `${teacherPortalReadyCount}/${rows.length}`,
    },
    {
      description: referencesUnavailable ? "Sınıf/ders/öğrenci referansları alınamadı" : "Sınıf/ders/öğrenci referansı",
      key: "references",
      label: "Atama bağlamı",
      tone: referencesUnavailable ? "warning" : undefined,
      value: referencesUnavailable ? "—" : `${classes.length}/${courses.length}/${students.length}`,
    },
  ];
  const teacherSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "sort",
      label: `Sıralama: ${formatTeacherSort(listQuery.sort)}`,
      tone: "neutral",
    },
  ];
  const teacherSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Bu sayfadaki branş etiketi",
      key: "branch-readiness",
      label: "Branş temizliği",
      status: branchReadyCount === rows.length && rows.length > 0 ? "Hazır" : "Kontrol",
      tone: branchReadyCount > 0 ? "info" : "warning",
      value: `${branchReadyCount}/${rows.length}`,
    },
    {
      detail: "Öğretmen portal hesabı bağlantısı",
      key: "portal-account",
      label: "Portal hesabı",
      status: teacherPortalReadyCount > 0 ? "Hazır" : "Hesap yok",
      tone: teacherPortalReadyCount > 0 ? "success" : "neutral",
      value: `${teacherPortalReadyCount}/${rows.length}`,
    },
    {
      detail: "Atama / sınıf bağı / ders bağı (bu sayfa)",
      key: "assignment-reference",
      label: "Atama referansı",
      status: assignmentTotals.total > 0 ? "Bağlı" : "Atama yok",
      tone: assignmentTotals.total > 0 ? "info" : "neutral",
      value: `${assignmentTotals.total}/${assignmentTotals.classCount}/${assignmentTotals.courseCount}`,
    },
  ];

  const assignmentsQueryKey = ["next-teacher-assignments", auth?.session.tenantId ?? "anonymous", editingTeacher?.id ?? "none"];
  const assignmentsQuery = useQuery({
    queryKey: assignmentsQueryKey,
    queryFn: () => loadTeacherAssignments(auth?.accessToken ?? "", editingTeacher?.id ?? ""),
    enabled: Boolean(auth && editingTeacher),
    refetchOnWindowFocus: false,
  });
  const assignments = assignmentsQuery.data ?? [];

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  // Başlık tıklaması "Sırala" seçimiyle aynı URL sıralama durumunu yazar ve aria-sort ile yansır (UI/UX F12).
  const activeSortField = listQuery.sort.replace(/^-/, "");
  const activeSortDirection: DataTableSortDirection = listQuery.sort.startsWith("-") ? "descending" : "ascending";
  const sortByHeader = (ascendingValue: string, direction: DataTableSortDirection) => {
    setListQuery({ ...listQuery, page: 1, sort: direction === "descending" ? `-${ascendingValue}` : ascendingValue });
  };
  const columns: Array<DataTableColumn<TeacherRecord>> = [
    {
      key: "name",
      header: "Ad Soyad",
      // Ad Soyad başlığı adı sıralar; "Sırala" seçiminden soyad seçildiyse başlık soyad yönünü değiştirir.
      onSort: (direction) => sortByHeader(activeSortField === "lastName" ? "lastName" : "firstName", direction),
      priority: "primary",
      sortDirection: activeSortField === "firstName" || activeSortField === "lastName" ? activeSortDirection : undefined,
      sticky: "left",
      render: (teacher) => `${teacher.firstName} ${teacher.lastName}`,
    },
    {
      key: "branch",
      header: "Branş",
      onSort: (direction) => sortByHeader("branch", direction),
      priority: "primary",
      sortDirection: activeSortField === "branch" ? activeSortDirection : undefined,
      render: (teacher) =>
        teacher.branch ? (
          <StatusBadge tone="info">{teacher.branch}</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Branş yok</StatusBadge>
        ),
    },
    {
      key: "portal",
      header: "Portal",
      priority: "secondary",
      render: (teacher) => {
        const state = teacherAccountState(teacher, pendingInvitations);
        return <StatusBadge tone={teacherAccountTones[state]}>{teacherAccountLabels[state]}</StatusBadge>;
      },
    },
    {
      key: "assignments",
      header: "Atama",
      priority: "secondary",
      render: (teacher) => formatAssignmentSummary(teacher.assignmentSummary),
    },
    {
      key: "actions",
      header: "İşlem",
      align: "center",
      priority: "primary",
      sticky: "right",
      render: (teacher) => (
        <span className="next-row-actions">
          {/* UAT F-23: full name like the employees screen, so two teachers with the same first name stay distinct. */}
          <Link href={`/kurum/ogretmenler/${encodeURIComponent(teacher.id)}`} aria-label={`${teacher.firstName} ${teacher.lastName} detay`}>
            <Eye size={17} aria-hidden="true" />
          </Link>
          <Button size="icon" variant="ghost" type="button" onClick={() => openEditForm(teacher)} aria-label={`${teacher.firstName} ${teacher.lastName} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" type="button" onClick={() => void handleDelete(teacher)} aria-label={`${teacher.firstName} ${teacher.lastName} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingTeacher(null);
    setForm(emptyForm);
    setAssignmentForm(emptyAssignmentForm);
    setAssignmentError(null);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(teacher: TeacherRecord) {
    setEditingTeacher(teacher);
    setForm({
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      branch: teacher.branch ?? "",
    });
    setAssignmentForm(emptyAssignmentForm);
    setAssignmentError(null);
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingTeacher(null);
    setForm(emptyForm);
    setAssignmentForm(emptyAssignmentForm);
    setAssignmentError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = teacherFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedTeacher = editingTeacher
        ? await updateTeacher(auth.accessToken, editingTeacher.id, parsedForm.data)
        : await createTeacher(auth.accessToken, parsedForm.data);
      void savedTeacher;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Öğretmen kaydedilemedi.");
    }
  }

  async function handleDelete(teacher: TeacherRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${teacher.firstName} ${teacher.lastName} öğretmeni silinsin mi?`,
      title: "Öğretmeni sil",
    });
    if (!confirmed) return;

    setError("");
    try {
      await deleteTeacher(auth.accessToken, teacher.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Öğretmen silinemedi.");
    }
  }

  async function handleAssignmentSubmit() {
    if (!auth || !editingTeacher) return;

    setAssignmentError(null);
    const parsedForm = teacherAssignmentFormSchema.safeParse(assignmentForm);
    if (!parsedForm.success) {
      setAssignmentError(firstFormError(parsedForm.error));
      return;
    }

    try {
      await createTeacherAssignment(auth.accessToken, editingTeacher.id, parsedForm.data);
      setAssignmentForm(emptyAssignmentForm);
      void queryClient.invalidateQueries({ queryKey: assignmentsQueryKey });
    } catch (failure) {
      setAssignmentError(teacherAssignmentErrorMessage(failure));
    }
  }

  async function handleAssignmentDelete(assignment: TeacherAssignmentRecord) {
    if (!auth || !editingTeacher) return;
    setAssignmentError(null);
    try {
      await deleteTeacherAssignment(auth.accessToken, editingTeacher.id, assignment.id);
      void queryClient.invalidateQueries({ queryKey: assignmentsQueryKey });
    } catch (failure) {
      setAssignmentError(teacherAssignmentErrorMessage(failure));
    }
  }

  const assignmentColumns: Array<DataTableColumn<TeacherAssignmentRecord>> = [
    {
      key: "role",
      header: "Rol",
      mobilePriority: "primary",
      priority: "primary",
      render: (assignment) => (
        <StatusBadge tone={teacherAssignmentRoleTone(assignment.role)}>
          {formatTeacherAssignmentRole(assignment.role)}
        </StatusBadge>
      ),
      sticky: "left",
    },
    {
      key: "scope",
      header: "Kapsam",
      mobilePriority: "primary",
      priority: "primary",
      render: (assignment) => formatTeacherAssignmentScope(assignment, classNameById, studentNameById, courseNameById),
    },
    {
      key: "context",
      header: "Dönem ve tarih",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (assignment) => formatTeacherAssignmentContext(assignment, termNameById),
    },
    {
      align: "center",
      key: "actions",
      header: "İşlem",
      mobilePriority: "primary",
      priority: "primary",
      render: (assignment) => (
        <Button size="icon" variant="ghost"
          type="button"
          onClick={() => void handleAssignmentDelete(assignment)}
          aria-label={`${formatTeacherAssignmentRole(assignment.role)} atamasını sil`}
        >
          <Trash2 size={16} aria-hidden="true" />
        </Button>
      ),
      sticky: "right",
    },
  ];

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={teachersQuery.data?.meta}
              onChange={setListQuery}
              searchPlaceholder="Ad, soyad veya branş ara"
              sortOptions={teacherSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Öğretmen ekle
            </Button>
          </>
        }
        aria-label="Öğretmen yönetimi"
        columns={columns}
        density="compact"
        description="Ders, sınıf, rehberlik ve portal hesabı ilişkilerini tek yerden yönet."
        emptyState={
          <EmptyState
            title="Henüz öğretmen yok"
            description="Öğretmen ekleyerek ders programı, yoklama ve öğrenci sorumluluğu akışlarını hazırla."
            primaryAction={{ label: "Öğretmen ekle", onClick: openCreateForm }}
            secondaryAction={{ label: "Kuruluma dön", href: "/kurum/kurulum" }}
          />
        }
        emptyText="Öğretmen kaydı yok"
        error={error || (teachersQuery.isError ? "Öğretmenler alınamadı." : undefined)}
        getRowKey={(teacher) => teacher.id}
        hasActiveFilters={Boolean(listQuery.q.trim())}
        loading={teachersQuery.isPending}
        rows={rows}
        summary={
          <OperationSummary
            actions={teacherSummaryActions}
            ariaLabel="Öğretmen operasyon özeti"
            badges={teacherSummaryBadges}
            items={teacherSummaryItems}
          />
        }
        tableCaption="Öğretmen operasyon listesi"
        tableDescription="Ad soyad, branş, portal bağlantısı ve öğretmen aksiyonları."
        hideTitle
        title="Öğretmenler"
      />
      <FormModal
        description="Ad ve soyad alanları zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingTeacher ? "Kaydet" : "Ekle"}
        title={editingTeacher ? "Öğretmen düzenle" : "Öğretmen ekle"}
      >
        <div className="next-teacher-form-grid">
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
          <Field label="Branş" description="Liste ve atama ekranlarında kısa etiket olarak görünür.">
            <Input
              value={form.branch ?? ""}
              onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}
            />
          </Field>
        </div>
        {editingTeacher ? (
          <Panel
            aria-label="Öğretmen atamaları"
            className="next-teacher-assignment-section"
            title="Öğretmen atamaları"
            description="Sınıf, öğrenci, ders ve dönem bağlamı birlikte tutulur."
            tone="muted"
            actions={
              <StatusBadge tone={assignments.length > 0 ? "success" : "neutral"}>
                {assignments.length > 0 ? `${assignments.length} atama` : "Atama yok"}
              </StatusBadge>
            }
          >
            <DataTable
              caption="Öğretmen atamaları"
              columns={assignmentColumns}
              density="compact"
              description="Sınıf, öğrenci, ders, dönem ve tarih bağlamıyla tanımlı öğretmen atamaları."
              emptyText="Bu öğretmen için sınıf, öğrenci veya ders ataması henüz tanımlanmadı."
              getRowKey={(assignment) => assignment.id}
              loading={assignmentsQuery.isPending}
              rows={assignments}
            />
            <div className="next-assignment-form-grid" aria-label="Yeni öğretmen ataması">
              <Field label="Atama rolü">
                <Select
                  value={assignmentForm.role}
                  onChange={(event) => setAssignmentForm((current) => ({
                    ...current,
                    role: event.target.value as TeacherAssignmentRecord["role"],
                  }))}
                >
                  <option value="CLASS_TEACHER">Sınıf öğretmeni</option>
                  <option value="BRANCH_TEACHER">Branş öğretmeni</option>
                  <option value="GUIDANCE_COUNSELOR">Rehber öğretmen</option>
                  <option value="RESPONSIBLE_TEACHER">Sorumlu öğretmen</option>
                </Select>
              </Field>
              <Field label="Atama sınıfı">
                <Select
                  value={assignmentForm.classId}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, classId: event.target.value }))}
                >
                  <option value="">Sınıf seçilmedi</option>
                  {classes.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Atama öğrencisi">
                <Select
                  value={assignmentForm.studentId}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, studentId: event.target.value }))}
                >
                  <option value="">Öğrenci seçilmedi</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.firstName} {student.lastName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Atama branşı">
                <Select
                  value={assignmentForm.courseId}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, courseId: event.target.value }))}
                >
                  <option value="">Branş seçilmedi</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {formatCourseName(course.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Atama dönemi">
                <Select
                  value={assignmentForm.termId}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, termId: event.target.value }))}
                >
                  <option value="">Dönem seçilmedi</option>
                  {terms.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Başlangıç">
                <Input
                  type="date"
                  value={assignmentForm.startsAt}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, startsAt: event.target.value }))}
                />
              </Field>
              <Field label="Bitiş">
                <Input
                  type="date"
                  value={assignmentForm.endsAt}
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, endsAt: event.target.value }))}
                />
              </Field>
            </div>
            <Button type="button" onClick={() => void handleAssignmentSubmit()}>
              <Plus size={17} aria-hidden="true" />
              Atama ekle
            </Button>
            {assignmentError ? <TeacherAssignmentError message={assignmentError} /> : null}
          </Panel>
        ) : null}
      </FormModal>
      {confirmationDialog}
    </>
  );
}

// UAT F-22: same counting as the teacher detail ("Atama toplamı", "Sınıf kapsamı", "Ders kapsamı").
function formatAssignmentSummary(summary: TeacherRecord["assignmentSummary"]) {
  if (!summary) return "—";
  if (summary.total === 0) return <StatusBadge tone="neutral">Atama yok</StatusBadge>;
  return `${formatCount(summary.total)} atama · ${formatCount(summary.classCount)} sınıf · ${formatCount(summary.courseCount)} ders`;
}

const teacherSortOptions = [
  { label: "Ad A-Z", value: "firstName" },
  { label: "Ad Z-A", value: "-firstName" },
  { label: "Soyad A-Z", value: "lastName" },
  { label: "Soyad Z-A", value: "-lastName" },
  { label: "Branş A-Z", value: "branch" },
  { label: "Branş Z-A", value: "-branch" },
];

async function loadTeachers(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<TeacherRecord>(accessToken, buildListUrl(`${apiBaseUrl}/teachers`, listQuery));
}

async function loadTeacherAssignmentReferences(accessToken: string): Promise<TeacherAssignmentReferences> {
  const [classes, courses, students, terms] = await Promise.all([
    apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`),
    apiRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`),
    apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students`),
    apiRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return { classes, courses, students, terms };
}

async function loadTeacherAssignments(accessToken: string, teacherId: string) {
  return apiRequest<TeacherAssignmentRecord[]>(accessToken, `${apiBaseUrl}/teachers/${encodeURIComponent(teacherId)}/assignments`);
}

async function createTeacher(accessToken: string, input: TeacherFormPayload) {
  return apiRequest<TeacherRecord>(accessToken, `${apiBaseUrl}/teachers`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateTeacher(accessToken: string, id: string, input: TeacherFormPayload) {
  return apiRequest<TeacherRecord>(accessToken, `${apiBaseUrl}/teachers/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function createTeacherAssignment(accessToken: string, teacherId: string, input: TeacherAssignmentFormPayload) {
  return apiRequest<TeacherAssignmentRecord>(accessToken, `${apiBaseUrl}/teachers/${encodeURIComponent(teacherId)}/assignments`, {
    body: JSON.stringify({
      role: input.role,
      classId: input.classId || undefined,
      studentId: input.studentId || undefined,
      courseId: input.courseId || undefined,
      termId: input.termId || undefined,
      startsAt: input.startsAt || undefined,
      endsAt: input.endsAt || undefined,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function deleteTeacherAssignment(accessToken: string, teacherId: string, assignmentId: string) {
  await apiRequest<void>(
    accessToken,
    `${apiBaseUrl}/teachers/${encodeURIComponent(teacherId)}/assignments/${encodeURIComponent(assignmentId)}`,
    { method: "DELETE" },
  );
}

async function deleteTeacher(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/teachers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("TEACHER_DELETE_FAILED");
  }
}

// Codes thrown by TeacherService assignment create/update/delete (apps/api/src/teacher/teacher.service.ts) and the
// SchoolService lookups it calls. COURSE_GRADE_LEVEL_MISMATCH is rendered with a link in TeacherAssignmentError.
const teacherAssignmentErrors: Record<string, string> = {
  TEACHER_ASSIGNMENT_COURSE_GRADE_LEVEL_MISMATCH: "Bu ders bu sınıfın seviyesine bağlı değil. Seviyeler ekranından dersi seviyeye bağlayın.",
  TEACHER_ASSIGNMENT_TARGET_REQUIRED: "Atama için sınıf veya öğrenci seçilmelidir.",
  TEACHER_ASSIGNMENT_ROLE_INVALID: "Atama rolü geçersiz. Listeden bir rol seçin.",
  TEACHER_ASSIGNMENT_STARTS_AT_INVALID: "Başlangıç tarihi geçersiz.",
  TEACHER_ASSIGNMENT_ENDS_AT_INVALID: "Bitiş tarihi geçersiz.",
  TEACHER_ASSIGNMENT_NOT_FOUND: "Atama bulunamadı; başka bir kullanıcı silmiş olabilir. Listeyi yenileyin.",
  TEACHER_NOT_FOUND: "Öğretmen kaydı bulunamadı. Sayfayı yenileyin.",
  CLASS_NOT_FOUND: "Seçilen sınıf bulunamadı. Sayfayı yenileyip yeniden seçin.",
  STUDENT_NOT_FOUND: "Seçilen öğrenci bulunamadı. Sayfayı yenileyip yeniden seçin.",
  COURSE_NOT_FOUND: "Seçilen ders bulunamadı. Sayfayı yenileyip yeniden seçin.",
  ACADEMIC_TERM_NOT_FOUND: "Seçilen dönem bulunamadı. Sayfayı yenileyip yeniden seçin.",
  FORBIDDEN_TENANT: "Bu kayıt kurumunuza ait değil.",
};
const teacherAssignmentFallbackError = "Atama kaydedilemedi. Bilgileri kontrol edip tekrar deneyin.";

function teacherAssignmentErrorMessage(failure: unknown) {
  const code = failure instanceof ApiRequestError ? failure.code ?? "" : "";
  return teacherAssignmentErrors[code] ?? teacherAssignmentFallbackError;
}

function TeacherAssignmentError({ message }: { message: string }) {
  return (
    <Alert tone="danger">
      {message}
      {message === teacherAssignmentErrors.TEACHER_ASSIGNMENT_COURSE_GRADE_LEVEL_MISMATCH ? (
        <>
          {" "}
          <Link href="/kurum/seviyeler">Seviyeler ekranına git</Link>
        </>
      ) : null}
    </Alert>
  );
}

function formatTeacherAssignmentRole(role: TeacherAssignmentRecord["role"]) {
  const labels: Record<TeacherAssignmentRecord["role"], string> = {
    BRANCH_TEACHER: "Branş öğretmeni",
    CLASS_TEACHER: "Sınıf öğretmeni",
    GUIDANCE_COUNSELOR: "Rehber öğretmen",
    RESPONSIBLE_TEACHER: "Sorumlu öğretmen",
  };
  return labels[role] ?? role;
}

function teacherAssignmentRoleTone(role: TeacherAssignmentRecord["role"]) {
  if (role === "CLASS_TEACHER") return "success";
  if (role === "GUIDANCE_COUNSELOR") return "warning";
  if (role === "RESPONSIBLE_TEACHER") return "info";
  return "neutral";
}

function formatTeacherAssignmentScope(
  assignment: TeacherAssignmentRecord,
  classNameById: ReadonlyMap<string, string>,
  studentNameById: ReadonlyMap<string, string>,
  courseNameById: ReadonlyMap<string, string>,
) {
  const scope = [
    assignment.classId ? classNameById.get(assignment.classId) ?? "Sınıf eşleşmedi" : undefined,
    assignment.studentId ? studentNameById.get(assignment.studentId) ?? "Öğrenci eşleşmedi" : undefined,
    assignment.courseId ? courseNameById.get(assignment.courseId) ?? "Ders eşleşmedi" : undefined,
  ].filter(Boolean);
  return scope.length > 0 ? scope.join(" · ") : "Kapsam seçilmedi";
}

function formatTeacherAssignmentContext(assignment: TeacherAssignmentRecord, termNameById: ReadonlyMap<string, string>) {
  const context = [
    assignment.termId ? termNameById.get(assignment.termId) ?? "Dönem eşleşmedi" : "Dönem seçilmedi",
    formatAssignmentDateRange(assignment),
  ].filter(Boolean);
  return context.join(" · ");
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
  return value.toLocaleString("tr-TR");
}

function formatTeacherSort(value: string) {
  return teacherSortOptions.find((option) => option.value === value)?.label ?? "Varsayılan";
}
