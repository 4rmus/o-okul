import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  type AcceptIdentityInvitationBody,
  type CreateIdentityInvitationBody,
  type IdentityInvitationIssueResult,
  IdentityInvitationService,
} from "./identity-invitation.service.js";
import type { IdentityInvitationRecord } from "./identity-invitation-store.js";

@Controller("identity-invitations")
@UseGuards(RolesGuard)
export class IdentityInvitationController {
  constructor(private readonly invitations: IdentityInvitationService) {}

  @Get()
  @Roles("TENANT_ADMIN")
  async list(@Query() query: ListQuery): Promise<IdentityInvitationRecord[]> {
    return applyListQuery(await this.invitations.list(getRequestContext()), query, identityInvitationListFields);
  }

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: CreateIdentityInvitationBody): Promise<IdentityInvitationIssueResult> {
    return this.invitations.create(getRequestContext(), body);
  }

  @Post("accept")
  accept(@Body() body: AcceptIdentityInvitationBody): Promise<IdentityInvitationRecord> {
    return this.invitations.accept(body);
  }

  @Post(":id/resend")
  @Roles("TENANT_ADMIN")
  resend(@Param("id") id: string): Promise<IdentityInvitationIssueResult> {
    return this.invitations.resend(getRequestContext(), id);
  }
}

const identityInvitationListFields = [
  { name: "name", read: (record: IdentityInvitationRecord) => record.name },
  { name: "email", read: (record: IdentityInvitationRecord) => record.email },
  { name: "subjectType", read: (record: IdentityInvitationRecord) => record.subjectType },
  { name: "role", read: (record: IdentityInvitationRecord) => record.role },
  { name: "status", read: (record: IdentityInvitationRecord) => record.status },
  { name: "expiresAt", read: (record: IdentityInvitationRecord) => record.expiresAt },
  { name: "createdAt", read: (record: IdentityInvitationRecord) => record.createdAt },
];
