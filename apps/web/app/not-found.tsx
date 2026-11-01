import Link from "next/link";
import { appBrand } from "../src/brand.js";

export const metadata = {
  title: `Sayfa bulunamadı | ${appBrand.name}`,
};

// Berrak hata yüzeyi (UI/UX F9): tek görev, açık geri dönüş yolu; Next varsayılan 404'ü yerine.
export default function NotFound() {
  return (
    <main className="next-auth-layout">
      <section aria-labelledby="not-found-title" className="next-error-fallback">
        <p className="next-section-eyebrow">404</p>
        <h1 id="not-found-title">Sayfa bulunamadı</h1>
        <p>Aradığınız adres taşınmış, kaldırılmış veya yanlış yazılmış olabilir.</p>
        <div className="next-error-fallback__actions">
          <Link className="uh-button uh-button--primary uh-button--md" href="/login">
            <span className="uh-button__content">Girişe dön</span>
          </Link>
          <Link className="uh-button uh-button--secondary uh-button--md" href="/">
            <span className="uh-button__content">Ana sayfa</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
