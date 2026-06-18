import type { FormEventHandler, HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "onSubmit" | "title"> {
  actions?: ReactNode;
  as?: "section" | "article" | "aside" | "div" | "form";
  description?: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  title?: ReactNode;
  tone?: "default" | "muted" | "success" | "warning" | "danger" | "info";
}

export function Panel({
  actions,
  as: Component = "section",
  children,
  className,
  description,
  onSubmit,
  title,
  tone = "default",
  ...props
}: PanelProps) {
  const panelClassName = classNames("uh-panel", `uh-panel--${tone}`, className);
  const content = (
    <>
      {title || description || actions ? (
        <header className="uh-panel__header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="uh-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="uh-panel__body">{children}</div>
    </>
  );

  if (Component === "form") {
    return (
      <form {...props} className={panelClassName} onSubmit={onSubmit}>
        {content}
      </form>
    );
  }

  return (
    <Component {...props} className={panelClassName}>
      {content}
    </Component>
  );
}
