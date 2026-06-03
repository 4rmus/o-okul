"use client";

import { useState, type FormEvent } from "react";
import { Button, Input } from "@uzman-hocam/ui";
import type { SupportTicketRecord } from "@uzman-hocam/shared-types";
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
}: {
  tickets: SupportTicketRecord[];
  onCreate?: (input: SupportTicketFormPayload) => void | Promise<unknown>;
}) {
  const [form, setForm] = useState<SupportTicketFormState>(emptySupportTicketForm);
  const [error, setError] = useState("");

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
    <section className="next-list-panel" aria-label="Destek talepleri">
      <h2>Destek Talepleri</h2>
      <form className="next-support-tool" onSubmit={(event) => void submit(event)}>
        <label>
          Konu
          <Input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} />
        </label>
        <label>
          Mesaj
          <Input value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} />
        </label>
        <label>
          Öncelik
          <select
            value={form.priority}
            onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as SupportTicketRecord["priority"] }))}
          >
            <option value="LOW">Düşük</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">Yüksek</option>
          </select>
        </label>
        <Button disabled={!onCreate} type="submit">Destek talebi aç</Button>
      </form>
      {error ? <p className="next-form-error">{error}</p> : null}
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Konu</th>
            <th>Öncelik</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>
          {tickets.length > 0 ? (
            tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td>{ticket.subject}</td>
                <td>{supportPriorityLabel(ticket.priority)}</td>
                <td>{supportStatusLabel(ticket.status)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3}>Destek talebi yok</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
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
    CLOSED: "Kapalı",
    IN_PROGRESS: "İşlemde",
    OPEN: "Açık",
    RESOLVED: "Çözüldü",
  };
  return labels[status];
}
