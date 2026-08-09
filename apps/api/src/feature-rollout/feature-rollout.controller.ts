import { Controller, Get, Header } from "@nestjs/common";
import type { ResolvedFeatureRollouts } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { FeatureRolloutService } from "./feature-rollout.service.js";

@Controller("me/feature-rollouts")
export class FeatureRolloutController {
  constructor(private readonly featureRollouts: FeatureRolloutService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @Roles(
    "TENANT_OWNER",
    "TENANT_ADMIN",
    "ASSISTANT_ADMIN",
    "OPERATIONS_STAFF",
    "FINANCE_STAFF",
    "TEACHER",
    "STUDENT",
    "GUARDIAN",
  )
  resolve(): Promise<ResolvedFeatureRollouts> {
    return this.featureRollouts.resolve(getRequestContext());
  }
}
