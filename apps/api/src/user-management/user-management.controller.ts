import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { UserManagementService } from "./user-management.service.js";
import type { TenantUserRecord } from "./user-management-store.js";
import {
  type TenantUserCreateBody,
  type TenantUserRolesBody,
  tenantUserCreateBodySchema,
  tenantUserRolesBodySchema,
} from "./user-management-validation.js";

@Controller("tenant-users")
@UseGuards(RolesGuard)
export class UserManagementController {
  constructor(private readonly users: UserManagementService) {}

  @Get()
  @RequireCapability("user:manage")
  async list(@Query() query: ListQuery): Promise<TenantUserRecord[]> {
    return applyListQuery(await this.users.list(getRequestContext()), query, tenantUserListFields);
  }

  @Post()
  @RequireCapability("user:manage")
  create(@Body(zodBody(tenantUserCreateBodySchema)) body: TenantUserCreateBody): Promise<TenantUserRecord> {
    return this.users.create(getRequestContext(), body);
  }

  @Patch(":userId/roles")
  @RequireCapability("user:manage")
  setRoles(
    @Param("userId") userId: string,
    @Body(zodBody(tenantUserRolesBodySchema)) body: TenantUserRolesBody,
  ): Promise<TenantUserRecord> {
    return this.users.setRoles(getRequestContext(), userId, body);
  }
}

const tenantUserListFields = [
  { name: "name", read: (record: TenantUserRecord) => record.name },
  { name: "email", read: (record: TenantUserRecord) => record.email },
  { name: "roles", read: (record: TenantUserRecord) => record.roles.join(",") },
  { name: "createdAt", read: (record: TenantUserRecord) => record.createdAt },
  { name: "updatedAt", read: (record: TenantUserRecord) => record.updatedAt },
];
