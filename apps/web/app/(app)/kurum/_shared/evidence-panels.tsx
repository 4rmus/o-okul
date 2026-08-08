import { Panel, StatusBadge, type StatusBadgeProps } from "@o-okul/ui";
import type { ReactNode } from "react";

interface EvidenceGate {
  command: string;
  detail: string;
  status: string;
  title: string;
}

interface EvidenceGateSectionProps {
  ariaLabel: string;
  gates: readonly EvidenceGate[];
  title: string;
}

interface EvidenceListSectionProps {
  ariaLabel: string;
  items: readonly string[];
  title: string;
}

interface OperationDecisionNoticeProps {
  decision: string;
  nextStep: string;
  reason: string;
}

type EvidenceTrustTone = NonNullable<StatusBadgeProps["tone"]>;
type EvidenceTrustScope = "configured-api" | "live-required" | "local-static" | "server-audit" | "staging-prod" | "ui-safe";
type EvidenceTrustTier = "evidence" | "live" | "reference";

interface EvidenceTrustItem {
  detail: ReactNode;
  label: string;
  scope: EvidenceTrustScope;
  tone?: EvidenceTrustTone;
  value: ReactNode;
}

interface EvidenceTrustPanelProps {
  ariaLabel: string;
  description: ReactNode;
  items: readonly EvidenceTrustItem[];
  title: ReactNode;
}

export function EvidenceTrustPanel({ ariaLabel, description, items, title }: EvidenceTrustPanelProps) {
  return (
    <Panel
      aria-label={ariaLabel}
      className="next-evidence-trust"
      description={
        <span className="next-evidence-trust__description">
          <span className="next-section-eyebrow">Güven durumu</span>
          <span>{description}</span>
        </span>
      }
      title={title}
    >
      <div className="next-evidence-trust__grid">
        {items.map((item) => {
          const tier = evidenceTrustTierByScope[item.scope];
          return (
            <article key={item.label} data-evidence-scope={item.scope}>
              <span>{item.label}</span>
              <StatusBadge
                aria-label={`Kanıt türü: ${evidenceTrustTierLabels[tier]}`}
                className="next-evidence-trust__tier"
                data-evidence-tier={tier}
                tone={evidenceTrustTierTone(tier)}
              >
                {evidenceTrustTierLabels[tier]}
              </StatusBadge>
              <StatusBadge tone={item.tone ?? "neutral"}>{item.value}</StatusBadge>
              <div className="next-evidence-trust__scope" aria-label={`Kanıt kapsamı: ${evidenceTrustScopeLabels[item.scope]}`}>
                <span>{evidenceTrustScopeLabels[item.scope]}</span>
                <small>{evidenceTrustScopeDescriptions[item.scope]}</small>
              </div>
              <p>{item.detail}</p>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

const evidenceTrustTierByScope: Record<EvidenceTrustScope, EvidenceTrustTier> = {
  "configured-api": "reference",
  "live-required": "live",
  "local-static": "reference",
  "server-audit": "evidence",
  "staging-prod": "evidence",
  "ui-safe": "evidence",
};

const evidenceTrustTierLabels: Record<EvidenceTrustTier, string> = {
  evidence: "Kanıt",
  live: "Canlı",
  reference: "Referans",
};

function evidenceTrustTierTone(tier: EvidenceTrustTier): EvidenceTrustTone {
  if (tier === "live") return "warning";
  if (tier === "evidence") return "info";
  return "neutral";
}

const evidenceTrustScopeLabels: Record<EvidenceTrustScope, string> = {
  "configured-api": "Bağlı sistem",
  "live-required": "Canlı kanıt",
  "local-static": "Bu ekrandaki bilgi",
  "server-audit": "Sistem kaydı",
  "staging-prod": "Deneme/canlı ortam",
  "ui-safe": "Ekran güvenliği",
};

const evidenceTrustScopeDescriptions: Record<EvidenceTrustScope, string> = {
  "configured-api": "Ortam kaynağı görünür",
  "live-required": "Canlı kanıt gerekir",
  "local-static": "Yayın kararı için yeterli değil",
  "server-audit": "Sunucu sonucu esas",
  "staging-prod": "Yayın doğrulaması ayrıca yapılır",
  "ui-safe": "Kişisel bilgiler açık gösterilmez",
};

export function EvidenceGateSection({ ariaLabel, gates, title }: EvidenceGateSectionProps) {
  return (
    <Panel aria-label={ariaLabel} className="next-evidence-list" title={title}>
      {gates.map((gate) => (
        <article key={gate.title}>
          <h3>{gate.title}</h3>
          <p>{gate.status}</p>
          <p>{gate.detail}</p>
          <code>{gate.command}</code>
        </article>
      ))}
    </Panel>
  );
}

export function EvidenceListSection({ ariaLabel, items, title }: EvidenceListSectionProps) {
  return (
    <Panel aria-label={ariaLabel} className="next-evidence-list" title={title}>
      {items.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </Panel>
  );
}

export function ReferenceBadge() {
  return <span className="next-reference-badge">Rehber / Referans</span>;
}

export function OperationDecisionNotice({ decision, nextStep, reason }: OperationDecisionNoticeProps) {
  return (
    <Panel
      aria-label="Operasyon kararı"
      className="next-operation-decision"
      description={reason}
      title={decision}
      tone="muted"
    >
      <p>{nextStep}</p>
    </Panel>
  );
}
