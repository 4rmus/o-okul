import { Body, Controller, Get, GoneException, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, zodBody, zodQuery } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { UserManagementService } from "./user-management.service.js";
import type { TenantUserRecord } from "./user-management-store.js";
import type { EmployeeAccessListQuery, EmployeeAccessRecord, IdentityInvitationRecord, TenantMembershipUpdateResult } from "@o-okul/shared-types";
import { IdentityInvitationService } from "../identity-invitation/identity-invitation.service.js";
import {
  type TenantMembershipUpdateBody,
  type EmployeeAccountInvitationBody,
  type EmployeeCreateBody,
  employeeAccountInvitationBodySchema,
  employeeCreateBodySchema,
  tenantMembershipUpdateBodySchema,
} from "./user-management-validation.js";

const employeeAccessListQuerySchema = z.object({
  cursor: optionalTrimmedString,
  direction: z.preprocess((value) => value === undefined || value === "" ? "next" : value, z.enum(["next", "previous"])),
  limit: z.preprocess((value) => value === undefined || value === "" ? 50 : Number(value), z.number().int().min(1).max(100)),
  q: optionalTrimmedString,
  sort: z.preprocess(
    (value) => value === undefined || value === "" ? "lastName" : value,
    z.enum(["lastName", "-lastName", "firstName", "employeeNo"]),
  ),
}).strict().refine((query) => query.direction !== "previous" || Boolean(query.cursor), {
  message: "EMPLOYEE_CURSOR_REQUIRED",
  path: ["cursor"],
});

@Controller("tenant-users")
@UseGuards(RolesGuard)
export class UserManagementController {
  constructor(private readonly users: UserManagementService) {}

  @Get()
  @RequireCapability("user:manage")
  async list(@Query() query: ListQuery): Promise<TenantUserRecord[]> {
    return applyListQuery(await this.users.list(getRequestContext()), query, tenantUserListFields);
  }

  @Patch(":userId/roles")
  @RequireCapability("user:manage")
  retireRoleWrite(): never {
    throw new GoneException("TENANT_USER_ROLE_WRITE_RETIRED");
  }

}

@Controller("employees")
@UseGuards(RolesGuard)
export class EmployeeAccessController {
  constructor(
    private readonly users: UserManagementService,
    private readonly invitations: IdentityInvitationService,
  ) {}

  @Get()
  @RequireCapability("user:manage")
  list(@Query(zodQuery(employeeAccessListQuerySchema)) query: EmployeeAccessListQuery): Promise<EmployeeAccessRecord[]> {
    return this.users.listEmployees(getRequestContext(), query);
  }

  @Post()
  @RequireCapability("user:manage")
  create(@Body(zodBody(employeeCreateBodySchema)) body: EmployeeCreateBody): Promise<EmployeeAccessRecord> {
    return this.users.createEmployee(getRequestContext(), body);
  }

  @Post(":id/account-invitations")
  @RequireCapability("user:manage")
  async invite(
    @Param("id") id: string,
    @Body(zodBody(employeeAccountInvitationBodySchema)) body: EmployeeAccountInvitationBody,
  ): Promise<IdentityInvitationRecord> {
    const issued = await this.invitations.createEmployeeInvitation(getRequestContext(), id, body);
    const { acceptedUserId: _acceptedUserId, ...record } = issued.invitation;
    return record;
  }
}

@Controller("tenant-memberships")
@UseGuards(RolesGuard)
export class TenantMembershipController {
  constructor(private readonly users: UserManagementService) {}

  @Patch(":id")
  @RequireCapability("user:manage")
  update(
    @Param("id") id: string,
    @Body(zodBody(tenantMembershipUpdateBodySchema)) body: TenantMembershipUpdateBody,
  ): Promise<TenantMembershipUpdateResult> {
    return this.users.updateMembership(getRequestContext(), id, body);
  }
}

const tenantUserListFields = [
  { name: "name", read: (record: TenantUserRecord) => record.name },
  { name: "email", read: (record: TenantUserRecord) => record.email ?? "" },
  { name: "roles", read: (record: TenantUserRecord) => record.roles.join(",") },
  { name: "createdAt", read: (record: TenantUserRecord) => record.createdAt },
  { name: "updatedAt", read: (record: TenantUserRecord) => record.updatedAt },
];
