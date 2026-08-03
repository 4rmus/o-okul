import { randomBytes, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import type {
  StudentPortalActivationRequest,
  StudentPortalActivationResponse,
  StudentPortalInvitationIssueResponse,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { licenseTermStoreToken, type LicenseTermStore } from "../license/license-term-store.js";
import { tenantStoreToken, type TenantStore } from "../tenant/tenant-store.js";
import {
  hashStudentPortalActivationCode,
  normalizeStudentPortalActivationCode,
  type StudentPortalActivationStore,
  studentPortalActivationStoreToken,
} from "./student-portal-activation-store.js";

const studentActivationAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const studentActivationTtlMs = 24 * 60 * 60 * 1000;
const studentActivationMaxAttempts = 5;

@Injectable()
export class StudentPortalActivationService {
  constructor(
    @Inject(studentPortalActivationStoreToken) private readonly store: StudentPortalActivationStore,
    private readonly auditLogs: AuditLogService,
    @Optional() @Inject(tenantStoreToken) private readonly tenants?: TenantStore,
    @Optional() @Inject(licenseTermStoreToken) private readonly licenseTerms?: LicenseTermStore,
  ) {}

  async issue(context: RequestContext, studentId: string): Promise<StudentPortalInvitationIssueResponse> {
    if (!context.tenantId || context.bypassRls) throw new BadRequestException("TENANT_CONTEXT_REQUIRED");
    const invitationId = randomUUID();
    const activationCode = createStudentPortalActivationCode();
    const expiresAt = new Date(Date.now() + studentActivationTtlMs).toISOString();
    let invitation;
    try {
      invitation = await this.store.issue({
        id: invitationId,
        tenantId: context.tenantId,
        studentId,
        tokenHash: hashStudentPortalActivationCode(invitationId, activationCode),
        expiresAt,
        maxAttempts: studentActivationMaxAttempts,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (
        code === "STUDENT_PORTAL_PROFILE_NOT_ACTIVE" ||
        code === "STUDENT_PORTAL_ALREADY_ACTIVATED" ||
        code === "STUDENT_PORTAL_STUDENT_NO_REQUIRED"
      ) {
        throw new ConflictException(code);
      }
      throw error;
    }
    if (!invitation) throw new NotFoundException("STUDENT_NOT_FOUND");

    const activationUrl = new URL("/aktivasyon", process.env.WEB_URL ?? "http://localhost:3000");
    const activationFragment = new URLSearchParams({
      tenant: invitation.tenantSlug,
      student: invitation.studentNo,
      code: activationCode,
    });
    activationUrl.hash = activationFragment.toString();
    await this.auditLogs.record({
      tenantId: invitation.tenantId,
      actorUserId: context.userId,
      entityType: "IdentityInvitation",
      entityId: invitation.id,
      action: "student.portal_invitation_issued",
      diff: {
        studentId: invitation.studentId,
        kind: "STUDENT_CODE",
        expiresAt: invitation.expiresAt,
        maxAttempts: studentActivationMaxAttempts,
      },
    });
    return {
      invitationId: invitation.id,
      studentId: invitation.studentId,
      tenantSlug: invitation.tenantSlug,
      studentNo: invitation.studentNo,
      activationCode,
      activationUrl: activationUrl.toString(),
      expiresAt: invitation.expiresAt,
    };
  }

  async accept(input: StudentPortalActivationRequest): Promise<StudentPortalActivationResponse> {
    const tenantSlug = input.tenantSlug.trim().toLowerCase();
    if (this.tenants && this.licenseTerms) {
      const tenant = await this.tenants.findBySlug(tenantSlug);
      const license = tenant?.status === "ACTIVE" ? await this.licenseTerms.resolveForTenant(tenant.id) : undefined;
      if (!license || !license.mirrorParity || license.state !== "ACTIVE") {
        throw new UnauthorizedException("STUDENT_PORTAL_ACTIVATION_INVALID");
      }
    }
    const outcome = await this.store.accept({
      tenantSlug,
      studentNo: input.studentNo.trim(),
      code: normalizeStudentPortalActivationCode(input.code),
      password: input.password,
    });
    if (outcome.status !== "ACCEPTED") {
      if (outcome.status === "PROFILE_NOT_ACTIVE") throw new ConflictException("STUDENT_PORTAL_PROFILE_NOT_ACTIVE");
      if (outcome.status === "ALREADY_ACTIVATED") throw new ConflictException("STUDENT_PORTAL_ALREADY_ACTIVATED");
      if (outcome.status === "LOGIN_NAME_CONFLICT") throw new ConflictException("STUDENT_PORTAL_LOGIN_NAME_CONFLICT");
      throw new UnauthorizedException("STUDENT_PORTAL_ACTIVATION_INVALID");
    }
    await this.auditLogs.record({
      tenantId: outcome.tenantId,
      actorUserId: outcome.userId,
      entityType: "IdentityInvitation",
      entityId: outcome.invitationId,
      action: "student.portal_activation_accepted",
      diff: { studentId: outcome.studentId, loginNameAssigned: true },
    });
    return { status: "ACCEPTED", acceptedAt: outcome.acceptedAt, loginName: outcome.loginName };
  }
}

export function createStudentPortalActivationCode(): string {
  return [...randomBytes(12)].map((byte) => studentActivationAlphabet[byte & 31]).join("");
}
