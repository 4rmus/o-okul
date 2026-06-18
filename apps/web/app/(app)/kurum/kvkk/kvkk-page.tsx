"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, EmptyState, StatusBadge, type DataTableColumn, useConfirmDialog } from "@uzman-hocam/ui";
import type { GuardianRecord, StudentRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiRequest } from "../../../../src/api-client.js";
import { EvidenceTrustPanel } from "../_shared/evidence-panels.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

type KvkkRecord =
  | { kind: "student"; record: StudentRecord }
  | { kind: "teacher"; record: TeacherRecord }
  | { kind: "guardian"; record: GuardianRecord };

type KvkkCategoryProbe = {
  email?: string;
  nationalId?: string;
  phone?: string;
};

export function KvkkPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [error, setError] = useState("");
  const studentsKey = ["next-students", auth?.session.tenantId ?? "anonymous"];
  const teachersKey = ["next-teachers", auth?.session.tenantId ?? "anonymous"];
  const guardiansKey = ["next-guardians", auth?.session.tenantId ?? "anonymous"];
  const studentsQuery = useQuery({
    queryKey: studentsKey,
    queryFn: () => apiRequest<StudentRecord[]>(auth?.accessToken ?? "", `${apiBaseUrl}/students`),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const teachersQuery = useQuery({
    queryKey: teachersKey,
    queryFn: () => apiRequest<TeacherRecord[]>(auth?.accessToken ?? "", `${apiBaseUrl}/teachers`),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const guardiansQuery = useQuery({
    queryKey: guardiansKey,
    queryFn: () => apiRequest<GuardianRecord[]>(auth?.accessToken ?? "", `${apiBaseUrl}/guardians`),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const rows: KvkkRecord[] = [
    ...(studentsQuery.data ?? []).map((record) => ({ kind: "student" as const, record })),
    ...(teachersQuery.data ?? []).map((record) => ({ kind: "teacher" as const, record })),
    ...(guardiansQuery.data ?? []).map((record) => ({ kind: "guardian" as const, record })),
  ];
  const isLoading = studentsQuery.isPending || teachersQuery.isPending || guardiansQuery.isPending;
  const hasError = studentsQuery.isError || teachersQuery.isError || guardiansQuery.isError || Boolean(error);
  const summaryItems = buildKvkkSummaryItems(rows, isLoading, hasError);
  const summaryBadges = buildKvkkSummaryBadges(rows);
  const summaryActions = buildKvkkSummaryActions(rows);
  const columns: Array<DataTableColumn<KvkkRecord>> = [
    {
      key: "name",
      header: "Kayıt",
      mobilePriority: "primary",
      priority: "primary",
      render: (item) => `${item.record.firstName} ${item.record.lastName}`,
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
          <button
            type="button"
            onClick={() => void handlePurge(item)}
            aria-label={`${item.record.firstName} PII temizle`}
            disabled={item.record.firstName === "Anonim"}
          >
            <ShieldCheck size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  async function handlePurge(item: KvkkRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "PII temizle",
      description: "Bu işlem server tarafında uygulanır ve audit kaydı esas alınır; panel ham PII kanıtı göstermez.",
      message: `${kindLabel(item.kind)} kaydında geri alınamaz PII temizleme işlemi başlatılsın mı?`,
      title: "PII temizlemeyi onayla",
    });
    if (!confirmed) return;

    setError("");
    try {
      if (item.kind === "student") {
        const purged = await purgeRecord<StudentRecord>(auth.accessToken, "students", item.record.id);
        queryClient.setQueryData<StudentRecord[]>(studentsKey, (current = []) =>
          current.map((record) => (record.id === purged.id ? purged : record)),
        );
        return;
      }
      if (item.kind === "teacher") {
        const purged = await purgeRecord<TeacherRecord>(auth.accessToken, "teachers", item.record.id);
        queryClient.setQueryData<TeacherRecord[]>(teachersKey, (current = []) =>
          current.map((record) => (record.id === purged.id ? purged : record)),
        );
        return;
      }
      const purged = await purgeRecord<GuardianRecord>(auth.accessToken, "guardians", item.record.id);
      queryClient.setQueryData<GuardianRecord[]>(guardiansKey, (current = []) =>
        current.map((record) => (record.id === purged.id ? purged : record)),
      );
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
          (studentsQuery.isError
            ? apiErrorMessage(studentsQuery.error, "KVKK kayıtları alınamadı.")
            : teachersQuery.isError
              ? apiErrorMessage(teachersQuery.error, "KVKK kayıtları alınamadı.")
              : guardiansQuery.isError
                ? apiErrorMessage(guardiansQuery.error, "KVKK kayıtları alınamadı.")
                : undefined)
        }
        getRowKey={(item) => `${item.kind}:${item.record.id}`}
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

function buildKvkkSummaryItems(rows: KvkkRecord[], isLoading: boolean, hasError: boolean): OperationSummaryItem[] {
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

function buildKvkkSummaryBadges(rows: KvkkRecord[]): OperationSummaryBadge[] {
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

function buildKvkkSummaryActions(rows: KvkkRecord[]): OperationSummaryAction[] {
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

async function purgeRecord<TRecord>(accessToken: string, resource: string, id: string) {
  return apiRequest<TRecord>(accessToken, `${apiBaseUrl}/${resource}/${encodeURIComponent(id)}/purge-pii`, {
    method: "POST",
  });
}

function kindLabel(kind: KvkkRecord["kind"]) {
  if (kind === "student") return "Öğrenci";
  if (kind === "teacher") return "Öğretmen";
  return "Veli";
}

function kindTone(kind: KvkkRecord["kind"]) {
  if (kind === "guardian") return "warning";
  if (kind === "teacher") return "info";
  return "neutral";
}

function piiSummary(item: KvkkRecord) {
  return piiCategories(item).join(", ");
}

function piiSummaryTone(item: KvkkRecord) {
  return piiCategories(item).length > 2 || item.kind === "guardian" ? "warning" : "info";
}

function piiCategories(item: KvkkRecord) {
  const categories = ["Ad", "soyad"];
  const record = item.record as KvkkCategoryProbe;
  if (record.nationalId) categories.push("TC");
  if (record.email) categories.push("e-posta");
  if (record.phone) categories.push("telefon");
  return categories;
}
