import { TenantFreshResetService, tenantCleanResetBodySchema, tenantResetRequestBodySchema, tenantResetRevokeBodySchema } from "./tenant-fresh-reset.service.js";
import type { TenantCleanResetRequest } from "@o-okul/shared-types";
import { TenantResetPreviewService } from "./tenant-reset-preview.service.js";
import { Body, Controller, Delete, Get, GoneException, HttpCode, Header, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import type { LicenseTermRecord } from "../license/license-term-store.js";
import type { LicenseTermListRecord, TenantStatusUpdateResult } from "@o-okul/shared-types";
import { licenseTermCreateBodySchema, type LicenseTermCreateBody } from "../license/license-validation.js";
import type { TenantRecord } from "./tenant-store.js";
import { TenantService, type TenantCreateResponse } from "./tenant.service.js";
import {
  tenantCreateBodySchema,
  tenantStatusUpdateBodySchema,
  tenantUpdateBodySchema,
  type TenantCreateBody,
  type TenantStatusUpdateBody,
  type TenantUpdateBody,
} from "./tenant-validation.js";

@Controller("tenants")
export class TenantController {
  constructor(private readonly tenants: TenantService, private readonly resetPreview: TenantResetPreviewService, private readonly freshReset: TenantFreshResetService) {}

  @Get()
  @RequireCapability("tenant:manage")
  async list(@Query() query: ListQuery): Promise<TenantRecord[]> {
    return applyListQuery(await this.tenants.list(getRequestContext()), query, tenantListFields);
  }

  @Get("current/reset-request")
  @RequireCapability("setup:manage")
  institutionResetRequest() { return this.freshReset.institutionRequest(getRequestContext()); }

  @Post("current/reset-request")
  @RequireCapability("setup:manage")
  requestInstitutionReset(@Body(zodBody(tenantResetRequestBodySchema)) body: { expectedRequestId: string | null; preset: "CLEAN_SETUP_V1" }) {
    return this.freshReset.changeInstitutionRequest(getRequestContext(), body.expectedRequestId);
  }

  @Post("current/reset-request/revoke")
  @RequireCapability("setup:manage")
  revokeInstitutionReset(@Body(zodBody(tenantResetRevokeBodySchema)) body: { expectedRequestId: string }) {
    return this.freshReset.changeInstitutionRequest(getRequestContext(), body.expectedRequestId, true);
  }

  @Get(":id/reset-diagnostics")
  @RequireCapability("tenant:clean-reset")
  resetDiagnostics(@Param("id") id: string, @Query("activityAfter") activityAfter?: string, @Query("deliveryAfter") deliveryAfter?: string) {
    return this.freshReset.diagnostics(getRequestContext(), id, activityAfter, deliveryAfter);
  }

  @Get(":id/reset-diagnostics/deliveries/:deliveryId/receipt")
  @Header("Cache-Control", "no-store")
  @RequireCapability("tenant:clean-reset")
  resetDeliveryReceipt(@Param("id") id: string, @Param("deliveryId") deliveryId: string) {
    return this.freshReset.deliveryReceipt(getRequestContext(), id, deliveryId);
  }

  @Get(":id/clean-reset-preview")
  @RequireCapability("tenant:clean-reset")
  previewCleanReset(@Param("id") id: string) {
    return this.resetPreview.preview(id);
  }

  @Post(":id/clean-reset-jobs")
  @HttpCode(202)
  @RequireCapability("tenant:clean-reset")
  createCleanReset(@Param("id") id: string, @Body(zodBody(tenantCleanResetBodySchema)) body: TenantCleanResetRequest,
    @Headers("idempotency-key") key?: string, @Headers("x-step-up-token") proof?: string) {
    return this.freshReset.create(getRequestContext(), id, body, key, proof);
  }

  @Get(":id/clean-reset-jobs")
  @RequireCapability("tenant:clean-reset")
  cleanResetStatusByKey(@Param("id") id: string, @Headers("idempotency-key") key?: string) {
    return this.freshReset.statusByKey(getRequestContext(), id, key);
  }

  @Get(":id/clean-reset-jobs/:operationId")
  @RequireCapability("tenant:clean-reset")
  cleanResetStatus(@Param("id") id: string, @Param("operationId") operationId: string) {
    return this.freshReset.status(getRequestContext(), id, operationId);
  }

  @Get(":id")
  @RequireCapability("tenant:manage")
  async findOne(@Param("id") id: string) {
    const context = getRequestContext();
    const tenant = await this.tenants.findOne(context, id);
    return { ...tenant, management: await this.freshReset.management(context, tenant) };
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

  @Patch(":id/status")
  @RequireCapability("tenant:lifecycle")
  updateStatus(
    @Param("id") id: string,
    @Body(zodBody(tenantStatusUpdateBodySchema)) body: TenantStatusUpdateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Headers("x-step-up-token") stepUpToken?: string,
  ): Promise<TenantStatusUpdateResult> {
    return this.tenants.updateStatus(getRequestContext(), id, body, idempotencyKey, stepUpToken);
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
