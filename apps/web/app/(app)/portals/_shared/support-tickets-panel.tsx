"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  DataTable,
  Field,
  Input,
  Panel,
  Select,
  StatusBadge,
  Textarea,
  type DataTableColumn,
  type StatusBadgeProps,
} from "@o-okul/ui";
import type {
  PortalSupportTicketCommentCreateResponse,
  PublicPortalSupportTicketCommentRecord,
  SupportTicketRecord,
} from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import {
  firstFormError,
  supportTicketFormSchema,
  type SupportTicketFormPayload,
  type SupportTicketFormState,
} from "../../../../src/form-validation.js";

const emptySupportTicketForm: SupportTicketFormState = {
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

export function SupportTicketsPanel({
  tickets,
  onCreate,
  accessToken,
  commentsPath,
  onTicketChange,
  readOnly = false,
  readOnlyMessage = "Yalnızca görüntüleme sırasında destek talebi açılamaz.",
}: {
  tickets: SupportTicketRecord[];
  onCreate?: (input: SupportTicketFormPayload) => void | Promise<unknown>;
  accessToken?: string;
  commentsPath?: string;
  onTicketChange?: () => void | Promise<unknown>;
  readOnly?: boolean;
  readOnlyMessage?: string;
}) {
  const [form, setForm] = useState<SupportTicketFormState>(emptySupportTicketForm);
  const [error, setError] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState(tickets[0]?.id ?? "");
  const [comments, setComments] = useState<PublicPortalSupportTicketCommentRecord[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const selectedTicket = tickets.find((ticket) => ticket.id === selectedTicketId) ?? tickets[0];

  useEffect(() => {
    if (!tickets.some((ticket) => ticket.id === selectedTicketId)) {
      setSelectedTicketId(tickets[0]?.id ?? "");
    }
  }, [selectedTicketId, tickets]);

  useEffect(() => {
    if (readOnly || !accessToken || !commentsPath || !selectedTicket) {
      setComments([]);
      return;
    }

    let active = true;
    setCommentsLoading(true);
    setReplyError("");
    void apiRequest<PublicPortalSupportTicketCommentRecord[]>(
      accessToken,
      `${apiBaseUrl}/${commentsPath}/${encodeURIComponent(selectedTicket.id)}/comments`,
    ).then((records) => {
      if (active) setComments(records);
    }).catch(() => {
      if (active) setReplyError("Konuşma yüklenemedi.");
    }).finally(() => {
      if (active) setCommentsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [accessToken, commentsPath, readOnly, selectedTicket]);
  const columns: Array<DataTableColumn<SupportTicketRecord>> = [
    {
      header: "Konu",
      key: "subject",
      mobilePriority: "primary",
      priority: "primary",
      render: (ticket) => ticket.subject,
      sticky: "left",
    },
    {
      header: "Öncelik",
      key: "priority",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (ticket) => (
        <StatusBadge tone={supportPriorityTone(ticket.priority)}>{supportPriorityLabel(ticket.priority)}</StatusBadge>
      ),
    },
    {
      header: "Durum",
      key: "status",
      mobilePriority: "primary",
      priority: "primary",
      render: (ticket) => (
        <StatusBadge tone={supportStatusTone(ticket.status)}>{supportStatusLabel(ticket.status)}</StatusBadge>
      ),
    },
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onCreate) return;

    setError("");
    const parsedForm = supportTicketFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      await onCreate(parsedForm.data);
      setForm(emptySupportTicketForm);
    } catch {
      setError("Destek talebi açılamadı.");
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !commentsPath || !selectedTicket || !reply.trim()) return;

    setReplyError("");
    setReplySubmitting(true);
    try {
      const result = await apiRequest<PortalSupportTicketCommentCreateResponse>(
        accessToken,
        `${apiBaseUrl}/${commentsPath}/${encodeURIComponent(selectedTicket.id)}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ body: reply.trim() }),
        },
      );
      setComments((current) => [...current, result.comment]);
      setReply("");
      await onTicketChange?.();
    } catch {
      setReplyError(selectedTicket.status === "CLOSED" ? "Bu talep kapandı. Yeni bir destek talebi açın." : "Yanıt gönderilemedi.");
    } finally {
      setReplySubmitting(false);
    }
  }

  return (
    <Panel
      aria-label="Destek talepleri"
      description="Portal kullanıcısının açabildiği veya takip edebildiği destek kayıtları."
      title="Destek Talepleri"
    >
      {readOnly ? (
        <p>{readOnlyMessage}</p>
      ) : (
        <form className="next-portal-support-form" onSubmit={(event) => void submit(event)}>
          <Field label="Konu">
            <Input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} />
          </Field>
          <Field label="Mesaj">
            <Textarea value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} />
          </Field>
          <Field label="Öncelik">
            <Select
              value={form.priority}
              onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as SupportTicketRecord["priority"] }))}
            >
              <option value="LOW">Düşük</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">Yüksek</option>
            </Select>
          </Field>
          <Button disabled={!onCreate} type="submit">Destek talebi aç</Button>
        </form>
      )}
      {error ? <p className="next-form-error">{error}</p> : null}
      <DataTable
        caption="Destek talepleri"
        columns={columns}
        description="Portal kullanıcısının görebildiği destek talebi durumu."
        emptyText="Destek talebi yok."
        getRowKey={(ticket) => ticket.id}
        rows={tickets}
      />
      {!readOnly && accessToken && commentsPath && tickets.length > 0 ? (
        <section aria-label="Destek konuşması" className="next-portal-support-conversation">
          <Field label="Görüntülenen talep">
            <Select value={selectedTicket?.id ?? ""} onChange={(event) => setSelectedTicketId(event.target.value)}>
              {tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.subject}</option>)}
            </Select>
          </Field>
          {selectedTicket ? (
            <div aria-live="polite" className="next-portal-support-thread">
              <article className="next-portal-support-message" data-author="requester">
                <strong>Siz</strong>
                <p>{selectedTicket.message}</p>
              </article>
              {commentsLoading ? <p>Konuşma yükleniyor…</p> : comments.map((comment) => (
                <article className="next-portal-support-message" data-author={comment.author.toLowerCase()} key={comment.id}>
                  <strong>{comment.author === "REQUESTER" ? "Siz" : "Kurum"}</strong>
                  <p>{comment.body}</p>
                </article>
              ))}
            </div>
          ) : null}
          {selectedTicket?.status === "CLOSED" ? (
            <p>Bu talep kapandı. Devam etmek için yeni bir destek talebi açın.</p>
          ) : (
            <form className="next-portal-support-reply" onSubmit={(event) => void submitReply(event)}>
              <Field label="Yanıtınız" description="Yalnızca metin gönderin; öğrenci bilgisi, TCKN veya dosya paylaşmayın.">
                <Textarea rows={4} value={reply} onChange={(event) => setReply(event.target.value)} />
              </Field>
              <Button disabled={replySubmitting || !reply.trim()} type="submit">
                {replySubmitting ? "Gönderiliyor…" : "Yanıt gönder"}
              </Button>
            </form>
          )}
          {replyError ? <p className="next-form-error">{replyError}</p> : null}
        </section>
      ) : null}
    </Panel>
  );
}

function supportPriorityLabel(priority: SupportTicketRecord["priority"]) {
  const labels: Record<SupportTicketRecord["priority"], string> = {
    HIGH: "Yüksek",
    LOW: "Düşük",
    NORMAL: "Normal",
  };
  return labels[priority];
}

function supportStatusLabel(status: SupportTicketRecord["status"]) {
  const labels: Record<SupportTicketRecord["status"], string> = {
    CLOSED: "Kapandı",
    IN_PROGRESS: "İşlemde",
    OPEN: "Açık",
    RESOLVED: "Çözüldü",
  };
  return labels[status];
}

function supportPriorityTone(priority: SupportTicketRecord["priority"]): StatusBadgeProps["tone"] {
  if (priority === "HIGH") return "danger";
  if (priority === "LOW") return "neutral";
  return "info";
}

function supportStatusTone(status: SupportTicketRecord["status"]): StatusBadgeProps["tone"] {
  if (status === "RESOLVED" || status === "CLOSED") return "success";
  if (status === "IN_PROGRESS") return "info";
  return "warning";
}
