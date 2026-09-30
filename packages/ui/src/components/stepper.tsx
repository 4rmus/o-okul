import type { ComponentType, ReactNode } from "react";
import { classNames } from "../class-names.js";
import type { HubTabsLinkProps } from "./hub-tabs.js";

export type StepperStatus = "complete" | "current" | "blocked" | "upcoming";

export interface StepperStep {
  description?: ReactNode;
  href?: string;
  key: string;
  label: ReactNode;
  status: StepperStatus;
}

export interface StepperProps {
  className?: string;
  currentHref?: string;
  label: string;
  linkComponent?: ComponentType<HubTabsLinkProps>;
  steps: StepperStep[];
}

const statusText: Record<StepperStatus, string> = {
  blocked: "Engelli",
  complete: "Tamam",
  current: "Sıradaki",
  upcoming: "Bekliyor",
};

// Adımlı iş akışı (§4): durum yalnız renkle değil metin ve simgeyle de verilir (gri tonda ayırt edilir).
export function Stepper({ className, currentHref, label, linkComponent: LinkComponent, steps }: StepperProps) {
  return (
    <nav aria-label={label} className={classNames("uh-stepper", className)}>
      <ol>
        {steps.map((step, index) => {
          const content = (
            <>
              <span aria-hidden="true" className="uh-stepper__index">{step.status === "complete" ? "✓" : step.status === "blocked" ? "!" : index + 1}</span>
              <span className="uh-stepper__text">
                <span className="uh-stepper__label">{step.label}</span>
                <span className="uh-stepper__status">{statusText[step.status]}</span>
                {step.description ? <span className="uh-stepper__description">{step.description}</span> : null}
              </span>
            </>
          );
          const isCurrentPage = Boolean(step.href && currentHref === step.href);
          const linkProps = {
            "aria-current": isCurrentPage ? ("page" as const) : undefined,
            className: "uh-stepper__link",
            href: step.href ?? "",
          };
          return (
            <li className="uh-stepper__step" data-status={step.status} key={step.key}>
              {step.href ? (
                LinkComponent ? <LinkComponent {...linkProps}>{content}</LinkComponent> : <a {...linkProps}>{content}</a>
              ) : (
                <span className="uh-stepper__link">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
