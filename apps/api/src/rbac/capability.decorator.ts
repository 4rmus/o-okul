import { SetMetadata } from "@nestjs/common";
import type { Capability } from "./role-capabilities.js";

export const requiredCapabilitiesKey = "requiredCapabilities";

export function RequireCapability(...capabilities: Capability[]) {
  return SetMetadata(requiredCapabilitiesKey, capabilities);
}
