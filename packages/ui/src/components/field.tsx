import type { LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { classNames } from "../class-names.js";

export interface FieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  description?: ReactNode;
  error?: ReactNode;
  label: ReactNode;
}

export function Field({ children, className, description, error, label, ...props }: FieldProps) {
  return (
    <label {...props} className={classNames("uh-field", Boolean(error) && "uh-field--invalid", className)}>
      <span className="uh-field__label">{label}</span>
      {children}
      {description ? <span className="uh-field__description">{description}</span> : null}
      {error ? <span className="uh-field__error">{error}</span> : null}
    </label>
  );
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  return <select {...props} className={classNames("uh-select", className)} />;
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps) {
  return <textarea {...props} className={classNames("uh-textarea", className)} />;
}
