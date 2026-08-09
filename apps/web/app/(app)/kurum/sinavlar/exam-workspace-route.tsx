"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ResolvedFeatureRollouts } from "@o-okul/shared-types";
import { Panel } from "@o-okul/ui";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { useAuth } from "../../../providers.js";
import { PageFrame } from "../_shared/page-frame.js";

const requiredFeatureKeys = ["web.shell-v2", "web.ia-v2", "web.exam-workspace-v2"] as const;

type ExamWorkspaceSection = "overview" | "optical" | "reports";

export function ExamWorkspaceRoute({
  activeSection,
  children,
  examId,
  fallbackHref,
}: {
  activeSection: ExamWorkspaceSection;
  children: ReactNode;
  examId: string;
  fallbackHref: string;
}) {
  const { auth } = useAuth();
  const router = useRouter();
  const rolloutsQuery = useQuery({
    queryKey: ["next-feature-rollouts", auth?.session.tenantId ?? "anonymous", auth?.session.id ?? "none"],
    queryFn: () => apiRequest<ResolvedFeatureRollouts>(auth?.accessToken ?? "", `${apiBaseUrl}/me/feature-rollouts`),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
    retry: false,
  });
  const workspaceEnabled = requiredFeatureKeys.every((featureKey) => (
    rolloutsQuery.data?.enabledFeatureKeys.includes(featureKey)
  ));

  useEffect(() => {
    if (!auth || rolloutsQuery.isPending || workspaceEnabled) return;
    router.replace(fallbackHref);
  }, [auth, fallbackHref, rolloutsQuery.isPending, router, workspaceEnabled]);

  if (!auth || rolloutsQuery.isPending || !workspaceEnabled) {
    return (
      <PageFrame title="Sınav çalışma alanı" subtitle="Çalışma alanı erişimi doğrulanıyor.">
        <Panel tone="muted"><p>Mevcut sınav ekranına yönlendiriliyor.</p></Panel>
      </PageFrame>
    );
  }

  return (
    <>
      <ExamWorkspaceNavigation activeSection={activeSection} examId={examId} />
      {children}
    </>
  );
}

export function ExamWorkspaceNavigation({
  activeSection,
  examId,
}: {
  activeSection: ExamWorkspaceSection;
  examId: string;
}) {
  const baseHref = `/kurum/sinavlar/${encodeURIComponent(examId)}`;
  const items = [
    { href: baseHref, id: "overview", label: "Hazırlık" },
    { href: `${baseHref}/optik`, id: "optical", label: "Optik" },
    { href: `${baseHref}/raporlar`, id: "reports", label: "Raporlar" },
  ] as const;

  return (
    <nav aria-label="Sınav çalışma alanı bölümleri" className="next-exam-workspace-actions">
      {items.map((item) => (
        <Link
          key={item.id}
          aria-current={activeSection === item.id ? "page" : undefined}
          className={`uh-button uh-button--${activeSection === item.id ? "primary" : "secondary"} uh-button--md`}
          href={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
