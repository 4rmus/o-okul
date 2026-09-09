import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { z } from "zod";
import type { RequestContext } from "../context/request-context.js";
import type { TenantDeviceBackupPreview } from "@o-okul/shared-types";

const ttl = 5 * 60_000;
// ponytail: process-local preview tickets expire on restart; shared custody before multiple API replicas.
const key = randomBytes(32);
const mac = (domain: string, value: string | Buffer) => createHmac("sha256",key).update("device-preview-plan-v1:"+domain+"\0").update(value).digest("base64url");
const equal = (a:string,b:string) => a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const actor = (c:RequestContext) => mac("actor",JSON.stringify([c.tenantId,c.userId,c.sessionId,c.membershipId,c.membershipVersion,c.tenantLifecycleVersion,c.activePersona,[...c.roles].sort(),c.tenantAccessMode,c.bypassRls]));
const schema=z.object({v:z.literal(1),n:z.string().regex(/^[a-f0-9]{32}$/),i:z.number().int().nonnegative(),e:z.number().int().nonnegative(),a:z.string().length(43),f:z.string().length(43),s:z.string().length(43)}).strict();
export function verifyDeviceRestorePlan(token:string, context:RequestContext, file:Buffer, now=Date.now()) {
  let value:z.infer<typeof schema>;
  try {
    if(token.length>1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))throw new Error();
    const [body,signature]=token.split(".") as [string,string];
    if(!equal(signature,mac("ticket",body)))throw new Error();
    value=schema.parse(JSON.parse(Buffer.from(body,"base64url").toString("utf8")));
    if(value.e-value.i!==ttl || value.i>now || !equal(value.a,actor(context)) || !equal(value.f,mac("archive",file)))throw new Error();
  } catch {throw new ConflictException("DEVICE_RESTORE_PLAN_INVALID");}
  if(value.e<=now)throw new ConflictException("DEVICE_RESTORE_PLAN_EXPIRED");
  return value;
}
export function bindDeviceRestorePlan(context:RequestContext,file:Buffer,snapshot:unknown,issuedAt:number,token?:string,now=Date.now()):NonNullable<TenantDeviceBackupPreview["plan"]> {
  const state=mac("snapshot",JSON.stringify(snapshot));
  if(token){const value=verifyDeviceRestorePlan(token,context,file,now);if(!equal(value.s,state))throw new ConflictException("DEVICE_RESTORE_PLAN_STALE");return {token,createdAt:new Date(value.i).toISOString(),expiresAt:new Date(value.e).toISOString(),scope:"DATABASE_PREVIEW_ONLY",canApply:false};}
  if(issuedAt>now || now-issuedAt>=ttl)throw new ConflictException("DEVICE_RESTORE_PLAN_EXPIRED");
  const body=Buffer.from(JSON.stringify({v:1,n:randomBytes(16).toString("hex"),i:issuedAt,e:issuedAt+ttl,a:actor(context),f:mac("archive",file),s:state})).toString("base64url");
  return {token:body+"."+mac("ticket",body),createdAt:new Date(issuedAt).toISOString(),expiresAt:new Date(issuedAt+ttl).toISOString(),scope:"DATABASE_PREVIEW_ONLY",canApply:false};
}
