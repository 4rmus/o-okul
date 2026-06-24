"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  CrudPage,
  EmptyState,
  Field,
  FormModal,
  InfoGrid,
  InfoItem,
  Input,
  Panel,
  Select,
  StatusBadge,
  Textarea,
  type DataTableColumn,
  type StatusBadgeProps,
} from "@o-okul/ui";
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
} from "@o-okul/shared-types";
import { CheckCircle2, CirclePlay, Download, Eye, Plus, Upload } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest, type ListMeta } from "../../../../src/api-client.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
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
import { buildListUrl, initialListQuery, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

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

interface SupportFilters {
  campusId: string;
  gradeLevelId: string;
  classId: string;
  courseId: string;
  termId: string;
}

interface QueryParamReader {
  get(name: string): string | null;
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

const emptyFilters: SupportFilters = {
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

const supportFilterKeys: Array<keyof SupportFilters> = ["campusId", "gradeLevelId", "classId", "courseId", "termId"];

export function SupportTicketsPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: supportTicketSortOptions });
  const [filters, setFilters] = useState<SupportFilters>(() => readSupportFilters(searchParams));
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
  const [selectedTicketId, setSelectedTicketId] = useState("");
  const [attachmentFileName, setAttachmentFileName] = useState("");
  const [attachmentContentType, setAttachmentContentType] = useState<SupportTicketAttachmentRecord["contentType"]>("text/plain");
  const [attachmentFileBase64, setAttachmentFileBase64] = useState("");
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
  const courseNameById = new Map(courses.map((course) => [course.id, formatCourseName(course.name)]));
  const termNameById = new Map(terms.map((term) => [term.id, term.name]));
  const selectedTicket = rows.find((ticket) => ticket.id === selectedTicketId);
  const selectedTicketAttachments = selectedTicket ? (data.attachments[selectedTicket.id] ?? []) : [];
  const selectedTicketComments = selectedTicket ? (data.comments[selectedTicket.id] ?? []) : [];
  const selectedTicketContext = selectedTicket
    ? formatTicketContext(selectedTicket, { campusNameById, classNameById, courseNameById, gradeLevelNameById, termNameById })
    : "-";
  const openTicketCount = rows.filter((ticket) => ticket.status === "OPEN").length;
  const inProgressTicketCount = rows.filter((ticket) => ticket.status === "IN_PROGRESS").length;
  const highPriorityTicketCount = rows.filter((ticket) => ticket.priority === "HIGH").length;
  const ticketWithActivityCount = rows.filter(
    (ticket) => (data.attachments[ticket.id]?.length ?? 0) + (data.comments[ticket.id]?.length ?? 0) > 0,
  ).length;
  const supportSummaryItems: OperationSummaryItem[] = [
    {
      description: "Triage bekleyen bildirim",
      key: "open",
      label: "Açık",
      tone: openTicketCount > 0 ? "warning" : "success",
      value: formatCount(openTicketCount),
    },
    {
      description: "Operatörde aktif takip",
      key: "in-progress",
      label: "İşlemde",
      tone: inProgressTicketCount > 0 ? "info" : "default",
      value: formatCount(inProgressTicketCount),
    },
    {
      description: "Öncelikli dönüş gerektirir",
      key: "high",
      label: "Yüksek öncelik",
      tone: highPriorityTicketCount > 0 ? "danger" : "success",
      value: formatCount(highPriorityTicketCount),
    },
    {
      description: "Ek veya yorum içeren bildirim",
      key: "activity",
      label: "Aktivite",
      value: `${ticketWithActivityCount}/${rows.length}`,
    },
  ];
  const supportSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "filter",
      label: formatSupportFilterBadge(filters),
      tone: hasSupportFilters(filters) ? "info" : "neutral",
    },
    {
      key: "references",
      label: referencesQuery.isPending ? "Referanslar yükleniyor" : "Bağlam referansları hazır",
      tone: referencesQuery.isPending ? "warning" : "success",
    },
  ];
  const supportSummaryActions = buildSupportSummaryActions({
    highPriorityTicketCount,
    inProgressTicketCount,
    openTicketCount,
    selectedTicket,
  });

  useEffect(() => {
    const nextFilters = readSupportFilters(searchParams);
    setFilters((current) => (isSameSupportFilters(current, nextFilters) ? current : nextFilters));
  }, [searchParams, searchParamsKey]);

  useEffect(() => {
    if (!ticketsQuery.isSuccess) return;
    const firstTicketId = ticketsQuery.data.tickets[0]?.id ?? "";
    const visibleTicketIds = new Set(ticketsQuery.data.tickets.map((ticket) => ticket.id));
    setSelectedTicketId((current) => (current && visibleTicketIds.has(current) ? current : firstTicketId));
  }, [ticketsQuery.data, ticketsQuery.isSuccess]);

  const columns: Array<DataTableColumn<SupportTicketRecord>> = [
    {
      key: "subject",
      header: "Konu",
      mobilePriority: "primary",
      priority: "primary",
      render: (ticket) => ticket.subject,
      sticky: true,
    },
    {
      key: "priority",
      header: "Öncelik",
      mobilePriority: "primary",
      priority: "secondary",
      render: (ticket) => (
        <StatusBadge tone={priorityTone(ticket.priority)}>
          {priorityLabel(ticket.priority)}
        </StatusBadge>
      ),
    },
    {
      key: "status",
      header: "Durum",
      mobilePriority: "primary",
      priority: "primary",
      render: (ticket) => (
        <StatusBadge tone={supportStatusTone(ticket.status)}>
          {statusLabel(ticket.status)}
        </StatusBadge>
      ),
    },
    {
      key: "studentId",
      header: "Öğrenci",
      mobilePriority: "hidden",
      priority: "optional",
      render: (ticket) => (ticket.studentId ? "Bağlı öğrenci" : "-"),
    },
    {
      key: "context",
      header: "Bağlam",
      mobilePriority: "hidden",
      priority: "secondary",
      render: (ticket) => formatTicketContext(ticket, { campusNameById, classNameById, courseNameById, gradeLevelNameById, termNameById }),
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      mobileLabel: "Triage",
      mobilePriority: "primary",
      priority: "primary",
      render: (ticket) => (
        <span className="next-row-actions">
          <button
            type="button"
            onClick={() => {
              selectSupportTicket(ticket.id);
              void updateStatus(ticket, "IN_PROGRESS");
            }}
            aria-label={`${ticket.subject} işleme al`}
          >
            <CirclePlay size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              selectSupportTicket(ticket.id);
              void updateStatus(ticket, "RESOLVED");
            }}
            aria-label={`${ticket.subject} çözüldü`}
          >
            <CheckCircle2 size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => selectSupportTicket(ticket.id)}
            aria-label={`${ticket.subject} detayını aç`}
          >
            <Eye size={17} aria-hidden="true" />
          </button>
        </span>
      ),
      sticky: "right",
    },
  ];

  function selectSupportTicket(ticketId: string) {
    setSelectedTicketId(ticketId);
    setError("");
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

  function updateFilters(nextFilters: SupportFilters) {
    setFilters(nextFilters);
    setListQuery({ ...listQuery, page: 1 });
    writeSupportFiltersToUrl(nextFilters);
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
      selectSupportTicket(savedTicket.id);
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
      ticketId: selectedTicketId,
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
      downloadAttachmentFile(await downloadSupportTicketAttachment(auth.accessToken, ticketId, attachment.id));
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
    const parsedForm = supportTicketCommentFormSchema.safeParse({ ticketId: selectedTicketId, body: commentBody });
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
              <Field label="Kampüs">
                <Select
                  aria-label="Kampüs"
                  value={filters.campusId}
                  onChange={(event) => updateFilters({ ...filters, campusId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Seviye">
                <Select
                  aria-label="Seviye"
                  value={filters.gradeLevelId}
                  onChange={(event) => updateFilters({ ...filters, gradeLevelId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {gradeLevels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sınıf">
                <Select
                  aria-label="Sınıf"
                  value={filters.classId}
                  onChange={(event) => updateFilters({ ...filters, classId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {classes.map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Ders">
                <Select
                  aria-label="Ders"
                  value={filters.courseId}
                  onChange={(event) => updateFilters({ ...filters, courseId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {formatCourseName(course.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Dönem">
                <Select
                  aria-label="Dönem"
                  value={filters.termId}
                  onChange={(event) => updateFilters({ ...filters, termId: event.target.value })}
                >
                  <option value="">Tümü</option>
                  {terms.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name}
                    </option>
                  ))}
                </Select>
              </Field>
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
        density="compact"
        loading={ticketsQuery.isPending}
        rowClassName={(ticket) => (ticket.id === selectedTicketId ? "next-support-row--selected" : undefined)}
        rows={rows}
        summary={
          <OperationSummary
            actions={supportSummaryActions}
            ariaLabel="Destek operasyon özeti"
            badges={supportSummaryBadges}
            items={supportSummaryItems}
          />
        }
        tableCaption="Destek triage listesi"
        tableDescription="Bildirim konusu, öncelik, durum, eğitim bağlamı ve hızlı işlem aksiyonları."
        title="Destek"
      />
      <section className="next-support-detail-grid" aria-label="Destek bildirimi detayları">
        <Panel
          aria-label="Destek seçili bildirim detayı"
          className="next-support-selected-panel"
          description="Seçili bildirimin bağlamı, ekleri ve yorum akışı."
          title="Seçili Bildirim"
        >
          <Field label="Bildirim">
            <Select
              value={selectedTicketId}
              onChange={(event) => selectSupportTicket(event.target.value)}
              required
            >
              {rows.map((ticket) => (
                <option key={ticket.id} value={ticket.id}>
                  {ticket.subject}
                </option>
              ))}
            </Select>
          </Field>
          {selectedTicket ? (
            <div className="next-support-ticket-context">
              <h2>{selectedTicket.subject}</h2>
              <div className="next-support-ticket-badges" aria-label="Seçili bildirim durumu">
                <StatusBadge tone={priorityTone(selectedTicket.priority)}>{priorityLabel(selectedTicket.priority)}</StatusBadge>
                <StatusBadge tone={supportStatusTone(selectedTicket.status)}>{statusLabel(selectedTicket.status)}</StatusBadge>
              </div>
              <InfoGrid className="next-support-ticket-meta" aria-label="Seçili bildirim metrikleri" role="region">
                <InfoItem label="Bağlam" value={selectedTicketContext} />
                <InfoItem label="Ek" value={`${formatCount(selectedTicketAttachments.length)} ek`} />
                <InfoItem label="Yorum" value={`${formatCount(selectedTicketComments.length)} yorum`} />
              </InfoGrid>
              <p className="next-support-ticket-message">
                <strong>İlk mesaj</strong>
                <span>{selectedTicket.message}</span>
              </p>
            </div>
          ) : (
            <p>Listeden bir destek bildirimi seç.</p>
          )}
          <div className="next-support-ticket-actions">
            <form className="next-support-ticket-form" onSubmit={(event) => void handleAttachmentSubmit(event)}>
              <h3>Ekler</h3>
              <Field label="Destek eki">
                <Input
                  type="file"
                  onChange={(event) => void handleAttachmentFileChange(event.target.files?.[0])}
                />
              </Field>
              <Button disabled={!selectedTicketId} type="submit">
                <Upload size={17} aria-hidden="true" />
                Ek yükle
              </Button>
              {attachmentFileName ? <p>{attachmentFileName}</p> : null}
            </form>
            <form className="next-support-ticket-form" onSubmit={(event) => void handleCommentSubmit(event)}>
              <h3>Yorum akışı</h3>
              <Field label="Yorum">
                <Textarea
                  required
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                />
              </Field>
              <Button disabled={!selectedTicketId} type="submit">
                <Plus size={17} aria-hidden="true" />
                Yorum ekle
              </Button>
            </form>
          </div>
          <section className="next-support-ticket-activity" aria-label="Destek ek ve yorum listesi">
            {selectedTicket ? (
              <article key={selectedTicket.id}>
                <h3>{selectedTicket.subject}</h3>
                {selectedTicketAttachments.length > 0 ? (
                  selectedTicketAttachments.map((attachment) => (
                    <p key={attachment.id}>
                      Ek: {attachment.fileName}
                      <button
                        type="button"
                        onClick={() => void handleAttachmentDownload(selectedTicket.id, attachment)}
                        disabled={downloadingAttachmentId === attachment.id}
                        aria-label={`${attachment.fileName} indir`}
                      >
                        <Download size={16} aria-hidden="true" />
                      </button>
                    </p>
                  ))
                ) : (
                  <p>Ek yok</p>
                )}
                {selectedTicketComments.length > 0 ? (
                  selectedTicketComments.map((comment) => (
                    <p key={comment.id}>Yorum: {comment.body}</p>
                  ))
                ) : (
                  <p>Yorum yok</p>
                )}
              </article>
            ) : (
              <article>
                <h3>Seçili bildirim yok</h3>
                <p>Ek ve yorum geçmişi için listeden bir bildirim seç.</p>
              </article>
            )}
          </section>
        </Panel>
      </section>
      <FormModal
        description="Konu ve mesaj zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel="Aç"
        title="Destek bildirimi aç"
      >
        <Field label="Konu">
          <Input
            required
            value={form.subject}
            onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
          />
        </Field>
        <Field label="Mesaj">
          <Textarea
            required
            value={form.message}
            onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
          />
        </Field>
        <Field label="Öncelik">
          <Select
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
          </Select>
        </Field>
        <Field label="Kampüs">
          <Select
            value={form.campusId}
            onChange={(event) => setForm((current) => ({ ...current, campusId: event.target.value }))}
          >
            <option value="">Bağlam yok</option>
            {campuses.map((campus) => (
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
            <option value="">Bağlam yok</option>
            {gradeLevels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sınıf">
          <Select
            value={form.classId}
            onChange={(event) => setForm((current) => ({ ...current, classId: event.target.value }))}
          >
            <option value="">Bağlam yok</option>
            {classes.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ders">
          <Select
            value={form.courseId}
            onChange={(event) => setForm((current) => ({ ...current, courseId: event.target.value }))}
          >
            <option value="">Bağlam yok</option>
            {courses.map((course) => (
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
            <option value="">Bağlam yok</option>
            {terms.map((term) => (
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
  filters: SupportFilters,
): Promise<SupportTicketData> {
  const ticketResult = await loadSupportTickets(accessToken, listQuery, filters);
  const tickets = ticketResult.data;
  const [attachments, comments] = await Promise.all([
    loadSupportAttachmentMap(accessToken, tickets),
    loadSupportCommentMap(accessToken, tickets),
  ]);

  return { tickets, meta: ticketResult.meta, attachments, comments };
}

async function loadSupportTickets(accessToken: string, listQuery: ListQueryState, filters: SupportFilters) {
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

function priorityTone(priority: SupportTicketRecord["priority"]): StatusBadgeProps["tone"] {
  if (priority === "HIGH") return "danger";
  if (priority === "LOW") return "neutral";
  return "info";
}

function supportStatusTone(status: SupportTicketRecord["status"]): StatusBadgeProps["tone"] {
  if (status === "RESOLVED" || status === "CLOSED") return "success";
  if (status === "IN_PROGRESS") return "info";
  return "warning";
}

function buildSupportSummaryActions({
  highPriorityTicketCount,
  inProgressTicketCount,
  openTicketCount,
  selectedTicket,
}: {
  highPriorityTicketCount: number;
  inProgressTicketCount: number;
  openTicketCount: number;
  selectedTicket: SupportTicketRecord | undefined;
}): OperationSummaryAction[] {
  return [
    {
      detail: "Açık bildirimler ilk triage sırasıdır",
      key: "open-triage",
      label: "Triage kuyruğu",
      status: openTicketCount > 0 ? "Açık" : "Temiz",
      tone: openTicketCount > 0 ? "warning" : "success",
      value: formatCount(openTicketCount),
    },
    {
      detail: "Yüksek öncelik kurum içi hızlı dönüş ister",
      key: "priority-follow-up",
      label: "Öncelikli dönüş",
      status: highPriorityTicketCount > 0 ? "Acil" : "Normal",
      tone: highPriorityTicketCount > 0 ? "danger" : "success",
      value: formatCount(highPriorityTicketCount),
    },
    {
      detail: selectedTicket ? selectedTicket.subject : "Listeden bildirim seçilmedi",
      key: "selected-ticket",
      label: "Seçili bildirim",
      status: selectedTicket ? statusLabel(selectedTicket.status) : "Yok",
      tone: selectedTicket ? supportStatusTone(selectedTicket.status) : "neutral",
      value: selectedTicket ? priorityLabel(selectedTicket.priority) : "-",
    },
    {
      detail: "Operatörde aktif takipte kalan bildirim",
      key: "in-progress",
      label: "İşlemde takip",
      status: inProgressTicketCount > 0 ? "Sürüyor" : "Yok",
      tone: inProgressTicketCount > 0 ? "info" : "neutral",
      value: formatCount(inProgressTicketCount),
    },
  ];
}

function hasSupportFilters(filters: SupportFilters) {
  return supportFilterKeys.some((key) => filters[key]);
}

function formatSupportFilterBadge(filters: SupportFilters) {
  const activeFilterCount = supportFilterKeys.filter((key) => filters[key]).length;
  return activeFilterCount > 0 ? `${activeFilterCount} aktif filtre` : "Tüm destek kapsamı";
}

function readSupportFilters(searchParams: QueryParamReader): SupportFilters {
  return {
    campusId: searchParams.get("campusId") ?? emptyFilters.campusId,
    classId: searchParams.get("classId") ?? emptyFilters.classId,
    courseId: searchParams.get("courseId") ?? emptyFilters.courseId,
    gradeLevelId: searchParams.get("gradeLevelId") ?? emptyFilters.gradeLevelId,
    termId: searchParams.get("termId") ?? emptyFilters.termId,
  };
}

function writeSupportFiltersToUrl(filters: SupportFilters) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  for (const key of supportFilterKeys) {
    setOptionalQueryParam(url.searchParams, key, filters[key]);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
}

function isSameSupportFilters(left: SupportFilters, right: SupportFilters) {
  return supportFilterKeys.every((key) => left[key] === right[key]);
}

function setOptionalQueryParam(searchParams: URLSearchParams, key: string, value: string) {
  if (value) {
    searchParams.set(key, value);
    return;
  }
  searchParams.delete(key);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
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
  const fallback = "Bağlam doğrulanmadı";
  const parts = [
    ticket.campusId ? (maps.campusNameById.get(ticket.campusId) ?? fallback) : "",
    ticket.gradeLevelId ? (maps.gradeLevelNameById.get(ticket.gradeLevelId) ?? fallback) : "",
    ticket.classId ? (maps.classNameById.get(ticket.classId) ?? fallback) : "",
    ticket.courseId ? (maps.courseNameById.get(ticket.courseId) ?? fallback) : "",
    ticket.termId ? (maps.termNameById.get(ticket.termId) ?? fallback) : "",
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

function downloadAttachmentFile(file: SupportTicketAttachmentDownloadResult): void {
  if (file.downloadUrl) {
    const link = document.createElement("a");
    link.href = file.downloadUrl;
    link.download = file.fileName;
    link.click();
    return;
  }

  if (!file.fileBase64) {
    throw new Error("SUPPORT_TICKET_ATTACHMENT_DOWNLOAD_EMPTY");
  }

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
