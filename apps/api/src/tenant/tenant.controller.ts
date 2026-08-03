import { Body, Controller, Delete, Get, GoneException, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import type { LicenseTermRecord } from "../license/license-term-store.js";
import type { LicenseTermListRecord } from "@o-okul/shared-types";
import { licenseTermCreateBodySchema, type LicenseTermCreateBody } from "../license/license-validation.js";
import type { TenantRecord } from "./tenant-store.js";
import { TenantService, type TenantCreateResponse } from "./tenant.service.js";
import {
  tenantCreateBodySchema,
  tenantUpdateBodySchema,
  type TenantCreateBody,
  type TenantUpdateBody,
} from "./tenant-validation.js";

@Controller("tenants")
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  @RequireCapability("tenant:manage")
  async list(@Query() query: ListQuery): Promise<TenantRecord[]> {
    return applyListQuery(await this.tenants.list(getRequestContext()), query, tenantListFields);
  }

  @Get(":id")
  @RequireCapability("tenant:manage")
  findOne(@Param("id") id: string): Promise<TenantRecord> {
    return this.tenants.findOne(getRequestContext(), id);
  }

  @Get("current/license-terms")
  @RequireCapability("setup:manage")
  listCurrentLicenseTerms(): Promise<LicenseTermListRecord[]> {
    return this.tenants.listCurrentLicenseTerms(getRequestContext());
  }

  @Post()
  @RequireCapability("tenant:manage")
  create(
    @Body(zodBody(tenantCreateBodySchema)) body: TenantCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<TenantCreateResponse> {
    return this.tenants.create(getRequestContext(), body, idempotencyKey);
  }

  @Patch(":id")
  @RequireCapability("tenant:manage")
  update(
    @Param("id") id: string,
    @Body(zodBody(tenantUpdateBodySchema)) body: TenantUpdateBody,
  ): Promise<TenantRecord> {
    return this.tenants.update(getRequestContext(), id, body);
  }

  @Post(":id/license-terms")
  @RequireCapability("tenant:manage")
  createLicenseTerm(
    @Param("id") id: string,
    @Body(zodBody(licenseTermCreateBodySchema)) body: LicenseTermCreateBody,
  ): Promise<LicenseTermRecord> {
    return this.tenants.createLicenseTerm(getRequestContext(), id, body);
  }

  @Delete(":id")
  @RequireCapability("tenant:manage")
  delete(@Param("id") _id: string): never {
    throw new GoneException("TENANT_HARD_DELETE_RETIRED");
  }
}

const tenantListFields = [
  { name: "name", read: (record: TenantRecord) => record.name },
  { name: "slug", read: (record: TenantRecord) => record.slug },
  { name: "plan", read: (record: TenantRecord) => record.plan },
  { name: "licenseStartsAt", read: (record: TenantRecord) => record.licenseStartsAt },
  { name: "licenseEndsAt", read: (record: TenantRecord) => record.licenseEndsAt },
  { name: "seatLimit", read: (record: TenantRecord) => record.seatLimit },
  { name: "status", read: (record: TenantRecord) => record.status },
];
