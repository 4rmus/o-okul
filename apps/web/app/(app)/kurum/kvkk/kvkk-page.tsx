"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, EmptyState, type DataTableColumn } from "@uzman-hocam/ui";
import type { GuardianRecord, StudentRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiRequest } from "../../../../src/api-client.js";

type KvkkRecord =
  | { kind: "student"; record: StudentRecord }
  | { kind: "teacher"; record: TeacherRecord }
  | { kind: "guardian"; record: GuardianRecord };

export function KvkkPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
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
  const columns: Array<DataTableColumn<KvkkRecord>> = [
    {
      key: "name",
      header: "Kayıt",
      render: (item) => `${item.record.firstName} ${item.record.lastName}`,
    },
    {
      key: "kind",
      header: "Tür",
      render: (item) => kindLabel(item.kind),
    },
    {
      key: "pii",
      header: "PII",
      render: (item) => piiSummary(item),
    },
    {
      key: "actions",
      header: "İşlem",
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
    <CrudPage
      aria-label="KVKK yönetimi"
      columns={columns}
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
      loading={studentsQuery.isPending || teachersQuery.isPending || guardiansQuery.isPending}
      rows={rows}
      title="KVKK"
    />
  );
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

function piiSummary(item: KvkkRecord) {
  if (item.kind === "guardian") {
    return item.record.phone ? "Ad, soyad, telefon" : "Ad, soyad";
  }
  return "Ad, soyad";
}
