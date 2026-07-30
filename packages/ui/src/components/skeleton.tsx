import type { HTMLAttributes } from "react";
import { classNames } from "../class-names.js";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} aria-hidden={props["aria-hidden"] ?? true} className={classNames("uh-skeleton", className)} />;
}
