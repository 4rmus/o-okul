import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { defer, lastValueFrom, type Observable } from "rxjs";
import type { Request } from "express";
import { getRequestContext } from "../context/request-context.js";
import { closeTenantMutationPool, runApiTenantMutation } from "../context/tenant-mutation-activity.js";
@Injectable()
export class TenantMutationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next.handle();
    let tenantId: string | null;
    try { tenantId = getRequestContext().tenantId; } catch { return next.handle(); }
    // Pre-auth and platform/global mutations need their own explicit tenant admission.
    if (!tenantId) return next.handle();
    // The inner subscription lives until the actual controller settles. Disconnecting
    // the HTTP subscriber must not prematurely delete the durable activity.
    return defer(() => runApiTenantMutation("HTTP_MUTATION", () => lastValueFrom(next.handle()), tenantId));
  }
  async onModuleDestroy() { await closeTenantMutationPool(); }
}
