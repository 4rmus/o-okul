import { Controller, Get, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { RawImportQuarantineService } from "./raw-import-quarantine.service.js";

@Controller("import-quarantines")
@UseGuards(RolesGuard)
export class ImportQuarantineController {
  constructor(private readonly quarantines: RawImportQuarantineService) {}

  @Get("summary")
  @Roles("TENANT_ADMIN")
  summary() {
    return this.quarantines.summary(getRequestContext());
  }
}
