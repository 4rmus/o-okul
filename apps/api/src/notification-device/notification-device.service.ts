import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { parseWebPushSubscription, type NotificationDeviceTokenRecord } from "@o-okul/shared-types";
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

  async registerCurrentUser(
    context: RequestContext,
    input: RegisterNotificationDeviceInput,
  ): Promise<NotificationDeviceTokenRecord> {
    const scope = resolveDeviceScope(context);
    const provider = requiredText(input.provider, "NOTIFICATION_DEVICE_PROVIDER_REQUIRED");
    let token = requiredText(input.token, "NOTIFICATION_DEVICE_TOKEN_REQUIRED");
    if (provider === "web-push") {
      const subscription = parseWebPushSubscription(token);
      if (!subscription) throw new BadRequestException("NOTIFICATION_DEVICE_SUBSCRIPTION_INVALID");
      token = JSON.stringify(subscription);
    }
    return this.store.upsert({
      ...scope,
      provider,
      token,
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
