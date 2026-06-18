import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  align?: "start" | "between" | "end";
  children: ReactNode;
}

export function Toolbar({ align = "between", children, className, ...props }: ToolbarProps) {
  return (
    <div {...props} className={classNames("uh-toolbar", `uh-toolbar--${align}`, className)}>
      {children}
    </div>
  );
}

export interface FilterBarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function FilterBar({ children, className, ...props }: FilterBarProps) {
  return (
    <div {...props} className={classNames("uh-filter-bar", className)}>
      {children}
    </div>
  );
}
