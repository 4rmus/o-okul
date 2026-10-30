"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Button } from "@o-okul/ui";

// Uygulama kabuğu içinde sayfa düzeyi hata sınırı (UI/UX F9): kabuk yerinde kalır, kullanıcı
// yeniden deneyebilir; olay Sentry'ye iletilir, ham hata metni gösterilmez.
export default function AppRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <section aria-labelledby="route-error-title" className="next-error-fallback" role="alert">
      <p className="next-section-eyebrow">Hata</p>
      <h1 id="route-error-title">Sayfa yüklenemedi</h1>
      <p>Beklenmeyen bir hata oluştu; olay hata izleme kanalına iletildi. Yeniden deneyebilir veya menüden başka bir sayfaya geçebilirsiniz.</p>
      <div className="next-error-fallback__actions">
        <Button onClick={() => reset()} type="button">
          Yeniden dene
        </Button>
      </div>
    </section>
  );
}
