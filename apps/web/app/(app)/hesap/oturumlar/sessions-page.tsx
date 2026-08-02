"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeSessionRecord, MeSessionRevokeAllResponse } from "@o-okul/shared-types";
import { Button, DataTable, Panel, StatusBadge, useConfirmDialog, type DataTableColumn } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { PageFrame } from "../../_shared/page-frame.js";

export function SessionsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { auth, logout } = useAuth();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [pendingSessionId, setPendingSessionId] = useState<string>();
  const [actionError, setActionError] = useState("");
  const queryKey = ["me-sessions", auth?.session.userId ?? "anonymous", auth?.session.tenantId ?? "system"];
  const sessionsQuery = useQuery({
    queryKey,
    queryFn: () => apiRequest<MeSessionRecord[]>(auth?.accessToken ?? "", `${apiBaseUrl}/me/sessions`),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const sessions = sessionsQuery.data ?? [];
  const isRevokingAll = pendingSessionId === "all";

  const columns: Array<DataTableColumn<MeSessionRecord>> = [
    {
      key: "device",
      header: "Cihaz",
      priority: "primary",
      sticky: "left",
      render: (session) => (
        <span>
          {session.deviceLabel} {session.current ? <StatusBadge tone="info">Bu oturum</StatusBadge> : null}
        </span>
      ),
    },
    {
      key: "persona",
      header: "Çalışma alanı",
      priority: "secondary",
      render: (session) => personaLabel(session),
    },
    {
      key: "network",
      header: "Yaklaşık ağ",
      priority: "optional",
      render: (session) => session.clientIpPrefix ?? "Kaydedilmedi",
    },
    {
      key: "lastSeen",
      header: "Son etkinlik",
      priority: "primary",
      render: (session) => formatDateTime(session.lastSeenAt),
    },
    {
      key: "expires",
      header: "Geçerlilik sonu",
      priority: "optional",
      render: (session) => formatDateTime(session.expiresAt),
    },
    {
      key: "actions",
      align: "right",
      header: "İşlem",
      priority: "primary",
      sticky: "right",
      render: (session) => (
        <Button
          disabled={Boolean(pendingSessionId)}
          loading={pendingSessionId === session.id}
          loadingLabel="Oturum kapatılıyor"
          onClick={() => void handleRevoke(session)}
          size="sm"
          type="button"
          variant={session.current ? "danger" : "secondary"}
        >
          {session.current ? "Bu cihazdan çık" : "Oturumu kapat"}
        </Button>
      ),
    },
  ];

  async function handleRevoke(session: MeSessionRecord) {
    if (!auth) return;
    const accepted = await confirm({
      title: session.current ? "Bu cihazdaki oturum kapatılsın mı?" : "Oturum kapatılsın mı?",
      description: session.current
        ? "Onaydan sonra giriş ekranına yönlendirilirsiniz."
        : `${session.deviceLabel} yeniden giriş yapmak zorunda kalır.`,
      confirmLabel: session.current ? "Çıkış yap" : "Oturumu kapat",
    });
    if (!accepted) return;

    setPendingSessionId(session.id);
    setActionError("");
    try {
      const response = await authenticatedFetch(auth.accessToken, `${apiBaseUrl}/me/sessions/${encodeURIComponent(session.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("SESSION_REVOKE_FAILED");
      if (session.current) {
        await leaveApplication();
        return;
      }
      await queryClient.invalidateQueries({ queryKey });
    } catch {
      setActionError("Oturum kapatılamadı. Yenileyip tekrar deneyin.");
    } finally {
      setPendingSessionId(undefined);
    }
  }

  async function handleRevokeAll() {
    if (!auth || sessions.length === 0) return;
    const accepted = await confirm({
      title: "Tüm oturumlar kapatılsın mı?",
      description: "Bu cihaz dahil tüm aktif oturumlar kapatılır ve yeniden giriş gerekir.",
      confirmLabel: "Tümünü kapat",
    });
    if (!accepted) return;

    setPendingSessionId("all");
    setActionError("");
    try {
      await apiRequest<MeSessionRevokeAllResponse>(auth.accessToken, `${apiBaseUrl}/me/sessions`, { method: "DELETE" });
      await leaveApplication();
    } catch {
      setActionError("Oturumlar kapatılamadı. Yenileyip tekrar deneyin.");
    } finally {
      setPendingSessionId(undefined);
    }
  }

  async function leaveApplication() {
    const loginPath = auth?.session.roles.includes("SYSTEM_ADMIN") ? "/sistem-giris" : "/giris";
    await logout();
    router.replace(loginPath);
  }

  return (
    <PageFrame
      actions={(
        <Button
          disabled={sessions.length === 0 || Boolean(pendingSessionId)}
          loading={isRevokingAll}
          loadingLabel="Oturumlar kapatılıyor"
          onClick={() => void handleRevokeAll()}
          type="button"
          variant="danger"
        >
          Tüm oturumları kapat
        </Button>
      )}
      subtitle="Hesabınızın açık olduğu cihazları görün ve tanımadığınız oturumları kapatın."
      title="Oturumlar"
    >
      <Panel
        description="Gizlilik için tam IP adresi ve ham tarayıcı bilgisi saklanmaz; yalnız cihaz özeti ve yaklaşık ağ aralığı gösterilir."
        title={`${sessions.length} aktif oturum`}
      >
        <DataTable
          aria-label="Aktif hesap oturumları"
          caption="Aktif oturumlar"
          columns={columns}
          description="Cihaz, çalışma alanı, son etkinlik ve oturum kapatma işlemleri."
          emptyText="Aktif oturum bulunamadı"
          error={sessionsQuery.isError ? "Oturumlar alınamadı." : undefined}
          getRowKey={(session) => session.id}
          loading={sessionsQuery.isPending}
          rows={sessions}
        />
        {actionError ? <p className="next-status-note" role="alert">{actionError}</p> : null}
      </Panel>
      {confirmationDialog}
    </PageFrame>
  );
}

function personaLabel(session: MeSessionRecord) {
  if (session.activePersona === "STAFF") return "Kurum";
  if (session.activePersona === "TEACHER") return "Öğretmen";
  if (session.activePersona === "STUDENT") return "Öğrenci";
  if (session.roles.includes("SYSTEM_ADMIN")) return "Sistem";
  if (session.roles.includes("GUARDIAN")) return "Veli";
  return "Hesap";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
