"use client";

import { type FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CourseRecord } from "@uzman-hocam/shared-types";
import { Button, CrudPage, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  courseFormSchema,
  firstFormError,
  type CourseFormPayload,
  type CourseFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

const emptyForm: CourseFormState = {
  name: "",
  code: "",
};

export function CoursesPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const queryKey = ["next-courses", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-courses", auth?.session.tenantId ?? "anonymous"];
  const coursesQuery = useQuery({
    queryKey,
    queryFn: () => loadCourses(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingCourse, setEditingCourse] = useState<CourseRecord | null>(null);
  const [form, setForm] = useState<CourseFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = coursesQuery.data?.data ?? [];

  const columns: Array<DataTableColumn<CourseRecord>> = [
    {
      key: "name",
      header: "Ders",
      render: (record) => record.name,
    },
    {
      key: "code",
      header: "Kod",
      render: (record) => record.code ?? "-",
    },
    {
      key: "actions",
      header: "İşlem",
      render: (record) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openEditForm(record)} aria-label={`${record.name} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(record)} aria-label={`${record.name} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingCourse(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(record: CourseRecord) {
    setEditingCourse(record);
    setForm({ name: record.name, code: record.code ?? "" });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingCourse(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = courseFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedCourse = editingCourse
        ? await updateCourse(auth.accessToken, editingCourse.id, parsedForm.data)
        : await createCourse(auth.accessToken, parsedForm.data);
      void savedCourse;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Ders kaydedilemedi.");
    }
  }

  async function handleDelete(record: CourseRecord) {
    if (!auth) return;
    if (!window.confirm(`${record.name} silinsin mi?`)) return;

    setError("");
    try {
      await deleteCourse(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Ders silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={coursesQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={courseSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Ders ekle
            </Button>
          </>
        }
        aria-label="Ders yönetimi"
        columns={columns}
        description="Kurum derslerini aynı CRUD kalıbıyla yönet."
        emptyText="Ders kaydı yok"
        error={error || (coursesQuery.isError ? "Dersler alınamadı." : undefined)}
        getRowKey={(record) => record.id}
        loading={coursesQuery.isPending}
        rows={rows}
        title="Dersler"
      />
      <FormModal
        description="Ders adı zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingCourse ? "Kaydet" : "Ekle"}
        title={editingCourse ? "Ders düzenle" : "Ders ekle"}
      >
        <label>
          Ders adı
          <Input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label>
          Kod
          <Input
            value={form.code ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
          />
        </label>
      </FormModal>
    </>
  );
}

const courseSortOptions = [
  { label: "Ders A-Z", value: "name" },
  { label: "Ders Z-A", value: "-name" },
  { label: "Kod A-Z", value: "code" },
  { label: "Kod Z-A", value: "-code" },
];

async function loadCourses(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<CourseRecord>(accessToken, buildListUrl(`${apiBaseUrl}/courses`, listQuery));
}

async function createCourse(accessToken: string, input: CourseFormPayload) {
  return apiRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateCourse(accessToken: string, id: string, input: CourseFormPayload) {
  return apiRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteCourse(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/courses/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("COURSE_DELETE_FAILED");
  }
}
