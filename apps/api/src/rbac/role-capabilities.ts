import {
  capabilitiesForRoles as sharedCapabilitiesForRoles,
  hasCapabilityForRoles,
  type RoleCapability,
} from "@uzman-hocam/shared-types";

export type Capability = RoleCapability;

export function capabilitiesForRoles(roles: readonly string[]): Capability[] {
  return sharedCapabilitiesForRoles(roles);
}

export function hasCapability(context: { roles: readonly string[]; capabilities?: readonly string[] }, required: Capability): boolean {
  return hasCapabilityForRoles(context.roles, required, context.capabilities);
}
