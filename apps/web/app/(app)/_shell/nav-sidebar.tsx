"use client";

import Link from "next/link";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { type TenantRecord } from "@o-okul/shared-types";
import { appBrand } from "../../../src/brand.js";
export type NavigationGroup = {
  label: string;
  items: readonly SidebarItem[];
};

export type SidebarItem = {
  href: string;
  icon?: LucideIcon;
  label: string;
  matchHrefs?: readonly string[];
};

export interface ShellTenantBrand {
  logoUrl?: string;
  name: string;
}

export function ShellBrand({ tenantBrand }: { tenantBrand?: ShellTenantBrand }) {
  const brandName = tenantBrand?.name ?? appBrand.name;

  return (
    <div className="next-brand">
      {tenantBrand?.logoUrl ? (
        <img className="next-brand-logo" src={tenantBrand.logoUrl} alt={`${brandName} logosu`} />
      ) : (
        <span className="next-brand-mark">{appBrand.mark}</span>
      )}
      <span>{brandName}</span>
    </div>
  );
}

export function safeTenantBrand(tenant: TenantRecord | undefined): ShellTenantBrand | undefined {
  const name = safeTenantName(tenant?.name);
  if (!name) return undefined;
  const logoUrl = safeLogoUrl(tenant?.logoUrl);
  return logoUrl ? { logoUrl, name } : { name };
}

function safeTenantName(value: string | undefined) {
  const name = value?.trim();
  if (!name || /^tenant[-_][a-z0-9-]+$/i.test(name)) return undefined;
  return name;
}

function safeLogoUrl(value: string | undefined) {
  const url = value?.trim();
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export function keepFocusInMobileNav(event: KeyboardEvent, sidebar: HTMLElement | null) {
  if (!sidebar) return;
  const focusableElements = Array.from(
    sidebar.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== "hidden");
  if (focusableElements.length === 0) return;

  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  if (!first || !last) return;

  const activeElement = document.activeElement;
  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function SidebarGroup({
  expanded,
  group,
  groupKey,
  isActive,
  navCurrent,
  onToggle,
}: {
  expanded: boolean;
  group: NavigationGroup;
  groupKey: string;
  isActive: boolean;
  navCurrent(item: SidebarItem | string): "page" | undefined;
  onToggle(groupKey: string): void;
}) {
  const listId = `sidebar-group-${groupKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <section
      className="next-sidebar-group"
      data-active={isActive ? "true" : "false"}
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        className="next-sidebar-group-toggle"
        type="button"
        aria-controls={listId}
        aria-expanded={expanded}
        onClick={() => onToggle(groupKey)}
      >
        <span>{group.label}</span>
        <ChevronDown className="next-sidebar-group-toggle-icon" size={14} aria-hidden="true" />
      </button>
      <ul className="next-sidebar-group-list" id={listId}>
        {group.items.map((item) => (
          <li key={item.href}>
            <SidebarLink item={item} current={navCurrent(item)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SidebarLink({ current, item }: { current?: "page"; item: SidebarItem }) {
  const Icon = item.icon;

  return (
    <Link className="next-sidebar-link" href={item.href} aria-current={current} title={item.label}>
      {Icon ? <Icon className="next-sidebar-link-icon" size={16} aria-hidden="true" /> : null}
      <span>{item.label}</span>
    </Link>
  );
}
