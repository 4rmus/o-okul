"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import type {
  AcademicTermRecord,
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
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
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
  campusId: "",
  gradeLevelId: "",
  classId: "",
  courseId: "",
  termId: "",
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
  const referencesQuery = useQuery({
    queryKey: ["next-announcement-refs", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const messageTemplatesQuery = useQuery({
    queryKey: ["next-announcement-sms-templates", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadMessageTemplates(auth?.accessToken ?? ""),
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
  const messageTemplates = messageTemplatesQuery.data?.data ?? [];
  const selectedSmsTemplate = useMemo(
    () => messageTemplates.find((template) => template.id === smsTemplateId) ?? messageTemplates[0],
    [messageTemplates, smsTemplateId],
  );
  const reportQuery = useQuery({
    queryKey: ["next-announcement-recipient-report", auth?.session.tenantId ?? "anonymous", selectedReportId],
    queryFn: () => loadRecipientReport(auth?.accessToken ?? "", selectedReportId),
    enabled: Boolean(auth && selectedReportId),
    refetchOnWindowFocus: false,
  });
  const smsDeliveryReportQuery = useQuery({
    queryKey: ["next-announcement-sms-batch-report", auth?.session.tenantId ?? "anonymous", smsDeliveryReportJobId],
    queryFn: () => loadSmsBatchDeliveryReport(auth?.accessToken ?? "", smsDeliveryReportJobId),
    enabled: Boolean(auth && smsDeliveryReportJobId),
    refetchOnWindowFocus: false,
  });
  const references = referencesQuery.data ?? emptyReferences;
  const campusNames = useMemo(() => new Map(references.campuses.map((record) => [record.id, record.name])), [references.campuses]);
  const gradeLevelNames = useMemo(() => new Map(references.gradeLevels.map((record) => [record.id, record.name])), [references.gradeLevels]);
  const classNames = useMemo(() => new Map(references.classes.map((record) => [record.id, record.name])), [references.classes]);
  const courseNames = useMemo(() => new Map(references.courses.map((record) => [record.id, record.name])), [references.courses]);
  const termNames = useMemo(() => new Map(references.terms.map((record) => [record.id, record.name])), [references.terms]);

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
      key: "scope",
      header: "Kapsam",
      render: (announcement) => scopeLabel(announcement, { campusNames, gradeLevelNames, classNames, courseNames, termNames }),
    },
    {
      key: "publishedAt",
      header: "Yayın",
      render: (announcement) => new Date(announcement.publishedAt).toLocaleDateString("tr-TR"),
    },
    {
      key: "recipients",
      header: "Rapor",
      render: (announcement) => (
        <Button type="button" variant="secondary" onClick={() => openRecipientReport(announcement.id)}>
          Alıcılar
        </Button>
      ),
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
    } catch {
      setError("Duyuru yayınlanamadı.");
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
    } catch {
      setSmsError("Duyuru SMS gönderimi başlatılamadı.");
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
      {selectedReportId ? (
        <section aria-label="Duyuru alıcı raporu" className="uh-panel">
          <header className="uh-panel__header">
            <div>
              <h2>Alıcı raporu</h2>
              <p>{selectedAnnouncement?.title ?? selectedReportId}</p>
            </div>
            <Button type="button" variant="secondary" onClick={closeRecipientReport}>
              Kapat
            </Button>
          </header>
          {reportQuery.isPending ? (
            <p>Rapor yükleniyor...</p>
          ) : reportQuery.isError ? (
            <p>Alıcı raporu alınamadı.</p>
          ) : reportQuery.data ? (
            <AnnouncementRecipientReportPanel report={reportQuery.data} />
          ) : null}
          {selectedAnnouncement && selectedAnnouncement.audience !== "TEACHERS" ? (
            <section aria-label="Duyuru SMS gönderimi" className="next-preview-box">
              <header className="next-inline-header">
                <div>
                  <strong>SMS gönderimi</strong>
                  <p>{selectedAnnouncement.title}</p>
                </div>
              </header>
              <label>
                SMS şablonu
                <select
                  value={selectedSmsTemplate?.id ?? ""}
                  onChange={(event) => setSmsTemplateId(event.target.value)}
                >
                  {messageTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="button" onClick={() => void handleSendAnnouncementSms()} disabled={!selectedSmsTemplate}>
                <Send size={17} aria-hidden="true" />
                SMS gönder
              </Button>
              {smsStatus ? <p>{smsStatus}</p> : null}
              {smsError ? <p>{smsError}</p> : null}
              {smsDeliveryReportJobId ? (
                <SmsDeliveryReportPanel
                  isError={smsDeliveryReportQuery.isError}
                  isLoading={smsDeliveryReportQuery.isPending}
                  jobId={smsDeliveryReportJobId}
                  onRefresh={() => void smsDeliveryReportQuery.refetch()}
                  report={smsDeliveryReportQuery.data}
                />
              ) : null}
            </section>
          ) : null}
        </section>
      ) : null}
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
            <option value="STUDENTS">Öğrenciler</option>
            <option value="GUARDIANS">Veliler</option>
          </select>
        </label>
        <label>
          Kampüs
          <select
            value={form.campusId}
            onChange={(event) => setForm((current) => ({ ...current, campusId: event.target.value }))}
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
            value={form.gradeLevelId}
            onChange={(event) => setForm((current) => ({ ...current, gradeLevelId: event.target.value }))}
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
            value={form.classId}
            onChange={(event) => setForm((current) => ({ ...current, classId: event.target.value }))}
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
          Ders
          <select
            value={form.courseId}
            onChange={(event) => setForm((current) => ({ ...current, courseId: event.target.value }))}
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
            value={form.termId}
            onChange={(event) => setForm((current) => ({ ...current, termId: event.target.value }))}
          >
            <option value="">Tüm dönemler</option>
            {references.terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
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

async function loadMessageTemplates(accessToken: string) {
  return apiListRequest<MessageTemplateRecord>(accessToken, buildListUrl(`${apiBaseUrl}/message-templates`, initialListQuery));
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
  const parts = [
    announcement.campusId ? (lookups.campusNames.get(announcement.campusId) ?? announcement.campusId) : "",
    announcement.gradeLevelId ? (lookups.gradeLevelNames.get(announcement.gradeLevelId) ?? announcement.gradeLevelId) : "",
    announcement.classId ? (lookups.classNames.get(announcement.classId) ?? announcement.classId) : "",
    announcement.courseId ? (lookups.courseNames.get(announcement.courseId) ?? announcement.courseId) : "",
    announcement.termId ? (lookups.termNames.get(announcement.termId) ?? announcement.termId) : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "Tüm kapsam";
}

function AnnouncementRecipientReportPanel({ report }: { report: AnnouncementRecipientReport }) {
  return (
    <>
      <div className="uh-summary-grid">
        <span>Toplam: {report.total}</span>
        <span>Okundu: {report.read}</span>
        <span>Bekleyen: {report.unread}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Alıcı</th>
            <th>Tür</th>
            <th>Öğrenci</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>
          {report.recipients.length > 0 ? (
            report.recipients.map((recipient) => (
              <tr key={`${recipient.recipientType}-${recipient.subjectId}-${recipient.relatedStudentId ?? ""}`}>
                <td>{recipient.displayName}</td>
                <td>{recipientTypeLabel(recipient.recipientType)}</td>
                <td>{recipient.relatedStudentName ?? "-"}</td>
                <td>{recipient.readAt ? `Okundu ${new Date(recipient.readAt).toLocaleString("tr-TR")}` : "Bekliyor"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4}>Alıcı yok</td>
            </tr>
          )}
        </tbody>
      </table>
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

function recipientTypeLabel(type: AnnouncementRecipientReport["recipients"][number]["recipientType"]) {
  if (type === "TEACHER") return "Öğretmen";
  if (type === "GUARDIAN") return "Veli";
  return "Öğrenci";
}

const emptyReferences = {
  campuses: [] as CampusRecord[],
  gradeLevels: [] as GradeLevelRecord[],
  classes: [] as ClassRecord[],
  courses: [] as CourseRecord[],
  terms: [] as AcademicTermRecord[],
};
