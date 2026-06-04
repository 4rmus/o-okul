"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import type { AcademicTermRecord, ClassRecord, CourseRecord, StudentRecord, TeacherAssignmentRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  firstFormError,
  teacherAssignmentFormSchema,
  teacherFormSchema,
  type TeacherAssignmentFormPayload,
  type TeacherAssignmentFormState,
  type TeacherFormPayload,
  type TeacherFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

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
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
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
  const rows = teachersQuery.data?.data ?? [];

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
  const courseNameById = new Map(courses.map((course) => [course.id, course.name]));
  const terms = references.terms;
  const termNameById = new Map(terms.map((term) => [term.id, term.name]));
  const students = references.students;
  const studentNameById = new Map(students.map((student) => [student.id, `${student.firstName} ${student.lastName}`]));

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

  const columns: Array<DataTableColumn<TeacherRecord>> = [
    {
      key: "name",
      header: "Ad Soyad",
      render: (teacher) => `${teacher.firstName} ${teacher.lastName}`,
    },
    {
      key: "branch",
      header: "Branş",
      render: (teacher) => teacher.branch ?? "-",
    },
    {
      key: "actions",
      header: "İşlem",
      render: (teacher) => (
        <span className="next-row-actions">
          <Link href={`/kurum/kullanicilar?invite=teacher&subjectId=${encodeURIComponent(teacher.id)}`} aria-label={`${teacher.firstName} portal daveti gönder`}>
            <Send size={17} aria-hidden="true" />
          </Link>
          <button type="button" onClick={() => openEditForm(teacher)} aria-label={`${teacher.firstName} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(teacher)} aria-label={`${teacher.firstName} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingTeacher(null);
    setForm(emptyForm);
    setAssignmentForm(emptyAssignmentForm);
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
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingTeacher(null);
    setForm(emptyForm);
    setAssignmentForm(emptyAssignmentForm);
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
    if (!window.confirm(`${teacher.firstName} ${teacher.lastName} silinsin mi?`)) return;

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

    setError("");
    const parsedForm = teacherAssignmentFormSchema.safeParse(assignmentForm);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      await createTeacherAssignment(auth.accessToken, editingTeacher.id, parsedForm.data);
      setAssignmentForm(emptyAssignmentForm);
      void queryClient.invalidateQueries({ queryKey: assignmentsQueryKey });
    } catch {
      setError("Öğretmen ataması kaydedilemedi.");
    }
  }

  async function handleAssignmentDelete(assignment: TeacherAssignmentRecord) {
    if (!auth || !editingTeacher) return;
    setError("");
    try {
      await deleteTeacherAssignment(auth.accessToken, editingTeacher.id, assignment.id);
      void queryClient.invalidateQueries({ queryKey: assignmentsQueryKey });
    } catch {
      setError("Öğretmen ataması silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={teachersQuery.data?.meta}
              onChange={setListQuery}
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
        description="Kurum öğretmenlerini aynı CRUD kalıbıyla yönet."
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
        loading={teachersQuery.isPending}
        rows={rows}
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
          Branş
          <Input
            value={form.branch ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}
          />
        </label>
        {editingTeacher ? (
          <section className="next-form-section" aria-label="Öğretmen atamaları">
            <p className="next-form-section-title">Öğretmen atamaları</p>
            {assignmentsQuery.isPending ? (
              <span className="next-field-hint">Yükleniyor…</span>
            ) : assignments.length > 0 ? (
              <ul className="next-form-list">
                {assignments.map((assignment) => (
                  <li key={assignment.id}>
                    <span>
                      {formatTeacherAssignmentRole(assignment.role)}
                      {assignment.classId ? ` · ${classNameById.get(assignment.classId) ?? assignment.classId}` : ""}
                      {assignment.studentId ? ` · ${studentNameById.get(assignment.studentId) ?? assignment.studentId}` : ""}
                      {assignment.courseId ? ` · ${courseNameById.get(assignment.courseId) ?? assignment.courseId}` : ""}
                      {assignment.termId ? ` · ${termNameById.get(assignment.termId) ?? assignment.termId}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleAssignmentDelete(assignment)}
                      aria-label={`${formatTeacherAssignmentRole(assignment.role)} atamasını sil`}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="next-field-hint">Atama yok</span>
            )}
            <label>
              Atama rolü
              <select
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
              </select>
            </label>
            <label>
              Atama sınıfı
              <select
                value={assignmentForm.classId}
                onChange={(event) => setAssignmentForm((current) => ({ ...current, classId: event.target.value }))}
              >
                <option value="">Sınıf seçilmedi</option>
                {classes.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Atama öğrencisi
              <select
                value={assignmentForm.studentId}
                onChange={(event) => setAssignmentForm((current) => ({ ...current, studentId: event.target.value }))}
              >
                <option value="">Öğrenci seçilmedi</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.firstName} {student.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Atama branşı
              <select
                value={assignmentForm.courseId}
                onChange={(event) => setAssignmentForm((current) => ({ ...current, courseId: event.target.value }))}
              >
                <option value="">Branş seçilmedi</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Atama dönemi
              <select
                value={assignmentForm.termId}
                onChange={(event) => setAssignmentForm((current) => ({ ...current, termId: event.target.value }))}
              >
                <option value="">Dönem seçilmedi</option>
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Başlangıç
              <Input
                type="date"
                value={assignmentForm.startsAt}
                onChange={(event) => setAssignmentForm((current) => ({ ...current, startsAt: event.target.value }))}
              />
            </label>
            <label>
              Bitiş
              <Input
                type="date"
                value={assignmentForm.endsAt}
                onChange={(event) => setAssignmentForm((current) => ({ ...current, endsAt: event.target.value }))}
              />
            </label>
            <Button type="button" onClick={() => void handleAssignmentSubmit()}>
              <Plus size={17} aria-hidden="true" />
              Atama ekle
            </Button>
          </section>
        ) : null}
      </FormModal>
    </>
  );
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
  const response = await authenticatedFetch(
    accessToken,
    `${apiBaseUrl}/teachers/${encodeURIComponent(teacherId)}/assignments/${encodeURIComponent(assignmentId)}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    throw new Error("TEACHER_ASSIGNMENT_DELETE_FAILED");
  }
}

async function deleteTeacher(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/teachers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("TEACHER_DELETE_FAILED");
  }
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
