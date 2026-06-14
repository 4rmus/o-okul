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
  `RESTORE_DRILL_TARGET`, `DEPLOYMENT_REGION_TARGET`, `DEPLOYMENT_ROLLBACK_TARGET`,
  `KVKK_INVENTORY_TARGET`,
  `IDENTITY_MIGRATION_TARGET`, `FINANCIAL_RETENTION_TARGET`, `UPLOAD_AV_TARGET`,
  `OBSERVABILITY_UAT_TARGET`, `SECURITY_AUDIT_TARGET`, `UAT_EVIDENCE_TARGET`,
  `PILOT_EVIDENCE_TARGET`, `TRAEFIK_HTTPS_SMOKE_URL`, `ROLLBACK_IMAGE_TAG`.
- Toplu production kanıt komutu: `pnpm prod:evidence:check`.
- Production kanıt şablonu kontrolü: `pnpm prod:evidence:templates:check`.
- Kanıt şablonları: `docs/evidence-templates/*.example.json`.
- Off-host hedef smoke komutu: `pnpm backup:offsite:smoke`.
- WAL archive hedef smoke komutu: `pnpm wal:archive:smoke`.
- Production object-storage endpoint'i gerçek HTTPS host olmalıdır: `S3_ENDPOINT`.
- Restore tatbikatı kanıt komutu: `pnpm restore:drill:check`.
- Gerçek restore raporunda kaynak backup ve hedef DB gerçek artifact/run referansı olmalıdır; şablon
  değeri yalnız `RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE=1` ile geçer.
- Deployment rollback tatbikatı kanıt komutu: `pnpm deployment:rollback:check`.
- Lokal `pg_dump` + restore smoke: `pnpm backup:restore:smoke`.
- Production PITR sözleşmesi: `docs/phase-6-ops-runbook.md`.
- Canlı staging/prod restore ve rollback kanıtı: `NOT_RUN`; staging/prod backup hedefi ve deploy
  tatbikatı dış ortam kararı bekler.

## Production Güvenlik Denetimi

- Production env sözleşmesi: `SECURITY_AUDIT_TARGET`.
- Kanıt komutu: `pnpm security:audit:check`.
- Gerçek güvenlik denetimi raporu HTTPS/header, auth, production env ve canlı RLS artifact referansı
  içermelidir; şablon referansları yalnız `SECURITY_AUDIT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçer.
- Canlı güvenlik denetimi: `NOT_RUN`; staging/prod HTTPS, header, auth ve RLS kontrolleri dış
  ortamda doğrulanır.

## Sentry

- Env sözleşmesi: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_SEND_DEFAULT_PII=false`.
- Production'da `SENTRY_DSN` gerçek HTTPS host olmalıdır.
- PII gönderimi varsayılan olarak kapalı tutulur.
- Test event komutu: `pnpm sentry:smoke`; gerçek event için `SENTRY_SMOKE_CONFIRM=send` gerekir.
- Kanıt artifact'i: `SENTRY_SMOKE_EVIDENCE_FILE` redacted DSN ve event ID yazar.
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
- Alert kanal artifact'i: `ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE`.
- Alert ve dashboard UAT kanıt komutu: `pnpm observability:uat:check`.
- Gerçek observability UAT raporu Prometheus, Grafana, Loki ve alert delivery artifact referansı
  içermelidir; şablon referansları yalnız `OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçer.
- Kanıt: `pnpm docker:check`.
- Canlı alert ve dashboard UAT: `NOT_RUN`; staging/prod ortamı ve bildirim kanalı dış ortam kararı bekler.

## TR Datacenter

- Karar: VPS/self-hosted Docker Compose, TR datacenter zorunlu.
- Kanıt: `docs/DECISIONS.md` ve `docs/ADR-0002-deployment.md`.
- Sağlayıcı/region kanıt komutu: `pnpm deployment:region:check`.
- Sağlayıcı/region canlı kaydı: `NOT_RUN`; staging/prod seçimi dış ortam kararı bekler.
- SMS sağlayıcı smoke komutu: `pnpm sms:smoke`; gerçek sağlayıcıda `SMS_SMOKE_CONFIRM=send`
  verilmeden SMS göndermez.
- SMS provider artifact'i: `SMS_PROVIDER_SMOKE_EVIDENCE_FILE`; notification provider artifact'i:
  `NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE`.

## KVKK Veri Envanteri

- Production env sözleşmesi: `KVKK_INVENTORY_TARGET`.
- Kanıt komutu: `pnpm privacy:inventory:check`.
- Contact PII repo sözleşmesi: DEC-20260613-05 ve `pnpm pii:contact-policy:check`; Student.phone,
  Student.email, Guardian.phone ve User.email için schema/redaction/purge coverage sınırını sabitler.
- Canlı veri envanteri doğrulaması: `NOT_RUN`; staging/prod gerçek verisi dış ortamda doğrulanır.

## Kimlik Göçü

- Production env sözleşmesi: `IDENTITY_MIGRATION_TARGET`.
- Kanıt komutu: `pnpm identity-migration:check`.
- Gerçek raporda karar sahibi ve onay referansı örnek/placeholder/redacted değer içeremez; şablon
  doğrulaması bunu yalnız `IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE=1` ile gevşetir.
- Canlı kimlik göç kararı: `NOT_RUN`; davet/aktivasyon modeli ve negatif erişim kanıtı dış ortamda doğrulanır.

## Finansal Saklama

- Production env sözleşmesi: `FINANCIAL_RETENTION_TARGET`.
- Kanıt komutu: `pnpm financial-retention:check`.
- Gerçek raporda karar sahibi ve onay referansı örnek/placeholder/redacted değer içeremez; şablon
  doğrulaması bunu yalnız `FINANCIAL_RETENTION_ALLOW_EXAMPLE_EVIDENCE=1` ile gevşetir.
- Canlı finansal saklama kararı: `NOT_RUN`; yasal saklama süresi ve purge istisnası dış ortamda onaylanır.

## Upload AV

- Production env sözleşmesi: `UPLOAD_AV_TARGET`.
- API runtime sözleşmesi: staging/prod için `UPLOAD_AV_SCANNER=clamav`, `CLAMAV_HOST`,
  `CLAMAV_PORT` ve `CLAMAV_TIMEOUT_MS`.
- Kanıt komutu: `pnpm upload-av:check`.
- Gerçek raporda scanner karar sahibi, onay referansı ve scanner adı örnek/placeholder/redacted değer
  içeremez; şablon doğrulaması bunu yalnız `UPLOAD_AV_ALLOW_EXAMPLE_EVIDENCE=1` ile gevşetir.
- Canlı upload AV kararı: `NOT_RUN`; sağlayıcı/local scanner, fail-closed ve EICAR reddi dış ortamda doğrulanır.

## Staging/Prod UAT

- Production env sözleşmesi: `UAT_EVIDENCE_TARGET`.
- Kanıt komutu: `pnpm uat:check`.
- Gerçek UAT raporunda rollback image, restore backup ve persona senaryo kanıtları gerçek artifact/run/log
  referansı olmalıdır; şablon açıklamaları yalnız `UAT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçer.
- Canlı UAT: `NOT_RUN`; tenant admin, öğretmen, veli, import, rapor, SMS ve KVKK akışları dış
  ortamda doğrulanır.

## Pilot Kapanışı

- Production env sözleşmesi: `PILOT_EVIDENCE_TARGET`.
- Kanıt komutu: `pnpm pilot:check`.
- Canlı pilot kanıtı: `NOT_RUN`; 14 günlük pilot, gerçek optik→karne→veli döngüsü, k6/RLS
  performans eşiği ve olay tatbikatı dış ortamda doğrulanır.

## Go-live Karar Paketi

- Production env sözleşmesi: `GO_LIVE_EVIDENCE_TARGET`.
- Kanıt komutu: `pnpm go-live:check`.
- Canlı go-live kararı: `NOT_RUN`; production evidence summary, UAT, pilot kapanışı, KVKK/DPA,
  rollback, backup/restore, alert/observability, operasyon sahipliği ve imzalı onaylar dış
  ortamda doğrulanır.
