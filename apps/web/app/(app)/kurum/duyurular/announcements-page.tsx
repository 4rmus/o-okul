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
} from "@uzman-hocam/ui";
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
} from "@uzman-hocam/shared-types";
import { Plus, Send } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
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
  const [error, setError] = useState("");
  const [smsError, setSmsError] = useState("");
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
  }

  function closeRecipientReport() {
    setSelectedReportId("");
    setSmsDeliveryReportJobId("");
    setSmsError("");
    setSmsStatus("");
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

    try {
      await createAnnouncement(auth.accessToken, parsedForm.data);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch (submitError) {
      setError(apiErrorMessage(submitError, "Duyuru yayınlanamadı."));
    }
  }

  async function handleSendAnnouncementSms() {
    if (!auth || !selectedAnnouncement) return;

    setSmsDeliveryReportJobId("");
    setSmsError("");
    setSmsStatus("");
    if (!selectedSmsTemplate) {
      setSmsError("SMS şablonu bulunamadı.");
      return;
    }

    try {
      const preview = await previewSmsRecipients(auth.accessToken, {
        announcementId: selectedAnnouncement.id,
        studentStatus: "ACTIVE",
      });
      if (preview.recipients.length === 0) {
        setSmsStatus("SMS izni olan veli alıcısı bulunamadı.");
        return;
      }

      const result = await createSmsBatch(auth.accessToken, {
        templateId: selectedSmsTemplate.id,
        recipients: preview.recipients.map((recipient) => ({ to: recipient.to })),
      });
      setSmsDeliveryReportJobId(result.jobId);
      setSmsStatus(`${result.recipientCount} alıcı kuyruğa alındı.`);
    } catch (smsError) {
      setSmsError(apiErrorMessage(smsError, "Duyuru SMS gönderimi başlatılamadı."));
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
        emptyState={
          <EmptyState
            title="Duyuru yok"
            description="Kurum, sınıf veya öğretmen hedefli ilk duyuruyu yayınlayarak başla."
            hint="SMS gönderimi için duyuru ve mesaj şablonu birlikte kullanılır."
            primaryAction={{ label: "Duyuru ekle", onClick: openCreateForm }}
          />
        }
        emptyText="Duyuru kaydı yok"
        error={error || (announcementsQuery.isError ? apiErrorMessage(announcementsQuery.error, "Duyurular alınamadı.") : undefined)}
        getRowKey={(announcement) => announcement.id}
        density="compact"
        loading={announcementsQuery.isPending}
        rowClassName={(announcement) => (announcement.id === selectedReportId ? "next-announcement-row--selected" : undefined)}
        rows={rows}
        summary={
          <OperationSummary
            actions={announcementSummaryActions}
            ariaLabel="Duyuru operasyon özeti"
            badges={announcementSummaryBadges}
            items={announcementSummaryItems}
          />
        }
        tableCaption="Duyuru yönetimi"
        tableDescription="Kurum, sınıf, öğretmen, öğrenci ve veli hedefli duyuru operasyonları."
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
          {selectedAnnouncement && selectedAnnouncement.audience !== "TEACHERS" ? (
            <Panel
              aria-label="Duyuru SMS gönderimi"
              title="SMS gönderimi"
              description={selectedAnnouncement.title}
              tone="muted"
            >
              <Field label="SMS şablonu">
                <Select
                  value={selectedSmsTemplate?.id ?? ""}
                  onChange={(event) => setSmsTemplateId(event.target.value)}
                >
                  {messageTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="button" onClick={() => void handleSendAnnouncementSms()} disabled={!selectedSmsTemplate}>
                <Send size={17} aria-hidden="true" />
                SMS gönder
              </Button>
              {smsStatus ? (
                <Alert tone="success" title="SMS kuyruğa alındı">
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
        description="Başlık ve duyuru metni zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel="Yayınla"
        title="Duyuru ekle"
      >
        <Field label="Başlık">
          <Input
            required
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <Field label="Duyuru metni" description="Veliler, öğrenciler veya öğretmenlerle paylaşılacak duyuru içeriği.">
          <Textarea
            required
            rows={5}
            value={form.body}
            onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
          />
        </Field>
        <Field label="Hedef">
          <Select
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
            <option value="STUDENTS">Öğrenciler</option>
            <option value="GUARDIANS">Veliler</option>
          </Select>
        </Field>
        <Field label="Kampüs">
          <Select
            value={form.campusId}
            onChange={(event) => setForm((current) => ({ ...current, campusId: event.target.value }))}
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
            value={form.gradeLevelId}
            onChange={(event) => setForm((current) => ({ ...current, gradeLevelId: event.target.value }))}
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
            value={form.classId}
            onChange={(event) => setForm((current) => ({ ...current, classId: event.target.value }))}
          >
            <option value="">Tüm sınıflar</option>
            {references.classes.map((schoolClass) => (
              <option key={schoolClass.id} value={schoolClass.id}>
                {schoolClass.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ders">
          <Select
            value={form.courseId}
            onChange={(event) => setForm((current) => ({ ...current, courseId: event.target.value }))}
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
            value={form.termId}
            onChange={(event) => setForm((current) => ({ ...current, termId: event.target.value }))}
          >
            <option value="">Tüm dönemler</option>
            {references.terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </Select>
        </Field>
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

async function loadAnnouncementPageData(accessToken: string): Promise<AnnouncementPageData> {
  const [references, messageTemplates] = await Promise.all([
    loadReferences(accessToken),
    apiListRequest<MessageTemplateRecord>(accessToken, buildListUrl(`${apiBaseUrl}/message-templates`, initialListQuery)),
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

  return [
    {
      description: "URL state ile sayfalanan kayıt",
      key: "total",
      label: "Duyuru toplamı",
      value: formatCount(listTotal),
    },
    {
      description: `${formatCount(guardianCount)} veli hedefli`,
      key: "sms-eligible",
      label: "SMS uygun",
      tone: smsEligibleCount > 0 ? "info" : "default",
      value: formatCount(smsEligibleCount),
    },
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
  ];
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
  return [
    {
      key: "sort",
      label: formatAnnouncementSortLabel(listQuery.sort),
      tone: listQuery.sort ? "info" : "neutral",
    },
    {
      key: "references",
      label: isReferenceLoading ? "Referanslar yükleniyor" : "Bağlam referansları hazır",
      tone: isReferenceLoading ? "warning" : "success",
    },
    {
      key: "templates",
      label: messageTemplates.length > 0 ? "SMS şablonu hazır" : "SMS şablonu bekliyor",
      tone: messageTemplates.length > 0 ? "success" : "warning",
    },
  ];
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

  return [
    {
      detail: selectedAnnouncement ? "Seçili duyurunun alıcı kapsamı" : "Satırdaki Alıcılar aksiyonuyla açılır",
      key: "recipient-report",
      label: "Alıcı raporu",
      status: selectedAnnouncement ? "Seçili" : "Seçilmedi",
      tone: selectedAnnouncement ? "info" : "neutral",
      value: recipientReport ? `${formatCount(recipientReport.total)} alıcı` : "Bekliyor",
    },
    {
      detail: smsUnavailable ? "Öğretmen hedefinde SMS kapalı" : selectedSmsTemplate ? selectedSmsTemplate.name : "Önce SMS şablonu oluşturulmalı",
      key: "sms-queue",
      label: "SMS kuyruğu",
      status: smsDeliveryReportJobId ? "Kuyrukta" : selectedSmsTemplate && !smsUnavailable ? "Hazır" : "Bekliyor",
      tone: smsDeliveryReportJobId ? "warning" : selectedSmsTemplate && !smsUnavailable ? "success" : "neutral",
      value: smsStatus || (smsUnavailable ? "Uygun değil" : selectedSmsTemplate ? "Gönderilebilir" : "Şablon yok"),
    },
    {
      detail: recipientReport ? "Okunmayan alıcılar raporda görünür" : "Rapor seçimi bekleniyor",
      key: "read-tracking",
      label: "Okunma takibi",
      status: recipientReport && recipientReport.unread > 0 ? "Takip" : recipientReport ? "Güncel" : "Bekliyor",
      tone: recipientReport && recipientReport.unread > 0 ? "warning" : recipientReport ? "success" : "neutral",
      value: recipientReport ? `${formatCount(recipientReport.unread)} bekliyor` : "Rapor yok",
    },
  ];
}

function scopeLabel(
  announcement: AnnouncementRecord,
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
