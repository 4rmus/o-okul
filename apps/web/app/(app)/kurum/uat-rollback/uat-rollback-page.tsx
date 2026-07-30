"use client";

import { DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import { EvidenceTrustPanel, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const uatGates = [
  {
    title: "Kullanıcı kabulü",
    command: "UAT_EVIDENCE_TARGET=file://$PWD/docs/evidence-templates/uat.example.json pnpm uat:check",
    status: "Onay raporu gerekir",
    detail: "Deneme ortamındaki kabul raporu başarılı olmalı ve açık sorun içermemeli.",
  },
  {
    title: "Sürüm ve canlı ortam ayarları",
    command: "pnpm run ci && pnpm prod:env:check",
    status: "İki kontrol gerekir",
    detail: "Yayınlanacak sürüm ve canlı ortam ayarları doğrulanır.",
  },
  {
    title: "Canlı ortam denemeleri",
    command: "pnpm raw-import:smoke && pnpm report-generation:smoke && pnpm queue:smoke",
    status: "Canlı servis gerekir",
    detail: "Dosya aktarımı, rapor üretimi ve arka plan işleri canlıya benzer ortamda denenir.",
  },
  {
    title: "Önceki sürüme dönüş bilgisi",
    command: "rollbackImageTag + restoreBackupReference",
    status: "Kanıt raporunda zorunlu",
    detail: "Son çalışan sürüm ve geri yüklenebilir yedek bilgisi kaydedilir.",
  },
] as const;

const uatFlows = [
  "kurum yöneticisi girişi",
  "öğretmen işlemleri",
  "veli işlemleri",
  "optik dosya aktarımı",
  "rapor oluşturma",
  "canlı sınav süreci",
  "toplu SMS gönderimi",
  "bildirim gönderimi",
  "kişisel veri silme",
] as const;

const requiredCommands = [
  "pnpm run ci",
  "pnpm prod:env:check",
  "pnpm db:rls:check:live",
  "pnpm raw-import:smoke",
  "pnpm report-generation:smoke",
  "pnpm live:exam-cycle:check",
  "pnpm queue:smoke",
  "pnpm live:onboarding:smoke",
  "pnpm live:ui-worker:smoke",
  "pnpm sms:smoke",
  "pnpm notification:smoke",
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
    detail: "Kabul raporunda bu akışın başarıyla tamamlandığı ve açık sorun kalmadığı gösterilir.",
    key: flow,
    label: flow,
    scope: personaScope(flow),
    tone: "warning",
    value: "Kanıt gerekir",
  }));
  const scenarioRows = buildUatRollbackRows(journeyScenarios, (scenario) => ({
    detail: "Bu kullanıcı yolculuğu kabul raporunda adım adım doğrulanır.",
    key: scenario,
    label: scenario,
    scope: personaScope(scenario),
    tone: "warning",
    value: "Kabul kapsamı",
  }));
  const commandRows = buildUatRollbackRows(requiredCommands, (command) => ({
    detail: command.includes(":live") || command.includes("traefik") ? "Canlı veya deneme ortamı sonucu gerekir." : "Yayınlanacak sürüm için komut sonucu rapora eklenir.",
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
    scope: field === "defects boş" ? "Kabul sonucu" : "Geri dönüş paketi",
    tone: "warning",
    value: "Zorunlu",
  }));

  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="Kullanıcı Kabulü ve Geri Dönüş"
      subtitle="Yeni sürümü kullanıcı akışlarıyla doğrulayın; gerektiğinde önceki sürüme nasıl dönüleceğini hazır tutun."
    >
      <OperationSummary
        actions={summaryActions}
        ariaLabel="Kullanıcı kabulü ve geri dönüş özeti"
        badges={summaryBadges}
        items={summaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="Kullanıcı kabulü ve geri dönüş durumu"
        title="Yayın Öncesi Güvence"
        description="Kabul sonuçlarını ve geri dönüş için gerekli bilgileri gösterir. Canlı sürüm, gerekli onaylar tamamlanmadan değiştirilmez."
        items={[
          {
            label: "Kabul sonucu",
            value: "Başarılı olmalı",
            tone: "warning",
            scope: "staging-prod",
            detail: "Kabul raporu açık sorun kalmayacak şekilde tamamlanır.",
          },
          {
            label: "Geri dönüş",
            value: "Referans gerekir",
            tone: "warning",
            scope: "live-required",
            detail: "Son çalışan sürüm ve geri yüklenebilir yedek bilgisi raporda tutulur.",
          },
          {
            label: "Ekrandan geri dönüş",
            value: "Kapalı",
            tone: "danger",
            scope: "server-audit",
            detail: "İki yetkilinin onayı ve işlem kaydı olmadan canlı sürüm değiştirilmez.",
          },
        ]}
      />
      <OperationDecisionNotice
        decision="Bu ekran yalnızca hazırlık ve kontrol içindir."
        reason="Önceki sürüme dönüş, canlı sistemi ve verileri etkiler. Gerekli onaylar ve yedek bilgisi olmadan buradan başlatılamaz."
        nextStep="Ekrandan geri dönüş özelliği ancak iki yetkilinin onayı ve işlem kaydı tamamlandığında açılabilir."
      />
      <Panel
        aria-label="Yayın öncesi kontroller"
        description="Yayın kararı için kabul, ortam denemeleri ve geri dönüş bilgileri."
        title="Yayın Öncesi Kontroller"
      >
        <DataTable
          caption="Yayın öncesi kabul ve geri dönüş kontrolleri"
          columns={uatRollbackTableColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={gateRows}
        />
      </Panel>
      <Panel
        aria-label="Kullanıcı kabul akışları"
        description="Kurum yöneticisi, öğretmen, veli ve günlük işlemler başarıyla tamamlanmadan yayın kararı verilmez."
        title="Kullanıcı Kabul Akışları"
      >
        <DataTable
          caption="Kullanıcı kabul akışları"
          columns={uatRollbackTableColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={flowRows}
        />
      </Panel>
      <Panel
        aria-label="Kullanıcı yolculuğu senaryoları"
        description="Sistem yöneticisi, kurum, öğretmen, öğrenci ve veli yolculuklarının kontrol listesi."
        title="Kullanıcı Yolculukları"
      >
        <DataTable
          caption="Kullanıcı yolculuğu senaryoları"
          columns={uatRollbackTableColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={scenarioRows}
        />
      </Panel>
      <Panel
        aria-label="Zorunlu komutlar"
        description="Yayınlanacak sürüm ve canlıya benzer ortam için çalıştırılması gereken teknik kontroller."
        title="Zorunlu Komutlar"
      >
        <DataTable
          caption="Yayın öncesi zorunlu komutlar"
          columns={uatRollbackTableColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={commandRows}
        />
      </Panel>
      <Panel
        aria-label="Geri dönüş bilgileri"
        description="Önceki sürüme güvenle dönebilmek için gereken sürüm, yedek ve açık sorun bilgileri."
        title="Geri Dönüş Bilgileri"
      >
        <DataTable
          caption="Geri dönüş için zorunlu bilgiler"
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
    header: "Alan",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.scope,
  },
  {
    key: "detail",
    header: "Açıklama",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.detail,
  },
];

function buildUatRollbackSummaryItems(): OperationSummaryItem[] {
  return [
    {
      description: "Kullanıcı kabul raporu",
      key: "uat-result",
      label: "Kabul sonucu",
      tone: "warning",
      value: "Başarılı olmalı",
    },
    {
      description: "Kontrolün yapıldığı ortam",
      key: "environment",
      label: "Kontrol ortamı",
      tone: "warning",
      value: "Deneme/canlı",
    },
    {
      description: "Son çalışan sürüm ve geri yüklenebilir yedek",
      key: "rollback",
      label: "Geri dönüş",
      tone: "danger",
      value: "Referans gerekir",
    },
    {
      description: "Canlı aksiyon tetikleme",
      key: "panel-action",
      label: "Ekrandan işlem",
      tone: "info",
      value: "Kapalı",
    },
  ];
}

function buildUatRollbackSummaryBadges(): OperationSummaryBadge[] {
  return [
    {
      key: "cli-only",
      label: "Yalnızca kontrol",
      tone: "info",
    },
    {
      key: "release-evidence",
      label: "Yayın raporu ayrı",
      tone: "warning",
    },
    {
      key: "live-required",
      label: "Canlı kanıt gerekir",
      tone: "warning",
    },
    {
      key: "server-audit",
      label: "Onay ve işlem kaydı zorunlu",
      tone: "danger",
    },
  ];
}

function buildUatRollbackSummaryActions(): OperationSummaryAction[] {
  return [
    {
      detail: "Kabul raporu deneme veya canlıya benzer ortam için kontrol edilir",
      key: "uat-evidence",
      label: "Kabul raporu",
      status: "Kanıt raporu",
      tone: "warning",
      value: "Başarılı + açık sorun yok",
    },
    {
      detail: "Dosya aktarımı, rapor üretimi, arka plan işleri ve SMS gönderimi",
      key: "live-smoke",
      label: "Canlı ortam denemeleri",
      status: "Canlı ortam",
      tone: "warning",
      value: "Servis gerekir",
    },
    {
      detail: "Son çalışan sürüm ve geri yüklenebilir yedek birlikte tutulur",
      key: "rollback-packet",
      label: "Geri dönüş paketi",
      status: "Referans gerekir",
      tone: "danger",
      value: "Sürüm + yedek",
    },
    {
      detail: "İki yetkilinin onayı ve işlem kaydı tamamlanmadan buradan başlatılmaz",
      key: "panel-action",
      label: "Ekrandan geri dönüş",
      status: "Kapalı",
      tone: "danger",
      value: "Kapalı",
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
  const normalizedValue = value.toLocaleLowerCase("tr-TR");
  if (normalizedValue.includes("sys")) return "Sistem";
  if (normalizedValue.includes("kurum")) return "Kurum";
  if (normalizedValue.includes("teacher") || normalizedValue.includes("öğretmen")) return "Öğretmen";
  if (normalizedValue.includes("student") || normalizedValue.includes("öğrenci")) return "Öğrenci";
  if (normalizedValue.includes("guardian") || normalizedValue.includes("veli")) return "Veli";
  return "Günlük işlem";
}

function commandScope(command: string) {
  if (command.includes(":live") || command.includes("traefik")) return "Deneme/canlı ortam";
  if (command.includes("prod:env")) return "Canlı ortam ayarları";
  if (command.includes("ci")) return "Yayınlanacak sürüm";
  return "Canlı ortam denemesi";
}

function rollbackFieldDetail(field: string) {
  if (field === "releaseCandidate") return "Yayınlanan sürüm ve kaynak bilgisi izlenir.";
  if (field === "rollbackImageTag") return "Geri dönülebilecek son çalışan sürüm bilgisi zorunludur.";
  if (field === "restoreBackupReference") return "Geri yüklenebilir yedek bilgisi olmadan geri dönüş paketi tamamlanmaz.";
  return "Kabul raporunda açık sorun kalmadığını gösterir.";
}
