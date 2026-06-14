# Faz 6 Durum Raporu

## Tamamlanan repo içi kapsam

- Faz 6 ürün sertleştirme kapsamı için ilk küçük dilim olarak AuditLog okuma yüzeyi başlatıldı.
- `GET /audit-logs` endpoint'i eklendi; `TENANT_ADMIN` yalnız kendi tenant audit kayıtlarını
  okuyabilir.
- `SYSTEM_ADMIN` audit kayıtlarını geniş kapsamda okuyabilir; `TEACHER` ve yetkisiz istekler
  reddedilir.
- `AUDIT_LOG_STORE=postgres` ile seçilen `PostgresAuditLogStore` eklendi; listeleme
  `withTenantQuery` üzerinden tenant setting'leriyle çalışır ve son 100 kaydı döndürür.
- Web panelinde AuditLog listesi eklendi; işlem, varlık, aktör ve tarih alanları mevcut oturum
  token'ı ile okunur.
- Web E2E senaryosu audit listesinin dashboard içinde görünmesini doğrular.
- Desktop ve mobil audit paneli görsel kontrolü yapıldı; dar ekranda satırlar tek kolon akışına
  düşer.
- AuditLog append-only yazımı için ilk kritik işlem dilimi eklendi.
- Başarılı `auth.login` işlemleri `Auth` varlığı altında `auth.login` audit kaydı üretir.
- Destek bildirimi oluşturma ve durum/öncelik güncelleme işlemleri `support_ticket.created` ve
  `support_ticket.updated` audit kayıtları üretir; güncelleme kaydı eski/yeni durum farkını taşır.
- Duyuru yayınlama işlemi `announcement.created` audit kaydı üretir.
- Mesaj şablonu oluşturma, güncelleme ve silme işlemleri `message_template.created`,
  `message_template.updated` ve `message_template.deleted` audit kayıtları üretir.
- KVKK purge için ilk dar dilim eklendi: veli telefon PII alanı `POST /guardians/:id/purge-pii`
  ile kayıt silinmeden temizlenir.
- Veli PII temizleme işlemi ham telefon değerini AuditLog diff'ine yazmadan
  `kvkk.guardian_pii_purged` audit kaydı üretir.
- Web panelinde veli satırına PII temizleme aksiyonu eklendi.
- Öğrenci ve öğretmen PII temizleme kapsamı eklendi; ad-soyad anonimleştirilir, ilişkili kayıt
  silinmez.
- Öğrenci ve öğretmen PII temizleme işlemleri ham ad-soyad değerlerini AuditLog diff'ine yazmadan
  `kvkk.student_pii_purged` ve `kvkk.teacher_pii_purged` audit kayıtları üretir.
- Web panelinde öğrenci ve öğretmen satırlarına PII temizleme aksiyonları eklendi.
- `/health/ready` readiness kontrolü sadece TCP bağlantısı yerine Postgres `SELECT 1` ve Redis
  `PING` cevabını doğrular.
- Readiness servis testi hazır ve hazır olmayan bağımlılık durumlarının sözleşmesini doğrular.
- Sınıf oluşturma, güncelleme ve silme işlemleri `class.created`, `class.updated` ve
  `class.deleted` audit kayıtları üretir; tenant dışı başarısız oluşturma denemesi audit'e
  yazılmaz.
- Öğrenci, öğretmen ve veli oluşturma/güncelleme/silme işlemleri audit kayıtları üretir; kişi
  audit diff'leri ham ad, soyad veya telefon yerine yalnız alan varlığı/değişen alan bilgisini
  taşır.
- Materyal havuzu, materyal dosyası, materyal ataması, ödev oluşturma/güncelleme/silme,
  materyalden ödev oluşturma ve ödev kontrol durumu işlemleri audit kayıtları üretir; audit
  diff'leri ham başlık/açıklama/not/dosya içeriği yerine alan listesi, id, içerik tipi, boyut ve
  hash gibi kanıtları taşır.
- AuditLog büyüme stratejisi için `createdAt` range partitioning migration'ı eklendi; mevcut
  kayıtlar kaybolmadan yeni partitioned tabloya taşınır, 2026 aylık partition'ları ve default
  partition oluşturulur.
- Prisma şeması, canlı DB ve raw SQL store'lar arasındaki küçük drift kapatıldı; migration diff
  canlı DB'ye karşı boş döner.
- WAL/PITR runbook'u eklendi; lokal `pg_dump`/`pg_restore` smoke komutu Postgres container içinde
  geçici restore DB oluşturup `Tenant`, `AuditLog`, `ReportSnapshot` ve `_prisma_migrations`
  tablolarını okuyarak temizlenir.
- KVKK veri-sahibi self-service için `POST /privacy/me/purge-pii` eklendi; oturum sahibi kendi
  hesap email PII'sini anonimleştirir, refresh oturumlarını iptal eder ve ham email'i audit'e
  yazmadan `kvkk.user_pii_purged` kaydı üretir.
- Web paneline hesap anonimleştirme aksiyonu eklendi; başarılı işlem sonrası kullanıcı oturumdan
  çıkarılır.
- `/metrics` endpoint'i Prometheus text formatında uptime, HTTP request sayacı ve süre toplamı
  döner; API request middleware'i metrikleri toplar.
- Opsiyonel `docker-compose.observability.yml` ile Prometheus, Grafana ve Loki stack'i eklendi;
  Prometheus API `/metrics` endpoint'ini scrape eder, Grafana Prometheus ve Loki datasource'larını
  otomatik provision eder.
- Prometheus alert rule'ları API down, 5xx oranı, yavaş istek ve readiness hatalarını izler.
- Grafana API overview dashboard'u request rate, ortalama süre ve readiness hata metriklerini
  Prometheus datasource'u ile otomatik provision eder.
- Grafana Alloy log collector eklendi; Docker container loglarını Docker discovery ile okuyup
  Loki'ye yollar. Grafana API overview dashboard'una Loki tabanlı Docker log paneli eklendi.
- `pnpm prod:env:check` eklendi; gerçek staging/prod env değerlerinde insecure secret, localhost
  URL, `COOKIE_SECURE=false`, in-memory store, noop SMS, inline attachment storage, yerel/insecure
  Sentry veya alert webhook URL'i, eksik off-host backup/WAL/restore hedefi, eksik alert webhook ve
  eksik rollback image tag durumlarını reddeder.
- `pnpm alert:webhook:smoke` eklendi; staging/prod alert bildirim kanalına test payload'u gönderip
  2xx yanıt bekler.
- `pnpm backup:offsite:smoke` eklendi; `BACKUP_OFFSITE_TARGET` için `file://` veya `s3://`
  hedefe test nesnesi yazıp geri okuyarak hash doğrular ve test nesnesini siler.
- `pnpm wal:archive:smoke` eklendi; `WAL_ARCHIVE_TARGET` için `file://` veya `s3://` hedefe
  WAL benzeri test nesnesi yazıp geri okuyarak hash doğrular ve test nesnesini siler.
- `pnpm restore:drill:check` eklendi; `RESTORE_DRILL_TARGET` altındaki staging/prod restore
  raporunun `PASS`, ortam, backup kaynağı, hedef DB ve kritik tablo sayımlarını doğrular.
- `pnpm privacy:inventory:check` eklendi; `KVKK_INVENTORY_TARGET` altındaki staging/prod KVKK
  veri envanteri raporunda gerçek veri sayımı, purge kapsamı ve KVKK audit aksiyonlarını doğrular.
- `pnpm observability:uat:check` eklendi; `OBSERVABILITY_UAT_TARGET` altındaki alert/dashboard
  UAT raporunda Prometheus scrape, Grafana dashboard, Loki log paneli ve alert kurallarını doğrular.
- `pnpm security:audit:check` eklendi; `SECURITY_AUDIT_TARGET` altındaki staging/prod güvenlik
  raporunda HTTPS, security header, auth, RLS, tenant izolasyonu ve PII redaction kanıtlarını
  doğrular.
- `pnpm uat:check` eklendi; `UAT_EVIDENCE_TARGET` altındaki staging/prod UAT raporunda temel rol
  akışlarını, raw import, rapor üretimi, queue, SMS ve Traefik HTTPS smoke komutlarını, rollback
  image tag'ini ve restore edilebilir backup referansını doğrular.
- `pnpm prod:evidence:check` eklendi; production env, Traefik HTTPS, SMS provider, Sentry test
  event'i, alert webhook, off-host backup, WAL archive, restore drill, KVKK envanter,
  observability UAT, güvenlik denetimi ve UAT kanıt kontrollerini tek komutta sıralı çalıştırır;
  `--summary-file` verilirse release kanıt özetini ve Traefik/SMS/notification/Sentry/alert/backup/WAL
  smoke artifact setini secret içermeyen JSON olarak yazar.
- `pnpm sms:smoke` eklendi; Netgsm test/canlı credential geldiğinde kontrollü SMS sağlayıcı
  doğrulaması yapılır, gerçek sağlayıcı için `SMS_SMOKE_CONFIRM=send` gerekir.
- `pnpm sentry:smoke` eklendi; gerçek `SENTRY_DSN` geldiğinde kontrollü test event'i gönderir,
  gerçek event için `SENTRY_SMOKE_CONFIRM=send` gerekir.
- Production env kontrolü yerel veya `http://` object-storage endpoint'ini reddeder; `S3_ENDPOINT`
  gerçek HTTPS host olmalıdır.
- `pnpm traefik:https:smoke` eklendi; gerçek staging/prod domain geldiğinde HTTPS üzerinden
  `/health` yanıtını ve `Strict-Transport-Security` header'ını doğrular.
- `pnpm deployment:region:check` production kanıt zincirine bağlandı; TR datacenter/provider
  raporunda `datacenterCountryCode=TR` ve API/worker/Postgres/Redis/object-storage kapsamını
  doğrular.
- `docs/evidence-templates/*.example.json` ve `pnpm prod:evidence:templates:check` eklendi;
  staging/prod ekibinin dolduracağı restore, KVKK, observability, güvenlik ve UAT rapor
  şablonları repo içinde doğrulanır.
- GitHub Actions CI akışı, yerel `pnpm run ci` içindeki `report-listing:k6:check` kapısıyla
  hizalandı; `pnpm docker:check` bu workflow adımını statik olarak doğrular.
- Staging/prod readiness checklist'i ve `pnpm prod:readiness:check` statik gate'i eklendi; repo
  içinde production'a çıkmadan önce aranacak CI, RLS, backup, TLS, secret, observability, KVKK ve
  UAT şartları tek dosyada izlenir.
- Rapor üretimi, SMS batch, raw import upload ve parser config approval akışları audit yazımına
  bağlandı; audit diff'leri mesaj gövdesi, alıcı telefonları, dosya adı veya dosya içeriği gibi
  PII riski taşıyan ham değerleri içermez.
- KVKK purge kapsamı genişletildi: veli purge artık ad, soyad ve telefonu; self-service hesap
  purge ise email ve ad bilgisini anonimleştirir. Audit diff'leri ham PII yerine yalnız alan
  varlığı bilgisini taşır.
- Ders programı ve etüt oluşturma/güncelleme/silme akışları audit yazımına bağlandı; ham başlık
  yerine değişen alan listesi ve operasyonel id/sayı özetleri tutulur.
- Destek bildirimi ek dosyası ve yorum oluşturma akışları audit yazımına bağlandı; dosya adı,
  dosya içeriği ve yorum gövdesi audit'e yazılmaz.
- Öğrenci Excel import akışı audit yazımına bağlandı; öğrenci adları yerine toplam/import edilen
  satır ve hata sayısı tutulur.

## Çalıştırılan doğrulamalar

- `corepack pnpm --filter @uzman-hocam/api test -- audit-log`
- `corepack pnpm --filter @uzman-hocam/api test -- support-ticket`
- `corepack pnpm --filter @uzman-hocam/api test -- announcement message-template`
- `corepack pnpm --filter @uzman-hocam/api test -- school audit-log`
- `corepack pnpm --filter @uzman-hocam/api test -- school`
- `corepack pnpm --filter @uzman-hocam/api test -- audit-log`
- `corepack pnpm --filter @uzman-hocam/api test -- src/health/health.service.test.ts src/health/health.e2e.test.ts`
- `corepack pnpm --filter @uzman-hocam/api test -- src/http/api-error.e2e.test.ts`
- `corepack pnpm --filter @uzman-hocam/api test -- audit-log`
- `corepack pnpm --filter @uzman-hocam/api test -- school`
- `corepack pnpm --filter @uzman-hocam/api test -- homework`
- `corepack pnpm --filter @uzman-hocam/api test -- audit-log auth`
- `corepack pnpm --filter @uzman-hocam/api test -- metrics`
- `corepack pnpm --filter @uzman-hocam/api typecheck`
- `corepack pnpm docker:check`
- `docker compose -f docker-compose.yml -f docker-compose.observability.yml config`
- `docker run --rm -v /Users/arair/works/des-otomasyon/docker/alloy/config.alloy:/etc/alloy/config.alloy:ro grafana/alloy:v1.16.0 validate /etc/alloy/config.alloy`
- `corepack pnpm --filter @uzman-hocam/db db:audit-log-partition:check`
- `corepack pnpm --filter @uzman-hocam/db test`
- `corepack pnpm --filter @uzman-hocam/db exec prisma migrate deploy --config prisma.config.ts`
- `corepack pnpm --filter @uzman-hocam/db exec prisma migrate diff --config prisma.config.ts --from-config-datasource --to-schema prisma/schema.prisma --script`
- Canlı DB partition doğrulaması: `AuditLog` için `RANGE ("createdAt")`, 12 aylık 2026 partition'ı
  ve `AuditLog_default` görüldü.
- `corepack pnpm ops:check`
- `corepack pnpm prod:readiness:check`
- `node scripts/check-prod-env.mjs --contract .env.example`
- `corepack pnpm prod:evidence:templates:check`
- `DEPLOYMENT_REGION_TARGET=file:///private/tmp/uzman-hocam-deployment-region.json corepack pnpm deployment:region:check`
- `corepack pnpm prod:evidence:check -- --env-file /private/tmp/uzman-hocam-release-env --summary-file /private/tmp/uzman-hocam-release-summary.json`
- `corepack pnpm alert:webhook:smoke`
- `BACKUP_OFFSITE_TARGET=file:///private/tmp/uzman-hocam-offsite-smoke corepack pnpm backup:offsite:smoke`
- `WAL_ARCHIVE_TARGET=file:///private/tmp/uzman-hocam-wal-smoke corepack pnpm wal:archive:smoke`
- `RESTORE_DRILL_TARGET=file:///private/tmp/uzman-hocam-restore-drill.json corepack pnpm restore:drill:check`
- `KVKK_INVENTORY_TARGET=file:///private/tmp/uzman-hocam-kvkk-inventory.json corepack pnpm privacy:inventory:check`
- `OBSERVABILITY_UAT_TARGET=file:///private/tmp/uzman-hocam-observability-uat.json corepack pnpm observability:uat:check`
- `SECURITY_AUDIT_TARGET=file:///private/tmp/uzman-hocam-security-audit.json corepack pnpm security:audit:check`
- `UAT_EVIDENCE_TARGET=file:///private/tmp/uzman-hocam-uat.json corepack pnpm uat:check`
- `corepack pnpm --filter @uzman-hocam/api test -- report-generation sms-batch raw-import-upload parser-config-approval`
- `corepack pnpm --filter @uzman-hocam/api test -- school audit-log`
- `corepack pnpm --filter @uzman-hocam/api test -- audit-log auth`
- `corepack pnpm --filter @uzman-hocam/api test -- schedule study-session audit-log`
- `corepack pnpm --filter @uzman-hocam/api test -- support-ticket audit-log`
- `corepack pnpm --filter @uzman-hocam/api test -- app audit-log`
- `corepack pnpm docker:check`
- `corepack pnpm report-listing:k6:check`
- `SMS_PROVIDER=noop SMS_SMOKE_TO=905000000001 corepack pnpm sms:smoke`
- Lokal mock DSN ile `corepack pnpm sentry:smoke`
- `corepack pnpm compose:health:smoke`
- `docker compose -f docker-compose.yml -f docker-compose.traefik.yml config`
- Lokal mock HTTPS ile `corepack pnpm traefik:https:smoke`
- `corepack pnpm db:migrate`
- `corepack pnpm db:rls:check:live`
- `corepack pnpm postgres-stores:smoke`
- `corepack pnpm queue:smoke`
- `corepack pnpm raw-import:smoke`
- `corepack pnpm report-generation:smoke`
- `corepack pnpm backup:restore:smoke`
- Backup/restore smoke sonucu: geçici restore DB içinde `Tenant`, `AuditLog`, `ReportSnapshot` ve
  `_prisma_migrations` tabloları okundu ve geçici DB temizlendi.
- Offsite backup smoke sonucu: lokal `file://` hedefe test nesnesi yazıldı, geri okundu, hash
  doğrulandı ve test nesnesi silindi.
- WAL archive smoke sonucu: lokal `file://` hedefe WAL benzeri test nesnesi yazıldı, geri okundu,
  hash doğrulandı ve test nesnesi silindi.
- Restore drill kanıt kontrolü sonucu: lokal örnek JSON raporunda `Tenant`, `AuditLog`,
  `ReportSnapshot` ve `_prisma_migrations` sayımları doğrulandı.
- KVKK envanter kanıt kontrolü sonucu: lokal örnek JSON raporunda veri sahibi sayımları, purge
  kapsamı ve KVKK audit aksiyonları doğrulandı.
- Observability UAT kanıt kontrolü sonucu: lokal örnek JSON raporunda scrape, dashboard, log paneli,
  alert webhook status ve alert kuralları doğrulandı.
- Güvenlik denetimi kanıt kontrolü sonucu: lokal örnek JSON raporunda HTTPS, header, auth, RLS ve
  data control maddeleri doğrulandı.
- UAT kanıt kontrolü sonucu: lokal örnek JSON raporunda rol akışları, smoke komutları, rollback
  image tag'i ve restore backup referansı doğrulandı.
- Production evidence kontrolü sonucu: lokal örnek env/hedeflerle bütün production kanıt zinciri tek
  komutta geçti ve release summary JSON artefact'i üretildi.
- Production evidence template kontrolü sonucu: repo içindeki JSON şablonları mevcut doğrulayıcılarla
  uyumlu bulundu.
- Deployment region kanıt kontrolü sonucu: lokal örnek JSON raporunda provider, region, `TR`
  datacenter kodu ve temel servis yerleşimi doğrulandı.
- Postgres store smoke sonucu: Class, Teacher, Guardian, Student, Schedule, StudySession ve
  Homework/Material store yolları canlı Postgres üzerinde tenant izolasyonuyla doğrulandı.
- Traefik compose config sonucu: v3.7.5 entrypoint, ACME HTTP-01 ve Docker label sözdizimi compose
  seviyesinde doğrulandı; canlı TLS/ACME smoke staging domain bekliyor.
- `corepack pnpm --filter @uzman-hocam/web typecheck`
- `corepack pnpm --filter @uzman-hocam/web test:e2e`
- Playwright desktop görsel kontrolü: `apps/web/test-results/audit-log-panel.png`
- Playwright mobil görsel kontrolü: `apps/web/test-results/audit-log-panel-mobile.png`
- Playwright desktop görsel kontrolü: `apps/web/test-results/guardian-pii-panel.png`
- Playwright mobil görsel kontrolü: `apps/web/test-results/guardian-pii-panel-mobile.png`
- `corepack pnpm db:rls:check`
- `corepack pnpm run ci`

## Kalan işler

- Production veri envanteriyle KVKK purge kapsamını staging/prod gerçek verisine karşı çalıştırma.
- Production WAL arşivi, off-host backup hedefi ve staging/prod restore tatbikatı.
- Production alert bildirim kanalı ve observability dashboard/UAT raporunu staging/prod üzerinde
  çalıştırma.
- Staging/prod sertleştirme, güvenlik denetimi ve UAT raporlarını canlı ortamda çalıştırma.
