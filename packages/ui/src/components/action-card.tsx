import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";
import { StatusBadge, type StatusBadgeProps } from "./status-badge.js";

interface ActionCardContentProps {
  badge?: ReactNode;
  badgeTone?: StatusBadgeProps["tone"];
  context?: ReactNode;
  detail?: ReactNode;
  label: ReactNode;
  state?: ReactNode;
  value: ReactNode;
}

interface ActionCardBaseProps extends ActionCardContentProps {
  tone?: StatusBadgeProps["tone"];
}

export type ActionCardProps =
  | (ActionCardBaseProps &
      AnchorHTMLAttributes<HTMLAnchorElement> & {
        as: "a";
        href: string;
      })
  | (ActionCardBaseProps &
      HTMLAttributes<HTMLElement> & {
        as?: "article" | "div";
      });

export function ActionCard(props: ActionCardProps) {
  if (props.as === "a") {
    const { as, badge, badgeTone, className, context, detail, label, state, tone = "neutral", value, ...linkProps } = props;

    return (
      <a {...linkProps} className={classNames("uh-action-card", className)} data-tone={tone}>
        <ActionCardContent badge={badge} badgeTone={badgeTone ?? tone} context={context} detail={detail} label={label} state={state} value={value} />
      </a>
    );
  }

  const { as: Component = "article", badge, badgeTone, className, context, detail, label, state, tone = "neutral", value, ...elementProps } = props;

  return (
    <Component {...elementProps} className={classNames("uh-action-card", className)} data-tone={tone}>
      <ActionCardContent badge={badge} badgeTone={badgeTone ?? tone} context={context} detail={detail} label={label} state={state} value={value} />
    </Component>
  );
}

function ActionCardContent({ badge, badgeTone, context, detail, label, state, value }: ActionCardContentProps) {
  return (
    <>
      {context ? <span className="uh-action-card__context">{context}</span> : null}
      <div className="uh-action-card__copy">
        <span className="uh-action-card__label">{label}</span>
        <strong className="uh-action-card__value">{value}</strong>
        {detail ? <small className="uh-action-card__detail">{detail}</small> : null}
      </div>
      {badge || state ? (
        <div className="uh-action-card__meta">
          {badge ? <StatusBadge tone={badgeTone ?? "neutral"}>{badge}</StatusBadge> : null}
          {state ? <span className="uh-action-card__state">{state}</span> : null}
        </div>
      ) : null}
    </>
  );
}
