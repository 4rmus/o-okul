import { describe, expect, it } from "vitest";
import type { LicenseTermWindow } from "@o-okul/shared-types";
import type { JobsOptions } from "bullmq";
import type { GuardianNotifyJobPayload } from "./guardian-auto-notification.js";
import { isGuardianNotifyBusinessHour, scanPaymentDueReminders, type GuardianNotifyQueue, type PaymentDueScanStore } from "./guardian-payment-due-scanner.js";

describe("KV-8 payment due scanner", () => {
  it("mesai saati Europe/Istanbul 09:00-18:00", () => {
    expect(isGuardianNotifyBusinessHour(new Date("2026-10-05T08:59:00+03:00"))).toBe(false);
    expect(isGuardianNotifyBusinessHour(new Date("2026-10-05T09:00:00+03:00"))).toBe(true);
    expect(isGuardianNotifyBusinessHour(new Date("2026-10-05T17:59:00+03:00"))).toBe(true);
    expect(isGuardianNotifyBusinessHour(new Date("2026-10-05T18:00:00+03:00"))).toBe(false);
  });

  it("mesai dışında taramaz; mesaide taksit+gün jobId ile kuyruğa koyar, iki tarama aynı işi tekrar üretmez", async () => {
    const store: PaymentDueScanStore & { scannedDays: string[] } = {
      scannedDays: [],
      async listEnabledTenants() {
        return [{ id: "tenant-a", lifecycleVersion: 3 }];
      },
      async listLicenseTerms() {
        return [activeTerm];
      },
      async listDueInstallmentIds(_tenantId, day) {
        this.scannedDays.push(day);
        return ["installment-a", "installment-b"];
      },
    };
    const queue = new DedupingQueue();

    await expect(scanPaymentDueReminders(store, queue, new Date("2026-10-05T07:00:00+03:00"))).resolves.toBe(0);
    expect(queue.jobs.size).toBe(0);

    await scanPaymentDueReminders(store, queue, new Date("2026-10-05T10:00:00+03:00"));
    await scanPaymentDueReminders(store, queue, new Date("2026-10-05T10:30:00+03:00"));

    expect(store.scannedDays).toEqual(["2026-10-05", "2026-10-05"]);
    expect([...queue.jobs.keys()]).toEqual([
      "guardian-notify_PAYMENT_DUE_installment-a_2026-10-05",
      "guardian-notify_PAYMENT_DUE_installment-b_2026-10-05",
    ]);
    expect(queue.jobs.get("guardian-notify_PAYMENT_DUE_installment-a_2026-10-05")).toEqual({
      tenantId: "tenant-a",
      lifecycleVersion: 3,
      userId: "kv8-payment-due-scanner",
      entityId: "installment-a",
      contentHash: "2026-10-05",
      mode: "GUARDIAN_NOTIFY",
      kind: "PAYMENT_DUE",
    });
  });

  it("ACTIVE lisanslı olmayan kurum (READ_ONLY/FROZEN/EXPIRED/CANCELLED) için iş üretmez", async () => {
    const now = new Date("2026-10-05T10:00:00+03:00");
    const terms: Record<string, LicenseTermWindow[]> = {
      "tenant-active": [activeTerm],
      "tenant-read-only": [{ startsAt: "2025-09-01T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" }],
      "tenant-frozen": [{ startsAt: "2025-09-01T00:00:00.000Z", endsAt: "2026-09-01T00:00:00.000Z" }],
      "tenant-expired": [{ startsAt: "2025-01-01T00:00:00.000Z", endsAt: "2026-06-01T00:00:00.000Z" }],
      "tenant-cancelled": [{ ...activeTerm, cancelledAt: "2026-09-01T00:00:00.000Z" }],
    };
    const store: PaymentDueScanStore = {
      async listEnabledTenants() {
        return Object.keys(terms).map((id) => ({ id, lifecycleVersion: 1 }));
      },
      async listLicenseTerms(tenantId) {
        return terms[tenantId]!;
      },
      async listDueInstallmentIds(tenantId) {
        return [`installment-${tenantId}`];
      },
    };
    const queue = new DedupingQueue();

    await expect(scanPaymentDueReminders(store, queue, now)).resolves.toBe(1);
    expect([...queue.jobs.values()].map((job) => job.tenantId)).toEqual(["tenant-active"]);
  });
});

const activeTerm: LicenseTermWindow = { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2027-09-01T00:00:00.000Z" };

/** BullMQ semantics that matter here: adding an existing jobId is a no-op. */
class DedupingQueue implements GuardianNotifyQueue {
  readonly jobs = new Map<string, GuardianNotifyJobPayload>();

  async add(_name: string, data: GuardianNotifyJobPayload, options: JobsOptions): Promise<unknown> {
    if (!this.jobs.has(options.jobId!)) this.jobs.set(options.jobId!, data);
    return undefined;
  }

  async close(): Promise<void> {}
}
