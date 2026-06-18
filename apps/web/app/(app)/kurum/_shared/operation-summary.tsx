import type { ReactNode } from "react";
import { StatusBadge, type StatusBadgeProps } from "@uzman-hocam/ui";

export interface OperationSummaryItem {
  description?: ReactNode;
  key: string;
  label: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  value: ReactNode;
}

export interface OperationSummaryBadge {
  key: string;
  label: ReactNode;
  tone?: StatusBadgeProps["tone"];
}

export interface OperationSummaryAction {
  detail?: ReactNode;
  key: string;
  label: ReactNode;
  status: ReactNode;
  tone?: StatusBadgeProps["tone"];
  value: ReactNode;
}

interface OperationSummaryProps {
  actions?: OperationSummaryAction[];
  ariaLabel: string;
  badges?: OperationSummaryBadge[];
  items: OperationSummaryItem[];
}

export function OperationSummary({ actions = [], ariaLabel, badges = [], items }: OperationSummaryProps) {
  return (
    <section aria-label={ariaLabel} className="next-operation-summary" role="region">
      <dl className="next-operation-summary__grid">
        {items.map((item) => (
          <div className="next-operation-summary__item" data-tone={item.tone ?? "default"} key={item.key}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
            {item.description ? <span>{item.description}</span> : null}
          </div>
        ))}
      </dl>
      {badges.length > 0 ? (
        <div aria-label={`${ariaLabel} durum etiketleri`} className="next-operation-summary__badges">
          {badges.map((badge) => (
            <StatusBadge key={badge.key} tone={badge.tone ?? "neutral"}>
              {badge.label}
            </StatusBadge>
          ))}
        </div>
      ) : null}
      {actions.length > 0 ? (
        <div aria-label={`${ariaLabel} aksiyon kuyruğu`} className="next-operation-summary__actions" role="list">
          {actions.map((action) => (
            <div className="next-operation-summary__action" data-tone={action.tone ?? "neutral"} key={action.key} role="listitem">
              <div className="next-operation-summary__action-copy">
                <span>{action.label}</span>
                <strong>{action.value}</strong>
                {action.detail ? <small>{action.detail}</small> : null}
              </div>
              <StatusBadge tone={action.tone ?? "neutral"}>{action.status}</StatusBadge>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
