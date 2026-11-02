import type { ReactNode } from "react";
import { ActionCard, MetricCard, MetricGrid, StatusBadge, type StatusBadgeProps } from "@o-okul/ui";

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
  href?: string;
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
  // Hedefi olan öneriler bağlantı kartıdır; diğerleri yalnız durum notudur. Çağıran, sayfayla aynı yetkideki hedefi verir.
  const linkActions = actions.filter((action) => Boolean(action.href));
  const statusNotes = actions.filter((action) => !action.href);

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
        <div aria-label={`${ariaLabel} önerilen işlemler`} className="next-operation-summary__followups" role="group">
          {linkActions.length > 0 ? (
            <ul className="next-operation-summary__actions">
              {linkActions.map((action) => (
                <li className="next-operation-summary__action-item" key={action.key}>
                  <ActionCard
                    badge={action.status}
                    className="next-operation-summary__action"
                    detail={action.detail}
                    label={
                      <a className="next-operation-summary__action-link" href={action.href ?? ""}>
                        {action.label}
                      </a>
                    }
                    tone={action.tone ?? "neutral"}
                    value={action.value}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {statusNotes.length > 0 ? (
            <ul className="next-operation-summary__notes">
              {statusNotes.map((action) => (
                <li className="next-operation-summary__note" data-tone={action.tone ?? "neutral"} key={action.key}>
                  <span className="next-operation-summary__note-label">{action.label}</span>
                  <strong className="next-operation-summary__note-value">{action.value}</strong>
                  <span className="next-operation-summary__note-status">{action.status}</span>
                  {action.detail ? <small className="next-operation-summary__note-detail">{action.detail}</small> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
