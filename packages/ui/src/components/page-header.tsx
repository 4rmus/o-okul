import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  actions?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}

// Sayfa anatomisi (§3): başlık, açıklama ve eylemler; ardından HubTabs ve içerik gelir.
export function PageHeader({ actions, className, subtitle, title, ...props }: PageHeaderProps) {
  return (
    <header {...props} className={classNames("uh-page-header", className)}>
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="uh-page-header__actions">{actions}</div> : null}
    </header>
  );
}
