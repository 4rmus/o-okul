import { Controller, Get, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { RawImportQuarantineService } from "./raw-import-quarantine.service.js";

@Controller("import-quarantines")
@UseGuards(RolesGuard)
export class ImportQuarantineController {
  constructor(private readonly quarantines: RawImportQuarantineService) {}

  @Get("summary")
  @RequireCapability("academic:manage")
  summary() {
    return this.quarantines.summary(getRequestContext());
  }
}
