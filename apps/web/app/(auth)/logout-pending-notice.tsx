"use client";

import { useState } from "react";
import { Button } from "@o-okul/ui";
import { useAuth } from "../providers.js";
import { logoutPendingMessage } from "../../src/logout-pending.js";

// The user tried to end a session the server did not confirm; the login pages retry instead of resuming it.
export function LogoutPendingNotice() {
  const { auth, isBootstrapping, logout, logoutPending } = useAuth();
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState("");

  async function retryLogout() {
    setIsRetrying(true);
    setRetryNote("");
    try {
      setRetryNote(await logout() ? "Oturumunuz kapatıldı." : "Çıkış yine tamamlanamadı. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setIsRetrying(false);
    }
  }

  if (logoutPending && !auth) {
    return (
      <div className="next-form-section">
        <p className="next-form-error" role="alert">{logoutPendingMessage}</p>
        {retryNote ? <p className="next-status-note" role="status">{retryNote}</p> : null}
        <Button type="button" variant="secondary" disabled={isBootstrapping} loading={isRetrying} loadingLabel="Çıkış deneniyor" onClick={() => void retryLogout()}>
          Çıkışı tekrar dene
        </Button>
      </div>
    );
  }
  return retryNote ? <p className="next-status-note" role="status">{retryNote}</p> : null;
}
