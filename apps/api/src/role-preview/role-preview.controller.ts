import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { RolePreviewService, type RolePreviewSession, type StartRolePreviewInput } from "./role-preview.service.js";

@Controller("role-previews")
@UseGuards(RolesGuard)
export class RolePreviewController {
  constructor(private readonly previews: RolePreviewService) {}

  @Post()
  @Roles("TENANT_ADMIN")
  start(@Body() body: StartRolePreviewInput): Promise<RolePreviewSession> {
    return this.previews.start(getRequestContext(), body);
  }
}
