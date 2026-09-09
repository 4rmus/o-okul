import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validateTarget,validateContext,validateContainer} from './tenant-reset-postgres-drill.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile);
const options={context:'colima-o-okul-reset-drill',socket:homedir()+'/.colima/o-okul-reset-drill/docker.sock'};
const withObjects=process.argv[3]==='--with-objects';
if (![3,4].includes(process.argv.length) || process.argv[2]!=='--execute' || (process.argv.length===4&&!withObjects)) throw new Error('LOCAL_DRILL_EXECUTE_REQUIRED');
validateTarget(options);
const cmd=async(args,env={})=>(await exec(args[0],args.slice(1),{cwd:root,env:{...process.env,...env},maxBuffer:8*1024**2})).stdout.trim();
const docker=(...args)=>cmd(['docker','--context',options.context,...args]);
validateContext(JSON.parse(await docker('context','inspect',options.context))[0],options);
const image=JSON.parse(await docker('image','inspect','postgres:16'))[0];
const nonce=randomBytes(12).toString('hex'),password=randomBytes(24).toString('hex');
const owned={nonce,name:'device-existing-'+nonce,imageId:image.Id,id:''};
const directory=root+'artifacts/device-existing-restore';await mkdir(directory,{recursive:true});
try{const prior=JSON.parse(await readFile(directory+'/result.json','utf8'));const saved=directory+'/'+prior.container.nonce;await mkdir(saved,{recursive:true});for(const file of ['result.json','tests.log','failure.log'])try{await writeFile(saved+'/'+file,await readFile(directory+'/'+file));}catch(e){if(e.code!=='ENOENT')throw e;}}catch(e){if(e.code!=='ENOENT')throw e;}
const sourcePaths=(await cmd(['rg','--files','apps/api/src','packages/db/src','packages/shared-types/src','packages/db/prisma/migrations','docker/postgres/init'])).split('\n').concat(['scripts/tenant-device-existing-drill.mjs','pnpm-lock.yaml']).sort();
const sourceHash=async()=>{const hash=createHash('sha256');for(const path of sourcePaths)hash.update(path).update(await readFile(root+path));return hash.digest('hex');};
const result={status:'FAIL',evidenceClass:'LOCAL_RUNTIME_POSTGRES_MINIO_REDIS',productionEnabled:false,sourceDigest:await sourceHash()};
let pool, storage, redis;
const storageEnv={};
async function validateStorage(){
 const c=JSON.parse(await docker('inspect',storage.id))[0];
 assert.equal(c.Id,storage.id);assert.equal(c.Name,'/'+storage.name);assert.equal(c.Image,storage.imageId);assert.equal(c.Config.Labels['com.o-okul.device-existing-drill'],nonce);
 assert.equal(c.HostConfig.Privileged,false);assert.equal(c.HostConfig.ReadonlyRootfs,true);assert.ok(c.HostConfig.Tmpfs['/data']);assert.ok(c.Mounts.every(m=>m.Type==='tmpfs'));
 const ports=c.NetworkSettings.Ports['9000/tcp'];assert.equal(ports.length,1);assert.equal(ports[0].HostIp,'127.0.0.1');assert.ok(Number(ports[0].HostPort)>=1024);return Number(ports[0].HostPort);
}
try{
 owned.id=await cmd(['docker','--context',options.context,'run','-d','--pull=never','--name',owned.name,'--label','com.o-okul.tenant-reset-drill='+nonce,'--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=512m','--memory','768m','--cpus','2','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=o_okul_reset_drill','postgres:16'],{POSTGRES_PASSWORD:password});
 const port=validateContainer(JSON.parse(await docker('inspect',owned.id))[0],owned);
 const require=createRequire(root+'packages/db/package.json');const pg=require('pg');
 pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'o_okul_reset_drill',max:1,connectionTimeoutMillis:2000});
 for(let i=0;i<40;i++){try{await pool.query('SELECT 1');break;}catch(e){if(i===39)throw e;await new Promise(r=>setTimeout(r,250));}}
 await pool.query(`CREATE ROLE app LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS; CREATE ROLE secret_delivery_worker NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE o_okul_reset_worker NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT; CREATE ROLE o_okul_device_restore_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT; CREATE ROLE migration LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS; GRANT CONNECT ON DATABASE o_okul_reset_drill TO migration; CREATE SCHEMA device_existing_restore AUTHORIZATION migration; ALTER SCHEMA public OWNER TO migration; CREATE EXTENSION pg_trgm; CREATE EXTENSION btree_gist`);
 assert.equal((await pool.query("SELECT has_database_privilege('migration',current_database(),'CREATE') AS allowed")).rows[0].allowed,false);result.migratorDatabaseCreate=false;
 const config=directory+'/prisma.config.mjs';
 await writeFile(config,`import {defineConfig} from ${JSON.stringify(pathToFileURL(require.resolve('prisma/config')).href)}; export default defineConfig({schema:${JSON.stringify(root+'packages/db/prisma/schema.prisma')},migrations:{path:${JSON.stringify(root+'packages/db/prisma/migrations')}},datasource:{url:process.env.DRILL_DATABASE_URL}});`);
 await cmd(['pnpm','--filter','@o-okul/db','exec','prisma','migrate','deploy','--config',config],{DRILL_DATABASE_URL:`postgresql://migration:${password}@127.0.0.1:${port}/o_okul_reset_drill`});
 await pool.query('REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON "PlatformAccount","PlatformSession","PlatformIdempotencyKey" FROM app');
 if(withObjects){
  const image='minio/minio:RELEASE.2025-09-07T16-13-09Z';
  storage={name:'device-existing-objects-'+nonce,imageId:JSON.parse(await docker('image','inspect',image))[0].Id};
  storage.id=await cmd(['docker','--context',options.context,'run','-d','--pull=never','--name',storage.name,'--label','com.o-okul.device-existing-drill='+nonce,'--publish','127.0.0.1::9000','--read-only','--tmpfs','/data:rw,noexec,nosuid,size=128m','--tmpfs','/tmp:rw,nosuid,size=16m','--memory','512m','--cpus','1','--env','MINIO_ROOT_USER=fixture','--env','MINIO_ROOT_PASSWORD',image,'server','/data','--console-address',':9001'],{MINIO_ROOT_PASSWORD:password});
  const endpoint='http://127.0.0.1:'+await validateStorage();
  for(let i=0;i<40;i++){try{if((await fetch(endpoint+'/minio/health/live',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}if(i===39)throw new Error('MINIO_NOT_READY');await new Promise(r=>setTimeout(r,250));}
  redis={nonce,name:'device-existing-redis-'+nonce,image:'redis:7',imageId:JSON.parse(await docker('image','inspect','redis:7'))[0].Id};
  redis.id=await cmd(['docker','--context',options.context,'run','-d','--pull=never','--name',redis.name,'--label','com.o-okul.tenant-reset-drill='+nonce,'--publish','127.0.0.1::6379','--tmpfs','/data:rw,noexec,nosuid,size=64m','--memory','128m','--env','DEVICE_REDIS_PASSWORD','redis:7','sh','-c','exec redis-server --save "" --appendonly no --requirepass "$DEVICE_REDIS_PASSWORD"'],{DEVICE_REDIS_PASSWORD:password});
  const redisPort=validateContainer(JSON.parse(await docker('inspect',redis.id))[0],redis);
  storageEnv.DEVICE_EXISTING_REDIS_URL=`redis://:${password}@127.0.0.1:${redisPort}`;
  Object.assign(storageEnv,{DEVICE_EXISTING_OBJECT_ENDPOINT:endpoint,DEVICE_EXISTING_OBJECT_ACCESS_KEY:'fixture',DEVICE_EXISTING_OBJECT_SECRET_KEY:password,DEVICE_EXISTING_OBJECTS_REQUIRED:'1'});
 }
 await pool.query(`ALTER ROLE o_okul_device_restore_worker LOGIN PASSWORD '${password}'`);
 result.migrations=Number((await pool.query('SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).rows[0].n);
 const log=await cmd(['pnpm','--filter','@o-okul/api','exec','vitest','run','src/operations/device-backup-existing-drill.test.ts','src/operations/device-backup-impact.test.ts',...(withObjects?['src/operations/device-backup-existing-objects.test.ts','src/operations/device-restore.postgres.test.ts']:[]),'--no-file-parallelism'],{...storageEnv,DEVICE_EXISTING_CUSTODY_URL:`postgresql://app:${password}@127.0.0.1:${port}/o_okul_reset_drill`,DEVICE_EXISTING_APP_URL:`postgresql://o_okul_device_restore_worker:${password}@127.0.0.1:${port}/o_okul_reset_drill`,DEVICE_EXISTING_ADMIN_URL:`postgresql://postgres:${password}@127.0.0.1:${port}/o_okul_reset_drill`,DEVICE_EXISTING_REQUIRED:'1'});
 await writeFile(directory+'/tests.log',log.replaceAll(password,'[REDACTED]'));assert.equal(await sourceHash(),result.sourceDigest,'SOURCE_CHANGED_DURING_DRILL');result.status='PASS';
}catch(e){await writeFile(directory+'/failure.log',(String(e.stdout??'')+String(e.stderr??'')+String(e.message??'')).replaceAll(password,'[REDACTED]'));throw e;}
finally{
 await pool?.end();
 if(redis?.id&&result.status==='PASS'){validateContainer(JSON.parse(await docker('inspect',redis.id))[0],redis);await docker('rm','--force',redis.id);result.redisCleanup='OWNED_CONTAINER_REMOVED';}
 if(storage?.id&&result.status==='PASS'){await validateStorage();await docker('rm','--force',storage.id);result.storageCleanup='OWNED_CONTAINER_REMOVED';}
 if(owned.id && result.status==='PASS'){validateContainer(JSON.parse(await docker('inspect',owned.id))[0],owned);await docker('rm','--force',owned.id);result.cleanup='OWNED_CONTAINER_REMOVED';}
 else result.cleanup='RETAINED_FOR_REVIEW';
 result.container=owned;await writeFile(directory+'/result.json',JSON.stringify(result,null,2)+'\n');
}
console.log(JSON.stringify(result));
