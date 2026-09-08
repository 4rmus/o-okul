import { describe, expect, it } from "vitest";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";
import { CreateBucketCommand, DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { readTenantBackupSchema, resetBytesHash, resetS3Client, withTenantDb } from "@o-okul/db";
import { deviceBackupKeyId, sealDeviceBackup } from "./device-backup-archive.js";
import { projectDeviceBackup, validateDeviceBackupPayload } from "./device-backup.service.js";
import { collectExistingRestoreFiles, mapExistingRestorePhotos, readExistingRestoreFile } from "./device-backup-existing-objects.js";
import { restoreExistingDeviceBackupDrill } from "./device-backup-existing-drill.js";

const url = process.env.DEVICE_EXISTING_APP_URL, adminUrl = process.env.DEVICE_EXISTING_ADMIN_URL;
const endpoint = process.env.DEVICE_EXISTING_OBJECT_ENDPOINT;
if (process.env.DEVICE_EXISTING_OBJECTS_REQUIRED === "1" && (!url || !adminUrl || !endpoint)) throw new Error("DEVICE_EXISTING_OBJECT_TEST_CONFIG_REQUIRED");
(url && adminUrl && endpoint ? describe : describe.skip)("existing tenant DB and files recovery", () => {
  it("keeps the old state across process death, cleans only owned files, and reconciles committed DB plus bytes", async () => {
    for (const value of [url!,adminUrl!]) { const target = new URL(value); expect(target.hostname).toBe("127.0.0.1"); expect(target.pathname).toBe("/o_okul_reset_drill"); }
    const objects = { endpoint: endpoint!, bucket: "device-existing-"+randomBytes(12).toString("hex"), region: "us-east-1", accessKeyId: process.env.DEVICE_EXISTING_OBJECT_ACCESS_KEY!, secretAccessKey: process.env.DEVICE_EXISTING_OBJECT_SECRET_KEY! };
    const admin = new pg.Pool({connectionString:adminUrl}), app = new pg.Pool({connectionString:url}), s3 = resetS3Client(objects);
    const tenantId = "device-backup-"+randomUUID()+"-a", other = "device-backup-"+randomUUID()+"-a";
    const keys = generateKeyPairSync("ed25519"), password = "combined-restore-fixture-password";
    const old = Buffer.from("archived raw data"), next = Buffer.from("current raw data"), photo = Buffer.from("archived photo"), newPhoto = Buffer.from("current photo");
    const rawKey = (bytes: Buffer) => `raw-imports/${tenantId}/${tenantId}-exam/v1/${resetBytesHash(bytes)}/source`;
    const photoKey = `students/${tenantId}-student/photo.jpg`;
    const snapshot = () => withTenantDb(app,{tenantId,readOnly:true},async db => validateDeviceBackupPayload(await collectExistingRestoreFiles(await projectDeviceBackup(tenantId,await readTenantBackupSchema(db),db),s3,objects.bucket),tenantId));
    const list = async () => (await s3.send(new ListObjectsV2Command({Bucket:objects.bucket}))).Contents?.map(o=>o.Key).sort();
    const put = (key: string, bytes: Buffer) => s3.send(new PutObjectCommand({Bucket:objects.bucket,Key:key,Body:bytes}));
    try {
      await s3.send(new CreateBucketCommand({Bucket:objects.bucket}));
      for (const id of [tenantId,other]) {
        await admin.query('INSERT INTO "Tenant" (id,name,slug,status,"updatedAt") VALUES ($1,$1,$1,\'SUSPENDED\',now())',[id]);
        await admin.query('INSERT INTO "Exam" (id,"tenantId",title,"updatedAt") VALUES ($1,$2,\'Before\',now())',[id+"-exam",id]);
      }
      await admin.query('INSERT INTO "Student" (id,"tenantId","firstName","lastName","studentNo","photoKey","updatedAt") VALUES ($1,$2,\'Fixture\',\'Student\',\'1\',$3,now())',[tenantId+"-student",tenantId,photoKey]);
      await admin.query('INSERT INTO "RawImport" (id,"tenantId","examId","sourceType","fileName","s3Key",sha256,"parserConfigVersion",metadata,"updatedAt") VALUES ($1,$2,$3,\'TXT\',\'fixture.txt\',$4,$5,\'v1\',\'{"exact":123456789012345678.123456789}\'::jsonb,now())',[tenantId+"-raw",tenantId,tenantId+"-exam",rawKey(old),resetBytesHash(old)]);
      await put(rawKey(old),old); await put(photoKey,photo); await put(`raw-imports/${other}/control`,Buffer.from("other tenant"));
      const archive = await snapshot();
      const file = await sealDeviceBackup(Buffer.from(JSON.stringify(archive)),tenantId,password,keys.privateKey);
      const desired = await mapExistingRestorePhotos(archive,admin);
      await admin.query('UPDATE "RawImport" SET "s3Key"=$2,sha256=$3 WHERE id=$1',[tenantId+"-raw",rawKey(next),resetBytesHash(next)]);
      await admin.query('UPDATE "Exam" SET title=\'Changed\' WHERE id=$1',[tenantId+"-exam"]);
      await put(rawKey(next),next); await put(photoKey,newPhoto); await s3.send(new DeleteObjectCommand({Bucket:objects.bucket,Key:rawKey(old)}));
      const before = await snapshot(), initialKeys = await list();
      const input = {databaseUrl:url!,tenantId,file,password,trustedKeys:new Map([[deviceBackupKeyId(keys.publicKey),keys.publicKey]]),objects};
      const call = (operationId: string, extra = {}) => restoreExistingDeviceBackupDrill({...input,operationId,...extra});
      const kill = async (operationId: string, crash: string, recover = false) => {
        const child = spawn(process.execPath,["--input-type=module","-e",`import {createPublicKey} from 'node:crypto'; import {restoreExistingDeviceBackupDrill} from './dist/operations/device-backup-existing-drill.js'; let data='';for await(const c of process.stdin)data+=c;const i=JSON.parse(data);i.file=Buffer.from(i.file,'base64');i.trustedKeys=new Map([[i.keyId,createPublicKey(i.pem)]]);try{await restoreExistingDeviceBackupDrill(i);process.exitCode=3;}catch(e){console.error(e.message);process.exitCode=2;}`],{cwd:process.cwd(),stdio:["pipe","pipe","pipe"]});
        let error = ""; child.stderr.on("data",chunk=>error+=chunk);
        child.stdin.end(JSON.stringify({...input,file:file.toString("base64"),trustedKeys:undefined,operationId,crash,recover,keyId:deviceBackupKeyId(keys.publicKey),pem:keys.publicKey.export({type:"spki",format:"pem"})}));
        const exit = await new Promise<{code:number|null;signal:string|null}>((resolve,reject)=>{child.on("error",reject);child.on("close",(code,signal)=>resolve({code,signal}));});
        expect(exit,error).toEqual({code:null,signal:"SIGKILL"});
      };
      // An ordinary exception and two actual process deaths leave the original DB/files usable.
      for (const crash of [undefined,"after-first-put","before-commit"]) {
        const operationId = randomBytes(16).toString("hex");
        if (crash) await kill(operationId,crash); else await expect(call(operationId,{failBeforeCommit:true})).rejects.toThrow("DEVICE_EXISTING_INJECTED_FAILURE");
        expect(await snapshot()).toEqual(before);
        expect((await admin.query('SELECT count(*)::int AS n FROM device_existing_restore.receipts WHERE operation_id=$1',[operationId])).rows[0].n).toBe(0);
        await expect(call(randomBytes(16).toString("hex"))).rejects.toThrow("DEVICE_EXISTING_OTHER_OPERATION_UNRESOLVED");
        await expect(call(operationId,{objects:{...objects,bucket:"device-existing-"+"0".repeat(24)},recover:true})).rejects.toThrow("DEVICE_EXISTING_OBJECT_BINDING_MISMATCH");
        if (crash === "before-commit") await kill(operationId,"after-first-delete",true);
        expect(await call(operationId,{recover:true})).toMatchObject({aborted:true,objectStorageVerified:true});
        expect(await call(operationId,{recover:true})).toMatchObject({aborted:true});
        expect(await list()).toEqual(initialKeys); expect(await snapshot()).toEqual(before);
      }
      const operationId = randomBytes(16).toString("hex");
      await kill(operationId,"after-commit");
      expect(await call(operationId,{recover:true})).toMatchObject({replay:true,mutations:0,objectStorageVerified:true});
      const actual = await snapshot(); expect(actual.tables).toEqual(desired.tables);
      expect(actual.files.sort((a,b)=>a.key.localeCompare(b.key))).toEqual(desired.files.sort((a,b)=>a.key.localeCompare(b.key)));
      expect(actual.tables.RawImport![0]!.row).toContain("123456789012345678.123456789");
      expect((await readExistingRestoreFile(s3,objects.bucket,photoKey,100))!.bytes).toEqual(newPhoto);
      const committedKeys = await list();
      expect(await call(operationId)).toMatchObject({replay:true,mutations:0}); expect(await list()).toEqual(committedKeys);
      await put(rawKey(old),Buffer.from("tampered"));
      await expect(call(operationId,{recover:true})).rejects.toThrow();
      expect((await admin.query('SELECT title FROM "Exam" WHERE id=$1',[tenantId+"-exam"])).rows[0].title).toBe("Before");
      expect((await admin.query('SELECT title FROM "Exam" WHERE id=$1',[other+"-exam"])).rows[0].title).toBe("Before");
      expect((await readExistingRestoreFile(s3,objects.bucket,`raw-imports/${other}/control`,100))!.bytes.toString()).toBe("other tenant");
    } finally { s3.destroy(); await Promise.all([admin.end(),app.end()]); }
  },120000);
});
