import { GoneException, Injectable } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import { FeatureRolloutService } from "../feature-rollout/feature-rollout.service.js";

@Injectable()
export class GuardianWritePolicy {
  constructor(private readonly featureRollouts: FeatureRolloutService) {}

  async assertWritable(context: RequestContext): Promise<void> {
    const resolved = await this.featureRollouts.resolve(context);
    if (resolved.enabledFeatureKeys.includes("product.guardian-read-only")) {
      throw new GoneException("GUARDIAN_WRITE_READ_ONLY");
    }
  }
}
