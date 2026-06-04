import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface EmptyStateAction {
  href?: string;
  label: ReactNode;
  onClick?: () => void;
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  description?: ReactNode;
  hint?: ReactNode;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  title: ReactNode;
}

export function EmptyState({
  className,
  description,
  hint,
  primaryAction,
  secondaryAction,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div {...props} className={classNames("uh-empty-state", className)}>
      <div className="uh-empty-state__content">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {hint ? <p className="uh-empty-state__hint">{hint}</p> : null}
      </div>
      {primaryAction || secondaryAction ? (
        <div className="uh-empty-state__actions">
          {primaryAction ? <EmptyStateActionButton action={primaryAction} variant="primary" /> : null}
          {secondaryAction ? <EmptyStateActionButton action={secondaryAction} variant="secondary" /> : null}
        </div>
      ) : null}
    </div>
  );
}

function EmptyStateActionButton({ action, variant }: { action: EmptyStateAction; variant: "primary" | "secondary" }) {
  const className = `uh-button uh-button--${variant} uh-button--md`;

  if (action.href) {
    return (
      <a className={className} href={action.href}>
        {action.label}
      </a>
    );
  }

  return (
    <button className={className} onClick={action.onClick} type="button">
      {action.label}
    </button>
  );
}
