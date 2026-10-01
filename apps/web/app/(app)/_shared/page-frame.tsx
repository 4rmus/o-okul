"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HubTabs, PageHeader } from "@o-okul/ui";
import { hubMembers, institutionRoutes } from "../../../src/route-manifest.js";
import { isSmsEnabled } from "../../../src/sms-feature.js";
import { useAuth } from "../../providers.js";
import { canAccessNavigationItem } from "./access.js";

interface PageFrameProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  context?: ReactNode;
}

// Sayfa anatomisi (§3): PageHeader → HubTabs (varsa) → içerik.
export function PageFrame({ actions, children, context, subtitle, title }: PageFrameProps) {
  const hubTabs = useHubTabs();

  return (
    <section className="next-page-frame">
      <PageHeader actions={actions} subtitle={subtitle} title={title} />
      {hubTabs ? <HubTabs className="next-page-frame__hub-tabs" items={hubTabs.items} label={hubTabs.label} linkComponent={Link} /> : null}
      {context ? <div className="next-page-frame__context" aria-label="Sayfa bilgileri">{context}</div> : null}
      <div className="next-page-frame__body">{children}</div>
    </section>
  );
}

function useHubTabs() {
  const pathname = usePathname();
  const { auth } = useAuth();
  const route = institutionRoutes.find((candidate) => candidate.href === pathname);
  if (!route?.hub || !auth) return undefined;
  const root = institutionRoutes.find((candidate) => candidate.href === route.hub);
  const members = hubMembers(route.hub).filter((member) =>
    (isSmsEnabled || !member.requiresSms)
    && canAccessNavigationItem(auth.session.roles, { href: member.href, label: member.label, requiredCapability: member.capability, requiredPersona: member.persona }, auth.session.activePersona),
  );
  if (members.length < 2) return undefined;
  return {
    items: members.map((member) => ({ current: member.href === pathname, href: member.href, label: member.tabLabel ?? member.label })),
    label: `${root?.menuLabel ?? root?.label ?? route.label} bölümleri`,
  };
}
