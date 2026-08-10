import { Controller, Get, UseGuards } from "@nestjs/common";
import type { SetupReadinessReadModel } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SetupReadinessService } from "./setup-readiness.service.js";

@Controller("setup")
@UseGuards(RolesGuard)
export class SetupReadinessController {
  constructor(private readonly readiness: SetupReadinessService) {}

  @Get("readiness")
  @RequireCapability("setup:manage")
  read(): Promise<SetupReadinessReadModel> {
    return this.readiness.read(getRequestContext());
  }
}
