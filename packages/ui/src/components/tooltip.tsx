"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { classNames } from "../class-names.js";

export interface TooltipProps extends HTMLAttributes<HTMLSpanElement> {
  label: ReactNode;
}

export function Tooltip({
  children,
  className,
  label,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  ...props
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const childArray = Children.toArray(children);
  const onlyChild = childArray.length === 1 && isValidElement<Record<string, unknown>>(childArray[0]) ? childArray[0] : null;
  const trigger = onlyChild ? describeTrigger(onlyChild, tooltipId) : children;

  function clearHoverTimer() {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  useEffect(() => clearHoverTimer, []);

  function handleMouseEnter(event: React.MouseEvent<HTMLSpanElement>) {
    onMouseEnter?.(event);
    if (event.defaultPrevented) return;
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      setOpen(true);
    }, 900);
  }

  function handleMouseLeave(event: React.MouseEvent<HTMLSpanElement>) {
    onMouseLeave?.(event);
    clearHoverTimer();
    setOpen(false);
  }

  function handleFocus(event: FocusEvent<HTMLSpanElement>) {
    onFocus?.(event);
    if (event.defaultPrevented) return;
    clearHoverTimer();
    setOpen(true);
  }

  function handleBlur(event: FocusEvent<HTMLSpanElement>) {
    onBlur?.(event);
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
    }
  }

  return (
    <span
      {...props}
      className={classNames("uh-tooltip", className)}
      data-open={open || undefined}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {trigger}
      <span className="uh-tooltip__content" id={tooltipId} role="tooltip">
        {label}
      </span>
    </span>
  );
}

function describeTrigger(trigger: ReactElement<Record<string, unknown>>, tooltipId: string) {
  const describedBy = [trigger.props["aria-describedby"], tooltipId].filter(Boolean).join(" ");
  return cloneElement(trigger, { "aria-describedby": describedBy });
}
