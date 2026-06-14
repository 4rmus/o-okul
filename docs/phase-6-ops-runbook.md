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
- Geçici `uzman_hocam_restore_smoke_*` veritabanı oluşturulur.
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
- `/metrics` çıktısında `uzman_hocam_queue_jobs{queue,status}` ve
  `uzman_hocam_queue_metrics_scrape_error` metrikleri görünür.
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
  pencere, `LOGIN_LOCKED`/`RATE_LIMITED` 429 ve email+IP kapsamını göstermeli; ham IP/e-posta yerine
  SHA-256 hash, tam `commandsPassed=["pnpm rate-limit:smoke", "pnpm rate-limit:check"]` ve boş
  `gaps` listesi taşımalıdır.
  Rapor top-level 10 alanı, `config`/`instances[]`/`apiRateLimit`/`loginAttemptLimiter`
  blok shape'leri, iki instance, tam `commandsPassed` seti, boş `gaps` listesi ve `/health` +
  `/metrics` excluded path setini taşır; `prod:evidence:templates:check` rate-limit fazla
  alan/path/komut ve invalid/non-empty gaps negatiflerini kırmızıya düşürür.
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
{stack="uzman-hocam"} | json | requestId="REQ_ID"
{stack="uzman-hocam"} | json | msg="worker_job_failed"
```

Prometheus örnek sorguları:

```promql
sum(uzman_hocam_queue_jobs{status="failed"}) by (queue)
max(uzman_hocam_queue_metrics_scrape_error)
```

## Observability UAT Evidence

Kanıt sözleşmesi: `docs/evidence-templates/observability-uat.example.json`.

Komut:

```sh
OBSERVABILITY_UAT_TARGET=file:///path/to/observability-uat.json pnpm observability:uat:check
```

Minimum kanıt içeriği:

- Prometheus scrape, Grafana dashboard, Loki log paneli ve alert webhook 2xx durumu `PASS`.
- Gerçek kanıtta `checkedAt` gelecekte olamaz.
- Dashboard panelleri ve alert kuralları beklenen listeyi kapsar.
- Rapor top-level 11 alanı, beş dashboard paneli, dört alert kuralı ve boş `gaps` listesi
  template invalid/non-empty gaps negatifleriyle korunur.
- `evidenceReferences` Prometheus target çıktısı, Grafana dashboard screenshot/export'u,
  Loki `requestId` sorgusu ve alert delivery artifact'ini göstermelidir.
- `example`, `.test`, `redacted`, `localhost`, `__SET` veya placeholder değerler yalnız template
  kontrolünde `OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.

## External Monitoring Evidence

Kanıt sözleşmesi: `docs/evidence-templates/external-monitoring.example.json`.

Komut:

```sh
EXTERNAL_MONITORING_TARGET=file:///path/to/external-monitoring.json pnpm external-monitoring:check
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

## Admin MFA Evidence

Kanıt sözleşmesi: `docs/evidence-templates/admin-mfa.example.json`.

Komut:

```sh
ADMIN_MFA_EVIDENCE_TARGET=file:///path/to/admin-mfa.json pnpm admin-mfa:check
```

Minimum kanıt içeriği:

- `ADMIN_MFA_MODE=optional|required` staging/prod env içinde ayarlanır; production'da `off`
  kabul edilmez.
- `ADMIN_MFA_SECRET_ENCRYPTION_KEY`, `ADMIN_MFA_RECOVERY_HASH_KEY` ve
  `ADMIN_MFA_CHALLENGE_SECRET` gerçek ve birbirinden/JWT secret'tan farklı secret değerlerdir.
- SYSTEM_ADMIN ve TENANT_ADMIN hesapları TOTP enrollment kapsamındadır; recovery code sayısı
  enrollment başına en az 8'dir.
- Password-only admin login auth session üretmez; TOTP login başarılı, invalid TOTP reddedilmiş,
  TOTP reuse reddedilmiş, recovery code login başarılı ve recovery code reuse reddedilmiş olmalıdır.
- TOTP enable/disable işlemleri mevcut refresh session'ları iptal eder.
- SMS OTP açıkça kullanılmaz; SIM-swap riski nedeniyle ikinci faktör TOTP veya recovery code'dur.
- Rapor top-level 9 alanı ile `policy`, `enrollment`, `loginVerification` blok shape'leri
  ve boş `gaps` listesi template invalid/non-empty gaps negatifleriyle korunur.
- Gerçek kanıtta `evidenceReferences` placeholder, `.test`, localhost veya redacted değer içeremez;
  bu gevşetme yalnız template kontrolünde `ADMIN_MFA_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır.

## AI Report Summary Evidence

Kanıt sözleşmesi: `docs/evidence-templates/ai-report-summary.example.json`.

Komut:

```sh
AI_REPORT_SUMMARY_EVIDENCE_TARGET=file:///path/to/ai-report-summary.json pnpm ai-report-summary:check
```

Minimum kanıt içeriği:

- `AI_REPORT_SUMMARY_PROVIDER=disabled` staging/prod env içinde ayarlanır; dış LLM provider veya
  template yorum üretimi bu release için production env kontrolünden geçmez.
- Disabled modda `ReportSnapshot.snapshotData.commentary` ve öğrenci `commentary` alanlarına yeni
  taslak yazılmaz.
- Kullanılan alanlar net/puan/branş/kazanım/sıralama gibi yapısal metriklerle sınırlıdır; öğrenci
  adı, öğrenci id, veli adı, TC, telefon, e-posta ve adres yorum metnine girmez.
- `validation.externalProviderNotCalled=true` olmalıdır; Claude/Anthropic veya template yorum
  üretimi ayrıca KVKK değerlendirmesi, öğretmen onay akışı ve ürün sahibi onayı gerektirir.
- Gerçek kanıtta `evidenceReferences` placeholder, `.test`, localhost veya redacted değer içeremez;
  bu gevşetme yalnız template kontrolünde `AI_REPORT_SUMMARY_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır.
- Rapor top-level 11 alanı, `provider`/`kvkk`/`externalAiStopRule`/`generation`/`validation`
  blok shape'leri, KVKK alan setleri, üç komutluk `commandsPassed` seti ve boş `gaps` listesi
  template invalid/non-empty gaps negatifleriyle korunur.

## Identity Migration Evidence

Kanıt sözleşmesi: `docs/evidence-templates/identity-migration.example.json`.

Komut:

```sh
IDENTITY_MIGRATION_TARGET=file:///path/to/identity-migration.json pnpm identity-migration:check
```

Minimum kanıt içeriği:

- `environment=staging|production`, `result=PASS` ve geleceğe taşmayan `checkedAt`.
- `migrationDecision` onay sahibi, onay referansı ve `invite|admin_link|hybrid` activation mode
  değerlerinden birini taşır.
- `subjects` tam olarak `STUDENT`, `GUARDIAN` ve `TEACHER` subject'lerini içerir; her subject'te
  `sourceRecords`, `linkedUsers` ve `tenantMembershipsCreated` sayıları eşit olmalıdır.
- `invitationFlow.created|accepted|expiredOrRevoked` sayaçları sıfır veya daha büyük tam sayı,
  `accepted <= created` olmalıdır.
- Dört canonical verification maddesi taşınır; `gaps` boş olmalıdır.
- Rapor top-level 8 alanı, `migrationDecision`/`invitationFlow` blok shape'leri, üç subject item
  seti, dört verification seti ve boş `gaps` listesi template invalid/non-empty gaps negatifleriyle korunur.
- Gerçek kanıtta onay sahibi ve onay referansı placeholder, `.test`, localhost veya redacted değer
  içeremez; bu gevşetme yalnız template kontrolünde `IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE=1`
  ile açılır.

## Financial Retention Evidence

Kanıt sözleşmesi: `docs/evidence-templates/financial-retention.example.json`.

Komut:

```sh
FINANCIAL_RETENTION_TARGET=file:///path/to/financial-retention.json pnpm financial-retention:check
```

Minimum kanıt içeriği:

- `environment=staging|production`, `result=PASS` ve geleceğe taşmayan `checkedAt`.
- `policyDecision` karar sahibi, karar referansı, yasal dayanak, pozitif `retentionPeriodYears`
  ve `purgeException=true` taşır.
- `financialRecords.paymentPlans` ve `financialRecords.installments` gerçek veri kanıtı için
  sıfırdan büyük tam sayı olmalıdır.
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
KVKK_INVENTORY_TARGET=file:///path/to/kvkk-inventory.json pnpm privacy:inventory:check
```

Minimum kanıt içeriği:

- `environment=staging|production`, `result=PASS` ve geleceğe taşmayan `checkedAt`.
- `dataSubjectCounts` öğrenci, öğretmen, veli ve kullanıcı sayımlarını içerir; toplam gerçek veri
  doğrulaması için sıfırdan büyük olmalıdır.
- `purgeCoverage` öğrenci için `firstName`, `lastName`, `phone`, `email`; öğretmen için
  `firstName`, `lastName`; veli için `firstName`, `lastName`, `phone`; kullanıcı için `email`, `name`
  alan setlerini taşır.
- Audit action seti dört canonical KVKK purge action'ını içerir ve `gaps` boş olmalıdır.
- Rapor top-level 8 alanı, dört count alanı, dört coverage subject'i, subject field setleri,
  dört audit action seti ve boş `gaps` listesi template invalid/non-empty gaps negatifleriyle korunur.

## Security Audit Evidence

Kanıt sözleşmesi: `docs/evidence-templates/security-audit.example.json`.

Komut:

```sh
SECURITY_AUDIT_TARGET=file:///path/to/security-audit.json pnpm security:audit:check
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

## RLS Live Evidence

Kanıt sözleşmesi: `docs/evidence-templates/rls-live.example.json`.

Komut:

```sh
RLS_LIVE_EVIDENCE_TARGET=file:///path/to/rls-live.json pnpm rls:live:check
```

Minimum kanıt içeriği:

- `commandsPassed` içinde `pnpm db:rls:check`, `pnpm db:rls:check:live`,
  `pnpm rls:load:smoke` ve `pnpm rls:live:check` bulunur.
- `schema.tablesVerified` schema'dan türeyen 54 tenant tablosunu kapsar; `AnnouncementReceipt`,
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
- Rapor top-level 9 alanı, `schema`/`isolation`/`loadSmoke` blok shape'leri, 54 tabloluk
  `tablesVerified` exact seti, `withCheckRejects` negatif seti, tam `commandsPassed` seti ve
  boş `gaps` listesini taşır; `prod:evidence:templates:check` RLS live fazla alan/tablo/komut
  ve invalid/non-empty gaps negatiflerini kırmızıya düşürür.
- Gerçek kanıtta tenant hash ve artifact referansları `example`, `.test`, `redacted`, `localhost`,
  `__SET` veya placeholder değer içeremez; bu gevşetme yalnız template kontrolünde
  `RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır.

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
gh workflow run staging-deploy.yml -f rollback_image_tag=<last-known-good-tag>
```

Gerekli GitHub `staging` environment secret/var değerleri:

- Secrets: `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_PRIVATE_KEY`, `GHCR_READ_TOKEN`,
  `STAGING_EVIDENCE_ENV_B64`.
- Vars: `STAGING_DEPLOY_DIR`, `STAGING_NEXT_PUBLIC_API_URL`, opsiyonel `STAGING_EDGE_MODE`.
  `STAGING_EDGE_MODE=domain` varsayılandır ve `docker-compose.traefik.yml` ile ACME kullanır.
  `STAGING_EDGE_MODE=ip` bu cihazdaki geçici IP/self-signed edge için `docker-compose.traefik-ip.yml`
  dosyasını seçer.

`STAGING_EVIDENCE_ENV_B64` içeriği `docs/evidence-templates/staging-evidence.env.example`
sözleşmesinden üretilir. Gerçek değerlerle doldurulan özel env dosyası GitHub secret'a yazılmadan önce
şu komutla doğrulanır:

```sh
node scripts/check-staging-evidence-env.mjs --env-file /path/to/staging-evidence.env
```

Linux runner için base64 değeri:

```sh
base64 -w0 /path/to/staging-evidence.env
```

Beklenen akış:

- Workflow önce dispatch input'larını, Docker tag biçimini, `STAGING_NEXT_PUBLIC_API_URL=https://...`
  değerini, `STAGING_EDGE_MODE=domain|ip` değerini ve gerekli staging secret/var varlığını doğrular.
- Workflow `STAGING_EVIDENCE_ENV_B64` içeriğini decode eder, boş dosyayı reddeder ve
  `pnpm staging:evidence-env:check -- --env-file .staging-evidence.env` ile gerçek env içeriğini
  deploy başlamadan önce doğrular; zorunlu anahtarlar eksik veya boş değerli olamaz. Preflight
  shell'i `.staging-evidence.env` dosyasını exit trap'i ile siler. Bu secret env dosyası
  `REPORT_GENERATION_SMOKE_EVIDENCE_FILE` veya diğer raw smoke evidence path'lerini içermez;
  `prod:evidence:check --summary-file` bunları `artifacts/staging/smoke/*.json` altında üretir.
- Workflow aynı commit'in başarılı `.github/workflows/ci.yml` run'ını GitHub API'dan okuyup
  `artifacts/staging/reports/github-ci.json` üretir, `pnpm github-ci:check` ile doğrular ve
  `staging-github-ci-evidence-<sha>` artifact'i olarak saklar. Bu job geçmeden image build veya deploy başlamaz.
- Workflow sonra `pnpm run ci` çalıştırmadan önce web Playwright Chromium bağımlılıklarını
  `pnpm --filter @uzman-hocam/web exec playwright install --with-deps chromium` ile kurar.
- `web`, `api`, `worker` ve `queue-board` image'ları GHCR'a commit SHA tag'i ve `staging-latest`
  tag'i ile push edilir.
- GitHub runner `docker-compose.yml`, `docker-compose.release.yml`, `docker-compose.traefik.yml`,
  `docker-compose.traefik-ip.yml` ve
  `docker/postgres/init` içeriğini SSH üzerinden staging deploy dizinine kopyalar; staging host'un
  repo clone yetkisine ihtiyacı yoktur.
- `.env.release` dosyası `WEB_IMAGE`, `API_IMAGE`, `WORKER_IMAGE`, `QUEUE_BOARD_IMAGE`, `SENTRY_RELEASE` ve
  `ROLLBACK_IMAGE_TAG` alanlarıyla yazılır.
- `GHCR_READ_TOKEN` uzak shell komut satırına gömülmez; SSH stdin ile `0600` benzeri izinli
  `.ghcr_read_token` dosyasına aktarılır, `docker login --password-stdin` sonrası trap ile silinir.
- `docker compose --env-file .env --env-file .env.release -f docker-compose.yml
  -f docker-compose.release.yml -f docker-compose.traefik.yml pull web api worker queue-board` ile imajlar çekilir.
- `docker compose ... run --rm api pnpm --filter @uzman-hocam/db db:migrate` migration deploy'u çalıştırır.
- `docker compose ... up -d --remove-orphans` Traefik'li staging stack'ini ayağa kaldırır.
- GitHub runner, `STAGING_EVIDENCE_ENV_B64` içeriğini evidence job'da yeniden decode edip
  `pnpm staging:evidence-env:check` ile tekrar doğrular.
- GitHub runner, deploy öncesi üretilmiş `staging-github-ci-evidence-<sha>` artifact'ini
  `actions/download-artifact@v4` ile `artifacts/staging/reports/github-ci.json` yoluna indirir ve
  `pnpm github-ci:check` ile tekrar doğrular.
- Release env dosyasına workflow-generated metadata olarak `SENTRY_RELEASE`, `ROLLBACK_IMAGE_TAG` ve
  `GITHUB_CI_EVIDENCE_TARGET=file://.../artifacts/staging/reports/github-ci.json` eklenir.
- Release env dosyası `*_ALLOW_EXAMPLE_EVIDENCE=1` bayraklarını içermez; `pnpm prod:env:check`
  gerçek production-evidence koşusunda bu bayrakları bypass olarak reddeder.
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
  Bu komut Traefik HTTPS, alert webhook ve off-site backup smoke dosyalarını yazar, her dosyayı
  ortak smoke evidence sözleşmesiyle doğrular ve `first-gates-manifest.json` manifest'i üretir.
  Output dizini lokal temp path (`/tmp`, `/var/tmp`) altında olamaz ve yalnız
  `first-gates-manifest.json`, `traefik-https.json`, `alert-webhook.json`
  ve `backup-offsite.json` dosyalarını içerebilir; beklenmeyen dosya veya symlink varsa smoke
  çalışmadan önce kırılır. Tekil smoke komutlarında kullanılan `*_SMOKE_EVIDENCE_FILE`
  çıktıları da lokal temp path'e veya symlink file/parent directory üzerinden yazılamaz.
  Workflow aynı job içinde
  `STAGING_FIRST_GATES_TARGET=file://$PWD/artifacts/staging/first-gates/first-gates-manifest.json pnpm staging:first-gates:check`
  komutuyla manifest'i, üç artifact'i, artifact ortamlarının manifest ortamıyla eşleştiğini ve manifest
  zamanının artifact `generatedAt`/`checkedAt` zamanlarından önce olmadığını tekrar doğrular. Artifact upload adımı `if: always()` ile çalışır ve
  full production evidence zinciri sonradan düşse bile üretilen first-gates artifact'lerini saklar.
- GitHub runner, doğrulanmış production evidence env sözleşmesiyle
  `pnpm prod:evidence:check -- --summary-file artifacts/staging/release-summary-<tag>.json`
  komutunu çalıştırır. Bu komut release summary dosyasını yazdıktan sonra aynı summary'yi
  `scripts/check-production-evidence-summary.mjs` ile doğrular ve `artifacts/staging`
  klasörünü artifact olarak saklar. `--summary-file`, sibling `reports/` ve `smoke/` output
  layout'u lokal temp path veya symlink file/directory üzerinden yazılamaz; birleşik kapı bunu
  evidence check'leri başlamadan önce reddeder. Birleşik kapı ayrıca `*_SMOKE_EVIDENCE_FILE`
  raw smoke target'larını provider/HTTP/DB smoke'ları başlamadan önce production artifact girdisi
  olarak doğrular; `/tmp`/`/var/tmp`, symlink dosya ve symlink parent directory üzerinden gelen raw
  smoke path'i kabul edilmez. Evidence job, artifact upload öncesinde `if: always()` cleanup
  adımıyla `.staging-evidence.env` secret dosyasını workspace'ten siler.
- Full evidence zinciri PASS olduktan sonra workflow aynı job içinde
  `STAGING_RELEASE_ARTIFACTS_TARGET=$PWD/artifacts/staging pnpm staging:release-artifacts:check`
  komutunu çalıştırır. Bu kontrol indirilecek `staging-production-evidence-<tag>` artifact setinde
  `reports/*.json`, `first-gates/first-gates-manifest.json`, tek `release-summary-*.json`
  ve `smoke/*.json` ham kanıt dosyalarının mevcut olduğunu, mevcut checker'larla geçtiklerini ve
  release summary içindeki gömülü kanıtlarla birebir eşleştiklerini doğrular. `release-summary-<tag>.json`
  dosya adındaki tag, summary içindeki `reports.deploymentRollback.releaseCandidate` image tag'iyle
  eşleşmelidir. Bundle yalnız beklenen root, `reports/`, `smoke/` ve `first-gates/` dosyalarını
  içerebilir; beklenmeyen raw JSON/log dosyası kalırsa kontrol kırılır. Bundle symlink içeremez;
  beklenen artifact'ler symlink olmayan dosya/dizin olmalıdır. `STAGING_RELEASE_ARTIFACTS_TARGET`
  parent-symlink target üzerinden verilemez; hedef path'in parent zincirinde symlink varsa kontrol kırılır. Bundle `.staging-evidence.env`,
  `.env*` veya GHCR token dosyası içeremez; secret/env dosyası artifact setine karışırsa kontrol kırılır. First-gates ortak
  smoke'larının ortamı manifest ortamıyla eşleşmeli, manifest zamanı kendi artifact zamanlarından önce olamaz ve final `smoke/*.json`
  kanıtlarından daha geç tarih taşıyamaz; bu kural stale final
  smoke veya report dosyalarının bundle'a karışmasını engeller.
- First-gates manifest'indeki `evidenceFile` değerleri manifest dizini altındaki symlink olmayan
  relative artifact dosya adlarıdır; mutlak URL/yol veya manifest dizini dışına çıkan kanıt
  referansı geçmez.
- `pnpm staging:evidence-env:check`, workflow içindeki kritik evidence sırasını da korur:
  GitHub CI artifact üretimi/download, env decode/check, metadata append, first-gates, production
  evidence, release bundle check, cleanup ve upload adımları bu sırada kalmalıdır.
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

Bu workflow prod deploy değildir; staging environment üzerinde gerçek HTTPS, provider, backup,
observability ve UAT kanıtlarını üretmek için kapıdır.

## Deployment Region Evidence

Amaç: staging/prod servislerinin TR datacenter/provider altında çalıştığını ve veri ikametgahı
kararının gerçek sağlayıcı kanıtıyla kapandığını doğrulamak.

Komut:

```sh
DEPLOYMENT_REGION_TARGET=file:///path/to/deployment-region.json pnpm deployment:region:check
```

Minimum kanıt içeriği:

- `datacenterCountryCode=TR` ve `dataResidencyVerified=true`.
- Gerçek kanıtta `checkedAt` gelecekte olamaz.
- Provider, region ve evidence reference gerçek sözleşme/console/provider kanıtını göstermeli.
- `tr-provider-example`, `example`, `.test`, `localhost`, `__SET` veya placeholder değerler yalnız
  template kontrolünde `DEPLOYMENT_REGION_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
- `servicesVerified` içinde `api`, `worker`, `postgres`, `redis` ve `object-storage` yer alır.
- `gaps` boş liste olmalıdır.
- Rapor top-level alan kümesi, tam servis seti ve boş `gaps` listesi
  `prod:evidence:templates:check` içindeki fazla alan/servis ve invalid/non-empty gaps negatifleriyle korunur.

## Deployment Rollback Drill

Amaç: Faz 9 release gate'inde bozuk imajdan son bilinen iyi imaja dönüşün raporlu ve tekrarlanabilir
olduğunu kanıtlamak.

Kanıt sözleşmesi: `docs/evidence-templates/deployment-rollback.example.json`.

Komut:

```sh
DEPLOYMENT_ROLLBACK_TARGET=file:///path/to/deployment-rollback.json pnpm deployment:rollback:check
```

Minimum tatbikat akışı:

- Staging'e bilinçli bozuk veya healthcheck'i geçmeyen bir image tag'i release adayı olarak uygulanır.
- Health/readiness başarısızlığı kaydedilir; veri migrasyon uyumluluğu geri dönüş için onaylanır.
- `.env.release` içindeki `WEB_IMAGE`, `API_IMAGE` ve `WORKER_IMAGE` değerleri
  `ROLLBACK_IMAGE_TAG` zincirindeki son bilinen iyi tag'e çekilir.
- `docker compose pull web api worker` ve `docker compose up -d --remove-orphans` çalıştırılır.
- `pnpm compose:health:smoke` ve `pnpm prod:evidence:check` tekrar PASS olur.
- Rapor `DEPLOYMENT_ROLLBACK_TARGET` altında `releaseCandidate`, `failedImageTag`, `rollbackImageTag`,
  `failureInjected=true`, `migrationRollbackSafe=true`, `servicesVerified` ve artifact referanslarını taşır.
- `checkedAt`, `drillStartedAt` ve `drillCompletedAt` gelecekte olamaz;
  `drillStartedAt <= drillCompletedAt <= checkedAt` sırası korunmalıdır.
- `releaseCandidate` ile `rollbackImageTag` aynı tag olamaz.
- Rollback raporu top-level alan kümesi, üç servislik `servicesVerified` seti, dört komutluk
  `commandsPassed` seti ve boş `gaps` listesi `prod:evidence:templates:check` içindeki fazla
  alan/servis/komut, ters kronoloji, release=rollback ve invalid/non-empty gaps negatifleriyle korunur.
- Image tag ve evidence reference değerleri gerçek release/artifact referansı olmalı; `ghcr.io/example`,
  `.test`, `example`, `localhost`, `__SET` veya placeholder değerler yalnız template kontrolünde
  `DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.

## Staging/Prod UAT Evidence

Amaç: Faz 10 rol bazlı UAT koşusunun gerçek release, rollback ve persona yolculuğu artifact'leriyle
kanıtlandığını doğrulamak.

Kanıt sözleşmesi: `docs/evidence-templates/uat.example.json`.

Komut:

```sh
UAT_EVIDENCE_TARGET=file:///path/to/uat.json pnpm uat:check
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

Live onboarding smoke preflight:

```sh
NEXT_E2E_LIVE_ONBOARDING=1 \
LIVE_ONBOARDING_EVIDENCE_PATH=artifacts/staging/live-onboarding-input.json \
pnpm live:onboarding:evidence-check
```

Smoke komutu aynı preflight'ı tarayıcı açmadan önce otomatik çalıştırır:

```sh
NEXT_E2E_LIVE_ONBOARDING=1 \
LIVE_ONBOARDING_EVIDENCE_PATH=artifacts/staging/live-onboarding-input.json \
pnpm live:onboarding:smoke
```

`LIVE_ONBOARDING_EVIDENCE_PATH` JSON'u system admin ve ilk tenant admin credential'larını, tenant
adı/slug/plan/koltuk limitini ve opsiyonel kurulum alanlarını exact shape ile taşır. Gerçek staging
kanıtında `example`, `.test`, `redacted`, `localhost`, `__SET` veya placeholder değerler kabul edilmez;
dosya lokal temp path (`/tmp`, `/var/tmp`), symlink dosya veya symlink parent zinciri altında olamaz.
`pnpm live:onboarding:evidence-contract` bu negatifleri lokal CI'da tarayıcı açmadan korur.

Live UI-worker/report smoke preflight:

```sh
NEXT_E2E_LIVE_UI_WORKER=1 \
LIVE_UI_WORKER_EVIDENCE_PATH=artifacts/staging/live-ui-worker-input.json \
pnpm live:ui-worker:evidence-check
```

Smoke komutu aynı preflight'ı tarayıcı açmadan önce otomatik çalıştırır:

```sh
NEXT_E2E_LIVE_UI_WORKER=1 \
LIVE_UI_WORKER_EVIDENCE_PATH=artifacts/staging/live-ui-worker-input.json \
pnpm live:ui-worker:smoke
```

`LIVE_UI_WORKER_EVIDENCE_PATH` JSON'u rapor admin credential'ını, `examId`, `firstStudentId` ve
opsiyonel öğrenci/veli portal credential'larını exact shape ile taşır. Gerçek staging kanıtında
`example`, `.test`, `redacted`, `localhost`, `__SET` veya placeholder değerler kabul edilmez; dosya lokal
temp path (`/tmp`, `/var/tmp`), symlink dosya veya symlink parent zinciri altında olamaz.
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
  alanı, `examCycle` 26 alanı, 5 komutluk `commandsPassed` seti ve boş `gaps` listesi
  `prod:evidence:templates:check` fazla alan/komut ve invalid/non-empty gaps negatifleriyle korunur.
- 10k rapor listeleme k6 p95 eşikleri, >200 rps RLS yük smoke'u ve rapor üretim süresi eşiği.
  Rapor üretim kanıtı için `REPORT_GENERATION_SMOKE_EVIDENCE_FILE=artifacts/staging/perf/report-generation.json pnpm report-generation:perf`
  çalıştırılır; artifact `report_generation_smoke`, hash'li tenant/user/email/exam/snapshot referansları,
  `generationDurationMs`, `resultCount=10000` ve eşik sonucunu taşır, ham credential veya ham id içermez.
  Artifact top-level alan seti, `hashes`/`thresholds` blok shape'leri, tek izinli `commandsPassed`
  değeri ve boş `gaps` listesi `pnpm smoke:evidence:check` içinde korunur. Production evidence
  summary üretiminde aynı payload `artifacts/staging/smoke/report-generation.json` dosyasına
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

Kanıt template'i: `docs/evidence-templates/live-status.example.json`.
PASS geçiş fixture'i: `docs/evidence-templates/live-status-pass-readiness.example.md`.

Minimum kanıt içeriği:

- `environment=production`, release candidate ve rollback image tag referansı.
- Go-live top-level alanları, `productionEvidenceSummary`, `liveStatusEvidence`, `deployment`, `uat`,
  `pilot`, `legal`, `operations`, `cutover`, `approvals` ve `openRisks` bloklarının anahtar setleri
  tam ve beklenmeyen alansız olmalıdır; approval rolleri product/technical/operations/dataProtection
  olarak tam ve tekrarsız taşınır.
- Go-live raporundaki `liveStatusEvidence.evidenceTarget`, aynı artifact setindeki Canlı Durum
  transition bundle'ını göstermelidir; `pnpm go-live:check` bu bundle'ı okur, sekiz dış kapının
  `PASS` olduğunu ve summary/pilot/go-live hedeflerinin aynı dosyalara bağlandığını doğrular.
  Bundle içindeki `productionEvidenceSummaryTarget`, `goLiveEvidenceTarget` ve
  `pilotEvidenceTarget` alanları go-live paketindeki aynı summary/go-live/pilot artifact hedeflerine
  çözülmelidir.
- Canlı Durum transition bundle'ı `Traefik HTTPS smoke`, `TR datacenter/provider kanıtı`,
  `Staging/prod UAT`, `Deployment rollback tatbikatı`, `Pilot kapanış kanıtı`,
  `Go-live karar paketi`, `Off-host backup hedefi` ve `Alert bildirim kanalı` satırlarını
  readiness dokümanındaki durumla birebir eşleştirir. Liste tam sekiz satırdan oluşmalı, beklenmeyen
  veya tekrarlı gate içermemelidir. Bundle top-level alanları ve her gate item alan seti tam ve
  beklenmeyen alansız olmalıdır. Her gate `command` ve `source` değeri kanonik listeyle
  eşleşmelidir; `checkedAt` geçerli tarih, `evidenceReference` source artifact referansıyla eşleşen
  boş olmayan string olmalı ve
  `checkedAt` ilgili smoke/report/pilot/go-live kaynak tarihiyle eşleşip bundle `generatedAt`
  sonrasına düşemez. `pnpm live:status:check` bundle içindeki summary/go-live/pilot target'larını
  okuyarak bu source-date ve `evidenceReference` eşleşmesini tek başına da doğrular; `pnpm go-live:check`
  ayrıca target'ların go-live paketindeki aynı artifact setine çözüldüğünü kontrol eder.
  `example`, `.test`, `redacted`,
  `localhost` veya `__SET` referansları normal çalışmada reddedilir.
  `pnpm prod:evidence:templates:check` duplicate gate, NOT_RUN command/source/checkedAt/
  evidenceReference sapması, geç `checkedAt`, UAT top-level/komut/journey shape fazlası,
  live-exam-cycle top-level/examCycle/command/gaps shape fazlası,
  inline-upload migration top-level/storage/dry-run/migration/subject/migrated/command/gaps shape fazlası,
  identity-migration top-level/decision/subject/invitation/verification/gaps shape fazlası,
  financial-retention top-level/policy/records/purge-behavior/gaps shape fazlası,
  observability-uat top-level/dashboard/alert/gaps shape fazlası,
  security-audit top-level/header/auth/data shape fazlası,
  external-monitoring top-level/node/monitor/outage/gaps shape fazlası,
  admin-mfa top-level/policy/enrollment/login/gaps shape fazlası,
  ai-report-summary top-level/provider/KVKK/generation/validation/command/gaps shape fazlası,
  upload-av top-level/scanner/surface/result/gaps shape fazlası,
  kvkk-inventory top-level/count/coverage/action/gaps shape fazlası,
  restore-drill top-level/tableCounts shape fazlası,
  rate-limit top-level/config/instance/API/login/path/command/gaps shape fazlası,
  RLS live top-level/schema/isolation/loadSmoke/table/command/gaps shape fazlası,
  pilot top-level/nested/assessment/gaps shape fazlası, deployment region top-level/servis/gaps shape fazlası,
  deployment rollback top-level/servis/komut/gaps shape, kronoloji fazlası ve release=rollback sapması, external monitoring outage chronology/latency, production summary smoke environment, Traefik URL origin, external monitoring URL origin ve live exam cycle release/app/API sapması, go-live `gatesPassed` fazlası, live-status
  top-level/gate item shape fazlası, bağlı live-status duplicate
  gate/top-level/gate item shape fazlası, live-status source-date/evidenceReference sapmaları, bağlı live-status target, source-date ve evidenceReference sapmaları ile kırık summary/pilot/go-live kaynak ve go-live linked pilot gaps negatiflerinin yanında production summary
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
  değerlerini reddeder; linked summary deployment region `evidenceReference`, deployment rollback
  `commandsPassed`, servis image/evidence referansları ve `evidenceReferences` alanlarını, GitHub CI
  `runUrl`, `commitSha`, `workflowUsesSingleCiCommand` ve `githubCiPassed` değerlerini, RLS live
  `schema.tablesVerified`, `crossTenantReadRows`, `withCheckRejects`, `loadSmoke.actualRps` ve
  `rlsLivePassed` değerlerini, restore drill `sourceBackup`/`targetDatabase`, KVKK
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
  alert webhook URL/status/`authorizationScheme="bearer"`, SMS provider `segments`/`providerMessageId`, SMS/notification provider ve masked recipient,
  backup/WAL target özeti ve `markerSha256` değerleri placeholder içeremez. Provider/Sentry smoke
  artifact'lerinde canonical `commandsPassed` tek komut olmalı ve `gaps` boş kalmalıdır.

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

## Off-host Backup Hedef Smoke

Amaç: `BACKUP_OFFSITE_TARGET` hedefinin yalnız yazılı değil, gerçekten yaz/oku/sil döngüsünü
tamamladığını kanıtlamak.

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

Desteklenen hedefler:

- `file:///...`: lokal veya mount edilmiş off-host path'e test dosyası yazar, hash doğrular ve siler.
- `s3://bucket/prefix`: S3 uyumlu hedefe test nesnesi yazar, geri okur, hash doğrular ve siler.
- Production env kontrolü placeholder/test bucket, lokal temp path, geçersiz URL ve
  boş/placeholder S3 credential değerlerini reddeder.

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
- Support ticket ekleri `support-ticket-attachments/...`, homework materyal dosyaları
  `homework-material-files/...` S3 key prefix'iyle yazılır.
- S3 `storageKey` ile saklanan support ticket ekleri ve homework materyal dosyaları API üzerinden
  base64 proxy edilmez; indirme yanıtı kısa ömürlü imzalı GET URL'si döndürür. URL TTL'i en fazla
  5 dakikadır (`downloadUrlExpiresInSeconds <= 300`).
- Yeni S3 yazımlarında `contentBase64` kolonu `NULL` kalır; eski inline kayıtlar geriye dönük
  uyumluluk için okunabilir kalır.
- Mevcut inline kayıt sayımı ve tablo boyutu raporu `pnpm inline-upload-content:audit` ile alınır.
  Gerçek taşıma yalnız `INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true pnpm inline-upload-content:migrate`
  ile çalışır; script her satırda sha256 doğrular, S3'e yazar, sonra `storageKey` set edip
  `contentBase64` alanını `NULL` yapar.
- Dry-run ve onaylı migrate çıktıları release artifact'i olarak saklanır; yayın öncesi
  `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET=file:///... pnpm inline-upload-content:check` ile
  `pendingRows=0`, S3 signed-url modu ve iki upload yüzeyi doğrulanır. Rapor top-level 9 alanı,
  `storageMode`/`dryRun`/`migration` blok shape'leri, iki subject item seti, migrated item seti
  ve tam `commandsPassed` seti ile boş `gaps` listesi `prod:evidence:templates:check` fazla
  alan/komut ve invalid/non-empty gaps negatifleriyle korunur.
- `INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE` lokal temp path (`/tmp`, `/var/tmp`) altında,
  symlink file üzerinde veya symlink parent directory altında olamaz; script bu hedefleri DB
  bağlantısından önce reddeder.

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

Desteklenen hedefler `BACKUP_OFFSITE_TARGET` ile aynıdır: `file:///...` veya `s3://bucket/prefix`.
`file://` hedef root, lokal temp path (`/tmp`, `/var/tmp`) veya symlink dizin/parent path
olamaz; mount hedefi kalıcı, symlink olmayan dizin olmalıdır.
Production env kontrolü WAL hedefinin base backup hedefinden ayrı bucket veya path olmasını zorunlu tutar.
Bu smoke Postgres'in gerçek WAL üretimini test etmez; arşiv hedefinin erişilebilirliğini kanıtlar.
Artifact `checkedAt`, target özeti, marker sha256, tek
`commandsPassed=["pnpm wal:archive:smoke"]` ve boş `gaps` listesi taşır.

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

- Günlük base backup alınır ve immutable/off-host hedefte saklanır.
- WAL arşivi base backup hedefinden ayrı path veya bucket altında tutulur.
- En az haftada bir restore denemesi yapılır.
- Panel/API/worker backup işi yalnız `s3://bucket/prefix` veya kalıcı `file://` dizin hedefi
  kabul eder; root, lokal temp path, symlink dizin veya symlink parent zinciri altındaki hedefler
  panel preflight/queue producer/API/worker katmanında reddedilir; panel formu ve queue producer
  serbest string, geçersiz protokol ve lokal temp/root hedefleri enqueue öncesi kırar.
- Restore denemesi `Tenant`, `AuditLog`, `ReportSnapshot` ve son migration varlığını doğrular.
- Restore raporu tarih, kaynak backup, hedef DB, doğrulanan tablo sayımları ve hata yoksa `PASS`
  sonucu içerir.
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
createdb uzman_hocam_restore_YYYYMMDD
pg_restore --no-owner --no-privileges -d uzman_hocam_restore_YYYYMMDD backup.dump
psql uzman_hocam_restore_YYYYMMDD -c 'select count(*) from "Tenant";'
psql uzman_hocam_restore_YYYYMMDD -c 'select count(*) from "AuditLog";'
psql uzman_hocam_restore_YYYYMMDD -c 'select count(*) from "ReportSnapshot";'
psql uzman_hocam_restore_YYYYMMDD -c 'select count(*) from "_prisma_migrations";'
dropdb uzman_hocam_restore_YYYYMMDD
```

Restore raporu örnek sözleşmesi:

```json
{
  "result": "PASS",
  "environment": "staging",
  "drillDate": "2026-05-30",
  "sourceBackup": "s3://uzman-hocam-prod-backups/base/2026-05-30.dump",
  "targetDatabase": "uzman_hocam_restore_20260530",
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
