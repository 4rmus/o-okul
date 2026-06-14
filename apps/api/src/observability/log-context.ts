import { AsyncLocalStorage } from "node:async_hooks";

export interface ApiLogContext {
  requestId: string;
  tenantId?: string | null;
  userId?: string;
}

const storage = new AsyncLocalStorage<ApiLogContext>();

export function runWithApiLogContext<T>(context: ApiLogContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function getApiLogContext(): ApiLogContext | undefined {
  return storage.getStore();
}

export function setApiLogContext(values: Partial<ApiLogContext>): void {
  const context = storage.getStore();
  if (!context) return;
  Object.assign(context, values);
}
