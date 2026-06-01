import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { getRequestContext } from "../context/request-context.js";
import { hasRole, type Role } from "./roles.js";
import { requiredRolesKey } from "./roles.decorator.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<Role[]>(requiredRolesKey, [context.getHandler(), context.getClass()]) ?? [];

    if (requiredRoles.length === 0) {
      return true;
    }

    let requestContext;
    try {
      requestContext = getRequestContext();
    } catch {
      throw new UnauthorizedException("REQUEST_CONTEXT_MISSING");
    }

    if (!requiredRoles.some((role) => hasRole(requestContext.roles, role))) {
      throw new ForbiddenException("FORBIDDEN");
    }

    return true;
  }
}
