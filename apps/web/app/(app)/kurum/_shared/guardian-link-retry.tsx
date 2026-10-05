import { Alert, Button } from "@o-okul/ui";
import { ApiRequestError } from "../../../../src/api-client.js";

/**
 * KV-3e: the API answers 409 GUARDIAN_LINK_CONCURRENT_UPDATE when a guardian link write lost a deadlock/serialization
 * race. Nothing was written and the Idempotency-Key was released, so resending the same request with the same key is safe.
 */
export function isGuardianLinkConcurrentUpdate(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409 && error.code === "GUARDIAN_LINK_CONCURRENT_UPDATE";
}

export function GuardianLinkRetryAlert({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <Alert tone="danger">
      <span>Aynı kayıt üzerinde eşzamanlı bir işlem vardı; değişiklik kaydedilmedi.</span>
      <Button disabled={retrying} size="sm" variant="secondary" onClick={onRetry}>
        Tekrar dene
      </Button>
    </Alert>
  );
}
