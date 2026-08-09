import { Controller, Get, Header } from "@nestjs/common";
import type { ResolvedFeatureRollouts } from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { FeatureRolloutService } from "./feature-rollout.service.js";

@Controller("me/feature-rollouts")
export class FeatureRolloutController {
  constructor(private readonly featureRollouts: FeatureRolloutService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @RequireCapability("feature-rollout:read")
  resolve(): Promise<ResolvedFeatureRollouts> {
    return this.featureRollouts.resolve(getRequestContext());
  }
}
