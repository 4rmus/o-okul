"use client";

import { useId, type FormEvent, type ReactNode } from "react";
import { Alert } from "./alert.js";
import { Button } from "./button.js";
import { Dialog, type DialogProps } from "./dialog.js";

export interface FormModalProps extends Omit<DialogProps, "footer" | "onSubmit"> {
  cancelLabel?: ReactNode;
  children: ReactNode;
  submitDisabled?: boolean;
  submitError?: ReactNode;
  submitLabel?: ReactNode;
  submitting?: boolean;
  onCancel(): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}

export function FormModal({
  cancelLabel = "Vazgeç",
  children,
  onCancel,
  onSubmit,
  submitDisabled = false,
  submitError,
  submitLabel = "Kaydet",
  submitting = false,
  ...props
}: FormModalProps) {
  const formId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitting || submitDisabled) {
      event.preventDefault();
      return;
    }
    onSubmit(event);
  }

  return (
    <Dialog
      {...props}
      onClose={submitting ? undefined : onCancel}
      footer={
        <div className="uh-form-modal__footer">
          <Button disabled={submitting} onClick={onCancel} type="button" variant="secondary">
            {cancelLabel}
          </Button>
          <Button disabled={submitDisabled} form={formId} loading={submitting} type="submit">
            {submitLabel}
          </Button>
        </div>
      }
    >
      <form aria-busy={submitting || undefined} className="uh-form-modal__form" id={formId} onSubmit={handleSubmit}>
        {submitError ? <Alert tone="danger">{submitError}</Alert> : null}
        {children}
      </form>
    </Dialog>
  );
}
