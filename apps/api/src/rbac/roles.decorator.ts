import { SetMetadata } from "@nestjs/common";
import type { Role } from "./roles.js";

export const requiredRolesKey = "requiredRoles";

export function Roles(...requiredRoles: Role[]) {
  return SetMetadata(requiredRolesKey, requiredRoles);
}
