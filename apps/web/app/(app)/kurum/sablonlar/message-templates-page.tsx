"use client";

import { type FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import type { MessageTemplateRecord } from "@uzman-hocam/shared-types";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  firstFormError,
  messageTemplateFormSchema,
  type MessageTemplateFormPayload,
  type MessageTemplateFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

const emptyForm: MessageTemplateFormState = {
  name: "",
  body: "",
};

export function MessageTemplatesPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const queryKey = ["next-message-templates", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-message-templates", auth?.session.tenantId ?? "anonymous"];
  const templatesQuery = useQuery({
    queryKey,
    queryFn: () => loadMessageTemplates(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplateRecord | null>(null);
  const [form, setForm] = useState<MessageTemplateFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = templatesQuery.data?.data ?? [];

  const columns: Array<DataTableColumn<MessageTemplateRecord>> = [
    {
      key: "name",
      header: "Şablon",
      render: (template) => template.name,
    },
    {
      key: "channel",
      header: "Kanal",
      render: (template) => template.channel,
    },
    {
      key: "body",
      header: "Metin",
      render: (template) => template.body,
    },
    {
      key: "actions",
      header: "İşlem",
      render: (template) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openEditForm(template)} aria-label={`${template.name} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(template)} aria-label={`${template.name} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingTemplate(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(template: MessageTemplateRecord) {
    setEditingTemplate(template);
    setForm({ name: template.name, body: template.body });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingTemplate(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = messageTemplateFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedTemplate = editingTemplate
        ? await updateMessageTemplate(auth.accessToken, editingTemplate.id, parsedForm.data)
        : await createMessageTemplate(auth.accessToken, parsedForm.data);
      void savedTemplate;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Şablon kaydedilemedi.");
    }
  }

  async function handleDelete(template: MessageTemplateRecord) {
    if (!auth) return;
    if (!window.confirm(`${template.name} silinsin mi?`)) return;

    setError("");
    try {
      await deleteMessageTemplate(auth.accessToken, template.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Şablon silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={templatesQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={messageTemplateSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Şablon ekle
            </Button>
          </>
        }
        aria-label="Şablon yönetimi"
        columns={columns}
        description="SMS mesaj şablonlarını aynı CRUD kalıbıyla yönet."
        emptyText="Şablon kaydı yok"
        error={error || (templatesQuery.isError ? "Şablonlar alınamadı." : undefined)}
        getRowKey={(template) => template.id}
        loading={templatesQuery.isPending}
        rows={rows}
        title="Şablonlar"
      />
      <FormModal
        description="Şablon adı ve metni zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingTemplate ? "Kaydet" : "Ekle"}
        title={editingTemplate ? "Şablon düzenle" : "Şablon ekle"}
      >
        <label>
          Şablon adı
          <Input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label>
          Mesaj metni
          <Input
            required
            value={form.body}
            onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
          />
        </label>
      </FormModal>
    </>
  );
}

const messageTemplateSortOptions = [
  { label: "Şablon A-Z", value: "name" },
  { label: "Şablon Z-A", value: "-name" },
  { label: "Metin A-Z", value: "body" },
  { label: "Metin Z-A", value: "-body" },
];

async function loadMessageTemplates(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<MessageTemplateRecord>(accessToken, buildListUrl(`${apiBaseUrl}/message-templates`, listQuery));
}

async function createMessageTemplate(accessToken: string, input: MessageTemplateFormPayload) {
  return apiRequest<MessageTemplateRecord>(accessToken, `${apiBaseUrl}/message-templates`, {
    body: JSON.stringify({ ...input, channel: "SMS" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateMessageTemplate(accessToken: string, id: string, input: MessageTemplateFormPayload) {
  return apiRequest<MessageTemplateRecord>(accessToken, `${apiBaseUrl}/message-templates/${encodeURIComponent(id)}`, {
    body: JSON.stringify({ ...input, channel: "SMS" }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteMessageTemplate(accessToken: string, id: string) {
  const response = await authenticatedFetch(
    accessToken,
    `${apiBaseUrl}/message-templates/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw new Error("MESSAGE_TEMPLATE_DELETE_FAILED");
  }
}
