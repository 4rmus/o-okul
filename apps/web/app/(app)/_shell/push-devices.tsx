"use client";

import { useEffect, useState } from "react";
import { Button, Panel, StatusBadge, type StatusBadgeProps } from "@o-okul/ui";
import { type NotificationDeviceTokenRecord } from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest } from "../../../src/api-client.js";
export function PushDevicePanel({ accessToken }: { accessToken: string }) {
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
      const token = await resolveWebPushToken();
      const record = await apiRequest<NotificationDeviceTokenRecord>(accessToken, `${apiBaseUrl}/me/notification-devices`, {
        body: JSON.stringify({
          provider: "web-push",
          token,
          platform: "web",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
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

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("WEB_PUSH_PERMISSION_DENIED");

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
  return process.env.NEXT_PUBLIC_WEB_PUSH_ENABLED === "true" && Boolean(readWebPushPublicKey().trim());
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
