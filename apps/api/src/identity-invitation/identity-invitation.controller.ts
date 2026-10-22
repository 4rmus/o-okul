import { Body, Controller, Get, Param, Post, Query, UseGuards, Headers } from "@nestjs/common";
import { z } from "zod";
import type {
  IdentityInvitationAcceptResponse,
  IdentityInvitationListQuery,
  IdentityInvitationRecord as PublicIdentityInvitationRecord,
} from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, zodBody, zodQuery } from "../http/zod-validation.js";
import { withCursorListMeta } from "../listing/list-query.js";
import {
  cursorListQueryShape,
  defaultedQueryEnum,
  optionalQueryEnum,
  previousNeedsCursor,
} from "../listing/cursor-query-schema.js";
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

// Cursor list like GET /employees: `.strict()` refuses the retired `page` parameter with 422. `q` still matches
// subjectType/subjectId/role/status as the old in-memory list did; subjectType/subjectId/status are exact filters.
const identityInvitationListQuerySchema = z.object({
  ...cursorListQueryShape({ defaultLimit: 50, maxLimit: 100 }),
  sort: defaultedQueryEnum(["-createdAt", "createdAt"], "-createdAt"),
  status: optionalQueryEnum(["PENDING", "ACCEPTED", "REVOKED"]),
  subjectId: optionalTrimmedString,
  subjectType: optionalQueryEnum(["TEACHER", "STUDENT", "GUARDIAN", "EMPLOYEE"]),
}).strict().refine(previousNeedsCursor, {
  message: "IDENTITY_INVITATION_CURSOR_REQUIRED",
  path: ["cursor"],
}) satisfies z.ZodType<IdentityInvitationListQuery>;

@Controller("identity-invitations")
@UseGuards(RolesGuard)
export class IdentityInvitationController {
  constructor(private readonly invitations: IdentityInvitationService) {}

  @Get()
  @RequireCapability("user:manage")
  async list(
    @Query(zodQuery(identityInvitationListQuerySchema)) query: IdentityInvitationListQuery,
  ): Promise<PublicIdentityInvitationRecord[]> {
    const page = await this.invitations.listPage(getRequestContext(), query);
    return withCursorListMeta(page.records.map(toPublicIdentityInvitationRecord), page.meta);
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
  async resend(@Param("id") id: string, @Headers("idempotency-key") idempotencyKey?: string): Promise<PublicIdentityInvitationRecord> {
    return toPublicIdentityInvitationRecord(await this.invitations.resend(getRequestContext(), id, idempotencyKey));
  }

  // UAT F-03: state-guarded (PENDING -> REVOKED); a repeat gets IDENTITY_INVITATION_NOT_PENDING, so no Idempotency-Key.
  @Post(":id/revoke")
  @RequireCapability("user:manage")
  async revoke(@Param("id") id: string): Promise<PublicIdentityInvitationRecord> {
    return toPublicIdentityInvitationRecord(await this.invitations.revoke(getRequestContext(), id));
  }
}

function toPublicIdentityInvitationRecord(record: IdentityInvitationRecord): PublicIdentityInvitationRecord {
  const { acceptedUserId: _acceptedUserId, ...publicRecord } = record;
  return publicRecord;
}
