"use client";

import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  onClose?(): void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ children, className, description, footer, onClose, open, title, ...props }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusable = panel ? panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) : null;
    const firstFocusable = focusable && focusable.length > 0 ? focusable[0] : null;
    (firstFocusable ?? panel)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const items = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;

      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      {...props}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-modal
      className={classNames("uh-dialog", className)}
      role="dialog"
    >
      <div className="uh-dialog__panel" ref={panelRef} tabIndex={-1}>
        <h2 className="uh-dialog__title" id={titleId}>
          {title}
        </h2>
        {description ? (
          <p className="uh-dialog__description" id={descriptionId}>
            {description}
          </p>
        ) : null}
        <div className="uh-dialog__body">{children}</div>
        {footer ? <div className="uh-dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
