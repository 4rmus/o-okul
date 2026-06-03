# Faz 6 Production Readiness Checklist

Bu checklist staging/prod açılmadan önce tek tek kanıtlanacak işleri tutar.

## Repo Gate

Production adayı branch için şu komutlar geçmeden release yapılmaz:

```sh
pnpm run ci
pnpm prod:readiness:check
pnpm prod:env:check
pnpm prod:evidence:check
pnpm prod:evidence:templates:check
pnpm deployment:region:check
pnpm alert:webhook:smoke
pnpm backup:offsite:smoke
pnpm wal:archive:smoke
pnpm restore:drill:check
pnpm privacy:inventory:check
pnpm identity-migration:check
pnpm financial-retention:check
pnpm upload-av:check
pnpm observability:uat:check
pnpm security:audit:check
pnpm uat:check
pnpm sms:smoke
pnpm notification:smoke
pnpm sentry:smoke
pnpm traefik:https:smoke
pnpm db:rls:check:live
pnpm postgres-stores:smoke
pnpm backup:restore:smoke
```

## Ortam Ayrımı

- Staging ve prod ayrı VPS veya ayrı compose override ile çalışır.
- `NODE_ENV=production` kullanılır.
- `COOKIE_SECURE=true` ve production domain'e uygun `COOKIE_DOMAIN` ayarlanır.
- `PERSISTENCE_DRIVER=postgres` ayarlanır; tüm store'lar (sınıf, öğrenci, oturum, denetim kaydı, ödeme planı vb.)
  bu tek sürücüye bağlıdır ve production'da asla in-memory'ye düşmez. `apps/api` boot guard'ı
  (`assertPersistenceConfig`) production'da postgres dışı bir değerde veya `DATABASE_URL` eksikse başlatmayı durdurur.

## Secret ve Erişim

- `JWT_ACCESS_SECRET` ve `JWT_REFRESH_SECRET` `change-me` değildir.
- `STUDENT_PII_ENCRYPTION_KEY` ve `STUDENT_PII_HASH_KEY` farklı, en az 32 karakterlik gerçek secret değerlerdir.
- `pnpm prod:env:check` gerçek staging/prod env değerlerinde geçer.
- Production kanıt zinciri `pnpm prod:evidence:check` ile tek komutta geçer.
- Production kanıt zinciri `--summary-file` ile release özeti üretir.
- Production kanıt şablonları `pnpm prod:evidence:templates:check` ile repo içinde doğrulanır.
- Kurum `/kurum/canli-yayin` ekranı production kanıt zincirini, release özet alanlarını ve dış ortam
  kanıt gereksinimlerini ops görünümünde listeler.
- TR datacenter/provider kanıtı `pnpm deployment:region:check` ile doğrulanır.
- Netgsm secret'ları repoya yazılmaz.
- `SMS_PROVIDER=netgsm` ise `SMS_ALLOW_NOOP_IN_PRODUCTION=false` kalır.
- Netgsm test/canlı credential doğrulaması `pnpm sms:smoke` ve production kanıt zincirindeki SMS
  provider adımıyla yapılır.
- E-posta/push provider production'da `NOTIFICATION_PROVIDER=http` ile çalışır; HTTPS endpoint,
  Bearer token ve `pnpm notification:smoke` sonucu kanıt zincirinde zorunludur.
- `SENTRY_DSN` ve `ALERT_WEBHOOK_URL` production'da gerçek HTTPS host olmalıdır.
- `S3_ENDPOINT` production'da gerçek HTTPS object-storage host'u olmalıdır.
- Sentry PII kapalıdır: `SENTRY_SEND_DEFAULT_PII=false`.
- Sentry test event'i `pnpm sentry:smoke` ile doğrulanır.
- Güvenlik denetimi raporu `pnpm security:audit:check` ile doğrulanır.

## TLS ve Network

- Traefik TLS termination aktiftir.
- Traefik v2.11 ACME/entrypoint/Docker label compose config'i
  `docker compose -f docker-compose.yml -f docker-compose.traefik.yml config` ile geçer.
- Canlı HTTPS health kontrolü `pnpm traefik:https:smoke` ile geçer.
- `DOMAIN` ve `ACME_EMAIL` gerçek staging/prod değerleridir.
- Web sadece API'ye erişir; DB, Redis ve MinIO backend network içinde kalır.

## DB ve Yedek

- Migration deploy tamamlanır.
- RLS live check geçer.
- Class, Teacher, Guardian, Student, PaymentPlan, Schedule, StudySession ve Homework Postgres store smoke'u geçer.
- AuditLog partition check geçer.
- Off-host hedef `pnpm backup:offsite:smoke` ile yaz/oku/sil olarak doğrulanır.
- WAL archive hedefi `pnpm wal:archive:smoke` ile yaz/oku/sil olarak doğrulanır.
- Günlük base backup ve WAL arşivi off-host hedefe gider.
- Staging/prod restore tatbikatı `Tenant`, `AuditLog`, `ReportSnapshot` ve son migration'ı doğrular.
- Restore tatbikatı raporu `pnpm restore:drill:check` ile doğrulanır.

## Observability

- Prometheus `/metrics` endpoint'ini scrape eder.
- API down, 5xx oranı, yavaş istek ve readiness alert'leri aktiftir.
- Grafana Alloy Docker container loglarını Loki'ye yollar.
- Grafana API overview dashboard'u metrik ve Docker log panelleriyle açılır.
- Loki veya seçilen production log shipping hedefi API/worker loglarını alır.
- Alert bildirim kanalı staging'de `pnpm alert:webhook:smoke` ile test edilir.
- Alert ve dashboard UAT raporu `pnpm observability:uat:check` ile doğrulanır.

## KVKK ve Audit

- Login, destek, duyuru, mesaj şablonu, sınıf, kişi, ödev ve KVKK purge audit kayıtları görünür.
- KVKK veri envanteri staging/prod gerçek veri sayımlarıyla `pnpm privacy:inventory:check`
  üzerinden doğrulanır.
- Kimlik göç kanıtı: öğrenci/veli/öğretmen user bağları, tenant membership ve negatif erişim
  kontrolleri `pnpm identity-migration:check` üzerinden doğrulanır.
- Finansal saklama kanıtı: finansal kayıtların saklama süresi ve purge istisnası `pnpm financial-retention:check`
  üzerinden doğrulanır.
- Upload AV kanıtı: upload scanner kararı, fail-closed davranışı ve EICAR reddi `pnpm upload-av:check`
  üzerinden doğrulanır.
- Audit diff'leri ham PII içermez.
- Veri sahibi self-service purge akışı test edilir.

## UAT ve Rollback

- Tenant admin, öğretmen ve veli temel akışları staging'de test edilir.
- Ham import, rapor üretimi, SMS provider, e-posta/push provider ve Traefik HTTPS smoke'ları çalıştırılır.
- Staging/prod UAT raporu `pnpm uat:check` ile doğrulanır.
- Rollback hedefi son başarılı image tag'i ve restore edilebilir backup olarak yazılır.

## Canlı Durum

- Repo gate: `PASS`
- Yerel geliştirme canlı smoke: `PASS` (2026-05-31; `pnpm live:smoke`)
- Kurum canlı yayın kanıt ekranı: `PASS` (2026-06-02; web typecheck ve hedefli Playwright kurum smoke)
- Traefik HTTPS smoke: `NOT_RUN`
- TR datacenter/provider kanıtı: `NOT_RUN`
- Staging/prod UAT: `NOT_RUN`
- Off-host backup hedefi: `NOT_RUN`
- Alert bildirim kanalı: `NOT_RUN`
