// `pnpm run ci` is one flat chain for local parity; .github/workflows/ci.yml runs it as these parallel partitions.
// scripts/check-ci-partitions.mjs keeps the union of the partitions equal to the `ci` chain.
export const CI_COMMAND = "pnpm run ci";
export const CI_PARTITION_SCRIPTS = ["ci:static", "ci:unit", "ci:e2e:contract", "ci:e2e:visual"];
export const CI_PARTITION_STEPS = CI_PARTITION_SCRIPTS.map((script) => `pnpm ${script}`);

export function splitScriptChain(value) {
  return (value ?? "")
    .split("&&")
    .map((command) => command.trim())
    .filter((command) => command !== "");
}

// The CI command passed when one job ran it whole, or when every partition passed in the run's jobs.
export function ciCommandPassedInJobs(jobs) {
  const stepsPassed = new Set(
    (Array.isArray(jobs) ? jobs : []).flatMap((job) => (Array.isArray(job?.stepsPassed) ? job.stepsPassed : [])),
  );
  return stepsPassed.has(CI_COMMAND) || CI_PARTITION_STEPS.every((step) => stepsPassed.has(step));
}
