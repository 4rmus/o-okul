import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isPortalSubjectRoleName, type PortalSubjectRoleName } from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { type GuardianStore, guardianStoreToken } from "../school/guardian-store.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";

export type RolePreviewTargetRole = PortalSubjectRoleName;

export interface StartRolePreviewInput {
  targetRole?: string;
  targetSubjectId?: string;
}

export interface RolePreviewSession {
  id: string;
  tenantId: string;
  actorUserId: string;
  targetRole: RolePreviewTargetRole;
  targetSubjectType: RolePreviewTargetRole;
  targetSubjectId: string;
  mode: "READ_ONLY";
  expiresAt: string;
  createdAt: string;
  previewToken: string;
}

export interface RolePreviewTokenPayload {
  id: string;
  tenantId: string;
  actorUserId: string;
  targetRole: RolePreviewTargetRole;
  targetSubjectType: RolePreviewTargetRole;
  targetSubjectId: string;
  mode: "READ_ONLY";
  expiresAt: string;
}

type RolePreviewSubjectRecord = { tenantId: string };

@Injectable()
export class RolePreviewService {
  private readonly previewSecret = process.env.ROLE_PREVIEW_SECRET ?? process.env.JWT_ACCESS_SECRET ?? "test-access-secret";

  constructor(
    @Inject(teacherStoreToken) private readonly teacherStore: TeacherStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(guardianStoreToken) private readonly guardianStore: GuardianStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async start(context: RequestContext, input: StartRolePreviewInput): Promise<RolePreviewSession> {
    if (!context.tenantId || context.bypassRls) {
      throw new ForbiddenException("TENANT_CONTEXT_REQUIRED");
    }
    if (!context.roles.includes("TENANT_ADMIN")) {
      throw new ForbiddenException("TENANT_ADMIN_REQUIRED");
    }

    const targetRole = parseTargetRole(input.targetRole);
    const targetSubjectId = required(input.targetSubjectId, "ROLE_PREVIEW_SUBJECT_REQUIRED");
    await this.assertTargetSubjectExists(context.tenantId, targetRole, targetSubjectId);

    const createdAt = new Date();
    const expiresAt = new Date(createdAt);
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);
    const payload: RolePreviewTokenPayload = {
      id: randomUUID(),
      tenantId: context.tenantId,
      actorUserId: context.userId,
      targetRole,
      targetSubjectType: targetRole,
      targetSubjectId,
      mode: "READ_ONLY",
      expiresAt: expiresAt.toISOString(),
    };
    const session: RolePreviewSession = {
      ...payload,
      createdAt: createdAt.toISOString(),
      previewToken: this.signPreviewToken(payload),
    };

    await this.auditLogs?.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      entityType: "RolePreview",
      entityId: session.id,
      action: "role_preview.started",
      diff: {
        targetRole,
        targetSubjectType: targetRole,
        targetSubjectId,
        mode: session.mode,
        expiresAt: session.expiresAt,
      },
    });

    return session;
  }

  verifyPreviewToken(token: string): RolePreviewTokenPayload {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      throw new ForbiddenException("ROLE_PREVIEW_TOKEN_INVALID");
    }

    const expected = sign(encodedPayload, this.previewSecret);
    if (!safeEqual(signature, expected)) {
      throw new ForbiddenException("ROLE_PREVIEW_TOKEN_INVALID");
    }

    const payload = parsePreviewPayload(encodedPayload);
    if (Date.parse(payload.expiresAt) <= Date.now()) {
      throw new ForbiddenException("ROLE_PREVIEW_EXPIRED");
    }
    return payload;
  }

  private signPreviewToken(payload: RolePreviewTokenPayload): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encodedPayload}.${sign(encodedPayload, this.previewSecret)}`;
  }

  private async assertTargetSubjectExists(
    tenantId: string,
    targetRole: RolePreviewTargetRole,
    targetSubjectId: string,
  ): Promise<void> {
    const subject = await this.findTargetSubject(targetRole, targetSubjectId);
    if (!subject || subject.tenantId !== tenantId) {
      throw new NotFoundException("ROLE_PREVIEW_SUBJECT_NOT_FOUND");
    }
  }

  private findTargetSubject(
    targetRole: RolePreviewTargetRole,
    targetSubjectId: string,
  ): Promise<RolePreviewSubjectRecord | undefined> {
    switch (targetRole) {
      case "TEACHER":
        return this.teacherStore.findById(targetSubjectId);
      case "STUDENT":
        return this.studentStore.findById(targetSubjectId);
      case "GUARDIAN":
        return this.guardianStore.findById(targetSubjectId);
    }
  }
}

function parseTargetRole(value: string | undefined): RolePreviewTargetRole {
  if (value && isPortalSubjectRoleName(value)) return value;
  throw new BadRequestException("ROLE_PREVIEW_TARGET_UNSUPPORTED");
}

function required(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function parsePreviewPayload(encodedPayload: string): RolePreviewTokenPayload {
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<RolePreviewTokenPayload>;
    const targetRole = parseTargetRole(payload.targetRole);
    const targetSubjectType = parseTargetRole(payload.targetSubjectType);
    if (targetRole !== targetSubjectType) {
      throw new Error("ROLE_PREVIEW_SUBJECT_TYPE_MISMATCH");
    }
    if (payload.mode !== "READ_ONLY") {
      throw new Error("ROLE_PREVIEW_MODE_INVALID");
    }
    return {
      id: required(payload.id, "ROLE_PREVIEW_ID_REQUIRED"),
      tenantId: required(payload.tenantId, "ROLE_PREVIEW_TENANT_REQUIRED"),
      actorUserId: required(payload.actorUserId, "ROLE_PREVIEW_ACTOR_REQUIRED"),
      targetRole,
      targetSubjectType,
      targetSubjectId: required(payload.targetSubjectId, "ROLE_PREVIEW_SUBJECT_REQUIRED"),
      mode: payload.mode,
      expiresAt: required(payload.expiresAt, "ROLE_PREVIEW_EXPIRES_REQUIRED"),
    };
  } catch {
    throw new ForbiddenException("ROLE_PREVIEW_TOKEN_INVALID");
  }
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
