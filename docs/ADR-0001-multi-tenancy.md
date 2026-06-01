# ADR-0001: Çok Kiracılılık ve Veri İzolasyonu

## Durum

Kabul edildi.

## Karar

Uygulama shared PostgreSQL veritabanı kullanır. Tenant izolasyonu birincil olarak Postgres Row-Level
Security ile, ikinci savunma olarak tenant-aware Prisma transaction/client ile sağlanır.

Tenant tablolarında:

- `tenantId` zorunludur.
- RLS enabled ve forced olur.
- Okuma için `USING`, yazma için `WITH CHECK` policy zorunludur.
- Runtime app DB role tablo sahibi olmaz.

## Gerekçe

Ana kabul kriteri kurumların birbirinin verisini asla görememesidir. Sadece uygulama katmanı filtresi
bu kriter için yeterli savunma değildir; DB katmanı da aynı kuralı zorlamalıdır.

## Kaynak İzi

- Karar ID: DEC-20260529-01
- Kaynak: `docs/DECISIONS.md`
- Kanıt: `MASTER_PLAN.md` §2, §3.2

## Sonuçlar

- Migration testleri RLS varlığını ve negatif read/write senaryolarını kanıtlar.
- `queryRaw`/`executeRaw` kullanımı helper veya allowlist dışına çıkamaz.
- Worker job'ları tenant context olmadan tenant verisine erişemez.
- SYSTEM_ADMIN bypass akışı sınırlı ve audit log zorunludur.
