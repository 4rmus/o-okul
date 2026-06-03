import type { HTMLAttributes } from "react";
import { classNames } from "../class-names.js";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table {...props} className={classNames("uh-table", className)} />;
}
