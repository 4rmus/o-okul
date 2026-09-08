import { describe, expect, it } from "vitest";
import pg from "pg";
import { generateKeyPairSync, randomUUID, randomBytes } from "node:crypto";
import { readTenantBackupSchema, withTenantDb } from "@o-okul/db";
import { projectDeviceBackup } from "./device-backup.service.js";
import { deviceBackupKeyId, sealDeviceBackup } from "./device-backup-archive.js";
import { restoreExistingDeviceBackupDrill } from "./device-backup-existing-drill.js";

it("rejects live tenants, non-local DBs, and URL options before archive processing", async()=>{
 const input={databaseUrl:"postgresql://app:app@127.0.0.1:15432/o_okul_reset_drill",operationId:"a".repeat(32),tenantId:"device-backup-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-a",file:Buffer.alloc(0),password:"fixture-password",trustedKeys:new Map()};
 for(const tenantId of ["dna","demoo","system","device-preview-uat-a"])await expect(restoreExistingDeviceBackupDrill({...input,tenantId})).rejects.toThrow("DEVICE_EXISTING_DISPOSABLE_REQUIRED");
 for(const databaseUrl of [input.databaseUrl.replace('127.0.0.1','remote'),input.databaseUrl.replace('o_okul_reset_drill','o_okul'),input.databaseUrl+'?options=unsafe'])await expect(restoreExistingDeviceBackupDrill({...input,databaseUrl})).rejects.toThrow("DEVICE_EXISTING_DISPOSABLE_REQUIRED");
});
const url=process.env.DEVICE_EXISTING_APP_URL,adminUrl=process.env.DEVICE_EXISTING_ADMIN_URL;
if(process.env.DEVICE_EXISTING_REQUIRED==='1'&&(!url||!adminUrl))throw new Error('DEVICE_EXISTING_URLS_REQUIRED');
(url&&adminUrl?describe:describe.skip)("existing tenant PostgreSQL transaction",()=>{
 it("restores insert/update/delete, preserves identities, replays as no-op and rolls back failed writes",async()=>{
  for(const value of [url!,adminUrl!]){const target=new URL(value);expect(target.hostname).toBe('127.0.0.1');expect(target.pathname).toBe('/o_okul_reset_drill');}
  const admin=new pg.Pool({connectionString:adminUrl}),app=new pg.Pool({connectionString:url});
  const tenantId='device-backup-'+randomUUID()+'-a',other='device-backup-'+randomUUID()+'-a';
  const keys=generateKeyPairSync('ed25519'),password='offline-existing-restore-password';
  const snapshot=()=>withTenantDb(app,{tenantId,readOnly:true},async db=>projectDeviceBackup(tenantId,await readTenantBackupSchema(db),db));
  const seal=async(p:Awaited<ReturnType<typeof snapshot>>)=>sealDeviceBackup(Buffer.from(JSON.stringify(p)),tenantId,password,keys.privateKey);
  const restore=(file:Buffer,failBeforeCommit=false,operationId=randomBytes(16).toString("hex"),failAfterCommit=false)=>restoreExistingDeviceBackupDrill({databaseUrl:url!,tenantId,file,password,trustedKeys:new Map([[deviceBackupKeyId(keys.publicKey),keys.publicKey]]),failBeforeCommit,operationId,failAfterCommit});
  try{
   for(const id of [tenantId,other]){
    await admin.query('INSERT INTO "Tenant" (id,name,slug,status,"updatedAt") VALUES ($1,$1,$1,\'SUSPENDED\',now())',[id]);
    await admin.query('INSERT INTO "User" (id,"tenantId",name,"passwordHash","accountStatus","updatedAt") VALUES ($1,$2,\'Preserved\',\'!disabled!\',\'DISABLED\',now())',[id+'-user',id]);
    await admin.query('INSERT INTO "Exam" (id,"tenantId",title,"updatedAt") VALUES ($1,$2,\'Before\',now())',[id+'-exam',id]);
   }
   const initial=await snapshot(),file=await seal(initial);
   const invalid=structuredClone(initial);invalid.tables.User![0]!.row=invalid.tables.User![0]!.row.replace('Preserved','Changed');
   await expect(restore(await seal(invalid))).rejects.toThrow('DEVICE_EXISTING_PRESERVED_DIFFERENCE');
   await admin.query('UPDATE "Exam" SET title=\'Changed\' WHERE id=$1',[tenantId+'-exam']);
   const dirty=await snapshot();
   await expect(restore(file,true)).rejects.toThrow('DEVICE_EXISTING_INJECTED_FAILURE');
   expect(await snapshot()).toEqual(dirty);
   expect((await admin.query('SELECT count(*)::int AS n FROM device_existing_restore.receipts WHERE tenant_id=$1',[tenantId])).rows[0].n).toBe(0);
   const operationId=randomBytes(16).toString('hex');
   await expect(restore(file,false,operationId,true)).rejects.toThrow('DEVICE_EXISTING_LOST_ACK');
   expect(await restore(file,false,operationId)).toMatchObject({mutations:0,replay:true});
   const another=structuredClone(initial);another.tables.Exam![0]!.row=another.tables.Exam![0]!.row.replace('Before','Different');
   await expect(restore(await seal(another),false,operationId)).rejects.toThrow('DEVICE_EXISTING_RECEIPT_MISMATCH');
   await admin.query('UPDATE "Exam" SET title=\'Changed\' WHERE id=$1',[tenantId+'-exam']);
   await expect(restore(file,false,operationId)).rejects.toThrow('DEVICE_EXISTING_RECEIPT_STATE_CHANGED');
   expect(await snapshot()).toEqual(dirty);

   expect(await restore(file)).toMatchObject({databaseRowsRestored:true,mutations:1,protectedRowsUnchanged:true,canRestore:false});
   expect(await snapshot()).toEqual(initial);
   expect(await restore(file)).toMatchObject({mutations:0});
   await admin.query('INSERT INTO "Exam" (id,"tenantId",title,"updatedAt") VALUES ($1,$2,\'Remove\',now())',[tenantId+'-extra',tenantId]);
   await admin.query('DELETE FROM "Exam" WHERE id=$1',[tenantId+'-exam']);
   expect(await restore(file)).toMatchObject({mutations:2});expect(await snapshot()).toEqual(initial);
   // A real DB-side unexpected write to protected identity data must roll back the entire restore.
   await admin.query(`CREATE FUNCTION public.device_existing_test_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE "User" SET name='trigger changed' WHERE "tenantId"=NEW."tenantId"; RETURN NEW; END $$; CREATE TRIGGER device_existing_test AFTER UPDATE ON "Exam" FOR EACH ROW EXECUTE FUNCTION public.device_existing_test_trigger()`);
   const changed=structuredClone(initial);changed.tables.Exam![0]!.row=changed.tables.Exam![0]!.row.replace('Before','After');
   await expect(restore(await seal(changed))).rejects.toThrow('DEVICE_EXISTING_PROTECTED_ROWS_CHANGED');
   expect(await snapshot()).toEqual(initial);
   await admin.query('DROP TRIGGER device_existing_test ON "Exam"; DROP FUNCTION public.device_existing_test_trigger()');
   expect((await admin.query('SELECT title FROM "Exam" WHERE "tenantId"=$1',[other])).rows).toEqual([{title:'Before'}]);
   const collision=structuredClone(initial);collision.tables.Exam![0]!.row=collision.tables.Exam![0]!.row.replace(tenantId+'-exam',other+'-exam');
   await expect(restore(await seal(collision))).rejects.toThrow();
   expect(await snapshot()).toEqual(initial);
   expect((await admin.query('SELECT title FROM "Exam" WHERE "tenantId"=$1',[other])).rows).toEqual([{title:'Before'}]);
   await admin.query('UPDATE "User" SET "accountStatus"=\'ACTIVE\' WHERE "tenantId"=$1',[tenantId]);
   await expect(restore(file)).rejects.toThrow('DEVICE_EXISTING_ACTIVE_IDENTITY');
  }finally{await Promise.all([admin.end(),app.end()]);}
 },60000);
});
