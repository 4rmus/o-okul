import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";
import { Button } from "./button.js";

export interface PaginationProps extends HTMLAttributes<HTMLDivElement> {
  nextLabel?: ReactNode;
  onNext(): void;
  onPrevious(): void;
  previousLabel?: ReactNode;
  page: number;
  totalPages: number;
}

export function Pagination({ className, nextLabel = "Sonraki", onNext, onPrevious, page, previousLabel = "Önceki", totalPages, ...props }: PaginationProps) {
  const normalizedTotalPages = Math.max(totalPages, 1);

  return (
    <div {...props} aria-label={props["aria-label"] ?? "Sayfalama"} className={classNames("uh-pagination", className)} role={props.role ?? "navigation"}>
      <Button aria-label="Önceki sayfa" disabled={page <= 1} onClick={onPrevious} size="sm" variant="secondary">
        {previousLabel}
      </Button>
      <span>
        {page}/{normalizedTotalPages}
      </span>
      <Button
        aria-label="Sonraki sayfa"
        disabled={page >= normalizedTotalPages}
        onClick={onNext}
        size="sm"
        variant="secondary"
      >
        {nextLabel}
      </Button>
    </div>
  );
}
