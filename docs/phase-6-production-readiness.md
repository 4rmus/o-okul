# Faz 6 Production Readiness Checklist

Bu checklist staging/prod açılmadan önce tek tek kanıtlanacak işleri tutar.

## Repo Gate

Production adayı branch için şu komutlar geçmeden release yapılmaz:

```sh
pnpm run ci
pnpm prod:readiness:check
pnpm prod:env:check
pnpm prod:evidence:check
pnpm prod:evidence:summary:check
pnpm prod:evidence:templates:check
pnpm live:status:generate
pnpm live:status:check
pnpm prod:external-evidence:check
pnpm prod:remote-evidence:check
pnpm openapi:generate
pnpm web:a11y:check
pnpm web:backup-restore-panel:check
pnpm web:performance:check
pnpm web:ux-baseline:check
pnpm deployment:region:check
pnpm deployment:rollback:check
pnpm github-ci:check
pnpm alert:webhook:smoke
pnpm wal:archive:smoke
pnpm restore:drill:check
pnpm privacy:inventory:check
pnpm identity-migration:check
pnpm account-management:preflight:check
pnpm account-management:backfill:check
pnpm financial-retention:check
pnpm upload-av:check
pnpm inline-upload-content:check
pnpm audit-null-tenant:check
pnpm rate-limit:smoke
pnpm rate-limit:check
pnpm rls:live:check
pnpm observability:uat:check
pnpm external-monitoring:check
pnpm admin-mfa:check
pnpm security:audit:check
pnpm pilot:check
pnpm go-live:check
pnpm live:onboarding:smoke
pnpm isem-optical-pipeline:evidence-check
pnpm live:exam-cycle:check
pnpm live:ui-worker:smoke
pnpm live:ui-worker:result-check
pnpm uat:check
pnpm sms:smoke
pnpm notification:smoke
pnpm sentry:smoke
pnpm traefik:https:smoke
pnpm db:account-management:check
pnpm db:rls:check:live
pnpm postgres-stores:smoke
pnpm backup:restore:smoke
```

## Ortam Ayrımı

- Staging ve prod ayrı VPS veya ayrı compose override ile çalışır.
- `NODE_ENV=production` kullanılır.
- `COOKIE_SECURE=true` kullanılır; refresh ve CSRF cookie'lerinde `Domain` verilmez ve cookie'ler
  kurum hostuna özel kalır. `DOMAIN`, Cloudflare DNS-01 secret dosyası ve
  `LEGACY_TENANT_LOGIN_CUTOFF_AT` production cutover öncesi doğrulanır.
- `PERSISTENCE_DRIVER=postgres` ayarlanır; tüm store'lar (sınıf, öğrenci, oturum, denetim kaydı, ödeme planı vb.)
  bu tek sürücüye bağlıdır ve production'da asla in-memory'ye düşmez. `apps/api` boot guard'ı
  (`assertPersistenceConfig`) production'da postgres dışı bir değerde veya `DATABASE_URL` eksikse başlatmayı durdurur.
- Account PR-4 cutover öncesinde account-management backfill artifact'ı `PASS` olmalıdır. Tenant login
  yalnız `tenantSlug + loginName + password` kullanır; Postgres auth okuması tek canonical membership/persona
  satırını korunan legacy session rol sonucuyla doğrular. Duplicate canonical satır, rol/persona veya membership
  version sapması, inactive membership/account ya da aktif/geçerli lisansı olmayan tenant fail-closed olur.
- Access ve refresh doğrulaması aktif session'ı güncel Postgres membership sürümü ve rol projeksiyonuyla
  karşılaştırır. Login request sözleşmesi değiştiği için web ve API aynı image çiftiyle ileri veya geri alınır;
  legacy satırlar en az 14 günlük parity gözlem penceresi boyunca rollback verisi olarak korunur.
- Staging deploy sırası additive migration → read-only account preflight → transaction içi
  account backfill/parity `PASS` gate → uygulama servislerini başlatma şeklindedir. Preflight veya
  backfill `BLOCKED` ise legacy tenant erişimini kesecek yeni image başlatılmaz.

## Secret ve Erişim

- `JWT_ACCESS_SECRET` `change-me` değildir. Refresh token runtime'da imzalı JWT değildir; random opaque
  token olarak üretilir, DB'de SHA-256 hash ile saklanır ve `REFRESH_TOKEN_TTL` ile sürelenir.
- `STUDENT_PII_ENCRYPTION_KEY` ve `STUDENT_PII_HASH_KEY` farklı, en az 32 karakterlik gerçek secret değerlerdir.
- `ADMIN_MFA_MODE=optional|required` ayarlanır; `ADMIN_MFA_SECRET_ENCRYPTION_KEY`,
  `ADMIN_MFA_RECOVERY_HASH_KEY` ve `ADMIN_MFA_CHALLENGE_SECRET` gerçek, farklı secret değerlerdir.
- `SECRET_DELIVERY_ENCRYPTION_KEY` en az 32 karakterlik gerçek ve diğer encryption key'lerinden
  farklı bir secret'tır; API ile worker'a aynı değer verilir.
- Worker'a `DIRECT_DATABASE_URL` verilmez. `SECRET_DELIVERY_OUTBOX_DATABASE_URL` yalnız
  `secret_delivery_worker` rolünü kullanır; bu rolün parolası app ve migration DSN parolalarından
  farklıdır ve yalnız `SecretDeliveryOutbox` için `SELECT`/`UPDATE` yetkisine sahiptir.
- Canlı onboarding girdisi, repo/artifacts/evidence mount dışında symlink olmayan private `0600`
  dosyada tutulur. Bu dosya credentials içerdiğinden release artifact'ı değildir.
- `pnpm prod:env:check` gerçek staging/prod env değerlerinde geçer.
- Production kanıt zinciri `pnpm prod:evidence:check` ile tek komutta geçer.
- Gerçek staging/prod env dosyalarında `*_ALLOW_EXAMPLE_EVIDENCE=1` bayrakları bulunmaz;
  `pnpm prod:env:check` bu bypass bayraklarını production evidence için reddeder.
- Gerçek staging/prod evidence target env değerleri yalnız `file://` artifact yolu veya `https://`
  URL olabilir; `http://`, placeholder/example/test host ve lokal temp (`/tmp`, `/var/tmp`,
  macOS `/private/tmp`) `file://` path'leri
  `pnpm prod:env:check` tarafından reddedilir. Birleşik `pnpm prod:evidence:check` kapısı da
  herhangi bir `*_ALLOW_EXAMPLE_EVIDENCE=1` bayrağı açıkken alt checker veya smoke script
  çalıştırmadan kırılır; ayrıca evidence target protokolünü, gerçek https host'unu ve temp/symlink-parent olmayan `file://`
  artifact path'ini erken doğrular; `http://` veya placeholder/temp/symlink target'a ağ/dosya
  okuma denemesi yapmaz.
  `pnpm prod:evidence:templates:check` tüm standalone evidence checker target'larının da
  `http://` protokolünü, placeholder/test `https://` host'larını, lokal temp `file://`
  path'lerini ve symlink file artifact'lerini reddettiğini negatif testle korur.
- `pnpm secret-delivery-outbox:staging:smoke`, yalnız hash, purpose, retry, son 24 saatteki
  `DELIVERED`/payload-cleared durumu, cutover sonrası `notBefore` zamanı, PII-safe `releaseImageTag`
  ve ayrı rolün minimum yetki sonucunu taşıyan artifact üretir. Deploy sonrası oluşan sanitized cutover
  artifact'i, ayrı verify-only workflow tarafından önce dört running service tag'iyle eşleştirilir; eski
  bir terminal kayıt veya tag drift'i yeni release kanıtı olamaz.
  Recipient, token, URL, source ID veya şifreli payload artifact'a yazılamaz; ardından
  `pnpm secret-delivery-outbox:evidence:check` ile doğrulanır. Bu DB rolü/delivery-state kanıtı,
  gerçek inbox-provider teslimatı ile KVKK/DPA kanıtının yerine geçmez; bunlar ayrı live gate'tir.
  Staging verify summary'sinde bu smoke `environment=staging` kalır ve yalnız
  `PRODUCTION_EVIDENCE_ALLOW_STAGING_OUTBOX=1` ile kabul edilir; production/go-live zinciri bu
  istisnayı kullanamaz.
- Ortak smoke evidence preflight/writer, `*_SMOKE_EVIDENCE_FILE`/`SMOKE_EVIDENCE_FILE`
  çıktılarının lokal temp path (`/tmp`, `/var/tmp`) altında veya symlink file/parent directory
  üzerinden yazılmasını reddeder; writer ayrıca payload'u yazmadan önce smoke tipine özgü schema ile
  doğrular. Bu temp/symlink output ve invalid payload negatifleri `pnpm smoke:evidence:check` içinde
  korunur.
- `prod:evidence:check` summary üretimi, ham `*_SMOKE_EVIDENCE_FILE` target'larını smoke script'ler
  başlamadan önce production artifact girdisi olarak doğrular; `/tmp`/`/var/tmp`, symlink dosya veya
  symlink parent directory üzerinden gelen raw smoke path'i kabul edilmez.
- `TRAEFIK_HTTPS_SMOKE_URL` origin'i `WEB_URL` origin'iyle eşleşir; staging/prod kanıt zinciri
  yanlış public edge host'unu smoke hedefi olarak kabul etmez.
- Production kanıt zinciri `--summary-file` ile release özeti üretir ve aynı komut içinde
  `scripts/check-production-evidence-summary.mjs` sözleşmesiyle doğrular.
  `--summary-file`, sibling `reports/` ve `smoke/` artifact layout'u lokal temp path veya symlink
  file/directory üzerinden yazılamaz; birleşik kapı bu output hedeflerini evidence check'lerine
  başlamadan önce reddeder.
- Üretilen release özeti gerektiğinde
  `PRODUCTION_EVIDENCE_SUMMARY_TARGET=file:///... pnpm prod:evidence:summary:check`
  ile bağımsız yeniden doğrulanır; bu bağımsız summary target da yalnız `file://` artifact yolu veya
  `https://` URL olabilir; `http://`, lokal temp path, symlink artifact ve symlink parent directory
  reddedilir. Summary top-level alanları, tam/tekrarsız check listesi, her check maddesinin
  `label/script/status` şekli, beklenen script path'i, `smokeEvidence`, `reports` ve her gömülü report blok alan seti
  tam ve beklenmeyen anahtarsız olmalı, smoke payload'ları, zorunlu report blokları, tarih sıralaması ve gerçek modda
  placeholder/redacted/example değer reddi bu kapıda korunur; check status/script/duplicate sapmaları ve smoke/report kanıtlarının summary
  `generatedAt` sonrasına taşması `prod:evidence:templates:check` negatifleriyle kırmızıya düşer.
- `--summary-file` verildiğinde Traefik HTTPS, SMS, notification, Sentry, alert webhook,
  WAL archive ve report generation smoke kanıtları summary dosyasının yanındaki `smoke/`
  klasörüne secret içermeyen JSON artifact'leri olarak otomatik yazılır. Override edilen raw smoke
  dosya path'leri de kalıcı, symlink olmayan artifact dosyası olmalıdır.
- Staging hostta `docker-compose.yml` içindeki `evidence` nginx servisi
  `./artifacts/staging/reports` klasörünü salt-okunur mount eder; Traefik
  `/evidence/<dosya>.json` isteklerini prefix strip ederek bu servise yollar.
  Mevcut kanıt dosyaları `no-store` ve `nosniff` header'larıyla sunulur, eksik dosyalar 404 kalır.
- Summary yazımı smoke kanıtlarında `result=PASS`, beklenen `check` adı, `environment=production`,
  gelecekte olmayan `generatedAt` ve her smoke tipine özgü alanları doğrular: Traefik smoke URL origin'i
  summary `webUrl` origin'iyle eşleşmeli; external monitoring monitor URL origin'leri de summary
  `webUrl` origin'inden sapmamalı; Traefik/Sentry/alert HTTPS URL ve 2xx/HSTS,
  SMS/notification gerçek provider, WAL `target`, sha256 marker ve `postgresWalArchive` hash özeti.
  Bu payload sözleşmesi `pnpm smoke:evidence:check` ve `pnpm prod:evidence:templates:check`
  zincirinde örnek summary üstünden korunur.
- Staging deploy GitHub Actions'ta elle tetiklenen `.github/workflows/staging-deploy.yml`
  workflow'u veya `main` üzerindeki başarılı `CI` workflow'u sonrasında çalışır; workflow önce dispatch
  input'larını, staging secret/var varlığını ve Docker tag biçimini doğrular, aynı commit'in başarılı
  `.github/workflows/ci.yml` run'ından GitHub CI evidence artifact'ini deploy öncesi üretip doğrular,
  ardından web/api/worker/queue-board imajlarını GHCR'a push eder. Staging VPS'te
  migration öncesi gerekli `btree_gist` eklentisini Postgres yönetici rolüyle idempotent kurar,
  migration/preflight/backfill tek-seferlik container'larını edge compose ve sabit proxy IP olmadan çalıştırır,
  release SHA'sına bağlı özel owner karar dosyası varsa yalnız deploy kullanıcısına ait `0600`,
  normal ve symlink olmayan dosya olarak doğrulayıp backfill container'ına salt-okunur bağlar,
  `docker-compose.release.yml` override'ı ile imajları çeker, migration çalıştırır, Traefik'li stack'i
  ayağa kaldırır ve `web`, `api`, `worker`, `queue-board` servislerinin çalışan image tag'ini deploy
  `IMAGE_TAG` değeriyle birebir karşılaştırır. Otomatik deploy yalnız image activation, migration,
  health ve first-gates sonucuyla yeşil/kırmızı olur; `prod:evidence:check --summary-file` ve
  `staging:release-artifacts:check` verify-only workflow'unda, seçilen deploy cutover/tag bağı doğrulandıktan
  sonra promotion/full evidence kapısı olarak koşar.
- GitHub `staging` environment hazır olmadan deploy tetiklenmez; `pnpm staging:github-env:check`
  environment varlığını, `STAGING_DEPLOY_DIR=/root/o-okul`, `STAGING_NEXT_PUBLIC_API_URL`, opsiyonel
  `STAGING_EDGE_MODE` değerlerini ve required secret isimlerini secret değerlerini yazdırmadan doğrular.
  Eksik secret/var handoff'u için `pnpm staging:github-env:gaps:summary -- --repo 4rmus/o-okul
  --environment staging --gap-report-file artifacts/local/staging-github-env-gap-report.json` yalnız
  isimleri ve önerilen düzeltme komutlarını `artifacts/local/**` altında raporlar; bu çıktı PASS kanıtı değildir.
- UI/UX redesign deploy öncesinde `pnpm ui-ux-redesign:release-preflight -- --repo 4rmus/o-okul
  --environment staging --summary-file artifacts/local/ui-ux-redesign-release-readiness-summary.json
  --github-gap-report-file artifacts/local/staging-github-env-gap-report.json --remote-snapshot-dir
  artifacts/local/remote-staging-snapshot --remote-gap-report-file artifacts/local/remote-staging-gap-report.json
  --max-age-minutes 30` çalıştırılır; komut taze summary üretmeden `--require-ready` kabul etmez.
- Staging production evidence secret sözleşmesi `docs/evidence-templates/staging-evidence.env.example`
  ve varsayılan `pnpm staging:evidence-env:check` ile tam olarak doğrulanır. Normal cutover deploy'u
  yalnız `--mode activation` ile ilk-gates için gereken `NODE_ENV`, staging ortamı, web-originine bağlı HTTPS smoke ve alert
  webhook girdilerini decode edip doğrular; tam DB/proxy/outbox sözleşmesi **Staging Outbox Verify** içinde
  `--mode full` ile yeniden zorunludur. Decode edilen `.staging-evidence.env` dosyası preflight exit trap'i
  ile, evidence/verify job'larında da `if: always()` cleanup adımıyla silinir. Workflow `SENTRY_RELEASE`,
  `ROLLBACK_IMAGE_TAG`, deploy öncesi üretilip `actions/download-artifact@v4` ile evidence job'una indirilen
  `GITHUB_CI_EVIDENCE_TARGET` ve `--summary-file` ile aynı `release-summary-<tag>.json` dosyasını gösteren
  `PRODUCTION_EVIDENCE_SUMMARY_TARGET` değerlerini sonradan ekler, smoke evidence dosyalarını `--summary-file`
  altındaki `smoke/` klasöründe toplar. Secret env dosyası `TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE`
  benzeri raw smoke path'lerini ve `REPORT_GENERATION_SMOKE_EVIDENCE_FILE` değerini içeremez;
  bunlar summary hedefinden türeyen `artifacts/staging/smoke/*.json` dosyalarıdır.
  UI/UX redesign release candidate ve GitHub run referansları staging workflow'un `GITHUB_REPOSITORY`
  slug'ıyla aynı olmalıdır; bu hatta gerçek repo slug `4rmus/o-okul` olduğu için image prefix
  `ghcr.io/4rmus/o-okul` olmalıdır.
  Verify-only workflow host `.env` dosyasında `ADMIN_MFA_MODE=required` değerini doğrular ve full
  evidence env içindeki aynı alanı bu doğrulanmış runtime politikasına bağlar; eski `optional` secret
  kopyası Phase B'yi yanlış negatifte bırakamaz.
  `pnpm staging:evidence-env:secret:set` varsayılan olarak aynı tam doğrulamayı çalıştırır;
  yalnız normal cutover secret senkronu için açıkça `--mode activation` verilebilir. Helper repo/temp/symlink
  dosyalarını reddeder ve `STAGING_EVIDENCE_ENV_B64` değerini GitHub environment secret'a stdin üzerinden yazar.
  `pnpm staging:ghcr-read-token:secret:set` GHCR read token dosyasını aynı şekilde repo/temp/symlink
  dışı ve `chmod 600` zorunlu tutarak `GHCR_READ_TOKEN` secret'ına stdin üzerinden yazar.
- Production kanıt şablonları `pnpm prod:evidence:templates:check` ile repo içinde doğrulanır.
- KVKK, kimlik göçü, finansal saklama, upload AV, observability UAT ve security
  audit gerçek kanıtlarında `checkedAt` gelecekte olamaz.
- Admin MFA raporu `ADMIN_MFA_EVIDENCE_TARGET` ile doğrulanır; SYSTEM_ADMIN/TENANT_ADMIN
  hesaplarında password-only login auth session üretmez, TOTP ve recovery code reuse reddedilir.
  Staging artifact'i üretmek için
  `STAGING_ENVIRONMENT=staging ADMIN_MFA_OUTPUT=artifacts/staging/reports/admin-mfa.json DIRECT_DATABASE_URL=... ADMIN_MFA_MODE=required ADMIN_MFA_SECRET_ENCRYPTION_KEY=... ADMIN_MFA_RECOVERY_HASH_KEY=... ADMIN_MFA_CHALLENGE_SECRET=... ADMIN_MFA_RECOVERY_CODES_PER_ENROLLMENT=8 ADMIN_MFA_PASSWORD_ONLY_LOGIN_BLOCKED=true ADMIN_MFA_TOTP_LOGIN_SUCCEEDED=true ADMIN_MFA_INVALID_TOTP_REJECTED=true ADMIN_MFA_TOTP_REUSE_REJECTED=true ADMIN_MFA_RECOVERY_CODE_LOGIN_SUCCEEDED=true ADMIN_MFA_RECOVERY_CODE_REUSE_REJECTED=true ADMIN_MFA_SESSIONS_REVOKED_ON_ENABLE=true ADMIN_MFA_SESSIONS_REVOKED_ON_DISABLE=true ADMIN_MFA_PASSWORD_ONLY_EVIDENCE_REFERENCE=... ADMIN_MFA_TOTP_SUCCESS_EVIDENCE_REFERENCE=... ADMIN_MFA_INVALID_TOTP_EVIDENCE_REFERENCE=... ADMIN_MFA_TOTP_REUSE_EVIDENCE_REFERENCE=... ADMIN_MFA_RECOVERY_SUCCESS_EVIDENCE_REFERENCE=... ADMIN_MFA_RECOVERY_REUSE_EVIDENCE_REFERENCE=... ADMIN_MFA_SESSIONS_REVOKED_ENABLE_EVIDENCE_REFERENCE=... ADMIN_MFA_SESSIONS_REVOKED_DISABLE_EVIDENCE_REFERENCE=... pnpm admin-mfa:generate`
  kullanılır; generator gerçek secret, DB enrollment sayımı ve login/recovery/session kanıt
  referansları olmadan artifact yazmaz.
- Bozuk imajdan geri dönüş tatbikatı `DEPLOYMENT_ROLLBACK_TARGET` ve
  `pnpm deployment:rollback:check` ile ayrı kanıt raporu olarak doğrulanır; UAT içindeki
  `rollbackImageTag` yalnız release adayı referansıdır. Gerçek deployment rollback
  kanıtlarında `example`, `.test`, `localhost`, `__SET` veya placeholder provider/image/artifact
  referansı kabul edilmez; target URL ve kanıt referansları userinfo, query token veya fragment
  taşıyamaz; rollback raporunda `checkedAt`, `drillStartedAt` ve `drillCompletedAt`
  gelecekte olamaz, `drillStartedAt <= drillCompletedAt <= checkedAt` sırası korunmalıdır.
  `releaseCandidate` ile `rollbackImageTag` aynı tag olamaz. Rollback raporu top-level alan kümesi,
  dört servislik `servicesVerified` seti, her servis image'inin `rollbackImageTag` versiyonuyla
  eşleşmesi, dört komutluk `commandsPassed` seti ve boş `gaps` listesi
  `prod:evidence:templates:check` içindeki fazla alan/servis/komut, servis image versiyon
  uyumsuzluğu, ters kronoloji ve invalid/non-empty gaps negatifleriyle korunur.
  Bu gevşetme yalnız template kontrolünde özel izin bayraklarıyla açılır.
  Staging artifact'i üretmek için
  `STAGING_ENVIRONMENT=staging DEPLOYMENT_ROLLBACK_OUTPUT=artifacts/staging/reports/deployment-rollback.json DEPLOYMENT_ROLLBACK_RELEASE_CANDIDATE=... DEPLOYMENT_ROLLBACK_FAILED_IMAGE_TAG=... DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG=... DEPLOYMENT_ROLLBACK_DRILL_STARTED_AT=... DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT=... DEPLOYMENT_ROLLBACK_FAILURE_INJECTED=true DEPLOYMENT_ROLLBACK_FAILURE_MODE=... DEPLOYMENT_ROLLBACK_MIGRATION_ROLLBACK_SAFE=true DEPLOYMENT_ROLLBACK_DRILL_CONFIRMED=true DEPLOYMENT_ROLLBACK_APPROVED_BY=... DEPLOYMENT_ROLLBACK_APPROVAL_REFERENCE=... DEPLOYMENT_ROLLBACK_COMMAND_LOG_REFERENCE=... DEPLOYMENT_ROLLBACK_BROKEN_SUMMARY_REFERENCE=... DEPLOYMENT_ROLLBACK_ROLLBACK_SUMMARY_REFERENCE=... DEPLOYMENT_ROLLBACK_WEB_STATUS=healthy DEPLOYMENT_ROLLBACK_WEB_IMAGE_TAG=... DEPLOYMENT_ROLLBACK_WEB_EVIDENCE_REFERENCE=... DEPLOYMENT_ROLLBACK_API_STATUS=healthy DEPLOYMENT_ROLLBACK_API_IMAGE_TAG=... DEPLOYMENT_ROLLBACK_API_EVIDENCE_REFERENCE=... DEPLOYMENT_ROLLBACK_WORKER_STATUS=running DEPLOYMENT_ROLLBACK_WORKER_IMAGE_TAG=... DEPLOYMENT_ROLLBACK_WORKER_EVIDENCE_REFERENCE=... DEPLOYMENT_ROLLBACK_QUEUE_BOARD_STATUS=healthy DEPLOYMENT_ROLLBACK_QUEUE_BOARD_IMAGE_TAG=... DEPLOYMENT_ROLLBACK_QUEUE_BOARD_EVIDENCE_REFERENCE=... pnpm deployment:rollback:generate`
  kullanılır. Generator gerçek drill onayı, command log, bozuk release summary, rollback summary
  ve dört servis kanıt referansı olmadan artifact yazmaz; gerçek bozuk image tatbikatını çalıştırmadan
  elle şekilli JSON yazmak Faz 10 kapanışı değildir.
- GitHub Actions remote CI kanıtı `GITHUB_CI_EVIDENCE_TARGET` ve `pnpm github-ci:check` ile
  doğrulanır; staging deploy workflow'u bu raporu aynı commit'in başarılı CI run'ından
  `artifacts/staging/reports/github-ci.json` olarak üretir. Rapor `repository`, 40 karakter `commitSha`, `.github/workflows/ci.yml` workflow path'i,
  GitHub Actions `runUrl`, `conclusion=success`, `command.command=pnpm run ci`,
  `workflowUsesSingleCiCommand=true` ve başarılı job `stepsPassed` içinde `pnpm run ci` kanıtını
  taşır. `workflow.runUrl`, job `logUrl` değerleri ve GitHub Actions `evidenceReferences` run URL'i
  rapordaki `repository` ve `workflow.runId` ile eşleşmelidir; böylece başka repo veya run'a ait
  başarılı CI kanıtı release adayına iliştirilemez. Gerçek kanıtta run URL, repo, branch ve artifact referansları `redacted`, `example`,
  `.test`, `localhost`, `__SET` veya placeholder değer içeremez; bu gevşetme yalnız template
  kontrolünde `GITHUB_CI_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır. GitHub CI raporu top-level 12
  alanı, `workflow`/`command`/`jobs[]` item shape'leri, tam `commandsPassed` seti ve boş
  `gaps` listesi `prod:evidence:templates:check` içindeki fazla alan/komut, GitHub run URL
  repo/runId mismatch ve invalid/non-empty gaps
  negatifleriyle korunur; aynı harness mock GitHub API üstünden `github-ci.json` generator
  çıktısını üretip checker sözleşmesine sokar. Generator `GITHUB_CI_EVIDENCE_OUTPUT`
  hedefinin lokal temp path altında, symlink file üzerinde veya symlink parent directory altında
  olmasını API çağrısından önce reddeder.
- Pilot kapanışı `PILOT_EVIDENCE_TARGET` ve `pnpm pilot:check` ile doğrulanır; bu rapor
  14 günlük pilot, gerçek optik→karne→veli döngüsü, 10k k6 p95 eşiği, >200 rps RLS yük smoke'u,
  olay tatbikatı ve 10 maddelik başarı kriteri imzasını taşır. Gerçek pilot kanıtında `redacted`,
  `example`, `.test`, `localhost`, `__SET` veya placeholder tenant/artifact/assessment referansı kabul edilmez;
  `checkedAt` ve `pilotEndDate` gelecekte olamaz, pilot raporu pilot bitmeden imzalanamaz; bu gevşetmeler
  yalnız template kontrolünde `PILOT_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır. Pilot raporu top-level 18
  alanı, `realDataImport`/`examCycle`/`performance`/`operations` blok shape'leri, `AC-01`..`AC-10`
  assessment seti ve boş `gaps` listesi `prod:evidence:templates:check` içindeki fazla alan,
  beklenmeyen criterion ve invalid/non-empty gaps negatifleriyle korunur.
- Canlı RLS kanıtı `RLS_LIVE_EVIDENCE_TARGET` ve `pnpm rls:live:check` ile doğrulanır; bu
  rapor `pnpm db:rls:check`, `pnpm db:rls:check:live` ve `pnpm rls:load:smoke` çıktılarını
  tek JSON'da toplar. `schema.tablesVerified` schema'dan türeyen 64 tenant tablosunu,
  `isolation.crossTenantReadRows=0` çapraz-tenant okuma sonucunu, `withCheckRejects` yanlış
  tenant yazım/referans negatiflerini ve `loadSmoke.actualRps >= targetRps >= 200` sonucunu
  kanıtlamalıdır. `tenantFkPreflight` bloğu 31 zorunlu tenant composite relation'ı exact listeler,
  legacy allowlist'in 0 olduğunu, orphan/cross-tenant parent satırlarının 0 olduğunu ve her relation
  için cross-tenant insert negatifinin reddedildiğini kanıtlar; `migrationPreflightCommand`
  `pnpm tenant-db:check` içermelidir. `pnpm rls:load:smoke`, `RLS_LOAD_SMOKE_EVIDENCE_FILE` verildiğinde
  `rls-load-smoke.json` artifact'i üretir; `pnpm rls:live:check` bu artifact referansını
  `evidenceReferences` içinde zorunlu tutar. Load smoke artifact'i `checkedAt`, hash'li tenant referansları,
  tam `commandsPassed=["pnpm rls:load:smoke"]` ve boş `gaps` listesi taşır; ham tenant/student id
  alanları ortak smoke evidence sözleşmesinde reddedilir. `RLS_LIVE_EVIDENCE_TARGET` ve
  `evidenceReferences` userinfo, query veya fragment taşıyamaz. Gerçek kanıtta tenant hash ve artifact referansları `redacted`, `example`,
  `.test`, `localhost`, `__SET` veya placeholder değer içeremez; bu gevşetme yalnız template
  kontrolünde `RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır. RLS live raporu top-level 10 alanı,
  `schema`/`isolation`/`tenantFkPreflight`/`loadSmoke` blok shape'leri, 57 tabloluk
  `tablesVerified` exact seti, 24 relation'lık tenant FK exact seti, `withCheckRejects`
  negatif seti, tam `commandsPassed` seti ve boş `gaps` listesi
  `prod:evidence:templates:check` içindeki fazla alan/tablo/komut ve invalid/non-empty gaps negatifleriyle korunur.
- Audit null tenant kanıtı `AUDIT_NULL_TENANT_EVIDENCE_TARGET` ve `pnpm audit-null-tenant:check`
  ile doğrulanır. Rapor `AuditLog.tenantId IS NULL` satırlarını `system`, `deletedTenant`
  ve `unknown` olarak sınıflandırmalı, `unknown.count=0` göstermeli, `totalRows =
  tenantRows + nullTenantRows` ve breakdown toplamı `nullTenantRows` eşitliğini korumalıdır.
  Kanıt hedefi lokal temp path, symlink file/parent directory veya placeholder HTTPS host olamaz;
  production summary ve go-live linked summary aynı `auditNullTenant` bloğunu zorunlu report
  olarak doğrular.
- Go-live karar paketi `GO_LIVE_EVIDENCE_TARGET` ve `pnpm go-live:check` ile doğrulanır; bu
  rapor production evidence summary, GitHub Actions remote CI, staging/prod UAT, bağlı pilot kapanış JSON'u,
  bağlı Canlı Durum PASS bundle'ı, KVKK/DPA, rollback, backup/restore, canlı RLS, alert/observability,
  operasyon sahipliği, cutover planı ve imzalı onayları tek final kanıt paketinde toplar.
  Go-live top-level alanları, `productionEvidenceSummary`, `liveStatusEvidence`, `deployment`, `uat`,
  `pilot`, `legal`, `operations`, `cutover`, `approvals` ve `openRisks` bloklarının anahtar setleri
  tam ve beklenmeyen alansız olmalıdır; approval rolleri product/technical/operations/dataProtection
  olarak tam ve tekrarsız taşınır.
  `liveStatusEvidence.evidenceTarget` bağlı `live-status` JSON'unu gösterir ve bu JSON'daki 18
  dış Canlı Durum satırının `PASS`, beklenen komut/source değerleriyle kanıtlı ve
  production summary, pilot ve go-live artifact hedefleriyle aynı dosyalara bağlı olduğunu doğrular.
  `productionEvidenceSummary.summaryTarget` bağlı
  `prod:evidence:check --summary-file` JSON'unu gösterir ve `pnpm go-live:check` bu summary içindeki
  zorunlu kanıt adımlarını tam ve tekrarsız check listesi olarak, her adımın beklenen script path'ini ayrıca okur; bağlı
  summary top-level alanları, check item `label/script/status` şekli, `smokeEvidence`, `reports`
  ve her gömülü report blok anahtar seti de tam ve beklenmeyen alansız olmalıdır.
  Final kapanışta `PRODUCTION_EVIDENCE_SUMMARY_TARGET`, `LIVE_STATUS_EVIDENCE_TARGET`,
  `PILOT_EVIDENCE_TARGET` ve `GO_LIVE_EVIDENCE_TARGET` birlikte verilerek
  `pnpm prod:external-evidence:check` çalıştırılır; target'sız `ops:check` veya kısmi
  Canlı Durum sonucu final dış kanıt sayılmaz. `*_ALLOW_EXAMPLE_EVIDENCE=1` bayrakları
  bu final kapıda kabul edilmez; örnek fixture gevşetmeleri yalnız template kontrolleri içindir.
  Bu final target'lar lokal temp path, `artifacts/local/**`, `docs/evidence-templates/**`
  fixture dosyası, symlink file/parent directory, userinfo, query veya fragment taşıyan URL
  ya da placeholder/example/redacted HTTPS host üzerinden verilemez. `LIVE_STATUS_READINESS_PATH`
  pass-readiness fixture'ına yönlendirilemez; final kapı yalnız bu readiness dokümanındaki
  Canlı Durum bölümünü kullanır. Remote/staging kapanışta aynı target setiyle
  `pnpm prod:remote-evidence:check` de çalışır; bu komut remote live-status ve remote final
  evidence checker'a target env'lerini geçirir, placeholder/temp/local/fixture remote target'ları
  SSH'e çıkmadan reddeder. Yerel `*_ALLOW_EXAMPLE_EVIDENCE=1` bayrakları açıkken remote kapı
  başlamaz; remote node komutları da bu bayrakları `env -u` ile temizleyerek çalışır.
  `release-summary.json`, `live-status.json`, `pilot.json` veya
  `go-live.json` eksikse remote readiness kırmızı kalır; bu eksiklik target'sız `ops:check`
  veya kısmi Canlı Durum sonucu ile kapatılamaz.
  `productionEvidenceSummary.generatedAt` değerinin bağlı summary `generatedAt` değeriyle eşleştiğini,
  bağlı summary içindeki smoke evidence ve report alanlarının `environment=production` olduğunu, smoke evidence `generatedAt` tarihlerinin summary
  `generatedAt` veya go-live kararından sonra olmadığını, production summary içindeki UAT
  `releaseCandidate`/`rollbackImageTag` değerlerinin deployment rollback raporuyla,
  live exam cycle `releaseCandidate` değerinin UAT `releaseCandidate` değeriyle, live exam
  cycle `appUrl`/`apiUrl` değerlerinin summary top-level `appUrl`/`apiUrl` değerleriyle ve
  `restoreBackupReference` değerinin restore drill `sourceBackup` değeriyle eşleştiğini,
  linked deployment rollback `releaseCandidate` ve
  `rollbackImageTag` değerlerinin go-live raporundaki top-level değerlerle eşleştiğini ve report
  `checkedAt`/`drillDate` tarihlerinin summary `generatedAt` veya go-live kararından sonra olmadığını doğrular. Normal
  `go-live:check` çalışması `.test`/`example`/`redacted`/
  placeholder host, image, provider, recipient, Sentry event, backup/WAL target, approver, owner, summary
  veya artifact referanslarını kabul etmez; linked summary deployment rollback `commandsPassed`,
  servis image/evidence referansları ve `evidenceReferences`
  alanlarını, GitHub CI `runUrl`, `commitSha`, `workflowUsesSingleCiCommand` ve `githubCiPassed`
  değerlerini, RLS live `schema.tablesVerified`, `crossTenantReadRows`, `withCheckRejects`,
  `loadSmoke.actualRps` ve `rlsLivePassed` değerlerini, audit null tenant `unknown.count=0`
  ve toplam tutarlılığını, restore drill `sourceBackup`/`targetDatabase`,
  KVKK `dataSubjectCounts`/`purgeCoverage`
  ve audit action kapsamını, identity migration `migrationDecision`, financial retention `policyDecision`
  ve upload AV `scannerDecision` değerlerini korumalıdır. Linked UAT `releaseCandidate`/`rollbackImageTag`
  değerleri go-live top-level değerlerle, `restoreBackupReference` değeri restore drill `sourceBackup`
  değeriyle eşleşmeli ve `liveExamCyclePassed=true` kalmalıdır. `pnpm go-live:check` bağlı pilot JSON'daki boş `gaps` listesini de zorunlu
  tutar; `prod:evidence:templates:check` linked pilot invalid/non-empty gaps negatiflerini kırmızıya düşürür. Go-live
  `checkedAt`, production summary `generatedAt` ve bağlı
  pilot `checkedAt/pilotEndDate` tarihleri birbirini kronolojik olarak desteklemelidir. Cutover zamanı
  karar zamanından önce olamaz ve approval `approvedAt` değerleri geleceğe veya go-live `checkedAt`
  sonrasına taşamaz. `prod:evidence:templates:check` production summary/live-status karar sonrası,
  cutover karar öncesi ve approval karar sonrası negatiflerini kırmızıya düşürür. Bu izin yalnız örnek template doğrulamasında açılır.
- Report generation canlı smoke `REPORT_GENERATION_SMOKE_EVIDENCE_FILE` verildiğinde
  PII'siz `report_generation_smoke` artifact'i yazar. Bu artifact `tenant/user/email/exam/snapshot`
  değerlerini yalnız SHA-256 hash olarak taşır; ham e-posta, parola, tenant/user/exam/snapshot
  id alanları `pnpm smoke:evidence:check` sözleşmesinde reddedilir. Artifact top-level alan seti,
  `hashes` ve `thresholds` blok shape'leri, tek izinli `commandsPassed` değeri ve boş `gaps`
  listesi ortak smoke evidence sözleşmesiyle korunur. Go-live linked production summary
  `commandsPassed=["pnpm report-generation:perf"]`, `resultCount>=10000`, `studentCount>=10000`
  ve `thresholds.generationDurationMsMax=60000` olmadan geçmez. Daha küçük
  `pnpm report-generation:smoke` koşusu yararlı bir ara smoke olabilir ama Faz 10 kapanış
  kanıtı değildir. `pnpm report-generation:perf` 10k sonuç için
  `generationDurationMs <= 60000` eşiğini artifact içinde kanıtlamalıdır. Bu komut staging
  deploy zincirine dahil değildir; Faz 10 kapanışında çalıştırılır.
- Kurum `/kurum/canli-yayin` Release Kanıtı ekranı production kanıt zincirini, release özet alanlarını ve dış ortam
  kanıt gereksinimlerini ops görünümünde listeler.
- TR datacenter/provider kanıtı v1 go-live zincirinde zorunlu değildir; sunucu lokasyonu operasyon
  envanterinde tutulur ve `DEPLOYMENT_REGION_TARGET` staging/prod release secret'ı değildir.
- SMS v1 kapsamı kapalıdır: staging/prod release env içinde `SMS_ENABLED=false`,
  `NEXT_PUBLIC_SMS_ENABLED=false`, `SMS_PROVIDER=noop` ve `SMS_ALLOW_NOOP_IN_PRODUCTION=false`
  kalır; `pnpm sms:smoke` bu kapsam dışı yolu `provider=disabled`, `segments=0` ve
  `providerMessageId=sms-disabled-v1` ile kanıtlar.
- SMS yeniden release kapsamına alınırsa Netgsm secret'ları repoya yazılmaz; `SMS_PROVIDER=netgsm`,
  `SMS_SMOKE_CONFIRM=send` ve gerçek Netgsm credential'ları `pnpm prod:env:check` tarafından
  placeholder/test değerlerden ayrıştırılır.
- SMS disabled path kanıtı `SMS_PROVIDER_SMOKE_EVIDENCE_FILE` ile masked recipient, provider,
  `segments` ve boş olmayan `providerMessageId` sonucu olarak yazılır; artifact exact top-level
  alan seti, `checkedAt`, tek `commandsPassed=["pnpm sms:smoke"]` ve boş `gaps` listesi taşır.
  Ham telefon, maskesiz recipient veya `placeholder`/`test-message-id`/`sms-provider-message-*`
  gibi sahte provider id'leri production evidence ve go-live summary içinde kabul edilmez.
- WhatsApp `DEC-20260808-01` uyarınca bu release'te kapalıdır: staging/prod env içinde
  `WHATSAPP_ENABLED=false` zorunludur ve production env kapısı başka değer kabul etmez. Repo içinde
  ayrı ve varsayılan `false` RLS-korumalı `WhatsAppConsent` projection'ı, append-only
  `WhatsAppConsentEvent` geçmişi, utility-template Meta adaptörü ve
  ham gövde imzası + kalıcı tekrar bastırma kullanan webhook temeli yerel/mock testlerle korunur.
  KVKK envanter kanıtı bu kapalı dilimde `WhatsAppConsent.recordCount=0`,
  `WhatsAppConsentEvent.eventRecordCount=0` ve `policy.disposalMethod=NO_RECORDS_WHILE_DISABLED`
  zorunlu kılar; projection veya event tablosuna runtime kayıt yazılamaz.
  Bu no-records kanıtı mevcut staging/prod release'ine WhatsApp capability kazandırmaz.
  Meta API'nin kabul ettiği provider mesaj kimliği teslimat sayılmaz; webhook bu dilimde yalnız
  doğrular, sunucu tarafındaki pilot numara-tenant eşlemesini uygular, güvenli durum özetini tekilleştirir
  ve ACK döner. Duyuru/worker akışına bağlanmaz ve hiçbir teslimat durumunu değiştirmez.
- Yerel lifecycle sözleşmesi tenant + telefon hash + amaç kapsamındadır. Aynı tenantta aynı telefonlu
  kardeş `StudentContact` kayıtları ortak projection kullanır; herhangi bir geri çekme hepsini kapatır.
  Event FK'sı veri sahibini contact'a bağlar; grant/withdraw/re-grant immutable sıra, idempotency,
  RLS ve uygulama rolü least-privilege kontrolleri yerel DB/store testleriyle hazırdır.
- Doğrudan inactive/version 0 projection INSERT eventless telefon kapsamı rezervasyonudur; bu P2 yol
  runtime'a bağlı değildir ve oluşan satır `recordCount` hesabına dahildir.
- WhatsApp'ın sonraki bir release'te açılması; izin yönetimi ve geri çekme UI/API yüzeyi,
  gönderim anı yeniden kontrol/bastırma,
  tenant-bound outbound mesaj kaydı ve webhook teslim uzlaştırması, WABA/telefon/template onayları, gerçek credential/deploy,
  KVKK/DPA onayı ve PII-safe gerçek staging gönderim/teslim kanıtı olmadan yapılamaz. WhatsApp smoke
  artifact'i bu dilimde yoktur. İlk outbound pilot yalnız Meta onaylı utility template içindeki portal
  bağlantısıyla sınırlıdır; SMS kapalı, e-posta ve uygulama içi bildirim fallback'i açık kalır.
- Aktivasyondan önce hukuk/veri koruma sahibi retention ve purge kararını onaylamalı ve açık runtime
  için KVKK artifact sözleşmesi kabul edilmelidir;
  mevcut `retentionPeriodDays=0` / `NO_RECORDS_WHILE_DISABLED` politikası açık runtime'a taşınamaz.
- Aktivasyon ayrıca `ContactIdentity` üzerinden numara yeniden tahsisi doğrulaması, keyed phone HMAC
  ve anahtar rotasyonu ile gerçek staging DB'den salt sayım artifact'i üreten generator gerektirir;
  bunlar bu kapalı dilimde runtime/ops yüzeyi olarak uygulanmamıştır.
- Açılış kanıtı; iznin amaç/sürüm/kaynak/zaman alanlarını, her gönderimde izin kontrolünü ve geri
  çekme sonrası bekleyen işlerin bastırılmasını kapsar. Portal URL'si sabit ve kimlik doğrulamalıdır;
  kimlik, telefon, magic-link tokenı veya sır URL/provider metadata/log/evidence içine yazılamaz.
  Meta/BSP alt işleyenleri, işleme ülkeleri, telefon ve teslim metadata'sı, saklama/silme süresi ile
  KVKK yurt dışı aktarım mekanizması hukuk/veri koruma sorumlusu tarafından onaylanmış olmalıdır.
- E-posta provider production'da `NOTIFICATION_PROVIDER=http` ile çalışır; HTTPS endpoint,
  Bearer token, `NOTIFICATION_FROM_EMAIL=bildirim@o-okul.com`,
  `NOTIFICATION_REPLY_TO_EMAIL=destek@o-okul.com`, `NOTIFICATION_SMOKE_SUBJECT`, `NOTIFICATION_SMOKE_BODY` ve
  `pnpm notification:smoke` sonucu kanıt zincirinde zorunludur.
- Notification provider smoke kanıtı `NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE` ile masked
  recipient ve kanal listesi olarak yazılır; artifact `checkedAt`, tek
  `commandsPassed=["pnpm notification:smoke"]` ve boş `gaps` listesi taşır. `NOTIFICATION_PROVIDER=noop`
  gerçek provider kanıtı sayılmaz ve smoke komutu tarafından reddedilir. Production env'de
  `NOTIFICATION_SMOKE_EMAIL_TO` placeholder/test/example değer içeremez. Bu release e-posta-only
  olduğu için `NOTIFICATION_SMOKE_PUSH_TO` boş kalır; evidence ve go-live summary ham e-posta,
  telefon veya push endpoint'i taşıyamaz.
- `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` ve `ALERT_WEBHOOK_URL` production'da gerçek HTTPS host
  olmalıdır; Sentry smoke için `SENTRY_SMOKE_CONFIRM=send` ve gerçek `SENTRY_SMOKE_MESSAGE`,
  alert webhook için `ALERT_WEBHOOK_TOKEN` en az 32 karakterlik gerçek bearer secret olmalıdır.
  `.test`, `.example`, `.invalid`, `example`, `localhost`, `__SET` veya placeholder host
  kabul edilmez.
- Dış erişilebilirlik izleme self-hosted Uptime Kuma ile ayrı node'dan yapılır; `EXTERNAL_MONITORING_TARGET`
  içindeki rapor `API /health`, `API /health/ready`, `Web login`, `Traefik TLS certificate`,
  kesinti algılama ve alert webhook teslim kanıtını taşır. Production summary içinde bu monitor
  URL'lerinin origin'i summary `webUrl` public edge origin'iyle eşleşmelidir.
- `S3_ENDPOINT` production'da gerçek HTTPS object-storage host'u olmalıdır; MinIO/local/example
  endpoint'ler production env kontrolünden geçmez.
- İlk tek-sunucu pilot fazında runtime upload arşivi için internal MinIO kullanılabilir:
  container'lar `DOCKER_S3_ENDPOINT=http://minio:9000` ile backend network içinde kalır, MinIO
  yalnız loopback'e bind edilir. Bu mod staging
  kolaylaştırmasıdır; go-live paketi için external HTTPS S3 veya onaylı object-storage kanıtı gerekir.
- `S3_BUCKET`, `S3_ACCESS_KEY_ID` ve `S3_SECRET_ACCESS_KEY` gerçek staging/prod env içinde
  boş veya placeholder/example/test değer olamaz; `pnpm prod:env:check` S3 hedefini bu
  credential seti olmadan geçirmez.
- Destek ekleri ve homework materyal dosyaları production'da S3'e yazılır:
  `SUPPORT_ATTACHMENT_STORAGE=s3`, `HOMEWORK_MATERIAL_FILE_STORAGE=s3`; production boot guard'ı
  inline storage modunu reddeder.
- S3 `storageKey` kayıtlarında object key sadece sabit prefix ve `sha256` segmenti taşır; tenant id,
  parent id veya ham dosya adı key'e girmez. İndirme API'si dosyayı base64 proxy etmez; support
  ticket ekleri ve homework materyal dosyaları en fazla 5 dakika geçerli imzalı GET URL'si döndürür.
- Yeni S3 kayıtlarında DB `contentBase64` kolonu `NULL` kalır; mevcut inline satırlar için
  `pnpm inline-upload-content:audit` tablo boyutu ve taşıma sayımı üretir, gerçek taşıma yalnız
  `INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true pnpm inline-upload-content:migrate` ile yapılır.
  Migration S3 key'i aynı hash-only kalıpla üretir; S3 put sonrası DB update başarısızsa önce
  aynı `storageKey` için DB referansı aranır, referans yoksa obje silinir, referans varsa obje
  silinmeden fail-fast durulur. Process crash/kill gibi cleanup'ın çalışmadığı durumlar için orphan S3
  object reconciliation kanıtı ayrıca aranır:
  `INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_OUTPUT=artifacts/staging/reports/inline-upload-work/orphan-audit.json pnpm inline-upload-content:orphan-audit`.
  Bu diagnostik rapor sadece prefix bazlı `listedObjects`, `dbReferencedObjects`, `orphanObjects`,
  `dbReferencedMissingObjects`, `invalidKeyObjects`, `legacyDbStorageKeyRows`, `commandsPassed`
  ve `gaps` alanlarını taşır; ham object key, tenant id, parent id, dosya adı, signed URL veya
  içerik yazmaz.
- Sha/content tutarsızlığı şüphesinde `INLINE_UPLOAD_CONTENT_HASH_AUDIT_OUTPUT=artifacts/staging/reports/inline-upload-work/hash-audit.json pnpm inline-upload-content:hash-audit`
  PII taşımayan diagnostik artifact üretir. Rapor yalnızca subject bazlı `pendingRows`,
  `checkedRows`, `matchingRows`, `sha256MismatchRows`, `invalidBase64Rows`, `missingSha256Rows`,
  `pendingBase64Characters`, `tableSizeBytes`, `commandsPassed` ve `gaps` alanlarını taşır; ham
  `contentBase64`, `tenantId`, `fileName`, `storageKey`, object key veya signed URL yazmaz.
  Bu artifact release kanıtı değildir; `missingSha256Rows` varsa önce
  `INLINE_UPLOAD_CONTENT_SHA_REPAIR_OUTPUT=artifacts/staging/reports/inline-upload-work/sha-repair-dry-run.json pnpm inline-upload-content:repair-sha`
  ile PII-safe dry-run repair raporu alınır. DB yazımı yalnız
  `INLINE_UPLOAD_CONTENT_SHA_REPAIR_APPROVED=true` ile çalışır; repair raporu subject bazlı
  sayaçlar, `commandsPassed=["pnpm inline-upload-content:repair-sha"]` ve `gaps` dışında ham
  içerik, tenant/user id, row id, dosya adı, `storageKey`, object key veya signed URL taşıyamaz.
  Repair sonrası hash audit tekrar PASS/PENDING_HASHES_MATCH vermeden migration çalıştırılmaz.
  `reports/inline-upload-content-migration.json` ancak repair, onaylı migrate ve
  `pnpm inline-upload-content:check` PASS sonrası üretilebilir.
- Inline-base64 taşıma kanıtı `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET` ve
  `pnpm inline-upload-content:check` ile doğrulanır: dry-run raporu, onaylı migrate raporu,
  `pendingRows=0`, S3 `storageKey`, `downloadMode=signed-url` ve `downloadUrlExpiresInSeconds <= 300`
  aynı release kanıtında bulunmalıdır. Rapor top-level 9 alanı, `storageMode`/`dryRun`/`migration`
  blok shape'leri, iki subject item seti, migrated item seti, tam `commandsPassed` seti ve boş
  `gaps` listesi `prod:evidence:templates:check` içindeki fazla alan/komut, invalid/non-empty gaps,
  `contentBase64WriteDisabled=false`, `downloadUrlExpiresInSeconds>300`, migration sonrası pending
  row/byte, dry-run pending'den az migrated row, secret target/reference ve raw storage-key/signed-URL
  reference negatifleriyle korunur.
  `INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE` lokal temp path altında, symlink file üzerinde veya
  symlink parent directory altında olamaz; macOS `/private/tmp` dahil temp hedefler DB bağlantısından önce reddedilir.
  Final release artifact'i `pnpm inline-upload-content:generate` ile birleştirilir:
  `INLINE_UPLOAD_CONTENT_DRY_RUN_TARGET=file:///.../dry-run.json`,
  `INLINE_UPLOAD_CONTENT_APPROVED_MIGRATION_TARGET=file:///.../migrated.json`,
  `INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_TARGET=file:///.../orphan-audit.json`,
  `INLINE_UPLOAD_CONTENT_MIGRATION_OUTPUT=artifacts/staging/reports/inline-upload-content-migration.json`,
  `INLINE_UPLOAD_CONTENT_APPROVED_BY`, `INLINE_UPLOAD_CONTENT_APPROVAL_REFERENCE`,
  `SUPPORT_ATTACHMENT_STORAGE=s3`, `HOMEWORK_MATERIAL_FILE_STORAGE=s3`,
  `INLINE_UPLOAD_CONTENT_DOWNLOAD_MODE=signed-url`,
  `INLINE_UPLOAD_CONTENT_DOWNLOAD_URL_EXPIRES_IN_SECONDS<=300`,
  `INLINE_UPLOAD_CONTENT_CONTENT_BASE64_WRITE_DISABLED=true` ve
  `INLINE_UPLOAD_CONTENT_INLINE_READ_COMPATIBILITY=true` olmadan artifact yazmaz. Komut çıktıyı
  hemen `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET=file://... pnpm inline-upload-content:check`
  ile doğrular; onaylı migrate sonrası pending satır/byte sıfır değilse veya migrated satır dry-run
  pending sayısından azsa release raporu üretilemez.
- Upload yüzeyleri ClamAV taramasıyla fail-closed çalışır: `UPLOAD_AV_SCANNER=clamav`,
  `CLAMAV_HOST`, `CLAMAV_PORT` ve `CLAMAV_TIMEOUT_MS`.
- Sentry PII kapalıdır: `SENTRY_SEND_DEFAULT_PII=false`; API, worker ve Next.js web runtime'ları
  `beforeSend` redaction ile e-posta, telefon, TCKN, token/cookie ve kişi adlarını maskeleyerek
  event gönderir.
- Contact PII politikası DEC-20260613-05 ile sabittir: Student.phone, Student.email, Guardian.phone
  ve User.email v1'de operasyonel DB alanı olarak kalır; Guardian.email ayrı kolon değildir ve veli
  hesap e-postası User.email ile temsil edilir. Repo kapısı `pnpm pii:contact-policy:check` bu
  kararın schema, redaction ve KVKK coverage sözleşmelerini doğrular.
- Web Sentry App Router entegrasyonu `@sentry/nextjs`, `instrumentation-client.ts`,
  `instrumentation.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` ve `app/global-error.tsx`
  ile bağlanır; client tarafı yalnız `NEXT_PUBLIC_SENTRY_DSN` varsa açılır ve replay varsayılanı kapalıdır.
- Sentry smoke kanıtı `SENTRY_SMOKE_EVIDENCE_FILE` ile redacted DSN ve event ID olarak yazılır;
  artifact `checkedAt`, tek `commandsPassed=["pnpm sentry:smoke"]` ve boş `gaps` listesi taşır.
- OpenAPI JSON sözleşmesi `pnpm openapi:generate` ile `artifacts/openapi.json` olarak üretilir.
  `OPENAPI_OUTPUT` lokal temp path (`/tmp`, `/var/tmp`) altında, symlink file üzerinde veya
  symlink parent zinciri altında yazılamaz; output contract bu negatifleri API build importlarından
  önce doğrular.
- Swagger UI production'da kapalıdır: `OPENAPI_UI_ENABLED=false`.
- Global API rate limit production'da açıktır: `API_RATE_LIMIT_ENABLED=true` ve
  `API_RATE_LIMIT_STORE=redis`.
- Rate-limit Redis kanıtı `RATE_LIMIT_EVIDENCE_TARGET` ve `pnpm rate-limit:check` ile
  doğrulanır; gerçek staging koşusunda `pnpm rate-limit:smoke`, `RATE_LIMIT_SMOKE_EVIDENCE_FILE`
  içine `rate_limit_redis_smoke` artifact'i yazar ve iki API instance URL'i üzerinden global API
  limitinin `RATE_LIMITED` 429 + `Retry-After` döndürdüğünü, `/health` ve `/metrics` yollarının
  hariç kaldığını, login brute-force kilidinin `LOGIN_LOCKED` 429 ile tenant + kullanıcı adı hash'i + IP boyutunda Redis'te
  instance'lar arasında paylaşıldığını ve farklı IP'nin kilitlenmediğini kanıtlar. Smoke artifact'i
  ham IP, kurum kodu veya kullanıcı adı yerine SHA-256 hash taşır; `checkedAt`, tam `commandsPassed=["pnpm rate-limit:smoke",
  "pnpm rate-limit:check"]` ve boş `gaps` listesi ortak smoke evidence sözleşmesiyle korunur.
  `RATE_LIMIT_EVIDENCE_TARGET`, `instances[].baseUrl` ve `evidenceReferences[]` userinfo/query/fragment
  taşıyamaz; kalıcı release kanıtında instance URL'leri `https://` olmalı ve iki farklı API instance
  URL'i aynı değerle temsil edilemez. Rate-limit raporu top-level 12 alanı, `config`/`instances[]`/`apiRateLimit`/
  `loginAttemptLimiter` blok shape'leri, iki instance, tam `commandsPassed` seti, boş `gaps`
  listesi ve `/health` + `/metrics` excluded path seti `prod:evidence:templates:check` içindeki
  fazla alan/path/komut, duplicate instance URL/label, secret URL/reference ve invalid/non-empty gaps
  negatifleriyle korunur; final `file://` target `artifacts/local/**` altından okunamaz.
  Release bundle'daki `reports/rate-limit.json` dosyası `pnpm rate-limit:generate` ile smoke
  çıktısından taşınır: `RATE_LIMIT_SMOKE_EVIDENCE_TARGET=file:///.../smoke/rate-limit.json` ve
  `RATE_LIMIT_EVIDENCE_OUTPUT=artifacts/staging/reports/rate-limit.json` olmadan artifact yazmaz.
  Generator önce smoke artifact'ini, sonra yazdığı final raporu `RATE_LIMIT_EVIDENCE_TARGET=file://... pnpm rate-limit:check`
  ile doğrular; input/output lokal temp, symlink veya `artifacts/local/**` altındaysa dosya yazmadan
  kırılır. İkinci gerçek API instance/LB shard kanıtı yoksa final rapor üretilemez.
- Tek node staging'de ikinci API shard kanıtı için `docker-compose.rate-limit-shard.yml` kullanılır:
  `docker compose -f docker-compose.yml -f docker-compose.traefik-ip.yml -f docker-compose.rate-limit-shard.yml up -d api-rate-limit-shard traefik`
  host port açmadan aynı API imajını ikinci container olarak çalıştırır. Traefik
  `/__rate-limit-shard` prefix'ini strip ederek bu shard'a yönlendirir; smoke'ta birinci URL normal
  API route'u, ikinci URL `/__rate-limit-shard/api/v1/...` route'u olmalıdır. Bu yalnız rate-limit
  Redis paylaşım kanıtı içindir; first-gates public TLS/alert webhook kanıtı yerine geçmez.
  `TRAEFIK_PROXY_IP`, `API_PROXY_IP` ve `RATE_LIMIT_SMOKE_EGRESS_IP` dar `proxy_net` içinde
  farklı sabit IP'lerdir; `TRUSTED_PROXY_CIDRS` yalnız Traefik IP'sini `/32` ile içerir.
  Traefik güvenilmeyen istemci forwarded başlıklarını güven kaynağı yapmaz ve smoke bu başlıkları
  göndermez. Smoke çalıştırıcısının gerçek dış IP'si `RATE_LIMIT_SMOKE_CLIENT_IP` ve
  `RATE_LIMIT_LOGIN_SMOKE_CLIENT_IP` ile yalnız hash kanıtı için verilir. API limiter testi login
  limiter fazını kirletmesin diye
  `RATE_LIMIT_SMOKE_RESET_API_LIMIT_BEFORE_API=true`,
  `RATE_LIMIT_SMOKE_RESET_API_LIMIT_BEFORE_LOGIN=true`,
  `RATE_LIMIT_SMOKE_API_LIMIT_RESET_IP=<edge-ip>` ve `REDIS_URL=redis://127.0.0.1:6379` verilebilir.
  Bu yalnız smoke API-limit key'ini siler; login limiter Redis key'lerini temizlemez.
  `differentIpNotLocked` negatifi, sabit `RATE_LIMIT_SMOKE_EGRESS_IP` kullanan
  `api-rate-limit-shard` container'ının sabit `API_PROXY_IP` adresine doğrudan isteğiyle üretilir;
  localhost veya sahte forwarded başlığı farklı IP kanıtı sayılmaz. Ana lock kanıtı yine iki HTTPS
  Traefik instance URL'iyle üretilir.
  Login smoke `RATE_LIMIT_LOGIN_SMOKE_TENANT_SLUG` ile mevcut/aktif bir kurum kodu gerektirir;
  isteği `tenantSlug + loginName + password` sözleşmesiyle gönderir.
- Ödeme planı, taksit yazma, öğrenci import commit, öğrenci bireysel/toplu kayıt yenileme ve
  transfer, sınav create/publish/participant, parser config approval, optik template create/apply,
  cevap anahtarı create/import/publish, raw import upload/evaluation enqueue/quarantine resolve,
  rapor üretim enqueue, duyuru teslim sonucu/dış gönderim, destek ek/yorum yazımı, ödev materyal
  dosyası/ataması, backup/restore job başlatma ve SMS batch kuyruğa alma endpointleri
  `Idempotency-Key` header'ını destekler; production'da tekrar istek kayıtları için
  `IDEMPOTENCY_STORE=postgres` zorunludur.
- API modül ayrımı kademeli ilerler: audit log `AuditLogModule`, duyuru yüzeyi
  `AnnouncementModule`, duyuru store provider'ları `AnnouncementPersistenceModule`, attendance yüzeyi
  `AttendanceModule`, auth/login yüzeyi `AuthModule`, auth store/login limiter provider'ları
  `AuthPersistenceModule`, health/readiness `HealthModule`, ödev yüzeyi `HomeworkModule`, mesaj
  şablonları `MessageTemplateModule`, kimlik davetleri `IdentityInvitationModule`,
  Prometheus/queue metrics `MetricsModule`, bildirim cihaz tokenları
  `NotificationDeviceModule`, backup/restore job yüzeyi `OperationsModule`, rol önizleme yüzeyi
  `RolePreviewModule`, okul katalog/ilişki yüzeyleri `SchoolModule`, öğrenci ana store provider'ı
  `StudentPersistenceModule`, öğrenci kayıt/import yüzeyi `StudentModule`, gelişim gözlemleri
  `DevelopmentModule`, sınav/optik/raw import yüzeyi `ExamModule`, sınav repository provider'ları
  `ExamPersistenceModule`, `/me` self-service yüzeyi `MeModule`, ödeme planları `PaymentModule`, KVKK self-purge yüzeyi `PrivacyModule`, rapor üretim yüzeyi `ReportModule`, ders
  programı yüzeyi `ScheduleModule`, etüt yüzeyi `StudySessionModule`, SMS batch yüzeyi `SmsBatchModule`,
  öğretmen notları `TeacherNoteModule`, destek talebi yüzeyi `SupportTicketModule`, upload AV scanner
  provider'ı `UploadModule`, tenant yönetimi yüzeyi `TenantModule`, tenant ana store provider'ı
  `TenantPersistenceModule`, kullanıcı yönetimi yüzeyi `UserManagementModule`, kullanıcı yönetimi ana
  store provider'ı `UserManagementPersistenceModule`, global hata filtresi, capability/role
  guard'ları ve idempotency provider'ı `HttpInfrastructureModule` altında bağlanır; kalan domain
  provider'ları davranış değiştirmeden sonraki modül ayrımı turlarına bırakılır.
- PDF export production'da API sürecinde render edilmez: `REPORT_PDF_RENDERER=worker` ve
  `REPORT_PDF_RENDER_TIMEOUT_MS` pozitif değer olmalıdır; API boot guard'ı `memory` modunu reddeder.
- Tenant koltuk limiti tenant admin kullanıcı oluşturma ve kimlik daveti kabul akışlarında uygulanır;
  dolu tenant yeni üyelik yazımlarında `TENANT_SEAT_LIMIT_EXCEEDED` döner.
- Lisansı bitmiş ama `ACTIVE` tenant kullanıcıları login olup GET/HEAD/OPTIONS istekleriyle read-only
  veri okuyabilir; POST/PATCH/PUT/DELETE gibi yazma istekleri `TENANT_LICENSE_EXPIRED_READ_ONLY`
  koduyla 403 döner.
- SYSTEM_ADMIN isteklerinde RLS bypass varsayılan kapalıdır; geçici cross-tenant bakım için
  `x-rls-bypass-reason` zorunludur ve `system.rls_bypass_requested` audit kaydı oluşur.
- Sentry test event'i `pnpm sentry:smoke` ile doğrulanır.
- Güvenlik denetimi raporu `pnpm security:audit:check` ile doğrulanır; staging artifact'i
  `STAGING_ENVIRONMENT=staging SECURITY_AUDIT_OUTPUT=artifacts/staging/reports/security-audit.json SECURITY_AUDIT_APP_URL=https://... SECURITY_AUDIT_API_URL=https://... SECURITY_AUDIT_HEADERS_URL=https://... RLS_LIVE_EVIDENCE_TARGET=file:///.../rls-live.json SECURITY_AUDIT_COOKIE_SECURE_VERIFIED=true SECURITY_AUDIT_LOGIN_LOCKOUT_VERIFIED=true SECURITY_AUDIT_STRONG_JWT_SECRETS_VERIFIED=true SECURITY_AUDIT_REFRESH_SESSION_REVOCATION_VERIFIED=true SECURITY_AUDIT_TENANT_ISOLATION_VERIFIED=true SECURITY_AUDIT_AUDIT_PII_REDACTION_VERIFIED=true SECURITY_AUDIT_SENTRY_PII_DISABLED_VERIFIED=true SECURITY_AUDIT_NO_CRITICAL_FINDINGS=true SECURITY_AUDIT_PROD_ENV_REFERENCE=... SECURITY_AUDIT_HTTPS_HEADERS_REFERENCE=... SECURITY_AUDIT_RLS_LIVE_REFERENCE=... SECURITY_AUDIT_AUTH_CONTROLS_REFERENCE=... SECURITY_AUDIT_DATA_CONTROLS_REFERENCE=... pnpm security:audit:generate`
  ile üretilir. Generator gerçek HTTPS endpoint, RLS live artifact ve auth/data kontrol referansları
  olmadan JSON yazmaz.

## TLS ve Network

- Traefik TLS termination aktiftir.
- Traefik v3.7.5 ACME/entrypoint/Docker label compose config'i
  `docker compose -f docker-compose.yml -f docker-compose.traefik.yml config` ile geçer.
- Traefik edge kuralı port 80 isteklerini kalıcı olarak `websecure` HTTPS entrypoint'ine yönlendirir;
  wildcard sertifika Cloudflare DNS-01 challenge ile alınır. Zone-kapsamlı token yalnız
  `CF_DNS_API_TOKEN_FILE` ile gösterilen, repo dışındaki `0600` izinli host dosyasından Docker
  secret olarak Traefik'e bağlanır.
- Web ve API router'ları Traefik headers middleware ile HSTS, `nosniff`, `DENY` frame policy,
  `no-referrer` ve dar Permissions-Policy başlıklarını edge'de de üretir.
- Yerel imaj kanıtı: `docker run --rm traefik:v3.7.5 version` çıktısı `Version: 3.7.5`
  ve `Built: 2026-06-10T14:51:33Z` değerlerini verir.
- Release image deploy'u için `docker compose --env-file .env --env-file .env.release -f docker-compose.yml
  -f docker-compose.release.yml -f docker-compose.traefik.yml up -d` kullanılır; `.env.release`
  `WEB_IMAGE`, `API_IMAGE`, `WORKER_IMAGE`, `SENTRY_RELEASE` ve `ROLLBACK_IMAGE_TAG` alanlarını taşır.
- Canlı HTTPS health kontrolü `pnpm traefik:https:smoke` ile geçer.
- Staging kanıt dosyası için `TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE=artifacts/staging/traefik-https.json`
  verilir; dosya URL, beklenen/gerçek HTTP status, HSTS, `checkedAt`, tek
  `commandsPassed=["pnpm traefik:https:smoke"]` ve boş `gaps` listesini secret içermeden yazar.
- `DOMAIN` ve `ACME_EMAIL` gerçek staging/prod değerleridir. Staging için `DOMAIN=staging.o-okul.com`
  kullanılır; staging ve production ayrı VPS veya ayrı compose deployment olarak tutulur.
- Domain alınana kadar bu single-node cihazda `docker-compose.traefik-ip.yml` kullanılır:
  `SERVER_DOMAIN=<sunucu-public-ip>` ile web ve API aynı IP origin'i üstünden self-signed TLS ile
  servis edilir. Bu mod `TRAEFIK_HTTPS_SMOKE_ALLOW_INSECURE_TLS=true` ile yalnız teşhis koşusu
  yapabilir; `TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE` ile PASS artifact yazamaz, ACME yerine geçmez
  ve prod go-live için gerçek domain/sertifika kanıtı ister.
- Domain/IP edge geçişinde Traefik router'ları explicit service label taşır (`web`, `api`,
  `web-ip`, `api-ip`); birleşik compose config bu yüzden router-service ambiguity üretmemelidir.
- Web sadece API'ye erişir; DB, Redis ve MinIO backend network içinde kalır.

## DB ve Yedek

- Migration deploy tamamlanır.
- RLS live check geçer.
- Class, Teacher, Guardian, Student, PaymentPlan, Schedule, StudySession ve Homework Postgres store smoke'u geçer.
- AuditLog partition check geçer: `pnpm audit-log-partition:check` 2026 bootstrap partition
  setini, aylık `CREATE TABLE IF NOT EXISTS` bakım planını ve maintenance contract negatiflerini
  doğrular.
- Canlı bakım dry-run olarak `AUDIT_LOG_PARTITION_EVIDENCE_FILE=artifacts/staging/audit-log-partition.json pnpm audit-log-partition:maintain`
  ile planlanır; gerçek uygulama yalnız `AUDIT_LOG_PARTITION_APPLY=1` ve `DIRECT_DATABASE_URL`
  ile yapılır. Evidence output lokal temp path, symlink dosya veya symlink parent dizin olamaz.
- İlk pilotta ops seviyesinde off-host backup hedefi release planından çıkarılmıştır. Kurum kullanıcısı `/kurum/yedek-restore` ekranından
  kendi eklediği kurum verilerini JSON olarak bilgisayarına indirir ve sunucu dışındaki kopyayı orada
  saklar. Bu kullanıcı export modeli pilot için yeterlidir; `pnpm backup:offsite:smoke`
  opsiyonel manuel araç olarak kalır ama release/golive kanıt zincirinde zorunlu değildir.
  Kalıcı `BACKUP_OFFSITE_TARGET` yeniden açılırsa off-host hedef için kanonik kanıt
  `BACKUP_OFFSITE_RESTORE_SMOKE_EVIDENCE_FILE=artifacts/staging/backup-offsite-restore.json BACKUP_OFFSITE_RESTORE_TARGET=... pnpm backup:offsite-restore:smoke`
  komutudur; bu komut canlı DB dump'ını off-host hedefe yazar, aynı dump'ı hedeften geri okur ve
  geçici restore DB'de `Tenant`, `AuditLog`, `ReportSnapshot`, `_prisma_migrations` sayımlarını doğrular.
- WAL archive hedefi `pnpm wal:archive:smoke` ile yaz/oku/sil ve gerçek Postgres `pg_switch_wal()`
  arşiv çıktısı olarak doğrulanır.
- Staging kanıt dosyası için `WAL_ARCHIVE_SMOKE_EVIDENCE_FILE=artifacts/staging/wal-archive.json`
  verilir; dosya hedef protokolünü, marker hash'ini, `postgresWalArchive`, `checkedAt`, tek
  `commandsPassed=["pnpm wal:archive:smoke"]` ve boş `gaps` listesini secret içermeden yazar.
- Production env kontrolü `WAL_ARCHIVE_TARGET` için `s3://bucket/prefix`
  veya mount edilmiş `file://` hedefi ister; placeholder/test hedefleri reddedilir.
  Tekil smoke üreticileri `file://` hedefte root, lokal temp path veya symlink dizin/parent path
  kabul etmez; mount hedefi kalıcı, symlink olmayan dizin olmalıdır.
- Günlük base backup lokal kalıcı backup path'ine, WAL arşivi ayrı kalıcı hedefe gider.
  Compose `archive_mode` değişikliği çalışan Postgres konteynerine uygulanmadıysa Postgres servisi
  recreate edilmeden WAL smoke PASS vermez.
- Panel/API/worker üzerinden tetiklenen backup işi yalnız `s3://bucket/prefix` veya kalıcı
  `file://` dizin hedefi kabul eder; root, lokal temp path, symlink dizin veya symlink parent
  zinciri altındaki hedefler panel preflight/queue producer/API/worker tarafından reddedilir;
  panel formu ve queue producer serbest string, geçersiz protokol ve lokal temp/root hedefleri
  enqueue öncesi kırar.
- Staging/prod restore tatbikatı `Tenant`, `AuditLog`, `ReportSnapshot` ve son migration'ı doğrular.
- Ön smoke için `BACKUP_RESTORE_SMOKE_EVIDENCE_FILE=artifacts/staging/backup-restore-smoke.json pnpm backup:restore:smoke`
  kullanılabilir; artifact `backup_restore_smoke` check'i, hash'li restore DB adı, `dumpFormat=custom`,
  dört tablo sayımı, tek `commandsPassed=["pnpm backup:restore:smoke"]` ve boş `gaps` listesi taşır.
  Output hedefi lokal temp path, symlink dosya veya symlink parent dizin olamaz.
- Off-host hedef etkinse restore kanıtı ayrı marker dosyasına dayanmaz:
  `BACKUP_OFFSITE_RESTORE_SMOKE_EVIDENCE_FILE=artifacts/staging/backup-offsite-restore.json BACKUP_OFFSITE_RESTORE_TARGET=s3://... pnpm backup:offsite-restore:smoke`
  artifact'i `backup_offsite_restore_smoke`, `backupSha256`, hash'li restore DB adı,
  `dumpFormat=custom`, dört tablo sayımı, tek `commandsPassed=["pnpm backup:offsite-restore:smoke"]`
  ve boş `gaps` listesi taşır; raw path, object key, DB adı veya credential yazılmaz.
- Final restore-drill artifact'i için staging hostta
  `STAGING_ENVIRONMENT=staging RESTORE_DRILL_OUTPUT=artifacts/staging/reports/restore-drill.json pnpm restore:drill:generate`
  çalıştırılır. Bu komut Docker Compose postgres servisinden `pg_dump --format=custom` alır, geçici
  restore DB oluşturur, dört kritik tablo sayımını restore edilen DB'den okur, geçici DB/dump'ı
  temizler ve yalnız `restore:drill:check` şemasındaki 7 alanı yazar.
- Gerçek restore raporunda `drillDate` gelecekte olamaz; `Tenant`, `AuditLog`, `ReportSnapshot`
  ve `_prisma_migrations` sayımları en az `1` olmalıdır.
- Restore tatbikatı raporu `pnpm restore:drill:check` ile doğrulanır.
- Panel/API/worker üzerinden tetiklenen restore drill işi `file://` evidence hedefini lokal temp
  path'ten, symlink dosyadan veya symlink parent zinciri altından kuyruğa alamaz/okuyamaz;
  panel formu ve queue producer serbest string, geçersiz protokol ve lokal temp `file://` hedefleri
  enqueue öncesi kırar, API `/tmp` ve `/var/tmp` altındaki restore evidence hedeflerini ve yerelde görünen symlink
  file/parent-zincir hedeflerini kuyruğa almaz.
- Gerçek restore raporunda `sourceBackup` ve `targetDatabase` gerçek backup/run referansı olmalıdır;
  `backup-bucket`, `example`, `.test`, `redacted`, `localhost`, `__SET` veya placeholder değerler yalnız
  template kontrolünde `RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
  Rapor top-level 7 alanı ve `tableCounts` dört tablo seti `prod:evidence:templates:check`
  içindeki fazla alan/tablo negatifleriyle korunur.

## Observability

- Prometheus `/metrics` endpoint'ini scrape eder.
- API down, 5xx oranı, yavaş istek, readiness, queue failed-count ve queue metrics scrape
  alert'leri aktiftir.
- `/metrics` içinde `o_okul_queue_jobs{queue,status}` ve
  `o_okul_queue_metrics_scrape_error` metrikleri görünür.
- Grafana Alloy Docker container loglarını Loki'ye yollar.
- API `pino-http` JSON loglarında `requestId`, `tenantId`, `userId`, `httpRequest.path`,
  `httpResponse.statusCode` ve `durationMs` alanları görünür; request body, query string,
  authorization/cookie header'ları ve PII loglanmaz.
- Worker pino JSON loglarında `worker_job_completed` ve `worker_job_failed` event'leri
  `queueName`, `jobId`, `tenantId`, `userId` ve `durationMs` alanlarıyla görünür.
- BullMQ operasyon paneli `queue-board` servisi olarak yalnız `backend_net` içinde çalışır; host portu
  `127.0.0.1:${QUEUE_BOARD_HOST_PORT:-3200}` ile loopback'e bağlıdır, Traefik router'ı yoktur ve
  erişim `QUEUE_BOARD_BASIC_AUTH_USER`/`QUEUE_BOARD_BASIC_AUTH_PASSWORD` ile korunur.
- Prometheus, Grafana, Loki ve Alloy host portları `docker-compose.observability.yml` içinde loopback'e
  bağlıdır; public bind kullanılmaz. UAT erişimi SSH tunnel veya auth'lu reverse proxy arkasından yapılır.
- `LOG_LEVEL=info`, `LOG_ENABLED=true`, `QUEUE_METRICS_ENABLED=true`,
  `API_RATE_LIMIT_ENABLED=true`, `API_RATE_LIMIT_STORE=redis`, `IDEMPOTENCY_STORE=postgres`,
  `REPORT_PDF_RENDERER=worker` ve `SENTRY_SEND_DEFAULT_PII=false` production env içinde sabittir.
- Grafana API overview dashboard'u metrik ve Docker log panelleriyle açılır.
- Loki veya seçilen production log shipping hedefi API/worker loglarını alır; tek `requestId`
  ile API logları filtrelenebilir.
- Alert bildirim kanalı staging'de `ALERT_WEBHOOK_TOKEN` bearer secret'ı ile `pnpm alert:webhook:smoke`
  çalıştırılarak test edilir. Smoke komutu webhook'a istek atmadan önce `ALERT_WEBHOOK_URL`
  değerinin `https://` gerçek host olduğunu, userinfo/query/fragment taşımadığını ve lokal/test
  host olmadığını doğrular; aksi durumda bearer secret hedefe gönderilmeden kırılır.
- Staging kanıt dosyası için `ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE=artifacts/staging/alert-webhook.json`
  verilir; dosya webhook URL'ini credential olmadan, HTTP status'ü, `authorizationScheme="bearer"`,
  `checkedAt`, tek `commandsPassed=["pnpm alert:webhook:smoke"]` ve boş `gaps` listesiyle yazar.
- Alert ve dashboard UAT raporu `pnpm observability:uat:check` ile doğrulanır. Staging artifact'i
  `STAGING_ENVIRONMENT=staging OBSERVABILITY_UAT_OUTPUT=artifacts/staging/reports/observability-uat.json OBSERVABILITY_UAT_PROMETHEUS_URL=https://... OBSERVABILITY_UAT_GRAFANA_URL=https://... OBSERVABILITY_UAT_LOKI_URL=https://... OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET=file:///.../alert-webhook.json OBSERVABILITY_UAT_DASHBOARD_PANELS_VERIFIED="API up,Request rate,Average duration,Readiness failures,Docker logs" OBSERVABILITY_UAT_ALERTS_VERIFIED="OOkulApiDown,OOkulReadinessFailing,OOkulApiHighErrorRate,OOkulApiSlowRequests" OBSERVABILITY_UAT_PROMETHEUS_EVIDENCE_REFERENCE=... OBSERVABILITY_UAT_GRAFANA_EVIDENCE_REFERENCE=... OBSERVABILITY_UAT_LOKI_EVIDENCE_REFERENCE=... OBSERVABILITY_UAT_ALERT_WEBHOOK_EVIDENCE_REFERENCE=... pnpm observability:uat:generate`
  ile üretilir. Generator gerçek endpoint, alert smoke artifact'i ve dashboard/alert referansları
  olmadan JSON yazmaz.
- Gerçek observability UAT raporunda Prometheus scrape, Grafana dashboard, Loki query ve alert delivery
  artifact referansları `evidenceReferences` altında yer almalıdır; `example`, `.test`, `redacted`,
  `localhost`, `__SET` veya placeholder değerler yalnız template kontrolünde
  `OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir. Rapor top-level 11 alanı, beş
  dashboard paneli, dört alert kuralı ve boş `gaps` listesi template invalid/non-empty gaps negatifleriyle korunur.
  `OBSERVABILITY_UAT_TARGET`, `OBSERVABILITY_UAT_OUTPUT` ve `OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET`
  lokal temp path, `artifacts/local/**`, symlink file/parent veya userinfo/query/fragment taşıyan
  URL üzerinden kullanılamaz.
- External monitoring raporu `pnpm external-monitoring:check` ile doğrulanır. Self-hosted Uptime Kuma
  node'u dış ağdan public HTTPS endpoint'leri izler; `API /health`, `API /health/ready`, `Web login`
  ve `Traefik TLS certificate` monitor'ları `UP` olmalı, bilinçli kesinti webhook'a 120 saniye içinde
  düşmelidir. `outageDrill` zamanları `inducedAt <= detectedAt <= webhookDeliveredAt <= recoveredAt`
  sırasını ve latency saniyeleri timestamp farklarıyla eşleşmeyi kanıtlamalıdır. Rapor top-level
  10 alanı, `monitoringNode`, monitor item, `outageDrill` blok shape'leri ve boş `gaps` listesi
  template invalid/non-empty gaps negatifleriyle korunur.
  Staging artifact'i
  `STAGING_ENVIRONMENT=staging EXTERNAL_MONITORING_OUTPUT=artifacts/staging/reports/external-monitoring.json EXTERNAL_MONITORING_NODE_HOST=... EXTERNAL_MONITORING_NODE_REGION=tr-istanbul-1 EXTERNAL_MONITORING_NODE_NETWORK=external-vps EXTERNAL_MONITORING_API_HEALTH_URL=https://.../health EXTERNAL_MONITORING_API_READY_URL=https://.../health/ready EXTERNAL_MONITORING_WEB_LOGIN_URL=https://.../login EXTERNAL_MONITORING_TLS_URL=https://.../ EXTERNAL_MONITORING_ALERT_WEBHOOK_STATUS=200 EXTERNAL_MONITORING_OUTAGE_INDUCED_AT=... EXTERNAL_MONITORING_OUTAGE_DETECTED_AT=... EXTERNAL_MONITORING_OUTAGE_WEBHOOK_DELIVERED_AT=... EXTERNAL_MONITORING_OUTAGE_RECOVERED_AT=... EXTERNAL_MONITORING_MONITORS_EVIDENCE_REFERENCE=... EXTERNAL_MONITORING_OUTAGE_EVIDENCE_REFERENCE=... EXTERNAL_MONITORING_TLS_EVIDENCE_REFERENCE=... pnpm external-monitoring:generate`
  ile üretilir; generator gerçek endpoint ve outage drill kanıtları olmadan JSON yazmaz.
- Admin MFA raporu `pnpm admin-mfa:check` ile doğrulanır. TOTP secret'ları AES-GCM ile şifreli
  saklanır, recovery code'lar hash'lenir, SMS OTP kullanılmaz ve enable/disable işlemleri mevcut
  session'ları iptal eder. Rapor top-level 9 alanı ile `policy`, `enrollment`,
  `loginVerification` blok shape'leri ve boş `gaps` listesi template invalid/non-empty gaps negatifleriyle korunur.
  Staging/prod artifact üretimi `pnpm admin-mfa:generate` ile yapılır; komut aktif tenantlardaki
  SYSTEM_ADMIN/TENANT_ADMIN hesaplarının tamamının TOTP enrollment'lı olmasını, en az bir recovery
  code hash'inin kalmasını, auth MFA unit testlerini ve API typecheck'i geçmeden JSON yazmaz.

## Web UX ve A11y

- Landing sayfası değer önerisi, optik-analiz akışı, üretim kanıt sinyalleri, demo/kapalı beta
  CTA'ları ve PII içermeyen gerçek ürün yüzeyiyle yayınlanır; sentetik tarayıcı chrome'u çizilmez.
- Landing artık PII içermeyen Optik → Rapor → Portal workbench'ini render eder; eski sentetik hero asset render dışında
  tutulur ve açık silme onayı olmadan korunur. Repo performans bütçesi `pnpm web:performance:check`
  ile marketing route'unun server/no-query kalmasını, korunmuş WebP dosyasının 250 KB ve PNG geri
  dönüş dosyasının 2 MB sınırını aşmamasını doğrular.
- Opsiyonel `WEB_PERFORMANCE_PROFILE_OUT` profili lokal temp path (`/tmp`, `/var/tmp`) altında,
  symlink file üzerinde veya symlink parent zinciri altında yazılamaz; `pnpm web:performance:check`
  bu output negatiflerini de çalıştırır.
- Landing ve auth sonrası kurum dashboard 320/375/414/768/1024/1440 görsel matrisiyle taranır;
  landing için 320/375/414/768 axe + yatay taşma ve 1280x800 fold sözleşmesi ayrıca korunur.
- Genel login 320/375/414/768/1024/1440 axe + yatay taşma matrisinden geçer; kurum ve sistem
  giriş rotalarının alan/tenant bağlamı auth kontratında ayrıca doğrulanır.
- Login paneli, kurum rail'i, öğrenci öncelikli aksiyon şeridi ve rapor durum bölgesi hedefli Darwin/Linux
  golden'larıyla korunur; genel ekran seti ve mevcut karne golden'ları topluca güncellenmez.
- Kritik WCAG 2 A/AA axe ihlali 0 olmalıdır; repo kapısı `pnpm web:a11y:check` ile doğrulanır.
- Yedek/restore paneli, serbest string backup hedefi ve `s3://` restore kanıt dosyasını API çağrısı yapılmadan reddeder; bu hedefli panel sözleşmesi `pnpm web:backup-restore-panel:check` ile doğrulanır.
- GitHub CI `pnpm run ci` öncesi
  `pnpm --filter @o-okul/web exec playwright install --with-deps chromium` çalıştırır; bu
  şart `pnpm docker:check`, `pnpm ops:check` ve `pnpm prod:readiness:check` statik kapılarıyla korunur.
  Turbo'nun `.turbo` çıktısı lockfile kapsamlı GitHub Actions cache'inden geri yüklenir; exact-SHA
  `pnpm run ci` komutu ve release kanıtı değişmez.
- GitHub CI içindeki ayrı `ui-ux-rc` işi manuel koşuda her zaman, pull request ve `main` push'ta ise
  UI'yı etkileyen dosyalar değiştiğinde Chromium ile WebKit matrisini aynı commit üzerinde iki worker
  ile çalıştırır. Değişiklik aralığı çözülemezse test fail-open çalışır; UI/UX kanıtı
  `pnpm web:ux-rc:check` kaydı olmadan yerel sözleşme PASS sayılmaz.
- Web UX baseline contract `pnpm web:ux-baseline:check` ile a11y spec kapsamını,
  320/375/414/768 responsive tabanını, 1024/1440 masaüstü kapsamını, landing server/no-query
  performans bütçesini ve Optik → Rapor → Portal iş akışı sözleşmesini sabitler.
- A11y smoke gerçek staging kanıtının yerine geçmez; tablet operatör UAT'i Faz 10 rol bazlı UAT içinde ayrıca yapılır.

## KVKK ve Audit

- Login, destek, duyuru, mesaj şablonu, sınıf, kişi, ödev ve KVKK purge audit kayıtları görünür.
- KVKK veri envanteri staging/prod gerçek veri sayımlarıyla `pnpm privacy:inventory:check`
  üzerinden doğrulanır.
- KVKK `purgeCoverage` içinde öğrenci için `firstName`, `lastName`, `nationalIdEncrypted`,
  `nationalIdHash`, `phone`, `email`, `photoKey`; öğretmen için `firstName`, `lastName`,
  `nationalIdEncrypted`, `nationalIdHash`, `phone`; veli için `firstName`, `lastName`, `phone`;
  kullanıcı hesabı için `email`, `name`; `StudentContact` için ad, ilişki, şifreli/hash iletişim,
  izin ve consent alanlarının anonimleştirme/temizleme kapsamı doğrulanır.
  `whatsappConsent` bloğu bu release'te `recordCount=0`, exact
  `eventRecordCount=0`,
  `piiRelevantStoredFields=[phoneHash,purpose,canReceiveWhatsapp,version,noticeVersion,source,recordedAt,withdrawnAt]`,
  `piiRelevantEventStoredFields=[whatsappConsentId,studentContactId,purpose,sequence,eventType,noticeVersion,source,recordedAt,commandKeyHash,requestHash]`
  ve exact policy (`featureEnabled=false`, `retentionPeriodDays=0`,
  `disposalMethod=NO_RECORDS_WHILE_DISABLED`, `purgeException=false`, boş olmayan `explanation`)
  taşır. Bu, özellik kapalıyken runtime kaydı olmadığını kanıtlar; capability veya sonraki
  aktivasyonun retention/purge onayı değildir.
  Rapor top-level 10 alanı, beş `dataSubjectCounts` alanı, beş `purgeCoverage` subject'i,
  subject field setleri, beş audit action seti, `/audit-logs` audit diff redaction bloğu ve boş `gaps` listesi
  `prod:evidence:templates:check` içindeki fazla alan/madde ve invalid/non-empty gaps negatifleriyle korunur.
  Audit diff negatif kontrolleri `body`, `contentBase64`, `fileBase64`, `fileName`, `objectKey`,
  `rawLine`, `rawRow`, `rawText`, `s3Key`, `sourceFileName`, `sourceFilePath`, kişi adı,
  iletişim, TCKN-benzeri ve token alanlarının audit/evidence çıktısında redakte edildiğini kanıtlar.
- Audit null tenant sınıflandırması `AUDIT_NULL_TENANT_EVIDENCE_TARGET` üzerinden ayrıca
  doğrulanır; staging evidence secret bu target'ı içermek zorundadır ve `unknown.count` sıfır
  değilse release kanıtı geçmez.
- Kimlik göç kanıtı: öğrenci/veli/öğretmen user bağları, tenant membership ve negatif erişim
  kontrolleri `pnpm identity-migration:check` üzerinden doğrulanır. Gerçek kanıtta onay sahibi ve
  onay referansı `example`, `.test`, `redacted`, `localhost`, `__SET` veya placeholder değer içeremez;
  bu gevşetme yalnız template kontrolünde `IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır.
  Staging artifact'i üretmek için `STAGING_ENVIRONMENT=staging IDENTITY_MIGRATION_OUTPUT=artifacts/staging/reports/identity-migration.json IDENTITY_MIGRATION_APPROVED_BY=... IDENTITY_MIGRATION_APPROVAL_REFERENCE=... IDENTITY_MIGRATION_ACTIVATION_MODE=invite pnpm identity-migration:generate`
  kullanılır; generator pozitif subject sayımı, eksiksiz user link, eşleşen tenant membership ve
  identity invitation/tenant user management e2e testleri olmadan PASS artifact yazmaz.
  Hedefli API e2e testleri canlı `DATABASE_URL`/`DIRECT_DATABASE_URL`/`NODE_ENV`/`ADMIN_MFA_MODE`/`PERSISTENCE_DRIVER`/`IDEMPOTENCY_STORE`
  ortamından izole edilir; subject sayımı yine gerçek staging/prod DB bağlantısından okunur.
  Rapor top-level 8 alanı, `migrationDecision`/`invitationFlow` blok shape'leri, üç subject item
  seti, dört verification seti ve boş `gaps` listesi `prod:evidence:templates:check`
  içindeki fazla alan/madde ve invalid/non-empty gaps negatifleriyle korunur.
- Finansal saklama kanıtı: finansal kayıtların saklama süresi ve purge istisnası `pnpm financial-retention:check`
  üzerinden doğrulanır. Gerçek kanıtta karar sahibi ve referans alanları örnek/placeholder/redacted
  değer içeremez; bu gevşetme yalnız template kontrolünde `FINANCIAL_RETENTION_ALLOW_EXAMPLE_EVIDENCE=1`
  ile açılır.
  Staging artifact'i üretmek için `STAGING_ENVIRONMENT=staging FINANCIAL_RETENTION_OUTPUT=artifacts/staging/reports/financial-retention.json FINANCIAL_RETENTION_APPROVED_BY=... FINANCIAL_RETENTION_APPROVAL_REFERENCE=... FINANCIAL_RETENTION_LEGAL_BASIS=... FINANCIAL_RETENTION_PERIOD_YEARS=10 FINANCIAL_RETENTION_PURGE_EXCEPTION=true pnpm financial-retention:generate`
  kullanılır; generator gerçek onay alanları, pozitif `PaymentPlan`/`PaymentInstallment` sayımı ve
  payment e2e içindeki KVKK purge ödeme planı koruma testi olmadan PASS artifact yazmaz.
  Hedefli payment e2e testi canlı `DATABASE_URL`/`DIRECT_DATABASE_URL`/`NODE_ENV`/`ADMIN_MFA_MODE`/`PERSISTENCE_DRIVER`/`IDEMPOTENCY_STORE`
  ortamından izole edilir; finans kayıt sayımı yine gerçek staging/prod DB bağlantısından okunur.
  Rapor top-level 7 alanı, `policyDecision`/`financialRecords` blok shape'leri, iki
  `purgeBehaviorVerified` seti ve boş `gaps` listesi `prod:evidence:templates:check`
  içindeki fazla alan/madde ve invalid/non-empty gaps negatifleriyle korunur.
- Upload AV kanıtı: upload scanner kararı, fail-closed davranışı ve EICAR reddi `pnpm upload-av:check`
  üzerinden doğrulanır; support ticket ekleri ve homework materyal dosyaları runtime scanner'dan geçer.
  Upload retention kontratı `pnpm upload-retention:check` ile support ticket ekleri,
  homework materyal dosyaları ve raw import arşivleri için `deletedAt`/tenant indexlerini,
  aktif soft-delete filtrelerini ve `support-ticket-attachments/<tenantId>/<ticketId>/<sha256>/source`,
  `homework-material-files/<tenantId>/<materialId>/<sha256>/source`,
  `raw-imports/<tenantId>/<examId>/<parserConfigVersion>/<sha256>/source` key kalıplarını korur.
  Gerçek kanıtta scanner onay sahibi, onay referansı ve scanner adı örnek/placeholder/redacted değer
  içeremez; bu gevşetme yalnız template kontrolünde `UPLOAD_AV_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır.
  Staging artifact'i üretmek için
  `STAGING_ENVIRONMENT=staging UPLOAD_AV_OUTPUT=artifacts/staging/reports/upload-av.json UPLOAD_AV_SCANNER=clamav UPLOAD_AV_SCANNER_DECISION_MODE=local UPLOAD_AV_APPROVED_BY=... UPLOAD_AV_APPROVAL_REFERENCE=... UPLOAD_AV_SCANNER_NAME=ClamAV UPLOAD_AV_FAIL_CLOSED=true UPLOAD_AV_CLEAN_FILE_ACCEPTED=true UPLOAD_AV_EICAR_REJECTED=true UPLOAD_AV_SCANNER_UNAVAILABLE_REJECTED=true CLAMAV_HOST=clamav CLAMAV_PORT=3310 CLAMAV_TIMEOUT_MS=5000 UPLOAD_AV_UNAVAILABLE_TEST_HOST=... UPLOAD_AV_UNAVAILABLE_TEST_PORT=... pnpm upload-av:generate`
  kullanılır. Generator ClamAV `VERSION` ve `INSTREAM` ile temiz dosya ve EICAR test vektörünü
  gerçekten tarar, unreachable scanner hedefinin fail-closed kırıldığını doğrular, targeted API
  upload scanner/homework/support-ticket testlerini koşar ve ardından `UPLOAD_AV_TARGET=file://... pnpm upload-av:check`
  kapısından geçirir. Remote/staging'de `clamav` compose profili çalışmıyorsa bu komut artifact
  yazmadan kırılır; bu durum `upload-av.json` için doğru blokajdır.
  Generator hedefli API testlerini canlı `DATABASE_URL`/`DIRECT_DATABASE_URL`/`NODE_ENV`/`ADMIN_MFA_MODE`/`PERSISTENCE_DRIVER`/`IDEMPOTENCY_STORE`
  ortamından izole eder; operatör `.env.local` kaynaklasa bile testler live DB'ye bağlanarak
  sahte veya kırılgan upload AV kanıtı üretmemelidir.
  Rapor top-level 7 alanı, `scannerDecision`/`scanResults` blok shape'leri ve iki upload surface
  seti ile boş `gaps` listesi `prod:evidence:templates:check` içindeki fazla alan/surface ve
  invalid/non-empty gaps negatifleriyle korunur.
- Güvenlik denetimi raporunda HTTPS/header, auth kontrolü, production env ve canlı RLS kanıt artifact'leri
  `evidenceReferences` altında yer almalıdır; `example`, `.test`, `redacted`, `localhost`, `__SET` veya
  placeholder değerler yalnız template kontrolünde `SECURITY_AUDIT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
  Rapor top-level 14 alanı, altı security header, dört auth kontrolü ve dört data kontrolü
  `prod:evidence:templates:check` içindeki fazla alan/madde negatifleriyle korunur.
  Artifact üretimi `pnpm security:audit:generate` ile yapılır; komut `prod:env:check`,
  `web:token-storage:check`, `rls:live:check`, `/health`, `/health/ready` ve altı security header
  kontrolü geçmeden `reports/security-audit.json` yazmaz.
- Dosya depolama kanıtı: yeni support ticket ekleri ve homework materyal dosyaları production'da DB
  `contentBase64` yerine S3 `storageKey` ile saklanır; S3 kayıtları `downloadMode=signed-url` ve
  `downloadUrlExpiresInSeconds <= 300` ile indirilir; mevcut inline satırlar okuma uyumluluğu için korunur.
  Inline-base64 taşıma kanıtı `INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE` çıktısındaki `DRY_RUN`
  raporu ve onaylı çalıştırma sonrası `MIGRATED` raporuyla saklanır; release gate bu paketi
  `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET` üzerinden `pnpm inline-upload-content:check` ile doğrular.
  Rapor file hedefi lokal temp path veya symlink file/parent directory üzerinden yazılamaz; target ve
  `evidenceReferences` userinfo/query/fragment, signed URL, raw storage key veya ham upload alanı taşıyamaz.
  Template zinciri inline migration top-level/storage/dry-run/migration/subject/migrated/command
  shape fazlasını reddeder.
- Audit diff'leri ham PII içermez.
- Veri sahibi self-service purge akışı test edilir.

## UAT ve Rollback

- V1 persona yolculukları ve UAT senaryo kimlikleri `docs/product-journeys-v1.md` dosyasında
  izlenir; staging/prod UAT raporu `UAT-SYS-*`, `UAT-KURUM-*`, `UAT-TEACHER-*`, `UAT-STUDENT-*`
  ve `UAT-GUARDIAN-*` senaryolarını referanslar.
- Tenant admin, öğretmen ve veli temel akışları staging'de test edilir.
- Ham import, rapor üretimi, SMS provider, e-posta provider ve Traefik HTTPS smoke'ları çalıştırılır.
- Staging ortamında ilk dış gate'ler tek komutla arşivlenebilir:
  `pnpm staging:first-gates:smoke -- --env-file /path/to/staging-evidence.env --output-dir artifacts/staging/first-gates`
  Traefik HTTPS ve alert webhook smoke artifact'lerini yazar ve ortak smoke evidence
  sözleşmesiyle doğrular. Bu manifest sözleşmesi
  `docs/evidence-templates/staging-first-gates/first-gates-manifest.json` fixture'ı üzerinden
  `pnpm prod:evidence:templates:check` zincirinde de korunur. Output dizini lokal temp path (`/tmp`, `/var/tmp`)
  veya `artifacts/local/**` altında olamaz ve
  yalnız `first-gates-manifest.json`, `traefik-https.json`,
  `alert-webhook.json` dosyalarını içerebilir; beklenmeyen dosya veya
  symlink varsa smoke çalışmadan önce kırılır. Alert webhook smoke komutu URL politikasını
  network isteğinden önce uygular; `http://`, lokal/test host ve userinfo/query/fragment içeren
  webhook URL'leri bearer secret gönderilmeden reddedilir. Tekil smoke komutlarında kullanılan
  `*_SMOKE_EVIDENCE_FILE` çıktıları da provider, HTTP, S3 veya DB yan etkisine başlamadan önce
  doğrulanır; lokal temp path'e veya symlink file/parent directory üzerinden yazılamaz. Üretilen
  manifest ve üç artifact sonradan
  `STAGING_FIRST_GATES_TARGET=file:///path/to/first-gates-manifest.json pnpm staging:first-gates:check`
  ile yeniden doğrulanır; artifact `environment` değerleri manifest `environment` değeriyle eşleşmeli,
  manifest zamanı içerdiği artifact `generatedAt`/`checkedAt`
  zamanlarından önce olamaz. Manifest target'ın kendisi lokal temp path, `artifacts/local/**`,
  symlink dosya veya symlink parent directory üzerinden gelemez. Bu komutlar gerçek staging host ve gerçek webhook
  hedefi olmadan Canlı Durum satırlarını `PASS` yapmaz.
- Full staging evidence artifact seti indirildikten sonra:
  `STAGING_RELEASE_ARTIFACTS_TARGET=/path/to/artifacts/staging pnpm staging:release-artifacts:check`
  komutu `reports/deployment-cutover.json`, diğer `reports/*.json`, first-gates manifest'i, tek
  `release-summary-*.json` dosyası ve `smoke/*.json` ham kanıtlarının, `smoke/report-generation.json`
  dahil, mevcut checker'lardan geçtiğini doğrular. Cutover SHA/repository/tag/zamanı summary ile outbox
  smoke'a bağlanır; verify artifact publish edilmeden dört çalışan servis tag'i yeniden kontrol edilir.
  `release-summary-<tag>.json` dosya adındaki tag summary içindeki
  `reports.deploymentRollback.releaseCandidate` image tag'iyle eşleşmelidir; bundle yalnız beklenen
  root, `reports/`, `smoke/` ve `first-gates/` dosyalarını içerebilir; beklenmeyen raw JSON/log dosyası
  kalırsa kontrol kırılır; bundle symlink içeremez, beklenen artifact'ler symlink olmayan dosya/dizin
  olmalıdır; `STAGING_RELEASE_ARTIFACTS_TARGET` parent-symlink target üzerinden verilemez, hedef
  path'in parent zincirinde symlink varsa veya hedef `/tmp`/`/var/tmp` altında kalıyorsa kontrol kırılır;
  `STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE=1` yalnız `prod:evidence:templates:check`
  altındaki fixture bundle'ında kullanılabilir, gerçek `artifacts/staging` veya remote release
  bundle kapısında kullanılamaz; bundle `.staging-evidence.env`, `.env*` veya GHCR token dosyası içeremez, secret/env dosyası artifact setine karışırsa kontrol kırılır; first-gates manifest'indeki
  `evidenceFile` değerleri manifest dizini altındaki symlink olmayan relative artifact dosya adlarıdır; first-gates smoke ortamları manifest ortamıyla eşleşmeli, manifest zamanı kendi smoke artifact'lerinden önce
  olamaz ve ortak first-gates smoke'ları final raw smoke kanıtlarından daha
  geç tarihli olamaz. First-gates Traefik URL/status/HSTS ve alert webhook URL/status/auth scheme
  değerleri final `summary.smokeEvidence` değerleriyle eşleşmelidir; farklı host/webhook ile alınmış
  erken gate kanıtı aynı release summary'ye terfi edemez.
- UI/UX redesign release kanıtı staging bundle'a
  `UI_UX_REDESIGN_EVIDENCE_OUTPUT=artifacts/staging/reports/ui-ux-redesign.json pnpm ui-ux-redesign:evidence-generate -- --env-file .staging-evidence.env`
  ile üretilir; env dosyasındaki faz, 320/375/414/768/1024/1440 viewport, PII review, UAT,
  live onboarding ve live UI-worker
  referansları gerçek staging/prod artifact'lerine bağlanmalı, local/mock screenshot paketi tek başına
  release kanıtı sayılmaz. Schema v2 her JSON/PNG referansını byte boyutu ve SHA-256 özetiyle
  manifestte sabitler; PNG viewport kanıtında IHDR genişliği bildirilen 320/375/414/768/1024/1440
  değeriyle eşleşir. JSON/text artifact'leri yasak PII alanları ve ham TCKN/e-posta/telefon için
  taranır; raster kanıtı aynı digest'e bağlı `piiReview=PASS` onayını taşır. Uzak referanslar yalnız
  `UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS` allowlist'indeki public HTTPS hostlarından, redirect
  izlenmeden okunur. GitHub run; doğrulanmış `github-ci.json`, exact kaynak SHA,
  `.github/workflows/ci.yml`, repository, run id ve başarılı job listesiyle eşleşmeden PASS olamaz.
  Workflow bu çıktıdan sonra `UI_UX_REDESIGN_EVIDENCE_TARGET=file://.../reports/ui-ux-redesign.json`
  değerini `.staging-evidence.env` dosyasına ekler ve production evidence zinciri aynı bundle artifact'ini okur.
  Aynı workflow, UI/UX tamamlanma ledger'ındaki requirement-level dosya/komut bağlarını başarılı
  GitHub CI artifact'i ve deploy edilen exact kaynak SHA ile `pnpm ui-ux-professionalization:completion:check`
  üzerinden eşleştirir; PR CI'daki contract-only kontrol tek başına release kanıtı değildir.
  Lokal kabul kapısı `pnpm ui-ux-redesign:local-gates`, shared-types/UI build, web typecheck, a11y,
  UX contract, karne görsel kontratı, örnek fixture regresyonu, evidence generator kontratı ve görsel QA
  screenshot zincirini tek komutta koşturur; bu gate staging/prod artifact'in yerini almaz.
  Local örnek içerik guardrail'i `pnpm ui-ux-redesign:example-fixtures`, `ornek-veriler/` altındaki
  iSEM/3D/MUBA TXT + cevap anahtarı ve aktarım şablonlarının mevcut biçimini doğrular; raw dosya
  içeriğini log'a veya release artifact'e taşımaz ve staging/prod evidence yerine geçmez.
- Bundle eksik veya blokluysa aynı kontrol isteğe bağlı
  `STAGING_RELEASE_GAP_REPORT_FILE=artifacts/local/staging-release-gap-report.json` ile
  makine-okunur gap raporu yazabilir. Bu rapor `result=NOT_RELEASE_EVIDENCE`,
  `overallStatus=BLOCKED`, `releaseEvidence=false` ve `canPromote=false` taşır; kontrolün exit
  code'unu yeşile çevirmez, production summary/live-status/pilot/go-live kanıtı yerine geçmez ve
  staging release bundle dizininin içine yazılamaz. Eksik zorunlu artifact'ler
  `missingRequiredFiles[].remediation` altında kapanış komutu, gerçek önkoşul ve güncel blocker
  bilgisinin yanında `ownerAgent`, `phase`, `evidenceGate` ve `nextActionKind` handoff
  metadata'sıyla raporlanır. Aynı rapor `openClosureItems[]` altında first-gates manifest'i
  yokken `first-gates/traefik-https.json` ve `first-gates/alert-webhook.json` alt kanıtlarını da
  ayrı kapanış işi olarak gösterir; böylece zorunlu dosya sayısı ile gerçek kapanış kalemi sayısı
  karışmaz. `release-summary-*.json` henüz yokken bile root, `reports/`,
  `smoke/` ve `first-gates/` altındaki beklenmeyen dosyalar `unexpectedFiles[]` içinde erken
  görünür; diagnostik log/private input dizinleri final bundle'a taşınmadan temizlenmelidir.
  Terminal özeti için
  `corepack pnpm staging:release-gaps:summary -- --artifacts-dir artifacts/staging --gap-report-file artifacts/local/staging-release-gap-report.json`
  kullanılır; çıktı `missingRequiredFiles`, `unexpectedFiles`, `invalidFiles`,
  `mismatchFailures`, `blockedChecks` ve `openClosureItems` sayılarını ayrı basar, beklenmeyen bundle girdilerini
  ayrıca listeler ve bloklu bundle için yine non-zero exit code döndürür. Summary CLI eski
  gap JSON'unu yeniden kullanmaz; alttaki checker'dan yazım onayı almalı ve rapor
  `generatedAt` zamanı komut başlangıcından eski olmamalıdır.
  Remote staging hosttaki bundle gap'i aynı sözleşmeyle görmek için
  `corepack pnpm staging:remote-release-gaps:summary -- --host o-okul-prod --snapshot-dir artifacts/local/remote-staging-snapshot --gap-report-file artifacts/local/remote-staging-gap-report.json`
  kullanılır. Bu komut remote `artifacts/staging` snapshot'ını yalnız `artifacts/local/**`
  altına alır, secret/env dosyası okumaz ve eksik kanıt varsa non-zero dönmeye devam eder.
  UI/UX redesign kapanışı için `corepack pnpm ui-ux-redesign:release-readiness:summary -- --repo
  4rmus/o-okul --environment staging --summary-file artifacts/local/ui-ux-redesign-release-readiness-summary.json
  --github-gap-report-file artifacts/local/staging-github-env-gap-report.json --remote-snapshot-dir
  artifacts/local/remote-staging-snapshot --remote-gap-report-file artifacts/local/remote-staging-gap-report.json`
  GitHub env gap'i ve remote bundle gap'ini tek `releaseEvidence=false` handoff dosyasında birleştirir;
  PASS veya production evidence summary yerine geçmez. Remote package `ui-ux-redesign:evidence-generate`
  script'ini içermiyorsa `remote_code_deploy` aksiyonu, `reports/ui-ux-redesign.json` üretiminden önce
  görünür. `corepack pnpm ui-ux-redesign:release-readiness:check -- --target
  artifacts/local/ui-ux-redesign-release-readiness-summary.json --max-age-minutes 30 --require-ready`
  summary içindeki GitHub env gap ve remote bundle gap raporlarıyla tarih/sonuç tutarlılığını kontrol eder.
  Gerçek deploy/release öncesinde secret, dirty workspace, stale summary, remote script ve artifact
  blokajlarının kapandığını doğrulamalıdır.
  Beklenmeyen girdiler teşhis/log/çalışma diziniyse silinmeden bundle dışına alınır:
  `corepack pnpm staging:release-artifacts:archive-unexpected -- --artifacts-dir artifacts/staging --gap-report-file artifacts/local/staging-release-gap-report.json --archive-dir artifacts/local/staging-release-unexpected-<tag> --apply`.
  Komut önce gap raporunu taze üretir, yalnız `unexpectedFiles[]` girdilerini arşivler,
  `manifest.json` yazar ve varsayılan olarak dry-run çalışır; `--apply` olmadan dosya taşımaz.
- `pnpm staging:evidence-env:check`, normal deploy'da GitHub CI artifact üretimi/download, activation env
  decode/check, metadata append, first-gates, cutover, cleanup ve upload sırasını; verify-only workflow'unda
  ise full env, production evidence ve release bundle kontrol sırasını statik olarak korur.
- Staging/prod UAT raporu `pnpm uat:check` ile doğrulanır. Staging artifact'i
  `STAGING_ENVIRONMENT=staging UAT_OUTPUT=artifacts/staging/reports/uat.json UAT_TESTER=... UAT_RELEASE_CANDIDATE=... UAT_ROLLBACK_IMAGE_TAG=... UAT_RESTORE_BACKUP_REFERENCE=s3://... UAT_COMMAND_EVIDENCE_TARGET=file:///.../uat-command-evidence.json UAT_SCENARIOS_TARGET=file:///.../uat-scenarios.json pnpm uat:generate`
  ile üretilir; generator gerçek komut kanıtı ve 21 senaryoluk UAT kaynak artifact'i olmadan JSON yazmaz.
  `UAT_OUTPUT`, `UAT_COMMAND_EVIDENCE_TARGET` ve `UAT_SCENARIOS_TARGET` lokal temp path,
  `artifacts/local/**` veya symlink file/parent üzerinden gelemez.
- Gerçek UAT raporunda `checkedAt` gelecekte olamaz; `tester`, `rollbackImageTag`,
  `restoreBackupReference` ve her
  `journeyScenariosVerified[].evidence` maddesi gerçek release/artifact/run/log referansı olmalıdır.
  Evidence maddeleri serbest açıklama yerine `artifact:`, `run:`, `log:`, `url:`, `https://`,
  `file://` veya `s3://` ile başlayan kalıcı referans taşır; `UAT_EVIDENCE_TARGET`,
  `restoreBackupReference` ve scenario evidence referansları userinfo, query token veya fragment
  taşıyamaz. `artifact:` evidence referansları repo içi relative, mevcut ve symlink olmayan dosyaya
  bağlanmalı; `../`, mutlak path, temp path veya `artifacts/local/**` UAT release kanıtı değildir.
  UAT raporu top-level alan kümesi, `flowsVerified` ve `commandsPassed` tam setleri, 21 V1 journey
  scenario seti ve her scenario item shape'i `prod:evidence:templates:check` içindeki fazla
  alan/komut/senaryo negatifleriyle korunur.
  `releaseCandidate` ile `rollbackImageTag` aynı tag olamaz. `previous-pass`, `backup-bucket`, `qa-owner`,
  `example`, `.test`, `redacted`, `localhost`, `__SET` veya şablondaki açıklama cümleleri yalnız template
  kontrolünde `UAT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
- Kurum açılışı ve ilk admin kurulum zinciri staging'de `pnpm live:onboarding:smoke` ile doğrulanır;
  komut `NEXT_E2E_LIVE_ONBOARDING=1`, `LIVE_ONBOARDING_EVIDENCE_PATH`, bearer korumalı
  `LIVE_ONBOARDING_EMAIL_EVIDENCE_ENDPOINT` ve `LIVE_ONBOARDING_EMAIL_EVIDENCE_BEARER_TOKEN` gerektirir.
  `pnpm live:onboarding:evidence-contract` bu preflight'ı tarayıcı açmadan doğrular; gerçek smoke
  başlamadan önce evidence JSON'unun exact system admin/first admin/tenant/onboarding shape'i,
  `generatedAt` değerinin 24 saatten eski olmadığı, placeholder/test değer taşımadığı, sistem admin ile ilk admin e-postalarının ayrık olduğu ve
  dosyanın lokal temp path, symlink dosya veya symlink parent zinciri altında olmadığı kontrol edilir.
  İlk yönetici aktivasyon URL'si gerçek inbox evidence endpoint'inden poll edilir; URL/token evidence artifact'ına yazılmaz.
  Evidence poll'u alıcı e-postasını URL/loglara taşımayan bearer-korumalı JSON POST kullanır. Notification
  gateway yalnız `@staging.o-okul.com` hesap aktivasyonlarını Email Sending kabulünden sonra alıcı HMAC'i
  altında 15 dakika saklar; diğer alıcılar ve normal parola sıfırlamaları bu geçici kayda girmez.
- Tam sınav döngüsü staging/prod kanıtı `LIVE_EXAM_CYCLE_TARGET` ile `pnpm live:exam-cycle:check`
  üzerinden doğrulanır; iSEM cevap anahtarı, optik pipeline, raw import, report-generation ve
  mock'suz UI-worker/portal kanıtları aynı release candidate'a bağlanır. Rapor top-level 11
  alanı, `examCycle` 27 alanı, 5 komutluk `commandsPassed` seti, kalıcı artifact/run/log/url
  `evidenceReferences` maddeleri, zorunlu iSEM optical pipeline ve live-ui-worker referansları
  ve boş `gaps` listesi `prod:evidence:templates:check` içindeki
  fazla alan/komut, zayıf evidence reference ve invalid/non-empty gaps negatifleriyle korunur.
  Bu referanslar `isem-optical-pipeline.json`/`.log` ve `live-ui-worker-result.json`/`live-ui-worker-report.json`
  artifact adlarına bağlanmalı; aynı kelimeleri taşıyan alakasız marker dosyaları veya `artifacts/local/**`
  local smoke çıktısı kalıcı staging/prod kanıtı gibi gösterilemez.
  Aynı kontrol iSEM LGS fixture'ı için 90 soru, 21 katılımcı, 21 eşleşme, 0 quarantine,
  21 sınav sonucu ve 21 rapor sonucunu exact sayıyla ister; `fileName`, `rawRow`,
  `contentBase64`, `fileBase64`, ham `ornek-veriler/iSEM .txt` yolu, TCKN-benzeri 11 haneli
  değer, ham e-posta veya telefon evidence JSON'unda yer alamaz.
- iSEM optik pipeline kanıtı `ISEM_OPTICAL_PIPELINE_TARGET` ile
  `pnpm isem-optical-pipeline:evidence-check` üzerinden doğrulanır ve birleşik
  `pnpm prod:evidence:check` zincirinde zorunlu release raporu olarak okunur. Bu kanıt gerçek iSEM TXT,
  cevap anahtarı, raw import arşivi, evaluation, `ReportSnapshot READY` ve örnek skorları kapsar;
  PDF/Excel indirme ve öğrenci/veli portal görünümü doğrulanmadan tam sınav döngüsü PASS sayılmaz.
  Local smoke çıktısı olan `artifacts/local/**` hedefleri staging/prod kanıtı olarak kabul edilmez.
  Production summary içindeki `reports.liveExamCycle.examCycle` count/version alanları
  `reports.isemOpticalPipeline` ile çapraz eşleşir; iki ayrı PASS artifact'i farklı iSEM sayıları
  veya parser/answer-key versiyonu taşıyamaz.
  Aynı smoke `ISEM_OPTICAL_PIPELINE_UI_WORKER_EVIDENCE_FILE` verildiğinde private
  `LIVE_UI_WORKER_EVIDENCE_PATH` girdisini de yazar; bu dosya gerçek credential içerdiği için
  kalıcı/public kanıt değil yalnız private runtime input'tur, path zincirinde `private` segmenti
  ve 0600 dosya izni ister; release bundle/production summary içine alınmaz. Gerçek staging koşusunda
  `ISEM_OPTICAL_PIPELINE_SMOKE_EMAIL_DOMAIN` `.test` veya `example` içermeyen kurum kontrollü bir
  domain olmalıdır.
- `prod:evidence:check --summary-file` çıktısı `reports/isem-optical-pipeline.json` dosyasını
  üretir; `pnpm staging:release-artifacts:check` bu dosyayı bundle içinde zorunlu tutar ve
  summary ile ham raporun birebir uyumunu denetler.
- Worker tarafından üretilen rapor staging'de `pnpm live:ui-worker:smoke` ile kurum UI'da açılır,
  Excel/PDF dışa aktarılır ve kanıt dosyasında portal credential'ı varsa öğrenci/veli portalında görüntülenir.
  Smoke komutu tarayıcı açmadan önce `NEXT_E2E_LIVE_UI_WORKER=1`, gerçek `https://`
  `NEXT_E2E_BASE_URL`, `NEXT_E2E_SKIP_WEB_SERVER=1` ve gerçek `LIVE_UI_WORKER_EVIDENCE_PATH`
  ister; IP/self-signed staging hedeflerinde `NEXT_E2E_IGNORE_HTTPS_ERRORS=1` yalnız Playwright
  TLS toleransı için kullanılır. Opsiyonel `LIVE_UI_WORKER_RESULT_EVIDENCE_FILE` ise secret
  içermeyen Excel/PDF/portal sonucunu kalıcı artifact olarak yazar. Bu result artifact
  `LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET=file:///... pnpm live:ui-worker:result-check` ile
  doğrulanır; `reportStatus=READY`, `xlsx/pdf` indirme, öğrenci/veli portal görünümü, hashli
  sınav/öğrenci referansları ve boş `gaps` zorunludur. Result artifact `artifacts/local/**`
  altında staging/prod kanıtı olarak kabul edilmez. `prod:evidence:check --summary-file` bu
  target'ı `reports.liveUiWorkerResult` olarak üretir; production summary ve go-live linked
  summary bu rapor olmadan PASS alamaz. Staging evidence secret bu target'ı taşır,
  ham e-posta, parola veya
  öğrenci id'si taşımaz; result yazılacaksa smoke preflight `STAGING_ENVIRONMENT` ya da `NODE_ENV`
  değerinin `staging/production` olmasını ister. `pnpm live:ui-worker:evidence-contract` bu preflight
  ve result negatiflerini lokal CI'da doğrular. Evidence JSON'u exact rapor admin credential, `examId`, `firstStudentId` ve opsiyonel
  öğrenci/veli portal credential shape'i taşır; path zincirinde `private` segmenti, 0600 dosya izni,
  24 saatten eski olmayan `generatedAt`, placeholder/test olmayan değerler, lokal temp path dışı ve symlink olmayan dosya/parent zinciri zorunludur.
  Result artifact `generatedAt` değeri de 24 saatten eskiyse canlı kanıt olarak reddedilir.
  Result artifact tam sınav döngüsündeki mock'suz
  UI-worker/portal kanıtı için referans verilebilir.
- Rollback hedefi son başarılı image tag'i ve restore edilebilir backup olarak yazılır.

## Canlı Durum

Bu bölüm `pnpm live:status:generate` ve `pnpm live:status:check` ile korunur. Harici satırlar gerçek
kanıt olmadan `PASS` yapılamaz; bir satır `PASS` durumuna alınacaksa `LIVE_STATUS_EVIDENCE_TARGET`
ilgili komut, source ve gerçek evidence referansını taşıyan bundle'a bağlanmalıdır.
`STAGING_PASS_WITH_FINAL_CHAIN_PENDING`, kalıcı staging artifact'inin checker'dan geçtiğini ama
production summary/live-status/pilot/go-live zincirine henüz bağlanmadığını gösterir; final Canlı
Durum PASS değildir.
`pnpm live:status:generate`, production summary, pilot ve go-live JSON'larından bu bundle'ı üretir.
Üretici kaynak summary ve pilot JSON'larını kendi kanıt checker'larıyla doğrulamadan bundle yazmaz;
çıktı yazıldıktan sonra go-live checker'ı da bağlı live-status zinciriyle yeniden çalıştırılır.
Timestamp, `--generated-at` verilmezse go-live raporundaki `liveStatusEvidence.generatedAt`,
yoksa `checkedAt` değerinden devralınır.
Normal production çalışmasında üretici `--output` hedefinin go-live raporundaki
`liveStatusEvidence.evidenceTarget` ile aynı artifact'e çözüldüğünü de doğrular.
Bundle sözleşmesi `docs/evidence-templates/live-status.example.json` ve
`docs/evidence-templates/live-status-pass-readiness.example.md` fixture'ı ile
`pnpm prod:evidence:templates:check` zincirinde korunur; bundle top-level alanları ve her gate
item alan seti tam ve beklenmeyen alansız olmalı, 17 gate satırı tam ve tekrarsız taşınmalı,
her gate `command` ve `source` değeri kanonik listeyle eşleşmeli, `checkedAt` geçerli tarih olmalı,
`evidenceReference` ilgili source artifact referansından türemeli, `checkedAt` ilgili
smoke/report/pilot/go-live kaynak tarihinden türemeli ve bundle `generatedAt` sonrasına düşmemelidir.
`pnpm live:status:check` bundle içindeki `productionEvidenceSummaryTarget`, `goLiveEvidenceTarget` ve
`pilotEvidenceTarget` kaynaklarını okuyarak gate `checkedAt` ve `evidenceReference` değerlerinin
source artifact ile eşleştiğini doğrular; kaynak nesnede `result` varsa `PASS`, `environment`
varsa `production` olmalıdır. Go-live checker bu hedeflerin aynı artifact setindeki go-live
summary/pilot hedeflerine çözüldüğünü ayrıca doğrular.
Live-status source ve output hedefleri yalnız kalıcı, symlink olmayan `file://` artifact veya
`https://` URL olabilir; `http://`, lokal temp path, symlink artifact ve symlink parent directory
hedefleri üretici, checker ve go-live linked checker tarafından reddedilir.
Template zinciri duplicate gate, live-status top-level/gate item shape fazlası, NOT_RUN
command/source/checkedAt/evidenceReference sapması, geç veya kaynakla eşleşmeyen `checkedAt`, kaynakla eşleşmeyen
`evidenceReference`, `FAIL`/staging source sapması, UAT top-level/komut/journey
shape fazlası, live-exam-cycle top-level/examCycle/command/gaps shape fazlası,
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
pilot top-level/nested/assessment/gaps shape fazlası, deployment rollback top-level/servis/komut/gaps
shape, kronoloji fazlası ve release=rollback sapması, external monitoring outage chronology/latency, production summary smoke environment, Traefik URL origin, external monitoring URL origin, live exam cycle release/app/API ve UAT release/rollback/restore eşleşme sapmaları, go-live `gatesPassed` fazlası
ve live-status source-date/evidenceReference sapmaları, bağlı live-status duplicate gate/top-level/gate item shape fazlası, target, source-date ve evidenceReference sapmaları, production summary
top-level/check-list/check-field/smoke/report/report-field fazlası, check status/script/duplicate sapmaları ve smoke/report tarih negatifleri, go-live top-level/production-summary/
deployment/approval shape fazlası, go-live `checksPassed` fazlası, bağlı summary duplicate check,
go-live karar kronolojisi negatifleri, bağlı summary top-level/check-field fazlası ve bağlı summary smoke/report/report-field fazlası ile kırık
summary/pilot/go-live kaynak ve go-live linked pilot gaps negatif fixture'larını da kırmızıya düşürür.

- Repo gate: `PASS`
- Yerel geliştirme canlı smoke: `PASS` (2026-05-31; `pnpm live:smoke`)
- Kurum release kanıt ekranı: `PASS` (2026-06-02; web typecheck ve hedefli Playwright kurum smoke)
- Traefik HTTPS smoke: `NOT_RUN`
- Live exam cycle kanıtı: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`
- iSEM optical pipeline kanıtı: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`
- Live UI-worker result kanıtı: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`
- KVKK inventory kanıtı: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`
- RLS live kanıtı: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`
- Inline upload migration kanıtı: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`
- Audit null tenant kanıtı: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`
- Rate limit Redis kanıtı: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`
- SMS disabled path kanıtı: `NOT_RUN`
- Notification provider kanıtı: `NOT_RUN`
- Report generation perf kanıtı: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`
- Staging/prod UAT: `NOT_RUN`
- Deployment rollback tatbikatı: `NOT_RUN`
- Pilot kapanış kanıtı: `NOT_RUN`
- Go-live karar paketi: `NOT_RUN`
- Alert bildirim kanalı: `NOT_RUN`
