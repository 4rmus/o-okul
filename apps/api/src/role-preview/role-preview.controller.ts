import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { RolePreviewService, type RolePreviewSession, type StartRolePreviewInput } from "./role-preview.service.js";

@Controller("role-previews")
@UseGuards(RolesGuard)
export class RolePreviewController {
  constructor(private readonly previews: RolePreviewService) {}

  @Post()
  @RequireCapability("role-preview:manage")
  start(@Body() body: StartRolePreviewInput): Promise<RolePreviewSession> {
    return this.previews.start(getRequestContext(), body);
  }
}
