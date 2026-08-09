import type { HTMLAttributes } from "react";
import { classNames } from "../class-names.js";
import { StatusBadge } from "./status-badge.js";

export type WorkflowStepState = "blocked" | "complete" | "current";

export interface WorkflowStep {
  description?: string;
  id: string;
  label: string;
  state: WorkflowStepState;
}

export interface WorkflowStepperProps extends HTMLAttributes<HTMLOListElement> {
  label?: string;
  steps: readonly WorkflowStep[];
}

const statePresentation = {
  blocked: { label: "Bekliyor", tone: "neutral" },
  complete: { label: "Tamamlandı", tone: "success" },
  current: { label: "Sıradaki", tone: "info" },
} as const;

export function WorkflowStepper({ className, label = "İş akışı durumu", steps, ...props }: WorkflowStepperProps) {
  return (
    <ol {...props} aria-label={label} className={classNames("uh-workflow-stepper", className)}>
      {steps.map((step) => {
        const presentation = statePresentation[step.state];
        return (
          <li aria-current={step.state === "current" ? "step" : undefined} data-state={step.state} key={step.id}>
            <div>
              <strong>{step.label}</strong>
              {step.description ? <p>{step.description}</p> : null}
            </div>
            <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
          </li>
        );
      })}
    </ol>
  );
}
