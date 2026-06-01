import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthService } from "../auth/auth.service.js";
import { runWithRequestContext } from "./request-context.js";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  use(request: Request, _response: Response, next: NextFunction): void {
    const authHeader = request.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      next();
      return;
    }

    const payload = this.auth.verifyAccessToken(authHeader.slice("Bearer ".length));
    runWithRequestContext(
      {
        userId: payload.sub,
        tenantId: payload.tenantId === "system" ? null : payload.tenantId,
        roles: payload.roles,
        bypassRls: payload.roles.includes("SYSTEM_ADMIN"),
        subjectType: payload.subjectType,
        subjectId: payload.subjectId,
      },
      () => next(),
    );
  }
}
