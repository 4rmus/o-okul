"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GuardianAutoNotificationSettingsRecord } from "@o-okul/shared-types";
import { Button, Checkbox, Field, Input } from "@o-okul/ui";
import { useAuth } from "../../../../providers.js";
import { apiBaseUrl, apiRequest, queryClient } from "../../../../../src/api-client.js";

const settingsUrl = `${apiBaseUrl}/me/tenant/guardian-notification-settings`;

/** KV-8 (DEC-20261005-04): institution switches for automatic guardian notifications; saves on its own. */
export function GuardianAutoNotificationSettings() {
  const { auth } = useAuth();
  const queryKey = ["guardian-auto-notification-settings", auth?.session.tenantId ?? "anonymous"];
  const settingsQuery = useQuery({
    queryKey,
    queryFn: () => apiRequest<GuardianAutoNotificationSettingsRecord>(auth?.accessToken ?? "", settingsUrl),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState<GuardianAutoNotificationSettingsRecord>();
  const [threshold, setThreshold] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (!settingsQuery.data) return;
    setDraft(settingsQuery.data);
    setThreshold(String(settingsQuery.data.absenceThreshold));
  }, [settingsQuery.data]);

  const thresholdValue = Number(threshold);
  const thresholdError = Number.isInteger(thresholdValue) && thresholdValue >= 1 && thresholdValue <= 365 ? undefined : "1 ile 365 arasında bir gün sayısı girin.";

  function change(next: Partial<GuardianAutoNotificationSettingsRecord>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
    setStatus("idle");
  }

  async function save() {
    if (!draft || thresholdError) return;
    setStatus("saving");
    try {
      const saved = await apiRequest<GuardianAutoNotificationSettingsRecord>(auth?.accessToken ?? "", settingsUrl, {
        body: JSON.stringify({ ...draft, absenceThreshold: thresholdValue }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      queryClient.setQueryData(queryKey, saved);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby="guardian-auto-notification-title" className="next-onboarding-fields">
      <div>
        <h3 id="guardian-auto-notification-title">Otomatik veli bildirimleri</h3>
        <p>Veliye uygulama bildirimi ve e-posta gider; SMS gönderilmez. Veli kendi bildirim tercihinden kapatabilir.</p>
      </div>
      {settingsQuery.isError ? <p className="next-form-error">Bildirim ayarları yüklenemedi.</p> : null}
      <Checkbox
        checked={draft?.absenceEnabled ?? true}
        disabled={!draft}
        label="Devamsızlık bildirimi"
        description="Öğrenci gelmedi işaretlenince o gün için bir kez; dönem eşiğine ulaşınca ayrıca bir uyarı."
        onChange={(event) => change({ absenceEnabled: event.target.checked })}
      />
      <Field label="Devamsızlık dönem eşiği (gün)" error={draft ? thresholdError : undefined}>
        <Input
          disabled={!draft}
          inputMode="numeric"
          max={365}
          min={1}
          onChange={(event) => {
            setThreshold(event.target.value);
            setStatus("idle");
          }}
          type="number"
          value={threshold}
        />
      </Field>
      <Checkbox
        checked={draft?.paymentDueEnabled ?? true}
        disabled={!draft}
        label="Ödeme vadesi hatırlatması"
        description="Taksit vadesinden 3 gün önce ve vade günü; yalnız ödeme görünümü açık veliye."
        onChange={(event) => change({ paymentDueEnabled: event.target.checked })}
      />
      <Checkbox
        checked={draft?.gradePublishEnabled ?? true}
        disabled={!draft}
        label="Not yayını bildirimi"
        description="Okul notu yayımlandığında veya düzeltildiğinde."
        onChange={(event) => change({ gradePublishEnabled: event.target.checked })}
      />
      <div>
        <Button disabled={!draft || Boolean(thresholdError)} loading={status === "saving"} onClick={() => void save()} variant="secondary">
          Bildirim ayarlarını kaydet
        </Button>
        <p aria-live="polite" role="status">
          {status === "saved" ? "Bildirim ayarları kaydedildi." : status === "error" ? "Bildirim ayarları kaydedilemedi." : ""}
        </p>
      </div>
    </section>
  );
}
