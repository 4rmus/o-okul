import { createPublicKey } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { resetS3Config } from "@o-okul/db";
import { deviceBackupKeyId } from "./device-backup-archive.js";
import { runDeviceRestoreWorkerOnce } from "./device-restore-worker.js";

// Dedicated process from the API image reuses the archive/DB code without starting an HTTP server.
const databaseUrl=process.env.TENANT_DEVICE_RESTORE_DATABASE_URL,tenantId=process.env.TENANT_DEVICE_RESTORE_TENANT_ID;
const custodyKey=Buffer.from(process.env.TENANT_DEVICE_RESTORE_CUSTODY_KEY??"","base64");
if(process.env.TENANT_DEVICE_RESTORE_ENABLED!=="1" || !databaseUrl || !tenantId || custodyKey.length!==32 || new URL(databaseUrl).username!=="o_okul_device_restore_worker")throw new Error("DEVICE_RESTORE_WORKER_CONFIG_REQUIRED");
const publicKeys:unknown=JSON.parse(process.env.TENANT_DEVICE_BACKUP_TRUSTED_PUBLIC_KEYS??"[]");
if(!Array.isArray(publicKeys)||!publicKeys.length||publicKeys.length>16||publicKeys.some(k=>typeof k!=="string"))throw new Error("DEVICE_RESTORE_TRUSTED_KEYS_REQUIRED");
const trustedKeys=new Map(publicKeys.map(pem=>{const key=createPublicKey(pem);return [deviceBackupKeyId(key),key];}));
const config={databaseUrl,tenantId,custodyKey,trustedKeys,objects:resetS3Config()};
let stopping=false;
const controller=new AbortController();
for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,()=>{stopping=true;controller.abort();});
async function main(){try {
  while(!stopping){
    try {const result=await runDeviceRestoreWorkerOnce(config);if(result.state!=="IDLE")console.log(JSON.stringify({worker:"device-restore",state:result.state,operationId:"operationId" in result?result.operationId:undefined}));}
    catch(error){const code=error instanceof Error&&/^DEVICE_[A-Z_]+$/.test(error.message)?error.message:"DEVICE_RESTORE_EXECUTION_FAILED";console.error(JSON.stringify({worker:"device-restore",errorCode:code}));}
    if(!stopping)try{await delay(5000,undefined,{signal:controller.signal});}catch{if(!stopping)throw new Error("DEVICE_RESTORE_POLL_FAILED");}
  }
} finally {custodyKey.fill(0);}}
void main().catch(()=>{console.error("DEVICE_RESTORE_WORKER_FAILED");process.exitCode=1;});
