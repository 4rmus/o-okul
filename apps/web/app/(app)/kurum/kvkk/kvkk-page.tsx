"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, EmptyState, StatusBadge, type DataTableColumn, useConfirmDialog } from "@o-okul/ui";
import type { KvkkInventoryKind, KvkkInventoryRecord } from "@o-okul/shared-types";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiRequest } from "../../../../src/api-client.js";
import { EvidenceTrustPanel } from "../_shared/evidence-panels.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

export function KvkkPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [error, setError] = useState("");
  const inventoryKey = ["next-kvkk-inventory", auth?.session.tenantId ?? "anonymous"];
  const inventoryQuery = useQuery({
    queryKey: inventoryKey,
    queryFn: () => apiRequest<KvkkInventoryRecord[]>(auth?.accessToken ?? "", `${apiBaseUrl}/privacy/inventory`),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const rows = inventoryQuery.data ?? [];
  const isLoading = inventoryQuery.isPending;
  const hasError = inventoryQuery.isError || Boolean(error);
  const summaryItems = buildKvkkSummaryItems(rows, isLoading, hasError);
  const summaryBadges = buildKvkkSummaryBadges(rows);
  const summaryActions = buildKvkkSummaryActions(rows);
  const columns: Array<DataTableColumn<KvkkInventoryRecord>> = [
    {
      key: "name",
      header: "Kayıt",
      mobilePriority: "primary",
      priority: "primary",
      render: (item) => item.displayRef,
      sticky: "left",
    },
    {
      key: "kind",
      header: "Tür",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (item) => <StatusBadge tone={kindTone(item.kind)}>{kindLabel(item.kind)}</StatusBadge>,
    },
    {
      key: "pii",
      header: "PII",
      mobilePriority: "primary",
      priority: "primary",
      render: (item) => <StatusBadge tone={piiSummaryTone(item)}>{piiSummary(item)}</StatusBadge>,
    },
    {
      key: "actions",
      header: "İşlem",
      align: "right",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (item) => (
        <span className="next-row-actions">
          <Button size="icon" variant="ghost"
            type="button"
            onClick={() => void handlePurge(item)}
            aria-label={`${item.displayRef} PII temizle`}
            disabled={!item.purgeAvailable}
          >
            <ShieldCheck size={17} aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ];

  async function handlePurge(item: KvkkInventoryRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "PII temizle",
      description: "Bu işlem server tarafında uygulanır ve audit kaydı esas alınır; panel ham PII kanıtı göstermez.",
      message: `${item.displayRef} için geri alınamaz PII temizleme işlemi başlatılsın mı?`,
      title: "PII temizlemeyi onayla",
    });
    if (!confirmed) return;

    setError("");
    try {
      await purgeRecord(auth.accessToken, kindResource(item.kind), item.id);
      await queryClient.invalidateQueries({ queryKey: inventoryKey });
    } catch (purgeError) {
      setError(apiErrorMessage(purgeError, "PII temizlenemedi."));
    }
  }

  return (
    <>
      <OperationSummary
        actions={summaryActions}
        ariaLabel="KVKK operasyon özeti"
        badges={summaryBadges}
        items={summaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="KVKK güven durumu"
        title="PII İşlem Güvencesi"
        description="KVKK ekranı ham kişisel veriyi kanıt metnine taşımadan kayıt türünü, riskini ve server kaynaklı temizleme aksiyonunu gösterir."
        items={[
          {
            label: "İşlem türü",
            value: "Onaylı purge",
            tone: "warning",
            scope: "server-audit",
            detail: "Geri alınamaz PII temizleme işlemi dialog onayı olmadan POST edilmez.",
          },
          {
            label: "Kanıt kaynağı",
            value: "Server/audit",
            tone: "info",
            scope: "server-audit",
            detail: "Panel cache günceller; nihai doğruluk server sonucu ve audit kaydındadır.",
          },
          {
            label: "Ekran verisi",
            value: "PII özeti",
            tone: "success",
            scope: "ui-safe",
            detail: "Telefon veya TC gibi ham değerler yerine veri kategorisi gösterilir.",
          },
        ]}
      />
      <CrudPage
        aria-label="KVKK yönetimi"
        columns={columns}
        density="compact"
        description="Öğrenci, öğretmen ve veli PII temizleme işlemlerini tek ekrandan yönet."
        emptyState={
          <EmptyState
            title="Temizlenecek kayıt yok"
            description="Öğrenci, öğretmen veya veli kaydı oluştuğunda PII temizleme seçenekleri burada görünür."
            hint="PII temizleme işlemleri geri alınamaz; kayıt oluşmadan aksiyon gösterilmez."
          />
        }
        emptyText="Temizlenecek kayıt yok"
        error={
          error ||
          (inventoryQuery.isError
            ? apiErrorMessage(inventoryQuery.error, "KVKK kayıtları alınamadı.")
            : undefined)
        }
        getRowKey={(item) => `${item.kind}:${item.id}`}
        loading={isLoading}
        rows={rows}
        tableCaption="KVKK PII temizleme kayıtları"
        tableDescription="Kayıt türü ve PII kategorisi gösterilir; TC, telefon ve e-posta gibi ham değerler tabloya basılmaz."
        title="KVKK"
      />
      {confirmationDialog}
    </>
  );
}

function buildKvkkSummaryItems(rows: KvkkInventoryRecord[], isLoading: boolean, hasError: boolean): OperationSummaryItem[] {
  return [
    {
      description: "Öğrenci, öğretmen ve veli kayıtları",
      key: "records",
      label: "Kayıt toplamı",
      tone: hasError ? "danger" : isLoading ? "default" : "info",
      value: isLoading ? "Yükleniyor" : rows.length.toLocaleString("tr-TR"),
    },
    {
      description: "Ham değer yerine kategori bilgisi",
      key: "pii-scope",
      label: "PII kapsamı",
      tone: "success",
      value: "Kategori",
    },
    {
      description: "Dialog onayı olmadan purge POST edilmez",
      key: "confirmation",
      label: "Purge onayı",
      tone: "warning",
      value: "Zorunlu",
    },
    {
      description: "Nihai doğruluk server sonucu ve audit kaydındadır",
      key: "authority",
      label: "Kanıt kaynağı",
      tone: "info",
      value: "Server/audit",
    },
  ];
}

function buildKvkkSummaryBadges(rows: KvkkInventoryRecord[]): OperationSummaryBadge[] {
  const guardianCount = rows.filter((row) => row.kind === "guardian").length;
  return [
    {
      key: "pii-safe",
      label: "PII ham gösterilmez",
      tone: "success",
    },
    {
      key: "category-inventory",
      label: "Kategori bazlı envanter",
      tone: "info",
    },
    {
      key: "server-audit",
      label: "Server/audit esas",
      tone: "info",
    },
    {
      key: "confirmation",
      label: "Onay zorunlu",
      tone: "warning",
    },
    {
      key: "guardian",
      label: `${guardianCount.toLocaleString("tr-TR")} veli kaydı`,
      tone: guardianCount > 0 ? "warning" : "neutral",
    },
  ];
}

function buildKvkkSummaryActions(rows: KvkkInventoryRecord[]): OperationSummaryAction[] {
  return [
    {
      detail: "POST yalnız dialog onayından sonra gönderilir",
      key: "confirmed-purge",
      label: "Purge akışı",
      status: "Onay gerekir",
      tone: "warning",
      value: "Server action",
    },
    {
      detail: "Panel cache günceller; audit kaydı server tarafında esas alınır",
      key: "audit",
      label: "Audit doğruluğu",
      status: "Server/audit",
      tone: "info",
      value: "Nihai kaynak",
    },
    {
      detail: "Tablo ham TC, telefon veya e-posta yerine veri kategorisi gösterir",
      key: "ui-safe",
      label: "UI görünümü",
      status: "PII-safe",
      tone: "success",
      value: `${rows.length.toLocaleString("tr-TR")} kayıt`,
    },
  ];
}

async function purgeRecord(accessToken: string, resource: string, id: string) {
  return apiRequest<unknown>(accessToken, `${apiBaseUrl}/${resource}/${encodeURIComponent(id)}/purge-pii`, {
    method: "POST",
  });
}

function kindResource(kind: KvkkInventoryKind) {
  if (kind === "student") return "students";
  if (kind === "teacher") return "teachers";
  return "guardians";
}

function kindLabel(kind: KvkkInventoryKind) {
  if (kind === "student") return "Öğrenci";
  if (kind === "teacher") return "Öğretmen";
  return "Veli";
}

function kindTone(kind: KvkkInventoryKind) {
  if (kind === "guardian") return "warning";
  if (kind === "teacher") return "info";
  return "neutral";
}

function piiSummary(item: KvkkInventoryRecord) {
  return piiCategories(item).join(", ") || "Temiz";
}

function piiSummaryTone(item: KvkkInventoryRecord) {
  return piiCategories(item).length > 2 || item.kind === "guardian" ? "warning" : "info";
}

function piiCategories(item: KvkkInventoryRecord) {
  return item.piiCategories;
}
