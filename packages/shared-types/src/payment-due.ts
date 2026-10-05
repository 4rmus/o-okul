import type { PaymentInstallmentRecord } from "./domain.js";

/** Calendar day (YYYY-MM-DD) in the school's timezone; dueDate and attendance dates are such days. */
export function istanbulDate(now: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** YYYY-MM-DD plus whole days (calendar arithmetic, no timezone involved). */
export function addCalendarDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// KF-3: the single source of "overdue". Never stored; every read path (API reads, KV-8 due reminders) routes here.
export function isPaymentInstallmentOverdue(
  installment: Pick<PaymentInstallmentRecord, "dueDate" | "status" | "deletedAt">,
  today: string = istanbulDate(new Date()),
): boolean {
  return installment.status === "PENDING" && !installment.deletedAt && installment.dueDate < today;
}
