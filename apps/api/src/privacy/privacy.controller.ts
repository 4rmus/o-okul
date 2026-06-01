import { Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { AuthService, type SelfPurgeResult } from "../auth/auth.service.js";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";

@Controller("privacy")
@UseGuards(RolesGuard)
export class PrivacyController {
  constructor(private readonly auth: AuthService) {}

  @Post("me/purge-pii")
  @HttpCode(200)
  @Roles("GUARDIAN")
  purgeMyPii(): Promise<SelfPurgeResult> {
    return this.auth.purgeCurrentUserPii(getRequestContext());
  }
}
