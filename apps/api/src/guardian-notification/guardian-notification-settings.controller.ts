import { Body, Controller, Get, Patch } from "@nestjs/common";
import type { GuardianAutoNotificationSettingsRecord, GuardianAutoNotificationSettingsUpdateRequest } from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { GuardianAutoNotificationService } from "./guardian-auto-notification.service.js";

export const guardianAutoNotificationSettingsBodySchema = z.object({
  absenceEnabled: z.boolean().optional(),
  paymentDueEnabled: z.boolean().optional(),
  gradePublishEnabled: z.boolean().optional(),
  absenceThreshold: z.number().int().min(1).max(365).optional(),
}).strict() satisfies z.ZodType<GuardianAutoNotificationSettingsUpdateRequest>;

/** KV-8: institution settings "Otomatik veli bildirimleri" (same access as the institution profile, PATCH /me/tenant). */
@Controller("me/tenant/guardian-notification-settings")
export class GuardianNotificationSettingsController {
  constructor(private readonly notifications: GuardianAutoNotificationService) {}

  @Get()
  @RequireCapability("setup:manage")
  find(): Promise<GuardianAutoNotificationSettingsRecord> {
    return this.notifications.getSettings(getRequestContext());
  }

  @Patch()
  @RequireCapability("setup:manage")
  update(
    @Body(zodBody(guardianAutoNotificationSettingsBodySchema)) body: GuardianAutoNotificationSettingsUpdateRequest,
  ): Promise<GuardianAutoNotificationSettingsRecord> {
    return this.notifications.updateSettings(getRequestContext(), body);
  }
}
