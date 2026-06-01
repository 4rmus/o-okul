# Faz 0 Güvenlik ve Operasyon Kanıtı

Bu dosya PR7 kapanışı için repo içinde doğrulanabilir güvenlik ve operasyon sözleşmesini tutar.
Canlı staging, TLS, Sentry event'i ve `pg_dump` restore kanıtı dış ortam istediği için bu
makinede `NOT_RUN` olarak işaretlenir.

## Güvenlik Header'ları

- API her istekte `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `Strict-Transport-Security` ve API'ye uygun dar `Content-Security-Policy`
  döner.
- Kanıt: `pnpm --filter @uzman-hocam/api test` içindeki security header e2e testi.

## Login Kilidi

- Hatalı login denemeleri email bazında sayılır.
- 5 hatalı denemeden sonra aynı email için giriş geçici olarak kilitlenir.
- Kanıt: `pnpm --filter @uzman-hocam/api test` içindeki login attempt limiter ve HTTP login kilidi
  testleri.

## TLS

- TLS termination Traefik üzerinden yapılır.
- Kanıt: `docker-compose.traefik.yml` ve `pnpm docker:check`.
- Canlı HTTPS doğrulama komutu: `pnpm traefik:https:smoke`.
- Canlı HTTPS doğrulaması: `NOT_RUN`; staging domain yok.

## Backup ve Restore

- Günlük yedek komutu:

```sh
mkdir -p "$BACKUP_PATH"
pg_dump "$DIRECT_DATABASE_URL" > "$BACKUP_PATH/uzman_hocam-$(date +%F).sql"
```

- Restore deneme komutu:

```sh
psql "$DIRECT_DATABASE_URL" < "$BACKUP_PATH/uzman_hocam-YYYY-MM-DD.sql"
```

- Env sözleşmesi: `BACKUP_PATH`, `BACKUP_RETENTION_DAYS`.
- Production env sözleşmesi: `BACKUP_OFFSITE_TARGET`, `WAL_ARCHIVE_TARGET`,
  `RESTORE_DRILL_TARGET`, `DEPLOYMENT_REGION_TARGET`, `KVKK_INVENTORY_TARGET`,
  `IDENTITY_MIGRATION_TARGET`, `FINANCIAL_RETENTION_TARGET`, `UPLOAD_AV_TARGET`,
  `OBSERVABILITY_UAT_TARGET`, `SECURITY_AUDIT_TARGET`, `UAT_EVIDENCE_TARGET`,
  `TRAEFIK_HTTPS_SMOKE_URL`, `ROLLBACK_IMAGE_TAG`.
- Toplu production kanıt komutu: `pnpm prod:evidence:check`.
- Production kanıt şablonu kontrolü: `pnpm prod:evidence:templates:check`.
- Kanıt şablonları: `docs/evidence-templates/*.example.json`.
- Off-host hedef smoke komutu: `pnpm backup:offsite:smoke`.
- WAL archive hedef smoke komutu: `pnpm wal:archive:smoke`.
- Production object-storage endpoint'i gerçek HTTPS host olmalıdır: `S3_ENDPOINT`.
- Restore tatbikatı kanıt komutu: `pnpm restore:drill:check`.
- Lokal `pg_dump` + restore smoke: `pnpm backup:restore:smoke`.
- Production PITR sözleşmesi: `docs/phase-6-ops-runbook.md`.
- Canlı staging/prod restore kanıtı: `NOT_RUN`; staging/prod backup hedefi dış ortam kararı bekler.

## Production Güvenlik Denetimi

- Production env sözleşmesi: `SECURITY_AUDIT_TARGET`.
- Kanıt komutu: `pnpm security:audit:check`.
- Canlı güvenlik denetimi: `NOT_RUN`; staging/prod HTTPS, header, auth ve RLS kontrolleri dış
  ortamda doğrulanır.

## Sentry

- Env sözleşmesi: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_SEND_DEFAULT_PII=false`.
- Production'da `SENTRY_DSN` gerçek HTTPS host olmalıdır.
- PII gönderimi varsayılan olarak kapalı tutulur.
- Test event komutu: `pnpm sentry:smoke`; gerçek event için `SENTRY_SMOKE_CONFIRM=send` gerekir.
- Canlı test event'i: `NOT_RUN`; gerçek `SENTRY_DSN` repoya yazılmaz.

## Observability

- Lokal/opsiyonel stack: `docker compose -f docker-compose.yml -f docker-compose.observability.yml up`.
- Prometheus API `/metrics` endpoint'ini izler.
- Grafana Alloy Docker container loglarını Docker socket üzerinden keşfeder ve Loki'ye yollar.
- Alert kapsamı: API down, yüksek 5xx oranı, yavaş istekler ve readiness hataları.
- Grafana dashboard kapsamı: API up, request rate, ortalama süre, readiness hata sayısı ve Docker logları.
- Production env sözleşmesi: `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_TOKEN`.
- Production'da `ALERT_WEBHOOK_URL` gerçek HTTPS host olmalıdır.
- Alert kanal smoke komutu: `pnpm alert:webhook:smoke`.
- Alert ve dashboard UAT kanıt komutu: `pnpm observability:uat:check`.
- Kanıt: `pnpm docker:check`.
- Canlı alert ve dashboard UAT: `NOT_RUN`; staging/prod ortamı ve bildirim kanalı dış ortam kararı bekler.

## TR Datacenter

- Karar: VPS/self-hosted Docker Compose, TR datacenter zorunlu.
- Kanıt: `docs/DECISIONS.md` ve `docs/ADR-0002-deployment.md`.
- Sağlayıcı/region kanıt komutu: `pnpm deployment:region:check`.
- Sağlayıcı/region canlı kaydı: `NOT_RUN`; staging/prod seçimi dış ortam kararı bekler.
- SMS sağlayıcı smoke komutu: `pnpm sms:smoke`; gerçek sağlayıcıda `SMS_SMOKE_CONFIRM=send`
  verilmeden SMS göndermez.

## KVKK Veri Envanteri

- Production env sözleşmesi: `KVKK_INVENTORY_TARGET`.
- Kanıt komutu: `pnpm privacy:inventory:check`.
- Canlı veri envanteri doğrulaması: `NOT_RUN`; staging/prod gerçek verisi dış ortamda doğrulanır.

## Kimlik Göçü

- Production env sözleşmesi: `IDENTITY_MIGRATION_TARGET`.
- Kanıt komutu: `pnpm identity-migration:check`.
- Canlı kimlik göç kararı: `NOT_RUN`; davet/aktivasyon modeli ve negatif erişim kanıtı dış ortamda doğrulanır.

## Finansal Saklama

- Production env sözleşmesi: `FINANCIAL_RETENTION_TARGET`.
- Kanıt komutu: `pnpm financial-retention:check`.
- Canlı finansal saklama kararı: `NOT_RUN`; yasal saklama süresi ve purge istisnası dış ortamda onaylanır.

## Upload AV

- Production env sözleşmesi: `UPLOAD_AV_TARGET`.
- Kanıt komutu: `pnpm upload-av:check`.
- Canlı upload AV kararı: `NOT_RUN`; sağlayıcı/local scanner, fail-closed ve EICAR reddi dış ortamda doğrulanır.

## Staging/Prod UAT

- Production env sözleşmesi: `UAT_EVIDENCE_TARGET`.
- Kanıt komutu: `pnpm uat:check`.
- Canlı UAT: `NOT_RUN`; tenant admin, öğretmen, veli, import, rapor, SMS ve KVKK akışları dış
  ortamda doğrulanır.
