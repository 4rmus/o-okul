import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { getRequestContext } from "../context/request-context.js";
import { requiredCapabilitiesKey } from "./capability.decorator.js";
import { hasCapability, type Capability } from "./role-capabilities.js";

@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredCapabilities =
      this.reflector.getAllAndOverride<Capability[]>(requiredCapabilitiesKey, [context.getHandler(), context.getClass()]) ?? [];

    if (requiredCapabilities.length === 0) {
      return true;
    }

    let requestContext;
    try {
      requestContext = getRequestContext();
    } catch {
      throw new UnauthorizedException("REQUEST_CONTEXT_MISSING");
    }

    if (!requiredCapabilities.every((capability) => hasCapability(requestContext, capability))) {
      throw new ForbiddenException("FORBIDDEN");
    }

    return true;
  }
}
