import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  type IdentityInvitationIssueResult,
  IdentityInvitationService,
} from "./identity-invitation.service.js";
import type { IdentityInvitationRecord } from "./identity-invitation-store.js";
import {
  type IdentityInvitationAcceptBody,
  type IdentityInvitationCreateBody,
  identityInvitationAcceptBodySchema,
  identityInvitationCreateBodySchema,
} from "./identity-invitation-validation.js";

@Controller("identity-invitations")
@UseGuards(RolesGuard)
export class IdentityInvitationController {
  constructor(private readonly invitations: IdentityInvitationService) {}

  @Get()
  @RequireCapability("user:manage")
  async list(@Query() query: ListQuery): Promise<IdentityInvitationRecord[]> {
    return applyListQuery(await this.invitations.list(getRequestContext()), query, identityInvitationListFields);
  }

  @Post()
  @RequireCapability("user:manage")
  create(
    @Body(zodBody(identityInvitationCreateBodySchema)) body: IdentityInvitationCreateBody,
  ): Promise<IdentityInvitationIssueResult> {
    return this.invitations.create(getRequestContext(), body);
  }

  @Post("accept")
  accept(@Body(zodBody(identityInvitationAcceptBodySchema)) body: IdentityInvitationAcceptBody): Promise<IdentityInvitationRecord> {
    return this.invitations.accept(body);
  }

  @Post(":id/resend")
  @RequireCapability("user:manage")
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
