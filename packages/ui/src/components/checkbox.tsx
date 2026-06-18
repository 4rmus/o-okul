import type { InputHTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> {
  className?: string;
  description?: ReactNode;
  inputClassName?: string;
  label: ReactNode;
}

export function Checkbox({ className, description, disabled, inputClassName, label, ...props }: CheckboxProps) {
  return (
    <label className={classNames("uh-checkbox", disabled && "uh-checkbox--disabled", className)}>
      <input {...props} className={classNames("uh-checkbox__input", inputClassName)} disabled={disabled} type="checkbox" />
      <span className="uh-checkbox__content">
        <span className="uh-checkbox__label">{label}</span>
        {description ? <span className="uh-checkbox__description">{description}</span> : null}
      </span>
    </label>
  );
}
