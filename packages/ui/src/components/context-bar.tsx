import type { HTMLAttributes } from "react";
import { classNames } from "../class-names.js";

export interface ContextBarItem {
  label: string;
  value: string;
}

export interface ContextBarProps extends HTMLAttributes<HTMLDListElement> {
  items: readonly ContextBarItem[];
  label?: string;
}

export function ContextBar({ className, items, label = "Çalışma bağlamı", ...props }: ContextBarProps) {
  return (
    <dl {...props} aria-label={label} className={classNames("uh-context-bar", className)}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
