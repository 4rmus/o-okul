"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import type {
  AcademicTermRecord,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  GradeLevelRecord,
  SupportTicketAttachmentDownloadResult,
  SupportTicketAttachmentRecord,
  SupportTicketCommentRecord,
  SupportTicketRecord,
} from "@uzman-hocam/shared-types";
import { CheckCircle2, CirclePlay, Download, Plus, Upload } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest, type ListMeta } from "../../../../src/api-client.js";
import {
  firstFormError,
  supportTicketAttachmentFormSchema,
  supportTicketCommentFormSchema,
  supportTicketFormSchema,
  type SupportTicketAttachmentFormPayload,
  type SupportTicketCommentFormPayload,
  type SupportTicketFormPayload,
  type SupportTicketFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

interface SupportTicketData {
  tickets: SupportTicketRecord[];
  meta: ListMeta;
  attachments: Record<string, SupportTicketAttachmentRecord[]>;
  comments: Record<string, SupportTicketCommentRecord[]>;
}

interface SupportTicketReferences {
  campuses: CampusRecord[];
  classes: ClassRecord[];
  courses: CourseRecord[];
  gradeLevels: GradeLevelRecord[];
  terms: AcademicTermRecord[];
}

const emptyForm: SupportTicketFormState = {
  subject: "",
  message: "",
  priority: "NORMAL",
  studentId: "",
  campusId: "",
  gradeLevelId: "",
  classId: "",
  courseId: "",
  termId: "",
};

const emptyFilters = {
  campusId: "",
  gradeLevelId: "",
  classId: "",
  courseId: "",
  termId: "",
};

const emptyReferences: SupportTicketReferences = {
  campuses: [],
  classes: [],
  courses: [],
  gradeLevels: [],
  terms: [],
};

const supportTicketSortOptions = [
  { label: "Konu A-Z", value: "subject" },
  { label: "Yeni kayıt", value: "-createdAt" },
  { label: "Öncelik", value: "priority" },
  { label: "Durum", value: "status" },
];

export function SupportTicketsPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const [filters, setFilters] = useState(emptyFilters);
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const queryKey = ["next-support-tickets", tenantId, listQuery, filters];
  const listQueryKey = ["next-support-tickets", tenantId];
  const ticketsQuery = useQuery({
    queryKey,
    queryFn: () => loadSupportTicketData(auth?.accessToken ?? "", listQuery, filters),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const referencesQuery = useQuery({
    queryKey: ["next-support-ticket-refs", tenantId],
    queryFn: () => loadSupportTicketReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [form, setForm] = useState<SupportTicketFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [attachmentTicketId, setAttachmentTicketId] = useState("");
  const [attachmentFileName, setAttachmentFileName] = useState("");
  const [attachmentContentType, setAttachmentContentType] = useState<SupportTicketAttachmentRecord["contentType"]>("text/plain");
  const [attachmentFileBase64, setAttachmentFileBase64] = useState("");
  const [commentTicketId, setCommentTicketId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState("");
  const [error, setError] = useState("");
  const data = ticketsQuery.data ?? emptySupportTicketData();
  const references = referencesQuery.data ?? emptyReferences;
  const rows = data.tickets;
  const classes = references.classes;
  const campuses = references.campuses;
  const gradeLevels = references.gradeLevels;
  const courses = references.courses;
  const terms = references.terms;
  const classNameById = new Map(classes.map((klass) => [klass.id, klass.name]));
  const campusNameById = new Map(campuses.map((campus) => [campus.id, campus.name]));
  const gradeLevelNameById = new Map(gradeLevels.map((level) => [level.id, level.name]));
  const courseNameById = new Map(courses.map((course) => [course.id, course.name]));
  const termNameById = new Map(terms.map((term) => [term.id, term.name]));

  useEffect(() => {
    if (!ticketsQuery.isSuccess) return;
    const firstTicketId = ticketsQuery.data.tickets[0]?.id ?? "";
    const visibleTicketIds = new Set(ticketsQuery.data.tickets.map((ticket) => ticket.id));
    setAttachmentTicketId((current) => (current && visibleTicketIds.has(current) ? current : firstTicketId));
    setCommentTicketId((current) => (current && visibleTicketIds.has(current) ? current : firstTicketId));
  }, [ticketsQuery.data, ticketsQuery.isSuccess]);

  const columns: Array<DataTableColumn<SupportTicketRecord>> = [
    {
      key: "subject",
      header: "Konu",
      render: (ticket) => ticket.subject,
    },
    {
      key: "priority",
      header: "Öncelik",
      render: (ticket) => priorityLabel(ticket.priority),
    },
    {
      key: "status",
      header: "Durum",
      render: (ticket) => statusLabel(ticket.status),
    },
    {
      key: "studentId",
      header: "Öğrenci",
      render: (ticket) => ticket.studentId ?? "-",
    },
    {
      key: "context",
      header: "Bağlam",
      render: (ticket) => formatTicketContext(ticket, { campusNameById, classNameById, courseNameById, gradeLevelNameById, termNameById }),
    },
    {
      key: "actions",
      header: "İşlem",
      render: (ticket) => (
        <span className="next-row-actions">
          <button
            type="button"
            onClick={() => void updateStatus(ticket, "IN_PROGRESS")}
            aria-label={`${ticket.subject} işleme al`}
          >
            <CirclePlay size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void updateStatus(ticket, "RESOLVED")}
            aria-label={`${ticket.subject} çözüldü`}
          >
            <CheckCircle2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
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

  function updateFilters(nextFilters: typeof emptyFilters) {
    setFilters(nextFilters);
    setListQuery((current) => ({ ...current, page: 1 }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = supportTicketFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedTicket = await createSupportTicket(auth.accessToken, parsedForm.data);
      await queryClient.invalidateQueries({ queryKey: listQueryKey });
      setAttachmentTicketId(savedTicket.id);
      setCommentTicketId(savedTicket.id);
      closeForm();
    } catch (submitError) {
      setError(apiErrorMessage(submitError, "Destek bildirimi açılamadı."));
    }
  }

  async function updateStatus(ticket: SupportTicketRecord, status: SupportTicketRecord["status"]) {
    if (!auth) return;

    setError("");
    try {
      const savedTicket = await updateSupportTicket(auth.accessToken, ticket.id, {
        priority: ticket.priority,
        status,
      });
      queryClient.setQueryData<SupportTicketData>(queryKey, (current = emptySupportTicketData()) => ({
        ...current,
        tickets: current.tickets.map((candidate) => (candidate.id === savedTicket.id ? savedTicket : candidate)),
      }));
    } catch (updateError) {
      setError(apiErrorMessage(updateError, "Destek bildirimi güncellenemedi."));
    }
  }

  async function handleAttachmentFileChange(file: File | undefined) {
    setError("");

    if (!file) {
      setAttachmentFileName("");
      setAttachmentFileBase64("");
      setAttachmentContentType("text/plain");
      return;
    }

    try {
      setAttachmentFileName(file.name);
      setAttachmentContentType(resolveBrowserAttachmentContentType(file.type));
      setAttachmentFileBase64(await readFileAsBase64(file));
    } catch {
      setAttachmentFileName("");
      setAttachmentFileBase64("");
      setAttachmentContentType("text/plain");
      setError("Destek eki okunamadı.");
    }
  }

  async function handleAttachmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = supportTicketAttachmentFormSchema.safeParse({
      ticketId: attachmentTicketId,
      fileName: attachmentFileName,
      contentType: attachmentContentType,
      fileBase64: attachmentFileBase64,
    });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      const savedAttachment = await addSupportTicketAttachment(auth.accessToken, parsedForm.data.ticketId, {
        fileName: parsedForm.data.fileName,
        contentType: parsedForm.data.contentType,
        fileBase64: parsedForm.data.fileBase64,
      });
      queryClient.setQueryData<SupportTicketData>(queryKey, (current = emptySupportTicketData()) => ({
        ...current,
        attachments: {
          ...current.attachments,
          [savedAttachment.ticketId]: [savedAttachment, ...(current.attachments[savedAttachment.ticketId] ?? [])],
        },
      }));
      setAttachmentFileName("");
      setAttachmentFileBase64("");
      setAttachmentContentType("text/plain");
    } catch (attachmentError) {
      setError(apiErrorMessage(attachmentError, "Destek eki yüklenemedi."));
    }
  }

  async function handleAttachmentDownload(ticketId: string, attachment: SupportTicketAttachmentRecord) {
    if (!auth) return;

    setError("");
    setDownloadingAttachmentId(attachment.id);
    try {
      downloadBase64File(await downloadSupportTicketAttachment(auth.accessToken, ticketId, attachment.id));
    } catch (downloadError) {
      setError(apiErrorMessage(downloadError, "Destek eki indirilemedi."));
    } finally {
      setDownloadingAttachmentId("");
    }
  }

  async function handleCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = supportTicketCommentFormSchema.safeParse({ ticketId: commentTicketId, body: commentBody });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      const savedComment = await addSupportTicketComment(auth.accessToken, parsedForm.data.ticketId, { body: parsedForm.data.body });
      queryClient.setQueryData<SupportTicketData>(queryKey, (current = emptySupportTicketData()) => ({
        ...current,
        comments: {
          ...current.comments,
          [savedComment.ticketId]: [...(current.comments[savedComment.ticketId] ?? []), savedComment],
        },
      }));
      setCommentBody("");
    } catch (commentError) {
      setError(apiErrorMessage(commentError, "Destek yorumu eklenemedi."));
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={data.meta}
              onChange={setListQuery}
              sortOptions={supportTicketSortOptions}
              state={listQuery}
            />
            <div className="next-list-controls" aria-label="Destek filtreleri">
              <label>
                Kampüs
                <select
                  value={filters.campusId}
                  onChange={(event) => updateFilters({ ...filters, campusId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Seviye
                <select
                  value={filters.gradeLevelId}
                  onChange={(event) => updateFilters({ ...filters, gradeLevelId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {gradeLevels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sınıf
                <select
                  value={filters.classId}
                  onChange={(event) => updateFilters({ ...filters, classId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {classes.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ders
                <select
                  value={filters.courseId}
                  onChange={(event) => updateFilters({ ...filters, courseId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Dönem
                <select
                  value={filters.termId}
                  onChange={(event) => updateFilters({ ...filters, termId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {terms.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Destek bildirimi aç
            </Button>
          </>
        }
        aria-label="Destek bildirimi yönetimi"
        columns={columns}
        description="Kurum destek bildirimlerini gerçek API çağrılarıyla izle."
        emptyState={
          <EmptyState
            title="Destek bildirimi yok"
            description="İlk destek bildirimini açarak takip ve yorum akışını başlat."
            hint="Bildirim oluştuğunda ek, yorum ve durum işlemleri burada görünür."
            primaryAction={{ label: "Destek bildirimi aç", onClick: openCreateForm }}
          />
        }
        emptyText="Destek bildirimi yok"
        error={error || (ticketsQuery.isError ? apiErrorMessage(ticketsQuery.error, "Destek bildirimleri alınamadı.") : undefined)}
        getRowKey={(ticket) => ticket.id}
        loading={ticketsQuery.isPending}
        rows={rows}
        title="Destek"
      />
      <section className="next-support-tools" aria-label="Destek bildirimi detayları">
        <form className="next-support-tool" onSubmit={(event) => void handleAttachmentSubmit(event)}>
          <h2>Ekler</h2>
          <label>
            Ek bildirimi
            <select
              value={attachmentTicketId}
              onChange={(event) => setAttachmentTicketId(event.target.value)}
              required
            >
              {rows.map((ticket) => (
                <option key={ticket.id} value={ticket.id}>
                  {ticket.subject}
                </option>
              ))}
            </select>
          </label>
          <label>
            Destek eki
            <Input
              type="file"
              onChange={(event) => void handleAttachmentFileChange(event.target.files?.[0])}
            />
          </label>
          <Button disabled={!attachmentTicketId} type="submit">
            <Upload size={17} aria-hidden="true" />
            Ek yükle
          </Button>
          {attachmentFileName ? <p>{attachmentFileName}</p> : null}
        </form>
        <form className="next-support-tool" onSubmit={(event) => void handleCommentSubmit(event)}>
          <h2>Yorumlar</h2>
          <label>
            Yorum bildirimi
            <select value={commentTicketId} onChange={(event) => setCommentTicketId(event.target.value)} required>
              {rows.map((ticket) => (
                <option key={ticket.id} value={ticket.id}>
                  {ticket.subject}
                </option>
              ))}
            </select>
          </label>
          <label>
            Yorum
            <Input
              required
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
            />
          </label>
          <Button disabled={!commentTicketId} type="submit">
            <Plus size={17} aria-hidden="true" />
            Yorum ekle
          </Button>
        </form>
        <section className="next-support-detail-list" aria-label="Destek ek ve yorum listesi">
          {rows.map((ticket) => (
            <article key={ticket.id}>
              <h3>{ticket.subject}</h3>
              {(data.attachments[ticket.id] ?? []).map((attachment) => (
                <p key={attachment.id}>
                  Ek: {attachment.fileName}
                  <button
                    type="button"
                    onClick={() => void handleAttachmentDownload(ticket.id, attachment)}
                    disabled={downloadingAttachmentId === attachment.id}
                    aria-label={`${attachment.fileName} indir`}
                  >
                    <Download size={16} aria-hidden="true" />
                  </button>
                </p>
              ))}
              {(data.comments[ticket.id] ?? []).map((comment) => (
                <p key={comment.id}>Yorum: {comment.body}</p>
              ))}
            </article>
          ))}
        </section>
      </section>
      <FormModal
        description="Konu ve mesaj zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel="Aç"
        title="Destek bildirimi aç"
      >
        <label>
          Konu
          <Input
            required
            value={form.subject}
            onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
          />
        </label>
        <label>
          Mesaj
          <Input
            required
            value={form.message}
            onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
          />
        </label>
        <label>
          Öncelik
          <select
            value={form.priority}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                priority: event.target.value as SupportTicketRecord["priority"],
              }))
            }
          >
            <option value="LOW">Düşük</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">Yüksek</option>
          </select>
        </label>
        <label>
          Kampüs
          <select
            value={form.campusId}
            onChange={(event) => setForm((current) => ({ ...current, campusId: event.target.value }))}
          >
            <option value="">Bağlam yok</option>
            {campuses.map((campus) => (
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
            <option value="">Bağlam yok</option>
            {gradeLevels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
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
            <option value="">Bağlam yok</option>
            {classes.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
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
            <option value="">Bağlam yok</option>
            {courses.map((course) => (
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
            <option value="">Bağlam yok</option>
            {terms.map((term) => (
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

function emptySupportTicketData(): SupportTicketData {
  return {
    tickets: [],
    meta: { total: 0, page: 1, limit: initialListQuery.limit, totalPages: 0 },
    attachments: {},
    comments: {},
  };
}

async function loadSupportTicketData(
  accessToken: string,
  listQuery: ListQueryState,
  filters: typeof emptyFilters,
): Promise<SupportTicketData> {
  const ticketResult = await loadSupportTickets(accessToken, listQuery, filters);
  const tickets = ticketResult.data;
  const [attachments, comments] = await Promise.all([
    loadSupportAttachmentMap(accessToken, tickets),
    loadSupportCommentMap(accessToken, tickets),
  ]);

  return { tickets, meta: ticketResult.meta, attachments, comments };
}

async function loadSupportTickets(accessToken: string, listQuery: ListQueryState, filters: typeof emptyFilters) {
  const url = new URL(buildListUrl(`${apiBaseUrl}/support-tickets`, listQuery));
  if (filters.campusId) url.searchParams.set("campusId", filters.campusId);
  if (filters.gradeLevelId) url.searchParams.set("gradeLevelId", filters.gradeLevelId);
  if (filters.classId) url.searchParams.set("classId", filters.classId);
  if (filters.courseId) url.searchParams.set("courseId", filters.courseId);
  if (filters.termId) url.searchParams.set("termId", filters.termId);
  return apiListRequest<SupportTicketRecord>(accessToken, url.toString());
}

async function loadSupportTicketReferences(accessToken: string): Promise<SupportTicketReferences> {
  const [campuses, classes, courses, gradeLevels, terms] = await Promise.all([
    apiListRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses`),
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`),
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`),
    apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return {
    campuses: campuses.data,
    classes: classes.data,
    courses: courses.data,
    gradeLevels: gradeLevels.data,
    terms: terms.data,
  };
}

async function createSupportTicket(accessToken: string, input: SupportTicketFormPayload) {
  return apiRequest<SupportTicketRecord>(accessToken, `${apiBaseUrl}/support-tickets`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateSupportTicket(
  accessToken: string,
  id: string,
  input: Pick<SupportTicketRecord, "priority" | "status">,
) {
  return apiRequest<SupportTicketRecord>(accessToken, `${apiBaseUrl}/support-tickets/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function loadSupportAttachmentMap(accessToken: string, tickets: SupportTicketRecord[]) {
  const entries = await Promise.all(
    tickets.map(async (ticket) => [
      ticket.id,
      await apiRequest<SupportTicketAttachmentRecord[]>(
        accessToken,
        `${apiBaseUrl}/support-tickets/${encodeURIComponent(ticket.id)}/attachments`,
      ),
    ] as const),
  );
  return Object.fromEntries(entries);
}

async function loadSupportCommentMap(accessToken: string, tickets: SupportTicketRecord[]) {
  const entries = await Promise.all(
    tickets.map(async (ticket) => [
      ticket.id,
      await apiRequest<SupportTicketCommentRecord[]>(
        accessToken,
        `${apiBaseUrl}/support-tickets/${encodeURIComponent(ticket.id)}/comments`,
      ),
    ] as const),
  );
  return Object.fromEntries(entries);
}

async function addSupportTicketAttachment(
  accessToken: string,
  ticketId: string,
  input: Omit<SupportTicketAttachmentFormPayload, "ticketId">,
) {
  return apiRequest<SupportTicketAttachmentRecord>(
    accessToken,
    `${apiBaseUrl}/support-tickets/${encodeURIComponent(ticketId)}/attachments`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function downloadSupportTicketAttachment(accessToken: string, ticketId: string, attachmentId: string) {
  return apiRequest<SupportTicketAttachmentDownloadResult>(
    accessToken,
    `${apiBaseUrl}/support-tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
  );
}

async function addSupportTicketComment(
  accessToken: string,
  ticketId: string,
  input: Pick<SupportTicketCommentFormPayload, "body">,
) {
  return apiRequest<SupportTicketCommentRecord>(
    accessToken,
    `${apiBaseUrl}/support-tickets/${encodeURIComponent(ticketId)}/comments`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

function priorityLabel(priority: SupportTicketRecord["priority"]) {
  if (priority === "HIGH") return "Yüksek";
  if (priority === "LOW") return "Düşük";
  return "Normal";
}

function statusLabel(status: SupportTicketRecord["status"]) {
  if (status === "IN_PROGRESS") return "İşlemde";
  if (status === "RESOLVED") return "Çözüldü";
  if (status === "CLOSED") return "Kapandı";
  return "Açık";
}

function formatTicketContext(
  ticket: SupportTicketRecord,
  maps: {
    campusNameById: Map<string, string>;
    classNameById: Map<string, string>;
    courseNameById: Map<string, string>;
    gradeLevelNameById: Map<string, string>;
    termNameById: Map<string, string>;
  },
) {
  const parts = [
    ticket.campusId ? (maps.campusNameById.get(ticket.campusId) ?? ticket.campusId) : "",
    ticket.gradeLevelId ? (maps.gradeLevelNameById.get(ticket.gradeLevelId) ?? ticket.gradeLevelId) : "",
    ticket.classId ? (maps.classNameById.get(ticket.classId) ?? ticket.classId) : "",
    ticket.courseId ? (maps.courseNameById.get(ticket.courseId) ?? ticket.courseId) : "",
    ticket.termId ? (maps.termNameById.get(ticket.termId) ?? ticket.termId) : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function resolveBrowserAttachmentContentType(value: string): SupportTicketAttachmentRecord["contentType"] {
  if (value === "application/pdf" || value === "image/jpeg" || value === "image/png") {
    return value;
  }
  return "text/plain";
}

async function readFileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function downloadBase64File(file: SupportTicketAttachmentDownloadResult): void {
  const binary = atob(file.fileBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}
