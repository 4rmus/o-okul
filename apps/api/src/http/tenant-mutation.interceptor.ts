import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from "@nestjs/common";
import { defer, lastValueFrom, type Observable } from "rxjs";
import type { Request } from "express";
import { getRequestContext } from "../context/request-context.js";
import { readOnlyOperationMetadata } from "./read-only-operation.js";
import { closeTenantMutationPool, openApiMutationAdmission, runApiTenantMutation, stopApiMutationAdmission, trackApiMutation } from "../context/tenant-mutation-activity.js";
@Injectable()
export class TenantMutationInterceptor implements NestInterceptor {
  onModuleInit() { openApiMutationAdmission(); }
  beforeApplicationShutdown() { stopApiMutationAdmission(); }
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next.handle();
    const handler = context.getHandler?.();
    if (handler && Reflect.getMetadata(readOnlyOperationMetadata, handler) === true) {
      return defer(() => trackApiMutation(() => lastValueFrom(next.handle())));
    }
    let tenantId: string | null = null;
    try { tenantId = getRequestContext().tenantId; } catch { /* Track pre-auth work through shutdown too. */ }
    // Pre-auth and platform/global mutations need their own explicit tenant admission.
    // The inner subscription lives until the actual controller settles. Disconnecting
    // the HTTP subscriber must not prematurely delete the durable activity.
    const run = () => lastValueFrom(next.handle());
    return defer(() => trackApiMutation(() => tenantId ? runApiTenantMutation("HTTP_MUTATION", run, tenantId, isClientHttpError) : run()));
  }
  async onApplicationShutdown() { await closeTenantMutationPool(); }
}

/**
 * UAT F-12: a handler that threw a Nest 4xx has settled, so only this outer HTTP row is closed.
 * Remote effects (S3/queue/provider) keep their own nested rows and stay UNCERTAIN on failure;
 * 5xx and unknown errors still leave this row UNCERTAIN.
 */
export function isClientHttpError(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() < 500;
}
