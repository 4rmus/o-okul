import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> {
  className?: string;
  description?: ReactNode;
  invalid?: boolean;
  inputClassName?: string;
  label: ReactNode;
  loading?: boolean;
}

export function Checkbox({
  className,
  description,
  disabled,
  invalid = false,
  inputClassName,
  label,
  loading = false,
  ...props
}: CheckboxProps) {
  const descriptionId = useId();
  const describedBy = [props["aria-describedby"], description ? descriptionId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <label className={classNames("uh-checkbox", (disabled || loading) && "uh-checkbox--disabled", invalid && "uh-checkbox--invalid", className)}>
      <input
        {...props}
        aria-busy={loading || props["aria-busy"] || undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || props["aria-invalid"] || undefined}
        className={classNames("uh-checkbox__input", inputClassName)}
        disabled={disabled || loading}
        type="checkbox"
      />
      <span className="uh-checkbox__content">
        <span className="uh-checkbox__label">{label}</span>
        {description ? (
          <span className="uh-checkbox__description" id={descriptionId}>
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
