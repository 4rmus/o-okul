import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import {
  tenantDataExportStoreToken,
  type TenantDataExportPayload,
  type TenantDataExportStore,
} from "./tenant-data-export-store.js";

@Injectable()
export class TenantDataExportService {
  constructor(
    @Inject(tenantDataExportStoreToken)
    private readonly store: TenantDataExportStore,
  ) {}

  async createExport(context: RequestContext): Promise<TenantDataExportPayload> {
    if (!context.tenantId || context.bypassRls) {
      throw new ForbiddenException("TENANT_CONTEXT_REQUIRED");
    }
    return this.store.createExport(context);
  }
}
