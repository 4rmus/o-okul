import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { classNames } from "../class-names.js";

export interface FieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  description?: ReactNode;
  error?: ReactNode;
  label: ReactNode;
  success?: ReactNode;
}

export function Field({ children, className, description, error, label, success, ...props }: FieldProps) {
  const generatedControlId = useId();
  const messageId = useId();
  const hasError = error !== null && error !== undefined;
  const hasSuccess = !hasError && success !== null && success !== undefined;
  const message = error ?? success ?? description;
  const childArray = Children.toArray(children);
  const onlyChild =
    childArray.length === 1 && isValidElement<Record<string, unknown>>(childArray[0]) && isControlElement(childArray[0])
      ? childArray[0]
      : null;
  const control = onlyChild
    ? enhanceControl(onlyChild, {
        controlId: generatedControlId,
        describedById: message !== null && message !== undefined ? messageId : undefined,
        invalid: hasError,
      })
    : children;

  return (
    <label {...props} className={classNames("uh-field", hasError && "uh-field--invalid", className)}>
      <span className="uh-field__label">{label}</span>
      {control}
      <span
        className={classNames(
          "uh-field__message",
          hasError ? "uh-field__error" : hasSuccess ? "uh-field__success" : "uh-field__description",
        )}
        id={messageId}
      >
        {message}
      </span>
    </label>
  );
}

interface ControlStateProps {
  invalid?: boolean;
  loading?: boolean;
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & ControlStateProps;

export function Select({ className, invalid = false, loading = false, ...props }: SelectProps) {
  return (
    <select
      {...props}
      aria-busy={loading || props["aria-busy"] || undefined}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={classNames("uh-select", invalid && "uh-select--invalid", className)}
      disabled={props.disabled || loading}
    />
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & ControlStateProps;

export function Textarea({ className, invalid = false, loading = false, ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      aria-busy={loading || props["aria-busy"] || undefined}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={classNames("uh-textarea", invalid && "uh-textarea--invalid", className)}
      disabled={props.disabled || loading}
    />
  );
}

function enhanceControl(
  control: ReactElement<Record<string, unknown>>,
  { controlId, describedById, invalid }: { controlId: string; describedById?: string; invalid: boolean },
) {
  const id = typeof control.props.id === "string" ? control.props.id : controlId;
  const describedBy = [control.props["aria-describedby"], describedById].filter(Boolean).join(" ") || undefined;

  return cloneElement(control, {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || control.props["aria-invalid"] || undefined,
  });
}

function isControlElement(control: ReactElement<Record<string, unknown>>) {
  return typeof control.type !== "string" || ["input", "select", "textarea"].includes(control.type);
}
