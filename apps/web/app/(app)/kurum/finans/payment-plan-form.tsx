"use client";

import { type FormEvent, useState } from "react";
import type { CampusRecord, PaymentPlanCreateRequest, PaymentPlanWithInstallmentsRecord, StudentRecord } from "@o-okul/shared-types";
import { Button, Field, FormModal, Input, Select } from "@o-okul/ui";
import { ApiRequestError, apiBaseUrl, apiRequest } from "../../../../src/api-client.js";

interface InstallmentDraft {
  amount: string;
  dueDate: string;
}

interface PlanDraft {
  campusId: string;
  firstDueDate: string;
  installmentCount: string;
  installments: InstallmentDraft[];
  studentId: string;
  title: string;
  totalAmount: string;
}

const emptyDraft: PlanDraft = {
  campusId: "",
  firstDueDate: "",
  installmentCount: "1",
  installments: [],
  studentId: "",
  title: "",
  totalAmount: "",
};

const planErrorMessages: Record<string, string> = {
  FINANCE_CAMPUS_SCOPE_FORBIDDEN: "Bu kampüs için ödeme planı oluşturma yetkin yok.",
  IDEMPOTENCY_KEY_BODY_MISMATCH: "Form gönderildikten sonra değişti. Formu kapatıp yeniden aç.",
  PAYMENT_PLAN_CAMPUS_NOT_FOUND: "Seçilen kampüs bulunamadı.",
  PAYMENT_PLAN_CLASS_CAMPUS_MISMATCH: "Seçilen kampüs öğrencinin sınıfıyla uyuşmuyor.",
  STUDENT_NOT_FOUND: "Öğrenci bulunamadı.",
};

export function PaymentPlanFormModal({
  accessToken,
  campuses,
  onCancel,
  onCreated,
  open,
  students,
}: {
  accessToken: string;
  campuses: CampusRecord[];
  onCancel(): void;
  onCreated(plan: PaymentPlanWithInstallmentsRecord): void;
  open: boolean;
  students: StudentRecord[];
}) {
  const [draft, setDraft] = useState<PlanDraft>(emptyDraft);
  // ponytail: one key per opened form; a retry after a network error reuses it, so the API never creates a second plan.
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey());
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const totalAmount = parseKurus(draft.totalAmount);
  const installmentSum = draft.installments.reduce((sum, installment) => sum + parseKurus(installment.amount), 0);
  const sumMismatch = draft.installments.length > 0 && totalAmount > 0 && installmentSum !== totalAmount;

  function reset() {
    setDraft(emptyDraft);
    setIdempotencyKey(createIdempotencyKey());
    setError("");
  }

  function cancel() {
    reset();
    onCancel();
  }

  function suggestEqualInstallments() {
    const count = Number(draft.installmentCount);
    if (!totalAmount || !Number.isInteger(count) || count < 1 || count > 24 || !draft.firstDueDate) {
      setError("Eşit taksit için toplam tutar, 1-24 arası taksit sayısı ve ilk vade gerekli.");
      return;
    }
    setError("");
    setDraft({ ...draft, installments: splitEqualInstallments(totalAmount, count, draft.firstDueDate) });
  }

  function updateInstallment(index: number, patch: Partial<InstallmentDraft>) {
    setDraft({
      ...draft,
      installments: draft.installments.map((installment, current) => (current === index ? { ...installment, ...patch } : installment)),
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.studentId || !draft.title.trim() || !totalAmount) {
      setError("Öğrenci, plan adı ve toplam tutar zorunludur.");
      return;
    }
    if (draft.installments.length === 0) {
      setError("En az bir taksit ekle. Eşit taksit önerisini kullanabilirsin.");
      return;
    }
    if (draft.installments.some((installment) => !parseKurus(installment.amount) || !installment.dueDate)) {
      setError("Her taksitte pozitif tutar ve vade olmalıdır.");
      return;
    }
    if (sumMismatch) {
      setError("Taksit toplamı plan toplamıyla aynı olmalıdır.");
      return;
    }

    const body: PaymentPlanCreateRequest = {
      campusId: draft.campusId || undefined,
      installments: draft.installments.map((installment, index) => ({
        amount: parseKurus(installment.amount),
        dueDate: installment.dueDate,
        installmentNo: index + 1,
      })),
      studentId: draft.studentId,
      title: draft.title.trim(),
      totalAmount,
    };

    setError("");
    setSubmitting(true);
    try {
      const plan = await apiRequest<PaymentPlanWithInstallmentsRecord>(accessToken, `${apiBaseUrl}/payment-plans`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        method: "POST",
      });
      reset();
      onCreated(plan);
    } catch (caught) {
      const code = caught instanceof ApiRequestError ? caught.code : undefined;
      setError((code && planErrorMessages[code]) || "Ödeme planı oluşturulamadı. Tekrar denersen aynı plan iki kez açılmaz.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormModal
      description="Öğrenci için taksitli ödeme planı aç. Tutarlar TL olarak girilir, kuruşa çevrilerek kaydedilir."
      onCancel={cancel}
      onSubmit={(event) => void submit(event)}
      open={open}
      submitDisabled={sumMismatch}
      submitError={error || (sumMismatch ? "Taksit toplamı plan toplamıyla aynı olmalıdır." : undefined)}
      submitLabel="Planı oluştur"
      submitting={submitting}
      title="Ödeme planı oluştur"
    >
      <Field label="Öğrenci">
        <Select required value={draft.studentId} onChange={(event) => setDraft({ ...draft, studentId: event.target.value })}>
          <option value="">Seç</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.firstName} {student.lastName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Kampüs">
        <Select value={draft.campusId} onChange={(event) => setDraft({ ...draft, campusId: event.target.value })}>
          <option value="">Öğrencinin sınıfından</option>
          {campuses.map((campus) => (
            <option key={campus.id} value={campus.id}>
              {campus.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Plan adı">
        <Input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      </Field>
      <Field label="Toplam tutar (TL)">
        <Input required inputMode="decimal" value={draft.totalAmount} onChange={(event) => setDraft({ ...draft, totalAmount: event.target.value })} />
      </Field>
      <Field label="Taksit sayısı">
        <Input inputMode="numeric" max={24} min={1} type="number" value={draft.installmentCount} onChange={(event) => setDraft({ ...draft, installmentCount: event.target.value })} />
      </Field>
      <Field label="İlk vade">
        <Input type="date" value={draft.firstDueDate} onChange={(event) => setDraft({ ...draft, firstDueDate: event.target.value })} />
      </Field>
      <Button type="button" variant="secondary" onClick={suggestEqualInstallments}>
        Eşit taksitlere böl
      </Button>
      {draft.installments.map((installment, index) => (
        <fieldset key={index} className="next-payment-plan-installment">
          <legend>{index + 1}. taksit</legend>
          <Field label={`${index + 1}. taksit tutarı (TL)`}>
            <Input required inputMode="decimal" value={installment.amount} onChange={(event) => updateInstallment(index, { amount: event.target.value })} />
          </Field>
          <Field label={`${index + 1}. taksit vadesi`}>
            <Input required type="date" value={installment.dueDate} onChange={(event) => updateInstallment(index, { dueDate: event.target.value })} />
          </Field>
        </fieldset>
      ))}
    </FormModal>
  );
}

// Equal split in kuruş; the remainder goes to the last installment so the sum always matches. Monthly due dates, clamped to month end.
export function splitEqualInstallments(totalKurus: number, count: number, firstDueDate: string): InstallmentDraft[] {
  const base = Math.floor(totalKurus / count);
  const [year, month, day] = firstDueDate.split("-").map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, index) => {
    const amount = index === count - 1 ? totalKurus - base * (count - 1) : base;
    const lastDay = new Date(Date.UTC(year, month - 1 + index + 1, 0)).getUTCDate();
    const due = new Date(Date.UTC(year, month - 1 + index, Math.min(day, lastDay)));
    return { amount: formatKurus(amount), dueDate: due.toISOString().slice(0, 10) };
  });
}

function parseKurus(value: string) {
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  const amount = Number(normalized);
  if (!value.trim() || !Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
}

function formatKurus(amount: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: 2, useGrouping: false }).format(amount / 100);
}

function createIdempotencyKey() {
  return `payment-plan-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
