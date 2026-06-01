"use client";

import { type FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import type { AnnouncementRecord } from "@uzman-hocam/shared-types";
import { Plus } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import {
  announcementFormSchema,
  firstFormError,
  type AnnouncementFormPayload,
  type AnnouncementFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

const emptyForm: AnnouncementFormState = {
  title: "",
  body: "",
  audience: "SCHOOL",
};

export function AnnouncementsPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const queryKey = ["next-announcements", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-announcements", auth?.session.tenantId ?? "anonymous"];
  const announcementsQuery = useQuery({
    queryKey,
    queryFn: () => loadAnnouncements(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [form, setForm] = useState<AnnouncementFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = announcementsQuery.data?.data ?? [];

  const columns: Array<DataTableColumn<AnnouncementRecord>> = [
    {
      key: "title",
      header: "Başlık",
      render: (announcement) => announcement.title,
    },
    {
      key: "audience",
      header: "Hedef",
      render: (announcement) => audienceLabel(announcement.audience),
    },
    {
      key: "publishedAt",
      header: "Yayın",
      render: (announcement) => new Date(announcement.publishedAt).toLocaleDateString("tr-TR"),
    },
  ];

  function openCreateForm() {
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = announcementFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      await createAnnouncement(auth.accessToken, parsedForm.data);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Duyuru yayınlanamadı.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={announcementsQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={announcementSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Duyuru ekle
            </Button>
          </>
        }
        aria-label="Duyuru yönetimi"
        columns={columns}
        description="Kurum ve öğretmen duyurularını aynı liste kalıbıyla yayınla."
        emptyText="Duyuru kaydı yok"
        error={error || (announcementsQuery.isError ? "Duyurular alınamadı." : undefined)}
        getRowKey={(announcement) => announcement.id}
        loading={announcementsQuery.isPending}
        rows={rows}
        title="Duyurular"
      />
      <FormModal
        description="Başlık ve duyuru metni zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel="Yayınla"
        title="Duyuru ekle"
      >
        <label>
          Başlık
          <Input
            required
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <label>
          Duyuru metni
          <Input
            required
            value={form.body}
            onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
          />
        </label>
        <label>
          Hedef
          <select
            value={form.audience}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                audience: event.target.value as AnnouncementRecord["audience"],
              }))
            }
          >
            <option value="SCHOOL">Tüm okul</option>
            <option value="TEACHERS">Öğretmenler</option>
          </select>
        </label>
      </FormModal>
    </>
  );
}

const announcementSortOptions = [
  { label: "Başlık A-Z", value: "title" },
  { label: "Başlık Z-A", value: "-title" },
  { label: "Yayın eski-yeni", value: "publishedAt" },
  { label: "Yayın yeni-eski", value: "-publishedAt" },
];

async function loadAnnouncements(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<AnnouncementRecord>(accessToken, buildListUrl(`${apiBaseUrl}/announcements`, listQuery));
}

async function createAnnouncement(accessToken: string, input: AnnouncementFormPayload) {
  return apiRequest<AnnouncementRecord>(accessToken, `${apiBaseUrl}/announcements`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function audienceLabel(audience: AnnouncementRecord["audience"]) {
  return audience === "TEACHERS" ? "Öğretmenler" : "Tüm okul";
}
