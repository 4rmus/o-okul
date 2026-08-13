# ADR-0006: Liste, Cursor ve URL State Standardı

## Durum

Kabul edildi.

## Karar

Düşük/orta hacimli listeler doğrulanmış `page/limit/q/sort` sözleşmesini; yüksek hacimli veya
değişken listeler filtre ve sıralamaya bağlı opaque cursor sözleşmesini kullanır. Filtre, sıralama,
yoğunluk ve görünür sütunlar paylaşılabilir URL state'inde tutulur. Global metrikler yalnız sayfadaki
satırlardan hesaplanmaz.

## Gerekçe

Tek bir pagination türünü tüm kaynaklara zorlamak veya tam tenant listesini client'ta filtrelemek
hem performansı hem de deep-link davranışını bozar.

## Kaynak İzi

- Karar ID: DEC-20260809-01
- Kanıt: `docs/phase-b-list-query-contract.md`, `apps/web/e2e-next/list-url-state-next.spec.ts`

## Sonuçlar

- Cursor tenant, filtre ve sıralamaya bağlıdır.
- Query key tenant, persona ve çalışma bağlamını içerir.
- Liste migrationları kaynak bazında ve geriye uyumlu yapılır.
