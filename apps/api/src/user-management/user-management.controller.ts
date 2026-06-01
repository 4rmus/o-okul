import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  type CreateTenantUserBody,
  type SetTenantUserRolesBody,
  UserManagementService,
} from "./user-management.service.js";
import type { TenantUserRecord } from "./user-management-store.js";

@Controller("tenant-users")
@UseGuards(RolesGuard)
export class UserManagementController {
  constructor(private readonly users: UserManagementService) {}

  @Get()
  @Roles("TENANT_ADMIN")
  async list(@Query() query: ListQuery): Promise<TenantUserRecord[]> {
    return applyListQuery(await this.users.list(getRequestContext()), query, tenantUserListFields);
  }

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: CreateTenantUserBody): Promise<TenantUserRecord> {
    return this.users.create(getRequestContext(), body);
  }

  @Patch(":userId/roles")
  @Roles("TENANT_ADMIN")
  setRoles(@Param("userId") userId: string, @Body() body: SetTenantUserRolesBody): Promise<TenantUserRecord> {
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
