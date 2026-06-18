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
pnpm financial-retention:check
pnpm upload-av:check
pnpm inline-upload-content:check
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
pnpm live:exam-cycle:check
pnpm live:ui-worker:smoke
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
- `ADMIN_MFA_MODE=optional|required` ayarlanır; `ADMIN_MFA_SECRET_ENCRYPTION_KEY`,
  `ADMIN_MFA_RECOVERY_HASH_KEY` ve `ADMIN_MFA_CHALLENGE_SECRET` gerçek, farklı secret değerlerdir.
- `AI_REPORT_SUMMARY_PROVIDER=disabled` ayarlanır; bu release'te dış LLM provider veya template
  karne yorumu production env kontrolünden geçmez. Disabled provider kanıtı
  `AI_REPORT_SUMMARY_EVIDENCE_TARGET` ile doğrulanır.
- `pnpm prod:env:check` gerçek staging/prod env değerlerinde geçer.
- Production kanıt zinciri `pnpm prod:evidence:check` ile tek komutta geçer.
- Gerçek staging/prod env dosyalarında `*_ALLOW_EXAMPLE_EVIDENCE=1` bayrakları bulunmaz;
  `pnpm prod:env:check` bu bypass bayraklarını production evidence için reddeder.
- Gerçek staging/prod evidence target env değerleri yalnız `file://` artifact yolu veya `https://`
  URL olabilir; `http://`, placeholder/example/test host ve lokal temp `file://` path'leri
  `pnpm prod:env:check` tarafından reddedilir. Birleşik `pnpm prod:evidence:check` kapısı da
  evidence target protokolünü, gerçek https host'unu ve temp/symlink-parent olmayan `file://`
  artifact path'ini erken doğrular; `http://` veya placeholder/temp/symlink target'a ağ/dosya
  okuma denemesi yapmaz.
  `pnpm prod:evidence:templates:check` tüm standalone evidence checker target'larının da
  `http://` protokolünü, placeholder/test `https://` host'larını, lokal temp `file://`
  path'lerini ve symlink file artifact'lerini reddettiğini negatif testle korur.
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
- Summary yazımı smoke kanıtlarında `result=PASS`, beklenen `check` adı, `environment=production`,
  gelecekte olmayan `generatedAt` ve her smoke tipine özgü alanları doğrular: Traefik smoke URL origin'i
  summary `webUrl` origin'iyle eşleşmeli; external monitoring monitor URL origin'leri de summary
  `webUrl` origin'inden sapmamalı; Traefik/Sentry/alert HTTPS URL ve 2xx/HSTS,
  SMS/notification gerçek provider, WAL `target` ve sha256 marker.
  Bu payload sözleşmesi `pnpm smoke:evidence:check` ve `pnpm prod:evidence:templates:check`
  zincirinde örnek summary üstünden korunur.
- Staging deploy GitHub Actions'ta yalnız elle tetiklenen `.github/workflows/staging-deploy.yml`
  workflow'u ile yapılır; workflow önce dispatch input'larını, staging secret/var varlığını ve Docker tag
  biçimini doğrular, aynı commit'in başarılı `.github/workflows/ci.yml` run'ından GitHub CI evidence artifact'ini
  deploy öncesi üretip doğrular, ardından `pnpm run ci` sonrası web/api/worker imajlarını GHCR'a push eder,
  staging VPS'te `docker-compose.release.yml` override'ı ile imajları çeker, migration çalıştırır,
  Traefik'li stack'i ayağa kaldırır ve `prod:evidence:check --summary-file` çıktısını artifact olarak saklar.
- Staging production evidence secret sözleşmesi `docs/evidence-templates/staging-evidence.env.example`
  ve `pnpm staging:evidence-env:check` ile deploy başlamadan önce decode edilip doğrulanır; zorunlu
  env anahtarları eksik veya boş değerli olamaz ve decode edilen `.staging-evidence.env` dosyası
  preflight exit trap'i ile, evidence job'da da `if: always()` cleanup adımıyla silinir. Workflow `SENTRY_RELEASE`,
  `ROLLBACK_IMAGE_TAG` ve deploy öncesi üretilip `actions/download-artifact@v4` ile evidence job'una indirilen
  `GITHUB_CI_EVIDENCE_TARGET` değerlerini sonradan ekler, smoke evidence dosyalarını `--summary-file`
  altındaki `smoke/` klasöründe toplar. Secret env dosyası `TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE`
  benzeri raw smoke path'lerini ve `REPORT_GENERATION_SMOKE_EVIDENCE_FILE` değerini içeremez;
  bunlar summary hedefinden türeyen `artifacts/staging/smoke/*.json` dosyalarıdır.
- Production kanıt şablonları `pnpm prod:evidence:templates:check` ile repo içinde doğrulanır.
- KVKK, kimlik göçü, finansal saklama, upload AV, deployment region, observability UAT ve security
  audit gerçek kanıtlarında `checkedAt` gelecekte olamaz.
- Admin MFA raporu `ADMIN_MFA_EVIDENCE_TARGET` ile doğrulanır; SYSTEM_ADMIN/TENANT_ADMIN
  hesaplarında password-only login auth session üretmez, TOTP ve recovery code reuse reddedilir.
- AI karne özeti raporu `AI_REPORT_SUMMARY_EVIDENCE_TARGET` ile doğrulanır; bu release'te
  `provider.mode=disabled`, yorum üretimi kapalı ve dış provider çağrısı yapılmamış olmalıdır.
  Rapor top-level 11 alanı, `provider`/`kvkk`/`externalAiStopRule`/`generation`/`validation`
  blok shape'leri, KVKK alan setleri, üç komutluk `commandsPassed` seti ve boş `gaps` listesi
  `prod:evidence:templates:check` içindeki fazla alan/komut ve invalid/non-empty gaps negatifleriyle korunur.
- Bozuk imajdan geri dönüş tatbikatı `DEPLOYMENT_ROLLBACK_TARGET` ve
  `pnpm deployment:rollback:check` ile ayrı kanıt raporu olarak doğrulanır; UAT içindeki
  `rollbackImageTag` yalnız release adayı referansıdır. Gerçek deployment region/rollback
  kanıtlarında `example`, `.test`, `localhost`, `__SET` veya placeholder provider/image/artifact
  referansı kabul edilmez; rollback raporunda `checkedAt`, `drillStartedAt` ve `drillCompletedAt`
  gelecekte olamaz, `drillStartedAt <= drillCompletedAt <= checkedAt` sırası korunmalıdır.
  `releaseCandidate` ile `rollbackImageTag` aynı tag olamaz. Rollback raporu top-level alan kümesi, üç servislik `servicesVerified` seti,
  dört komutluk `commandsPassed` seti ve boş `gaps` listesi
  `prod:evidence:templates:check` içindeki fazla alan/servis/komut, ters kronoloji ve invalid/non-empty gaps negatifleriyle
  korunur. Bu gevşetme yalnız template kontrolünde özel izin bayraklarıyla açılır.
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
  tek JSON'da toplar. `schema.tablesVerified` schema'dan türeyen 54 tenant tablosunu,
  `isolation.crossTenantReadRows=0` çapraz-tenant okuma sonucunu, `withCheckRejects` yanlış
  tenant yazım/referans negatiflerini ve `loadSmoke.actualRps >= targetRps >= 200` sonucunu
  kanıtlamalıdır. `pnpm rls:load:smoke`, `RLS_LOAD_SMOKE_EVIDENCE_FILE` verildiğinde
  `rls-load-smoke.json` artifact'i üretir; `pnpm rls:live:check` bu artifact referansını
  `evidenceReferences` içinde zorunlu tutar. Load smoke artifact'i `checkedAt`, hash'li tenant referansları,
  tam `commandsPassed=["pnpm rls:load:smoke"]` ve boş `gaps` listesi taşır; ham tenant/student id
  alanları ortak smoke evidence sözleşmesinde reddedilir. Gerçek kanıtta tenant hash ve artifact referansları `redacted`, `example`,
  `.test`, `localhost`, `__SET` veya placeholder değer içeremez; bu gevşetme yalnız template
  kontrolünde `RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır. RLS live raporu top-level 9 alanı,
  `schema`/`isolation`/`loadSmoke` blok shape'leri, 54 tabloluk `tablesVerified` exact seti,
  `withCheckRejects` negatif seti, tam `commandsPassed` seti ve boş `gaps` listesi
  `prod:evidence:templates:check` içindeki fazla alan/tablo/komut ve invalid/non-empty gaps negatifleriyle korunur.
- Go-live karar paketi `GO_LIVE_EVIDENCE_TARGET` ve `pnpm go-live:check` ile doğrulanır; bu
  rapor production evidence summary, GitHub Actions remote CI, staging/prod UAT, bağlı pilot kapanış JSON'u,
  bağlı Canlı Durum PASS bundle'ı, KVKK/DPA, rollback, backup/restore, canlı RLS, alert/observability,
  operasyon sahipliği, cutover planı ve imzalı onayları tek final kanıt paketinde toplar.
  Go-live top-level alanları, `productionEvidenceSummary`, `liveStatusEvidence`, `deployment`, `uat`,
  `pilot`, `legal`, `operations`, `cutover`, `approvals` ve `openRisks` bloklarının anahtar setleri
  tam ve beklenmeyen alansız olmalıdır; approval rolleri product/technical/operations/dataProtection
  olarak tam ve tekrarsız taşınır.
  `liveStatusEvidence.evidenceTarget` bağlı `live-status` JSON'unu gösterir ve bu JSON'daki sekiz
  dış Canlı Durum satırının `PASS`, beklenen komut/source değerleriyle kanıtlı ve
  production summary, pilot ve go-live artifact hedefleriyle aynı dosyalara bağlı olduğunu doğrular.
  `productionEvidenceSummary.summaryTarget` bağlı
  `prod:evidence:check --summary-file` JSON'unu gösterir ve `pnpm go-live:check` bu summary içindeki
  zorunlu kanıt adımlarını tam ve tekrarsız check listesi olarak, her adımın beklenen script path'ini ayrıca okur; bağlı
  summary top-level alanları, check item `label/script/status` şekli, `smokeEvidence`, `reports`
  ve her gömülü report blok anahtar seti de tam ve beklenmeyen alansız olmalıdır.
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
  veya artifact referanslarını kabul etmez; linked summary deployment region `evidenceReference`,
  deployment rollback `commandsPassed`, servis image/evidence referansları ve `evidenceReferences`
  alanlarını, GitHub CI `runUrl`, `commitSha`, `workflowUsesSingleCiCommand` ve `githubCiPassed`
  değerlerini, RLS live `schema.tablesVerified`, `crossTenantReadRows`, `withCheckRejects`,
  `loadSmoke.actualRps` ve `rlsLivePassed` değerlerini, restore drill `sourceBackup`/`targetDatabase`,
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
  listesi ortak smoke evidence sözleşmesiyle korunur. `pnpm report-generation:perf`
  10k sonuç için `generationDurationMs <= 60000` eşiğini artifact içinde kanıtlamalıdır.
  Bu komut staging deploy zincirine dahil değildir; Faz 10 kapanışında çalıştırılır.
- Kurum `/kurum/canli-yayin` ekranı production kanıt zincirini, release özet alanlarını ve dış ortam
  kanıt gereksinimlerini ops görünümünde listeler.
- TR datacenter/provider kanıtı `pnpm deployment:region:check` ile doğrulanır.
  Rapor top-level alan kümesi ve `api`, `worker`, `postgres`, `redis`, `object-storage` tam servis
  seti ile boş `gaps` listesi `prod:evidence:templates:check` içindeki fazla alan/servis ve
  invalid/non-empty gaps negatifleriyle korunur.
- Netgsm secret'ları repoya yazılmaz.
- `SMS_PROVIDER=netgsm` ise `SMS_ALLOW_NOOP_IN_PRODUCTION=false` kalır.
- Gerçek staging/prod release env içinde `NETGSM_USERCODE`, `NETGSM_PASSWORD` ve
  `NETGSM_MSG_HEADER` boş veya placeholder/example/test değer olamaz; `pnpm prod:env:check`
  bu credential alanlarını release öncesi reddeder.
- Netgsm test/canlı credential doğrulaması `SMS_SMOKE_TO`, `SMS_SMOKE_BODY` ve
  `SMS_SMOKE_CONFIRM=send` içeren gerçek release env ile `pnpm sms:smoke` ve production kanıt
  zincirindeki SMS provider adımıyla yapılır.
- SMS provider smoke kanıtı `SMS_PROVIDER_SMOKE_EVIDENCE_FILE` ile masked recipient, provider,
  `segments` ve `providerMessageId` sonucu olarak yazılır; artifact exact top-level alan seti,
  `checkedAt`, tek `commandsPassed=["pnpm sms:smoke"]` ve boş `gaps` listesi taşır.
- E-posta/push provider production'da `NOTIFICATION_PROVIDER=http` ile çalışır; HTTPS endpoint,
  Bearer token, `NOTIFICATION_SMOKE_SUBJECT`, `NOTIFICATION_SMOKE_BODY` ve
  `pnpm notification:smoke` sonucu kanıt zincirinde zorunludur.
- Notification provider smoke kanıtı `NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE` ile masked
  recipient ve kanal listesi olarak yazılır; artifact `checkedAt`, tek
  `commandsPassed=["pnpm notification:smoke"]` ve boş `gaps` listesi taşır.
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
- S3 `storageKey` kayıtlarında indirme API'si dosyayı base64 proxy etmez; support ticket ekleri ve
  homework materyal dosyaları en fazla 5 dakika geçerli imzalı GET URL'si döndürür.
- Yeni S3 kayıtlarında DB `contentBase64` kolonu `NULL` kalır; mevcut inline satırlar için
  `pnpm inline-upload-content:audit` tablo boyutu ve taşıma sayımı üretir, gerçek taşıma yalnız
  `INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true pnpm inline-upload-content:migrate` ile yapılır.
- Inline-base64 taşıma kanıtı `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET` ve
  `pnpm inline-upload-content:check` ile doğrulanır: dry-run raporu, onaylı migrate raporu,
  `pendingRows=0`, S3 `storageKey`, `downloadMode=signed-url` ve `downloadUrlExpiresInSeconds <= 300`
  aynı release kanıtında bulunmalıdır. Rapor top-level 9 alanı, `storageMode`/`dryRun`/`migration`
  blok shape'leri, iki subject item seti, migrated item seti, tam `commandsPassed` seti ve boş
  `gaps` listesi `prod:evidence:templates:check` içindeki fazla alan/komut ve invalid/non-empty gaps
  negatifleriyle korunur.
  `INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE` lokal temp path altında, symlink file üzerinde veya
  symlink parent directory altında olamaz; script bu hedefleri DB bağlantısından önce reddeder.
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
  hariç kaldığını, login brute-force kilidinin `LOGIN_LOCKED` 429 ile email+IP boyutunda Redis'te
  instance'lar arasında paylaşıldığını ve farklı IP'nin kilitlenmediğini kanıtlar. Smoke artifact'i
  ham IP/e-posta yerine SHA-256 hash taşır; `checkedAt`, tam `commandsPassed=["pnpm rate-limit:smoke",
  "pnpm rate-limit:check"]` ve boş `gaps` listesi ortak smoke evidence sözleşmesiyle korunur.
  Rate-limit raporu top-level 10 alanı, `config`/`instances[]`/`apiRateLimit`/
  `loginAttemptLimiter` blok shape'leri, iki instance, tam `commandsPassed` seti, boş `gaps`
  listesi ve `/health` + `/metrics` excluded path seti `prod:evidence:templates:check` içindeki
  fazla alan/path/komut ve invalid/non-empty gaps negatifleriyle korunur.
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
- Güvenlik denetimi raporu `pnpm security:audit:check` ile doğrulanır.

## TLS ve Network

- Traefik TLS termination aktiftir.
- Traefik v3.7.5 ACME/entrypoint/Docker label compose config'i
  `docker compose -f docker-compose.yml -f docker-compose.traefik.yml config` ile geçer.
- Traefik edge kuralı port 80 isteklerini kalıcı olarak `websecure` HTTPS entrypoint'ine yönlendirir;
  HTTP-01 challenge `web` entrypoint'i üzerinde kalır.
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
- `DOMAIN` ve `ACME_EMAIL` gerçek staging/prod değerleridir.
- Domain alınana kadar bu single-node cihazda `docker-compose.traefik-ip.yml` kullanılır:
  `SERVER_DOMAIN=<sunucu-public-ip>` ile web ve API aynı IP origin'i üstünden self-signed TLS ile
  servis edilir. Bu mod `TRAEFIK_HTTPS_SMOKE_ALLOW_INSECURE_TLS=true` ile staging/pilot kanıtı üretir;
  ACME yerine geçmez ve prod go-live için gerçek domain/sertifika kanıtı ister.
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
- WAL archive hedefi `pnpm wal:archive:smoke` ile yaz/oku/sil olarak doğrulanır.
- Staging kanıt dosyası için `WAL_ARCHIVE_SMOKE_EVIDENCE_FILE=artifacts/staging/wal-archive.json`
  verilir; dosya hedef protokolünü, marker hash'ini, `checkedAt`, tek
  `commandsPassed=["pnpm wal:archive:smoke"]` ve boş `gaps` listesini secret içermeden yazar.
- Production env kontrolü `WAL_ARCHIVE_TARGET` için `s3://bucket/prefix`
  veya mount edilmiş `file://` hedefi ister; placeholder/test hedefleri reddedilir.
  Tekil smoke üreticileri `file://` hedefte root, lokal temp path veya symlink dizin/parent path
  kabul etmez; mount hedefi kalıcı, symlink olmayan dizin olmalıdır.
- Günlük base backup lokal kalıcı backup path'ine, WAL arşivi ayrı kalıcı hedefe gider.
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
- `/metrics` içinde `uzman_hocam_queue_jobs{queue,status}` ve
  `uzman_hocam_queue_metrics_scrape_error` metrikleri görünür.
- Grafana Alloy Docker container loglarını Loki'ye yollar.
- API `pino-http` JSON loglarında `requestId`, `tenantId`, `userId`, `httpRequest.path`,
  `httpResponse.statusCode` ve `durationMs` alanları görünür; request body, query string,
  authorization/cookie header'ları ve PII loglanmaz.
- Worker pino JSON loglarında `worker_job_completed` ve `worker_job_failed` event'leri
  `queueName`, `jobId`, `tenantId`, `userId` ve `durationMs` alanlarıyla görünür.
- BullMQ operasyon paneli `queue-board` servisi olarak yalnız `backend_net` içinde çalışır; host portu
  `127.0.0.1:${QUEUE_BOARD_HOST_PORT:-3200}` ile loopback'e bağlıdır, Traefik router'ı yoktur ve
  erişim `QUEUE_BOARD_BASIC_AUTH_USER`/`QUEUE_BOARD_BASIC_AUTH_PASSWORD` ile korunur.
- `LOG_LEVEL=info`, `LOG_ENABLED=true`, `QUEUE_METRICS_ENABLED=true`,
  `API_RATE_LIMIT_ENABLED=true`, `API_RATE_LIMIT_STORE=redis`, `IDEMPOTENCY_STORE=postgres`,
  `REPORT_PDF_RENDERER=worker` ve `SENTRY_SEND_DEFAULT_PII=false` production env içinde sabittir.
- Grafana API overview dashboard'u metrik ve Docker log panelleriyle açılır.
- Loki veya seçilen production log shipping hedefi API/worker loglarını alır; tek `requestId`
  ile API logları filtrelenebilir.
- Alert bildirim kanalı staging'de `ALERT_WEBHOOK_TOKEN` bearer secret'ı ile `pnpm alert:webhook:smoke`
  çalıştırılarak test edilir.
- Staging kanıt dosyası için `ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE=artifacts/staging/alert-webhook.json`
  verilir; dosya webhook URL'ini credential olmadan, HTTP status'ü, `authorizationScheme="bearer"`,
  `checkedAt`, tek `commandsPassed=["pnpm alert:webhook:smoke"]` ve boş `gaps` listesiyle yazar.
- Alert ve dashboard UAT raporu `pnpm observability:uat:check` ile doğrulanır.
- Gerçek observability UAT raporunda Prometheus scrape, Grafana dashboard, Loki query ve alert delivery
  artifact referansları `evidenceReferences` altında yer almalıdır; `example`, `.test`, `redacted`,
  `localhost`, `__SET` veya placeholder değerler yalnız template kontrolünde
  `OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir. Rapor top-level 11 alanı, beş
  dashboard paneli, dört alert kuralı ve boş `gaps` listesi template invalid/non-empty gaps negatifleriyle korunur.
- External monitoring raporu `pnpm external-monitoring:check` ile doğrulanır. Self-hosted Uptime Kuma
  node'u dış ağdan public HTTPS endpoint'leri izler; `API /health`, `API /health/ready`, `Web login`
  ve `Traefik TLS certificate` monitor'ları `UP` olmalı, bilinçli kesinti webhook'a 120 saniye içinde
  düşmelidir. `outageDrill` zamanları `inducedAt <= detectedAt <= webhookDeliveredAt <= recoveredAt`
  sırasını ve latency saniyeleri timestamp farklarıyla eşleşmeyi kanıtlamalıdır. Rapor top-level
  10 alanı, `monitoringNode`, monitor item, `outageDrill` blok shape'leri ve boş `gaps` listesi
  template invalid/non-empty gaps negatifleriyle korunur.
- Admin MFA raporu `pnpm admin-mfa:check` ile doğrulanır. TOTP secret'ları AES-GCM ile şifreli
  saklanır, recovery code'lar hash'lenir, SMS OTP kullanılmaz ve enable/disable işlemleri mevcut
  session'ları iptal eder. Rapor top-level 9 alanı ile `policy`, `enrollment`,
  `loginVerification` blok shape'leri ve boş `gaps` listesi template invalid/non-empty gaps negatifleriyle korunur.

## Web UX ve A11y

- Landing sayfası değer önerisi, optik-analiz akışı, üretim kanıt sinyalleri, demo/kapalı beta
  CTA'ları ve gerçek bitmap hero görseliyle yayınlanır.
- Landing hero görseli WebP öncelikli, PNG fallback'li ve sabit boyutlu yayınlanır; repo performans
  bütçesi `pnpm web:performance:check` ile WebP dosyasının 250 KB altında, PNG fallback'in 2 MB
  altında ve marketing route'unun server/no-query kalmasını doğrular.
- Opsiyonel `WEB_PERFORMANCE_PROFILE_OUT` profili lokal temp path (`/tmp`, `/var/tmp`) altında,
  symlink file üzerinde veya symlink parent zinciri altında yazılamaz; `pnpm web:performance:check`
  bu output negatiflerini de çalıştırır.
- Landing, login, auth sonrası kurum dashboard shell'i ve kurum dashboard tablet viewport'u axe tabanlı smoke ile taranır.
- Kritik WCAG 2 A/AA axe ihlali 0 olmalıdır; repo kapısı `pnpm web:a11y:check` ile doğrulanır.
- Yedek/restore paneli, serbest string backup hedefi ve `s3://` restore kanıt dosyasını API çağrısı yapılmadan reddeder; bu hedefli panel sözleşmesi `pnpm web:backup-restore-panel:check` ile doğrulanır.
- GitHub CI ve staging image build job'ları `pnpm run ci` öncesi
  `pnpm --filter @uzman-hocam/web exec playwright install --with-deps chromium` çalıştırır; bu
  şart `pnpm docker:check`, `pnpm ops:check` ve `pnpm prod:readiness:check` statik kapılarıyla korunur.
- Web UX baseline contract `pnpm web:ux-baseline:check` ile a11y spec kapsamını, 768x1024 tablet
  yatay taşma kontrolünü, landing server/no-query performans bütçesini ve hero asset sözleşmesini sabitler.
- A11y smoke gerçek staging kanıtının yerine geçmez; tablet operatör UAT'i Faz 10 rol bazlı UAT içinde ayrıca yapılır.

## KVKK ve Audit

- Login, destek, duyuru, mesaj şablonu, sınıf, kişi, ödev ve KVKK purge audit kayıtları görünür.
- KVKK veri envanteri staging/prod gerçek veri sayımlarıyla `pnpm privacy:inventory:check`
  üzerinden doğrulanır.
- KVKK `purgeCoverage` içinde öğrenci için `firstName`, `lastName`, `phone`, `email`; veli için
  `firstName`, `lastName`, `phone`; kullanıcı hesabı için `email`, `name` alanları doğrulanır.
  Rapor top-level 8 alanı, dört `dataSubjectCounts` alanı, dört `purgeCoverage` subject'i,
  subject field setleri, dört audit action seti ve boş `gaps` listesi
  `prod:evidence:templates:check` içindeki fazla alan/madde ve invalid/non-empty gaps negatifleriyle korunur.
- Kimlik göç kanıtı: öğrenci/veli/öğretmen user bağları, tenant membership ve negatif erişim
  kontrolleri `pnpm identity-migration:check` üzerinden doğrulanır. Gerçek kanıtta onay sahibi ve
  onay referansı `example`, `.test`, `redacted`, `localhost`, `__SET` veya placeholder değer içeremez;
  bu gevşetme yalnız template kontrolünde `IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır.
  Rapor top-level 8 alanı, `migrationDecision`/`invitationFlow` blok shape'leri, üç subject item
  seti, dört verification seti ve boş `gaps` listesi `prod:evidence:templates:check`
  içindeki fazla alan/madde ve invalid/non-empty gaps negatifleriyle korunur.
- Finansal saklama kanıtı: finansal kayıtların saklama süresi ve purge istisnası `pnpm financial-retention:check`
  üzerinden doğrulanır. Gerçek kanıtta karar sahibi ve referans alanları örnek/placeholder/redacted
  değer içeremez; bu gevşetme yalnız template kontrolünde `FINANCIAL_RETENTION_ALLOW_EXAMPLE_EVIDENCE=1`
  ile açılır.
  Rapor top-level 7 alanı, `policyDecision`/`financialRecords` blok shape'leri, iki
  `purgeBehaviorVerified` seti ve boş `gaps` listesi `prod:evidence:templates:check`
  içindeki fazla alan/madde ve invalid/non-empty gaps negatifleriyle korunur.
- Upload AV kanıtı: upload scanner kararı, fail-closed davranışı ve EICAR reddi `pnpm upload-av:check`
  üzerinden doğrulanır; support ticket ekleri ve homework materyal dosyaları runtime scanner'dan geçer.
  Gerçek kanıtta scanner onay sahibi, onay referansı ve scanner adı örnek/placeholder/redacted değer
  içeremez; bu gevşetme yalnız template kontrolünde `UPLOAD_AV_ALLOW_EXAMPLE_EVIDENCE=1` ile açılır.
  Rapor top-level 7 alanı, `scannerDecision`/`scanResults` blok shape'leri ve iki upload surface
  seti ile boş `gaps` listesi `prod:evidence:templates:check` içindeki fazla alan/surface ve
  invalid/non-empty gaps negatifleriyle korunur.
- Güvenlik denetimi raporunda HTTPS/header, auth kontrolü, production env ve canlı RLS kanıt artifact'leri
  `evidenceReferences` altında yer almalıdır; `example`, `.test`, `redacted`, `localhost`, `__SET` veya
  placeholder değerler yalnız template kontrolünde `SECURITY_AUDIT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
  Rapor top-level 14 alanı, altı security header, dört auth kontrolü ve dört data kontrolü
  `prod:evidence:templates:check` içindeki fazla alan/madde negatifleriyle korunur.
- Dosya depolama kanıtı: yeni support ticket ekleri ve homework materyal dosyaları production'da DB
  `contentBase64` yerine S3 `storageKey` ile saklanır; S3 kayıtları `downloadMode=signed-url` ve
  `downloadUrlExpiresInSeconds <= 300` ile indirilir; mevcut inline satırlar okuma uyumluluğu için korunur.
  Inline-base64 taşıma kanıtı `INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE` çıktısındaki `DRY_RUN`
  raporu ve onaylı çalıştırma sonrası `MIGRATED` raporuyla saklanır; release gate bu paketi
  `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET` üzerinden `pnpm inline-upload-content:check` ile doğrular.
  Rapor file hedefi lokal temp path veya symlink file/parent directory üzerinden yazılamaz.
  Template zinciri inline migration top-level/storage/dry-run/migration/subject/migrated/command
  shape fazlasını reddeder.
- Audit diff'leri ham PII içermez.
- Veri sahibi self-service purge akışı test edilir.

## UAT ve Rollback

- V1 persona yolculukları ve UAT senaryo kimlikleri `docs/product-journeys-v1.md` dosyasında
  izlenir; staging/prod UAT raporu `UAT-SYS-*`, `UAT-KURUM-*`, `UAT-TEACHER-*`, `UAT-STUDENT-*`
  ve `UAT-GUARDIAN-*` senaryolarını referanslar.
- Tenant admin, öğretmen ve veli temel akışları staging'de test edilir.
- Ham import, rapor üretimi, SMS provider, e-posta/push provider ve Traefik HTTPS smoke'ları çalıştırılır.
- Staging ortamında ilk dış gate'ler tek komutla arşivlenebilir:
  `pnpm staging:first-gates:smoke -- --env-file /path/to/staging-evidence.env --output-dir artifacts/staging/first-gates`
  Traefik HTTPS ve alert webhook smoke artifact'lerini yazar ve ortak smoke evidence
  sözleşmesiyle doğrular. Output dizini lokal temp path (`/tmp`, `/var/tmp`) altında olamaz ve
  yalnız `first-gates-manifest.json`, `traefik-https.json`,
  `alert-webhook.json` dosyalarını içerebilir; beklenmeyen dosya veya
  symlink varsa smoke çalışmadan önce kırılır. Tekil smoke komutlarında kullanılan
  `*_SMOKE_EVIDENCE_FILE` çıktıları da provider, HTTP, S3 veya DB yan etkisine başlamadan önce
  doğrulanır; lokal temp path'e veya symlink file/parent directory üzerinden yazılamaz. Üretilen
  manifest ve üç artifact sonradan
  `STAGING_FIRST_GATES_TARGET=file:///path/to/first-gates-manifest.json pnpm staging:first-gates:check`
  ile yeniden doğrulanır; artifact `environment` değerleri manifest `environment` değeriyle eşleşmeli,
  manifest zamanı içerdiği artifact `generatedAt`/`checkedAt`
  zamanlarından önce olamaz. Bu komutlar gerçek staging host ve gerçek webhook
  hedefi olmadan Canlı Durum satırlarını `PASS` yapmaz.
- Full staging evidence artifact seti indirildikten sonra:
  `STAGING_RELEASE_ARTIFACTS_TARGET=/path/to/artifacts/staging pnpm staging:release-artifacts:check`
  komutu `reports/*.json`, first-gates manifest'i, tek `release-summary-*.json` dosyası ve
  `smoke/*.json` ham kanıtlarının, `smoke/report-generation.json` dahil, mevcut checker'lardan geçtiğini ve summary içindeki gömülü
  kanıtlarla eşleştiğini doğrular; `release-summary-<tag>.json` dosya adındaki tag summary içindeki
  `reports.deploymentRollback.releaseCandidate` image tag'iyle eşleşmelidir; bundle yalnız beklenen
  root, `reports/`, `smoke/` ve `first-gates/` dosyalarını içerebilir; beklenmeyen raw JSON/log dosyası
  kalırsa kontrol kırılır; bundle symlink içeremez, beklenen artifact'ler symlink olmayan dosya/dizin
  olmalıdır; `STAGING_RELEASE_ARTIFACTS_TARGET` parent-symlink target üzerinden verilemez, hedef
  path'in parent zincirinde symlink varsa kontrol kırılır; bundle `.staging-evidence.env`, `.env*` veya GHCR token dosyası içeremez, secret/env dosyası artifact setine karışırsa kontrol kırılır; first-gates manifest'indeki
  `evidenceFile` değerleri manifest dizini altındaki symlink olmayan relative artifact dosya adlarıdır; first-gates smoke ortamları manifest ortamıyla eşleşmeli, manifest zamanı kendi smoke artifact'lerinden önce
  olamaz ve ortak first-gates smoke'ları final raw smoke kanıtlarından daha
  geç tarihli olamaz.
- `pnpm staging:evidence-env:check`, GitHub CI artifact üretimi/download, env decode/check,
  metadata append, first-gates, production evidence, release bundle check, cleanup ve upload adım
  sırasını statik olarak korur.
- Staging/prod UAT raporu `pnpm uat:check` ile doğrulanır.
- Gerçek UAT raporunda `checkedAt` gelecekte olamaz; `tester`, `rollbackImageTag`,
  `restoreBackupReference` ve her
  `journeyScenariosVerified[].evidence` maddesi gerçek release/artifact/run/log referansı olmalıdır.
  UAT raporu top-level alan kümesi, `flowsVerified` ve `commandsPassed` tam setleri, 21 V1 journey
  scenario seti ve her scenario item shape'i `prod:evidence:templates:check` içindeki fazla
  alan/komut/senaryo negatifleriyle korunur.
  `releaseCandidate` ile `rollbackImageTag` aynı tag olamaz. `previous-pass`, `backup-bucket`, `qa-owner`,
  `example`, `.test`, `redacted`, `localhost`, `__SET` veya şablondaki açıklama cümleleri yalnız template
  kontrolünde `UAT_ALLOW_EXAMPLE_EVIDENCE=1` ile geçebilir.
- Kurum açılışı ve ilk admin kurulum zinciri staging'de `pnpm live:onboarding:smoke` ile doğrulanır;
  komut `NEXT_E2E_LIVE_ONBOARDING=1` ve `LIVE_ONBOARDING_EVIDENCE_PATH` kanıt JSON'u gerektirir.
  `pnpm live:onboarding:evidence-contract` bu preflight'ı tarayıcı açmadan doğrular; gerçek smoke
  başlamadan önce evidence JSON'unun exact system admin/first admin/tenant/onboarding shape'i,
  placeholder/test değer taşımadığı, sistem admin ile ilk admin e-postalarının ayrık olduğu ve
  dosyanın lokal temp path, symlink dosya veya symlink parent zinciri altında olmadığı kontrol edilir.
- Tam sınav döngüsü staging/prod kanıtı `LIVE_EXAM_CYCLE_TARGET` ile `pnpm live:exam-cycle:check`
  üzerinden doğrulanır; iSEM cevap anahtarı, optik pipeline, raw import, report-generation ve
  mock'suz UI-worker/portal kanıtları aynı release candidate'a bağlanır. Rapor top-level 11
  alanı, `examCycle` 26 alanı, 5 komutluk `commandsPassed` seti ve boş `gaps` listesi
  `prod:evidence:templates:check` içindeki fazla alan/komut ve invalid/non-empty gaps negatifleriyle korunur.
- Worker tarafından üretilen rapor staging'de `pnpm live:ui-worker:smoke` ile kurum UI'da açılır,
  Excel/PDF dışa aktarılır ve kanıt dosyasında portal credential'ı varsa öğrenci/veli portalında görüntülenir.
  Smoke komutu tarayıcı açmadan önce `NEXT_E2E_LIVE_UI_WORKER=1` ve gerçek
  `LIVE_UI_WORKER_EVIDENCE_PATH` ister; `pnpm live:ui-worker:evidence-contract` bu preflight'ı lokal
  CI'da doğrular. Evidence JSON'u exact rapor admin credential, `examId`, `firstStudentId` ve opsiyonel
  öğrenci/veli portal credential shape'i taşır; placeholder/test değer, lokal temp path, symlink dosya
  veya symlink parent zinciri kabul edilmez.
- Rollback hedefi son başarılı image tag'i ve restore edilebilir backup olarak yazılır.

## Canlı Durum

Bu bölüm `pnpm live:status:generate` ve `pnpm live:status:check` ile korunur. Harici satırlar gerçek
kanıt olmadan `PASS` yapılamaz; bir satır `PASS` durumuna alınacaksa `LIVE_STATUS_EVIDENCE_TARGET`
ilgili komut, source ve gerçek evidence referansını taşıyan bundle'a bağlanmalıdır.
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
item alan seti tam ve beklenmeyen alansız olmalı, sekiz gate satırı tam ve tekrarsız taşınmalı,
her gate `command` ve `source` değeri kanonik listeyle eşleşmeli, `checkedAt` geçerli tarih olmalı,
`evidenceReference` ilgili source artifact referansından türemeli, `checkedAt` ilgili
smoke/report/pilot/go-live kaynak tarihinden türemeli ve bundle `generatedAt` sonrasına düşmemelidir.
`pnpm live:status:check` bundle içindeki `productionEvidenceSummaryTarget`, `goLiveEvidenceTarget` ve
`pilotEvidenceTarget` kaynaklarını okuyarak gate `checkedAt` ve `evidenceReference` değerlerinin
source artifact ile eşleştiğini doğrular. Go-live checker bu hedeflerin aynı artifact setindeki
go-live summary/pilot hedeflerine çözüldüğünü ayrıca doğrular.
Live-status source ve output hedefleri yalnız kalıcı, symlink olmayan `file://` artifact veya
`https://` URL olabilir; `http://`, lokal temp path, symlink artifact ve symlink parent directory
hedefleri üretici, checker ve go-live linked checker tarafından reddedilir.
Template zinciri duplicate gate, live-status top-level/gate item shape fazlası, NOT_RUN
command/source/checkedAt/evidenceReference sapması, geç veya kaynakla eşleşmeyen `checkedAt`, kaynakla eşleşmeyen
`evidenceReference`, UAT top-level/komut/journey
shape fazlası, live-exam-cycle top-level/examCycle/command/gaps shape fazlası,
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
pilot top-level/nested/assessment/gaps shape fazlası, deployment region top-level/servis/gaps
shape fazlası, deployment rollback top-level/servis/komut/gaps shape, kronoloji fazlası ve release=rollback sapması, external monitoring outage chronology/latency, production summary smoke environment, Traefik URL origin, external monitoring URL origin, live exam cycle release/app/API ve UAT release/rollback/restore eşleşme sapmaları, go-live `gatesPassed` fazlası
ve live-status source-date/evidenceReference sapmaları, bağlı live-status duplicate gate/top-level/gate item shape fazlası, target, source-date ve evidenceReference sapmaları, production summary
top-level/check-list/check-field/smoke/report/report-field fazlası, check status/script/duplicate sapmaları ve smoke/report tarih negatifleri, go-live top-level/production-summary/
deployment/approval shape fazlası, go-live `checksPassed` fazlası, bağlı summary duplicate check,
go-live karar kronolojisi negatifleri, bağlı summary top-level/check-field fazlası ve bağlı summary smoke/report/report-field fazlası ile kırık
summary/pilot/go-live kaynak ve go-live linked pilot gaps negatif fixture'larını da kırmızıya düşürür.

- Repo gate: `PASS`
- Yerel geliştirme canlı smoke: `PASS` (2026-05-31; `pnpm live:smoke`)
- Kurum canlı yayın kanıt ekranı: `PASS` (2026-06-02; web typecheck ve hedefli Playwright kurum smoke)
- Traefik HTTPS smoke: `NOT_RUN`
- TR datacenter/provider kanıtı: `NOT_RUN`
- Staging/prod UAT: `NOT_RUN`
- Deployment rollback tatbikatı: `NOT_RUN`
- Pilot kapanış kanıtı: `NOT_RUN`
- Go-live karar paketi: `NOT_RUN`
- Alert bildirim kanalı: `NOT_RUN`
