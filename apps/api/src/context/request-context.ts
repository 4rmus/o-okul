import { AsyncLocalStorage } from "node:async_hooks";
import type { ActivePersona } from "@o-okul/shared-types";

export interface RequestContext {
  userId: string;
  sessionId?: string;
  tenantId: string | null;
  membershipId?: string;
  activePersona?: ActivePersona;
  membershipVersion?: number;
  tenantAccessMode?: "active" | "read_only";
  campusScope?: {
    scopeMode: "TENANT" | "CAMPUSES";
    campusIds: string[];
  };
  roles: string[];
  capabilities?: string[];
  bypassRls: boolean;
  mustChangePassword?: boolean;
  rlsBypassReason?: string;
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
  rolePreview?: {
    id: string;
    actorUserId: string;
    mode: "READ_ONLY";
    expiresAt: string;
  };
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function getRequestContext(): RequestContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error("REQUEST_CONTEXT_MISSING");
  }
  return context;
}

export function requireTenantContext(): RequestContext & { tenantId: string } {
  const context = getRequestContext();
  if (!context.tenantId && !context.bypassRls) {
    throw new Error("TENANT_CONTEXT_MISSING");
  }
  return context as RequestContext & { tenantId: string };
}
