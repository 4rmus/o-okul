import { readDevicePlanControls } from "./device-backup.service.js";
import { expect, it, vi } from "vitest";
import { bindDeviceRestorePlan, verifyDeviceRestorePlan } from "./device-backup-plan.js";
import type { RequestContext } from "../context/request-context.js";
import type { Queryable } from "@o-okul/db";
const actor:RequestContext={tenantId:"private-tenant",userId:"private-user",sessionId:"private-session",membershipId:"m",membershipVersion:1,activePersona:"STAFF",roles:["TENANT_ADMIN"],bypassRls:false};
const file=Buffer.from("encrypted fixture"),now=1800000000000,state={records:"private-record",controlVersion:1};
it("binds a short-lived opaque ticket and revalidation never extends its expiry",()=>{
  const p=bindDeviceRestorePlan(actor,file,state,now,undefined,now);
  expect(p).toMatchObject({scope:"DATABASE_PREVIEW_ONLY",canApply:false,expiresAt:new Date(now+300000).toISOString()});
  expect(bindDeviceRestorePlan(actor,file,state,now+1000,p.token,now+1000)).toEqual(p);
  expect(Buffer.from(p.token.split('.')[0]!,"base64url").toString()).not.toMatch(/private-/);
  expect(()=>bindDeviceRestorePlan(actor,file,{...state,controlVersion:2},now,p.token,now+1000)).toThrow("DEVICE_RESTORE_PLAN_STALE");
});
it("rejects expiration, clock reversal, tampering, actor/session/role and archive changes",()=>{
  const p=bindDeviceRestorePlan(actor,file,state,now,undefined,now);
  expect(()=>verifyDeviceRestorePlan(p.token,actor,file,now+300000)).toThrow("DEVICE_RESTORE_PLAN_EXPIRED");
  expect(()=>verifyDeviceRestorePlan(p.token,actor,file,now-1)).toThrow("DEVICE_RESTORE_PLAN_INVALID");
  for(const override of [{tenantId:"other"},{userId:"other"},{sessionId:"other"},{membershipVersion:2},{roles:["TENANT_OWNER"]}])expect(()=>verifyDeviceRestorePlan(p.token,{...actor,...override},file,now)).toThrow("DEVICE_RESTORE_PLAN_INVALID");
  expect(()=>verifyDeviceRestorePlan(p.token,actor,Buffer.from("different"),now)).toThrow("DEVICE_RESTORE_PLAN_INVALID");
  for(const token of [p.token+'x',p.token.slice(0,-2)+'xx','x'.repeat(1025),'a.b'])expect(()=>verifyDeviceRestorePlan(token,actor,file,now)).toThrow("DEVICE_RESTORE_PLAN_INVALID");
});
it("invalidates tickets when the process key is replaced",async()=>{
  const p=bindDeviceRestorePlan(actor,file,state,now,undefined,now);vi.resetModules();const restarted=await import("./device-backup-plan.js");
  expect(()=>restarted.verifyDeviceRestorePlan(p.token,actor,file,now)).toThrow("DEVICE_RESTORE_PLAN_INVALID");
});
it("bounds control reads and excludes authentication secrets",async()=>{
  const queries:string[]=[];const db={query:async(sql:string,values:unknown[])=>{expect(values).toEqual(["a"]);queries.push(sql);return {rows:[]};}} as unknown as Queryable;
  expect(Object.keys((await readDevicePlanControls(db,"a"))!)).toHaveLength(6);
  for(const sql of queries){expect(sql).toContain("LIMIT 2001");expect(sql).not.toMatch(/"passwordHash"|"tokenHash"|"refreshTokenHash"|"totpSecretEncrypted"|SELECT \*/);}
  expect(await readDevicePlanControls({query:async()=>({rows:Array.from({length:2001},()=>({row:"{}"}))})} as unknown as Queryable,"a")).toBeNull();
});
