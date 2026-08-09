# ADR-0003: Frontend Route ve Feature Sınırları

## Durum

Kabul edildi.

## Karar

Frontend bağımlılık yönü `app -> features -> shared -> packages/ui/shared-types` olur. Mevcut
route'lar topluca taşınmaz; bir kullanıcı görevi dönüştürüldüğünde ilgili feature sınırı açılır.
`packages/ui` domain veya web uygulamasına bağımlı olamaz, feature'lar birbirinin iç dosyalarını
değil yalnız public girişini kullanır.

Mevcut büyük modüller için `reuse`, `refactor`, `split` veya `retire` kararı route mimari
manifestinde tutulur. Bu kararlar toplu rewrite talimatı değildir.

## Gerekçe

Mevcut App Router ve monorepo yapısı korunurken yeni dilimlerin yeniden tek büyük client component'e
dönüşmesi makine tarafından engellenmelidir.

## Kaynak İzi

- Karar ID: DEC-20260809-01
- Kanıt: `pnpm web:architecture:check`, `pnpm route-manifest:check`

## Sonuçlar

- Yeni dependency veya frontend framework eklenmez.
- Mevcut legacy dosyalar yalnız ilgili ürün diliminde bölünür.
- Sınır ihlali CI'ı kırar; modül boyutu tek başına otomatik refactor başlatmaz.
