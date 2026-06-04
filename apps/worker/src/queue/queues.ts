export const queueNames = [
  "announcement-delivery",
  "backup-restore",
  "exam-evaluation",
  "excel-import",
  "report-generation",
  "sms-batch",
] as const;

export type QueueName = (typeof queueNames)[number];

export interface TenantJobPayload {
  tenantId: string;
  userId: string;
  entityId: string;
  contentHash: string;
}

export interface QueueJob<TPayload extends TenantJobPayload = TenantJobPayload> {
  id: string;
  name: QueueName;
  payload: TPayload;
}

export function createJobId(entityId: string, contentHash: string): string {
  return `${entityId}_${contentHash}`;
}

export function assertTenantJobPayload(payload: Partial<TenantJobPayload>): asserts payload is TenantJobPayload {
  if (!payload.tenantId || !payload.userId || !payload.entityId || !payload.contentHash) {
    throw new Error("TENANT_JOB_PAYLOAD_INVALID");
  }
}
