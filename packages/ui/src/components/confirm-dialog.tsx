"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./button.js";
import { Dialog, type DialogProps } from "./dialog.js";

export interface ConfirmDialogProps extends Omit<DialogProps, "children" | "footer"> {
  cancelLabel?: ReactNode;
  confirmLabel?: ReactNode;
  confirmVariant?: "primary" | "danger";
  loading?: boolean;
  message?: ReactNode;
  onCancel(): void;
  onConfirm(): void;
}

export interface ConfirmDialogRequest {
  cancelLabel?: ReactNode;
  confirmLabel?: ReactNode;
  confirmVariant?: "primary" | "danger";
  description?: ReactNode;
  message?: ReactNode;
  title: ReactNode;
}

interface PendingConfirmDialog extends ConfirmDialogRequest {
  resolve(value: boolean): void;
}

export function ConfirmDialog({
  cancelLabel = "Vazgeç",
  confirmLabel = "Onayla",
  confirmVariant = "danger",
  loading = false,
  message,
  onCancel,
  onConfirm,
  ...props
}: ConfirmDialogProps) {
  return (
    <Dialog
      {...props}
      onClose={loading ? undefined : onCancel}
      footer={
        <div className="uh-form-modal__footer">
          <Button disabled={loading} onClick={onCancel} type="button" variant="secondary">
            {cancelLabel}
          </Button>
          <Button disabled={loading} onClick={onConfirm} type="button" variant={confirmVariant}>
            {loading ? "İşleniyor..." : confirmLabel}
          </Button>
        </div>
      }
    >
      {message ? <p>{message}</p> : null}
    </Dialog>
  );
}

export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirmDialog | null>(null);
  const pendingRef = useRef<PendingConfirmDialog | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    return () => {
      pendingRef.current?.resolve(false);
    };
  }, []);

  const close = useCallback((result: boolean) => {
    setPending((current) => {
      const pendingConfirm = current ?? pendingRef.current;
      pendingRef.current = null;
      pendingConfirm?.resolve(result);
      return null;
    });
  }, []);

  const confirm = useCallback((request: ConfirmDialogRequest) => {
    return new Promise<boolean>((resolve) => {
      setPending((current) => {
        current?.resolve(false);
        const next = { ...request, resolve };
        pendingRef.current = next;
        return next;
      });
    });
  }, []);

  const confirmationDialog = pending ? (
    <ConfirmDialog
      cancelLabel={pending.cancelLabel}
      confirmLabel={pending.confirmLabel}
      confirmVariant={pending.confirmVariant}
      description={pending.description}
      message={pending.message}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
      open
      title={pending.title}
    />
  ) : null;

  return { confirm, confirmationDialog };
}
