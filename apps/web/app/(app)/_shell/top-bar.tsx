"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, LogOut, Search, UserRound } from "lucide-react";
import { Button, ContextBar } from "@o-okul/ui";
import { isTenantRoleName, tenantRoleLabel, type Session } from "@o-okul/shared-types";
import { appBrand } from "../../../src/brand.js";
import { productTerms } from "../../../src/product-terms.js";
import { hasInstitutionAccess, hasSystemAccess } from "../_shared/access.js";
import { dynamicDetailParents, institutionNavGroups, rolePortalItems, rolePortalNavGroups, staticBreadcrumbLabels, systemNavGroups } from "../_shared/navigation.js";
import { type ShellTenantBrand } from "./nav-sidebar.js";
import { ThemeToggle } from "./theme-toggle.js";
import { examWorkspaceSegments } from "../../../src/route-manifest.js";
const allNavigationItems = [
  ...systemNavGroups.flatMap((group) => group.items),
  ...institutionNavGroups.flatMap((group) => group.items),
  ...rolePortalItems,
  ...rolePortalNavGroups.flatMap((group) => group.items),
];

const breadcrumbLabelByPath = {
  ...Object.fromEntries(allNavigationItems.map((item) => [item.href, item.label])),
  ...staticBreadcrumbLabels,
};

export function WorkContext({
  campusId,
  campuses,
  onActivate,
  onChange,
  termId,
  terms,
  tenantName,
}: {
  campusId: string;
  campuses: Array<{ id: string; name: string }>;
  onActivate(): void;
  onChange(key: "campusId" | "termId", value: string): void;
  termId: string;
  terms: Array<{ id: string; name: string }>;
  tenantName?: string;
}) {
  return (
    <ContextBar
      className="next-work-context"
      label="Çalışma bilgileri"
      onActivate={onActivate}
      selects={[
        {
          accessibleName: "Çalışma kampüsü",
          allLabel: productTerms.allBranches,
          label: productTerms.branch,
          onChange: (value) => onChange("campusId", value),
          options: withSelectedOption(campuses, campusId).map((campus) => ({ label: campus.name, value: campus.id })),
          value: campusId,
        },
        {
          accessibleName: "Çalışma dönemi",
          allLabel: "Tüm dönemler",
          label: "Dönem",
          onChange: (value) => onChange("termId", value),
          options: withSelectedOption(terms, termId).map((term) => ({ label: term.name, value: term.id })),
          value: termId,
        },
      ]}
      staticItems={[{ label: productTerms.institution, value: tenantName ?? "Kurum çalışma alanı" }]}
    />
  );
}

// URL'deki seçim listede yoksa (yükleniyor veya erişim dışı) ham kimlik gösterilmez.
function withSelectedOption(options: Array<{ id: string; name: string }>, selectedId: string) {
  return selectedId && !options.some((option) => option.id === selectedId) ? [...options, { id: selectedId, name: "Seçilmedi" }] : options;
}

export function DesktopTopBar({
  canUseShellSearch,
  onLogout,
  personaSwitches = [],
  personaSwitching,
  onSearch,
  session,
  tenantBrand,
}: {
  canUseShellSearch: boolean;
  onLogout(): void;
  personaSwitches?: Array<{ label: string; onSelect(): void; target: string }>;
  personaSwitching: boolean;
  onSearch(value: string): void;
  session: Session;
  tenantBrand?: ShellTenantBrand;
}) {
  const primaryRole = session.roles.find(isTenantRoleName);
  const roleLabel = primaryRole ? tenantRoleLabel(primaryRole) : (session.roles[0] ?? "Hesap");
  const contextLabel = tenantBrand?.name ?? sessionContextLabel(session);

  return (
    <header className="next-desktop-topbar" aria-label="Üst gezinme">
      <div className="next-desktop-topbar__search">
        {canUseShellSearch ? <ShellSearchBar onSearch={onSearch} /> : <span className="next-desktop-topbar__brand">{appBrand.name}</span>}
      </div>
      <div className="next-desktop-topbar__context" aria-label="Seçili kurum veya çalışma alanı">
        <Building2 size={16} aria-hidden="true" />
        <span>{contextLabel}</span>
      </div>
      <div className="next-desktop-topbar__account">
        <UserRound size={16} aria-hidden="true" />
        <span>{roleLabel}</span>
        {personaSwitches.map((personaSwitch) => (
          <Button key={personaSwitch.target} type="button" variant="secondary" disabled={personaSwitching} onClick={personaSwitch.onSelect}>
            {personaSwitch.label}
          </Button>
        ))}
        <ThemeToggle />
        <Button type="button" variant="secondary" onClick={onLogout}>
          <LogOut size={16} aria-hidden="true" />
          Çıkış
        </Button>
      </div>
    </header>
  );
}

function sessionContextLabel(session: Session) {
  if (session.subjectType === "STUDENT") return "Öğrenci portalı";
  if (session.subjectType === "GUARDIAN") return "Veli portalı";
  if (session.subjectType === "TEACHER") return "Öğretmen portalı";
  if (hasSystemAccess(session.roles) && !hasInstitutionAccess(session.roles)) return "Sistem";
  return "Kurum";
}

function ShellSearchBar({ onSearch }: { onSearch(value: string): void }) {
  const [value, setValue] = useState("");

  function handleSearch(value: string) {
    setValue(value);
    onSearch(value);
  }

  return (
    <label className="next-shell-search">
      <Search size={16} aria-hidden="true" />
      <input
        aria-label="Genel arama"
        onChange={(event) => handleSearch(event.target.value)}
        onFocus={() => onSearch(value)}
        placeholder="Ara"
        type="search"
        value={value}
      />
    </label>
  );
}

export function RouteBreadcrumb({ pathname }: { pathname: string }) {
  const crumbs = getBreadcrumbs(pathname);

  return (
    <nav className="next-breadcrumb" aria-label="Gezinme yolu">
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={crumb.path}>
            {crumb.isCurrent ? (
              <span aria-current="page">{crumb.label}</span>
            ) : crumb.hasPage ? (
              <Link href={crumb.path}>{crumb.label}</Link>
            ) : (
              <span>{crumb.label}</span>
            )}
            {index < crumbs.length - 1 ? <span aria-hidden="true">/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function getBreadcrumbs(pathname: string) {
  const cleanPath = pathname && pathname.startsWith("/") ? pathname : `/${pathname ?? ""}`;
  const segments = cleanPath.split("/").filter(Boolean);

  if (segments.length === 0) {
    return [{ hasPage: true, label: "Ana Sayfa", path: "/", isCurrent: true }];
  }

  const items: Array<{ hasPage: boolean; label: string; path: string; isCurrent: boolean }> = [
    { hasPage: true, label: "Ana Sayfa", path: "/", isCurrent: false },
  ];
  const isExamWorkspace = segments[0] === "kurum" && segments[1] === "sinavlar" && segments.length > 3;

  let current = "";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;

    current += `/${segment}`;
    const isCurrent = index === segments.length - 1;
    const previous = index === 0 ? undefined : segments[index - 1];
    const workspaceSegment = isExamWorkspace && index > 2 ? examWorkspaceSegments[segment] : undefined;
    items.push({
      hasPage: workspaceSegment?.page ?? true,
      label: workspaceSegment?.label ?? resolveBreadcrumbLabel(current, previous, segment, index),
      path: current,
      isCurrent,
    });
  }

  return items;
}

function resolveBreadcrumbLabel(path: string, previousSegment: string | undefined, currentSegment: string, index: number) {
  const customLabel = breadcrumbLabelByPath[path];
  if (customLabel) return customLabel;

  if (index >= 2 && previousSegment && dynamicDetailParents.includes(previousSegment)) {
    return "Detay";
  }

  if (currentSegment === "kurum") return "Kurum";
  if (currentSegment === "sistem") return "Sistem";

  return currentSegment
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
