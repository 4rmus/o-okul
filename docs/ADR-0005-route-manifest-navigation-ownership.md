# ADR-0005: Route Manifest ve Navigation Sahipliği

## Durum

Kabul edildi.

## Karar

`apps/web/e2e-next/ui-route-family-smoke-next.spec.ts` mevcut aktif route envanterinin kanonik
kaynağıdır. Her route; page family, modül sahibi ve güven sınırı metadata'sına bağlanır. Statik
checker bu envanteri `apps/web/app/**/page.tsx` ile birebir karşılaştırır.

Navigation, breadcrumb ve command palette'in aynı manifestten üretilmesi `UI-02` diliminde yapılır.
Manifest frontend ön kontrolüdür; backend capability ve tenant/scope guard'ının yerine geçmez.

## Gerekçe

İkinci bir route listesi oluşturmadan mevcut 81-route smoke yatırımı sahiplik ve mimari gate için
yeniden kullanılır.

## Kaynak İzi

- Karar ID: DEC-20260809-01
- Kanıt: `pnpm route-manifest:check`, `pnpm web:ux-baseline:check`

## Sonuçlar

- Yeni route metadata olmadan eklenemez.
- Veli route'ları `TRANSITIONAL_GUARDIAN` olarak açıkça işaretlenir.
- Route family hiçbir zaman API yetkilendirme kaynağı olmaz.
