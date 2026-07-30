"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  CrudPage,
  DataTable,
  EmptyState,
  Field,
  FilterBar,
  FormModal,
  Input,
  MetricCard,
  MetricGrid,
  Panel,
  Select,
  Textarea,
  Toolbar,
  type DataTableColumn,
  useConfirmDialog,
} from "@o-okul/ui";
import type {
  AcademicTermRecord,
  AnnouncementRecord,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  GradeLevelRecord,
  MessageTemplateRecord,
  StudentStatus,
} from "@o-okul/shared-types";
import { Pencil, Plus, Search, Send, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { isSmsEnabled } from "../../../../src/sms-feature.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import { ImportTemplatePanel } from "../_shared/import-template-panel.js";
import {
  firstFormError,
  messageTemplateFormSchema,
  type MessageTemplateFormPayload,
  type MessageTemplateFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";
import { SmsDeliveryReportPanel, type SmsBatchDeliveryReportRecord } from "../_shared/sms-delivery-report-panel.js";

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
  const { confirm, confirmationDialog } = useConfirmDialog();
  const searchParams = useSearchParams();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: messageTemplateSortOptions });
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
    enabled: Boolean(auth && isSmsEnabled),
    refetchOnWindowFocus: false,
  });
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplateRecord | null>(null);
  const [form, setForm] = useState<MessageTemplateFormState>(emptyForm);
  const [smsForm, setSmsForm] = useState(emptySmsForm);
  const [recipientPreview, setRecipientPreview] = useState<SmsBatchRecipientPreviewResult | null>(null);
  const [deliveryReportJobId, setDeliveryReportJobId] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [smsError, setSmsError] = useState("");
  const [isPreviewingSms, setIsPreviewingSms] = useState(false);
  const [isSendingSms, setIsSendingSms] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = templatesQuery.data?.data ?? [];
  const references = referencesQuery.data ?? emptySmsReferences;
  const selectedSmsTemplate = useMemo(
    () => rows.find((template) => template.id === smsForm.templateId) ?? rows[0],
    [rows, smsForm.templateId],
  );
  const parsedRecipients = useMemo(() => parseRecipientLines(smsForm.recipients), [smsForm.recipients]);
  const previewRecipientNumbers = useMemo(
    () => recipientPreview?.recipients.map((recipient) => recipient.to) ?? [],
    [recipientPreview],
  );
  const effectiveRecipients = parsedRecipients.length > 0 ? parsedRecipients : previewRecipientNumbers;
  const effectiveRecipientCount = effectiveRecipients.length;
  const deliveryReportQuery = useQuery({
    queryKey: ["next-sms-batch-report", auth?.session.tenantId ?? "anonymous", deliveryReportJobId],
    queryFn: () => loadSmsBatchDeliveryReport(auth?.accessToken ?? "", deliveryReportJobId),
    enabled: Boolean(auth && deliveryReportJobId),
    refetchOnWindowFocus: false,
  });
  const templateSummaryItems = buildTemplateSummaryItems({
    effectiveRecipientCount,
    listTotal: templatesQuery.data?.meta?.total ?? rows.length,
    recipientPreview,
    rows,
  });
  const templateSummaryBadges = buildTemplateSummaryBadges({
    isReferenceLoading: referencesQuery.isPending,
    listQuery,
    parsedRecipientCount: parsedRecipients.length,
    previewRecipientCount: previewRecipientNumbers.length,
  });
  const templateSummaryActions = buildTemplateSummaryActions({
    deliveryReportJobId,
    effectiveRecipientCount,
    isSendingSms,
    recipientPreview,
    selectedSmsTemplate,
    sendStatus,
  });

  const columns: Array<DataTableColumn<MessageTemplateRecord>> = [
    {
      key: "name",
      header: "Şablon",
      mobilePriority: "primary",
      priority: "primary",
      render: (template) => template.name,
      sticky: "left",
    },
    {
      key: "channel",
      header: "Kanal",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (template) => template.channel,
    },
    {
      key: "body",
      header: "Metin",
      mobilePriority: "hidden",
      priority: "optional",
      render: (template) => template.body,
    },
    {
      key: "actions",
      header: "İşlem",
      mobilePriority: "primary",
      priority: "primary",
      render: (template) => (
        <span className="next-row-actions">
          <Button size="icon" variant="ghost" type="button" onClick={() => openEditForm(template)} aria-label={`${template.name} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" type="button" onClick={() => void handleDelete(template)} aria-label={`${template.name} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </Button>
        </span>
      ),
      sticky: "right",
    },
  ];
  const recipientPreviewColumns: Array<DataTableColumn<SmsBatchRecipientPreviewRecord>> = [
    {
      key: "guardian",
      header: "Alıcı",
      priority: "primary",
      render: () => "İzinli veli",
      sticky: "left",
    },
    {
      key: "students",
      header: "Kapsam",
      priority: "secondary",
      render: (recipient) => `${recipient.studentIds.length} bağlı öğrenci`,
    },
    {
      align: "right",
      key: "studentCount",
      header: "Bağlı öğrenci",
      priority: "optional",
      render: (recipient) => recipient.studentIds.length,
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
    } catch (submitError) {
      setError(apiErrorMessage(submitError, "Şablon kaydedilemedi."));
    }
  }

  async function handleDelete(template: MessageTemplateRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${template.name} şablonu silinsin mi?`,
      title: "Şablonu sil",
    });
    if (!confirmed) return;

    setError("");
    try {
      await deleteMessageTemplate(auth.accessToken, template.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch (deleteError) {
      setError(apiErrorMessage(deleteError, "Şablon silinemedi."));
    }
  }

  async function handleSendSms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !selectedSmsTemplate) return;
    if (isSendingSms) return;

    setSmsError("");
    setSendStatus("");
    if (effectiveRecipients.length === 0) {
      setSmsError("En az bir alıcı girilmelidir.");
      return;
    }

    setIsSendingSms(true);
    try {
      const result = await createSmsBatch(auth.accessToken, {
        templateId: selectedSmsTemplate.id,
        recipients: effectiveRecipients.map((to) => ({ to })),
      });
      setDeliveryReportJobId(result.jobId);
      setSendStatus(`${result.recipientCount} alıcı kuyruğa alındı.`);
    } catch (sendError) {
      setSmsError(apiErrorMessage(sendError, "SMS gönderimi başlatılamadı."));
    } finally {
      setIsSendingSms(false);
    }
  }

  async function handlePreviewRecipients() {
    if (!auth) return;
    if (isPreviewingSms) return;

    setSmsError("");
    setSendStatus("");
    setIsPreviewingSms(true);
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
      setSendStatus(`${result.recipientCount} izinli veli alıcısı hazırlandı.`);
    } catch (previewError) {
      setSmsError(apiErrorMessage(previewError, "SMS alıcıları getirilemedi."));
    } finally {
      setIsPreviewingSms(false);
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
        emptyState={
          <EmptyState
            title="Şablon yok"
            description="SMS gönderimlerinde kullanmak için ilk mesaj şablonunu oluştur."
            primaryAction={{ label: "Şablon ekle", onClick: openCreateForm }}
          />
        }
      emptyText="Şablon kaydı yok"
      error={error || (templatesQuery.isError ? apiErrorMessage(templatesQuery.error, "Şablonlar alınamadı.") : undefined)}
      getRowKey={(template) => template.id}
      density="compact"
      loading={templatesQuery.isPending}
      rows={rows}
      summary={
        <OperationSummary
          actions={templateSummaryActions}
          ariaLabel="Şablon operasyon özeti"
          badges={templateSummaryBadges}
          items={templateSummaryItems}
        />
      }
      tableCaption="Şablon yönetimi"
        tableDescription="SMS mesaj şablonları ve yeniden kullanılabilir gönderim metinleri."
        title="Şablonlar"
      />
      <ImportTemplatePanel />
      {isSmsEnabled ? (
        <Panel
        aria-label="SMS gönderim"
        title="SMS gönderim"
        description="Şablon seç, kapsamı filtrele, alıcı listesini kontrol et ve teslim raporunu izle."
        tone="muted"
      >
        <form className="next-sms-workflow" onSubmit={(event) => void handleSendSms(event)}>
          <MetricGrid aria-label="SMS gönderim özeti" role="region">
            <MetricCard
              label="Şablon"
              value={selectedSmsTemplate?.name ?? "Yok"}
              description="Gönderimde kullanılacak mesaj"
            />
            <MetricCard
              label="Alıcı"
              value={effectiveRecipientCount}
              description={parsedRecipients.length > 0 ? "Manuel alıcı listesi" : "Önizleme alıcıları"}
              tone={effectiveRecipientCount > 0 ? "success" : "warning"}
            />
            <MetricCard
              label="İzinli veli"
              value={recipientPreview?.recipientCount ?? "-"}
              description="Son alıcı sorgusu"
              tone={recipientPreview ? "info" : "default"}
            />
          </MetricGrid>
          <FilterBar role="group" aria-label="SMS alıcı filtreleri">
            <Field label="Duyuru hedefi">
              <Select
                value={smsForm.announcementId}
                onChange={(event) => handleAnnouncementSelection(event.target.value)}
              >
                <option value="">Duyuru seçmeden filtrele</option>
                {references.announcements.map((announcement) => (
                  <option key={announcement.id} value={announcement.id}>
                    {announcement.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Kampüs">
              <Select
                value={smsForm.campusId}
                onChange={(event) => setSmsForm((current) => ({ ...current, campusId: event.target.value }))}
              >
                <option value="">Tüm kampüsler</option>
                {references.campuses.map((campus) => (
                  <option key={campus.id} value={campus.id}>
                    {campus.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Seviye">
              <Select
                value={smsForm.gradeLevelId}
                onChange={(event) => setSmsForm((current) => ({ ...current, gradeLevelId: event.target.value }))}
              >
                <option value="">Tüm seviyeler</option>
                {references.gradeLevels.map((gradeLevel) => (
                  <option key={gradeLevel.id} value={gradeLevel.id}>
                    {gradeLevel.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sınıf">
              <Select
                value={smsForm.classId}
                onChange={(event) => setSmsForm((current) => ({ ...current, classId: event.target.value }))}
              >
                <option value="">Tüm sınıflar</option>
                {references.classes.map((schoolClass) => (
                  <option key={schoolClass.id} value={schoolClass.id}>
                    {schoolClass.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Öğrenci durumu">
              <Select
                value={smsForm.studentStatus}
                onChange={(event) => setSmsForm((current) => ({ ...current, studentStatus: event.target.value as StudentStatus }))}
              >
                <option value="ACTIVE">Aktif öğrenciler</option>
                <option value="PASSIVE">Pasif öğrenciler</option>
              </Select>
            </Field>
            <Field label="Ders">
              <Select
                value={smsForm.courseId}
                onChange={(event) => setSmsForm((current) => ({ ...current, courseId: event.target.value }))}
              >
                <option value="">Tüm dersler</option>
                {references.courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {formatCourseName(course.name)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Dönem">
              <Select
                value={smsForm.termId}
                onChange={(event) => setSmsForm((current) => ({ ...current, termId: event.target.value }))}
              >
                <option value="">Tüm dönemler</option>
                {references.terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handlePreviewRecipients()}
              disabled={isPreviewingSms || referencesQuery.isPending}
            >
              <Search size={17} aria-hidden="true" />
              Alıcıları getir
            </Button>
          </FilterBar>
          {recipientPreview ? (
            <Panel
              aria-label="SMS alıcı önizleme"
              title="Alıcı önizleme"
              description={`${recipientPreview.recipientCount} izinli veli alıcısı hazırlandı.`}
            >
              <DataTable
                caption="SMS alıcı önizleme"
                columns={recipientPreviewColumns}
                density="compact"
                description="İlk kayıtlar PII açmadan kapsam doğrulaması için gösterilir; telefon numarası önizlemede açılmaz."
                emptyText="Filtreye uygun SMS izni olan veli bulunamadı."
                getRowKey={(recipient) => `${recipient.guardianId}-${recipient.studentIds.join("-")}`}
                rows={recipientPreview.recipients.slice(0, 5)}
              />
            </Panel>
          ) : null}
          <div className="next-sms-composer-grid">
            <Field label="Şablon">
              <Select
                value={selectedSmsTemplate?.id ?? ""}
                onChange={(event) => setSmsForm((current) => ({ ...current, templateId: event.target.value }))}
              >
                {rows.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Alıcılar" description="Manuel gönderim için satır başına bir GSM numarası girilir. Boş bırakılırsa son alıcı önizlemesi kullanılır.">
              <Textarea
                aria-label="SMS alıcıları"
                placeholder="905000000001&#10;905000000002"
                value={smsForm.recipients}
                onChange={(event) => setSmsForm((current) => ({ ...current, recipients: event.target.value }))}
              />
            </Field>
            <Panel
              aria-label="SMS önizleme"
              title={selectedSmsTemplate?.name ?? "Şablon seçilmedi"}
              description={`${effectiveRecipientCount} alıcı`}
            >
              <p className="next-sms-message-preview">
                {selectedSmsTemplate?.body ?? "Gönderilecek mesaj metni burada görünür."}
              </p>
            </Panel>
          </div>
          <Toolbar align="end" className="next-sms-workflow-actions">
            <Button type="submit" disabled={!selectedSmsTemplate || templatesQuery.isPending || isSendingSms || effectiveRecipientCount === 0}>
              <Send size={17} aria-hidden="true" />
              SMS gönder
            </Button>
          </Toolbar>
          {sendStatus ? (
            <Alert tone="success" title="SMS durumu">
              {sendStatus}
            </Alert>
          ) : null}
          {smsError ? (
            <Alert tone="danger" title="SMS işlemi tamamlanamadı">
              {smsError}
            </Alert>
          ) : null}
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
      </Panel>
      ) : null}
      <FormModal
        description="Şablon adı ve metni zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingTemplate ? "Kaydet" : "Ekle"}
        title={editingTemplate ? "Şablon düzenle" : "Şablon ekle"}
      >
        <Field label="Şablon adı">
          <Input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field label="Mesaj metni" description="SMS gönderiminde kullanılacak kısa ve tekrar kullanılabilir metin.">
          <Textarea
            required
            rows={5}
            value={form.body}
            onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
          />
        </Field>
      </FormModal>
      {confirmationDialog}
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

const messageTemplateSortOptions = [
  { label: "Şablon A-Z", value: "name" },
  { label: "Şablon Z-A", value: "-name" },
  { label: "Metin A-Z", value: "body" },
  { label: "Metin Z-A", value: "-body" },
];

function buildTemplateSummaryItems({
  effectiveRecipientCount,
  listTotal,
  recipientPreview,
  rows,
}: {
  effectiveRecipientCount: number;
  listTotal: number;
  recipientPreview: SmsBatchRecipientPreviewResult | null;
  rows: MessageTemplateRecord[];
}): OperationSummaryItem[] {
  const items: OperationSummaryItem[] = [
    {
      description: "URL state ile sayfalanan şablon",
      key: "total",
      label: "Şablon toplamı",
      value: formatCount(listTotal),
    },
  ];

  if (!isSmsEnabled) return items;

  return [
    ...items,
    {
      description: "SMS kanalında kullanılabilir",
      key: "sms-ready",
      label: "SMS hazır",
      tone: rows.length > 0 ? "success" : "warning",
      value: formatCount(rows.length),
    },
    {
      description: recipientPreview ? "Son izinli veli sorgusu" : "Alıcı önizlemesi bekleniyor",
      key: "preview",
      label: "Alıcı önizleme",
      tone: recipientPreview ? "info" : "default",
      value: recipientPreview ? formatCount(recipientPreview.recipientCount) : "Bekliyor",
    },
    {
      description: effectiveRecipientCount > 0 ? "Gönderime hazır alıcı" : "Manuel veya önizleme alıcısı gerekli",
      key: "recipient-count",
      label: "Gönderim alıcısı",
      tone: effectiveRecipientCount > 0 ? "success" : "warning",
      value: formatCount(effectiveRecipientCount),
    },
  ];
}

function buildTemplateSummaryBadges({
  isReferenceLoading,
  listQuery,
  parsedRecipientCount,
  previewRecipientCount,
}: {
  isReferenceLoading: boolean;
  listQuery: ListQueryState;
  parsedRecipientCount: number;
  previewRecipientCount: number;
}): OperationSummaryBadge[] {
  const badges: OperationSummaryBadge[] = [
    {
      key: "sort",
      label: formatTemplateSortLabel(listQuery.sort),
      tone: listQuery.sort ? "info" : "neutral",
    },
  ];

  if (!isSmsEnabled) return badges;

  return [
    ...badges,
    {
      key: "references",
      label: isReferenceLoading ? "SMS referansları yükleniyor" : "SMS referansları hazır",
      tone: isReferenceLoading ? "warning" : "success",
    },
    {
      key: "source",
      label: parsedRecipientCount > 0 ? "Alıcı kaynağı: manuel" : previewRecipientCount > 0 ? "Alıcı kaynağı: önizleme" : "Alıcı kaynağı bekliyor",
      tone: parsedRecipientCount > 0 || previewRecipientCount > 0 ? "info" : "neutral",
    },
  ];
}

function buildTemplateSummaryActions({
  deliveryReportJobId,
  effectiveRecipientCount,
  isSendingSms,
  recipientPreview,
  selectedSmsTemplate,
  sendStatus,
}: {
  deliveryReportJobId: string;
  effectiveRecipientCount: number;
  isSendingSms: boolean;
  recipientPreview: SmsBatchRecipientPreviewResult | null;
  selectedSmsTemplate?: MessageTemplateRecord;
  sendStatus: string;
}): OperationSummaryAction[] {
  if (!isSmsEnabled) return [];

  return [
    {
      detail: selectedSmsTemplate ? "Gönderimde kullanılacak metin hazır" : "Önce SMS şablonu oluşturulmalı",
      key: "template",
      label: "Şablon seçimi",
      status: selectedSmsTemplate ? "Hazır" : "Bekliyor",
      tone: selectedSmsTemplate ? "success" : "neutral",
      value: selectedSmsTemplate?.name ?? "Şablon yok",
    },
    {
      detail: recipientPreview ? "Telefon numaraları önizlemede açılmaz" : "Filtrelerden alıcıları getir",
      key: "preview",
      label: "Alıcı kontrolü",
      status: recipientPreview ? "Hazır" : "Bekliyor",
      tone: recipientPreview ? "info" : "neutral",
      value: recipientPreview ? `${formatCount(recipientPreview.recipientCount)} izinli veli` : "Önizleme yok",
    },
    {
      detail: sendStatus || (effectiveRecipientCount > 0 ? "Gönderim butonu hazır" : "Alıcı bekleniyor"),
      key: "queue",
      label: "SMS kuyruğu",
      status: deliveryReportJobId ? "Kuyrukta" : isSendingSms ? "Gönderiliyor" : effectiveRecipientCount > 0 ? "Hazır" : "Bekliyor",
      tone: deliveryReportJobId ? "warning" : effectiveRecipientCount > 0 ? "success" : "neutral",
      value: deliveryReportJobId ? "Teslim raporu açık" : `${formatCount(effectiveRecipientCount)} alıcı`,
    },
  ];
}

function formatTemplateSortLabel(sort: string) {
  const option = messageTemplateSortOptions.find((candidate) => candidate.value === sort);
  return option ? `Sıralama: ${option.label}` : "Sıralama: Varsayılan";
}

function formatCount(value: number) {
  return value.toLocaleString("tr-TR");
}

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
