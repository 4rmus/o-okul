"use client";

import { DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@uzman-hocam/ui";
import { EvidenceTrustPanel, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

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

interface UatRollbackTableRow {
  detail: string;
  key: string;
  label: string;
  scope: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

export function UatRollbackPage() {
  const summaryItems = buildUatRollbackSummaryItems();
  const summaryBadges = buildUatRollbackSummaryBadges();
  const summaryActions = buildUatRollbackSummaryActions();
  const gateRows = buildUatRollbackRows(uatGates, (gate) => ({
    detail: gate.detail,
    key: gate.title,
    label: gate.title,
    scope: gate.command,
    tone: gate.status.includes("gerekir") || gate.status.includes("zorunlu") ? "warning" : "info",
    value: gate.status,
  }));
  const flowRows = buildUatRollbackRows(uatFlows, (flow) => ({
    detail: "UAT raporunda persona akışı PASS ve defects boş olacak şekilde kanıtlanır.",
    key: flow,
    label: flow,
    scope: personaScope(flow),
    tone: "warning",
    value: "Kanıt gerekir",
  }));
  const scenarioRows = buildUatRollbackRows(journeyScenarios, (scenario) => ({
    detail: "Ürün yolculuğu senaryosu staging/prod UAT raporunda izlenir.",
    key: scenario,
    label: scenario,
    scope: personaScope(scenario),
    tone: "warning",
    value: "UAT kapsamı",
  }));
  const commandRows = buildUatRollbackRows(requiredCommands, (command) => ({
    detail: command.includes(":live") || command.includes("traefik") ? "Canlı veya staging/prod ortam kanıtı gerekir." : "Release adayı için komut çıktısı evidence dosyasına bağlanır.",
    key: command,
    label: command,
    scope: commandScope(command),
    tone: command.includes(":live") || command.includes("traefik") ? "danger" : "warning",
    value: "Zorunlu",
  }));
  const rollbackRows = buildUatRollbackRows(rollbackFields, (field) => ({
    detail: rollbackFieldDetail(field),
    key: field,
    label: field,
    scope: field === "defects boş" ? "UAT sonucu" : "Rollback packet",
    tone: "warning",
    value: "Zorunlu",
  }));

  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="UAT / Rollback"
      subtitle="Staging/prod UAT, rollback image ve restore backup kanıtlarını izle."
    >
      <OperationSummary
        actions={summaryActions}
        ariaLabel="UAT rollback operasyon özeti"
        badges={summaryBadges}
        items={summaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="UAT rollback güven durumu"
        title="UAT ve Geri Dönüş Kanıt Gücü"
        description="Panel UAT kapsamını ve zorunlu alanları görünür kılar; canlı geri dönüş aksiyonu kanıt, onay ve audit zinciri olmadan açılmaz."
        items={[
          {
            label: "UAT sonucu",
            value: "PASS gerekir",
            tone: "warning",
            scope: "staging-prod",
            detail: "Staging veya production UAT raporu defects boş olacak şekilde bağlanır.",
          },
          {
            label: "Rollback",
            value: "Referans gerekir",
            tone: "warning",
            scope: "live-required",
            detail: "Image tag ve restore edilebilir backup referansı evidence içinde tutulur.",
          },
          {
            label: "Panel aksiyonu",
            value: "Kapalı",
            tone: "danger",
            scope: "server-audit",
            detail: "Çift onay ve audit modeli tamamlanmadan canlı rollback tetiklenmez.",
          },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: panel şu an CLI-only rehberdir."
        reason="Rollback canlı sürümü ve veri bütünlüğünü etkiler; onay zinciri, audit log ve restore referansı olmadan panelden tetiklenmez."
        nextStep="Panel aksiyonu için release job, çift onay ve geri dönüş kanıtı C1 sonrası gerekir."
      />
      <Panel
        aria-label="UAT rollback kapıları"
        description="Release kararı için staging/prod UAT, ortam, smoke ve rollback referans kapıları."
        title="Kanıt Kapıları"
      >
        <DataTable
          caption="UAT rollback kanıt kapıları"
          columns={uatRollbackTableColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={gateRows}
        />
      </Panel>
      <Panel
        aria-label="UAT akışları"
        description="Kritik persona ve operasyon akışları PASS raporu olmadan release kararı sayılmaz."
        title="UAT Akışları"
      >
        <DataTable
          caption="UAT akışları"
          columns={uatRollbackTableColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={flowRows}
        />
      </Panel>
      <Panel
        aria-label="Persona UAT senaryoları"
        description="Sistem, kurum, öğretmen, öğrenci ve veli yolculuklarının UAT kapsamı."
        title="Persona Senaryoları"
      >
        <DataTable
          caption="UAT persona senaryoları"
          columns={uatRollbackTableColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={scenarioRows}
        />
      </Panel>
      <Panel
        aria-label="Zorunlu komutlar"
        description="Release adayı ve staging/prod ortam için zorunlu komut kanıtları."
        title="Zorunlu Komutlar"
      >
        <DataTable
          caption="UAT zorunlu komutları"
          columns={uatRollbackTableColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={commandRows}
        />
      </Panel>
      <Panel
        aria-label="Rollback alanları"
        description="Geri dönüş paketi için release image, restore edilebilir backup ve defects durumu."
        title="Rollback Alanları"
      >
        <DataTable
          caption="Rollback zorunlu alanları"
          columns={uatRollbackTableColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={rollbackRows}
        />
      </Panel>
    </PageFrame>
  );
}

const uatRollbackTableColumns: Array<DataTableColumn<UatRollbackTableRow>> = [
  {
    key: "item",
    header: "Kanıt",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => row.label,
    sticky: "left",
  },
  {
    key: "status",
    header: "Durum",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => <StatusBadge tone={row.tone}>{row.value}</StatusBadge>,
  },
  {
    key: "scope",
    header: "Kapsam",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.scope,
  },
  {
    key: "detail",
    header: "Bağlam",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.detail,
  },
];

function buildUatRollbackSummaryItems(): OperationSummaryItem[] {
  return [
    {
      description: "Staging/prod UAT raporu",
      key: "uat-result",
      label: "UAT sonucu",
      tone: "warning",
      value: "PASS gerekir",
    },
    {
      description: "Evidence ortamı",
      key: "environment",
      label: "Kanıt ortamı",
      tone: "warning",
      value: "Staging/prod",
    },
    {
      description: "Image tag ve restore backup referansı",
      key: "rollback",
      label: "Rollback",
      tone: "danger",
      value: "Referans gerekir",
    },
    {
      description: "Canlı aksiyon tetikleme",
      key: "panel-action",
      label: "Panel aksiyonu",
      tone: "info",
      value: "CLI-only",
    },
  ];
}

function buildUatRollbackSummaryBadges(): OperationSummaryBadge[] {
  return [
    {
      key: "cli-only",
      label: "CLI-only",
      tone: "info",
    },
    {
      key: "release-evidence",
      label: "Release kanıtı ayrı",
      tone: "warning",
    },
    {
      key: "live-required",
      label: "Canlı kanıt gerekir",
      tone: "warning",
    },
    {
      key: "server-audit",
      label: "Server/audit zorunlu",
      tone: "danger",
    },
  ];
}

function buildUatRollbackSummaryActions(): OperationSummaryAction[] {
  return [
    {
      detail: "UAT_EVIDENCE_TARGET ile staging/prod rapor kontrol edilir",
      key: "uat-evidence",
      label: "UAT evidence check",
      status: "Kanıt raporu",
      tone: "warning",
      value: "PASS + defects boş",
    },
    {
      detail: "Import, rapor üretimi, queue ve SMS smoke zinciri",
      key: "live-smoke",
      label: "Canlı smoke zinciri",
      status: "Canlı ortam",
      tone: "warning",
      value: "Servis gerekir",
    },
    {
      detail: "rollbackImageTag ve restoreBackupReference birlikte tutulur",
      key: "rollback-packet",
      label: "Rollback packet",
      status: "Referans gerekir",
      tone: "danger",
      value: "Image + backup",
    },
    {
      detail: "Çift onay ve audit modeli tamamlanmadan panelden tetiklenmez",
      key: "panel-action",
      label: "Panel aksiyonu",
      status: "Kapalı",
      tone: "danger",
      value: "CLI-only",
    },
  ];
}

function buildUatRollbackRows<TItem>(
  items: readonly TItem[],
  mapItem: (item: TItem) => UatRollbackTableRow,
): UatRollbackTableRow[] {
  return items.map(mapItem);
}

function personaScope(value: string) {
  if (value.includes("SYS")) return "Sistem";
  if (value.includes("KURUM") || value.includes("tenant")) return "Kurum";
  if (value.includes("TEACHER") || value.includes("teacher")) return "Öğretmen";
  if (value.includes("STUDENT") || value.includes("student")) return "Öğrenci";
  if (value.includes("GUARDIAN") || value.includes("guardian")) return "Veli";
  return "Operasyon";
}

function commandScope(command: string) {
  if (command.includes(":live") || command.includes("traefik")) return "Staging/prod";
  if (command.includes("prod:env")) return "Prod env";
  if (command.includes("ci")) return "Release adayı";
  return "Canlı smoke";
}

function rollbackFieldDetail(field: string) {
  if (field === "releaseCandidate") return "Dağıtılan release adayı ve image kaynağı izlenir.";
  if (field === "rollbackImageTag") return "Geri dönülebilir son başarılı image tag'i zorunludur.";
  if (field === "restoreBackupReference") return "Restore edilebilir backup referansı olmadan rollback paketi tamamlanmaz.";
  return "UAT raporunda açık defect kalmadığını kanıtlar.";
}
