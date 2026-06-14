"use client";

import { EvidenceGateSection, EvidenceListSection, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";

const uatGates = [
  {
    title: "UAT kanıtı",
    command: "UAT_EVIDENCE_TARGET=file://$PWD/docs/evidence-templates/uat.example.json pnpm uat:check",
    status: "Kanıt raporu gerekir",
    detail: "Staging veya production UAT raporu PASS dönmeli ve defect içermemeli.",
  },
  {
    title: "CI ve prod env",
    command: "pnpm run ci && pnpm prod:env:check",
    status: "Repo + env gerekir",
    detail: "Release adayı ve üretim env kapıları doğrulanır.",
  },
  {
    title: "Canlı smoke zinciri",
    command: "pnpm raw-import:smoke && pnpm report-generation:smoke && pnpm queue:smoke",
    status: "Canlı servis gerekir",
    detail: "Import, rapor üretimi ve queue akışı staging/prod ortamında çalışır.",
  },
  {
    title: "Rollback referansı",
    command: "rollbackImageTag + restoreBackupReference",
    status: "Kanıt raporunda zorunlu",
    detail: "Son başarılı image tag'i ve restore edilebilir backup referansı yazılır.",
  },
] as const;

const uatFlows = [
  "tenant admin login",
  "teacher workflow",
  "guardian workflow",
  "raw import smoke",
  "report generation smoke",
  "sms batch smoke",
  "privacy purge",
] as const;

const requiredCommands = [
  "pnpm run ci",
  "pnpm prod:env:check",
  "pnpm db:rls:check:live",
  "pnpm raw-import:smoke",
  "pnpm report-generation:smoke",
  "pnpm queue:smoke",
  "pnpm sms:smoke",
  "pnpm traefik:https:smoke",
] as const;

const journeyScenarios = [
  "UAT-SYS-01",
  "UAT-SYS-02",
  "UAT-SYS-03",
  "UAT-SYS-04",
  "UAT-KURUM-01",
  "UAT-KURUM-02",
  "UAT-KURUM-03",
  "UAT-KURUM-04",
  "UAT-KURUM-05",
  "UAT-KURUM-06",
  "UAT-KURUM-07",
  "UAT-KURUM-08",
  "UAT-TEACHER-01",
  "UAT-TEACHER-02",
  "UAT-TEACHER-03",
  "UAT-STUDENT-01",
  "UAT-STUDENT-02",
  "UAT-STUDENT-03",
  "UAT-GUARDIAN-01",
  "UAT-GUARDIAN-02",
  "UAT-GUARDIAN-03",
] as const;

const rollbackFields = ["releaseCandidate", "rollbackImageTag", "restoreBackupReference", "defects boş"] as const;

export function UatRollbackPage() {
  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="UAT / Rollback"
      subtitle="Staging/prod UAT, rollback image ve restore backup kanıtlarını izle."
    >
      <MetricPanelGrid
        ariaLabel="UAT rollback özeti"
        metrics={[
          { label: "UAT raporu", value: "Kanıt gerekir" },
          { label: "Rollback", value: "Image tag" },
          { label: "Restore referansı", value: "Backup gerekir" },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: panel şu an CLI-only rehberdir."
        reason="Rollback canlı sürümü ve veri bütünlüğünü etkiler; onay zinciri, audit log ve restore referansı olmadan panelden tetiklenmez."
        nextStep="Panel aksiyonu için release job, çift onay ve geri dönüş kanıtı C1 sonrası gerekir."
      />
      <EvidenceGateSection title="Kanıt Kapıları" ariaLabel="UAT rollback kapıları" gates={uatGates} />
      <EvidenceListSection title="UAT Akışları" ariaLabel="UAT akışları" items={uatFlows} />
      <EvidenceListSection title="Persona Senaryoları" ariaLabel="Persona UAT senaryoları" items={journeyScenarios} />
      <EvidenceListSection title="Zorunlu Komutlar" ariaLabel="Zorunlu komutlar" items={requiredCommands} />
      <EvidenceListSection title="Rollback Alanları" ariaLabel="Rollback alanları" items={rollbackFields} />
    </PageFrame>
  );
}
