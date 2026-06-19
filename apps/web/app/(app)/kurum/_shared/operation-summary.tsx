import type { ReactNode } from "react";
import { ActionCard, MetricCard, MetricGrid, StatusBadge, type StatusBadgeProps } from "@uzman-hocam/ui";

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
      <MetricGrid className="next-operation-summary__grid" role="group" aria-label={`${ariaLabel} metrikleri`}>
        {items.map((item) => (
          <MetricCard
            className="next-operation-summary__item"
            description={item.description}
            key={item.key}
            label={item.label}
            tone={item.tone ?? "default"}
            value={item.value}
          />
        ))}
      </MetricGrid>
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
            <ActionCard
              as="div"
              badge={action.status}
              className="next-operation-summary__action"
              detail={action.detail}
              key={action.key}
              label={action.label}
              role="listitem"
              tone={action.tone ?? "neutral"}
              value={action.value}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
