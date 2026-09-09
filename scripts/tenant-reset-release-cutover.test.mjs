import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(new URL("../.github/workflows/staging-deploy.yml", import.meta.url), "utf8");
const cutover = workflow.split("          # BEGIN LIFECYCLE RELEASE CUTOVER\n")[1].split("          # END LIFECYCLE RELEASE CUTOVER")[0].replace(/^ {10}/gm, "");
const mockDocker = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2), fail = process.env.FAIL_AT;
let phase;
if (args.includes('ps')) {
  if (args.includes('--all')) console.log(['a','b','c'].map(x => x.repeat(64)).join('\\n'));
  else if (fail === 'state-query') process.exit(1);
  else if (fail === 'restarted') console.log('a'.repeat(64));
} else if (args.includes('inspect')) {
  const service = {a:'api',b:'queue-board',c:'worker'}[args.at(-1)[0]];
  console.log(service + (service === 'worker' && fail === 'worker-137' ? ' false false 137' : service === 'worker' && fail === 'worker-oom' ? ' false true 0' : ' false false 0'));
} else if (args.includes('stop')) phase = args.includes('worker') ? 'stop-worker' : 'stop-producers';
else if (args.join(' ').includes('prisma migrate deploy')) phase = 'migration';
else if (args.includes('scripts/backfill-account-management.mjs')) phase = 'account';
else if (args.includes('scripts/backfill-license-terms.mjs')) phase = 'license';
else if (args.includes('up') && args.includes('--remove-orphans')) phase = 'start';
else if (args.includes('/docker-entrypoint-initdb.d/006_bootstrap_device_restore_worker_role.sh')) phase = 'device-bootstrap';
else if (args.includes('exec')) phase = 'bootstrap';
if (phase) {
  fs.appendFileSync(process.env.TRACE, phase + '\\n');
  if (phase === fail) process.exit(1);
}
`;

for (const failure of ["", "stop-producers", "stop-worker", "worker-137", "worker-oom", "restarted", "state-query", "device-bootstrap", "migration", "account", "license"]) {
  test(`release cutover ${failure || "success"} never restarts after an unsafe stop or failed migration/backfill`, () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "o-okul-cutover-contract-")));
    try {
      const bin = join(directory, "bin"); mkdirSync(bin);
      const docker = join(bin, "docker"), dockerMock = join(bin, "docker.cjs");
      writeFileSync(dockerMock, mockDocker);
      writeFileSync(docker, `#!/bin/sh\nexec '${process.execPath}' -- '${dockerMock}' "$@"\n`); chmodSync(docker, 0o700);
      // Linux realpath -e semantics on macOS as well: target must exist.
      const realpath = join(bin, "realpath");
      writeFileSync(realpath, `#!${process.execPath}\nconsole.log(require('node:fs').realpathSync(process.argv.at(-1)));\n`); chmodSync(realpath, 0o700);
      const reports = join(directory, "artifacts/staging/reports"); mkdirSync(reports, { recursive: true });
      const stale = join(reports, "deployment-cutover.json"); writeFileSync(stale, '{"status":"PASS"}');
      const trace = join(directory, "trace"); writeFileSync(trace, "");
      const result = spawnSync("bash", ["-c", `set -euo pipefail\n${cutover}`], {
        cwd: directory, encoding: "utf8",
        env: { PATH: `${bin}:${process.env.PATH}`, STAGING_DEPLOY_DIR: directory, IMAGE_TAG: "synthetic", release_env_file: ".env.release.next", EDGE_COMPOSE_FILE: "docker-compose.traefik.yml", FAIL_AT: failure, TRACE: trace },
      });
      const phases = readFileSync(trace, "utf8").trim().split("\n");
      assert.equal(existsSync(stale), false, `stale public PASS must disappear before mutation: ${result.stderr}`);
      assert.equal(result.status === 0, failure === "", result.stderr);
      if (!failure) assert.deepEqual(phases, ["stop-producers", "stop-worker", "bootstrap", "bootstrap", "bootstrap", "device-bootstrap", "migration", "account", "license", "start"]);
      else {
        assert.equal(phases.includes("start"), false);
        if (["stop-producers", "stop-worker", "device-bootstrap", "migration", "account", "license"].includes(failure)) assert.ok(phases.includes(failure), "must reach the injected failure");
        if (!["migration", "account", "license"].includes(failure)) assert.equal(phases.includes("migration"), false);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
