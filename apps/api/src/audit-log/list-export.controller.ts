import { Body, Controller, Headers, Post } from "@nestjs/common";
import type { ListExportAuditRecord } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { type ListExportAuditBody, listExportAuditBodySchema } from "./list-export-validation.js";
import { ListExportAuditService } from "./list-export.service.js";

// DEC-20261102-08: the CSV is built in the browser from the masked cells the list shows; this endpoint only records
// the export. The capability depends on the exported list (the one that opens that list's GET endpoint), so the
// service checks it per request; the static account:self gate only makes the guard reject a request without a
// session (401). The service also admits only the STAFF persona, so portals cannot record an export.
@Controller("audit")
export class ListExportAuditController {
  constructor(private readonly exports: ListExportAuditService) {}

  @Post("list-exports")
  @RequireCapability("account:self")
  record(
    @Body(zodBody(listExportAuditBodySchema)) body: ListExportAuditBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<ListExportAuditRecord> {
    return this.exports.record(getRequestContext(), body, idempotencyKey);
  }
}
