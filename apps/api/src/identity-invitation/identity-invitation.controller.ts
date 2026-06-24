import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import type {
  IdentityInvitationAcceptResponse,
  IdentityInvitationRecord as PublicIdentityInvitationRecord,
} from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { IdentityInvitationService } from "./identity-invitation.service.js";
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
  async list(@Query() query: ListQuery): Promise<PublicIdentityInvitationRecord[]> {
    return applyListQuery(
      (await this.invitations.list(getRequestContext())).map(toPublicIdentityInvitationRecord),
      query,
      identityInvitationListFields,
    );
  }

  @Post()
  @RequireCapability("user:manage")
  async create(
    @Body(zodBody(identityInvitationCreateBodySchema)) body: IdentityInvitationCreateBody,
  ): Promise<PublicIdentityInvitationRecord> {
    return toPublicIdentityInvitationRecord((await this.invitations.create(getRequestContext(), body)).invitation);
  }

  @Post("accept")
  async accept(@Body(zodBody(identityInvitationAcceptBodySchema)) body: IdentityInvitationAcceptBody): Promise<IdentityInvitationAcceptResponse> {
    const accepted = await this.invitations.accept(body);
    return {
      status: "ACCEPTED",
      acceptedAt: accepted.acceptedAt,
    };
  }

  @Post(":id/resend")
  @RequireCapability("user:manage")
  async resend(@Param("id") id: string): Promise<PublicIdentityInvitationRecord> {
    return toPublicIdentityInvitationRecord((await this.invitations.resend(getRequestContext(), id)).invitation);
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

function toPublicIdentityInvitationRecord(record: IdentityInvitationRecord): PublicIdentityInvitationRecord {
  const { acceptedUserId: _acceptedUserId, ...publicRecord } = record;
  return publicRecord;
}
