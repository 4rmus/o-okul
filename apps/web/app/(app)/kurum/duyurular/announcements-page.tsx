"use client";

import { type FormEvent, useMemo, useRef, useState } from "react";
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
  MetricCard,
  MetricGrid,
  Panel,
  Select,
  StatusBadge,
  Textarea,
  type DataTableColumn,
  type StatusBadgeProps,
  useConfirmDialog,
} from "@o-okul/ui";
import type {
  AcademicTermRecord,
  AnnouncementRecipientRecord,
  AnnouncementRecipientReport,
  AnnouncementRecord,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  GradeLevelRecord,
  MessageTemplateRecord,
} from "@o-okul/shared-types";
import { Plus, Send } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { isSmsEnabled } from "../../../../src/sms-feature.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import {
  announcementFormSchema,
  firstFormError,
  type AnnouncementFormPayload,
  type AnnouncementFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";
import { SmsDeliveryReportPanel, type SmsBatchDeliveryReportRecord } from "../_shared/sms-delivery-report-panel.js";

const emptyForm: AnnouncementFormState = {
  title: "",
  body: "",
  audience: "SCHOOL",
  campusId: "",
  gradeLevelId: "",
  classId: "",
  courseId: "",
  termId: "",
};

interface AnnouncementPageData {
  references: typeof emptyReferences;
  messageTemplates: MessageTemplateRecord[];
}

interface AnnouncementReportData {
  recipientReport?: AnnouncementRecipientReport;
  smsDeliveryReport?: SmsBatchDeliveryReportRecord;
}

export function AnnouncementsPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const searchParams = useSearchParams();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: announcementSortOptions });
  const queryKey = ["next-announcements", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-announcements", auth?.session.tenantId ?? "anonymous"];
  const announcementsQuery = useQuery({
    queryKey,
    queryFn: () => loadAnnouncements(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const pageDataQuery = useQuery({
    queryKey: ["next-announcement-page-data", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadAnnouncementPageData(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [form, setForm] = useState<AnnouncementFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string>("");
  const [smsDeliveryReportJobId, setSmsDeliveryReportJobId] = useState("");
  const [smsStatus, setSmsStatus] = useState("");
  const [smsTemplateId, setSmsTemplateId] = useState("");
  const [smsRecipientPreview, setSmsRecipientPreview] = useState<SmsBatchRecipientPreviewResult | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPreviewingSms, setIsPreviewingSms] = useState(false);
  const [isSendingSms, setIsSendingSms] = useState(false);
  const [error, setError] = useState("");
  const [smsError, setSmsError] = useState("");
  const announcementCreateRequest = useRef<PendingIdempotentRequest | null>(null);
  const smsCreateRequest = useRef<PendingIdempotentRequest | null>(null);
  const rows = announcementsQuery.data?.data ?? [];
  const selectedAnnouncement = rows.find((announcement) => announcement.id === selectedReportId);
  const messageTemplates = pageDataQuery.data?.messageTemplates ?? [];
  const selectedSmsTemplate = useMemo(
    () => messageTemplates.find((template) => template.id === smsTemplateId) ?? messageTemplates[0],
    [messageTemplates, smsTemplateId],
  );
  const reportDataQuery = useQuery({
    queryKey: ["next-announcement-report-data", auth?.session.tenantId ?? "anonymous", selectedReportId, smsDeliveryReportJobId],
    queryFn: () => loadAnnouncementReportData(auth?.accessToken ?? "", selectedReportId, smsDeliveryReportJobId),
    enabled: Boolean(auth && selectedReportId),
    refetchOnWindowFocus: false,
  });
  const references = pageDataQuery.data?.references ?? emptyReferences;
  const campusNames = useMemo(() => new Map(references.campuses.map((record) => [record.id, record.name])), [references.campuses]);
  const gradeLevelNames = useMemo(() => new Map(references.gradeLevels.map((record) => [record.id, record.name])), [references.gradeLevels]);
  const classNames = useMemo(() => new Map(references.classes.map((record) => [record.id, record.name])), [references.classes]);
  const courseNames = useMemo(() => new Map(references.courses.map((record) => [record.id, formatCourseName(record.name)])), [references.courses]);
  const termNames = useMemo(() => new Map(references.terms.map((record) => [record.id, record.name])), [references.terms]);
  const recipientReport = reportDataQuery.data?.recipientReport;
  const announcementSummaryItems = buildAnnouncementSummaryItems({
    listTotal: announcementsQuery.data?.meta?.total ?? rows.length,
    recipientReport,
    rows,
  });
  const announcementSummaryBadges = buildAnnouncementSummaryBadges({
    isReferenceLoading: pageDataQuery.isPending,
    listQuery,
    messageTemplates,
  });
  const announcementSummaryActions = buildAnnouncementSummaryActions({
    recipientReport,
    selectedAnnouncement,
    selectedSmsTemplate,
    smsDeliveryReportJobId,
    smsStatus,
  });

  const columns: Array<DataTableColumn<AnnouncementRecord>> = [
    {
      key: "title",
      header: "Başlık",
      mobilePriority: "primary",
      priority: "primary",
      render: (announcement) => announcement.title,
      sticky: "left",
    },
    {
      key: "audience",
      header: "Hedef",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (announcement) => audienceLabel(announcement.audience),
    },
    {
      key: "scope",
      header: "Kapsam",
      mobilePriority: "hidden",
      priority: "optional",
      render: (announcement) => scopeLabel(announcement, { campusNames, gradeLevelNames, classNames, courseNames, termNames }),
    },
    {
      key: "publishedAt",
      header: "Yayın",
      mobilePriority: "secondary",
      priority: "optional",
      render: (announcement) => new Date(announcement.publishedAt).toLocaleDateString("tr-TR"),
    },
    {
      key: "recipients",
      header: "Rapor",
      mobilePriority: "primary",
      priority: "primary",
      render: (announcement) => (
        <Button type="button" variant="secondary" onClick={() => openRecipientReport(announcement.id)}>
          Alıcılar
        </Button>
      ),
      sticky: "right",
    },
  ];

  function openRecipientReport(announcementId: string) {
    setSelectedReportId(announcementId);
    setSmsDeliveryReportJobId("");
    setSmsError("");
    setSmsStatus("");
    setSmsRecipientPreview(null);
  }

  function closeRecipientReport() {
    setSelectedReportId("");
    setSmsDeliveryReportJobId("");
    setSmsError("");
    setSmsStatus("");
    setSmsRecipientPreview(null);
  }

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

    const confirmed = await confirm({
      confirmLabel: "Yayınla",
      confirmVariant: "primary",
      description: "Duyuru hemen yayınlanacak. Son kontrolü yapın.",
      message: (
        <span>
          <strong>Başlık:</strong> {parsedForm.data.title}<br />
          <strong>Metin:</strong> {parsedForm.data.body}<br />
          <strong>Hedef:</strong> Kurum geneli<br />
          <strong>Kanal:</strong> Uygulama içi duyuru<br />
          <strong>Zamanlama:</strong> Hemen<br />
          <strong>Yayın yeri:</strong> Kurum ana sayfası ve kullanıcı duyuru ekranları
        </span>
      ),
      title: "Duyuruyu yayınla",
    });
    if (!confirmed) return;

    setIsPublishing(true);
    try {
      const fingerprint = JSON.stringify(parsedForm.data);
      const request = announcementCreateRequest.current?.fingerprint === fingerprint
        ? announcementCreateRequest.current
        : { fingerprint, key: crypto.randomUUID() };
      announcementCreateRequest.current = request;
      await createAnnouncement(auth.accessToken, parsedForm.data, request.key);
      announcementCreateRequest.current = null;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch (submitError) {
      setError(apiErrorMessage(submitError, "Duyuru yayınlanamadı."));
    } finally {
      setIsPublishing(false);
    }
  }

  async function handlePreviewAnnouncementSms() {
    if (!auth || !selectedAnnouncement) return;
    if (isPreviewingSms) return;

    setSmsDeliveryReportJobId("");
    setSmsError("");
    setSmsStatus("");
    if (!selectedSmsTemplate) {
      setSmsError("SMS şablonu bulunamadı.");
      return;
    }

    setIsPreviewingSms(true);
    try {
      const preview = await previewSmsRecipients(auth.accessToken, {
        announcementId: selectedAnnouncement.id,
        studentStatus: "ACTIVE",
      });
      if (preview.recipients.length === 0) {
        setSmsRecipientPreview(preview);
        setSmsStatus("SMS izni olan veli alıcısı bulunamadı.");
        return;
      }
      setSmsRecipientPreview(preview);
      setSmsStatus(`${preview.recipientCount} izinli veli alıcısı hazırlandı.`);
    } catch (smsError) {
      setSmsError(apiErrorMessage(smsError, "Duyuru SMS alıcıları getirilemedi."));
    } finally {
      setIsPreviewingSms(false);
    }
  }

  async function handleSendAnnouncementSms() {
    if (!auth || !selectedAnnouncement || !selectedSmsTemplate || !smsRecipientPreview || isSendingSms) return;
    if (smsRecipientPreview.recipientCount === 0) {
      setSmsError("SMS izni olan veli alıcısı bulunamadı.");
      return;
    }

    const confirmed = await confirm({
      confirmLabel: "SMS gönder",
      confirmVariant: "primary",
      description: "Mesaj seçili izinli veli alıcıları için gönderime hazırlanacak.",
      message: (
        <span>
          <strong>Başlık:</strong> {selectedAnnouncement.title}<br />
          <strong>Metin:</strong> {selectedSmsTemplate.body}<br />
          <strong>Hedef:</strong> {audienceLabel(selectedAnnouncement.audience)} · {scopeLabel(selectedAnnouncement, { campusNames, gradeLevelNames, classNames, courseNames, termNames })}<br />
          <strong>Kanal:</strong> SMS<br />
          <strong>Zamanlama:</strong> Hemen<br />
          <strong>İzinli alıcı:</strong> {smsRecipientPreview.recipientCount}
        </span>
      ),
      title: "SMS gönderimini onayla",
    });
    if (!confirmed) return;

    setSmsError("");
    setSmsStatus("");
    setIsSendingSms(true);
    try {
      const input = {
        templateId: selectedSmsTemplate.id,
        recipients: smsRecipientPreview.recipients.map((recipient) => ({ to: recipient.to })),
        recipientScope: { announcementId: selectedAnnouncement.id, studentStatus: "ACTIVE" as const },
      };
      const fingerprint = JSON.stringify(input);
      const request = smsCreateRequest.current?.fingerprint === fingerprint
        ? smsCreateRequest.current
        : { fingerprint, key: crypto.randomUUID() };
      smsCreateRequest.current = request;
      const result = await createSmsBatch(auth.accessToken, input, request.key);
      smsCreateRequest.current = null;
      setSmsDeliveryReportJobId(result.jobId);
      setSmsStatus(`${result.recipientCount} alıcı için gönderim başlatıldı.`);
    } catch (smsError) {
      setSmsError(apiErrorMessage(smsError, "Duyuru SMS gönderimi başlatılamadı."));
    } finally {
      setIsSendingSms(false);
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
        description="Kurum genelindeki bilgilendirmeleri yayınlayın ve okunma durumunu izleyin."
        emptyState={
          <EmptyState
            title="Duyuru yok"
            description="Kurum genelindeki ilk duyuruyu yayınlayarak başlayın."
            primaryAction={{ label: "Duyuru ekle", onClick: openCreateForm }}
          />
        }
        emptyText="Duyuru kaydı yok"
        error={error || (announcementsQuery.isError ? apiErrorMessage(announcementsQuery.error, "Duyurular alınamadı.") : undefined)}
        getRowKey={(announcement) => announcement.id}
        density="compact"
        hasActiveFilters={Boolean(listQuery.q.trim())}
        loading={announcementsQuery.isPending}
        rowClassName={(announcement) => (announcement.id === selectedReportId ? "next-announcement-row--selected" : undefined)}
        rows={rows}
        summary={
          <OperationSummary
            actions={announcementSummaryActions}
            ariaLabel="Duyuru özeti"
            badges={announcementSummaryBadges}
            items={announcementSummaryItems}
          />
        }
        tableCaption="Duyuru yönetimi"
        tableDescription="Kurum duyuruları ve geçmiş hedef bilgileri."
        title="Duyurular"
      />
      {selectedReportId ? (
        <Panel
          aria-label="Duyuru alıcı raporu"
          title="Alıcı raporu"
          description={selectedAnnouncement?.title ?? "Seçili duyuru listede yok"}
          actions={
            <Button type="button" variant="secondary" onClick={closeRecipientReport}>
              Kapat
            </Button>
          }
        >
          {reportDataQuery.isPending ? (
            <Alert title="Rapor yükleniyor">Alıcı raporu hazırlanıyor.</Alert>
          ) : reportDataQuery.isError ? (
            <Alert tone="danger" title="Alıcı raporu alınamadı">
              {apiErrorMessage(reportDataQuery.error, "Alıcı raporu alınamadı.")}
            </Alert>
          ) : reportDataQuery.data?.recipientReport ? (
            <AnnouncementRecipientReportPanel report={reportDataQuery.data.recipientReport} />
          ) : null}
          {isSmsEnabled && selectedAnnouncement && selectedAnnouncement.audience !== "TEACHERS" ? (
            <Panel
              aria-label="Duyuru SMS gönderimi"
              title="SMS gönderimi"
              description={selectedAnnouncement.title}
              tone="muted"
            >
              <Field label="SMS şablonu">
                <Select
                  value={selectedSmsTemplate?.id ?? ""}
                  onChange={(event) => {
                    setSmsTemplateId(event.target.value);
                    setSmsRecipientPreview(null);
                    setSmsStatus("");
                    setSmsError("");
                  }}
                >
                  {messageTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Mesaj uzunluğu" description="Bilgilendirme amaçlıdır; ücret veya SMS parça sayısı tahmini değildir.">
                <span>{selectedSmsTemplate?.body.length ?? 0} karakter</span>
              </Field>
              <Panel
                aria-label="Duyuru SMS önizleme"
                title={selectedSmsTemplate?.name ?? "Şablon seçilmedi"}
                description={smsRecipientPreview ? `${smsRecipientPreview.recipientCount} izinli veli alıcısı` : "Alıcı önizlemesi bekleniyor"}
                tone="muted"
              >
                <p className="next-sms-message-preview">{selectedSmsTemplate?.body ?? "Gönderilecek mesaj metni burada görünür."}</p>
              </Panel>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handlePreviewAnnouncementSms()}
                disabled={!selectedSmsTemplate || isPreviewingSms || isSendingSms}
              >
                {isPreviewingSms ? "Alıcılar getiriliyor..." : "Alıcıları önizle"}
              </Button>
              <Button
                type="button"
                onClick={() => void handleSendAnnouncementSms()}
                disabled={!selectedSmsTemplate || !smsRecipientPreview || smsRecipientPreview.recipientCount === 0 || isPreviewingSms || isSendingSms}
              >
                <Send size={17} aria-hidden="true" />
                {isSendingSms ? "Gönderim hazırlanıyor..." : "SMS gönder"}
              </Button>
              {smsStatus ? (
                <Alert tone="success" title="SMS gönderimi başladı">
                  {smsStatus}
                </Alert>
              ) : null}
              {smsError ? (
                <Alert tone="danger" title="SMS gönderimi başlatılamadı">
                  {smsError}
                </Alert>
              ) : null}
              {smsDeliveryReportJobId ? (
                <SmsDeliveryReportPanel
                  isError={reportDataQuery.isError}
                  isLoading={reportDataQuery.isPending}
                  jobId={smsDeliveryReportJobId}
                  onRefresh={() => void reportDataQuery.refetch()}
                  report={reportDataQuery.data?.smsDeliveryReport}
                />
              ) : null}
            </Panel>
          ) : null}
        </Panel>
      ) : null}
      <FormModal
        description="Başlık ve duyuru metni zorunludur. Duyuru kurum genelinde yayımlanır."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel="Yayınla"
        submitting={isPublishing}
        title="Duyuru ekle"
      >
        <Field label="Başlık">
          <Input
            required
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <Field label="Duyuru metni" description={`Kurum kullanıcılarıyla paylaşılacak içerik · ${form.body.length} karakter`}>
          <Textarea
            required
            rows={5}
            value={form.body}
            onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
          />
        </Field>
        <Panel
          aria-label="Duyuru önizleme"
          title={form.title.trim() || "Başlık girilmedi"}
          description="Kurum geneli · Uygulama içi duyuru · Hemen"
          tone="muted"
        >
          <p>{form.body.trim() || "Duyuru metni burada görünür."}</p>
          <p>Kurum ana sayfasında ve kullanıcı duyuru ekranlarında görünür.</p>
        </Panel>
      </FormModal>
      {confirmationDialog}
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

async function createAnnouncement(accessToken: string, input: AnnouncementFormPayload, idempotencyKey: string) {
  return apiRequest<AnnouncementRecord>(accessToken, `${apiBaseUrl}/announcements`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
    method: "POST",
  });
}

async function loadRecipientReport(accessToken: string, announcementId: string) {
  return apiRequest<AnnouncementRecipientReport>(accessToken, `${apiBaseUrl}/announcements/${encodeURIComponent(announcementId)}/recipients`);
}

async function previewSmsRecipients(
  accessToken: string,
  input: { announcementId: string; studentStatus: "ACTIVE" | "PASSIVE" },
) {
  return apiRequest<SmsBatchRecipientPreviewResult>(accessToken, `${apiBaseUrl}/sms-batches/recipients/preview`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function createSmsBatch(
  accessToken: string,
  input: {
    templateId: string;
    recipients: Array<{ to: string }>;
    recipientScope: { announcementId: string; studentStatus: "ACTIVE" };
  },
  idempotencyKey: string,
) {
  return apiRequest<SmsBatchQueueResult>(accessToken, `${apiBaseUrl}/sms-batches`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
    method: "POST",
  });
}

async function loadSmsBatchDeliveryReport(accessToken: string, jobId: string) {
  return apiRequest<SmsBatchDeliveryReportRecord>(accessToken, `${apiBaseUrl}/sms-batches/${encodeURIComponent(jobId)}`);
}

async function loadAnnouncementPageData(accessToken: string): Promise<AnnouncementPageData> {
  const [references, messageTemplates] = await Promise.all([
    loadReferences(accessToken),
    isSmsEnabled
      ? apiListRequest<MessageTemplateRecord>(accessToken, buildListUrl(`${apiBaseUrl}/message-templates`, initialListQuery))
      : Promise.resolve({ data: [] }),
  ]);
  return { references, messageTemplates: messageTemplates.data };
}

async function loadAnnouncementReportData(
  accessToken: string,
  announcementId: string,
  smsDeliveryReportJobId: string,
): Promise<AnnouncementReportData> {
  const [recipientReport, smsDeliveryReport] = await Promise.all([
    loadRecipientReport(accessToken, announcementId),
    smsDeliveryReportJobId ? loadSmsBatchDeliveryReport(accessToken, smsDeliveryReportJobId) : Promise.resolve(undefined),
  ]);
  return { recipientReport, smsDeliveryReport };
}

async function loadReferences(accessToken: string) {
  const [campuses, gradeLevels, classes, courses, terms] = await Promise.all([
    fetchReference<CampusRecord>(accessToken, "campuses"),
    fetchReference<GradeLevelRecord>(accessToken, "grade-levels"),
    fetchReference<ClassRecord>(accessToken, "classes"),
    fetchReference<CourseRecord>(accessToken, "courses"),
    fetchReference<AcademicTermRecord>(accessToken, "academic-terms"),
  ]);
  return { campuses, gradeLevels, classes, courses, terms };
}

async function fetchReference<T>(accessToken: string, path: string): Promise<T[]> {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/${path}`);
  if (!response.ok) throw new Error(`${path.toUpperCase()}_LOAD_FAILED`);
  const payload = (await response.json()) as T[] | { data?: T[] };
  return Array.isArray(payload) ? payload : (payload.data ?? []);
}

function audienceLabel(audience: AnnouncementRecord["audience"]) {
  if (audience === "TEACHERS") return "Öğretmenler";
  if (audience === "STUDENTS") return "Öğrenciler";
  if (audience === "GUARDIANS") return "Veliler";
  return "Tüm okul";
}

function buildAnnouncementSummaryItems({
  listTotal,
  recipientReport,
  rows,
}: {
  listTotal: number;
  recipientReport?: AnnouncementRecipientReport;
  rows: AnnouncementRecord[];
}): OperationSummaryItem[] {
  const smsEligibleCount = rows.filter((announcement) => announcement.audience !== "TEACHERS").length;
  const scopedCount = rows.filter(hasAnnouncementScope).length;
  const guardianCount = rows.filter((announcement) => announcement.audience === "GUARDIANS").length;
  const readProgress = recipientReport ? `${formatCount(recipientReport.read)}/${formatCount(recipientReport.total)}` : "Seçim bekliyor";

  const items: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam duyuru",
      key: "total",
      label: "Duyuru toplamı",
      value: formatCount(listTotal),
    },
  ];

  if (isSmsEnabled) {
    items.push(
    {
      description: `${formatCount(guardianCount)} veli hedefli`,
      key: "sms-eligible",
      label: "SMS uygun",
      tone: smsEligibleCount > 0 ? "info" : "default",
      value: formatCount(smsEligibleCount),
    },
    );
  }

  items.push(
    {
      description: "Kampüs, sınıf, ders veya dönem hedefli",
      key: "scoped",
      label: "Kapsamlı hedef",
      tone: scopedCount > 0 ? "info" : "default",
      value: `${formatCount(scopedCount)}/${formatCount(rows.length)}`,
    },
    {
      description: recipientReport ? "Seçili duyuru okundu oranı" : "Alıcı raporu seçilmedi",
      key: "read-progress",
      label: "Okunma takibi",
      tone: recipientReport && recipientReport.unread > 0 ? "warning" : recipientReport ? "success" : "default",
      value: readProgress,
    },
  );

  return items;
}

function buildAnnouncementSummaryBadges({
  isReferenceLoading,
  listQuery,
  messageTemplates,
}: {
  isReferenceLoading: boolean;
  listQuery: ListQueryState;
  messageTemplates: MessageTemplateRecord[];
}): OperationSummaryBadge[] {
  const badges: OperationSummaryBadge[] = [
    {
      key: "sort",
      label: formatAnnouncementSortLabel(listQuery.sort),
      tone: listQuery.sort ? "info" : "neutral",
    },
    {
      key: "references",
      label: isReferenceLoading ? "Seçim listeleri yükleniyor" : "Seçim listeleri hazır",
      tone: isReferenceLoading ? "warning" : "success",
    },
  ];

  if (isSmsEnabled) {
    badges.push(
    {
      key: "templates",
      label: messageTemplates.length > 0 ? "SMS şablonu hazır" : "SMS şablonu bekliyor",
      tone: messageTemplates.length > 0 ? "success" : "warning",
    },
    );
  }

  return badges;
}

function buildAnnouncementSummaryActions({
  recipientReport,
  selectedAnnouncement,
  selectedSmsTemplate,
  smsDeliveryReportJobId,
  smsStatus,
}: {
  recipientReport?: AnnouncementRecipientReport;
  selectedAnnouncement?: AnnouncementRecord;
  selectedSmsTemplate?: MessageTemplateRecord;
  smsDeliveryReportJobId: string;
  smsStatus: string;
}): OperationSummaryAction[] {
  const smsUnavailable = selectedAnnouncement?.audience === "TEACHERS";

  const actions: OperationSummaryAction[] = [
    {
      detail: selectedAnnouncement ? "Seçili duyurunun alıcı kapsamı" : "Satırdaki Alıcılar aksiyonuyla açılır",
      key: "recipient-report",
      label: "Alıcı raporu",
      status: selectedAnnouncement ? "Seçili" : "Seçilmedi",
      tone: selectedAnnouncement ? "info" : "neutral",
      value: recipientReport ? `${formatCount(recipientReport.total)} alıcı` : "Bekliyor",
    },
  ];

  if (isSmsEnabled) {
    actions.push(
    {
      detail: smsUnavailable ? "Öğretmen hedefinde SMS kapalı" : selectedSmsTemplate ? selectedSmsTemplate.name : "Önce SMS şablonu oluşturulmalı",
      key: "sms-queue",
      label: "SMS gönderimi",
      status: smsDeliveryReportJobId ? "Gönderim başladı" : selectedSmsTemplate && !smsUnavailable ? "Hazır" : "Bekliyor",
      tone: smsDeliveryReportJobId ? "warning" : selectedSmsTemplate && !smsUnavailable ? "success" : "neutral",
      value: smsStatus || (smsUnavailable ? "Uygun değil" : selectedSmsTemplate ? "Gönderilebilir" : "Şablon yok"),
    },
    );
  }

  actions.push(
    {
      detail: recipientReport ? "Okunmayan alıcılar raporda görünür" : "Rapor seçimi bekleniyor",
      key: "read-tracking",
      label: "Okunma takibi",
      status: recipientReport && recipientReport.unread > 0 ? "Takip" : recipientReport ? "Güncel" : "Bekliyor",
      tone: recipientReport && recipientReport.unread > 0 ? "warning" : recipientReport ? "success" : "neutral",
      value: recipientReport ? `${formatCount(recipientReport.unread)} bekliyor` : "Rapor yok",
    },
  );

  return actions;
}

function scopeLabel(
  announcement: Pick<AnnouncementRecord, "campusId" | "gradeLevelId" | "classId" | "courseId" | "termId">,
  lookups: {
    campusNames: Map<string, string>;
    gradeLevelNames: Map<string, string>;
    classNames: Map<string, string>;
    courseNames: Map<string, string>;
    termNames: Map<string, string>;
  },
) {
  const fallback = "Kapsam doğrulanmadı";
  const unresolvedFallback = (value: string | undefined) => (value ? fallback : "");
  const parts = [
    announcement.campusId ? (lookups.campusNames.get(announcement.campusId) ?? unresolvedFallback(announcement.campusId)) : "",
    announcement.gradeLevelId ? (lookups.gradeLevelNames.get(announcement.gradeLevelId) ?? unresolvedFallback(announcement.gradeLevelId)) : "",
    announcement.classId ? (lookups.classNames.get(announcement.classId) ?? unresolvedFallback(announcement.classId)) : "",
    announcement.courseId ? (lookups.courseNames.get(announcement.courseId) ?? unresolvedFallback(announcement.courseId)) : "",
    announcement.termId ? (lookups.termNames.get(announcement.termId) ?? unresolvedFallback(announcement.termId)) : "",
  ].filter(Boolean);
  return parts.length > 0 ? Array.from(new Set(parts)).join(" / ") : "Tüm kapsam";
}

function hasAnnouncementScope(announcement: AnnouncementRecord) {
  return Boolean(announcement.campusId || announcement.gradeLevelId || announcement.classId || announcement.courseId || announcement.termId);
}

function formatAnnouncementSortLabel(sort: string) {
  const option = announcementSortOptions.find((candidate) => candidate.value === sort);
  return option ? `Sıralama: ${option.label}` : "Sıralama: Varsayılan";
}

function formatCount(value: number) {
  return value.toLocaleString("tr-TR");
}

function AnnouncementRecipientReportPanel({ report }: { report: AnnouncementRecipientReport }) {
  const columns: Array<DataTableColumn<AnnouncementRecipientRecord>> = [
    {
      key: "recipient",
      header: "Alıcı",
      mobilePriority: "primary",
      priority: "primary",
      render: (recipient) => recipient.displayName,
      sticky: "left",
    },
    {
      key: "type",
      header: "Tür",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (recipient) => recipientTypeLabel(recipient.recipientType),
    },
    {
      key: "student",
      header: "Öğrenci",
      mobilePriority: "hidden",
      priority: "optional",
      render: (recipient) => recipient.relatedStudentName ?? "-",
    },
    {
      key: "status",
      header: "Durum",
      mobilePriority: "primary",
      priority: "secondary",
      render: (recipient) => (
        <StatusBadge tone={recipientReadTone(recipient)}>
          {recipient.readAt ? `Okundu ${new Date(recipient.readAt).toLocaleString("tr-TR")}` : "Bekliyor"}
        </StatusBadge>
      ),
    },
  ];

  return (
    <>
      <MetricGrid aria-label="Alıcı raporu özeti" role="region">
        <MetricCard label="Toplam" value={report.total} description="Duyuru kapsamındaki kişi" />
        <MetricCard label="Okundu" tone="success" value={report.read} description="Okuma zamanı kaydedildi" />
        <MetricCard label="Bekleyen" tone="warning" value={report.unread} description="Okuma bekliyor" />
      </MetricGrid>
      <DataTable
        caption="Duyuru alıcıları"
        columns={columns}
        density="compact"
        description="Duyuruya bağlı alıcı kapsamı ve okundu durumu."
        emptyText="Alıcı yok"
        getRowKey={(recipient) => `${recipient.recipientType}-${recipient.subjectId}-${recipient.relatedStudentId ?? ""}`}
        rows={report.recipients}
      />
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

interface PendingIdempotentRequest {
  fingerprint: string;
  key: string;
}

function recipientTypeLabel(type: AnnouncementRecipientReport["recipients"][number]["recipientType"]) {
  if (type === "TEACHER") return "Öğretmen";
  if (type === "GUARDIAN") return "Veli";
  return "Öğrenci";
}

function recipientReadTone(recipient: AnnouncementRecipientRecord): StatusBadgeProps["tone"] {
  return recipient.readAt ? "success" : "warning";
}

const emptyReferences = {
  campuses: [] as CampusRecord[],
  gradeLevels: [] as GradeLevelRecord[],
  classes: [] as ClassRecord[],
  courses: [] as CourseRecord[],
  terms: [] as AcademicTermRecord[],
};
