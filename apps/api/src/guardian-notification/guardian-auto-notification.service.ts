import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { istanbulDate, type GuardianAutoNotificationSettingsRecord, type GuardianAutoNotificationSettingsUpdateRequest } from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { apiLogger } from "../observability/logging.js";
import { createTenantQueueJob, type GuardianNotifyKind, type ProducedJob, type TenantQueueJobInput } from "../queue/job-producer.js";
import {
  type GuardianNotificationSettingsStore,
  guardianNotificationSettingsStoreToken,
} from "./guardian-notification-settings-store.js";

export interface GuardianNotifyQueueProducer {
  enqueue(input: TenantQueueJobInput): Promise<ProducedJob>;
}

export const guardianNotifyQueueProducerToken = Symbol("GuardianNotifyQueueProducer");

/** Memory persistence has no worker behind it: jobs are only recorded (e2e tests read them). */
export class InMemoryGuardianNotifyQueueProducer implements GuardianNotifyQueueProducer {
  readonly jobs: ProducedJob[] = [];

  async enqueue(input: TenantQueueJobInput): Promise<ProducedJob> {
    const job = createTenantQueueJob(input);
    this.jobs.push(job);
    return job;
  }
}

/**
 * KV-8 (DEC-20261005-04): API side of the automatic guardian notifications. It only enqueues ids; the worker decides
 * (institution switch, notified marker, guardian preference, finance visibility, device state) at send time.
 */
@Injectable()
export class GuardianAutoNotificationService {
  constructor(
    @Inject(guardianNotificationSettingsStoreToken) private readonly settings: GuardianNotificationSettingsStore,
    @Inject(guardianNotifyQueueProducerToken) private readonly producer: GuardianNotifyQueueProducer,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async getSettings(context: RequestContext): Promise<GuardianAutoNotificationSettingsRecord> {
    const settings = await this.settings.find(requireTenantId(context));
    if (!settings) throw new NotFoundException("TENANT_NOT_FOUND");
    return settings;
  }

  async updateSettings(
    context: RequestContext,
    input: GuardianAutoNotificationSettingsUpdateRequest,
  ): Promise<GuardianAutoNotificationSettingsRecord> {
    const tenantId = requireTenantId(context);
    const settings = await this.settings.update(tenantId, input);
    if (!settings) throw new NotFoundException("TENANT_NOT_FOUND");
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "Tenant",
      entityId: tenantId,
      action: "tenant.guardian_notification_settings_updated",
      diff: { ...settings },
    });
    return settings;
  }

  /**
   * Daily attendance: one job per row marked ABSENT for today (Europe/Istanbul). Back-filled past days do not notify.
   * A same-day correction enqueues again; the worker's Attendance.notifiedAt claim keeps it to one notification.
   */
  async notifyAbsences(
    context: RequestContext,
    records: ReadonlyArray<{ tenantId: string; id: string; date: string; status: string }>,
  ): Promise<void> {
    const today = istanbulDate(new Date());
    for (const record of records) {
      if (record.status === "ABSENT" && record.date === today) {
        await this.enqueue(context, "ABSENCE", record.tenantId, record.id);
      }
    }
  }

  /** Gradebook publish (single call): the worker notifies every entry published after the assessment's watermark. */
  async notifyGradePublished(context: RequestContext, assessment: { tenantId: string; id: string }): Promise<void> {
    await this.enqueue(context, "GRADE_PUBLISHED", assessment.tenantId, assessment.id);
  }

  private async enqueue(context: RequestContext, kind: GuardianNotifyKind, tenantId: string, entityId: string): Promise<void> {
    try {
      await this.producer.enqueue({
        queueName: "announcement-delivery",
        mode: "GUARDIAN_NOTIFY",
        kind,
        tenantId,
        userId: context.userId,
        entityId,
        // Unique per trigger: the row's notified marker, not the jobId, is the dedupe.
        contentHash: Date.now().toString(36),
      });
    } catch (error) {
      // ponytail: the attendance/grade write is already committed; a lost enqueue only loses this notification
      // (no outbox by DEC-20261004-07). Add a sweep over unnotified rows if this shows up in the logs.
      apiLogger.warn(
        { tenantId, entityId, kind, errorCode: error instanceof Error ? error.message : "UNKNOWN" },
        "guardian_notify_enqueue_failed",
      );
    }
  }
}

function requireTenantId(context: RequestContext): string {
  if (!context.tenantId) throw new NotFoundException("TENANT_NOT_FOUND");
  return context.tenantId;
}
