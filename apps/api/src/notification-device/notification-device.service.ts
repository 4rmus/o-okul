import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { NotificationDeviceTokenRecord } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { requiredText } from "../shared/required-text.js";
import {
  notificationDeviceTokenStoreToken,
  type NotificationDeviceTokenStore,
} from "./notification-device-store.js";

export interface RegisterNotificationDeviceInput {
  provider?: string;
  token?: string;
  platform?: string;
}

@Injectable()
export class NotificationDeviceService {
  constructor(
    @Inject(notificationDeviceTokenStoreToken) private readonly store: NotificationDeviceTokenStore,
  ) {}

  listCurrentUser(context: RequestContext): Promise<NotificationDeviceTokenRecord[]> {
    const scope = resolveDeviceScope(context);
    return this.store.listByUser(scope.tenantId, scope.userId);
  }

  registerCurrentUser(
    context: RequestContext,
    input: RegisterNotificationDeviceInput,
  ): Promise<NotificationDeviceTokenRecord> {
    const scope = resolveDeviceScope(context);
    return this.store.upsert({
      ...scope,
      provider: requiredText(input.provider, "NOTIFICATION_DEVICE_PROVIDER_REQUIRED"),
      token: requiredText(input.token, "NOTIFICATION_DEVICE_TOKEN_REQUIRED"),
      platform: optionalText(input.platform),
      lastSeenAt: new Date().toISOString(),
    });
  }

  async disableCurrentUser(context: RequestContext, id: string): Promise<NotificationDeviceTokenRecord> {
    const scope = resolveDeviceScope(context);
    const record = await this.store.disable(scope.tenantId, scope.userId, id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("NOTIFICATION_DEVICE_NOT_FOUND");
    }
    return record;
  }

  listActiveByUsers(tenantId: string, userIds: string[]): Promise<NotificationDeviceTokenRecord[]> {
    return this.store.listActiveByUsers(tenantId, userIds);
  }
}

function resolveDeviceScope(context: RequestContext): {
  tenantId: string;
  userId: string;
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
} {
  if (!context.tenantId) {
    throw new ForbiddenException("TENANT_CONTEXT_MISSING");
  }
  return {
    tenantId: context.tenantId,
    userId: context.userId,
    subjectType: context.subjectType,
    subjectId: context.subjectId,
  };
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
