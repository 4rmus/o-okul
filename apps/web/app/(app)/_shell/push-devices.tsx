"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Panel, StatusBadge, type StatusBadgeProps } from "@o-okul/ui";
import { type AuthResponse, type NotificationDeviceTokenRecord } from "@o-okul/shared-types";
import { useAuth } from "../../providers.js";
import { apiBaseUrl, apiRequest, readData, registerPushForCurrentSession } from "../../../src/api-client.js";
import { readPushBinding, retireWebPushBinding } from "../../../src/web-push-lifecycle.js";

/** Requests the browser permission, subscribes the service worker and registers the device at `/me/notification-devices`. */
export async function registerWebPushDevice(session: AuthResponse["session"] | undefined): Promise<NotificationDeviceTokenRecord> {
  if (!session) throw new Error("AUTH_CONTEXT_CHANGED");
  if (!("Notification" in window)) throw new Error("WEB_PUSH_UNSUPPORTED");
  if (await Notification.requestPermission() !== "granted") throw new Error("WEB_PUSH_PERMISSION_DENIED");
  return registerPushForCurrentSession(session, async (accessToken) => {
    const token = await resolveWebPushToken();
    const response = await fetch(`${apiBaseUrl}/me/notification-devices`, {
      body: JSON.stringify({ provider: "web-push", token, platform: "web" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      method: "POST",
    });
    if (!response.ok) throw new Error("WEB_PUSH_REGISTRATION_FAILED");
    return readData<NotificationDeviceTokenRecord>(response);
  });
}

export function PushDevicePanel({ accessToken }: { accessToken: string }) {
  const { auth } = useAuth();
  const [devices, setDevices] = useState<NotificationDeviceTokenRecord[]>([]);
  const [status, setStatus] = useState("Hazır");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;
    apiRequest<NotificationDeviceTokenRecord[]>(accessToken, `${apiBaseUrl}/me/notification-devices`)
      .then((records) => {
        if (isMounted) setDevices(Array.isArray(records) ? records : []);
      })
      .catch(() => {
        if (isMounted) setStatus("Cihaz bilgisi alınamadı");
      });
    return () => {
      isMounted = false;
    };
  }, [accessToken]);

  async function handleRegister() {
    setIsSaving(true);
    try {
      const record = await registerWebPushDevice(auth?.session);
      setDevices((current) => [record, ...current.filter((device) => device.id !== record.id)]);
      setStatus("Push açık");
    } catch (error) {
      setStatus(error instanceof Error ? humanizePushError(error.message) : "Push açılamadı");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDisable(id: string) {
    setIsSaving(true);
    try {
      const record = await apiRequest<NotificationDeviceTokenRecord>(accessToken, `${apiBaseUrl}/me/notification-devices/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await retireWebPushBinding(id);
      setDevices((current) => current.map((device) => (device.id === id ? record : device)));
      setStatus("Cihaz kapatıldı");
    } catch {
      setStatus("Cihaz kapatılamadı");
    } finally {
      setIsSaving(false);
    }
  }

  const activeDevices = devices.filter((device) => !device.disabledAt);
  const latestDevice = activeDevices[0];
  const statusLabel = isSaving ? "İşleniyor" : status;
  const statusTone = getPushStatusTone(status, activeDevices.length, isSaving);

  return (
    <Panel
      actions={<StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>}
      aria-label="Bildirim cihazı"
      as="aside"
      className="next-push-panel"
      description={`${activeDevices.length} aktif cihaz`}
      title="Bildirim cihazı"
    >
      <div className="next-push-panel__actions">
        <Button disabled={isSaving} onClick={() => void handleRegister()} size="sm">
          Push iznini aç
        </Button>
        {latestDevice ? (
          <Button
            disabled={isSaving}
            onClick={() => void handleDisable(latestDevice.id)}
            size="sm"
            variant="secondary"
          >
            Cihazı kapat
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * UAT F-29: a compact reminder inside a portal when web push is enabled for this build but this browser has not
 * granted the permission yet. It reuses the same registration flow as the sidebar "Bildirim cihazı" panel.
 * Rendered only on the client; an origin's granted permission still needs this account's explicit registration.
 */
export function PushPermissionPrompt({ accessToken }: { accessToken: string }) {
  const { auth } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [hasBinding, setHasBinding] = useState(true);

  useEffect(() => {
    setPermission(readPushPermissionState());
    setMessage("");
    void readPushBinding().then((binding) => setHasBinding(Boolean(binding?.owner && binding.deviceId)), () => setHasBinding(false));
  }, [accessToken]);

  // Browser permission belongs to the origin; each account must explicitly opt in after an ownership reset.
  if (!permission || (hasBinding && !message)) return null;

  async function handleEnable() {
    setIsSaving(true);
    setMessage("");
    try {
      await registerWebPushDevice(auth?.session);
      setHasBinding(true);
      setMessage("Push açıldı; bu cihaz bildirim alacak.");
      setPermission("granted");
    } catch (error) {
      setMessage(error instanceof Error ? humanizePushError(error.message) : "Push açılamadı");
      setPermission(readPushPermissionState() ?? "default");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Alert
      aria-label="Push bildirim hatırlatması"
      className="next-push-prompt"
      title={hasBinding && permission === "granted" ? "Push bildirimleri açık" : "Push bildirimleri bu cihazda kapalı"}
      tone={hasBinding && permission === "granted" ? "success" : "info"}
    >
      {permission === "denied" ? (
        <span>Tarayıcı bu adres için bildirimi engellemiş. İzni tarayıcı ayarlarından açınca sol menüdeki &quot;Bildirim cihazı&quot; bölümünden kaydedebilirsiniz.</span>
      ) : null}
      {permission !== "denied" && !message ? (
        <>
          <span>Devamsızlık, ödeme ve duyuru bildirimlerini bu hesap için bu cihazda almak üzere push kaydını açın. Aynı ayar sol menüdeki &quot;Bildirim cihazı&quot; bölümünde de bulunur.</span>
          <Button disabled={isSaving} onClick={() => void handleEnable()} size="sm" type="button">
            Push iznini aç
          </Button>
        </>
      ) : null}
      {message ? <span className="next-push-prompt__message">{message}</span> : null}
    </Alert>
  );
}

function readPushPermissionState(): NotificationPermission | null {
  if (!isWebPushCapabilityEnabled()) return null;
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  // A test double may expose `requestPermission` without `permission`; treat that as not granted yet.
  const permission = (window.Notification as { permission?: NotificationPermission }).permission;
  return permission ?? "default";
}

function getPushStatusTone(status: string, activeDeviceCount: number, isSaving: boolean): StatusBadgeProps["tone"] {
  if (isSaving) return "info";
  if (status === "Push açık" || (status === "Hazır" && activeDeviceCount > 0)) return "success";
  if (status === "Cihaz kapatıldı") return "warning";
  if (status !== "Hazır") return "danger";
  return "neutral";
}

async function resolveWebPushToken(): Promise<string> {
  const publicKey = readWebPushPublicKey();
  if (!publicKey) throw new Error("WEB_PUSH_PUBLIC_KEY_MISSING");
  if (!("Notification" in window)) throw new Error("WEB_PUSH_UNSUPPORTED");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("WEB_PUSH_UNSUPPORTED");

  const registration = await navigator.serviceWorker.register("/push-sw.js");
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription = existingSubscription ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  return JSON.stringify(subscription.toJSON());
}

function readWebPushPublicKey(): string {
  const override = typeof window === "undefined"
    ? undefined
    : (window as Window & { __O_OKUL_WEB_PUSH_PUBLIC_KEY__?: string }).__O_OKUL_WEB_PUSH_PUBLIC_KEY__;
  return override ?? process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? "";
}

export function isWebPushCapabilityEnabled(): boolean {
  return readWebPushEnabledFlag() === "true" && Boolean(readWebPushPublicKey().trim());
}

// Mirrors the public-key override above so e2e builds without the env flag can exercise the push UI.
function readWebPushEnabledFlag(): string {
  const override = typeof window === "undefined"
    ? undefined
    : (window as Window & { __O_OKUL_WEB_PUSH_ENABLED__?: string }).__O_OKUL_WEB_PUSH_ENABLED__;
  return override ?? process.env.NEXT_PUBLIC_WEB_PUSH_ENABLED ?? "";
}

function urlBase64ToUint8Array(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputBuffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(outputBuffer);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputBuffer;
}

function humanizePushError(message: string): string {
  if (message === "WEB_PUSH_PUBLIC_KEY_MISSING") return "Push anahtarı eksik";
  if (message === "WEB_PUSH_PERMISSION_DENIED") return "Push izni verilmedi";
  if (message === "WEB_PUSH_UNSUPPORTED") return "Tarayıcı desteklemiyor";
  return "Push açılamadı";
}
