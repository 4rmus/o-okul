import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import type { TenantRecord } from "./tenant-store.js";
import { TenantService, type TenantWriteBody } from "./tenant.service.js";

@Controller("tenants")
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  @RequireCapability("tenant:manage")
  list(): Promise<TenantRecord[]> {
    return this.tenants.list(getRequestContext());
  }

  @Get(":id")
  @RequireCapability("tenant:manage")
  findOne(@Param("id") id: string): Promise<TenantRecord> {
    return this.tenants.findOne(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("tenant:manage")
  create(@Body() body: TenantWriteBody): Promise<TenantRecord> {
    return this.tenants.create(getRequestContext(), body);
  }

  @Patch(":id")
  @RequireCapability("tenant:manage")
  update(@Param("id") id: string, @Body() body: TenantWriteBody): Promise<TenantRecord> {
    return this.tenants.update(getRequestContext(), id, body);
  }
}
