import type { ComponentType, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface HubTabItem {
  current: boolean;
  href: string;
  label: ReactNode;
}

export interface HubTabsLinkProps {
  "aria-current"?: "page";
  children: ReactNode;
  className: string;
  href: string;
}

export interface HubTabsProps {
  className?: string;
  items: HubTabItem[];
  label: string;
  // Uygulama router'ının link bileşeni (ör. next/link); paket web uygulamasına bağımlı olmaz.
  linkComponent?: ComponentType<HubTabsLinkProps>;
}

// Route tabanlı hub sekmeleri: her sekme ayrı URL'dir, bu yüzden tablist değil link listesidir.
export function HubTabs({ className, items, label, linkComponent: LinkComponent }: HubTabsProps) {
  return (
    <nav aria-label={label} className={classNames("uh-hub-tabs", className)}>
      <ul>
        {items.map((item) => {
          const linkProps = {
            "aria-current": item.current ? ("page" as const) : undefined,
            className: classNames("uh-hub-tabs__link", item.current && "uh-hub-tabs__link--current"),
            href: item.href,
          };
          return (
            <li key={item.href}>
              {LinkComponent ? <LinkComponent {...linkProps}>{item.label}</LinkComponent> : <a {...linkProps}>{item.label}</a>}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
