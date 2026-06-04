"use client";

import { useState } from "react";
import type { GuardianStudentRecord, PaymentPlanWithInstallmentsRecord } from "@uzman-hocam/shared-types";

export function NotificationPreferencesPanel({
  preferences,
  onUpdate,
  readOnly = false,
}: {
  preferences?: GuardianStudentRecord;
  onUpdate?: (input: Partial<Pick<GuardianStudentRecord, "canReceiveSms" | "canReceiveAnnouncements" | "canOpenSupportTickets">>) => void | Promise<unknown>;
  readOnly?: boolean;
}) {
  const [error, setError] = useState("");

  async function update(input: Partial<Pick<GuardianStudentRecord, "canReceiveSms" | "canReceiveAnnouncements" | "canOpenSupportTickets">>) {
    if (!onUpdate) return;

    setError("");
    try {
      await onUpdate(input);
    } catch {
      setError("Bildirim tercihleri güncellenemedi.");
    }
  }

  return (
    <section className="next-list-panel" aria-label="Bildirim tercihleri">
      <h2>Bildirim Tercihleri</h2>
      {readOnly ? <p>Salt-okuma önizlemede bildirim tercihleri değiştirilemez.</p> : null}
      <label className="next-checkbox-row">
        <input
          checked={preferences?.canReceiveSms ?? false}
          disabled={readOnly || !preferences || !onUpdate}
          onChange={(event) => void update({ canReceiveSms: event.target.checked })}
          type="checkbox"
        />
        SMS al
      </label>
      <label className="next-checkbox-row">
        <input
          checked={preferences?.canReceiveAnnouncements ?? false}
          disabled={readOnly || !preferences || !onUpdate}
          onChange={(event) => void update({ canReceiveAnnouncements: event.target.checked })}
          type="checkbox"
        />
        Duyuru al
      </label>
      <label className="next-checkbox-row">
        <input
          checked={preferences?.canOpenSupportTickets ?? false}
          disabled={readOnly || !preferences || !onUpdate}
          onChange={(event) => void update({ canOpenSupportTickets: event.target.checked })}
          type="checkbox"
        />
        Destek talebi aç
      </label>
      {error ? <p className="next-form-error">{error}</p> : null}
    </section>
  );
}

export function GuardianRelationshipSummaryPanel({ relationship }: { relationship?: GuardianStudentRecord }) {
  return (
    <section className="next-list-panel" aria-label="Veli ilişki özeti">
      <h2>Veli İlişki Özeti</h2>
      <dl className="next-definition-list">
        <div>
          <dt>İlişki</dt>
          <dd>{relationship ? guardianRelationshipLabel(relationship.relationshipType) : "-"}</dd>
        </div>
        <div>
          <dt>Birincil kişi</dt>
          <dd>{relationship?.isPrimary ? "Evet" : "Hayır"}</dd>
        </div>
        <div>
          <dt>Ödeme görünümü</dt>
          <dd>{relationship?.canViewFinance ? "Açık" : "Kapalı"}</dd>
        </div>
        <div>
          <dt>İzinler</dt>
          <dd>{relationship ? formatGuardianPermissions(relationship) : "-"}</dd>
        </div>
      </dl>
    </section>
  );
}

export function PaymentPlansPanel({
  canViewFinance,
  plans,
}: {
  canViewFinance: boolean;
  plans: PaymentPlanWithInstallmentsRecord[];
}) {
  if (!canViewFinance) {
    return (
      <section className="next-list-panel" aria-label="Ödeme planları">
        <h2>Ödeme Planları</h2>
        <p className="next-status-note">Ödeme görünümü kapalı.</p>
      </section>
    );
  }

  return (
    <section className="next-list-panel" aria-label="Ödeme planları">
      <h2>Ödeme Planları</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Plan</th>
            <th>Tutar</th>
            <th>Taksit</th>
            <th>Bekleyen</th>
            <th>Sıradaki taksit</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.id}>
              <td>{plan.title}</td>
              <td>{formatMoney(plan.totalAmount, plan.currency)}</td>
              <td>{plan.installments.length}</td>
              <td>{formatPendingPaymentForPlan(plan)}</td>
              <td>{formatNextInstallmentSummary(plan)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function guardianRelationshipLabel(value: GuardianStudentRecord["relationshipType"]) {
  const labels: Record<GuardianStudentRecord["relationshipType"], string> = {
    EMERGENCY_CONTACT: "Acil kişi",
    FATHER: "Baba",
    GUARDIAN: "Vasi",
    MOTHER: "Anne",
    OTHER: "Diğer",
  };
  return labels[value];
}

function formatGuardianPermissions(link: GuardianStudentRecord) {
  const permissions = [
    link.canViewFinance ? "Finans" : undefined,
    link.canReceiveSms ? "SMS" : undefined,
    link.canReceiveAnnouncements ? "Duyuru" : undefined,
    link.canOpenSupportTickets ? "Destek" : undefined,
  ].filter((permission): permission is string => Boolean(permission));
  return permissions.length > 0 ? permissions.join(", ") : "-";
}

function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${currency}`;
}

function formatPendingPaymentForPlan(plan: PaymentPlanWithInstallmentsRecord) {
  const total = plan.installments
    .filter((installment) => installment.status === "PENDING" || installment.status === "OVERDUE")
    .reduce((sum, installment) => sum + installment.amount, 0);
  return formatMoney(total, plan.currency);
}

function formatNextInstallmentSummary(plan: PaymentPlanWithInstallmentsRecord) {
  const installment = [...plan.installments]
    .filter((item) => item.status === "PENDING" || item.status === "OVERDUE")
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.installmentNo - right.installmentNo)[0];

  if (!installment) return "Açık taksit yok";

  return `${installment.installmentNo}. taksit / ${formatMoney(installment.amount, plan.currency)} / ${formatDate(installment.dueDate)} / ${paymentInstallmentStatusLabel(installment.status)}`;
}

function paymentInstallmentStatusLabel(status: PaymentPlanWithInstallmentsRecord["installments"][number]["status"]) {
  const labels: Record<PaymentPlanWithInstallmentsRecord["installments"][number]["status"], string> = {
    CANCELED: "İptal",
    OVERDUE: "Gecikmiş",
    PAID: "Ödendi",
    PENDING: "Bekliyor",
  };
  return labels[status];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short" }).format(new Date(value));
}
