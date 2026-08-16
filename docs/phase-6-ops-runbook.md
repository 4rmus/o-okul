# Faz 6 Operasyon Runbook'u

Bu runbook production'a geçmeden önce yedek, restore ve PITR davranışını kanıtlamak için tutulur.

## Lokal Backup/Restore Smoke

Amaç: canlı geliştirme DB'sinden dump alınabildiğini ve dump'ın temiz bir geçici veritabanına geri
yüklenebildiğini kanıtlamak.

Komut:

```sh
pnpm backup:restore:smoke
```

Staging/local artifact istenirse:

```sh
BACKUP_RESTORE_SMOKE_EVIDENCE_FILE=artifacts/staging/backup-restore-smoke.json \
pnpm backup:restore:smoke
```

Beklenen sonuç:

- `pg_dump` Postgres container içinde custom-format dump üretir.
- Geçici `o_okul_restore_smoke_*` veritabanı oluşturulur.
- `pg_restore` dump'ı geçici veritabanına yükler.
- `Tenant`, `AuditLog`, `ReportSnapshot` ve `_prisma_migrations` tabloları restore edilen DB'de
  okunur.
- Kanıt dosyası istendiyse `backup_restore_smoke` payload'u `restoreDatabaseHash`, `dumpFormat=custom`,
  dört `tableCounts` alanı, tek `commandsPassed=["pnpm backup:restore:smoke"]` ve boş `gaps` taşır.
  Output hedefi lokal temp path, symlink dosya veya symlink parent dizin olamaz.
- Geçici DB ve dump dosyası temizlenir.

Bu smoke production restore garantisi değildir; repo içi minimum geri yükleme kanıtıdır.

## Yapısal Log Doğrulama

Amaç: API ve worker loglarının Loki/Grafana tarafında korelasyon ve redaction için yeterli JSON
alanlarını taşıdığını kanıtlamak.

Kontroller:

- API log satırları `pino-http` JSON formatındadır ve `requestId`, `tenantId`, `userId`,
  `httpRequest.path`, `httpResponse.statusCode` ve `durationMs` içerir.
- Worker log satırlarında `worker_job_completed` ve `worker_job_failed` event'leri `queueName`,
  `jobId`, `tenantId`, `userId` ve `durationMs` ile görünür.
- `/metrics` çıktısında `o_okul_queue_jobs{queue,status}` ve
  `o_okul_queue_metrics_scrape_error` metrikleri görünür.
- Authorization/cookie header'ları, request body, query string, e-posta, telefon ve TCKN loglarda
  görünmez.
- `LOG_LEVEL=info`, `LOG_ENABLED=true`, `QUEUE_METRICS_ENABLED=true`,
  `API_RATE_LIMIT_ENABLED=true`, `API_RATE_LIMIT_STORE=redis`, `REPORT_PDF_RENDERER=worker` ve
  `SENTRY_SEND_DEFAULT_PII=false` staging/prod env içinde ayarlanır.
- Web hata izleme `@sentry/nextjs` ile App Router'ın client, server ve edge runtime'larına bağlanır;
  `NEXT_PUBLIC_SENTRY_DSN` gerçek HTTPS DSN olmalı, `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` 0-1
  aralığında tutulmalı ve source map upload yalnız `SENTRY_AUTH_TOKEN` sağlandığında açılmalıdır.
- Global API rate limit sağlık, readiness ve Prometheus scrape endpointlerini hariç tutar; uygulama
  endpointlerinde limit aşımı `RATE_LIMITED` kodu ve `Retry-After` header'ıyla 429 döner.
- Çoklu instance rate-limit kanıtı için staging'de iki API instance URL'iyle `pnpm rate-limit:smoke`
  çalıştırılır; smoke çıktısı `RATE_LIMIT_SMOKE_EVIDENCE_FILE` altında `rate_limit_redis_smoke`
  artifact'i olarak saklanır ve `RATE_LIMIT_EVIDENCE_TARGET=file:///... pnpm rate-limit:check` ile
  doğrulanır. Artifact global API limiter ve login attempt limiter için Redis store, paylaşılan
  pencere, `LOGIN_LOCKED`/`RATE_LIMITED` 429 ve tenant + kullanıcı adı hash'i + IP kapsamını göstermeli; ham IP,
  kurum kodu veya kullanıcı adı yerine
  SHA-256 hash, tam `commandsPassed=["pnpm rate-limit:smoke", "pnpm rate-limit:check"]` ve boş
  `gaps` listesi taşımalıdır.
  `RATE_LIMIT_EVIDENCE_TARGET`, `instances[].baseUrl` ve `evidenceReferences[]` userinfo/query/fragment
  taşıyamaz; kalıcı release kanıtında instance URL'leri `https://` olmalı ve iki farklı API instance
  URL'i aynı değerle temsil edilemez.
  Rapor top-level 12 alanı, `config`/`instances[]`/`apiRateLimit`/`loginAttemptLimiter`
  blok shape'leri, iki instance, tam `commandsPassed` seti, boş `gaps` listesi ve `/health` +
  `/metrics` excluded path setini taşır; `prod:evidence:templates:check` rate-limit fazla
  alan/path/komut, duplicate instance URL/label, secret URL/reference ve invalid/non-empty gaps
  negatiflerini kırmızıya düşürür; final `file://` target `artifacts/local/**` altından okunamaz.
- Smoke artifact'i başarılıysa release bundle raporu `pnpm rate-limit:generate` ile yazılır:
  `RATE_LIMIT_SMOKE_EVIDENCE_TARGET=file:///.../smoke/rate-limit.json`
  `RATE_LIMIT_EVIDENCE_OUTPUT=artifacts/staging/reports/rate-limit.json`. Komut input smoke
  artifact'ini ve yazdığı final raporu `RATE_LIMIT_EVIDENCE_TARGET=file://... pnpm rate-limit:check`
  ile doğrular; input/output lokal temp path, `artifacts/local/**`, symlink veya userinfo/query/fragment
  taşıyan file URL ise dosya yazmadan kırılır.
- Tek node staging'de ikinci API shard için:
  `docker compose -f docker-compose.yml -f docker-compose.traefik-ip.yml -f docker-compose.rate-limit-shard.yml up -d api-rate-limit-shard traefik`.
  Shard host port yayınlamaz; Traefik `/__rate-limit-shard` prefix'ini strip ederek aynı Redis'e
  bağlı ikinci API container'a yollar. Smoke komutunda ikinci URL
  `https://<staging-host>/__rate-limit-shard/api/v1/__rate-limit-smoke`, ikinci login URL ise
  `https://<staging-host>/__rate-limit-shard/api/v1/auth/login` olmalıdır. Bu public TLS/first-gates
  kanıtı değildir; yalnız Redis limiter paylaşımını doğrular.
  `TRAEFIK_PROXY_IP`, `API_PROXY_IP` ve `RATE_LIMIT_SMOKE_EGRESS_IP` aynı dar `proxy_net`
  içinde farklı sabit IP'ler olmalı; `TRUSTED_PROXY_CIDRS` yalnız Traefik IP'sini `/32` ile
  içerir. Traefik güvenilmeyen istemci `X-Forwarded-For`/`X-Real-IP` başlıklarını güven kaynağı
  yapmaz; smoke da bu başlıkları göndermez. Komuttan önce `RATE_LIMIT_SMOKE_CLIENT_IP` ve
  `RATE_LIMIT_LOGIN_SMOKE_CLIENT_IP` değerlerine smoke çalıştırıcısının gerçek dış IP'si girilir;
  artifact'te yalnız hash'i kalır. API limiter fazının login limiter fazını kirletmemesi için
  `RATE_LIMIT_SMOKE_RESET_API_LIMIT_BEFORE_API=true`,
  `RATE_LIMIT_SMOKE_RESET_API_LIMIT_BEFORE_LOGIN=true`,
  `RATE_LIMIT_SMOKE_API_LIMIT_RESET_IP=<edge-ip>` ve `REDIS_URL=redis://127.0.0.1:6379` kullanılır.
  Bu izolasyon yalnız API rate-limit Redis key'ini siler; login kilidi kanıtı yine iki API
  container arasında gerçek Redis paylaşımıyla üretilir.
  `differentIpNotLocked` negatifi için smoke, sabit `RATE_LIMIT_SMOKE_EGRESS_IP` kullanan
  `api-rate-limit-shard` container'ından sabit `API_PROXY_IP` adresine doğrudan istek yapar.
  İsteklerden önce `docker network inspect`, çalışan `traefik`, `api` ve `api-rate-limit-shard`
  container'larının bu üç sabit `proxy_net` IP'sine sahip olduğunu doğrular; artifact'e yalnız ikinci
  çıkış IP'sinin hash'i yazılır. Bu gerçek ikinci ağ çıkışı, localhost veya sahte forwarded başlığıyla
  elde edilen kanıtın yerini alır.
  Login smoke ayrıca mevcut/aktif kurum kodunu `RATE_LIMIT_LOGIN_SMOKE_TENANT_SLUG` ile alır;
  `RATE_LIMIT_LOGIN_SMOKE_LOGIN_NAME` verilmezse o koşuya özel, mevcut olmayan bir kullanıcı adı üretir.
- Ödeme planı, taksit yazma, öğrenci import commit, öğrenci bireysel/toplu kayıt yenileme ve
  transfer, sınav create/publish/participant, parser config approval, optik template create/apply,
  cevap anahtarı create/import/publish, raw import upload/evaluation enqueue/quarantine resolve,
  rapor üretim enqueue, duyuru teslim sonucu/dış gönderim, destek ek/yorum yazımı, ödev materyal
  dosyası/ataması, backup/restore job başlatma ve SMS batch kuyruğa alma istekleri
  `Idempotency-Key` header'ını destekler; staging/prod ortamlarında kalıcı kayıt için
  `IDEMPOTENCY_STORE=postgres` kullanılır.
- API wiring kontrolünde audit log `AuditLogModule`, duyuru yüzeyi `AnnouncementModule`, duyuru store
  provider'ları `AnnouncementPersistenceModule`, attendance yüzeyi `AttendanceModule`, auth/login
  yüzeyi `AuthModule`, auth store/login limiter provider'ları `AuthPersistenceModule`,
  health/readiness `HealthModule`, ödev yüzeyi `HomeworkModule`, mesaj şablonları
  `MessageTemplateModule`, kimlik davetleri `IdentityInvitationModule`, Prometheus/queue
  metrics `MetricsModule`, bildirim cihaz tokenları
  `NotificationDeviceModule`, backup/restore job yüzeyi `OperationsModule`, rol önizleme yüzeyi
  `RolePreviewModule`, okul katalog/ilişki yüzeyleri `SchoolModule`, öğrenci ana store provider'ı
  `StudentPersistenceModule`, öğrenci kayıt/import yüzeyi `StudentModule`, gelişim gözlemleri
  `DevelopmentModule`, sınav/optik/raw import yüzeyi `ExamModule`, sınav repository provider'ları
  `ExamPersistenceModule`, `/me` self-service yüzeyi `MeModule`, ödeme planları `PaymentModule`, KVKK self-purge yüzeyi `PrivacyModule`, rapor üretim yüzeyi `ReportModule`, ders
  programı yüzeyi `ScheduleModule`, etüt yüzeyi `StudySessionModule`, SMS batch yüzeyi `SmsBatchModule`,
  öğretmen notları `TeacherNoteModule`, destek talebi yüzeyi `SupportTicketModule`, upload AV scanner
  provider'ı `UploadModule`, tenant yönetimi yüzeyi `TenantModule`, tenant ana store provider'ı
  `TenantPersistenceModule`, kullanıcı yönetimi yüzeyi `UserManagementModule`, kullanıcı yönetimi ana
  store provider'ı `UserManagementPersistenceModule`, global filter/guard ve idempotency provider
  `HttpInfrastructureModule` üzerinden gelir; yeni domain ayrımları aynı import/export disiplinini
  korumalıdır.
- SYSTEM_ADMIN RLS bypass her istekte otomatik açılmaz. Cross-tenant bakım için
  `x-rls-bypass-reason` gönderilir ve `system.rls_bypass_requested` audit kaydı aranır.

Loki örnek sorguları:

```logql
{stack="o-okul"} | json | requestId="REQ_ID"
{stack="o-okul"} | json | msg="worker_job_failed"
```

Prometheus örnek sorguları:

```promql
sum(o_okul_queue_jobs{status="failed"}) by (queue)
max(o_okul_queue_metrics_scrape_error)
```

Staging observability stack'i ayrı bir Compose projesi olarak başlatılmaz. Deploy workflow'u base,
release, edge ve `docker-compose.observability.yml` dosyalarını aynı `o-okul` proje çağrısında birleştirir;
böylece Prometheus mevcut `backend_net` üzerindeki `api:3100` hedefine erişir. Host `.env` dosyasında
placeholder olmayan `GRAFANA_ADMIN_USER` ve `GRAFANA_ADMIN_PASSWORD` bulunmazsa config kapısı kırılır.

`STAGING_EVIDENCE_ENV_B64` içindeki yalnız `ALERT_WEBHOOK_URL` ve `ALERT_WEBHOOK_TOKEN` değerleri runner'da
loglanmadan ayrılır ve SSH üzerinden release-scoped özel dizine taşınır. Host dizini `root:root/0700`, iki
dosya `root:root/0600` olmalıdır. Tek seferlik `alertmanager-secrets-init` servisi bunları yalnız Alertmanager'ın
okuyabildiği Docker volume'a kopyalar; Alertmanager root çalışmaz. Statik config `url_file` ve
`authorization.credentials_file` kullanır; URL veya bearer secret repo, Compose environment çıktısı ya da
evidence artifact'ine yazılmaz. Prometheus alertleri `alertmanager:9093` hedefine yollar.
Deploy, Alertmanager `amtool` healthcheck'i ve tüm runtime image kontrolleri geçmeden eski secret dizinlerini
silmez. Kontrollerden sonra yalnız exact private root'un doğrudan, symlink olmayan ve release adı sözleşmesine
uyan eski çocuk dizinleri temizlenir; aktif `$alertmanager_secrets_dir` her zaman korunur. Tanınmayan dizinler
silinmez ve operatör incelemesi için uyarı olarak kalır.

## Observability UAT Evidence

Kanıt sözleşmesi: `docs/evidence-templates/observability-uat.example.json`.

Komut:

```sh
OBSERVABILITY_UAT_TARGET=file:///path/to/observability-uat.json pnpm observability:uat:check
```

Artifact üretim komutu:

```sh
STAGING_ENVIRONMENT=staging \
OBSERVABILITY_UAT_OUTPUT=artifacts/staging/reports/observability-uat.json \
OBSERVABILITY_UAT_PRIVATE_LOOPBACK=1 \
OBSERVABILITY_UAT_PROMETHEUS_URL=http://127.0.0.1:9090 \
OBSERVABILITY_UAT_GRAFANA_URL=http://127.0.0.1:3002 \
OBSERVABILITY_UAT_LOKI_URL=http://127.0.0.1:3101 \
OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET=file:///.../alert-webhook.json \
OBSERVABILITY_UAT_DASHBOARD_PANELS_VERIFIED="API up,Request rate,Average duration,Readiness failures,Docker logs" \
OBSERVABILITY_UAT_ALERTS_VERIFIED="OOkulApiDown,OOkulReadinessFailing,OOkulApiHighErrorRate,OOkulApiSlowRequests" \
OBSERVABILITY_UAT_RELEASE_CANDIDATE=<exact-40-char-sha> \
OBSERVABILITY_UAT_ALERT_CHAIN_TARGET=file:///.../alertmanager-firing-resolved-delivery.json \
OBSERVABILITY_UAT_PROMETHEUS_EVIDENCE_REFERENCE=... \
OBSERVABILITY_UAT_GRAFANA_EVIDENCE_REFERENCE=... \
OBSERVABILITY_UAT_LOKI_EVIDENCE_REFERENCE=... \
OBSERVABILITY_UAT_ALERT_WEBHOOK_EVIDENCE_REFERENCE=... \
pnpm observability:uat:generate
```

Minimum kanıt içeriği:

- Prometheus scrape, Grafana dashboard, Loki log paneli ve alert webhook 2xx durumu `PASS`.
- `pnpm alert:webhook:smoke` kanal kimlik doğrulamasını doğrular; Prometheus -> Alertmanager zinciri için ayrıca
  kontrollü bir test alertinin firing/resolved teslim kaydı gerekir. Doğrudan webhook smoke'u bu zincirin kanıtı değildir.
- Gerçek kanıtta `checkedAt` gelecekte olamaz.
- Dashboard panelleri ve alert kuralları beklenen listeyi kapsar.
- Rapor top-level 12 alanı, beş dashboard paneli, dört alert kuralı ve boş `gaps` listesi
  template invalid/non-empty gaps negatifleriyle korunur.
- `evidenceReferences` Prometheus target çıktısı, Grafana dashboard screenshot/export'u,
  Loki `requestId` sorgusu ve alert delivery artifact'ini göstermelidir.
- `example`, `.test`, `redacted`, `localhost`, `__SET` veya placeholder değerler yalnız template
  kontrolünde `OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
- `pnpm observability:uat:generate` gerçek HTTPS Prometheus/Grafana/Loki endpoint'leri veya yalnız
  staging'de `OBSERVABILITY_UAT_PRIVATE_LOOPBACK=1` ile sabit loopback portlarını,
  alert webhook smoke artifact'i, exact-SHA firing/resolved chain artifact'i, exact dashboard/alert listeleri ve dört gerçek evidence reference
  olmadan dosya yazmadan kırılır. Komut Prometheus `/-/ready`, Grafana `/api/health`, Loki `/ready`
  ve alert webhook smoke JSON'unu doğrular, ardından çıktıyı `pnpm observability:uat:check` ile
  tekrar geçirir. `OBSERVABILITY_UAT_TARGET`, `OBSERVABILITY_UAT_OUTPUT` ve
  `OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET` ile `OBSERVABILITY_UAT_ALERT_CHAIN_TARGET` lokal temp path, `artifacts/local/**`,
  symlink file/parent veya userinfo/query/fragment taşıyan URL üzerinden kullanılamaz.
- Loopback modu observability servislerini public ağa açmaz; production'da, farklı host/portta veya
  açık bayrak olmadan HTTP endpoint kullanıldığında generator dosya yazmadan kırılır.

## Optional External Monitoring Evidence

Bu araç Gate E, pilot ve go-live kapsamı dışındadır; production summary veya release bundle için
zorunlu değildir. İhtiyaç halinde bağımsız operasyon kontrolü olarak kullanılabilir ve çıktısı
strict staging release bundle dizininin dışında tutulmalıdır.

Kanıt sözleşmesi: `docs/evidence-templates/external-monitoring.example.json`.

Komut:

```sh
EXTERNAL_MONITORING_TARGET=file:///path/to/external-monitoring.json pnpm external-monitoring:check
```

Artifact üretim komutu:

```sh
STAGING_ENVIRONMENT=staging \
EXTERNAL_MONITORING_OUTPUT=artifacts/optional/external-monitoring.json \
EXTERNAL_MONITORING_NODE_HOST=... \
EXTERNAL_MONITORING_NODE_REGION=tr-istanbul-1 \
EXTERNAL_MONITORING_NODE_NETWORK=external-vps \
EXTERNAL_MONITORING_API_HEALTH_URL=https://.../health \
EXTERNAL_MONITORING_API_READY_URL=https://.../health/ready \
EXTERNAL_MONITORING_WEB_LOGIN_URL=https://.../login \
EXTERNAL_MONITORING_TLS_URL=https://.../ \
EXTERNAL_MONITORING_ALERT_WEBHOOK_STATUS=200 \
EXTERNAL_MONITORING_OUTAGE_INDUCED_AT=... \
EXTERNAL_MONITORING_OUTAGE_DETECTED_AT=... \
EXTERNAL_MONITORING_OUTAGE_WEBHOOK_DELIVERED_AT=... \
EXTERNAL_MONITORING_OUTAGE_RECOVERED_AT=... \
EXTERNAL_MONITORING_MONITORS_EVIDENCE_REFERENCE=... \
EXTERNAL_MONITORING_OUTAGE_EVIDENCE_REFERENCE=... \
EXTERNAL_MONITORING_TLS_EVIDENCE_REFERENCE=... \
pnpm external-monitoring:generate
```

Uptime Kuma node'unu başlatma:

```sh
docker compose -f docker-compose.external-monitoring.yml up -d
```

Minimum kanıt içeriği:

- Dış izleme node'u self-hosted Uptime Kuma ile ayrı VPS/container üzerinde çalışır; repo bundle'ı
  `docker-compose.external-monitoring.yml` dosyasını sağlar.
- Uptime Kuma UI host portu `127.0.0.1:${UPTIME_KUMA_HOST_PORT:-3003}` ile loopback'e bağlıdır;
  yönetim arayüzü public internete açılmaz, erişim SSH tüneliyle yapılır.
- Zorunlu monitor seti: `API /health`, `API /health/ready`, `Web login` ve `Traefik TLS certificate`.
- Monitor hedefleri yalnız public HTTPS endpoint'lerdir; tenant verisi, kimlik bilgisi veya PII içermez.
- Alarm kanalı mevcut `ALERT_WEBHOOK_URL` ve en az 32 karakterlik gerçek
  `ALERT_WEBHOOK_TOKEN` bearer secret'ı ile aynıdır. Staging POC'ta bilinçli kesinti
  `inducedAt <= detectedAt <= webhookDeliveredAt <= recoveredAt`, `detectionLatencySeconds <= 120`,
  `webhookDeliveryLatencySeconds <= 120` ve latency saniyelerinin timestamp farklarıyla eşleşmesiyle
  kanıtlanır.
- Rapor top-level 10 alanı, `monitoringNode`, monitor item, `outageDrill` blok shape'leri
  ve boş `gaps` listesi template invalid/non-empty gaps negatifleriyle korunur.
- Gerçek kanıtta `EXTERNAL_MONITORING_TARGET` içeriği placeholder, `.test`, localhost veya redacted
  değer içeremez; bu gevşetme yalnız template kontrolünde `EXTERNAL_MONITORING_ALLOW_EXAMPLE_EVIDENCE=1`
  ile açılır.
- `pnpm external-monitoring:generate` gerçek public HTTPS endpoint'leri, TLS sertifikası, outage
  drill zamanları, alert webhook 2xx sonucu ve Uptime Kuma/outage/TLS kanıt referansları olmadan
  dosya yazmadan kırılır. Komut `API /health`, `API /health/ready`, web login ve TLS sertifika
  monitor'larını canlı kontrol eder, outage latency değerlerini timestamp farklarından hesaplar ve
  çıktıyı `pnpm external-monitoring:check` ile tekrar doğrular.

## Admin MFA Evidence

Kanıt sözleşmesi: `docs/evidence-templates/admin-mfa.example.json`.

Komut:

```sh
ADMIN_MFA_EVIDENCE_TARGET=file:///path/to/admin-mfa.json pnpm admin-mfa:check
```

Artifact üretim komutu:

```sh
STAGING_ENVIRONMENT=staging \
ADMIN_MFA_OUTPUT=artifacts/staging/reports/admin-mfa.json \
DIRECT_DATABASE_URL=... \
ADMIN_MFA_MODE=required \
ADMIN_MFA_SECRET_ENCRYPTION_KEY=... \
ADMIN_MFA_RECOVERY_HASH_KEY=... \
ADMIN_MFA_CHALLENGE_SECRET=... \
ADMIN_MFA_RECOVERY_CODES_PER_ENROLLMENT=8 \
ADMIN_MFA_PASSWORD_ONLY_LOGIN_BLOCKED=true \
ADMIN_MFA_TOTP_LOGIN_SUCCEEDED=true \
ADMIN_MFA_INVALID_TOTP_REJECTED=true \
ADMIN_MFA_TOTP_REUSE_REJECTED=true \
ADMIN_MFA_RECOVERY_CODE_LOGIN_SUCCEEDED=true \
ADMIN_MFA_RECOVERY_CODE_REUSE_REJECTED=true \
ADMIN_MFA_SESSIONS_REVOKED_ON_ENABLE=true \
ADMIN_MFA_SESSIONS_REVOKED_ON_DISABLE=true \
ADMIN_MFA_PASSWORD_ONLY_EVIDENCE_REFERENCE=... \
ADMIN_MFA_TOTP_SUCCESS_EVIDENCE_REFERENCE=... \
ADMIN_MFA_INVALID_TOTP_EVIDENCE_REFERENCE=... \
ADMIN_MFA_TOTP_REUSE_EVIDENCE_REFERENCE=... \
ADMIN_MFA_RECOVERY_SUCCESS_EVIDENCE_REFERENCE=... \
ADMIN_MFA_RECOVERY_REUSE_EVIDENCE_REFERENCE=... \
ADMIN_MFA_SESSIONS_REVOKED_ENABLE_EVIDENCE_REFERENCE=... \
ADMIN_MFA_SESSIONS_REVOKED_DISABLE_EVIDENCE_REFERENCE=... \
pnpm admin-mfa:generate
```

Minimum kanıt içeriği:

- `ADMIN_MFA_MODE=optional|required` staging/prod env içinde ayarlanır; production'da `off`
  kabul edilmez.
- `ADMIN_MFA_SECRET_ENCRYPTION_KEY`, `ADMIN_MFA_RECOVERY_HASH_KEY` ve
  `ADMIN_MFA_CHALLENGE_SECRET` gerçek ve birbirinden/JWT secret'tan farklı secret değerlerdir.
- Yalnız SYSTEM_ADMIN hesapları TOTP enrollment kapsamındadır; kurum hesapları ve alt kullanıcıları MFA kapsamı dışındadır. Recovery code sayısı
  enrollment başına en az 8'dir.
- Password-only admin login auth session üretmez; TOTP login başarılı, invalid TOTP reddedilmiş,
  TOTP reuse reddedilmiş, recovery code login başarılı ve recovery code reuse reddedilmiş olmalıdır.
- TOTP enable/disable işlemleri mevcut refresh session'ları iptal eder.
- SMS OTP açıkça kullanılmaz; SIM-swap riski nedeniyle ikinci faktör TOTP veya recovery code'dur.
- Rapor top-level 9 alanı ile `policy`, `enrollment`, `loginVerification` blok shape'leri
  ve boş `gaps` listesi template invalid/non-empty gaps negatifleriyle korunur.
- Gerçek kanıtta `evidenceReferences` placeholder, `.test`, localhost veya redacted değer içeremez;
  bu gevşetme yalnız template kontrolünde `ADMIN_MFA_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır.
- `pnpm admin-mfa:generate` aktif tenant DB'sinde SYSTEM_ADMIN enrollment sayımlarını
  okur, bütün zorunlu adminler TOTP enrollment'lı değilse veya gerçek login/recovery/session log
  referansları verilmezse dosya yazmadan kırılır. Komut auth MFA testlerini ve API typecheck'i
  çalıştırır, ardından çıktıyı `pnpm admin-mfa:check` ile tekrar doğrular.

## Identity Migration Evidence

Kanıt sözleşmesi: `docs/evidence-templates/identity-migration.example.json`.

Komut:

```sh
IDENTITY_MIGRATION_TARGET=file:///path/to/identity-migration.json pnpm identity-migration:check
```

Gerçek staging artifact üretimi:

```sh
STAGING_ENVIRONMENT=staging \
IDENTITY_MIGRATION_OUTPUT=artifacts/staging/reports/identity-migration.json \
IDENTITY_MIGRATION_APPROVED_BY="..." \
IDENTITY_MIGRATION_APPROVAL_REFERENCE="..." \
IDENTITY_MIGRATION_ACTIVATION_MODE=invite \
pnpm identity-migration:generate
```

Gate E staging verifier, eksik bağı yalnız açık onaylı çalıştırmada tamamlar:
`run_identity_migration=true` girişi `full_evidence=true` ile birlikte verilmelidir. Verifier önce
`pnpm identity-link:audit` eşdeğeri salt-okunur sayımı çalıştırır; yalnız sonuç
`NEEDS_INVITE_MIGRATION` ise korumalı ve idempotent göçü uygular, ardından ikinci audit sonucunun
`READY` olmasını zorunlu tutar. Varsayılan değer `false` olduğundan göç kendiliğinden çalışmaz.

Minimum kanıt içeriği:

- `environment=staging|production`, `result=PASS` ve geleceğe taşmayan `checkedAt`.
- `migrationDecision` onay sahibi, onay referansı ve `invite|admin_link|hybrid` activation mode
  değerlerinden birini taşır.
- `subjects` tam olarak `STUDENT`, `GUARDIAN` ve `TEACHER` subject'lerini içerir; her subject'te
  `sourceRecords`, `linkedUsers` ve `tenantMembershipsCreated` sayıları eşit olmalıdır.
- `invitationFlow.created|accepted|expiredOrRevoked` sayaçları sıfır veya daha büyük tam sayı,
  `accepted <= created` olmalıdır.
- Dört canonical verification maddesi taşınır; `gaps` boş olmalıdır.
- Generator staging/prod DB'de her subject için pozitif kayıt, eksiksiz `userId` bağı ve eşleşen
  `TenantMembership` sayısı ister; identity invitation ve tenant user management e2e testleri
  geçmeden artifact yazmaz.
- Hedefli API e2e testleri canlı `DATABASE_URL`/`DIRECT_DATABASE_URL`/`NODE_ENV`/`ADMIN_MFA_MODE`/`PERSISTENCE_DRIVER`/`IDEMPOTENCY_STORE`
  ortamından izole edilir; subject sayımı yine gerçek staging/prod DB bağlantısından okunur.
- Rapor top-level 8 alanı, `migrationDecision`/`invitationFlow` blok shape'leri, üç subject item
  seti, dört verification seti ve boş `gaps` listesi template invalid/non-empty gaps negatifleriyle korunur.
- Gerçek kanıtta onay sahibi ve onay referansı placeholder, `.test`, localhost veya redacted değer
  içeremez; bu gevşetme yalnız template kontrolünde `IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE=1`
  ile açılır.

## Account Management Migration Preflight

Kanıt sözleşmesi: `docs/evidence-templates/account-management-preflight.example.json`.

```sh
ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET=file:///path/to/account-management-preflight.json \
pnpm account-management:preflight:check
```

Gerçek staging artifact üretimi:

```sh
STAGING_ENVIRONMENT=staging \
DIRECT_DATABASE_URL="..." \
ACCOUNT_MANAGEMENT_PREFLIGHT_OUTPUT=artifacts/staging/reports/account-management-preflight.json \
ACCOUNT_MANAGEMENT_GUARDIAN_CLASSIFICATION=FIXTURE_ONLY \
ACCOUNT_MANAGEMENT_GUARDIAN_EVIDENCE_REFERENCE="..." \
pnpm account-management:preflight:generate
```

- Generator repeatable-read/read-only transaction kullanır ve yalnız sayısal envanter yazar.
- Tenant içi case-insensitive e-posta çakışması, birden çok açık enrollment, geçersiz rol
  kombinasyonu, orphan profil/membership veya doğrulanmamış guardian verisi `BLOCKED` üretir.
- `system` tenant'ındaki yalnız `SYSTEM_ADMIN` üyeliği control-plane backfill kaynağıdır;
  başka tenant'taki veya başka rolle birleşmiş `SYSTEM_ADMIN` üyeliği `BLOCKED` üretir.
- Öğretmen→Employee eksikleri backfill kapsamını sayar; additive migration'ı tek başına bloklamaz.
- Guardian kaydı varsa `FIXTURE_ONLY` sınıflandırması ve gerçek veri sahibi/onay referansı zorunludur.
- Artifact ham e-posta, telefon, T.C., ad, kullanıcı veya tenant ID içermez.

### Account management dual-write geçişi

- Runtime okuma otoritesi PR-4 kesimine kadar legacy `User.email` ve `TenantMembership.role`
  alanlarında kalır.
- Yeni tenant hesabı yazımları aynı transaction içinde `emailNormalized`, `loginName`,
  `loginNameNormalized`, `passwordHashVersion` ve `accountStatus` alanlarını da doldurur.
- E-posta global kimlik değildir. Aynı normalize e-posta farklı tenantlarda ayrı hesaplarda
  kullanılabilir; tekillik yalnız `(tenantId, emailNormalized)` sınırında uygulanır.
- Legacy çoklu rol satırları geçiş süresince korunur. Yalnız bir satır canonical `staffRole`,
  `hasTeacherPersona` veya `hasStudentPersona` değerlerini taşır; diğer legacy satırlar shadow
  alanlarında boş/false kalır. Guardian satırı PR-7'ye kadar legacy-only kalır.
- Rol değişiminde canonical satır yeniden seçilir; `TenantMembership.version` ve
  `User.membershipVersion` aynı transaction içinde artırılır. Böylece ilerideki session cutover
  için sürüm monotonluğu korunur.
- Rollback, yeni alanları okumayı açmadan legacy okuma yolunda kalmaktır; dual-write alanlarının
  silinmesi veya eski rol satırlarının drop edilmesi bu dilimde yapılmaz.

### Account management PR-4 backfill ve parity

Kanıt sözleşmesi: `docs/evidence-templates/account-management-backfill.example.json`.

Önce salt-okunur dry-run çalıştırılır:

```sh
STAGING_ENVIRONMENT=staging \
DIRECT_DATABASE_URL="..." \
ACCOUNT_MANAGEMENT_BACKFILL_MODE=DRY_RUN \
ACCOUNT_MANAGEMENT_BACKFILL_OUTPUT=artifacts/staging/reports/account-management-backfill-dry-run.json \
ACCOUNT_MANAGEMENT_OWNER_DECISIONS_TARGET=file:///secure/path/account-owner-decisions.json \
pnpm account-management:backfill
```

`READY` artifact doğrulandıktan sonra aynı owner kararlarıyla kontrollü APPLY çalıştırılır:

```sh
STAGING_ENVIRONMENT=staging \
DIRECT_DATABASE_URL="..." \
ACCOUNT_MANAGEMENT_BACKFILL_MODE=APPLY \
ACCOUNT_MANAGEMENT_BACKFILL_CONFIRM=apply-pr4-backfill \
ACCOUNT_MANAGEMENT_BACKFILL_OUTPUT=artifacts/staging/reports/account-management-backfill.json \
ACCOUNT_MANAGEMENT_OWNER_DECISIONS_TARGET=file:///secure/path/account-owner-decisions.json \
pnpm account-management:backfill
```

- Owner karar dosyası yalnız `file://` kabul eder; her karar `tenantId`, aktif admin `userId` ve
  gerçek `verificationReference` taşır. Bu dosya PII/kimlik içerdiği için evidence artifact'ına
  veya repoya eklenmez.
- Otomatik deploy, release SHA'sına bağlı karar dosyasını
  `/root/o-okul-private/account-management/<IMAGE_TAG>/owner-decisions.json` yolunda arar. Dosya
  opsiyoneldir; varsa deploy kullanıcısına ait, `0600`, normal ve symlink olmayan dosya olmak
  zorundadır ve yalnız backfill container'ına salt-okunur bağlanır. Dosya yoksa mevcut otomatik
  owner seçimi çalışır; belirsiz tenant yine fail-closed `BLOCKED` kalır.
- Mevcut `TENANT_OWNER` korunur. Owner yoksa parola sahipliğiyle doğrulanmış ilk aktif admin
  otomatik seçilir; bu kanıt da yoksa karar dosyası olmadan işlem `BLOCKED` olur.
- APPLY serializable transaction ve advisory lock kullanır. User normalize alanları, tek canonical
  membership/persona gölgesi, Teacher→Employee bağı ve SYSTEM_ADMIN için PlatformAccount/Session
  gölgesi aynı transaction içinde tamamlanır.
- Parity; login normalize alanları, membership/persona, aktif session membershipVersion/legacy rol,
  platform hesap/oturum ve çalışan bağlarını sayısal olarak doğrular. Ham e-posta, telefon, T.C.,
  ad, tenant veya kullanıcı ID artifact'a yazılmaz.
- Runtime cutover yalnız `PASS` backfill artifact'ından sonra başlar. Login
  `(tenantId, loginNameNormalized)` okur ve yalnız aktif hesap + aktif membership + aktif/geçerli
  lisanslı tenant birleşimini kabul eder. T.C. kimlik login tanımlayıcısı değildir.
- Auth sorgusu tek canonical `staffRole`/persona gölge satırını okur. PR-4 boyunca legacy session rol
  sonucunu yalnız semantik parity doğrulamasından sonra korur; duplicate canonical satır, membership
  version sapması veya canonical/legacy rol sapması `AUTH_MEMBERSHIP_PARITY_MISMATCH` ile fail-closed olur.
- Access ve refresh doğrulaması güncel membership durumunu, sürümünü ve rol projeksiyonunu Postgres'ten
  tekrar okur. Suspend/ended membership veya değişmiş sürüm/rol, session revoke başarısız olsa bile iki
  token türünü de geçersiz kılar.
- Login isteği artık tam olarak `tenantSlug + loginName + password` olduğu için web ve API aynı release
  SHA'dan birlikte deploy edilmelidir. Yeni web eski API'ye veya eski web cutover API'ye açılmaz.

### Staging deploy legacy erişim gate'i

Staging workflow additive migration'dan sonra uygulama servislerini başlatmadan önce sırasıyla
read-only preflight ve `APPLY` backfill/parity çalıştırır. İki artifact hosttaki
`artifacts/staging/reports/` altında kalır; scriptler yalnız sayısal sonuç yazar. Owner otomatik
seçilemiyorsa workflow `BLOCKED` olur ve eski servisler yerinde kalır. Karar gerektiren owner
dosyası private mount ile ayrıca, kontrollü olarak uygulanmalıdır; bunu artifact veya repo içine
koymayın.

### Secret delivery outbox staging smoke

Staging deploy, exact dört servis tag'i ve first-gates sonrası PII-safe `deployment-cutover.json` artifact'i
üretir. Operatör, retry edilmiş `DELIVERED` source ID'yi GitHub input/secret/log/artifact'a koymadan yalnız
`$(dirname "$STAGING_DEPLOY_DIR")/o-okul-private/secret-delivery-outbox/<releaseImageTag>/source-id`
yoluna koyar. Sibling private root ve tag dizini `0700`, regular dosya `0600`, aynı remote kullanıcı sahibi
olmalıdır; symlink kabul edilmez. Verify-only dispatch source ID almaz; `deploy_run_id` ile seçilen cutover
artifact'i ve güncel dört container tag'ini doğrular. Eksik private source veya image drift'i, bağımlılık
kurulumundan ve data tunnel açılmasından önce açık bir preflight hatasıyla durur. Geçerli source dizini
preflight sırasında run-scope `.claims/<releaseImageTag>/<verifyRunId>` yoluna atomik taşınır; başka verify
run'ı aynı girdiyi okuyamaz. Workflow claimed source dosyasını ve geçici helper'ları her sonuçta siler;
smoke container image'ını cutover worker SHA'sına sabitler ve çalışan worker image'ını smoke öncesi/sonrası
yeniden doğrular. Cutover artifact'i source-SHA checkout sırasında korunur ve full aggregation'a aynı dosya
taşınır. Boş dizin temizliği idempotent, source/helper dosya silme hatası fail-closed'dur. Runner/SSH kesintisinde on-call sahibi 24 saat içinde aynı
yoldaki dosyayı silmeli ve source değeri olmadan incident/audit referansını kaydetmelidir. Yeni verify için
yeni source kaydı gerekir.

Verifier, outbox smoke adımından sonra başka bir Gate E kontrolünde durmuşsa yeni source/retry üretmeyin.
Aynı deploy run ID'sine bağlı önceki `staging-outbox-smoke-<deployRunId>-<verifyRunId>` artifact'ını
`reuse_outbox_smoke_run_id` ile seçin; workflow artifact'ı aynı `releaseImageTag` ve cutover `notBefore`
bağıyla tekrar doğrular. Full evidence çalıştırmasında `ui_ux_approved_at`, hedef SHA'nın başarılı GitHub CI
tamamlanmasından sonraki gerçek release-owner onay zamanıdır; bu sıra fail-closed doğrulanır.

```sh
GitHub Actions’tan **Staging Outbox Verify** workflow’unu deploy run ID ile çalıştırın. Workflow
cutover artifact'inden `notBefore` ve image tag'ini alır; source dosyası worker image içindeki read-only mount
ile okunur.
```

Workflow default branch'e alınmadan önce aynı-repo draft PR doğrulaması gerekiyorsa staging environment
`STAGING_OUTBOX_DEPLOY_RUN_ID` değişkeni başarılı deploy run ID'sine ayarlanır ve PR'a
`staging-outbox-verify` etiketi eklenir. `pull_request:labeled` yolu da run metadata ve cutover artifact
bağını aynı kontrollerle doğrular ve PR head SHA ile cutover source SHA eşleşmiyorsa durur; fork PR'larda
staging secret'ları kullanılmaz.

Artifact yalnız `outboxRecordHash`, `purpose`, retry sayısı, teslim/güncelleme zamanı, terminal durum,
`payloadCleared`, PII-safe `releaseImageTag`/`notBefore` ve `secret_delivery_worker` minimum yetki sonucunu içerir. User `SELECT`, public schema
`CREATE`/owner ve yükseltilmiş rol yetkileri false olmalıdır. Recipient, token, URL, source ID ve encrypted
payload taşınması fail-closed reddedilir. Bu ayrı DB rolü ve delivery-state kanıtıdır; gerçek inbox/provider
teslimatı ile KVKK/DPA kanıtı ayrı live gate olarak kalır. Template kontrolü veya local script geçişi bunların
yerine geçmez.
Sanitize edilmiş Phase B sonucu doğrulamadan hemen sonra
`staging-outbox-smoke-<deploy-run-id>-<verify-run-id>` adıyla ayrıca upload edilir. Sonraki full production
evidence kapısı Phase B'nin sonucu değildir: workflow varsayılan olarak yalnız Phase B'yi çalıştırır.
`full_evidence=true` açıkça seçilirse ayrı full production evidence aggregation da koşar;
`staging-outbox-verify-*` full release bundle'ı yine yalnız tüm full-evidence ve release-artifact kapıları
geçtiğinde yayımlanır. PR label yolu yalnız Phase B kapsamındadır.
Full aggregation, private env dosyasındaki UI/UX GitHub run referansını seçilen deploy'un indirilen
`github-ci.json` artifact'indeki exact run URL'sine çalışma anında bağlar; secret içeriğini loglamaz ve
env dosyasını `0600` modunda tutar. Aynı koşuda identity migration, financial retention ve security audit
raporlarını staging DB tüneli üzerinden production-summary child sözleşmesiyle üretir; runtime kaynağı
staging olarak ayrı raporlanır ve bu üç hedef runner'daki raw artifact'lere yeniden bağlanır.
Stale iSEM/live-UI/rate-limit raporlarını yenilemek için `run_gate_e_mutating_smokes=true` yalnız ayrı
release-owner onayından sonra ve `full_evidence=true` ile kullanılabilir. Bu tek seferlik yol GitHub staging
environment'ındaki `GATE_E_ISEM_OPTICAL_TXT_BASE64`, `GATE_E_ISEM_ANSWER_KEY_BASE64` ve
`GATE_E_ISEM_SMOKE_PASSWORD` secret'larını kullanır; fixture hash'lerini manifestle doğrular, staging test
tenant/sınav/rapor kayıtlarını üretir, canlı UI oturumlarını logout ile iptal eder ve geçici ikinci API shard'ında
Redis rate-limit smoke'u çalıştırır. Shard her sonuçta kaldırılır; credential taşıyan private UI girdisi ve
materialize edilen cevap anahtarı exit trap'i ile full artifact upload'ından önce silinir. Aynı run'da
oluşturulan sentetik tenant'lar exit trap'inde askıya alınır ve oturumları iptal edilir. Public iSEM,
live-UI, live-exam-cycle ve rate-limit raporları aynı verifier run'ına ve cutover SHA'sına bağlanır. Bu input
kapalıyken workflow eski raporları yenilemez ve eksik/stale kanıta PASS vermez. Zorla runner iptali gibi
trap çalışmayabilecek hata yollarında da artifact upload glob'u `artifacts/staging/private/**` ağacını açıkça
dışlar; private credential girdisi hiçbir full bundle'a giremez. Answer-key ve raw-import smoke yardımcıları
da staging/production koşusunda aynı tek kullanımlık güçlü secret'ı zorunlu tutar; böylece exit trap'i
çalışmasa bile bilinen varsayılan parolalı aktif test hesabı bırakılmaz.
Rollback tag'i yalnız exact release candidate ile eşleşen doğrulanabilir HTTPS rollback raporundan alınır.
Böylece eski bir template run URL'si veya eski uzak rapor yeni cutover kanıtına karışamaz.
- PR-4 rollback önceki web+API image çiftidir. Additive kolonlar ve legacy membership satırları yerinde
  kalır; backfill tersine çevrilmez, global e-posta unique geri getirilmez ve canonical alanlar drop edilmez.
  Rollback sonrasında yeniden cutover öncesi backfill checker ve aktif session legacy-role parity çalıştırılır.
- Legacy rol satırları ile compatibility seçim cevabı, sıfır parity mismatch görülen 14 günlük gözlemden
  önce kaldırılmaz. Exact-SHA staging login/access/refresh, çalışan image tag'leri ve rollback kanıtı olmadan
  bu kesit yalnız local/statik kabul edilir.

### Account management PR-5 LicenseTerm backfill ve runtime kesimi

Kanıt sözleşmesi: `docs/evidence-templates/license-term-backfill.example.json`.

Önce salt-okunur dry-run çalıştırılır:

```sh
STAGING_ENVIRONMENT=staging \
DIRECT_DATABASE_URL="..." \
LICENSE_TERM_BACKFILL_MODE=DRY_RUN \
LICENSE_TERM_BACKFILL_OUTPUT=artifacts/staging/reports/license-term-backfill-dry-run.json \
pnpm account-management:license-backfill
```

`READY` artifact doğrulandıktan sonra kontrollü APPLY çalıştırılır:

```sh
STAGING_ENVIRONMENT=staging \
DIRECT_DATABASE_URL="..." \
LICENSE_TERM_BACKFILL_MODE=APPLY \
LICENSE_TERM_BACKFILL_CONFIRM=apply-pr5-license-term-backfill \
LICENSE_TERM_BACKFILL_OUTPUT=artifacts/staging/reports/license-term-backfill.json \
pnpm account-management:license-backfill
```

- Başlangıç/bitiş/kota snapshot'ı eksik veya geçersizse işlem tahmin üretmez ve `BLOCKED` olur.
- APPLY serializable transaction ve advisory lock kullanır; yalnız hiç dönemi olmayan uygun tenantlar
  için bir başlangıç `LicenseTerm` kaydı oluşturur.
- Artifact yalnız sayısal toplamlar ve blocker kodları taşır; tenant/kullanıcı ID'si veya PII yazmaz.
- Runtime kesimi yalnız `PASS` artifact'ından sonra açılır. ACTIVE normal, bitişten sonraki ilk 15 günlük
  yarı-açık aralık READ_ONLY, 15-90. günler FROZEN ve 91. gün EXPIRED olur.
- Login ve refresh yalnız ACTIVE/READ_ONLY durumda açılır. READ_ONLY yalnız GET/HEAD/OPTIONS kabul eder;
  kanonik dönem eksikliği veya legacy ayna sapması fail-closed olur.
- Yeni dönem `POST /api/v1/tenants/{id}/license-terms` ile eklenir. Eski tenant PATCH sözleşmesi plan,
  lisans tarihi ve kota alanlarını artık kabul etmez; bu alanlar yalnız rollback aynasıdır.
- Canonical aktif öğrenci; silinmemiş `Student.status=ACTIVE` ve tam bir açık
  `StudentEnrollment.status=ACTIVE` kaydıdır. DB trigger'ı sınır aşımını transaction içinde
  `ACTIVE_STUDENT_LIMIT_REACHED` ile reddeder, günlük `LicenseUsage.currentStudentCount` değerini
  ve monotonik `peakStudentCount` değerini yeniler.
- `20260801210000_enforce_active_student_license_usage` migration'ından önce account-management
  preflight çıktısında `multipleOpenEnrollments.students=0` olmalıdır; aksi halde migration uygulanmaz.
- Canonical `POST /api/v1/tenants` onboarding isteği `Idempotency-Key` ister ve tenant, kampüsler, ilk
  `LicenseTerm`, ilk `TENANT_OWNER` Employee/membership kaydı ile aktivasyon outbox'ını tek transaction'da
  oluşturur. `PlatformIdempotencyKey` aynı actor + key + gövdeyi replay eder; farklı gövdeyi reddeder.
- Bu sözleşme local/statik veya staging artifact'ı birbirinden ayırır. Exact-SHA staging deploy, gerçek
  backfill PASS, login/read-only/frozen smoke ve rollback kanıtı olmadan canlı capability sayılmaz.

## Financial Retention Evidence

Kanıt sözleşmesi: `docs/evidence-templates/financial-retention.example.json`.

Komut:

```sh
FINANCIAL_RETENTION_TARGET=file:///path/to/financial-retention.json pnpm financial-retention:check
```

Gerçek staging artifact üretimi:

```sh
STAGING_ENVIRONMENT=staging \
FINANCIAL_RETENTION_OUTPUT=artifacts/staging/reports/financial-retention.json \
FINANCIAL_RETENTION_APPROVED_BY="..." \
FINANCIAL_RETENTION_APPROVAL_REFERENCE="..." \
FINANCIAL_RETENTION_LEGAL_BASIS="..." \
FINANCIAL_RETENTION_PERIOD_YEARS=10 \
FINANCIAL_RETENTION_PURGE_EXCEPTION=true \
pnpm financial-retention:generate
```

Minimum kanıt içeriği:

- `environment=staging|production`, `result=PASS` ve geleceğe taşmayan `checkedAt`.
- `policyDecision` karar sahibi, karar referansı, yasal dayanak, pozitif `retentionPeriodYears`
  ve `purgeException=true` taşır.
- `financialRecords.paymentPlans` ve `financialRecords.installments` gerçek veri kanıtı için
  sıfırdan büyük tam sayı olmalıdır.
- Generator staging/prod DB'den `PaymentPlan`/`PaymentInstallment` sayar, payment e2e içindeki
  KVKK purge ödeme planı koruma testini koşar; gerçek onay env'i veya pozitif kayıt sayımı yoksa
  artifact yazmadan durur.
- Hedefli payment e2e testi canlı `DATABASE_URL`/`DIRECT_DATABASE_URL`/`NODE_ENV`/`ADMIN_MFA_MODE`/`PERSISTENCE_DRIVER`/`IDEMPOTENCY_STORE`
  ortamından izole edilir; finans kayıt sayımı yine gerçek staging/prod DB bağlantısından okunur.
- `purgeBehaviorVerified` iki canonical doğrulamayı içerir: ödeme planları self-purge sonrası
  korunur ve payment plan kayıtları PII purge kapsamı dışında kalır.
- Rapor top-level 7 alanı, `policyDecision`/`financialRecords` blok shape'leri, iki
  `purgeBehaviorVerified` seti ve boş `gaps` listesi template invalid/non-empty gaps negatifleriyle korunur.
- Gerçek kanıtta karar sahibi ve karar referansı placeholder, `.test`, localhost veya redacted değer
  içeremez; bu gevşetme yalnız template kontrolünde `FINANCIAL_RETENTION_ALLOW_EXAMPLE_EVIDENCE=1`
  ile açılır.

## KVKK Inventory Evidence

Kanıt sözleşmesi: `docs/evidence-templates/kvkk-inventory.example.json`.

Komut:

```sh
STAGING_ENVIRONMENT=staging \
KVKK_INVENTORY_OUTPUT=artifacts/staging/reports/kvkk-inventory.json \
node --env-file=.staging-evidence.env scripts/generate-kvkk-inventory-evidence.mjs

KVKK_INVENTORY_TARGET=file:///path/to/kvkk-inventory.json pnpm privacy:inventory:check
```

Minimum kanıt içeriği:

- `environment=staging|production`, `result=PASS` ve geleceğe taşmayan `checkedAt`.
- `dataSubjectCounts` öğrenci, öğrenci iletişim kişisi, öğretmen, veli ve kullanıcı sayımlarını içerir; toplam gerçek veri
  doğrulaması için sıfırdan büyük olmalıdır.
- `purgeCoverage` öğrenci için `firstName`, `lastName`, `phone`, `email`; `StudentContact` için
  ad, ilişki, şifreli/hash iletişim, izin ve consent alanları; öğretmen için
  `firstName`, `lastName`; veli için `firstName`, `lastName`, `phone`; kullanıcı için `email`, `name`
  alan setlerini taşır.
- `whatsappConsent` bu release'te exact `recordCount=0`, `eventRecordCount=0`, sekiz alanlı
  `piiRelevantStoredFields=[phoneHash,purpose,canReceiveWhatsapp,version,noticeVersion,source,recordedAt,withdrawnAt]`
  ve on alanlı
  `piiRelevantEventStoredFields=[whatsappConsentId,studentContactId,purpose,sequence,eventType,noticeVersion,source,recordedAt,commandKeyHash,requestHash]`
  ve exact policy (`featureEnabled=false`, `retentionPeriodDays=0`,
  `disposalMethod=NO_RECORDS_WHILE_DISABLED`, `purgeException=false`, boş olmayan `explanation`)
  taşır. `WHATSAPP_ENABLED=false` iken projection/event tablolarına runtime kayıt yazılamaz ve bu kanıt WhatsApp
  capability veya teslimat kanıtı sayılmaz.
- Audit action seti beş canonical KVKK purge action'ını içerir ve `gaps` boş olmalıdır.
- Generator kişi ve WhatsApp tablo sayılarını `BEGIN READ ONLY` transaction ile canlı DB'den alır;
  WhatsApp projection/event sayıları `0/0` değilse veya izole audit-log redaction testleri geçmezse artifact yazmaz.
- Rapor top-level 10 alanı, beş count alanı, beş coverage subject'i, subject field setleri,
  beş audit action seti, `/audit-logs` audit diff redaction bloğu ve boş `gaps` listesi
  template invalid/non-empty gaps negatifleriyle korunur.

## Security Audit Evidence

Kanıt sözleşmesi: `docs/evidence-templates/security-audit.example.json`.

Komut:

```sh
SECURITY_AUDIT_TARGET=file:///path/to/security-audit.json pnpm security:audit:check
```

Artifact üretim komutu:

```sh
STAGING_ENVIRONMENT=staging \
SECURITY_AUDIT_OUTPUT=artifacts/staging/reports/security-audit.json \
SECURITY_AUDIT_APP_URL=https://... \
SECURITY_AUDIT_API_URL=https://... \
SECURITY_AUDIT_HEADERS_URL=https://... \
RLS_LIVE_EVIDENCE_TARGET=file:///.../rls-live.json \
SECURITY_AUDIT_COOKIE_SECURE_VERIFIED=true \
SECURITY_AUDIT_LOGIN_LOCKOUT_VERIFIED=true \
SECURITY_AUDIT_STRONG_JWT_SECRETS_VERIFIED=true \
SECURITY_AUDIT_REFRESH_SESSION_REVOCATION_VERIFIED=true \
SECURITY_AUDIT_TENANT_ISOLATION_VERIFIED=true \
SECURITY_AUDIT_AUDIT_PII_REDACTION_VERIFIED=true \
SECURITY_AUDIT_SENTRY_PII_DISABLED_VERIFIED=true \
SECURITY_AUDIT_NO_CRITICAL_FINDINGS=true \
SECURITY_AUDIT_PROD_ENV_REFERENCE=... \
SECURITY_AUDIT_HTTPS_HEADERS_REFERENCE=... \
SECURITY_AUDIT_RLS_LIVE_REFERENCE=... \
SECURITY_AUDIT_AUTH_CONTROLS_REFERENCE=... \
SECURITY_AUDIT_DATA_CONTROLS_REFERENCE=... \
pnpm security:audit:generate
```

Minimum kanıt içeriği:

- Production env, HTTPS, canlı RLS, health/readiness ve kritik bulgu yok kontrolleri `PASS`.
- Gerçek kanıtta `checkedAt` gelecekte olamaz.
- Security header, auth kontrolü ve data kontrol listeleri beklenen maddeleri kapsar.
- Rapor top-level 14 alanı, altı security header, dört auth kontrolü ve dört data kontrolü
  template negatifleriyle korunur.
- `evidenceReferences` prod env check log'u, HTTPS/header çıktısı, canlı RLS log'u ve auth kontrol
  artifact'ini göstermelidir.
- `example`, `.test`, `redacted`, `localhost`, `__SET` veya placeholder değerler yalnız template
  kontrolünde `SECURITY_AUDIT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
- `pnpm security:audit:generate` gerçek HTTPS app/API URL'leri, gerçek RLS live target'ı ve
  auth/data kontrol referansları olmadan dosya yazmadan kırılır. Komut `prod:env:check`,
  `web:token-storage:check`, `rls:live:check`, `/health`, `/health/ready` ve security header
  kontrollerini çalıştırır; sonra çıktıyı `pnpm security:audit:check` ile tekrar doğrular.

## RLS Live Evidence

Kanıt sözleşmesi: `docs/evidence-templates/rls-live.example.json`.

Komut:

```sh
RLS_LIVE_EVIDENCE_TARGET=file:///path/to/rls-live.json pnpm rls:live:check
```

Minimum kanıt içeriği:

- `commandsPassed` içinde `pnpm db:rls:check`, `pnpm db:rls:check:live`,
  `pnpm rls:load:smoke` ve `pnpm rls:live:check` bulunur.
- `schema.tablesVerified` schema'dan türeyen 64 tenant tablosunu kapsar; `AnnouncementReceipt`,
  `BackupRestoreJob`, `HomeworkMaterialFile`, `SupportTicketAttachment` ve `AuditLog` bu listenin
  içinde görünmelidir.
- `isolation.crossTenantReadRows=0`, `withCheckRejects` yanlış tenant yazım/referans negatiflerini
  ve `system.rls_bypass_requested` audit aksiyonunu kanıtlar.
- `loadSmoke.actualRps >= targetRps >= 200`, `failures=0` ve smoke artifact'i arşivlenmiş olmalıdır.
  Smoke artifact'i için komut `RLS_LOAD_SMOKE_EVIDENCE_FILE=artifacts/staging/rls-live/rls-load-smoke.json pnpm rls:load:smoke`
  biçiminde çalıştırılır; `pnpm rls:live:check` `evidenceReferences` içinde `rls-load-smoke`
  referansını zorunlu tutar. Artifact `checkedAt`, hash'li tenant referansları,
  `commandsPassed=["pnpm rls:load:smoke"]` ve boş `gaps` listesi taşır; ham tenant/student id
  alanları ortak smoke evidence sözleşmesinde reddedilir.
- Rapor top-level 10 alanı, `schema`/`isolation`/`tenantFkPreflight`/`loadSmoke` blok shape'leri, 57 tabloluk
  `tablesVerified` exact seti, `withCheckRejects` negatif seti, tam `commandsPassed` seti ve
  boş `gaps` listesini taşır; `prod:evidence:templates:check` RLS live fazla alan/tablo/komut
  ve invalid/non-empty gaps negatiflerini kırmızıya düşürür.
- Gerçek kanıtta tenant hash ve artifact referansları `example`, `.test`, `redacted`, `localhost`,
  `__SET` veya placeholder değer içeremez; bu gevşetme yalnız template kontrolünde
  `RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır.
- `RLS_LIVE_EVIDENCE_TARGET` ve `evidenceReferences` userinfo, query veya fragment taşıyamaz;
  secret-bearing URL veya log linki tekil RLS checker tarafından da reddedilir.

## GitHub CI Evidence

Kanıt sözleşmesi: `docs/evidence-templates/github-ci.example.json`.

Komut:

```sh
GITHUB_CI_EVIDENCE_TARGET=file:///path/to/github-ci.json pnpm github-ci:check
```

Minimum kanıt içeriği:

- `workflow.path=.github/workflows/ci.yml`, `workflow.conclusion=success` ve GitHub Actions
  `runUrl` bulunur.
- `commitSha` release adayı commit'inin 40 karakter SHA değeridir; `branch` ve `repository`
  gerçek değer taşır.
- `workflow.runUrl`, job `logUrl` değerleri ve GitHub Actions `evidenceReferences` run URL'i
  rapordaki `repository` ve `workflow.runId` ile eşleşir; başka repo veya run'a ait başarılı CI
  kanıtı release adayına bağlanamaz.
- `command.command=pnpm run ci`, `workflowUsesSingleCiCommand=true` ve `localCiParity=true`
  olmalıdır.
- En az bir job `conclusion=success` olmalı ve `stepsPassed` içinde `pnpm run ci` görünmelidir.
- Rapor top-level 12 alanı, `workflow`/`command`/`jobs[]` item shape'leri, tam
  `commandsPassed` seti ve boş `gaps` listesini taşır; `prod:evidence:templates:check`
  GitHub CI fazla alan/komut, run URL repo/runId mismatch ve invalid/non-empty gaps negatiflerini
  kırmızıya düşürür.
- `prod:evidence:templates:check`, mock GitHub API ile `github-ci.json` generator çıktısını
  üretir ve aynı checker sözleşmesine sokar; staging deploy'daki üretim adımı bu kontratla korunur.
- Generator `GITHUB_CI_EVIDENCE_OUTPUT` hedefinin lokal temp path (`/tmp`, `/var/tmp`) altında,
  symlink file üzerinde veya symlink parent directory altında olmasını GitHub API çağrısından önce reddeder.
- Gerçek kanıtta run URL, repo, branch, log URL ve artifact referansları `example`, `.test`,
  `redacted`, `localhost`, `__SET` veya placeholder değer içeremez; bu gevşetme yalnız template
  kontrolünde `GITHUB_CI_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır.

## OpenAPI Sözleşmesi

Amaç: release branch'inde canlı REST yüzeyinin makine-okunur sözleşmesini üretmek.

Komut:

```sh
pnpm build
pnpm openapi:generate
```

Beklenen sonuç:

- `artifacts/openapi.json` oluşur.
- Sözleşme `/api/v1/auth/login`, `/api/v1/students`, `/api/v1/exams`, `/api/v1/payment-plans`
  ve `/api/v1/metrics` path'lerini içerir.
- `access-token` bearer security scheme'i bulunur.
- Swagger UI staging/prod ortamlarında `OPENAPI_UI_ENABLED=false` ile kapalı kalır.

## Staging Deploy Workflow

Amaç: staging VPS'e aynı release adımlarını tekrarlanabilir şekilde uygulamak ve dış ortam kanıtlarını
workflow artifact'i olarak toplamak.

Tetikleme:

```sh
pnpm ui-ux-redesign:release-preflight -- --repo 4rmus/o-okul --environment staging --summary-file artifacts/local/ui-ux-redesign-release-readiness-summary.json --github-gap-report-file artifacts/local/staging-github-env-gap-report.json --remote-snapshot-dir artifacts/local/remote-staging-snapshot --remote-gap-report-file artifacts/local/remote-staging-gap-report.json --max-age-minutes 30
gh workflow run staging-deploy.yml -f rollback_image_tag=<last-known-good-tag>
```

Preflight komutu önce taze UI/UX readiness summary üretir, sonra aynı dosyayı `--require-ready` ile
doğrular. Eksik GitHub secret, dirty local workspace, remote script eksikliği veya açık artifact kalemi
varken gh workflow dispatch yapılmamalıdır.

Gerekli GitHub `staging` environment secret/var değerleri:

- Secrets: `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_PRIVATE_KEY`, `GHCR_READ_TOKEN`,
  `STAGING_EVIDENCE_ENV_B64`.
- Vars: `STAGING_DEPLOY_DIR=/root/o-okul`, `STAGING_NEXT_PUBLIC_API_URL`, opsiyonel `STAGING_EDGE_MODE`.
  `STAGING_EDGE_MODE=domain` varsayılandır ve `docker-compose.traefik.yml` ile ACME kullanır.
  `STAGING_EDGE_MODE=ip` bu cihazdaki geçici IP/self-signed edge için `docker-compose.traefik-ip.yml`
  dosyasını seçer.
- IP/self-signed edge yalnız teşhis içindir: `TRAEFIK_HTTPS_SMOKE_ALLOW_INSECURE_TLS=true`
  kullanıldığında `pnpm traefik:https:smoke` PASS evidence artifact'i yazamaz. Release bundle,
  production summary ve go-live kanıtı için gerçek domain/public TLS kullanılmalıdır.
- Domain/IP edge geçişi sırasında `docker-compose.traefik.yml` ve `docker-compose.traefik-ip.yml`
  birlikte config edilebilir; router'lar explicit `service=` label taşıdığı için Traefik service
  ambiguity üretmemelidir. Bu config doğrulaması first-gates yerine geçmez.
- Deploy bundle `docker/alertmanager`, `docker/prometheus`, `docker/grafana`, `docker/loki` ve `docker/alloy`
  configleriyle birlikte smoke import zincirinin ihtiyaç duyduğu `docs/evidence-manifests` girdilerini taşır.
  Final `up -d --remove-orphans` çağrısı observability dosyasını da içerir ve
  Alertmanager, Prometheus, Grafana, Loki ile Alloy container'larının beklenen image ile çalıştığını doğrular.
- Domain edge aktivasyonundan önce staging hostunda
  `$STAGING_DEPLOY_DIR/secrets/cloudflare_dns_api_token` dosyası root sahibi, parent dizini `0700`
  ve dosya `0600` olacak şekilde oluşturulur. Token yalnız `o-okul.com` zone DNS read/write
  yetkisine sahip olmalı; değer GitHub loguna, evidence env'e veya artifact'e yazılmaz.

`STAGING_EVIDENCE_ENV_B64` içeriği `docs/evidence-templates/staging-evidence.env.example`
sözleşmesinden üretilir. Gerçek değerlerle doldurulan özel env dosyası GitHub secret'a yazılmadan önce
şu komutla doğrulanır:

UI/UX redesign için `UI_UX_REDESIGN_RELEASE_CANDIDATE` ve GitHub run referansları staging workflow'un
ürettiği `GITHUB_REPOSITORY` slug'ıyla aynı olmalıdır; bu deploy hattında repo slug `4rmus/o-okul`
olduğunda image prefix `ghcr.io/4rmus/o-okul` olur. `UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS`
virgülle ayrılmış yalnız staging artifact hostlarını içerir; localhost/private IP, allowlist dışı
host ve redirect hedefi kabul edilmez. Generator `GITHUB_CI_EVIDENCE_TARGET` dosyasındaki exact SHA,
CI workflow, run ve başarılı job bağını schema v2 artifact digest/viewport manifestiyle birlikte
doğrular.

```sh
node scripts/check-staging-evidence-env.mjs --env-file /path/to/staging-evidence.env
```

Doğrulanmış dosyayı secret değerini terminal argümanına yazmadan GitHub `staging` environment'a basmak için:

```sh
chmod 600 /secure/path/staging-evidence.env
pnpm staging:evidence-env:secret:set -- --repo 4rmus/o-okul --environment staging --env-file /secure/path/staging-evidence.env
```

Bu yardımcı repo/temp dizinindeki veya symlink üzerinden gelen dosyaları reddeder, aynı
`pnpm staging:evidence-env:check` kapısını çalıştırır ve base64 çıktıyı `gh secret set` komutuna stdin
üzerinden verir; secret değeri log veya shell argümanlarına yazılmaz. Ön kontrol için `--dry-run`
kullanılabilir.

`GHCR_READ_TOKEN` değeri de repo veya temp altında tutulmadan ayrı bir dosyadan yazılır:

```sh
chmod 600 /secure/path/ghcr-read-token
pnpm staging:ghcr-read-token:secret:set -- --repo 4rmus/o-okul --environment staging --token-file /secure/path/ghcr-read-token
```

Bu yardımcı token dosyasının repo/temp/symlink altında olmadığını ve sadece sahibi tarafından
okunabildiğini doğrular; token değerini `gh secret set` komutuna stdin üzerinden verir ve log'a
yazmaz. Ön kontrol için `--dry-run` kullanılabilir.

GitHub `staging` environment oluşturulduktan sonra secret değerleri yazdırılmadan yalnız isim/var
sözleşmesi şu komutla doğrulanır:

```sh
pnpm staging:github-env:check -- --repo 4rmus/o-okul --environment staging
```

Eksikler güvenli handoff için makine-okunur rapora da alınabilir:

```sh
pnpm staging:github-env:gaps:summary -- --repo 4rmus/o-okul --environment staging --gap-report-file artifacts/local/staging-github-env-gap-report.json
```

Bu rapor yalnız secret/var isimlerini ve tamamlanması gereken komutları içerir; secret değerlerini
yazdırmaz ve release PASS kanıtı sayılmaz.

GitHub env gap'i ve remote release artifact gap'i tek UI/UX handoff raporunda toplamak için:

```sh
pnpm ui-ux-redesign:release-readiness:summary -- --repo 4rmus/o-okul --environment staging --summary-file artifacts/local/ui-ux-redesign-release-readiness-summary.json --github-gap-report-file artifacts/local/staging-github-env-gap-report.json --remote-snapshot-dir artifacts/local/remote-staging-snapshot --remote-gap-report-file artifacts/local/remote-staging-gap-report.json
```

Bu çıktı `releaseEvidence=false` taşır; sadece kapanış sıralaması ve sahiplik handoff'u içindir.
Remote `ui-ux-redesign:evidence-generate` script'i yoksa rapor `remote_code_deploy` aksiyonunu
`reports/ui-ux-redesign.json` üretiminden önce listeler.
Raporun güvenli ve sıralı olduğunu doğrulamak için:

```sh
pnpm ui-ux-redesign:release-readiness:check -- --target artifacts/local/ui-ux-redesign-release-readiness-summary.json --max-age-minutes 30
```

Kontrol ayrıca summary içindeki GitHub env gap ve remote bundle gap raporu yollarının `artifacts/local/**`
altında var olduğunu, sonuçlarının summary ile eşleştiğini ve tarih olarak summary penceresiyle tutarlı
olduğunu doğrular. Gerçek deploy/release öncesinde aynı kontrol `--require-ready` ile çalıştırılır; eksik secret,
dirty local workspace, remote script eksikliği, stale summary veya açık artifact kalemi varsa kırmızı dönmelidir.
Bu iki adımı tek komutla yürütmek için `pnpm ui-ux-redesign:release-preflight -- --repo 4rmus/o-okul
--environment staging --summary-file artifacts/local/ui-ux-redesign-release-readiness-summary.json
--github-gap-report-file artifacts/local/staging-github-env-gap-report.json --remote-snapshot-dir
artifacts/local/remote-staging-snapshot --remote-gap-report-file artifacts/local/remote-staging-gap-report.json
--max-age-minutes 30` kullanılır.

Workflow aynı branch için tek staging deploy'u sıraya alır, job timeout'ları tanımlıdır ve Docker
imaj build'leri buildx `type=gha` cache kullanır. Bu yüzden tekrar deploy'da bağımlılık ve layer
cache'i korunur; evidence job'u yine ayrı artifact üretmeye devam eder.

Otomatik `workflow_run` preflight'ı deploy SHA'sını uzak `main` ile karşılaştırır. Kuyrukta kendi CI'ı
başarılı daha yeni bir `main` SHA'sı varsa eski run; GitHub'ın ilişkilendirdiği PR base aralığında yalnız
doküman veya ajan metadata dosyaları değiştiyse runtime-etkisiz run, image build/SSH/evidence başlamadan
başarılı biçimde atlanır. Daha yeni SHA'nın başarılı CI'ı veya PR değişiklik aralığı doğrulanamazsa seçim
fail-open çalışır. Manuel `workflow_dispatch` bu filtreden etkilenmez ve her zaman deploy akışına girer.

Linux runner için base64 değeri:

```sh
base64 -w0 /path/to/staging-evidence.env
```

Beklenen akış:

- Workflow elle `workflow_dispatch` ile çalıştırılabilir; ayrıca `main` üstündeki `CI` workflow'u başarılı
  bittiğinde otomatik çalışır.
- Otomatik çalışmada, daha yeni CI-doğrulanmış `main` SHA'sı bulunmayan ve doğrulanabilir PR aralığında
  runtime'ı etkileyen dosya değişikliği içeren release ilerler; diğerleri preflight özetinde gerekçesiyle atlanır.
- Workflow önce dispatch input'larını, Docker tag biçimini, `STAGING_NEXT_PUBLIC_API_URL=https://...`
  değerini, `STAGING_EDGE_MODE=domain|ip` değerini ve gerekli staging secret/var varlığını doğrular.
- Workflow `STAGING_EVIDENCE_ENV_B64` içeriğini decode eder, boş dosyayı reddeder ve normal cutover için
  `pnpm staging:evidence-env:check -- --mode activation --env-file .staging-evidence.env` ile yalnız
  first-gates girdilerini (web origin'iyle bağlı HTTPS smoke dahil) doğrular. Tam DB/proxy/outbox production-evidence sözleşmesi, deploydan sonra
  **Staging Outbox Verify** içindeki `--mode full` kontrolünde zorunludur; eksik anahtarlar full kanıtı
  fail-closed durdurur. Preflight shell'i `.staging-evidence.env` dosyasını exit trap'i ile siler. Bu secret env dosyası
  `REPORT_GENERATION_SMOKE_EVIDENCE_FILE` veya diğer raw smoke evidence path'lerini içermez;
  `prod:evidence:check --summary-file` bunları `artifacts/staging/smoke/*.json` altında üretir.
- Workflow aynı commit'in başarılı `.github/workflows/ci.yml` run'ını GitHub API'dan okuyup
  `artifacts/staging/reports/github-ci.json` üretir, `pnpm github-ci:check` ile doğrular ve
  deploy SHA'sına bağlı `staging-github-ci-evidence-<sha>` artifact'i olarak saklar. Bu job geçmeden image build veya deploy başlamaz.
- Workflow `pnpm run ci` komutunu tekrar çalıştırmaz; deploy kapısı upstream `CI` workflow'unun
  başarılı run'ı ve bu run'dan üretilen GitHub CI evidence dosyasıdır.
- `web`, `api`, `worker` ve `queue-board` image'ları GHCR'a commit SHA tag'i ve `staging-latest`
  tag'i ile push edilir.
- GitHub runner `docker-compose.yml`, `docker-compose.release.yml`, `docker-compose.traefik.yml`,
  `docker-compose.traefik-ip.yml`, `docker-compose.observability.yml`, `docker/evidence` ve
  `docker/postgres/init` içeriğini SSH üzerinden staging deploy dizinine kopyalar; staging host'un
  repo clone yetkisine ihtiyacı yoktur.
- Domain edge deploy'u `CF_DNS_API_TOKEN_FILE=./secrets/cloudflare_dns_api_token` değerini kullanır;
  workflow compose bundle'ına tokenı eklemez ve staging hostundaki secret dosyasını değiştirmez.
- Yeni release bilgisi önce `.env.release.next` dosyasına `WEB_IMAGE`, `API_IMAGE`, `WORKER_IMAGE`,
  `QUEUE_BOARD_IMAGE`, `SENTRY_RELEASE` ve `ROLLBACK_IMAGE_TAG` alanlarıyla yazılır. Otomatik
  deploy'da rollback tag'i sunucudaki mevcut `.env.release` içindeki `SENTRY_RELEASE` değerinden
  alınır. `up -d` başarılı olunca `.env.release.next`, `.env.release` olarak taşınır.
- Otomatik deploy, aynı repoya bağlı GHCR imajlarını job-scope `GITHUB_TOKEN` ile çeker; bu değer
  uzak shell komut satırına gömülmez, `GHCR_READ_TOKEN` env adıyla SSH stdin üzerinden `0600` benzeri izinli
  `.ghcr_read_token` dosyasına aktarılır, `docker login --password-stdin` sonrası trap ile silinir.
- Pull öncesinde workflow, aktif release ve rollback tag'i dışındaki eski `ghcr.io/4rmus/o-okul/*`
  imajlarını temizler, en az 2048MB boş disk alanı ister ve image pull adımını 20 dakika ile sınırlar.
- `docker compose --env-file .env --env-file .env.release.next -f docker-compose.yml
  -f docker-compose.release.yml -f docker-compose.traefik.yml pull web api worker queue-board` ile imajlar çekilir.
- `docker compose ... run --rm api sh -lc 'cd packages/db && ./node_modules/.bin/prisma migrate deploy --config prisma.config.ts'`
  interaktif olmayan migration deploy'u çalıştırır.
- `docker compose ... up -d --remove-orphans` Traefik'li staging stack'ini ayağa kaldırır.
  Ardından `web`, `api`, `worker` ve `queue-board` container'larının çalışan image adı deploy
  `IMAGE_TAG` değeriyle birebir karşılaştırılır; container eksikse, running değilse veya healthcheck
  `healthy` değilse deploy kırmızıya düşer. `evidence` servisi `artifacts/staging/reports` altındaki doğrulanmış JSON kanıtlarını
  `/evidence/*.json` olarak salt-okunur sunar; eksik kanıt dosyası bilinçli olarak 404 döner.
- GitHub runner, `STAGING_EVIDENCE_ENV_B64` içeriğini normal evidence job'da yeniden decode edip
  `pnpm staging:evidence-env:check -- --mode activation` ile tekrar doğrular; verify-only job aynı
  dosyayı `--mode full` ile doğrular.
- Evidence job, deployment-region artifact üretmez; v1 go-live zinciri region evidence target'ı
  beklemez.
- GitHub runner, deploy öncesi üretilmiş `staging-github-ci-evidence-<sha>` artifact'ini
  `actions/download-artifact@v4` ile `artifacts/staging/reports/github-ci.json` yoluna indirir ve
  `pnpm github-ci:check` ile tekrar doğrular.
- Release env dosyasına workflow-generated metadata olarak `SENTRY_RELEASE`, `ROLLBACK_IMAGE_TAG`,
  `GITHUB_CI_EVIDENCE_TARGET=file://.../artifacts/staging/reports/github-ci.json` ve
  `PRODUCTION_EVIDENCE_SUMMARY_TARGET=file://.../artifacts/staging/release-summary-<tag>.json`
  eklenir.
- Release env dosyası `*_ALLOW_EXAMPLE_EVIDENCE=1` bayraklarını içermez; `pnpm prod:env:check`
  gerçek production-evidence koşusunda bu bayrakları bypass olarak reddeder.
- Release env dosyası `AUDIT_NULL_TENANT_EVIDENCE_TARGET` olmadan kabul edilmez; null tenant
  audit sınıflandırması production summary ve go-live linked summary zincirine taşınır.
- Release env dosyası `LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET` olmadan kabul edilmez; UI-worker
  smoke sonucu ayrı `pnpm live:ui-worker:result-check` kapısında doğrulanır, `prod:evidence:check
  --summary-file` çıktısında `reports.liveUiWorkerResult` olarak yer alır ve production
  summary/go-live linked summary zincirine bağlanır.
- Release env dosyasındaki evidence target değerleri `file://` artifact yolu veya `https://`
  URL olmalıdır; `http://`, placeholder/example/test host ve lokal temp `file://` path'leri
  `pnpm prod:env:check` tarafından reddedilir. `pnpm prod:evidence:check` de evidence target
  protokolünü, gerçek https host'unu ve temp/symlink-parent olmayan `file://` artifact path'ini
  erken doğrular; `http://` veya placeholder/temp/symlink target'a ağ/dosya okuma denemesi yapmaz. Standalone evidence
  checker'ların target protokolü, placeholder/test `https://` host reddi, lokal temp
  `file://` path reddi ve symlink file artifact reddi de
  `pnpm prod:evidence:templates:check` negatifleriyle korunur.
- Ortak smoke evidence preflight/writer, `*_SMOKE_EVIDENCE_FILE`/`SMOKE_EVIDENCE_FILE`
  çıktılarının lokal temp path (`/tmp`, `/var/tmp`) altında veya symlink file/parent directory
  üzerinden yazılmasını reddeder; smoke üreticileri bu hedefi provider, HTTP, S3 veya DB yan etkisine
  başlamadan doğrular. Writer ayrıca payload'u yazmadan önce smoke tipine özgü schema ile doğrular;
  `noop` provider, dolu `gaps`, yanlış komut veya ham credential/id içeren artifact dosyaya düşmez.
  `pnpm smoke:evidence:check` bu temp/symlink output ve invalid payload negatiflerini çalıştırır.
- Release env dosyası `SMS_SMOKE_TO`, `SMS_SMOKE_BODY`, `SMS_SMOKE_CONFIRM=send`,
  `NOTIFICATION_SMOKE_SUBJECT`, `NOTIFICATION_SMOKE_BODY`, `NOTIFICATION_SMOKE_CONFIRM=send`,
  `SENTRY_SMOKE_CONFIRM=send` ve gerçek `SENTRY_SMOKE_MESSAGE` içermelidir; eksik smoke
  onayları deploy evidence aşamasına kalmadan `pnpm prod:env:check` tarafından reddedilir.
- Staging host ayağa kalktıktan sonra evidence job ilk dış gate'leri tam release evidence zincirinden
  önce ayrı artifact seti olarak üretir:
  `pnpm staging:first-gates:smoke -- --env-file .staging-evidence.env --output-dir artifacts/staging/first-gates`.
  Job, private evidence env dosyasındaki `APP_URL`, `API_URL`, `WEB_URL` ve
  `TRAEFIK_HTTPS_SMOKE_URL` alanlarını önce deploy preflight'ında doğrulanan
  `STAGING_NEXT_PUBLIC_API_URL` origin'ine bağlar; böylece kaldırılmış veya reserved bir host
  stale secret içinde kalsa bile activation smoke gerçek deploy origin'ini sınar. Diğer secret ve
  full-evidence target değerleri değiştirilmez; private env kaynağı ayrıca kontrollü biçimde
  güncel tutulmalıdır.
  Bu komut Traefik HTTPS ve alert webhook smoke dosyalarını yazar, her dosyayı
  ortak smoke evidence sözleşmesiyle doğrular ve `first-gates-manifest.json` manifest'i üretir.
  Output dizini lokal temp path (`/tmp`, `/var/tmp`) veya `artifacts/local/**` altında olamaz ve yalnız
  `first-gates-manifest.json`, `traefik-https.json` ve `alert-webhook.json`
  dosyalarını içerebilir; beklenmeyen dosya veya symlink varsa smoke
  çalışmadan önce kırılır. Alert webhook smoke `http://`, lokal/test host veya
  userinfo/query/fragment taşıyan webhook URL'lerini network isteğinden önce reddeder; bearer
  secret bu hedeflere gönderilmez. Tekil smoke komutlarında kullanılan `*_SMOKE_EVIDENCE_FILE`
  çıktıları da lokal temp path'e veya symlink file/parent directory üzerinden yazılamaz.
  Workflow aynı job içinde
  `STAGING_FIRST_GATES_TARGET=file://$PWD/artifacts/staging/first-gates/first-gates-manifest.json pnpm staging:first-gates:check`
  komutuyla manifest'i, iki artifact'i, artifact ortamlarının manifest ortamıyla eşleştiğini ve manifest
  zamanının artifact `generatedAt`/`checkedAt` zamanlarından önce olmadığını tekrar doğrular; manifest target lokal temp path, `artifacts/local/**`, symlink dosya veya symlink parent directory olamaz. Artifact upload adımı `if: always()` ile çalışır ve
  full production evidence zinciri sonradan düşse bile üretilen first-gates artifact'lerini saklar.
- Full production evidence, **Staging Outbox Verify** workflow'unda seçilen deploy run'ın cutover artifact'i
  ve dört çalışan servis tag'i doğrulandıktan sonra çalışır; `full_evidence` staging deploy input'u kaldırılmıştır.
  Verify workflow sanitize edilmiş outbox artifact'ini toplar ve ardından GitHub runner doğrulanmış
  production evidence env sözleşmesiyle
  `pnpm prod:evidence:check -- --summary-file artifacts/staging/release-summary-<tag>.json`
  komutunu çalıştırır. Yalnız bu staging verify akışı `PRODUCTION_EVIDENCE_ALLOW_STAGING_OUTBOX=1`
  ile outbox smoke'un `environment=staging` kaydını kabul eder; production/go-live çalışmaları bu
  istisnayı taşımaz. Bu komut release summary dosyasını yazdıktan sonra aynı summary'yi
  `scripts/check-production-evidence-summary.mjs` ile doğrular; yalnız tüm zorunlu kanıtlar PASS ise
  summary `canPromote=true` taşır ve `artifacts/staging`
  klasörünü artifact olarak saklar. Aynı source SHA, GitHub CI ve UI/UX artifact'i ile
  `pnpm ui-ux-professionalization:completion:check` full-evidence modu da çalışır. `--summary-file`, sibling `reports/` ve `smoke/` output
  layout'u lokal temp path veya symlink file/directory üzerinden yazılamaz; birleşik kapı bunu
  evidence check'leri başlamadan önce reddeder. Birleşik kapı ayrıca `*_SMOKE_EVIDENCE_FILE`
  raw smoke target'larını provider/HTTP/DB smoke'ları başlamadan önce production artifact girdisi
  olarak doğrular. Evidence job, staging host'a SSH tunnel açar ve `DATABASE_URL`,
  `DIRECT_DATABASE_URL` değerlerini runner içindeki `127.0.0.1:15432` tunnel portuna çevirir.
  `REDIS_URL` private env'de varsa `127.0.0.1:16379` portuna çevrilir; yoksa evidence smoke'ları
  için aynı tunnel portuna bakan default Redis URL'i eklenir. Helper ayrıca
  `STAGING_EVIDENCE_DB_TUNNEL=1` ve `STAGING_EVIDENCE_POSTGRES_TUNNEL_PORT`
  ekler; `prod:evidence:check` yalnız bu açık staging tunnel işaretinde
  `DATABASE_URL`/`DIRECT_DATABASE_URL` için runner `127.0.0.1` Postgres tunnel
  hostunu kabul eder, normal production env'de lokal DB URL'leri kırmızı kalır. `/tmp`/`/var/tmp`, symlink dosya ve symlink parent directory üzerinden gelen raw
  smoke path'i kabul edilmez. Evidence job, artifact upload öncesinde `if: always()` cleanup
  adımıyla `.staging-evidence.env` secret dosyasını workspace'ten siler. Otomatik staging deploy
  bu full evidence adımını koşmaz; eksik go-live artifact'leri otomatik deploy sonucunu hatalı
  biçimde failed yapmaz ve yalnız `staging-activation-evidence-<tag>` artifact'ini yayımlar.
- Full evidence zinciri PASS olduktan sonra **Staging Outbox Verify** workflow'u
  `STAGING_RELEASE_ARTIFACTS_TARGET=$PWD/artifacts/staging pnpm staging:release-artifacts:check`
  komutunu çalıştırır. Bu kontrol indirilecek
  `staging-outbox-verify-<deploy-run-id>-<verify-run-id>` artifact setinde `reports/deployment-cutover.json`,
  diğer `reports/*.json`, `first-gates/first-gates-manifest.json`, tek `release-summary-*.json` ve
  `smoke/*.json` ham kanıt dosyalarının mevcut olduğunu doğrular. Cutover SHA/repository/tag/zamanı release
  summary ve outbox smoke ile birebir eşleşmelidir; publish öncesinde dört çalışan image tag'i tekrar
  denetlenir. `release-summary-<tag>.json`
  dosya adındaki tag, summary içindeki `reports.deploymentRollback.releaseCandidate` image tag'iyle
  eşleşmelidir. Bundle yalnız beklenen root, `reports/`, `smoke/` ve `first-gates/` dosyalarını
  içerebilir; beklenmeyen raw JSON/log dosyası kalırsa kontrol kırılır. Bundle symlink içeremez;
  beklenen artifact'ler symlink olmayan dosya/dizin olmalıdır. `STAGING_RELEASE_ARTIFACTS_TARGET`
  parent-symlink target üzerinden verilemez; hedef path'in parent zincirinde symlink varsa veya hedef `/tmp`/`/var/tmp` altında kalıyorsa kontrol kırılır. Bundle `.staging-evidence.env`,
  `.env*` veya GHCR token dosyası içeremez; secret/env dosyası artifact setine karışırsa kontrol kırılır. First-gates ortak
  smoke'larının ortamı manifest ortamıyla eşleşmeli, manifest zamanı kendi artifact zamanlarından önce olamaz ve final `smoke/*.json`
  kanıtlarından daha geç tarih taşıyamaz; bu kural stale final
  smoke veya report dosyalarının bundle'a karışmasını engeller.
- Aynı komut `STAGING_RELEASE_GAP_REPORT_FILE=/path/to/release-gap.json` ile çalıştırıldığında
  eksik zorunlu artifact'ler için `missingRequiredFiles[].remediation.command`,
  `remediation.ownerAgent`, `remediation.phase`, `remediation.evidenceGate`,
  `remediation.nextActionKind`, `remediation.prerequisite` ve `remediation.blocker` alanlarını yazar. Bu gap raporu ops handoff
  ve sıralama içindir; `releaseEvidence=false`, `canPromote=false` ve `result=NOT_RELEASE_EVIDENCE`
  olduğu sürece release summary veya Canlı Durum PASS yerine geçmez. Summary dosyası henüz yokken de
  final bundle'a girmemesi gereken `logs/`, `private/`, çalışma dizini veya ham diagnostik dosyaları
  `unexpectedFiles[]` altında listelenir; bunlar kalıcı kanıt bundle'ına kopyalanmamalıdır.
  Aynı özet terminalde okunacaksa
  `corepack pnpm staging:release-gaps:summary -- --artifacts-dir artifacts/staging --gap-report-file artifacts/local/staging-release-gap-report.json`
  kullanılır; komut eksik kanıt, beklenmeyen dosya, geçersiz dosya, mismatch ve bloklu kontrol
  sayılarını ayrı basar, beklenmeyen bundle girdilerini listeler ama bloklu bundle için exit code'u
  yeşile çevirmez.
  Remote staging hosttaki bundle gap'i secret veya `.env` dosyası okumadan tekrarlanabilir biçimde
  almak için
  `corepack pnpm staging:remote-release-gaps:summary -- --host o-okul-prod --snapshot-dir artifacts/local/remote-staging-snapshot --gap-report-file artifacts/local/remote-staging-gap-report.json`
  kullanılır; komut remote `artifacts/staging` içeriğini `artifacts/local/**` altına snapshot olarak
  alır ve aynı gap özetini çalıştırır. Bu komutun non-zero dönmesi eksik kanıt varken beklenen
  davranıştır; `NOT_RELEASE_EVIDENCE` çıktısı release PASS değildir.
  UI/UX redesign özelinde GitHub env ve remote bundle gap'ini tek dosyada toplamak için
  `corepack pnpm ui-ux-redesign:release-readiness:summary -- --repo 4rmus/o-okul --environment staging --summary-file artifacts/local/ui-ux-redesign-release-readiness-summary.json --github-gap-report-file artifacts/local/staging-github-env-gap-report.json --remote-snapshot-dir artifacts/local/remote-staging-snapshot --remote-gap-report-file artifacts/local/remote-staging-gap-report.json`
  kullanılır; bu dosya `releaseEvidence=false` kalır ve final summary yerine geçmez. Remote package
  UI/UX evidence script'ini içermiyorsa `remote_code_deploy` aksiyonu, artifact üretiminden önce
  kapanması gereken önkoşul olarak görünür.
  `corepack pnpm ui-ux-redesign:release-readiness:check -- --target artifacts/local/ui-ux-redesign-release-readiness-summary.json --max-age-minutes 30 --require-ready`
  gerçek deploy/release öncesi tüm bu blokajların kapandığını doğrular.
  Beklenmeyen girdiler kanıt setinin dışında saklanacaksa
  `corepack pnpm staging:release-artifacts:archive-unexpected -- --artifacts-dir artifacts/staging --gap-report-file artifacts/local/staging-release-gap-report.json --archive-dir artifacts/local/staging-release-unexpected-<tag> --apply`
  kullanılır. Komut silmez; sadece taze gap raporundaki `unexpectedFiles[]` girdilerini bundle
  dışındaki archive dizinine taşır ve `manifest.json` yazar. `--apply` yoksa dry-run çıktısı verir.
- First-gates manifest'indeki `evidenceFile` değerleri manifest dizini altındaki symlink olmayan
  relative artifact dosya adlarıdır; mutlak URL/yol veya manifest dizini dışına çıkan kanıt
  referansı geçmez.
- Bundle henüz tamam değilse release captain diagnostic için
  `STAGING_RELEASE_GAP_REPORT_FILE=artifacts/local/staging-release-gap-report.json`
  ekleyebilir. Bu çıktı `result=NOT_RELEASE_EVIDENCE`, `overallStatus=BLOCKED`,
  `releaseEvidence=false` ve `canPromote=false` taşır; `staging:release-artifacts:check`
  yine non-zero kalır. Gap raporu production summary, live-status, pilot veya go-live kanıtı
  değildir ve bundle dizininin içine yazılamaz.
- `pnpm staging:evidence-env:check`, workflow içindeki kritik evidence sırasını da korur: normal deploy'da
  GitHub CI artifact üretimi/download, activation env decode/check, metadata append, first-gates, cutover,
  cleanup ve upload; verify-only workflow'unda full env, production evidence ve release bundle check adımları
  bu sırada kalmalıdır.
- Release summary artifact'i ayrıca
  `PRODUCTION_EVIDENCE_SUMMARY_TARGET=file:///path/to/release-summary.json pnpm prod:evidence:summary:check`
  ile tek başına doğrulanır; bu target yalnız `file://` artifact yolu veya `https://` URL olabilir,
  `http://`, lokal temp path, symlink artifact ve symlink parent directory reddedilir. Summary top-level alanları, tam/tekrarsız check listesi, her check maddesinin
  `label/script/status` şekli, beklenen script path'i, `smokeEvidence`, `reports` ve her gömülü report blok alan seti tam ve beklenmeyen
  anahtarsız olmalı, smoke payload'ları, zorunlu report blokları, tarih sıralaması ve
  placeholder/example/redacted değer reddi bu sözleşmeyle korunur; check status/script/duplicate sapmaları ve smoke/report kanıtlarının summary
  `generatedAt` sonrasına taşması template negatifleriyle kırmızıya düşer.
- Summary yazımı her smoke evidence JSON'unda `result=PASS`, beklenen `check` adı,
  `environment=production`, gelecekte olmayan `generatedAt` ve smoke tipine özgü payload
  alanlarını doğrular; Traefik smoke URL origin'i summary `webUrl` origin'iyle ve external
  monitoring monitor URL origin'leri summary `webUrl` public edge origin'iyle eşleşmelidir.
  Override edilen raw smoke dosya path'leri kalıcı, symlink olmayan artifact dosyası olmalıdır.
  `pnpm smoke:evidence:check`, örnek production summary içindeki Traefik/SMS/
  notification/Sentry/alert/backup/WAL smoke şemalarını, backup restore smoke artifact'ini ve temel
  negatif senaryoları CI öncesi sabitler.
- Final dış kanıt kapısı tekil summary/pilot/go-live/live-status kontrollerinden sonra aynı artifact
  setini tekrar bağlar:
  `PRODUCTION_EVIDENCE_SUMMARY_TARGET=file:///path/to/release-summary.json LIVE_STATUS_EVIDENCE_TARGET=file:///path/to/live-status.json PILOT_EVIDENCE_TARGET=file:///path/to/pilot.json GO_LIVE_EVIDENCE_TARGET=file:///path/to/go-live.json pnpm prod:external-evidence:check`.
  Bu komut target'sız `ops:check` çıktısını veya kısmi Canlı Durum sonucunu final kabul saymaz;
  `*_ALLOW_EXAMPLE_EVIDENCE=1`, lokal temp path (`/tmp`, `/var/tmp`, macOS `/private/tmp`),
  `artifacts/local/**`,
  `docs/evidence-templates/**` fixture hedefi, symlink target ve userinfo/query/fragment taşıyan
  URL veya placeholder/example/redacted HTTPS host kullanımı final kapıda reddedilir.
- Remote/staging final readiness kapısı aynı target setini remote hostta salt-okunur doğrular:
  `REMOTE_EVIDENCE_HOST=o-okul-prod REMOTE_EVIDENCE_ROOT=/root/o-okul PRODUCTION_EVIDENCE_SUMMARY_TARGET=file:///root/o-okul/artifacts/staging/release-summary.json LIVE_STATUS_EVIDENCE_TARGET=file:///root/o-okul/artifacts/staging/live-status.json PILOT_EVIDENCE_TARGET=file:///root/o-okul/artifacts/staging/pilot.json GO_LIVE_EVIDENCE_TARGET=file:///root/o-okul/artifacts/staging/go-live.json pnpm prod:remote-evidence:check`.
  Bu komut deploy yapmaz; remote repo final checker'ı, tam Canlı Durum ve target'lı
  `prod:external-evidence:check` sonucunu kanıtlar. Remote target'lar da placeholder HTTPS host,
  remote temp path, `artifacts/local/**`, `docs/evidence-templates/**` ve userinfo/query/fragment
  taşıyan URL ile verilemez. Bu dört final artifact henüz üretilmemişse komutun kırmızıya
  düşmesi beklenen davranıştır; bu durum `ops:check` veya target'sız `live:status:check`
  çıktısıyla yeşile çevrilmez.

Bu workflow prod deploy değildir; staging environment üzerinde gerçek HTTPS, provider, backup,
observability ve UAT kanıtlarını üretmek için kapıdır.

## Deployment Rollback Drill

Amaç: Faz 9 release gate'inde son bilinen iyi imaja dönüşün raporlu ve tekrarlanabilir olduğunu
kanıtlamak. Sözleşme hem bozuk-image enjeksiyonunu hem de exact-SHA cold rollback + restore
tatbikatını ayrı modlarda ve gerçek semantiğiyle taşır.

Kanıt sözleşmesi: `docs/evidence-templates/deployment-rollback.example.json`.

Komut:

```sh
DEPLOYMENT_ROLLBACK_TARGET=file:///path/to/deployment-rollback.json pnpm deployment:rollback:check
```

Artifact üretim komutu:

```sh
STAGING_ENVIRONMENT=staging \
  DEPLOYMENT_ROLLBACK_OUTPUT=artifacts/staging/reports/deployment-rollback.json \
  DEPLOYMENT_ROLLBACK_RELEASE_CANDIDATE=... \
  DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG=... \
  DEPLOYMENT_ROLLBACK_DRILL_MODE=failure-injection \
  DEPLOYMENT_ROLLBACK_DRILL_SOURCE_IMAGE_TAG=... \
  DEPLOYMENT_ROLLBACK_DRILL_ROLLBACK_IMAGE_TAG=... \
  DEPLOYMENT_ROLLBACK_DRILL_RESTORED_IMAGE_TAG=... \
  DEPLOYMENT_ROLLBACK_DRILL_STARTED_AT=... \
  DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT=... \
  DEPLOYMENT_ROLLBACK_FAILURE_INJECTED=true \
  DEPLOYMENT_ROLLBACK_FAILURE_MODE=... \
  DEPLOYMENT_ROLLBACK_MIGRATION_ROLLBACK_SAFE=true \
  DEPLOYMENT_ROLLBACK_DRILL_CONFIRMED=true \
  DEPLOYMENT_ROLLBACK_APPROVED_BY=... \
  DEPLOYMENT_ROLLBACK_APPROVAL_REFERENCE=... \
  DEPLOYMENT_ROLLBACK_COMMAND_LOG_REFERENCE=... \
  DEPLOYMENT_ROLLBACK_SOURCE_RUN_URL=... \
  DEPLOYMENT_ROLLBACK_SOURCE_UAT_ARTIFACT_URL=... \
  DEPLOYMENT_ROLLBACK_ROLLBACK_RUN_URL=... \
  DEPLOYMENT_ROLLBACK_ROLLBACK_UAT_ARTIFACT_URL=... \
  DEPLOYMENT_ROLLBACK_RESTORED_RUN_URL=... \
  DEPLOYMENT_ROLLBACK_RESTORED_UAT_ARTIFACT_URL=... \
  DEPLOYMENT_ROLLBACK_WEB_STATUS=healthy \
  DEPLOYMENT_ROLLBACK_WEB_IMAGE_TAG=... \
  DEPLOYMENT_ROLLBACK_WEB_EVIDENCE_REFERENCE=... \
  DEPLOYMENT_ROLLBACK_API_STATUS=healthy \
  DEPLOYMENT_ROLLBACK_API_IMAGE_TAG=... \
  DEPLOYMENT_ROLLBACK_API_EVIDENCE_REFERENCE=... \
  DEPLOYMENT_ROLLBACK_WORKER_STATUS=running \
  DEPLOYMENT_ROLLBACK_WORKER_IMAGE_TAG=... \
  DEPLOYMENT_ROLLBACK_WORKER_EVIDENCE_REFERENCE=... \
  DEPLOYMENT_ROLLBACK_QUEUE_BOARD_STATUS=healthy \
  DEPLOYMENT_ROLLBACK_QUEUE_BOARD_IMAGE_TAG=... \
  DEPLOYMENT_ROLLBACK_QUEUE_BOARD_EVIDENCE_REFERENCE=... \
  pnpm deployment:rollback:generate
```

Minimum tatbikat akışı:

- Staging'e bilinçli bozuk veya healthcheck'i geçmeyen bir image tag'i release adayı olarak uygulanır.
- Health/readiness başarısızlığı kaydedilir; veri migrasyon uyumluluğu geri dönüş için onaylanır.
- `.env.release` içindeki `WEB_IMAGE`, `API_IMAGE`, `WORKER_IMAGE` ve `QUEUE_BOARD_IMAGE` değerleri
  `ROLLBACK_IMAGE_TAG` zincirindeki son bilinen iyi tag'e çekilir.
- `docker compose pull web api worker queue-board` ve `docker compose up -d --remove-orphans` çalıştırılır.
- `pnpm compose:health:smoke` ve `pnpm prod:evidence:check` tekrar PASS olur.
- Rapor top-level `releaseCandidate`/`rollbackImageTag` değerleriyle güncel release zincirine,
  `drill` bloğuyla gerçek tatbikatın source/rollback/restored image'larına bağlanır.
- `failure-injection` modunda `drill.failureInjected=true` ve gerçek failure mode zorunludur.
- Daha önce tamamlanmış gerçek cold rollback yeniden çalıştırılmayacaksa
  `DEPLOYMENT_ROLLBACK_DRILL_MODE=cold-rollback-rehearsal`, `DEPLOYMENT_ROLLBACK_FAILURE_INJECTED=false`,
  boş `DEPLOYMENT_ROLLBACK_FAILURE_MODE` kullanılır. Bu modda
  `drill.restoredImageTag=drill.sourceImageTag` olmalı; source, rollback ve restore için ayrı canonical
  GitHub run/UAT artifact URL'leri zorunludur. Her checkpoint'in 40 karakter commit SHA'sı image tag'iyle,
  UAT artifact URL'sindeki run id de ilgili run URL'siyle eşleşir. Generator GitHub API'den repo,
  başarılı run head SHA'sı, artifact adı, expiry ve digest metadata'sını doğrulamadan rapor yazmaz;
  private repo için `GITHUB_TOKEN` gerekir.
- Generator gerçek drill onayı, command log, source/rollback/restored run + UAT artifact çiftleri ve
  dört servis kanıt referansı olmadan artifact yazmaz.
- `checkedAt`, `drill.startedAt` ve `drill.completedAt` gelecekte olamaz;
  `drill.startedAt <= drill.completedAt <= checkedAt` sırası korunmalıdır.
- `releaseCandidate` ile `rollbackImageTag` aynı tag olamaz.
- Rollback raporu schema v2 alan kümesi, exact `drill`/`approval` blokları, dört servislik
  `servicesVerified` seti, moda özel dört komutluk
  `commandsPassed` seti ve boş `gaps` listesi `prod:evidence:templates:check` içindeki fazla
  alan/servis/komut, ters kronoloji, release=rollback ve invalid/non-empty gaps negatifleriyle korunur.
- Image tag ve evidence reference değerleri gerçek release/artifact referansı olmalı; `ghcr.io/example`,
  `.test`, `example`, `localhost`, `__SET` veya placeholder değerler yalnız template kontrolünde
  `DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
- `DEPLOYMENT_ROLLBACK_TARGET`, servis `evidenceReference` değerleri ve `evidenceReferences`
  userinfo, query token veya fragment taşıyamaz.

## Staging/Prod UAT Evidence

Amaç: Faz 10 rol bazlı UAT koşusunun gerçek release, rollback ve persona yolculuğu artifact'leriyle
kanıtlandığını doğrulamak.

Kanıt sözleşmesi: `docs/evidence-templates/uat.example.json`.

Komut:

```sh
UAT_EVIDENCE_TARGET=file:///path/to/uat.json pnpm uat:check
```

Artifact üretim komutu:

```sh
STAGING_ENVIRONMENT=staging \
UAT_OUTPUT=artifacts/staging/reports/uat.json \
UAT_TESTER=... \
UAT_RELEASE_CANDIDATE=... \
UAT_ROLLBACK_IMAGE_TAG=... \
UAT_RESTORE_BACKUP_REFERENCE=s3://... \
UAT_COMMAND_EVIDENCE_TARGET=file:///.../uat-command-evidence.json \
UAT_SCENARIOS_TARGET=file:///.../uat-scenarios.json \
pnpm uat:generate
```

Minimum kanıt içeriği:

- `environment=staging` veya `production`, release candidate, rollback image ve restore backup referansı.
- `commandsPassed` içinde CI, production env, canlı RLS, raw import, report generation, queue,
  live onboarding, live UI-worker, SMS, notification ve Traefik HTTPS smoke komutları.
- `journeyScenariosVerified` içinde `UAT-SYS-*`, `UAT-KURUM-*`, `UAT-TEACHER-*`, `UAT-STUDENT-*`
  ve `UAT-GUARDIAN-*` persona senaryolarının tümü `PASS`.
- UAT raporu top-level alan kümesi, `flowsVerified` ve `commandsPassed` tam setleri, 21 V1 journey
  scenario seti ve her scenario item shape'i `prod:evidence:templates:check` içindeki fazla
  alan/komut/senaryo negatifleriyle korunur.
- `checkedAt` gelecekte olamaz; `tester` gerçek koşu sahibi olmalı; `releaseCandidate` ile
  `rollbackImageTag` aynı tag olamaz.
- Her persona senaryosundaki `evidence` maddeleri gerçek screenshot, Playwright trace, GitHub run,
  log, ticket veya artifact referansı göstermeli; `previous-pass`, `backup-bucket`, `qa-owner`, `example`,
  `.test`, `redacted`, `localhost`, `__SET` veya şablondaki açıklama cümleleri yalnız template
  kontrolünde `UAT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
- `artifact:` ile verilen UAT evidence maddeleri repo içi relative, mevcut ve symlink olmayan dosyaya
  bağlanmalıdır; `../`, mutlak path, temp path veya `artifacts/local/**` referansı release kanıtı
  sayılmaz.
- `UAT_EVIDENCE_TARGET`, `restoreBackupReference` ve persona evidence referansları userinfo,
  query token veya fragment taşıyamaz.
- `UAT_COMMAND_EVIDENCE_TARGET`, 12 zorunlu komutun her biri için `status=PASS` ve kalıcı
  artifact/log/run/url referansı taşır. `UAT_SCENARIOS_TARGET`, 21 UAT senaryosunun tamamını
  exact ID/persona setiyle ve her senaryo için kalıcı evidence listesiyle taşır. `pnpm uat:generate`
  bu iki kaynak artifact, gerçek tester/release/rollback/restore değerleri ve boş defect seti
  olmadan `reports/uat.json` yazmaz; çıktıyı `pnpm uat:check` ile tekrar doğrular.
  `UAT_OUTPUT`, `UAT_COMMAND_EVIDENCE_TARGET` ve `UAT_SCENARIOS_TARGET` lokal temp path,
  `artifacts/local/**`, symlink file veya symlink parent zinciri altında olamaz.

Live onboarding smoke preflight:

```sh
NEXT_E2E_LIVE_ONBOARDING=1 \
LIVE_ONBOARDING_EVIDENCE_PATH=/root/o-okul-private/uat/live-onboarding-input.json \
LIVE_ONBOARDING_EMAIL_EVIDENCE_ENDPOINT=https://notify.staging.o-okul.com/messages/latest \
LIVE_ONBOARDING_EMAIL_EVIDENCE_BEARER_TOKEN=__SECRET__ \
pnpm live:onboarding:evidence-check
```

Smoke komutu aynı preflight'ı tarayıcı açmadan önce otomatik çalıştırır:

```sh
NEXT_E2E_LIVE_ONBOARDING=1 \
LIVE_ONBOARDING_EVIDENCE_PATH=/root/o-okul-private/uat/live-onboarding-input.json \
LIVE_ONBOARDING_EMAIL_EVIDENCE_ENDPOINT=https://notify.staging.o-okul.com/messages/latest \
LIVE_ONBOARDING_EMAIL_EVIDENCE_BEARER_TOKEN=__SECRET__ \
pnpm live:onboarding:smoke
```

`LIVE_ONBOARDING_EVIDENCE_PATH` JSON'u system admin credential'ları ile Base32 `totpSecret` değerini,
ilk tenant admin credential'larını, tenant adı/slug/plan/koltuk limitini ve opsiyonel kurulum alanlarını
exact shape ile taşır. Sistem admin MFA kaydı ve bilinen seed parolasının private güçlü parolaya dönüşümü
smoke öncesinde bir kez tamamlanmış olmalıdır; smoke enrollment ekranı görürse fail-closed durur.
Parola ve TOTP anahtarı yalnız repo dışındaki `0600` private girdide tutulur, artifact veya loga yazılmaz. Gerçek staging
kanıtında `generatedAt` 24 saatten eski olamaz; `example`, `.test`, `redacted`, `localhost`, `__SET` veya placeholder değerler kabul edilmez;
dosya lokal temp path (`/tmp`, `/var/tmp`), symlink dosya veya symlink parent zinciri altında olamaz.
Smoke, ilk yöneticiye gerçekten ulaşan bağlantıyı bearer korumalı HTTPS inbox evidence endpoint'inden
PII'yi URL/loglara taşımayan JSON POST gövdesindeki `recipient`, `purpose=PASSWORD_RESET` ve
`createdAfter` ile poll eder; endpoint yalnız `{ "activationUrl": "..." }`
döndürür ve URL tokenı hiçbir kalıcı evidence çıktısına yazılmaz.
Preflight endpoint'i tam olarak `https://notify.staging.o-okul.com/messages/latest` olmalıdır; production
hostu, farklı path, query veya fragment kabul edilmez.
`pnpm live:onboarding:evidence-contract` bu negatifleri lokal CI'da tarayıcı açmadan korur.

Live UI-worker/report smoke preflight:

Önce onaylı iki iSEM fixture dosyasını staging secret manager içinde base64 secret olarak tutun:
`ISEM_OPTICAL_PIPELINE_TXT_BASE64` ve `ISEM_OPTICAL_PIPELINE_ANSWER_KEY_BASE64`. Bunları repoya,
artifact'e veya loga yazmayın. Wrapper secret'ları temiz checkout'ta `0700` geçici dizine `0600`
dosya olarak materialize eder, manifestteki fixture kimliği/SHA-256 ile doğrular, child smoke'a yalnız
mutlak `ISEM_OPTICAL_PIPELINE_INPUT_ROOT` verir ve başarı/hata halinde geçici dizini temizler.
Staging secret'larını ilk kez bağlarken altyapı başlatmadan preflight çalıştırın:

```sh
ISEM_OPTICAL_PIPELINE_PRIVATE_INPUTS_PREFLIGHT_ONLY=1 \
node scripts/run-isem-optical-pipeline-private.mjs
```

Ardından iSEM optik smoke aynı run için private UI-worker input'unu üretebilir:

```sh
: "${ISEM_OPTICAL_PIPELINE_SMOKE_PASSWORD:?staging secret gerekli}"
STAGING_ENVIRONMENT=staging \
ISEM_OPTICAL_PIPELINE_SMOKE_EMAIL_DOMAIN=staging.o-okul.com \
ISEM_OPTICAL_PIPELINE_SMOKE_PASSWORD="$ISEM_OPTICAL_PIPELINE_SMOKE_PASSWORD" \
ISEM_OPTICAL_PIPELINE_SMOKE_EVIDENCE_FILE=artifacts/staging/isem-optical-pipeline.json \
ISEM_OPTICAL_PIPELINE_UI_WORKER_EVIDENCE_FILE=artifacts/staging/private/live-ui-worker-input.json \
pnpm isem-optical-pipeline:smoke
```

Public/redacted ara kanıt ayrıca doğrulanır:

```sh
ISEM_OPTICAL_PIPELINE_TARGET=file://$PWD/artifacts/staging/isem-optical-pipeline.json \
pnpm isem-optical-pipeline:evidence-check
```

`STAGING_EVIDENCE_ENV_B64` içindeki `ISEM_OPTICAL_PIPELINE_TARGET` aynı kalıcı artifact'i
göstermelidir; `pnpm prod:evidence:check --summary-file` bu kanıtı `reports/isem-optical-pipeline.json`
olarak release bundle'a yazar. `artifacts/local/**` altındaki local smoke çıktıları staging/prod
kanıtı olarak kullanılmaz ve checker tarafından reddedilir.

```sh
STAGING_ENVIRONMENT=staging \
NEXT_E2E_BASE_URL=https://o-okul.com \
NEXT_E2E_SKIP_WEB_SERVER=1 \
NEXT_E2E_LIVE_UI_WORKER=1 \
LIVE_UI_WORKER_EVIDENCE_PATH="$PWD/artifacts/staging/private/live-ui-worker-input.json" \
LIVE_UI_WORKER_RESULT_EVIDENCE_FILE="$PWD/artifacts/staging/live-ui-worker-result.json" \
pnpm live:ui-worker:evidence-check
```

Smoke komutu aynı preflight'ı tarayıcı açmadan önce otomatik çalıştırır:

```sh
STAGING_ENVIRONMENT=staging \
NEXT_E2E_BASE_URL=https://o-okul.com \
NEXT_E2E_SKIP_WEB_SERVER=1 \
NEXT_E2E_LIVE_UI_WORKER=1 \
LIVE_UI_WORKER_EVIDENCE_PATH="$PWD/artifacts/staging/private/live-ui-worker-input.json" \
LIVE_UI_WORKER_RESULT_EVIDENCE_FILE="$PWD/artifacts/staging/live-ui-worker-result.json" \
pnpm live:ui-worker:smoke
```

Secret içermeyen result artifact ayrıca içerik sözleşmesiyle doğrulanır:

```sh
LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET=file://$PWD/artifacts/staging/live-ui-worker-result.json \
pnpm live:ui-worker:result-check
```

`LIVE_EXAM_CYCLE_TARGET` ile doğrulanan tam sınav döngüsü kanıtı, `evidenceReferences`
içinde `isem-optical-pipeline.json`/`.log` ve `live-ui-worker-result.json`/`live-ui-worker-report.json`
kalıcı artifact/run/log referanslarını taşımalıdır; yalnız prefix'i doğru ama alakasız marker dosyaları
veya `artifacts/local/**` local smoke referansı PASS sayılmaz.

`LIVE_UI_WORKER_EVIDENCE_PATH` JSON'u rapor admin credential'ını, `examId`, `firstStudentId` ve
opsiyonel öğrenci/veli portal credential'larını exact shape ile taşır. Bu dosya kalıcı/public kanıt
değil, sadece private runtime input'tur; path zincirinde `private` segmenti olmalı, dosya izni
0600 olmalı, smoke üretirse 0600 modunda yazılır ve release bundle/production summary/public evidence template içine gömülmez.
`NEXT_E2E_BASE_URL` gerçek `https://` staging/prod web origin'i olmalı, lokal/test/placeholder host
olamaz; `NEXT_E2E_SKIP_WEB_SERVER=1` local Next dev server'in yanlışlıkla kanıt yerine geçmesini
engeller. Giriş tenant alt alan adına yönlendirdiği için canlı smoke, girişten sonraki kurum ve portal
route'larını o anki tenant origin'i üzerinde açar; apex `NEXT_E2E_BASE_URL` üzerine geri dönmez.
Gerçek staging kanıtında `ISEM_OPTICAL_PIPELINE_SMOKE_PASSWORD` secret store'dan açıkça verilir;
en az 16 karakter, büyük/küçük harf, rakam ve sembol içermeyen veya yaygın varsayılan parola olan
değerler reddedilir. `example`, `.test`, `redacted`, `localhost`, `__SET` veya placeholder
değerler kabul edilmez; `generatedAt` 24 saatten eski olamaz; dosya lokal temp path (`/tmp`, `/var/tmp`), symlink dosya veya symlink parent
zinciri altında olamaz.
`LIVE_UI_WORKER_RESULT_EVIDENCE_FILE` ise secret içermez; Excel/PDF indirme ve portal görüntüleme
sonucunu kalıcı staging artifact'i olarak yazar. `pnpm live:ui-worker:result-check` bu JSON'un
`reportStatus=READY`, `xlsx/pdf` indirme, öğrenci/veli portal görünümü, bütün smoke oturumlarının
çıkışla iptal edildiğini gösteren `sessionLogoutVerified=true`, hashli sınav/öğrenci
referansları, boş `gaps`, 24 saatten eski olmayan `generatedAt`, `artifacts/local/**` dışında kalıcı target ve temp/symlink olmayan target sözleşmesini doğrular; tam sınav döngüsü
kanıtında referans verilebilir. `prod:evidence:check --summary-file` aynı artifact'i
`reports.liveUiWorkerResult` alanına taşır; production summary ve go-live linked summary bu rapor
eksikken PASS alamaz. Result artifact ham e-posta, parola veya öğrenci id'si taşımaz.
`pnpm live:ui-worker:evidence-contract` bu negatifleri lokal CI'da tarayıcı açmadan korur.

## Pilot Closure Evidence

Amaç: Faz 10 sonunda pilot kurumla gerçek veri üstünden genel açılışa hazır olunduğunu kanıtlamak.

Kanıt sözleşmesi: `docs/evidence-templates/pilot.example.json`.

Komut:

```sh
PILOT_EVIDENCE_TARGET=file:///path/to/pilot.json pnpm pilot:check
```

Minimum kanıt içeriği:

- `environment=production`, 14 gün veya daha uzun pilot süresi.
- KVKK aydınlatma ve veri işleme sözleşmesi onayı.
- Gerçek öğrenci Excel import dry-run→commit ve kimlik göç onay referansı.
- En az 1 gerçek sınav döngüsü: cevap anahtarı, optik import, karantina çözümü, rapor/karne,
  Excel/PDF indirme ve veli portal görüntüleme.
- Bu döngü için dar kanıt kapısı `LIVE_EXAM_CYCLE_TARGET=file:///... pnpm live:exam-cycle:check`
  olarak çalıştırılır ve sonuç UAT/pilot/go-live kanıtlarına bağlanır. Rapor top-level 11
  alanı, `examCycle` 27 alanı, 5 komutluk `commandsPassed` seti ve boş `gaps` listesi
  `prod:evidence:templates:check` fazla alan/komut ve invalid/non-empty gaps negatifleriyle korunur.
- 10k rapor listeleme k6 p95 eşikleri, >200 rps RLS yük smoke'u ve rapor üretim süresi eşiği.
  Rapor üretim kanıtı için `REPORT_GENERATION_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/report-generation.json pnpm report-generation:perf`
  çalıştırılır; artifact `report_generation_smoke`, hash'li tenant/user/email/exam/snapshot referansları,
  `generationDurationMs`, `resultCount=10000` ve eşik sonucunu taşır, ham credential veya ham id içermez.
  Artifact top-level alan seti, `hashes`/`thresholds` blok shape'leri, tek izinli `commandsPassed`
  değeri ve boş `gaps` listesi `pnpm smoke:evidence:check` içinde korunur. Go-live linked
  production summary bu kanıtı yalnız `commandsPassed=["pnpm report-generation:perf"]`,
  `resultCount>=10000`, `studentCount>=10000` ve `generationDurationMsMax=60000` ile kabul eder;
  daha küçük `report-generation:smoke` çıktısı Faz 10 kapanış kanıtı değildir. Production evidence
  summary üretiminde perf payload'ı `artifacts/staging/smoke/report-generation.json` dosyasına
  otomatik yönlendirilir ve staging release bundle içinde summary ile birebir eşleştirilir.
- Dar RLS kanıtı `RLS_LIVE_EVIDENCE_TARGET=file:///... pnpm rls:live:check` ile arşivlenir ve
  pilot/go-live paketindeki production summary'ye bağlanır.
- Remote CI kanıtı `GITHUB_CI_EVIDENCE_TARGET=file:///... pnpm github-ci:check` ile arşivlenir;
  GitHub Actions run URL'i go-live evidence paketine bağlanır.
- Sentry/alert/destek talebi olay tatbikatı, restore drill tekrarı ve açık kritik hata 0.
- Assessment başarı kriterlerinin 10 maddesi `PASS` ve `goLiveDecision=APPROVED`.
- Pilot raporu top-level 18 alanı, `realDataImport`/`examCycle`/`performance`/`operations`
  blok shape'leri, `AC-01`..`AC-10` assessment seti ve boş `gaps` listesini tam, tekrarsız ve
  beklenmeyen alansız taşır; `prod:evidence:templates:check` fazla alan, beklenmeyen criterion ve
  invalid/non-empty gaps negatiflerini kırmızıya düşürür.
- Pilot tenant, kimlik göçü, sınav, restore drill, assessment kriteri ve artifact referansları gerçek kanıt
  göstermeli; `redacted`, `example`, `.test`, `localhost`, `__SET` veya placeholder değerler yalnız template
  kontrolünde `PILOT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
- `checkedAt` ve `pilotEndDate` gelecekte olamaz; pilot kapanış raporu `pilotEndDate` tamamlanmadan
  imzalanmış kabul edilmez.

## Notification gateway

Production e-posta çıkışı `infra/notification-gateway` altındaki bearer-korumalı Cloudflare
Worker üzerinden yapılır. Cloudflare Email Service içinde `o-okul.com` sender domain'i aktif,
`bildirim@o-okul.com` izinli sender ve `destek@o-okul.com` Reply-To olmalıdır. Google Workspace
MX kayıtları korunur; Email Service yalnız `cf-bounce` MX/SPF/DKIM kayıtlarını ve domain DMARC
kayıtlarını kullanır. Kök DMARC politikası bağımsız doğrulanıp korunur; mevcut production değeri
`p=none` olarak izleme modundadır.

```sh
corepack pnpm notification-gateway:test
cd infra/notification-gateway
printf '%s' "$NOTIFICATION_HTTP_BEARER_TOKEN" | npx wrangler secret put NOTIFICATION_BEARER_TOKEN
release_sha="$(git -C ../.. rev-parse HEAD)"
npx wrangler deploy --var "RELEASE_SHA:$release_sha"
test "$(curl -fsS https://notify.o-okul.com/health | jq -r .releaseSha)" = "$release_sha"
```

Production Worker'da `LIVE_ONBOARDING_EMAIL_EVIDENCE_ENABLED=false` ve
`LIVE_ONBOARDING_EMAIL_EVIDENCE_ENVIRONMENT=production` varsayılandır; `/messages/latest` production
hostunda `404` döner ve aktivasyon tokenı tutulmaz. Kanıt yüzeyi yalnız ayrı staging Worker'da
`LIVE_ONBOARDING_EMAIL_EVIDENCE_ENABLED=true`, `LIVE_ONBOARDING_EMAIL_EVIDENCE_ENVIRONMENT=staging`,
`LIVE_ONBOARDING_EMAIL_EVIDENCE_HOST=notify.staging.o-okul.com` ve exact
`LIVE_ONBOARDING_EMAIL_EVIDENCE_ACTIVATION_HOST` ile açılabilir. İzole staging UI topolojisinde bu
değer `<tenant>.staging.o-okul.com`, release UI mevcut public tenant hostunda çalışıyorsa exact
`<tenant>.o-okul.com` olmalıdır. Her iki durumda evidence endpoint'i yalnız
`notify.staging.o-okul.com` üzerinde açılır; production Worker bu kanıt yüzeyini sunmaz.
Staging Worker yalnız repo dışında Wrangler secret olarak tanımlanan exact base alıcıyı ve onun
`+run-id` alias'larını, Email Sending kabulünden sonra alıcının HMAC kimliği altında 15 dakika tutar. `POST /messages/latest` ayrı bearer
ister; ham alıcı kalıcı anahtara, URL'ye veya yanıta yazılmaz ve normal parola sıfırlama/diğer alıcılar
kaydedilmez. Üç onboarding secret'ı yalnız staging Worker'ın Wrangler secret store'una yazılır; production
Worker'a kurulmaz.

Wrangler'ın döndürdüğü Worker version ID ile `/health` exact SHA sonucu release kaydına birlikte
eklenir. Aynı `idempotencyKey` için SQLite-backed Durable Object önce kalıcı teslim kaydı açar;
provider sonucu belirsiz kalırsa aynı anahtar yeniden gönderilmez. Bu at-most-once davranışında
operatör yeni davet/parola bağlantısı üreterek yeni bir teslim kaydı oluşturur. Kalıcı kayıtta
alıcı veya mesaj gövdesi tutulmaz ve dedupe kaydı 30 gün sonra temizlenir.

Runtime `.env` içinde `NOTIFICATION_PROVIDER=http`,
`NOTIFICATION_HTTP_ENDPOINT=https://notify.o-okul.com`,
`NOTIFICATION_ALLOW_NOOP_IN_PRODUCTION=false`, doğru From/Reply-To ve repo dışı gerçek bearer
secret kullanılır. `pnpm notification:smoke` gerçek alıcıyla PASS olmadan provider kanıtı kapanmaz.
UAT için cutover sonrasında üretilmiş aynı smoke artifact'i final summary aggregation'a taşınırken
`--reuse-notification-smoke` yalnız `NOTIFICATION_SMOKE_NOT_BEFORE=<cutoverAt>`, exact maskeli alıcı,
`provider=http` ve tek `EMAIL` kanalı doğrulandıktan sonra ikinci gönderimi bastırır. Artifact eksik,
eski, symlink veya farklı alıcı/kanal ise aggregation fail-closed olur.
Gateway PUSH mesajını gönderilmiş gibi işaretlemez; ayrı push sağlayıcısı kurulana kadar
`NOTIFICATION_PUSH_NOT_CONFIGURED` ile fail-closed kalır ve production
`NOTIFICATION_SMOKE_PUSH_TO` boş tutulur.

Gateway içinde WhatsApp Meta Cloud API ve `/webhooks/whatsapp` temeli de bulunur; Wrangler
varsayılanı `WHATSAPP_ENABLED=false` olduğu için gönderim provider'a gitmeden fail-closed olur ve
webhook yolu capability sunmaz. Yerel testler yalnız utility template istek biçimini, ham request
baytları üstünde `X-Hub-Signature-256` doğrulamasını, tek pilot numaranın sunucu taraflı tenant
eşlemesini ve SQLite-backed Durable Object tekrar bastırmasını kanıtlar. Meta'nın döndürdüğü
`messages[0].id` yalnız provider kabulüdür; teslimat değildir. Webhook bu aşamada duyuru/teslimat
durumunu güncellemez ve ham payload, telefon ya da WhatsApp message ID saklamaz.

Onaylı pilot diliminden önce `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_UTILITY_TEMPLATE_NAME`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET` ve `WHATSAPP_PILOT_TENANT_ID` Worker secret/var değerleri kurulmaz;
`WHATSAPP_ENABLED` açılmaz. Tenant + telefon hash + amaç kapsamlı append-only lifecycle ve
`StudentContact` veri sahibi FK'sı yerel DB/store düzeyinde hazırdır; aynı telefonlu kardeşlerden
birinin geri çekmesi ortak projection'ı kapatır. İzin yönetimi ve geri çekme UI/API yüzeyi, retention
ve purge kararı/yolu, worker gönderim anı yeniden kontrolü,
tenant-bound outbound mesaj kaydı ve webhook teslim uzlaştırması tamamlanmadan yerel/mock PASS,
provider smoke veya staging teslim kanıtı gibi raporlanamaz.
Doğrudan inactive/version 0 projection INSERT yalnız telefon kapsamı için eventless rezervasyon
sözleşmesidir; bu P2 yolunun runtime bağlantısı yoktur ve satır `recordCount` içinde sayılır.
Aktivasyon öncesi `ContactIdentity` ile numara yeniden tahsisi doğrulaması, keyed phone HMAC ve anahtar
rotasyonu ile gerçek DB'den salt sayım artifact'i üreten staging generator ayrıca tamamlanmalıdır.
Aktivasyon ayrıca hukuk/veri koruma sahibinin retention ve purge kararını ve açık runtime için yeni KVKK kanıt sözleşmesini
gerektirir; mevcut no-records policy bloğu
bu release'i WhatsApp-capable yapmaz ve açık runtime'a aynen taşınamaz.

## Go-live Decision Evidence

Amaç: Pilot kapanışı ve production evidence zinciri geçtikten sonra genel açılış kararını tek,
imzalı ve denetlenebilir kanıt paketiyle kapatmak.

Kanıt sözleşmesi: `docs/evidence-templates/go-live.example.json`.

Komut:

```sh
GO_LIVE_EVIDENCE_TARGET=file:///path/to/go-live.json pnpm go-live:check
```

Canlı Durum transition guard ayrıca bu satırları korur:

```sh
pnpm live:status:generate -- --summary-target /path/to/release-summary.json --pilot-target /path/to/pilot.json --go-live-target /path/to/go-live.json --output /path/to/live-status.json
LIVE_STATUS_EVIDENCE_TARGET=file:///path/to/live-status.json pnpm live:status:check
```

`--generated-at` yalnız özel override gerektiğinde verilir; aksi durumda üretici önce go-live
raporundaki `liveStatusEvidence.generatedAt`, yoksa `checkedAt` değerini kullanır.
Üretici source bundle'ı yazmadan önce production summary ve pilot JSON'larını ilgili checker'larla
doğrular; çıktı yazıldıktan sonra go-live checker'ını bağlı live-status zinciriyle tekrar çalıştırır.
Normal çalışmada `--output` yolu, go-live raporundaki `liveStatusEvidence.evidenceTarget` ile aynı
Canlı Durum artifact'ini göstermelidir; üretici bu eşleşmeyi erken reddeder.
Canlı Durum source/output hedefleri yalnız kalıcı, symlink olmayan `file://` artifact yolu veya
`https://` URL olabilir; `http://`, lokal temp path, symlink artifact ve symlink parent directory
hedefleri üretici, checker ve go-live linked checker tarafından reddedilir.
Staging release bundle kontrolü first-gates Traefik URL/status/HSTS ve alert webhook
URL/status/auth scheme alanlarının final `summary.smokeEvidence` değerleriyle eşleşmesini de
zorunlu kılar; farklı host veya webhook ile alınmış erken gate kanıtı Canlı Durum'a terfi edemez.

Kanıt template'i: `docs/evidence-templates/live-status.example.json`.
PASS geçiş fixture'i: `docs/evidence-templates/live-status-pass-readiness.example.md`.

Minimum kanıt içeriği:

- `environment=production`, release candidate ve rollback image tag referansı.
- Go-live top-level alanları, `productionEvidenceSummary`, `liveStatusEvidence`, `deployment`, `uat`,
  `pilot`, `legal`, `operations`, `cutover`, `approvals` ve `openRisks` bloklarının anahtar setleri
  tam ve beklenmeyen alansız olmalıdır; approval rolleri product/technical/operations/dataProtection
  olarak tam ve tekrarsız taşınır.
- Go-live raporundaki `liveStatusEvidence.evidenceTarget`, aynı artifact setindeki Canlı Durum
  transition bundle'ını göstermelidir; `pnpm go-live:check` bu bundle'ı okur, 17 dış kapının
  `PASS` olduğunu ve summary/pilot/go-live hedeflerinin aynı dosyalara bağlandığını doğrular.
  Bundle içindeki `productionEvidenceSummaryTarget`, `goLiveEvidenceTarget` ve
  `pilotEvidenceTarget` alanları go-live paketindeki aynı summary/go-live/pilot artifact hedeflerine
  çözülmelidir.
- Canlı Durum transition bundle'ı `Traefik HTTPS smoke`, `Live exam cycle kanıtı`, `iSEM optical pipeline kanıtı`,
  `Live UI-worker result kanıtı`, `KVKK inventory kanıtı`, `RLS live kanıtı`,
  `Inline upload migration kanıtı`, `Audit null tenant kanıtı`, `Rate limit Redis kanıtı`,
  `SMS disabled path kanıtı`, `Notification provider kanıtı`, `Report generation perf kanıtı`,
  `Staging/prod UAT`, `Deployment rollback tatbikatı`, `Pilot kapanış kanıtı`,
  `Go-live karar paketi` ve `Alert bildirim kanalı` satırlarını
  readiness dokümanındaki durumla birebir eşleştirir. Liste tam 17 satırdan oluşmalı, beklenmeyen
  veya tekrarlı gate içermemelidir. Readiness içindeki `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`,
  staging artifact'inin checker'dan geçtiğini ama production summary/live-status/pilot/go-live
  zincirine bağlanmadığını gösterir; go-live bundle'ında 17 gate yine `PASS` olmalıdır. Bundle
  top-level alanları ve her gate item alan seti tam ve
  beklenmeyen alansız olmalıdır. Her gate `command` ve `source` değeri kanonik listeyle
  eşleşmelidir; `checkedAt` geçerli tarih, `evidenceReference` source artifact referansıyla eşleşen
  boş olmayan string olmalı ve
  `checkedAt` ilgili smoke/report/pilot/go-live kaynak tarihiyle eşleşip bundle `generatedAt`
  sonrasına düşemez. `pnpm live:status:check` bundle içindeki summary/go-live/pilot target'larını
  okuyarak bu source-date ve `evidenceReference` eşleşmesini tek başına da doğrular; kaynak nesnede
  `result` varsa `PASS`, `environment` varsa `production` olmalıdır. `pnpm go-live:check`
  ayrıca target'ların go-live paketindeki aynı artifact setine çözüldüğünü kontrol eder.
  `example`, `.test`, `redacted`,
  `localhost` veya `__SET` referansları normal çalışmada reddedilir.
  `pnpm prod:evidence:templates:check` duplicate gate, NOT_RUN command/source/checkedAt/
  evidenceReference sapması, geç `checkedAt`, UAT top-level/komut/journey shape fazlası,
  live-exam-cycle top-level/examCycle/command/gaps shape fazlası,
  inline-upload migration top-level/storage/dry-run/migration/subject/migrated/command/gaps shape fazlası,
  contentBase64 write-disable, TTL, pending row/byte ve migrated row tutarlılığı sapmaları,
  audit-null-tenant top-level/breakdown/unknown/total/gaps shape fazlası,
  identity-migration top-level/decision/subject/invitation/verification/gaps shape fazlası,
  financial-retention top-level/policy/records/purge-behavior/gaps shape fazlası,
  observability-uat top-level/dashboard/alert/gaps shape fazlası,
  security-audit top-level/header/auth/data shape fazlası,
  external-monitoring top-level/node/monitor/outage/gaps shape fazlası,
  admin-mfa top-level/policy/enrollment/login/gaps shape fazlası,
  upload-av top-level/scanner/surface/result/gaps shape fazlası,
  kvkk-inventory top-level/count/coverage/action/gaps shape fazlası,
  restore-drill top-level/tableCounts shape fazlası,
  rate-limit top-level/config/instance/API/login/path/command/gaps shape fazlası,
  RLS live top-level/schema/isolation/loadSmoke/table/command/gaps shape fazlası,
  pilot top-level/nested/assessment/gaps shape fazlası, deployment rollback top-level/servis/komut/gaps shape,
  kronoloji fazlası ve release=rollback sapması, external monitoring outage chronology/latency, production summary smoke environment, Traefik URL origin ve live exam cycle release/app/API sapması, go-live `gatesPassed` fazlası, live-status
  top-level/gate item shape fazlası, bağlı live-status duplicate
  gate/top-level/gate item shape fazlası, live-status source-date/evidenceReference ve `FAIL`/staging source sapmaları, bağlı live-status target, source-date ve evidenceReference sapmaları ile kırık summary/pilot/go-live kaynak ve go-live linked pilot gaps negatiflerinin yanında production summary
  top-level/check-list/check-field/smoke/report/report-field fazlası, check status/script/duplicate sapmaları ve smoke/report tarih negatifleri, go-live top-level/production-summary/
  deployment/approval shape fazlası, go-live `checksPassed` fazlası, go-live karar kronolojisi
  negatifleri, bağlı summary duplicate check, bağlı summary top-level/check-field fazlası ve bağlı
  summary smoke/report/report-field fazlası negatiflerini fixture seviyesinde de doğrular.
- `prod:evidence:check --summary-file` çıktısındaki production evidence summary; `summaryTarget`
  alanı aynı JSON'u file/http/https veya go-live raporuna göreli URL olarak göstermeli ve tüm zorunlu
  evidence adımları bağlı summary içinde tam, tekrarsız ve beklenmeyen madde içermeyen check listesi
  olarak, beklenen script path'leriyle `PASS` olmalı; bağlı summary top-level alanları, check item
  `label/script/status` şekli, `smokeEvidence`, `reports` ve her gömülü report blok anahtar seti de tam ve beklenmeyen
  alansız olmalıdır. Go-live raporundaki
  `productionEvidenceSummary.generatedAt` bağlı summary `generatedAt` değeriyle eşleşmelidir. Bağlı
  summary içindeki smoke evidence ve report alanları `environment=production` taşımalıdır; smoke
  evidence `generatedAt` tarihleri summary `generatedAt` veya go-live `checkedAt` karar zamanından
  sonra olamaz; production summary içindeki UAT `releaseCandidate`/`rollbackImageTag` değerleri
  deployment rollback raporuyla, live exam cycle `releaseCandidate` değeri UAT `releaseCandidate`
  değeriyle, live exam cycle `appUrl`/`apiUrl` değerleri summary top-level `appUrl`/`apiUrl`
  değerleriyle ve `restoreBackupReference` değeri restore drill `sourceBackup`
  değeriyle eşleşmelidir; linked deployment rollback `releaseCandidate` ve `rollbackImageTag` değerleri go-live
  raporundaki top-level değerlerle eşleşmeli, report `checkedAt`/`drillDate` tarihleri summary
  `generatedAt` veya go-live `checkedAt` karar zamanından sonra olamaz. Normal `go-live:check` çalışması `.test`, `example` veya placeholder host/image/provider
  değerlerini reddeder; linked summary deployment rollback `commandsPassed`, servis image/evidence
  referansları ve `evidenceReferences` alanlarını, GitHub CI
  `runUrl`, `commitSha`, `workflowUsesSingleCiCommand` ve `githubCiPassed` değerlerini, RLS live
  `schema.tablesVerified`, `crossTenantReadRows`, `withCheckRejects`, `loadSmoke.actualRps` ve
  `rlsLivePassed` değerlerini, audit null tenant `unknown.count=0` ve toplam tutarlılığını,
  restore drill `sourceBackup`/`targetDatabase`, KVKK
  `dataSubjectCounts`/`purgeCoverage` ve audit action kapsamını,
  identity migration `migrationDecision`, financial retention `policyDecision` ve upload AV
  `scannerDecision` değerlerini korumalıdır. Linked UAT `releaseCandidate`/`rollbackImageTag` değerleri
  go-live top-level değerlerle, `restoreBackupReference` değeri restore drill `sourceBackup` değeriyle
  eşleşmeli ve `liveExamCyclePassed=true` kalmalıdır. `pnpm go-live:check` bağlı pilot JSON'daki boş `gaps` listesini de zorunlu tutar; linked
  pilot invalid/non-empty gaps negatifleri `prod:evidence:templates:check` içinde kırmızıya düşer. Bu
  gevşetme yalnız template kontrolünde `GO_LIVE_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır.
- Deployment region, Traefik HTTPS, restore drill, off-host backup, WAL archive, rollback drill,
  observability UAT ve security audit onayları.
- Rol bazlı staging/prod UAT, live onboarding smoke ve live UI-worker report smoke onayları.
- Pilot kanıtı `pilotEvidenceReference` ile okunabilir JSON'a bağlanmalı; 14+ gün pilot süresi,
  boş `gaps` listesi, açık kritik hata 0 ve pilot `goLiveDecision=APPROVED` bağlı pilot raporundan da doğrulanır.
- Go-live raporu geleceğe tarihli olamaz; production summary `generatedAt` ve bağlı pilot `checkedAt`
  go-live `checkedAt` değerinden sonra olamaz.
- Cutover `scheduledAt` go-live karar zamanından önce olamaz; role approval `approvedAt` değerleri
  geleceğe veya go-live `checkedAt` sonrasına taşamaz. Template harness production summary/live-status
  karar sonrası, cutover karar öncesi ve approval karar sonrası negatiflerini kırmızıya düşürür.
- KVKK aydınlatma, veri işleme sözleşmesi, veri envanteri ve finansal saklama onayları.
- Operasyon sahipliği, alert/support kanalı, cutover zamanı, rollback penceresi ve 24+ saat
  monitoring penceresi.
- Product, technical, operations ve data-protection rollerinden imzalı `APPROVED` kararı.
- Açık risklerde `HIGH`/`CRITICAL` yok; kalan `LOW`/`MEDIUM` riskler kabul edilmiş ve mitigasyonlu.
- Release summary target/reference, pilot kanıt referansı, operasyon sahibi, destek kanalı, approver/owner ve
  top-level `evidenceReferences` gerçek run/artifact/ticket/onay referansı olmalı; `redacted`, `example`,
  `.test`, `localhost`, `__SET` veya placeholder değerler yalnız template kontrolünde
  `GO_LIVE_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
- Bağlı production summary içindeki smoke evidence alanları gerçek script çıktısına uymalı: Sentry `eventId`/DSN,
  alert webhook URL/status/`authorizationScheme="bearer"`, SMS provider `segments`/boş olmayan gerçek `providerMessageId`,
  SMS/notification provider ve masked recipient, backup/WAL target özeti ve `markerSha256` değerleri
  placeholder içeremez. SMS/notification recipient alanları ham telefon, e-posta veya push endpoint'i
  taşıyamaz; Provider/Sentry smoke artifact'lerinde canonical `commandsPassed` tek komut olmalı ve
  `gaps` boş kalmalıdır.

## Tenant Koltuk Limiti Runtime

- `seatLimit` tenant admin kullanıcı oluşturma ve kimlik daveti kabul akışlarında kontrol edilir.
- Aynı tenant içindeki mevcut e-posta/rol güncellemeleri yeni koltuk tüketmez.
- Dolu tenant yeni üyelik yazımlarında `TENANT_SEAT_LIMIT_EXCEEDED` döner.
- Postgres üyelik yazımı yeni kullanıcı üyeliği eklemeden önce tenant satırını kilitler ve distinct
  `TenantMembership.userId` sayımıyla limiti doğrular.

## Tenant Lisans Read-only Runtime

- Lisansı bitmiş ama `ACTIVE` tenant kullanıcıları login olabilir ve GET/HEAD/OPTIONS istekleriyle
  mevcut veriyi okuyabilir.
- Aynı tenant için POST/PATCH/PUT/DELETE yazma istekleri middleware'de `TENANT_LICENSE_EXPIRED_READ_ONLY`
  koduyla 403 olarak durdurulur.
- `SUSPENDED` veya `DELETED` tenant'lar read-only moda alınmaz; request context kurulmadan
  `TENANT_INACTIVE_OR_EXPIRED` ile reddedilir.

## Kurum Veri Export ve Opsiyonel Backup Smoke

İlk pilotta off-host yedek hedefi release planından çıkarılmıştır: kurum yetkilisi `/kurum/yedek-restore`
ekranındaki "Kurum verisini indir" aksiyonuyla kendi eklediği öğrenci, veli, öğretmen, sınıf,
finans, sınav, rapor, duyuru ve destek kayıtlarını JSON olarak bilgisayarına indirir. Bu dosyanın
sunucu dışındaki kurum cihazında saklanması pilot yedek kanıtıdır.

Ops seviyesinde kalıcı `BACKUP_OFFSITE_TARGET` hedefi ileride tekrar açılırsa hedefin yalnız yazılı değil,
gerçekten yaz/oku/sil döngüsünü tamamladığı ayrıca kanıtlanır. Release kanıtı için yalnız marker
smoke yeterli değildir; canlı dump'ın off-host hedefe yazılıp aynı dump'tan restore edildiği
`backup:offsite-restore:smoke` artifact'i gerekir.

Komut:

```sh
pnpm backup:offsite:smoke
```

Staging kanıtı repo artifact'i olarak saklanacaksa:

```sh
BACKUP_OFFSITE_SMOKE_EVIDENCE_FILE=artifacts/staging/backup-offsite.json pnpm backup:offsite:smoke
```

`file://` hedef root, lokal temp path (`/tmp`, `/var/tmp`) veya symlink dizin/parent path
olamaz; mount hedefi kalıcı, symlink olmayan dizin olmalıdır.

Artifact `checkedAt`, target özeti, marker sha256, tek
`commandsPassed=["pnpm backup:offsite:smoke"]` ve boş `gaps` listesi taşır; raw path/credential
yazılmaz.

Off-host hedef restore kanıtı:

```sh
BACKUP_OFFSITE_RESTORE_SMOKE_EVIDENCE_FILE=artifacts/staging/backup-offsite-restore.json \
BACKUP_OFFSITE_RESTORE_TARGET=s3://o-okul-prod-backups/restore-smoke \
pnpm backup:offsite-restore:smoke
```

Bu komut Postgres container içinde custom-format dump alır, dump'ı off-host hedefe yazar, aynı
dump'ı hedeften geri okur, hash eşleşmesini kontrol eder ve geçici restore DB'de `Tenant`,
`AuditLog`, `ReportSnapshot`, `_prisma_migrations` sayımlarını doğrular. Artifact
`backup_offsite_restore_smoke`, `backupSha256`, hash'li restore DB adı, `dumpFormat=custom`,
dört tablo sayımı, tek `commandsPassed=["pnpm backup:offsite-restore:smoke"]` ve boş `gaps`
listesi taşır; raw path, object key, DB adı veya credential yazılmaz.

Desteklenen hedefler:

- `file:///...`: lokal veya mount edilmiş off-host path'e test dosyası yazar, hash doğrular ve siler.
- `s3://bucket/prefix`: S3 uyumlu hedefe test nesnesi yazar, geri okur, hash doğrular ve siler.
- Opsiyonel smoke aracı placeholder/test bucket, lokal temp path, geçersiz URL ve
  boş/placeholder S3 credential değerlerini reddeder; bu hedef pilot release env sözleşmesinde
  zorunlu değildir.

S3 hedefi için `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` ve gerekirse
`S3_FORCE_PATH_STYLE=true` staging/prod env içinde ayarlanır. `S3_BUCKET`,
`S3_ACCESS_KEY_ID` ve `S3_SECRET_ACCESS_KEY` gerçek değer olmalıdır; `__SET`, `example`,
`test` veya benzeri placeholder değerler release env kontrolünden geçmez.

## Upload AV Runtime

- Staging/prod API ortamlarında `UPLOAD_AV_SCANNER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT` ve
  `CLAMAV_TIMEOUT_MS` tanımlıdır.
- Support ticket ekleri ve homework materyal dosyaları magic-byte doğrulamasından sonra, storage
  yazımından önce ClamAV `INSTREAM` taramasından geçer.
- Scanner malware bulursa istek `UPLOAD_AV_MALWARE_DETECTED` ile reddedilir; scanner'a erişilemezse
  fail-closed `UPLOAD_AV_SCANNER_UNAVAILABLE` döner.
- Staging artifact'i üretmek için:

```sh
STAGING_ENVIRONMENT=staging \
  UPLOAD_AV_OUTPUT=artifacts/staging/reports/upload-av.json \
  UPLOAD_AV_SCANNER=clamav \
  UPLOAD_AV_SCANNER_DECISION_MODE=local \
  UPLOAD_AV_APPROVED_BY=... \
  UPLOAD_AV_APPROVAL_REFERENCE=... \
  UPLOAD_AV_SCANNER_NAME=ClamAV \
  UPLOAD_AV_FAIL_CLOSED=true \
  UPLOAD_AV_CLEAN_FILE_ACCEPTED=true \
  UPLOAD_AV_EICAR_REJECTED=true \
  UPLOAD_AV_SCANNER_UNAVAILABLE_REJECTED=true \
  CLAMAV_HOST=clamav \
  CLAMAV_PORT=3310 \
  CLAMAV_TIMEOUT_MS=5000 \
  UPLOAD_AV_UNAVAILABLE_TEST_HOST=... \
  UPLOAD_AV_UNAVAILABLE_TEST_PORT=... \
  pnpm upload-av:generate
```

- Generator ClamAV `VERSION` ve `INSTREAM` ile temiz dosya ve EICAR test vektörünü gerçek scanner'a
  gönderir, unreachable scanner hedefinde fail-closed davranışını bekler, upload scanner/homework/
  support-ticket hedefli API testlerini koşar ve çıktıyı `UPLOAD_AV_TARGET=file://... pnpm upload-av:check`
  ile doğrular. `clamav` compose profili çalışmıyorsa artifact yazmadan kırılması beklenen davranıştır.
- Generator hedefli API testlerini canlı `DATABASE_URL`/`DIRECT_DATABASE_URL`/`NODE_ENV`/`ADMIN_MFA_MODE`/`PERSISTENCE_DRIVER`/`IDEMPOTENCY_STORE`
  ortamından izole eder; `.env.local` kaynaklanmış bir shell'de bile testler live DB'ye bağlanmamalıdır.
- Kimlik göçü, finansal saklama ve upload AV karar kanıtlarında karar sahibi, onay referansı ve
  scanner adı gerçek dış ortam kanıtı olmalıdır; `example`, `.test`, `redacted`, `localhost`, `__SET`
  veya placeholder değerler yalnız template kontrolünde ilgili `*_ALLOW_EXAMPLE_EVIDENCE=1` bayrağıyla
  kabul edilir. Upload AV raporu top-level 7 alanı, `scannerDecision`/`scanResults` blok shape'leri
  ve iki upload surface seti ile boş `gaps` listesi `prod:evidence:templates:check` fazla
  alan/surface ve invalid/non-empty gaps negatifleriyle korunur.

## Upload Storage Runtime

- Staging/prod API ortamlarında `SUPPORT_ATTACHMENT_STORAGE=s3` ve
  `HOMEWORK_MATERIAL_FILE_STORAGE=s3` tanımlıdır.
- API production boot sırasında inline veya geçersiz upload storage modunu reddeder.
- Support ticket ekleri `support-ticket-attachments/<tenantId>/<ticketId>/<sha256>/source`,
  homework materyal dosyaları `homework-material-files/<tenantId>/<materialId>/<sha256>/source`
  ve raw import arşivleri `raw-imports/<tenantId>/<examId>/<parserConfigVersion>/<sha256>/source`
  S3 key kalıbıyla yazılır; ham dosya adı object key'e girmez.
- Upload retention kontratı `pnpm upload-retention:check` ile korunur: support ticket ekleri,
  homework materyal dosyaları ve raw import kayıtlarında `deletedAt`/tenant indexleri, aktif
  indirme/listeleme yollarında soft-delete filtresi ve tenant-prefix storage key kalıbı birlikte aranır.
- S3 `storageKey` ile saklanan support ticket ekleri ve homework materyal dosyaları API üzerinden
  base64 proxy edilmez; indirme yanıtı kısa ömürlü imzalı GET URL'si döndürür. URL TTL'i en fazla
  5 dakikadır (`downloadUrlExpiresInSeconds <= 300`).
- Yeni S3 yazımlarında `contentBase64` kolonu `NULL` kalır; eski inline kayıtlar geriye dönük
  uyumluluk için okunabilir kalır.
- Mevcut inline kayıt sayımı ve tablo boyutu raporu `pnpm inline-upload-content:audit` ile alınır.
  Gerçek taşıma yalnız `INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true pnpm inline-upload-content:migrate`
  ile çalışır; script her satırda sha256 doğrular, tenant-prefix S3 key'e yazar, sonra `storageKey`
  set edip `contentBase64` alanını `NULL` yapar. S3 put sonrası DB update satırı kaybolursa
  önce aynı `storageKey` için DB referansı aranır; referans yoksa yazılan obje
  `DeleteObjectCommand` ile temizlenir, referans varsa obje silinmeden ham row id/key loglanmadan durur.
  Process crash/kill gibi cleanup callback'inin çalışmadığı durumlar için ayrıca orphan S3 object
  reconciliation kanıtı gereklidir:
  `INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_OUTPUT=artifacts/staging/reports/inline-upload-work/orphan-audit.json pnpm inline-upload-content:orphan-audit`.
  Rapor yalnızca prefix bazlı `listedObjects`, `dbReferencedObjects`, `orphanObjects`,
  `dbReferencedMissingObjects`, `invalidKeyObjects`, `legacyDbStorageKeyRows`, `commandsPassed`
  ve `gaps` alanlarını taşır; ham object key, tenant id, parent id, dosya adı, signed URL veya
  içerik içeremez.
- Sha/content uyuşmazlığı veya invalid base64 şüphesinde önce diagnostik rapor alınır:
  `INLINE_UPLOAD_CONTENT_HASH_AUDIT_OUTPUT=artifacts/staging/reports/inline-upload-work/hash-audit.json pnpm inline-upload-content:hash-audit`.
  Bu rapor sadece subject bazlı sayaçları, `commandsPassed=["pnpm inline-upload-content:hash-audit"]`
  ve `gaps` listesini yazar; `contentBase64`, tenant/user id, dosya adı, `storageKey`, object key
  veya signed URL içeremez. `hash-audit.json` release kanıtı değildir; repair kararını ve sonraki
  onaylı migration koşusunu destekler.
- Hash audit `missingSha256Rows` bulursa önce
  `INLINE_UPLOAD_CONTENT_SHA_REPAIR_OUTPUT=artifacts/staging/reports/inline-upload-work/sha-repair-dry-run.json pnpm inline-upload-content:repair-sha`
  çalıştırılır. Komut varsayılan olarak DB'ye yazmaz; onaylı repair yalnız
  `INLINE_UPLOAD_CONTENT_SHA_REPAIR_APPROVED=true` ile mevcut `contentBase64` üzerinden eksik/invalid
  `sha256` alanını doldurur. Repair artifact'i yalnız subject bazlı sayaçlar, `repairedRows`,
  `commandsPassed=["pnpm inline-upload-content:repair-sha"]` ve `gaps` taşır; ham içerik, tenant/user
  id, row id, dosya adı, `storageKey`, object key veya signed URL içeremez. Onaylı repair sonrası
  hash audit tekrar alınmadan S3 migration onaylanmaz.
- Dry-run ve onaylı migrate çıktıları release artifact'i olarak saklanır; yayın öncesi
  `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET=file:///... pnpm inline-upload-content:check` ile
  `pendingRows=0`, S3 signed-url modu ve iki upload yüzeyi doğrulanır. Rapor top-level 9 alanı,
  `storageMode`/`dryRun`/`migration` blok shape'leri, iki subject item seti, migrated item seti
  ve tam `commandsPassed` seti ile boş `gaps` listesi `prod:evidence:templates:check` fazla
  alan/komut, invalid/non-empty gaps, `contentBase64WriteDisabled=false`,
  `downloadUrlExpiresInSeconds>300`, migration sonrası pending row/byte ve dry-run pending'den
  az migrated row, secret target/reference ve raw storage-key/signed-URL reference negatifleriyle korunur.
- Final release raporu `pnpm inline-upload-content:generate` ile üretilir. Komut
  `INLINE_UPLOAD_CONTENT_DRY_RUN_TARGET=file:///.../dry-run.json`,
  `INLINE_UPLOAD_CONTENT_APPROVED_MIGRATION_TARGET=file:///.../migrated.json`,
  `INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_TARGET=file:///.../orphan-audit.json`,
  `INLINE_UPLOAD_CONTENT_MIGRATION_OUTPUT=artifacts/staging/reports/inline-upload-content-migration.json`,
  gerçek `INLINE_UPLOAD_CONTENT_APPROVED_BY`/`INLINE_UPLOAD_CONTENT_APPROVAL_REFERENCE`,
  `SUPPORT_ATTACHMENT_STORAGE=s3`, `HOMEWORK_MATERIAL_FILE_STORAGE=s3`,
  `INLINE_UPLOAD_CONTENT_DOWNLOAD_MODE=signed-url`,
  `INLINE_UPLOAD_CONTENT_DOWNLOAD_URL_EXPIRES_IN_SECONDS<=300`,
  `INLINE_UPLOAD_CONTENT_CONTENT_BASE64_WRITE_DISABLED=true` ve
  `INLINE_UPLOAD_CONTENT_INLINE_READ_COMPATIBILITY=true` olmadan artifact yazmaz. Çıktı yazıldıktan
  sonra aynı dosya `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET=file://... pnpm inline-upload-content:check`
  ile doğrulanır; dry-run/migrate artifact'leri temp path, symlink, query/fragment veya userinfo
  içerirse komut fail-fast kırılır.
- `INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE` lokal temp path (`/tmp`, `/var/tmp`, `/private/tmp`) altında,
  symlink file üzerinde veya symlink parent directory altında olamaz; script bu hedefleri DB
  bağlantısından önce reddeder. `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET` ve `evidenceReferences`
  userinfo/query/fragment, signed URL, raw storage key veya ham upload alanı taşıyamaz.

## WAL Archive Hedef Smoke

Amaç: `WAL_ARCHIVE_TARGET` hedefinin WAL arşiv dosyalarını alabilecek şekilde yaz/oku/sil
döngüsünü tamamladığını kanıtlamak.

Komut:

```sh
pnpm wal:archive:smoke
```

Staging kanıtı repo artifact'i olarak saklanacaksa:

```sh
WAL_ARCHIVE_SMOKE_EVIDENCE_FILE=artifacts/staging/wal-archive.json pnpm wal:archive:smoke
```

Desteklenen hedefler `file:///...` veya `s3://bucket/prefix` değerleridir.
`file://` hedef root, lokal temp path (`/tmp`, `/var/tmp`) veya symlink dizin/parent path
olamaz; mount hedefi kalıcı, symlink olmayan dizin olmalıdır.
Production env kontrolü WAL hedefinin geçerli, placeholder olmayan bir hedef olmasını zorunlu tutar.
Bu smoke hedef marker yaz/oku/sil adımına ek olarak çalışan Postgres üzerinde `pg_switch_wal()`
tetikler ve `archive_mode=on|always`, `wal_level=replica|logical`, archive command hash'i,
WAL dosya adı hash'i ve arşivlenen WAL dosyasının sha256 özetini kanıtlar. Compose `archive_mode`
değişikliği canlı konteynere uygulanmadıysa Postgres servisi recreate edilmeden bu smoke PASS vermez.
Docker named volume'u `root:root` oluşturursa `postgres-wal-archive-init` sahipliği `postgres`e ve
modu `0700`e çeker; Postgres yalnız bu tek seferlik servis başarıyla tamamlandıktan sonra başlar.
Artifact `checkedAt`, target özeti, marker sha256, `postgresWalArchive`, tek
`commandsPassed=["pnpm wal:archive:smoke"]` ve boş `gaps` listesi taşır.

Normal staging deploy evidence işi bu komutu `--env-file .staging-evidence.env` ile exact deploy
SHA üzerinde otomatik çalıştırır. S3 yaz/oku/sil runner'da, Postgres WAL switch ve arşiv dosyası
doğrulaması SSH Docker bağlantısıyla staging hostta yapılır; kanıt
`artifacts/staging/smoke/wal-archive.json` olarak activation artifact'ına girer. Yerel workflow
kontrolü veya başarılı deploy tek başına bu kanıtın yerine geçmez.

## AuditLog Null Tenant Kanıtı

Amaç: `AuditLog.tenantId IS NULL` satırlarının açıklanabilir olduğunu ve bilinmeyen/null tenant
audit borcunun release kanıtında gizlenmediğini doğrulamak.

Staging/prod kanıt kontrolü:

```sh
AUDIT_NULL_TENANT_EVIDENCE_TARGET=file:///path/to/audit-null-tenant.json pnpm audit-null-tenant:check
```

Kanıt sözleşmesi: `docs/evidence-templates/audit-null-tenant.example.json`.

Rapor `result=PASS`, `environment=staging|production`, `checkedAt`, `auditNullTenant`,
`commandsPassed=["pnpm audit-null-tenant:check"]`, `evidenceReferences` ve boş `gaps` listesi taşır.
`auditNullTenant.totalRows` değeri `tenantRows + nullTenantRows` toplamına eşit olmalı,
`nullTenantBreakdown.system/deletedTenant/unknown` toplamı `nullTenantRows` değerini vermeli ve
`unknown.count=0` kalmalıdır. Evidence target lokal temp path, symlink dosya/parent dizin veya
placeholder HTTPS host olamaz. Bu rapor `prod:evidence:check --summary-file` çıktısına
`reports/audit-null-tenant.json` olarak dahil edilir ve go-live linked summary içinde tekrar
doğrulanır.

## AuditLog Partition Bakımı

Amaç: `AuditLog` range partition setinin ay başında elle SQL yazmadan genişletilebildiğini ve
bakım kanıtının arşivlenebilir olduğunu doğrulamak.

Yerel/CI contract:

```sh
pnpm audit-log-partition:check
```

Staging dry-run kanıtı:

```sh
AUDIT_LOG_PARTITION_EVIDENCE_FILE=artifacts/staging/audit-log-partition.json pnpm audit-log-partition:maintain
```

Canlı uygulama yalnız migration/admin bağlantısıyla yapılır:

```sh
AUDIT_LOG_PARTITION_APPLY=1 \
AUDIT_LOG_PARTITION_EVIDENCE_FILE=artifacts/staging/audit-log-partition.json \
DIRECT_DATABASE_URL=postgresql://... \
pnpm audit-log-partition:maintain
```

Bakım script'i varsayılan olarak içinde bulunulan UTC aydan başlayarak 12 aylık
`CREATE TABLE IF NOT EXISTS "AuditLog_YYYY_MM" PARTITION OF "AuditLog"` planı üretir.
`AUDIT_LOG_PARTITION_START_MONTH=YYYY-MM` ve `AUDIT_LOG_PARTITION_MONTHS_AHEAD=1..36`
ile pencere değiştirilebilir. Evidence output lokal temp path (`/tmp`, `/var/tmp`), symlink dosya
veya symlink parent dizin olamaz; `pnpm audit-log-partition:check` bu negatifleri contract
olarak koşturur. Canlı bakım kanıtı `result=PASS`, `check=audit_log_partition_maintenance`,
`mode=apply`, `applied=true`, partition adları/tarih aralıkları, bakım komutu ve boş `gaps`
listesi taşır.

## Production PITR Sözleşmesi

Production Postgres yapılandırması:

```conf
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /backup/wal/%f && cp %p /backup/wal/%f'
archive_timeout = 60s
```

Zorunlu operasyon sözleşmesi:

- Günlük base backup alınır ve lokal kalıcı backup path'inde saklanır; off-host hedef pilot
  release gate'i değildir.
- WAL arşivi ayrı kalıcı path veya bucket altında tutulur.
- En az haftada bir restore denemesi yapılır.
- Panel/API/worker backup işi yalnız `s3://bucket/prefix` veya kalıcı `file://` dizin hedefi
  kabul eder; root, lokal temp path, symlink dizin veya symlink parent zinciri altındaki hedefler
  panel preflight/queue producer/API/worker katmanında reddedilir; panel formu ve queue producer
  serbest string, geçersiz protokol ve lokal temp/root hedefleri enqueue öncesi kırar.
- Restore denemesi `Tenant`, `AuditLog`, `ReportSnapshot` ve son migration varlığını doğrular.
- Restore raporu tarih, kaynak backup, hedef DB, doğrulanan tablo sayımları ve hata yoksa `PASS`
  sonucu içerir.
- Final restore-drill artifact'i staging hostta
  `STAGING_ENVIRONMENT=staging RESTORE_DRILL_OUTPUT=artifacts/staging/reports/restore-drill.json pnpm restore:drill:generate`
  ile üretilir. Komut Docker Compose postgres servisinde custom-format dump alır, geçici restore
  DB oluşturur, `Tenant`, `AuditLog`, `ReportSnapshot` ve `_prisma_migrations` sayımlarını restore
  edilen DB'den okur, ardından geçici DB ve dump dosyasını temizler. `backup:restore:smoke`
  yalnız ön smoke'tur; `reports/restore-drill.json` yerine geçmez.
- Gerçek restore raporunda `drillDate` gelecekte olamaz; `Tenant`, `AuditLog`, `ReportSnapshot`
  ve `_prisma_migrations` sayımları en az `1` olmalıdır.
- Restore raporu `RESTORE_DRILL_TARGET` altında saklanır ve `pnpm restore:drill:check` ile
  doğrulanır.
- Panel/API/worker üzerinden tetiklenen restore drill işi `file://` evidence hedefini lokal temp
  path'ten, symlink dosyadan veya symlink parent zinciri altından kuyruğa alamaz/okuyamaz;
  panel formu ve queue producer serbest string, geçersiz protokol ve lokal temp `file://` hedefleri
  enqueue öncesi kırar, API `/tmp` ve `/var/tmp` altındaki restore evidence hedeflerini ve yerelde görünen symlink
  file/parent-zincir hedeflerini kuyruğa almaz.
- Gerçek restore raporunda `sourceBackup` ve `targetDatabase` gerçek backup/run referansı olmalıdır;
  `backup-bucket`, `example`, `.test`, `redacted`, `localhost`, `__SET` veya placeholder değerler yalnız
  template kontrolünde `RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
- Rapor top-level 7 alanı ve `tableCounts` dört tablo seti template negatifleriyle korunur.

Restore denemesi örnek akış:

```sh
createdb o_okul_restore_YYYYMMDD
pg_restore --no-owner --no-privileges -d o_okul_restore_YYYYMMDD backup.dump
psql o_okul_restore_YYYYMMDD -c 'select count(*) from "Tenant";'
psql o_okul_restore_YYYYMMDD -c 'select count(*) from "AuditLog";'
psql o_okul_restore_YYYYMMDD -c 'select count(*) from "ReportSnapshot";'
psql o_okul_restore_YYYYMMDD -c 'select count(*) from "_prisma_migrations";'
dropdb o_okul_restore_YYYYMMDD
```

Restore raporu örnek sözleşmesi:

```json
{
  "result": "PASS",
  "environment": "staging",
  "drillDate": "2026-05-30",
  "sourceBackup": "s3://o-okul-prod-backups/base/2026-05-30.dump",
  "targetDatabase": "o_okul_restore_20260530",
  "tableCounts": {
    "Tenant": 5,
    "AuditLog": 1,
    "ReportSnapshot": 7,
    "_prisma_migrations": 13
  },
  "errors": []
}
```

Kanıt kontrol komutu:

```sh
pnpm restore:drill:check
```

PITR kabul kriteri: seçilen zamana restore edilen DB'de son başarılı migration kaydı, tenant izolasyon
policy'leri ve kritik tablolar okunabilir olmalıdır.
