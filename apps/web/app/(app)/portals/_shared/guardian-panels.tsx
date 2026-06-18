"use client";

import { useState } from "react";
import { Checkbox, DataTable, Panel, type DataTableColumn } from "@uzman-hocam/ui";
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
    <Panel aria-label="Bildirim tercihleri" title="Bildirim Tercihleri">
      {readOnly ? <p>Salt-okuma önizlemede bildirim tercihleri değiştirilemez.</p> : null}
      <Checkbox
        checked={preferences?.canReceiveSms ?? false}
        disabled={readOnly || !preferences || !onUpdate}
        label="SMS al"
        onChange={(event) => void update({ canReceiveSms: event.target.checked })}
      />
      <Checkbox
        checked={preferences?.canReceiveAnnouncements ?? false}
        disabled={readOnly || !preferences || !onUpdate}
        label="Duyuru al"
        onChange={(event) => void update({ canReceiveAnnouncements: event.target.checked })}
      />
      <Checkbox
        checked={preferences?.canOpenSupportTickets ?? false}
        disabled={readOnly || !preferences || !onUpdate}
        label="Destek talebi aç"
        onChange={(event) => void update({ canOpenSupportTickets: event.target.checked })}
      />
      {error ? <p className="next-form-error">{error}</p> : null}
    </Panel>
  );
}

export function GuardianRelationshipSummaryPanel({ relationship }: { relationship?: GuardianStudentRecord }) {
  return (
    <Panel aria-label="Veli ilişki özeti" title="Veli İlişki Özeti">
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
    </Panel>
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
      <Panel aria-label="Ödeme planları" title="Ödeme Planları">
        <p className="next-status-note">Ödeme görünümü kapalı.</p>
      </Panel>
    );
  }

  const columns: Array<DataTableColumn<PaymentPlanWithInstallmentsRecord>> = [
    {
      header: "Plan",
      key: "plan",
      priority: "primary",
      render: (plan) => plan.title,
      sticky: "left",
    },
    {
      align: "right",
      header: "Tutar",
      key: "amount",
      priority: "primary",
      render: (plan) => formatMoney(plan.totalAmount, plan.currency),
    },
    {
      align: "right",
      header: "Taksit",
      key: "installmentCount",
      priority: "secondary",
      render: (plan) => plan.installments.length,
    },
    {
      align: "right",
      header: "Bekleyen",
      key: "pending",
      priority: "primary",
      render: (plan) => formatPendingPaymentForPlan(plan),
    },
    {
      header: "Sıradaki taksit",
      key: "nextInstallment",
      priority: "secondary",
      render: (plan) => formatNextInstallmentSummary(plan),
    },
  ];

  return (
    <Panel aria-label="Ödeme planları" title="Ödeme Planları">
      <DataTable
        caption="Ödeme planları"
        columns={columns}
        description="Veli finans izni açık olan öğrenciler için ödeme planı ve bekleyen tutar."
        emptyText="Ödeme planı yok."
        getRowKey={(plan) => plan.id}
        rows={plans}
      />
    </Panel>
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
