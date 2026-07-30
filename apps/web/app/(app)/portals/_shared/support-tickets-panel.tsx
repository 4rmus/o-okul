"use client";

import { useState, type FormEvent } from "react";
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
import type { SupportTicketRecord } from "@o-okul/shared-types";
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
  readOnly = false,
  readOnlyMessage = "Yalnızca görüntüleme sırasında destek talebi açılamaz.",
}: {
  tickets: SupportTicketRecord[];
  onCreate?: (input: SupportTicketFormPayload) => void | Promise<unknown>;
  readOnly?: boolean;
  readOnlyMessage?: string;
}) {
  const [form, setForm] = useState<SupportTicketFormState>(emptySupportTicketForm);
  const [error, setError] = useState("");
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
