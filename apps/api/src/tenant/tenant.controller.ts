import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import type { TenantRecord } from "./tenant-store.js";
import { TenantService, type TenantCreateResponse, type TenantWriteBody } from "./tenant.service.js";

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

  @Post()
  @RequireCapability("tenant:manage")
  create(@Body() body: TenantWriteBody): Promise<TenantCreateResponse> {
    return this.tenants.create(getRequestContext(), body);
  }

  @Patch(":id")
  @RequireCapability("tenant:manage")
  update(@Param("id") id: string, @Body() body: TenantWriteBody): Promise<TenantRecord> {
    return this.tenants.update(getRequestContext(), id, body);
  }

  @Delete(":id")
  @RequireCapability("tenant:manage")
  delete(@Param("id") id: string): Promise<TenantRecord> {
    return this.tenants.delete(getRequestContext(), id);
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
