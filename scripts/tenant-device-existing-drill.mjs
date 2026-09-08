import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validateTarget,validateContext,validateContainer} from './tenant-reset-postgres-drill.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile);
const options={context:'colima-o-okul-reset-drill',socket:homedir()+'/.colima/o-okul-reset-drill/docker.sock'};
if (process.argv.length!==3 || process.argv[2]!=='--execute') throw new Error('LOCAL_DRILL_EXECUTE_REQUIRED');
validateTarget(options);
const cmd=async(args,env={})=>(await exec(args[0],args.slice(1),{cwd:root,env:{...process.env,...env},maxBuffer:8*1024**2})).stdout.trim();
const docker=(...args)=>cmd(['docker','--context',options.context,...args]);
validateContext(JSON.parse(await docker('context','inspect',options.context))[0],options);
const image=JSON.parse(await docker('image','inspect','postgres:16'))[0];
const nonce=randomBytes(12).toString('hex'),password=randomBytes(24).toString('hex');
const owned={nonce,name:'device-existing-'+nonce,imageId:image.Id,id:''};
const directory=root+'artifacts/device-existing-restore';await mkdir(directory,{recursive:true});
const result={status:'FAIL',evidenceClass:'LOCAL_RUNTIME_POSTGRES',productionEnabled:false};
let pool;
try{
 owned.id=await cmd(['docker','--context',options.context,'run','-d','--pull=never','--name',owned.name,'--label','com.o-okul.tenant-reset-drill='+nonce,'--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=512m','--memory','768m','--cpus','2','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=o_okul_reset_drill','postgres:16'],{POSTGRES_PASSWORD:password});
 const port=validateContainer(JSON.parse(await docker('inspect',owned.id))[0],owned);
 const require=createRequire(root+'packages/db/package.json');const pg=require('pg');
 pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database:'o_okul_reset_drill',max:1,connectionTimeoutMillis:2000});
 for(let i=0;i<40;i++){try{await pool.query('SELECT 1');break;}catch(e){if(i===39)throw e;await new Promise(r=>setTimeout(r,250));}}
 await pool.query(`CREATE ROLE app LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS; CREATE ROLE secret_delivery_worker NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE o_okul_reset_worker NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT; CREATE ROLE migration LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS; GRANT CONNECT,CREATE ON DATABASE o_okul_reset_drill TO migration; ALTER SCHEMA public OWNER TO migration; CREATE EXTENSION pg_trgm; CREATE EXTENSION btree_gist`);
 const config=directory+'/prisma.config.mjs';
 await writeFile(config,`import {defineConfig} from ${JSON.stringify(pathToFileURL(require.resolve('prisma/config')).href)}; export default defineConfig({schema:${JSON.stringify(root+'packages/db/prisma/schema.prisma')},migrations:{path:${JSON.stringify(root+'packages/db/prisma/migrations')}},datasource:{url:process.env.DRILL_DATABASE_URL}});`);
 await cmd(['pnpm','--filter','@o-okul/db','exec','prisma','migrate','deploy','--config',config],{DRILL_DATABASE_URL:`postgresql://migration:${password}@127.0.0.1:${port}/o_okul_reset_drill`});
 await pool.query('REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON "PlatformAccount","PlatformSession","PlatformIdempotencyKey" FROM app');
 await pool.query(`CREATE SCHEMA device_existing_restore; CREATE TABLE device_existing_restore.receipts (operation_id text PRIMARY KEY CHECK(operation_id ~ '^[a-f0-9]{32}$'),tenant_id text NOT NULL,archive_digest text NOT NULL CHECK(archive_digest ~ '^[a-f0-9]{64}$'),schema_digest text NOT NULL,result_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()); ALTER TABLE device_existing_restore.receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE device_existing_restore.receipts FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_receipt ON device_existing_restore.receipts USING (tenant_id=current_setting('app.current_tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.current_tenant_id',true)); GRANT USAGE ON SCHEMA device_existing_restore TO app; GRANT SELECT,INSERT ON device_existing_restore.receipts TO app`);
 result.migrations=Number((await pool.query('SELECT count(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).rows[0].n);
 const log=await cmd(['pnpm','--filter','@o-okul/api','exec','vitest','run','src/operations/device-backup-existing-drill.test.ts','src/operations/device-backup-impact.test.ts'],{DEVICE_EXISTING_APP_URL:`postgresql://app:${password}@127.0.0.1:${port}/o_okul_reset_drill`,DEVICE_EXISTING_ADMIN_URL:`postgresql://postgres:${password}@127.0.0.1:${port}/o_okul_reset_drill`,DEVICE_EXISTING_REQUIRED:'1'});
 await writeFile(directory+'/tests.log',log.replaceAll(password,'[REDACTED]'));result.status='PASS';
}catch(e){await writeFile(directory+'/failure.log',(String(e.stdout??'')+String(e.stderr??'')+String(e.message??'')).replaceAll(password,'[REDACTED]'));throw e;}
finally{
 await pool?.end();
 if(owned.id && result.status==='PASS'){validateContainer(JSON.parse(await docker('inspect',owned.id))[0],owned);await docker('rm','--force',owned.id);result.cleanup='OWNED_CONTAINER_REMOVED';}
 else result.cleanup='RETAINED_FOR_REVIEW';
 result.container=owned;await writeFile(directory+'/result.json',JSON.stringify(result,null,2)+'\n');
}
console.log(JSON.stringify(result));
