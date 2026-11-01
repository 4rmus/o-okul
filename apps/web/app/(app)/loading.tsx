import { LoadingState } from "@o-okul/ui";

// Route geçişinde sayfa gövdesi yerine gösterilir; kabuk (menü, üst çubuk) yerinde kalır (UI/UX F9).
export default function AppRouteLoading() {
  return (
    <section aria-busy="true" aria-label="Sayfa yükleniyor" className="next-route-loading">
      <LoadingState label="Sayfa yükleniyor…" />
    </section>
  );
}
