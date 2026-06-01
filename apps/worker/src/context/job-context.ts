import { AsyncLocalStorage } from "node:async_hooks";

export interface JobContext {
  tenantId: string;
  userId: string;
  jobId: string;
}

const storage = new AsyncLocalStorage<JobContext>();

export function runWithJobContext<T>(context: JobContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function getJobContext(): JobContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error("JOB_CONTEXT_MISSING");
  }
  return context;
}

export function requireJobTenantContext(): JobContext {
  const context = getJobContext();
  if (!context.tenantId || !context.userId) {
    throw new Error("JOB_CONTEXT_MISSING");
  }
  return context;
}
