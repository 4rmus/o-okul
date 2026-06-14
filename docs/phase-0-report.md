# Faz 0 Durum Raporu

## Tamamlanan repo içi kapsam

- Plan, karar kayıtları ve Faz 0 checklist'i repoya eklendi.
- Monorepo iskeleti, ortak TypeScript config, CI komutları ve Docker/Traefik compose dosyaları
  eklendi.
- Prisma şema, seed, RLS migration iskeleti ve statik RLS kontrolü eklendi.
- Auth, refresh rotation/reuse detection/logout, tenant context, RBAC ve tenant izolasyon testleri
  eklendi.
- Worker tenant job context ve queue isim sözleşmesi eklendi.
- Vite React web shell, login formu, demo kurum paneli ve Playwright login smoke testi eklendi.
- API güvenlik header'ları, login kilidi ve ops statik kontrolü eklendi.
- API hata yanıtları global filtreyle `{ error: { code, message, details? } }` sözleşmesine
  yaklaştırıldı; hazır olmayan bağımlılık detayları korunuyor.
- API kaynak endpointleri `/api/v1` altında sunuluyor; `/health` ve `/health/ready` altyapı sinyali
  olarak kökte kalıyor.
- API başarılı yanıtları uygulama konfigürasyonunda liste için `{ data, meta }`, tekil yanıt için
  `{ data }` zarfıyla dönüyor; health yanıtları ham kalıyor.

## Çalıştırılan doğrulamalar

- `pnpm docker:check`
- `pnpm ops:check`
- `pnpm --filter @uzman-hocam/api test`
- `pnpm --filter @uzman-hocam/api test -- api-error`
- `pnpm --filter @uzman-hocam/api test -- api-response`
- `pnpm --filter @uzman-hocam/api test -- api-version`
- `pnpm --filter @uzman-hocam/web build`
- `pnpm test:e2e`
- `pnpm run ci`

## Güncel lokal canlı kanıtlar

- `pnpm compose:health:smoke`: Postgres, Redis ve MinIO healthy.
- `pnpm db:migrate`: schema güncel, bekleyen migration yok.
- `pnpm db:rls:check:live`: tenant read/write izolasyonu geçti.
- `pnpm postgres-stores:smoke`: Class, Teacher, Guardian, Student, Schedule, StudySession ve
  Homework Postgres store yolları canlı DB üzerinde tenant izolasyonuyla geçti.
- `pnpm queue:smoke`: BullMQ `exam-evaluation` ve `excel-import` tüketimi geçti.
- `pnpm backup:restore:smoke`: `pg_dump`/`pg_restore` geçici DB üzerinde geçti.
- `docker compose -f docker-compose.yml -f docker-compose.traefik.yml config`: Traefik v3.7.5
  ACME/entrypoint/Docker label compose config'i geçti.

## Kalan dış ortam kanıtları

- Compose Traefik HTTPS: config doğrulandı; `pnpm traefik:https:smoke` ile canlı TLS/health smoke
  staging domain bekliyor.
- Sentry test event'i: gerçek `SENTRY_DSN` secret'ı bekliyor.
- TR datacenter provider/region kaydı: `pnpm deployment:region:check` hazır; staging/prod
  sağlayıcı seçimi ve kanıt dosyası bekliyor.

## Sonraki güvenli adım

Staging domain ve secretlar geldiğinde `pnpm traefik:https:smoke`, gerçek Sentry event'i ve TR
datacenter/provider kaydı doğrulanır.
