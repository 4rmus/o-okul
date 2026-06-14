"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <main className="next-error-fallback" role="alert">
          <h1>Beklenmeyen bir hata oluştu</h1>
          <p>Olay güvenli hata izleme kanalına iletildi.</p>
        </main>
      </body>
    </html>
  );
}
