"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  StudentPortalAccessRecord,
  StudentPortalAccessUpdateRequest,
  StudentPortalAccessUpdateResult,
  StudentPortalInvitationIssueResponse,
} from "@o-okul/shared-types";
import {
  Button,
  CrudPage,
  Dialog,
  EmptyState,
  Field,
  FilterBar,
  Input,
  Select,
  StatusBadge,
  type DataTableColumn,
  type StatusBadgeProps,
} from "@o-okul/ui";
import { ChevronLeft, ChevronRight, Copy, KeyRound, Search, ShieldCheck, ShieldOff } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiCursorListRequest, apiErrorMessage, apiRequest } from "../../../../src/api-client.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

interface PortalQuery {
  cursor?: string;
  direction: "next" | "previous";
  limit: number;
  q: string;
}

const initialQuery: PortalQuery = { direction: "next", limit: 20, q: "" };

export function StudentPortalAccessPage() {
  const { auth } = useAuth();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState("");
  const [issuedInvitation, setIssuedInvitation] = useState<StudentPortalInvitationIssueResponse>();
  const [query, setQuery] = useState<PortalQuery>(initialQuery);
  const accessQuery = useQuery({
    queryKey: ["student-portal-access", tenantId, query],
    queryFn: () => apiCursorListRequest<StudentPortalAccessRecord>(
      auth?.accessToken ?? "",
      buildPortalAccessUrl(query),
    ),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const records = accessQuery.data?.data ?? [];
  const meta = accessQuery.data?.meta;
  const accessMutation = useMutation({
    mutationFn: ({ record, status }: { record: StudentPortalAccessRecord; status: StudentPortalAccessUpdateRequest["status"] }) =>
      apiRequest<StudentPortalAccessUpdateResult>(
        auth?.accessToken ?? "",
        `${apiBaseUrl}/students/${record.studentId}/portal-access`,
        {
          body: JSON.stringify({ expectedVersion: record.membership?.version, status }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      ),
    onSuccess: () => {
      setActionError("");
      void accessQuery.refetch();
    },
    onError: (error) => setActionError(apiErrorMessage(error, "Portal erişimi güncellenemedi. Listeyi yenileyip tekrar deneyin.")),
  });
  const invitationMutation = useMutation({
    mutationFn: (record: StudentPortalAccessRecord) => apiRequest<StudentPortalInvitationIssueResponse>(
      auth?.accessToken ?? "",
      `${apiBaseUrl}/students/${record.studentId}/portal-invitations`,
      { method: "POST" },
    ),
    onSuccess: (invitation) => {
      setActionError("");
      setIssuedInvitation(invitation);
      void accessQuery.refetch();
    },
    onError: (error) => setActionError(apiErrorMessage(error, "Aktivasyon kodu üretilemedi. Listeyi yenileyip tekrar deneyin.")),
  });
  const columns: Array<DataTableColumn<StudentPortalAccessRecord>> = [
    {
      key: "name",
      header: "Öğrenci",
      priority: "primary",
      sticky: "left",
      render: (record) => `${record.firstName} ${record.lastName}`,
    },
    { key: "studentNo", header: "Öğrenci no", priority: "secondary", render: (record) => record.studentNo ?? "-" },
    {
      key: "studentStatus",
      header: "Öğrenci durumu",
      priority: "secondary",
      render: (record) => studentStatusLabel(record.studentStatus),
    },
    {
      key: "accessState",
      header: "Portal erişimi",
      priority: "primary",
      render: (record) => <StatusBadge tone={accessTone(record.accessState)}>{accessLabel(record.accessState)}</StatusBadge>,
    },
    {
      key: "account",
      header: "Hesap / üyelik",
      priority: "secondary",
      render: (record) => record.membership
        ? `${record.accountStatus ?? "-"} · ${record.membership.status} · v${record.membership.version}`
        : record.invitation
          ? `${record.invitation.kind === "STUDENT_CODE" ? "Aktivasyon kodu üretildi" : record.invitation.emailMasked ?? "E-posta daveti"} · davet bekliyor`
          : "Bağlı değil",
    },
    {
      key: "sessions",
      header: "Aktif oturum",
      priority: "optional",
      render: (record) => formatCount(record.activeSessionCount),
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      priority: "primary",
      sticky: "right",
      render: (record) => {
        if (!record.membership) {
          if (record.studentStatus !== "ACTIVE") return "-";
          const label = record.invitation ? "Yeni aktivasyon kodu üret" : "Aktivasyon kodu üret";
          return (
            <Button
              aria-label={`${record.firstName} ${record.lastName}: ${label}`}
              disabled={invitationMutation.isPending}
              onClick={() => invitationMutation.mutate(record)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <KeyRound size={17} aria-hidden="true" />
            </Button>
          );
        }
        if (record.membership.status === "ENDED") return "-";
        const nextStatus = record.membership.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
        const disabled = accessMutation.isPending || (nextStatus === "ACTIVE" && record.studentStatus !== "ACTIVE");
        const label = nextStatus === "ACTIVE" ? "Portal erişimini aç" : "Portal erişimini askıya al";
        return (
          <Button
            aria-label={`${record.firstName} ${record.lastName}: ${label}`}
            disabled={disabled}
            onClick={() => {
              if (nextStatus === "SUSPENDED" && !window.confirm(`${record.firstName} ${record.lastName} portal erişimi askıya alınsın mı? Aktif oturumlar kapatılır.`)) return;
              accessMutation.mutate({ record, status: nextStatus });
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            {nextStatus === "ACTIVE" ? <ShieldCheck size={17} aria-hidden="true" /> : <ShieldOff size={17} aria-hidden="true" />}
          </Button>
        );
      },
    },
  ];
  const summaryItems: OperationSummaryItem[] = [
    {
      key: "shown",
      label: "Bu sayfa",
      description: "Cursor ile getirilen öğrenci",
      value: formatCount(records.length),
    },
    {
      key: "active",
      label: "Portal erişimi açık",
      description: "Bu sayfadaki ACTIVE kayıtlar",
      value: formatCount(records.filter((record) => record.accessState === "ACTIVE").length),
      tone: "success",
    },
    {
      key: "attention",
      label: "İncelenecek",
      description: "Askıda veya tutarsız erişim",
      value: formatCount(records.filter((record) => record.accessState === "SUSPENDED" || record.accessState === "INCONSISTENT").length),
      tone: records.some((record) => record.accessState === "INCONSISTENT") ? "warning" : "default",
    },
  ];
  const badges: OperationSummaryBadge[] = [
    { key: "cursor", label: "Cursor liste", tone: "info" },
    { key: "pii", label: "E-posta maskeli", tone: "neutral" },
  ];

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery((current) => ({ direction: "next", limit: current.limit, q: search.trim() }));
  }

  return (
    <>
      <CrudPage
        actions={
          <form onSubmit={submitSearch}>
            <FilterBar role="search" aria-label="Öğrenci portal erişimi filtreleri">
              <Field label="Ara">
                <Search size={17} aria-hidden="true" />
                <Input
                  aria-label="Öğrenci, numara veya yetkili e-posta ara"
                  placeholder="Öğrenci, numara veya e-posta"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </Field>
              <Button type="submit" variant="secondary">Ara</Button>
              <Field label="Göster">
                <Select
                  value={query.limit}
                  onChange={(event) => setQuery({ direction: "next", limit: Number(event.target.value), q: query.q })}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </Select>
              </Field>
              <Button
                aria-label="Önceki cursor sayfası"
                disabled={!meta?.previousCursor}
                onClick={() => meta?.previousCursor && setQuery((current) => ({ ...current, cursor: meta.previousCursor, direction: "previous" }))}
                type="button"
                variant="secondary"
              >
                <ChevronLeft size={17} aria-hidden="true" />
                Önceki
              </Button>
              <Button
                aria-label="Sonraki cursor sayfası"
                disabled={!meta?.nextCursor}
                onClick={() => meta?.nextCursor && setQuery((current) => ({ ...current, cursor: meta.nextCursor, direction: "next" }))}
                type="button"
                variant="secondary"
              >
                Sonraki
                <ChevronRight size={17} aria-hidden="true" />
              </Button>
            </FilterBar>
          </form>
        }
        aria-label="Öğrenci portal erişimi"
        columns={columns}
        density="compact"
        description="Öğrenci kaydını portal daveti, tenant hesabı, canonical üyelik ve aktif session sayısıyla birlikte gösterir."
        emptyState={<EmptyState title="Erişim kaydı yok" description="Arama ve tenant kapsamında öğrenci bulunamadı." />}
        emptyText="Öğrenci portal erişim kaydı yok"
        error={actionError || (accessQuery.isError ? "Öğrenci portal erişimleri alınamadı." : undefined)}
        getRowKey={(record) => record.studentId}
        loading={accessQuery.isPending}
        rows={records}
        summary={<OperationSummary ariaLabel="Öğrenci portal erişim özeti" badges={badges} items={summaryItems} />}
        tableCaption="Öğrenci portal erişimleri"
        tableDescription="Öğrenci, hesap, üyelik, davet ve aktif oturum durumu."
        title="Öğrenci Portal Erişimi"
      />
      <Dialog
        description="Bu bilgi yalnız bu kez gösterilir. Güvenli biçimde öğrenciye iletin; ekranı kapattıktan sonra kod yeniden görüntülenemez."
        footer={(
          <Button onClick={() => setIssuedInvitation(undefined)} type="button">Tamam</Button>
        )}
        onClose={() => setIssuedInvitation(undefined)}
        open={Boolean(issuedInvitation)}
        title="Öğrenci aktivasyon kodu"
      >
        {issuedInvitation ? (
          <div className="next-form">
            <Field label="Öğrenci numarası">
              <Input readOnly value={issuedInvitation.studentNo} />
            </Field>
            <Field label="12 karakterlik kod">
              <Input readOnly value={issuedInvitation.activationCode} />
            </Field>
            <Field label="Aktivasyon bağlantısı">
              <Input readOnly value={issuedInvitation.activationUrl} />
            </Field>
            <p className="next-status-note">Son geçerlilik: {new Date(issuedInvitation.expiresAt).toLocaleString("tr-TR")}</p>
            <Button
              onClick={() => void navigator.clipboard.writeText(issuedInvitation.activationUrl)
                .catch(() => setActionError("Bağlantı panoya kopyalanamadı."))}
              type="button"
              variant="secondary"
            >
              <Copy size={17} aria-hidden="true" />
              Bağlantıyı kopyala
            </Button>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

function buildPortalAccessUrl(query: PortalQuery) {
  const params = new URLSearchParams({ direction: query.direction, limit: String(query.limit) });
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.q) params.set("q", query.q);
  return `${apiBaseUrl}/students/portal-access?${params.toString()}`;
}

function accessLabel(state: StudentPortalAccessRecord["accessState"]) {
  if (state === "ACTIVE") return "Aktif";
  if (state === "SUSPENDED") return "Askıda";
  if (state === "INVITED") return "Davet bekliyor";
  if (state === "NOT_INVITED") return "Hesap yok";
  return "Tutarsız bağlantı";
}

function accessTone(state: StudentPortalAccessRecord["accessState"]): StatusBadgeProps["tone"] {
  if (state === "ACTIVE") return "success";
  if (state === "INVITED" || state === "NOT_INVITED") return "warning";
  return "danger";
}

function studentStatusLabel(status: StudentPortalAccessRecord["studentStatus"]) {
  if (status === "ACTIVE") return "Aktif";
  if (status === "PASSIVE") return "Pasif";
  if (status === "GRADUATED") return "Mezun";
  return "Nakil";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}
