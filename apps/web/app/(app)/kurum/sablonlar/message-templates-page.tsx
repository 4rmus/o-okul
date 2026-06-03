"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import type {
  AcademicTermRecord,
  AnnouncementRecord,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  GradeLevelRecord,
  MessageTemplateRecord,
  StudentStatus,
} from "@uzman-hocam/shared-types";
import { Pencil, Plus, Search, Send, Trash2 } from "lucide-react";
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

const emptySmsForm = {
  announcementId: "",
  campusId: "",
  classId: "",
  courseId: "",
  gradeLevelId: "",
  studentStatus: "ACTIVE" as StudentStatus,
  termId: "",
  templateId: "",
  recipients: "",
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
  const referencesQuery = useQuery({
    queryKey: ["next-sms-recipient-refs", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadSmsRecipientReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplateRecord | null>(null);
  const [form, setForm] = useState<MessageTemplateFormState>(emptyForm);
  const [smsForm, setSmsForm] = useState(emptySmsForm);
  const [recipientPreview, setRecipientPreview] = useState<SmsBatchRecipientPreviewResult | null>(null);
  const [deliveryReportJobId, setDeliveryReportJobId] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = templatesQuery.data?.data ?? [];
  const references = referencesQuery.data ?? emptySmsReferences;
  const selectedSmsTemplate = useMemo(
    () => rows.find((template) => template.id === smsForm.templateId) ?? rows[0],
    [rows, smsForm.templateId],
  );
  const parsedRecipients = useMemo(() => parseRecipientLines(smsForm.recipients), [smsForm.recipients]);
  const deliveryReportQuery = useQuery({
    queryKey: ["next-sms-batch-report", auth?.session.tenantId ?? "anonymous", deliveryReportJobId],
    queryFn: () => loadSmsBatchDeliveryReport(auth?.accessToken ?? "", deliveryReportJobId),
    enabled: Boolean(auth && deliveryReportJobId),
    refetchOnWindowFocus: false,
  });

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

  async function handleSendSms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !selectedSmsTemplate) return;

    setError("");
    setSendStatus("");
    if (parsedRecipients.length === 0) {
      setError("En az bir alıcı girilmelidir.");
      return;
    }

    try {
      const result = await createSmsBatch(auth.accessToken, {
        templateId: selectedSmsTemplate.id,
        recipients: parsedRecipients.map((to) => ({ to })),
      });
      setDeliveryReportJobId(result.jobId);
      setSendStatus(`${result.recipientCount} alıcı kuyruğa alındı.`);
    } catch {
      setError("SMS gönderimi başlatılamadı.");
    }
  }

  async function handlePreviewRecipients() {
    if (!auth) return;

    setError("");
    setSendStatus("");
    try {
      const result = await previewSmsRecipients(auth.accessToken, {
        announcementId: smsForm.announcementId || undefined,
        campusId: smsForm.campusId || undefined,
        classId: smsForm.classId || undefined,
        courseId: smsForm.courseId || undefined,
        gradeLevelId: smsForm.gradeLevelId || undefined,
        studentStatus: smsForm.studentStatus,
        termId: smsForm.termId || undefined,
      });
      setRecipientPreview(result);
      setSmsForm((current) => ({
        ...current,
        recipients: result.recipients.map((recipient) => recipient.to).join("\n"),
      }));
      setSendStatus(`${result.recipientCount} izinli veli alıcısı hazırlandı.`);
    } catch {
      setError("SMS alıcıları getirilemedi.");
    }
  }

  function handleAnnouncementSelection(announcementId: string) {
    const announcement = references.announcements.find((record) => record.id === announcementId);
    setSmsForm((current) => ({
      ...current,
      announcementId,
      campusId: announcement?.campusId ?? "",
      classId: announcement?.classId ?? "",
      courseId: announcement?.courseId ?? "",
      gradeLevelId: announcement?.gradeLevelId ?? "",
      termId: announcement?.termId ?? "",
    }));
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
      <section aria-label="SMS gönderim" className="uh-panel">
        <header className="uh-panel__header">
          <div>
            <h2>SMS gönderim</h2>
            <p>Şablon seç, alıcıları satır satır gir ve teslim raporunu izle.</p>
          </div>
        </header>
        <form className="next-form" onSubmit={(event) => void handleSendSms(event)}>
          <label>
            Duyuru hedefi
            <select
              value={smsForm.announcementId}
              onChange={(event) => handleAnnouncementSelection(event.target.value)}
            >
              <option value="">Duyuru seçmeden filtrele</option>
              {references.announcements.map((announcement) => (
                <option key={announcement.id} value={announcement.id}>
                  {announcement.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kampüs
            <select
              value={smsForm.campusId}
              onChange={(event) => setSmsForm((current) => ({ ...current, campusId: event.target.value }))}
            >
              <option value="">Tüm kampüsler</option>
              {references.campuses.map((campus) => (
                <option key={campus.id} value={campus.id}>
                  {campus.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Seviye
            <select
              value={smsForm.gradeLevelId}
              onChange={(event) => setSmsForm((current) => ({ ...current, gradeLevelId: event.target.value }))}
            >
              <option value="">Tüm seviyeler</option>
              {references.gradeLevels.map((gradeLevel) => (
                <option key={gradeLevel.id} value={gradeLevel.id}>
                  {gradeLevel.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sınıf
            <select
              value={smsForm.classId}
              onChange={(event) => setSmsForm((current) => ({ ...current, classId: event.target.value }))}
            >
              <option value="">Tüm sınıflar</option>
              {references.classes.map((schoolClass) => (
                <option key={schoolClass.id} value={schoolClass.id}>
                  {schoolClass.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Öğrenci durumu
            <select
              value={smsForm.studentStatus}
              onChange={(event) => setSmsForm((current) => ({ ...current, studentStatus: event.target.value as StudentStatus }))}
            >
              <option value="ACTIVE">Aktif öğrenciler</option>
              <option value="PASSIVE">Pasif öğrenciler</option>
            </select>
          </label>
          <label>
            Ders
            <select
              value={smsForm.courseId}
              onChange={(event) => setSmsForm((current) => ({ ...current, courseId: event.target.value }))}
            >
              <option value="">Tüm dersler</option>
              {references.courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dönem
            <select
              value={smsForm.termId}
              onChange={(event) => setSmsForm((current) => ({ ...current, termId: event.target.value }))}
            >
              <option value="">Tüm dönemler</option>
              {references.terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="secondary" onClick={() => void handlePreviewRecipients()}>
            <Search size={17} aria-hidden="true" />
            Alıcıları getir
          </Button>
          {recipientPreview ? (
            <section aria-label="SMS alıcı önizleme" className="next-preview-box">
              <strong>{recipientPreview.recipientCount} izinli veli</strong>
              {recipientPreview.recipients.length > 0 ? (
                <ul className="next-compact-list">
                  {recipientPreview.recipients.slice(0, 5).map((recipient) => (
                    <li key={`${recipient.guardianId}-${recipient.to}`}>
                      {recipient.guardianName} - {recipient.studentNames.join(", ")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Filtreye uygun SMS izni olan veli bulunamadı.</p>
              )}
            </section>
          ) : null}
          <label>
            Şablon
            <select
              value={selectedSmsTemplate?.id ?? ""}
              onChange={(event) => setSmsForm((current) => ({ ...current, templateId: event.target.value }))}
            >
              {rows.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Alıcılar
            <textarea
              aria-label="SMS alıcıları"
              placeholder="905000000001&#10;905000000002"
              value={smsForm.recipients}
              onChange={(event) => setSmsForm((current) => ({ ...current, recipients: event.target.value }))}
            />
          </label>
          <section aria-label="SMS önizleme" className="next-preview-box">
            <strong>{selectedSmsTemplate?.name ?? "Şablon seçilmedi"}</strong>
            <p>{selectedSmsTemplate?.body ?? "Gönderilecek mesaj metni burada görünür."}</p>
            <span>{parsedRecipients.length} alıcı</span>
          </section>
          <Button type="submit" disabled={!selectedSmsTemplate || templatesQuery.isPending}>
            <Send size={17} aria-hidden="true" />
            SMS gönder
          </Button>
          {sendStatus ? <p className="next-status-note">{sendStatus}</p> : null}
        </form>
        {deliveryReportJobId ? (
          <SmsDeliveryReportPanel
            jobId={deliveryReportJobId}
            report={deliveryReportQuery.data}
            isLoading={deliveryReportQuery.isPending}
            isError={deliveryReportQuery.isError}
            onRefresh={() => void deliveryReportQuery.refetch()}
          />
        ) : null}
      </section>
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

interface SmsBatchQueueResult {
  tenantId: string;
  templateId: string;
  recipientCount: number;
  queueName: "sms-batch";
  jobId: string;
  status: "queued";
}

interface SmsBatchRecipientPreviewRecord {
  to: string;
  guardianId: string;
  guardianName: string;
  studentIds: string[];
  studentNames: string[];
}

interface SmsBatchRecipientPreviewResult {
  recipients: SmsBatchRecipientPreviewRecord[];
  recipientCount: number;
}

interface SmsBatchDeliveryReportRecord {
  id: string;
  tenantId: string;
  jobId: string;
  templateId: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  billableSegments: number;
  status: "queued" | "completed" | "failed";
  providerErrorCode?: string;
}

function SmsDeliveryReportPanel({
  isError,
  isLoading,
  jobId,
  onRefresh,
  report,
}: {
  isError: boolean;
  isLoading: boolean;
  jobId: string;
  onRefresh: () => void;
  report?: SmsBatchDeliveryReportRecord;
}) {
  return (
    <section aria-label="SMS teslim raporu" className="next-preview-box">
      <header className="next-inline-header">
        <div>
          <strong>Teslim raporu</strong>
          <p>{jobId}</p>
        </div>
        <Button type="button" variant="secondary" onClick={onRefresh}>
          Yenile
        </Button>
      </header>
      {isLoading ? (
        <p>Rapor yükleniyor...</p>
      ) : isError ? (
        <p>Rapor alınamadı.</p>
      ) : report ? (
        <dl className="next-report-grid">
          <div>
            <dt>Durum</dt>
            <dd>{report.status}</dd>
          </div>
          <div>
            <dt>Alıcı</dt>
            <dd>{report.recipientCount}</dd>
          </div>
          <div>
            <dt>Gönderilen</dt>
            <dd>{report.sentCount}</dd>
          </div>
          <div>
            <dt>Başarısız</dt>
            <dd>{report.failedCount}</dd>
          </div>
          <div>
            <dt>Segment</dt>
            <dd>{report.billableSegments}</dd>
          </div>
          {report.providerErrorCode ? (
            <div>
              <dt>Hata</dt>
              <dd>{report.providerErrorCode}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

const messageTemplateSortOptions = [
  { label: "Şablon A-Z", value: "name" },
  { label: "Şablon Z-A", value: "-name" },
  { label: "Metin A-Z", value: "body" },
  { label: "Metin Z-A", value: "-body" },
];

const emptySmsReferences = {
  announcements: [] as AnnouncementRecord[],
  campuses: [] as CampusRecord[],
  classes: [] as ClassRecord[],
  courses: [] as CourseRecord[],
  gradeLevels: [] as GradeLevelRecord[],
  terms: [] as AcademicTermRecord[],
};

async function loadMessageTemplates(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<MessageTemplateRecord>(accessToken, buildListUrl(`${apiBaseUrl}/message-templates`, listQuery));
}

async function loadSmsRecipientReferences(accessToken: string) {
  const [announcements, campuses, classes, gradeLevels, courses, terms] = await Promise.all([
    apiListRequest<AnnouncementRecord>(accessToken, buildListUrl(`${apiBaseUrl}/announcements`, initialListQuery)),
    apiRequest<CampusRecord[]>(accessToken, `${apiBaseUrl}/campuses`),
    apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`),
    apiRequest<GradeLevelRecord[]>(accessToken, `${apiBaseUrl}/grade-levels`),
    apiRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`),
    apiRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return { announcements: announcements.data, campuses, classes, courses, gradeLevels, terms };
}

async function previewSmsRecipients(
  accessToken: string,
  input: {
    campusId?: string;
    classId?: string;
    courseId?: string;
    announcementId?: string;
    gradeLevelId?: string;
    studentStatus?: StudentStatus;
    termId?: string;
  },
) {
  return apiRequest<SmsBatchRecipientPreviewResult>(accessToken, `${apiBaseUrl}/sms-batches/recipients/preview`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function createSmsBatch(
  accessToken: string,
  input: { templateId: string; recipients: Array<{ to: string }> },
) {
  return apiRequest<SmsBatchQueueResult>(accessToken, `${apiBaseUrl}/sms-batches`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function loadSmsBatchDeliveryReport(accessToken: string, jobId: string) {
  return apiRequest<SmsBatchDeliveryReportRecord>(accessToken, `${apiBaseUrl}/sms-batches/${encodeURIComponent(jobId)}`);
}

function parseRecipientLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
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
