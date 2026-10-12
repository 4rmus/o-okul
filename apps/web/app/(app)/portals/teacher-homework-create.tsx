"use client";

import { type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { HomeworkCreateRequest, HomeworkRecord, TeacherAuthoringScope, TeacherPortalLookupsResponse } from "@o-okul/shared-types";
import { Button, Field, Input, Panel, Select, Textarea } from "@o-okul/ui";
import { apiBaseUrl, apiRequest } from "../../../src/api-client.js";

const emptyForm = { classId: "", title: "", description: "", dueAt: "" };

/** DEC-20261012-01: a class or branch teacher creates homework for an assigned class; the API enforces the scope. */
export function TeacherHomeworkCreatePanel({ accessToken, onCreated }: { accessToken: string; onCreated(): void }) {
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "status" | "alert"; text: string } | null>(null);
  const optionsQuery = useQuery({
    queryKey: ["teacher-homework-create-options", accessToken],
    queryFn: async () => {
      const [scopes, lookups] = await Promise.all([
        apiRequest<TeacherAuthoringScope[]>(accessToken, `${apiBaseUrl}/grade-assessments/teacher-scopes`),
        apiRequest<TeacherPortalLookupsResponse>(accessToken, `${apiBaseUrl}/me/teacher/lookups`),
      ]);
      const classIds = new Set(scopes.map((scope) => scope.classId));
      return lookups.classes.filter((record) => classIds.has(record.id));
    },
    refetchOnWindowFocus: false,
  });
  const classes = optionsQuery.data ?? [];
  if (classes.length === 0) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.classId || !form.title.trim()) {
      setMessage({ tone: "alert", text: "Sınıf ve ödev başlığı zorunludur." });
      return;
    }
    const body: HomeworkCreateRequest = {
      classId: form.classId,
      title: form.title.trim(),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      // Date-only input: due at the end of that day, Türkiye time.
      ...(form.dueAt ? { dueAt: new Date(`${form.dueAt}T23:59:00+03:00`).toISOString() } : {}),
    };
    setBusy(true);
    try {
      const record = await apiRequest<HomeworkRecord>(accessToken, `${apiBaseUrl}/homework`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setForm(emptyForm);
      setMessage({ tone: "status", text: `“${record.title}” ödevi oluşturuldu.` });
      onCreated();
    } catch {
      setMessage({ tone: "alert", text: "Ödev oluşturulamadı. Atandığın sınıfı seçip tekrar deneyin." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel aria-label="Ödev oluştur" description="Sınıf veya branş öğretmeni olarak atandığın sınıfa ödev ver." title="Ödev oluştur">
      <form className="next-form" onSubmit={(event) => void submit(event)}>
        <Field label="Sınıf">
          <Select value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value })}>
            <option value="">Seçin</option>
            {classes.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
          </Select>
        </Field>
        <Field label="Ödev başlığı">
          <Input maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </Field>
        <Field label="Açıklama">
          <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <Field label="Teslim tarihi">
          <Input type="date" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} />
        </Field>
        {message ? <p className={message.tone === "alert" ? "next-form-error" : "next-field-hint"} role={message.tone}>{message.text}</p> : null}
        <div className="next-form-actions">
          <Button disabled={busy} type="submit">Ödev oluştur</Button>
        </div>
      </form>
    </Panel>
  );
}
