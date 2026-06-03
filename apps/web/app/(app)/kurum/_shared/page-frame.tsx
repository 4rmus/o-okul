import type { ReactNode } from "react";

interface PageFrameProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function PageFrame({ actions, children, subtitle, title }: PageFrameProps) {
  return (
    <section className="next-page-frame">
      <header className="next-page-frame__header">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="next-page-frame__actions">{actions}</div> : null}
      </header>
      <div className="next-page-frame__body">{children}</div>
    </section>
  );
}
