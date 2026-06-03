"use client";

import type { FormEvent, ReactNode } from "react";
import { Button } from "./button.js";
import { Dialog, type DialogProps } from "./dialog.js";

export interface FormModalProps extends Omit<DialogProps, "footer" | "onSubmit"> {
  cancelLabel?: ReactNode;
  children: ReactNode;
  submitLabel?: ReactNode;
  onCancel(): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}

export function FormModal({
  cancelLabel = "Vazgeç",
  children,
  onCancel,
  onSubmit,
  submitLabel = "Kaydet",
  ...props
}: FormModalProps) {
  return (
    <Dialog
      {...props}
      onClose={onCancel}
      footer={
        <div className="uh-form-modal__footer">
          <Button onClick={onCancel} type="button" variant="secondary">
            {cancelLabel}
          </Button>
          <Button type="submit" form="uh-form-modal-form">
            {submitLabel}
          </Button>
        </div>
      }
    >
      <form className="uh-form-modal__form" id="uh-form-modal-form" onSubmit={onSubmit}>
        {children}
      </form>
    </Dialog>
  );
}
