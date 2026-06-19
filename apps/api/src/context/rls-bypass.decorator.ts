import { SetMetadata } from "@nestjs/common";

export const allowBreakGlassRlsBypassKey = "allowBreakGlassRlsBypass";

export function AllowBreakGlassRlsBypass() {
  return SetMetadata(allowBreakGlassRlsBypassKey, true);
}
