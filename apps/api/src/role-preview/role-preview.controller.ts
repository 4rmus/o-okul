import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { RolePreviewService, type RolePreviewSession } from "./role-preview.service.js";
import { rolePreviewStartBodySchema, type RolePreviewStartBody } from "./role-preview-validation.js";

@Controller("role-previews")
@UseGuards(RolesGuard)
export class RolePreviewController {
  constructor(private readonly previews: RolePreviewService) {}

  @Post()
  @RequireCapability("role-preview:manage")
  start(
    @Body(zodBody(rolePreviewStartBodySchema)) body: RolePreviewStartBody,
  ): Promise<RolePreviewSession> {
    return this.previews.start(getRequestContext(), body);
  }
}
