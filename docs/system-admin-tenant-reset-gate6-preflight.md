# Gate 6 — fresh reset release ön hazırlığı

<!-- gate6o-current:start -->
## Güncel sonuç — Gate 6O / 2026-09-08

**Kontrollü ilk PRODUCTION yayını PASS.** Kullanıcının açık onayıyla exact kaynak
`362a2d549e9714b5238e7d2836f2f56197455f02`, 2026-09-08 02:14:21 +03 itibarıyla dört
uygulamada çalışıyor. 109→116 migration, dar NOLOGIN rol bootstrap'ı ve yalnız ACTIVE
kurum hesap/lisans backfill'i tamamlandı. Bu bölüm aşağıdaki eski bekleme/onay/109
migration notlarının güncel karşılığıdır; tarihsel kanıtlar korunur.

- **CI:** exact SHA için GitHub `34161751919` üç iş SUCCESS; tam yerel CI ayrıca PASS.
- **PRODUCTION:** temiz duruş API143 / worker0 / queue-board0; taze şifreli PG yedeği,
  ayrı ağsız restore, gerçek migrator ile migration/DRY_RUN/APPLY/replay prova PASS.
  Canlı önce/sonra 72 eski tablo koruma ve 74 tablo prova karşılaştırması PASS.
  dna/demoo/system aynı kimliklerle ACTIVE; silinen 25 kurum için işlem tekrarlanmadı.
  Parola/MFA/mevcut oturum durumları korundu; yalnız beklenen hesap bağları ve iki
  günlük LicenseUsage satırı eklendi/güncellendi. Reset rolü NOLOGIN, üyelik0 ve
  tehlikeli yetki0; uygulama rolüyle üç kurumda RLS dış satır0.
- **PRODUCTION runtime:** dört image etiketi/ID/kaynak doğrulandı, yeniden başlama0,
  worker hata0; `/health`, `/health/ready`, `/login` 200, iki yetkisiz tenant GET401.
  Kuyruk kayıtları değişmedi; belirsiz outbox0. Bu sonuç tenant reset deneyi değildir.
- **EXTERNAL_NOT_RUN / UNPROVEN:** genel staging workflow'u, registry push, off-host
  reset PG+S3 restore, tam reset, pilot ve 14 günlük izleme. Reset DSN/wiring eklenmedi;
  write-quiescence guardı kapalıdır. Provider test gönderimi yapılmadı.

İlk kesim API exit137 ile migration öncesi durdu; şema109/reset rolü0/env değişmemiş/
kuyruk boş uzlaştırmasından sonra eski sürüm kontrollü geri açıldı. İlk FAIL kaydı
saklandı. PID1 sorunu aynı aday image'da üretildi; Docker `init: true` ile hook tamam,
exit143/0.55s kanıtlandı. Private init override preflight/stop/activate boyunca bağlı;
137/OOM engelleri kaldırılmadı. Repo Compose ve aday kaynak değiştirilmedi; sonraki
standart deploy bu private override'ı kullanmalı veya bu ayarı kaynakta sağlamalıdır.

Genel staging workflow'u alert POST, WAL ve mevcut secret bootstrap yan etkileri
nedeniyle dar onayla çalıştırılmadı. Registry push yetkisi yok; dört linux/amd64 image
şifreli SSH ile hash/image ID doğrulanarak yüklendi. Recovery image arşivi private
sunucuda saklandı. GitHub deploy run'ı veya canonical staging cutover PASS üretilmedi;
eski public cutover kaldırıldı. Gerçek manuel production kanıtı ayrı dosyadadır.

Kanıt: `artifacts/tenant-reset-release-execution/production-release.json`;
`cutover-attempt-2-result.json`, `precommit-backup-result.json`, `shutdown-probe.json`,
`retry-reconciliation.json` ve hash envanteri aynı dizindedir. Taze şifreli yedek
SHA256: `f9bbb1ee13e4bafd51b70a7d7e0387e61bd6b03b2d32255a5c362e2f13cbf787`.

**Sonraki en küçük gate (6P):** API kapanırken devam eden mutasyonun sonuç kaydını,
reset dispatcher/doğrudan enqueue ve PDF işini beklemek. Bu yerel düzeltme için yeni
canlı onay gerekmez; yeni kaynak bu yayın başarısını devralmaz ve ayrıca doğrulanır.
Tam reset için tüm yazıcıları kapsayan duraklatma, terminal provider uzlaştırması,
off-host PG+S3 kanıtı ve dna/demoo/system dışındaki exact pilot/onay hâlâ gerekir.
<!-- gate6o-current:end -->

2026-09-07. Durum: **BLOCKED / Gate 6 tamamlanmadı.** Bu belge bir yürütme veya release
kanıtı değildir. Disposable reset, staging reset ve production pilotu başlatılmadı.

## Kapsam ve kabul

Amaç, Gate 1–5 yerel kaynağını gerçek ortam denemesine hazırlamak ve eksik bağımlılıkları
somutlaştırmaktır. Release ajanı hazırlığı teslim etti; son entegrasyonun tek yazıcısı ana ajandır. Yazma alanı bu belge ve
`docs/system-admin-tenant-lifecycle-fresh-reset-plan.md` ilerleme kaydıdır. Tam yerel CI'da bulunan
65. tenant tablo kaynaklı fixture uyumsuzluğu için yazma alanı ayrıca yalnız
`docs/evidence-templates/rls-live.example.json` ve bağlı
`docs/evidence-templates/production-evidence-summary.example.json` tablo listesi/sayıları ile
`scripts/check-prod-evidence-templates.mjs` içindeki bağlı 64 → 65 negatif beklentisine genişletildi. Bağlı `scripts/check-ops-config.mjs` ve `scripts/check-prod-readiness.mjs` beklentileri de 65’e eşitlendi.
Gerçek ölçüm komutuyla `docs/measurement-baselines/gate-b-local-synthetic.json` yenilendi.
Eski birleşik rol kullanan pozitif testler `apps/web/e2e-next/governance-evidence-contract-next.spec.ts`
ve `apps/web/e2e-next/kvkk-privacy-next.spec.ts` içinde kurum yöneticisi oturumuna taşındı;
`apps/web/e2e-next/ui-visual-qa-next.spec.ts` kurum detayı fixtureına sürüm ve sunucu işlem izinleri eklendi;
`scripts/check-web-ux-baseline.mjs` bağlı beklentisi güncellendi. Uygulama erişim kuralları,
workflow/compose, sırlar ve diğer kullanıcı değişiklikleri bu hazırlığın yazma alanı değildir.
Git stage/commit/push/PR/merge, deploy, migration, provider ve veri mutasyonu yapılmaz.

Kabul: gerçek kaynak engelleri, mevcut komutlar, gerekli özel yapılandırma adları ve
disposable → exact-SHA staging → en az 14 günlük pilot koşulları açık olmalı; eksik
kanıt PASS yapılmamalıdır. Doğrulama: kaynak/komut incelemesi ve `git diff --check`.
Ana ajan ayrıca `pnpm run ci` çalıştırır; sonucu yerel test olarak raporlanır.

## Kaynak ve kanıt sınırı

İncelenen HEAD: `e4bde6f18991ddf2c8db5c0713d032720abf288a`. Gate 1–5 kaynakları
tracked değişiklikler ve untracked dosyalardır; HEAD bu yeni davranışın release SHA'sı değildir.
Branch `fix/setup-grade-level-course-links`; yerel `origin/main` ve salt-okunur GitHub main
ref'i `e2f06372b383a0545e347334686c8ee0d4fc259d`. GitHub CI run `33801131409` HEAD için
başarılı `pull_request` çalışmasıdır; uncommitted Gate 1–5 dosyalarını veya main deploy'unu kanıtlamaz.
Önceki HEAD CI/deploy başarısı bu dosyaları doğrulamaz. Ayrı yetkilendirilmiş entegrasyon
sonrasında sabit bir commit seçilmeli; exact kaynak → GitHub CI → deploy run → cutover
artifact → dört çalışan image → public health/readiness zinciri aynı commit'e bağlanmalıdır.

| Sınıf | Bu hazırlığın kanıtı |
|---|---|
| `LOCAL_STATIC` | Kaynak guardları, worker/compose/Dockerfile ve mevcut komutlar okundu. Doküman komut/dosya referansları ve `git diff --check` geçti. Node `v24.19.0`, pnpm `11.5.0`; Docker ve gh CLI PATH'te mevcut. Ops statik kontrolü geçti. |
| `LOCAL_TEST` | Gate 1–5 sonuçları ana planda; bu turdaki tam yerel CI sonucu ayrı kaydedilir. Mock/adapter testleri gerçek PG/S3 deneyi değildir. |
| `CI` | HEAD için başarılı PR run `33801131409` var. Uncommitted Gate 1–5 kaynağına bağlı run yok; önceki commit sonucu bu kapıyı kapatmaz. |
| `STAGING` | Fresh reset için `UNPROVEN`. |
| `PRODUCTION` | Fresh reset ve pilot için `UNPROVEN`; pilot başlangıç tarihi yok. |
| `EXTERNAL_NOT_RUN` | Deploy, migration/rol sağlama, gerçek backup/restore/reset, S3 mutasyonu ve canlı UAT. |
| `UNPROVEN` | Gerçek ortamda talep/claim transactionı, drain/fence, gerçek rol/RLS/FK, restore ve uçtan uca reset. |

Yerel PATH'te `pg_dump`, `pg_restore`, `psql` bulunmadı. CLI'nin bulunması Docker daemon,
hedef servis, PostgreSQL sürüm uyumu veya yetki kanıtı değildir. Ana ajan hem `default` hem `desktop-linux` Docker context socketlerinin
bulunmadığını doğruladı. Target verilmeden yapılan
live-status kontrolündeki `0/17`, canlı kanıtın olmadığı anlamındadır; dış ortam PASS değildir.

Bu turda notification gateway'in 35 yerel testi geçti. Tam yerel CI, RLS example kanıtının
64 tablo taşıması nedeniyle durdu: yeni `TenantFreshResetOperation` ile katalog 65 tablodur.
İki bağlı example dosyasına yalnız bu tablo ve türetilen sayımlar eklendi; örnek kimlik/tarih/URL
etiketleri ve gerçek kanıt doğrulaması değiştirilmedi. Bu fixture düzeltmesi gerçek RLS deneyi değildir.
Bağlı negatif testin eski 64 tablo beklentisi 65'e eşitlendi. Son
`pnpm prod:evidence:templates:check` **PASS** (exit 0): pozitif şablonlar, negatif kanıt
senaryoları, production env, smoke evidence, staging env ve 21 UAT/60 repo yolu sözleşmeleri geçti.
Tam `pnpm run ci` sonucu bu hedefli PASS'ten ayrı tutulur.

Sonraki CI denemelerinde bağlı statik 64 tablo beklentileri ve eski kaynak ölçüm özeti düzeltildi.
`pnpm web:measurement-baseline:collect` üç görev için beşer gerçek yerel örnek üretti;
ölçüm kontrolü geçti (`LOCAL_SYNTHETIC`, canlı performans kanıtı değil). UI zincirinde
168 test geçti, eski birleşik rol fixturelarıyla dört test durdu. Yetki engelleri korunarak
pozitif fixturelar düzeltildi; iki dosyanın hedefli tekrarında **9/9 PASS**. UX baseline,
ölçüm kontrolü ve diff kontrolü geçti. Tam zincirin beşinci denemesinde arayüz sözleşmeleri **172/172**, route family kontrolleri
**89/89** geçti. Görsel paket **28 PASS / 3 FAIL** ile durdu. Kurum yönetimi fixtureına eksik
`lifecycleVersion` ve doğrulanmış `management.allowedActions` eklendi; hedefli tekrarı **1/1 PASS**.
Diğer iki açık görsel fark: `institution-shell-rail-1440-darwin.png` (3042 piksel; yan menü)
ve `route-family-report-1440-darwin.png` (9334 piksel; yan menü/rapor formu). Fark görselleri
incelendi; eşik veya referanslar değiştirilmedi. Dolayısıyla **tam yerel CI PASS değildir**.
Yerel loglar: `artifacts/gate6/local-ci-attempt-5.log`, `artifacts/gate6/visual-tenant-targeted.log`.
Bu loglar yayımlanmış release kanıtı değildir.

Görsel aşamada durduğu için zincirin devamı ayrıca çalıştırıldı:
`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm openapi:generate && pnpm idempotency:inventory:check`
**PASS** (exit 0). API 1172 PASS / 4 SKIP, DB 57/57, worker 220/220; OpenAPI 243 path,
idempotency 48 operation. Son ölçüm ve `git diff --check` kontrolleri de geçti.
Bu ayrı devam kontrolü iki açık görsel farkı kapatmaz; tam CI başarısı sayılmaz.

## Kaynakta kapalı veya eksik olanlar

| Engel | Kaynak ve gereken iş |
|---|---|
| Kurum talebi | Gate 6A ile yetki kaynağı belirlendi ve kalıcı kurum yöneticisi talebi bağlandı. Talep yok/iptal/eski/başka operasyona bağlıysa reset reddedilir. Finans/destek/consent saklama engelleri bağımsız kalır. |
| Yazma duraklatma | Aynı dosyadaki `requireResetWriteQuiescence` her çağrıda `RESET_WRITE_QUIESCENCE_UNVERIFIED` atar. Başlamış HTTP/upload yazımları ile queue producer/consumer drain kanıtı yok. |
| Önizleme bağlantısı | Kurum talebi snapshot/digest ile doğrulanır. Yazma duraklatma halen doğrulanamadığı için API `allowed:false` döndürür. Talep tek başına reseti açmaz. |
| Runtime araçları | `Dockerfile` worker aşaması PostgreSQL istemcilerini kurmaz; `tenant-reset-backup.ts` gerçek `pg_dump`/`pg_restore` çağırır. Kaynak sunucu sürümüyle uyumlu araçlar image'da doğrulanmalı. |
| Runtime wiring | `docker-compose*.yml` resetin `TENANT_RESET_*` değişkenlerini aktarmıyor. `tenant-fresh-reset-worker.ts`, dedicated DSN yoksa başlamaz. Env dosyasına değer eklemek tek başına container aktarımı değildir. |
| Dar DB rolü | Gate 4 migrationı `o_okul_reset_worker` rolünü `NOLOGIN` oluşturur. Ayrı salt-okunur backup rolü, reset login/secret dağıtımı ve gerçek grant/RLS doğrulaması henüz yapılmadı. |
| Tek pilot sınırı | Plandaki geçici reset açma/tenant sınırı mevcut reset koduna bağlanmış değil. Worker DSN varlığı tek pilot yetkilendirmesi değildir; diğer tenantlar kapalı kalmalı. |
| Operasyona bağlı hedef | Operasyon ID'sini sunucu üretir; restore DB/bucket adı bu ID'ye bağlıdır. Worker eksik hedefi oluşturmaz, `BLOCKED` operasyon dispatcher ile kendiliğinden ilerlemez. ID alındıktan sonra hedef hazırlama ve aynı operasyonu güvenli sürdürme yolu ayrıca tamamlanmalı; yeni POST/ID ile kör retry çözüm değildir. |
| Uçtan uca kanıt | `scripts/tenant-reset-backup.mjs` yalnız yedek ve izole restore yapar. Gerçek iki-tenant reset/failure-injection smoke runnerı ve reset pilot kanıt checkerı henüz yok. Genel backup/pilot checkerı tek başına fresh reseti doğrulamaz. |

**Operatör onayı, env boolean, iş/ticket numarası veya makbuz bu kaynak engellerini açmaz.**
Guardları boş fonksiyon veya test stub'ıyla geçmek, production boot/kanıt kontrollerini
gevşetmek bu planın çözümü değildir. API oluşturma, worker başlangıcı, purge ve final aktivasyon
aynı yetki/duraklatma koşullarını doğrulamalıdır.

## En küçük sonraki kaynak dilimi

Kullanıcı 2026-09-07 tarihinde yetki kaynağını belirledi: kendi kurumu adına kurum
admininin gönderdiği yenileme talebi, sistem adminin reset yetkisinin kaynağıdır.
Gate 6A bu kararı `Tenant.resetRequest` ve `TenantFreshResetOperation.institutionRequestId`
üzerinden bağlar; backup referansı `institution-request:<requestId>` olur. Yeni genel
hukuki sağlayıcı veya destek ticketı gerekmez. Sabit talep kapsamı `CLEAN_SETUP_V1`'dir;
finans, destek ve consent kayıtlarına ait mevcut saklama engelleri kaldırılmaz.

Yazma duraklatma için gerçek ingress, upload ve bütün queue yazma yolları üzerinde kurum bazlı
yeni iş kabulünü kapatan, başlamış işleri tüketen ve işlem boyunca geçerliliği denetlenen bir
fence gerekir. Süre/bağlantı kaybı veya yeni yazım varsa reset durmalı. Session revoke ve anlık
queue sayımı bu koşulu sağlamaz. Bütün kurumlarda bakım kesintisi kabul edilecekse bunun kapsamı
operatörce ayrıca belirlenir; mevcut planda buna izin verildiği varsayılmaz.

Bu dar kaynak diliminin kabulü: karar yok/eski/iptal, farklı tenant/sürüm, drain tamamlanmamış,
fence kaybı ve eşzamanlı upload/queue yazımı negatifleri; geçerli sentetik yetki ve gerçek fence
ile iki-tenant disposable pozitif akışı. Pilot hedef sınırı API ve worker tarafında birlikte
uygulanmalı. Image/compose değişiklikleri ancak bu bağımlılıklar somutlaştıktan sonra hazırlanır.

## Özel yapılandırma ve operatör girdileri

Değerler bu belgeye, komut satırına, artifact'e veya mesaja yazılmaz. Güvenli runtime
kanalından sağlanacak **mevcut adlar**:

- API/source: `PERSISTENCE_DRIVER`, `DATABASE_URL`, `REDIS_URL`, `QUEUE_PREFIX`, `S3_ENDPOINT`,
  `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Worker: `TENANT_RESET_DATABASE_URL`, `TENANT_RESET_BACKUP_SOURCE_DATABASE_URL`,
  `TENANT_RESET_BACKUP_KEY_BASE64`, `TENANT_RESET_RESTORE_DATABASE_URL`.
- Worker S3 grupları: `TENANT_RESET_SOURCE_S3_*`, `TENANT_RESET_BACKUP_S3_*`,
  `TENANT_RESET_RESTORE_S3_*`; her grupta `ENDPOINT`, `BUCKET`, `REGION`, `ACCESS_KEY_ID`,
  `SECRET_ACCESS_KEY`. Source endpoint/bucket API ile aynı olmalı.
- Bağımsız backup CLI: `TENANT_RESET_BACKUP_TENANT_ID`, `TENANT_RESET_BACKUP_OPERATION_ID`,
  `TENANT_RESET_BACKUP_APPROVAL_REFERENCE`, `TENANT_RESET_BACKUP_ACTION=BACKUP_AND_ISOLATED_RESTORE`;
  CLI kaynak DSN/S3 için `DATABASE_URL` ve `S3_*` kullanır. Bunlar workerın otomatik işlem
  kimliği ve hukuki onay kaynağı yerine geçmez.
- Migration sırasında yalnız migration kimliği: `DIRECT_DATABASE_URL`; worker'a verilmez.

Operatör girdileri: sentetik hedef tenant ve kontrol tenantı, onaylı ortam/hostlar,
yetkili karar kaynağı/PII içermeyen karar referansı, bakım kapsamı, gerçek source/backup/restore
sahipliği, private erişim yolu ve daha sonra production pilot tenantı/sorumlusu.

Kaynak ve bütün S3 endpointleri için runbook'taki HTTPS/alias kuralları geçerlidir. Backup
public adresli ayrı off-host hedef olmalı; private ACL/policy/public-access-block doğrulanmalı.
Restore DB kaynak host/IP'sinden ayrı, TLS ve boş olmalı; adı `o_okul_reset_drill_<operationId>`,
boş bucket adı `o-okul-reset-drill-<operationId>` olmalı. Source bucket versioning kapalı kalır.
Standart yerel Docker/Postgres/MinIO kurulumu bu off-host/HTTPS koşullarını tek başına sağlamaz.
Genel Faz 6 pilotunda export'a izin veren istisna fresh resetin restore şartını kaldırmaz.

## Onaydan sonra uygulanacak sıra

Aşağıdakiler gelecekteki çalışma komutlarıdır; bu hazırlıkta çalıştırılmadı. Önce kaynak
bağımlılıkları kapanmalı; her veri/provider/deploy eylemi için hedefi belli action-time onay
alınmalı. Repository `.env` dosyasını otomatik kullanmamak için hedef DSN'ler güvenli ortamda
explicit sağlanmalı ve sır göstermeden hedef kimliği doğrulanmalıdır.

1. **Disposable hazırlık ve iki-tenant deneyi.** Onaylanmış ayrı kaynak/restore hedefleri,
   roller ve uyumlu PostgreSQL araçları sağlanır. Mevcut migrationları uygulayan komut:

   ```sh
   pnpm --filter @o-okul/db exec prisma migrate deploy --config prisma.config.ts
   pnpm --filter @o-okul/shared-types build
   pnpm --filter @o-okul/db build
   pnpm --filter @o-okul/api build
   node scripts/tenant-reset-backup.mjs
   ```

   `pnpm db:migrate` development migration komutudur; staging/production release komutu
   değildir. Genel seed çalıştırılmaz. Backup CLI önceden SUSPENDED sentetik kaynak ister;
   kaynak hazırlığı ve askıya alma da onaylı deney kapsamındadır. Başarısız restore hedefi
   inceleme için korunur, kör retry veya otomatik temizlik yapılmaz.

   Reset için mevcut UI/API ve worker kullanılır; bugün çalışır bir canlı smoke komutu
   yoktur. Eksik runner tamamlanmadan hayali `reset:smoke` komutu çağrılmaz. Deney; iki tenantın
   hedef dışı satır/nesne hash eşliğini, çoklu owner ve owner-teacher temizliğini, gerçek rol/RLS/FK,
   stale MFA/idempotency, eski token reddi, rollback'te sıfır S3 delete, object retry'da aynı operasyon,
   bağlantı kaybı, yarım restore/attestation ve orphan sayımlarını kanıtlamalıdır.

2. **Exact-SHA staging.** Ayrı entegrasyon/release onayıyla temiz candidate ve aynı SHA'nın
   başarılı GitHub CI sonucu bağlanır. Mevcut `Staging Deploy`, main CI sonrasında otomatik
   tetiklenebilir; main'e push/merge de bu etki dikkate alınarak onaylanmalıdır. Manuel tekrar
   gerekiyorsa mevcut workflow'un exact onaylı ref ve son bilinen image girdileri kullanılır:

   ```sh
   gh workflow run staging-deploy.yml --ref "$RESET_RELEASE_REF" -f image_tag="$RESET_RELEASE_IMAGE_TAG" -f rollback_image_tag="$RESET_PREVIOUS_IMAGE_TAG"
   node scripts/check-deployment-cutover-evidence.mjs
   pnpm staging:first-gates:check
   pnpm staging:release-artifacts:check -- --artifacts-dir artifacts/staging
   ```

   `RESET_RELEASE_*`/`RESET_PREVIOUS_IMAGE_TAG` bu örnekte operatörün doğruladığı shell
   değişkenleridir; uygulama config/özellik anahtarı değildir. Checkerlar gerçek
   `DEPLOYMENT_CUTOVER_EVIDENCE_TARGET`, `DEPLOYMENT_CUTOVER_EXPECTED_RUN_ID`,
   `DEPLOYMENT_CUTOVER_EXPECTED_REPOSITORY` ve `STAGING_FIRST_GATES_TARGET` girdilerini ister.
   Host Docker metadata/health ile web/api/worker/queue-board image eşliği ve public
   `/health`, `/health/ready`, `/login` doğrulanır; yalnız host-loopback sonucu kullanılmaz.
   Sonra ayrı onaylı sentetik tenant üzerinde backup → isolated restore → reset → tüm ownerlarda
   zorunlu parola değişimi → setup/readiness akışı gerçek runtime'da kaydedilir.

3. **Tek production pilotu.** Disposable ve exact-SHA staging sıfır blocker ile kapanmadan
   başlamaz. Veri sorumlusu referansı, hedef allowlist/fence, gerçek restore makbuzu ve ayrı
   production action-time onayı gerekir. Başlangıç zamanı gerçek reset/owner/readiness kanıtına
   bağlanır. En az 14 gerçek gün boyunca restore, audit, owner erişimi, orphan/nesne sayımları ve
   olaylar izlenir. Tarih ileri alınmaz; bekleme/sahte gözlem pilot sayılmaz.

   Mevcut genel kapanış komutları gerçek artifact/env girdileriyle çalışır:

   ```sh
   pnpm pilot:check
   pnpm prod:evidence:check
   pnpm live:status:check
   pnpm go-live:check
   ```

   `PILOT_EVIDENCE_TARGET` genel 14 günlük ürün pilotunu doğrular; fresh reset gözlemlerini
   otomatik doğrulamaz. Reset özel kanıt sözleşmesi/bağlantısı kapanmadan genel PASS resetin
   genel açılım onayı olmaz. Pilot kapandıktan sonra geçici hedef kısıtı ayrıca incelenmiş
   release ile kaldırılır; bu hazırlık böyle bir onay vermez.

Kanıtlar kalıcı ve symlink olmayan hedeflerde tutulur; temp path, local-only/placeholder URL,
userinfo/query/fragment veya secret-bearing payload kabul edilmez. Private credential girdileri
release bundle'a konmaz. `artifacts/local/**` çıktıları yalnız yerel teşhistir. Mevcut staging
bundle exact dosya seti istediği için yeni reset raporu doğrulayıcıya bağlanmadan bundle'a eklenmez.

**Sonraki kaynak dilimi:** kurum bazlı yazma duraklatma/drain ve kesintisiz fence
entegrasyonu. Yetkili talep kaynağı sorusu kullanıcı kararı ve Gate 6A ile çözüldü;
gerçek reset için runtime araçları/bağlantıları ve dış ortam kanıtları halen gerekir.

## Gate 6A — kurum yöneticisi talebi (2026-09-07)

Tek yazıcı backend uygulama ajanıdır. Kapsam mevcut tenant API, typed sözleşme/OpenAPI,
Tenant reset alanı ve dar migration/worker bağlantısı, lisans dönemleri talep paneli,
sistem reset paneli ve hedefli testlerdir. Başka modüller, demo belgesi, yapılandırmalar,
deploy ve gerçek veri işlemleri kapsam dışıdır.

- STAFF TENANT_ADMIN/TENANT_OWNER yalnız kendi kurumuna talep gönderebilir. SYSTEM_ADMIN,
  birleşik sistem rolü, başka persona, rol önizleme ve salt okunur bağlam reddedilir.
  DB içinde kurum, güncel aktif oturum, aktif User ve kanonik üyelik sürümü/rolü doğrulanır.
- Talep tekrar gönderimi aynı PENDING kaydı döndürür; geri çekme ve yeni talep eski ID'ye
  karşılaştırılır. Kabul edilen talep değiştirilemez; başka reset tarafından kullanılamaz.
  İşlem ve talep claim'i aynı transaction'dadır. Worker yalnız kendi tamamlanmış operasyonuyla
  ACCEPTED→COMPLETED yazabilir; kurum adına yeni yetki üretemez. Geçmiş mevcut AuditLog'dadır.
- Kurumun askıya alınmasındaki tek sürüm artışı kabul edilir; sonraki yaşam döngüsünde
  eski talep geçersizdir. Preview/create/worker/purge/final aynı kurum ve talep kimliğini
  doğrular. Silinen talep sahibinin User satırına sonraki aşamalarda ihtiyaç duyulmaz.
- Tam ham yedek korunur; drift özeti yalnız aynı claim'in durum/operasyon alanını
  normalleştirir. İstek kimliği ve diğer Tenant alanları değişirse özet değişir.
- `LOCAL_STATIC`: shared/DB/API/web typecheck, Prisma/RLS (65 tablo), reset katalog,
  tenant-db, UX baseline ve OpenAPI (245 path) geçti.
- `LOCAL_TEST`: API hedefli 47/47; tam DB 65/65; fresh web build sonrası Playwright
  38/38 (390/1280, talep/onay/geri çekme; eksik/başka tenant talebi, mevcut reset güvenlik akışları).
- `LOCAL_TEST`: erişilebilirlik smoke 11/11. Canonical
  `pnpm web:measurement-baseline:collect` + check geçti: 3 görev × 5 örnek,
  `LOCAL_SYNTHETIC`; canlı performans veya staging kanıtı değildir.
- `CI`, `STAGING`, `PRODUCTION`: bu yeni dilim için `UNPROVEN`.
  `EXTERNAL_NOT_RUN`: migration uygulama, gerçek PG trigger/yarış, deploy, reset ve pilot.
  Önceki iki görsel fark ve tam CI durumu değişmedi; Gate 6 halen **BLOCKED**.

## Gate 6B — ortak PostgreSQL işlemlerinin resetle koordinasyonu (2026-09-07)

Tek yazıcı backend uygulama ajanıdır. Bu dilim package `tenant-db.ts`, API ortak
`db/tenant-query.ts`, reset worker lock/cleanup, salt okunur reset durum sorguları ve
bunların doğrudan SQL fixture/testleriyle sınırlıdır. Şema/migration, HTTP/S3/provider
entegrasyonu, yapılandırma ve gerçek veri işlemleri değiştirilmedi.

- Gerçek bağlantılı `withTenantDb`, API `withTenantQuery`/`withExplicitTenantQuery`
  işlemleri `BEGIN` sonrasında callback'ten önce aynı kurum anahtarına transaction paylaşımlı
  advisory try-lock alır. Sonuç tam `true` değilse callback çalışmaz ve transaction geri alınır.
  Farklı kurum anahtarları bağımsızdır; olası hash çakışması yalnız gereksiz bloklama yaratır.
- Reset runner mevcut operasyon kilidine ek olarak aynı kurum anahtarında session exclusive
  try-lock alır; bağlantı boyunca tutar. Devam eden katılımcı DB transactionı varsa reset
  bekletmeden geri döner, operasyon durumunu değiştirmez. Kilit kendi bağlantısındaki
  alt transactionları engellemez. Tamamlanmış işin erken dönüşünde de kilitler çözülür.
- Normal işlem COMMIT/ROLLBACK ile paylaşımlı kilidi bırakır; ROLLBACK bağlantı hatasında
  bağlantı havuza geri verilmez. Runner tenant kilidini, ardından operasyon kilidini çözer
  ve reset bağlantısını her durumda kapatır; belirsiz lock/unlock yanıtı havuza kilit sızdırmaz.
- Reset `find`/`findByKey` ve management sorguları `BEGIN READ ONLY` kullanarak aynı kurum
  için sorgulamaya devam eder. Sadece kilidi atlayan serbest yazma yolu eklenmez; bu seçenek
  bağlantısız adapterda reddedilir. Boş/whitespace/eksik kurum veya sahte bypass bağlamı reddedilir.

**Bu kapsam tam yazma duraklatma değildir.** `WRITE_QUIESCENCE_UNVERIFIED` ve API
`allowed:false` korunur. Kilit DB transactionının sonunda biter; eski HTTP isteğinin daha
sonra başka transaction açmasını, transaction dışında upload veya provider çağrısı yapmasını
engellemez. Reset sonrası bekleyen eski istekler yaşam döngüsü/üyelik sürümünü yeniden
kontrol etmelidir. Bunlar Gate 6C'nin kalıcı fence ve drain işidir.

Kapsam dışındaki somut yollar:

- Global `tenantId:null, bypassRls:true` işlemleri (tenant lifecycle store dahil), mevcut
  `connect` sağlamayan legacy adapterlar ve doğrudan `pool.query` bu kilide katılmaz.
- API `auth/session-store.ts`, `auth/password-reset-store.ts`,
  `audit-log/audit-log-store.ts` özel transaction yardımcıları; identity invitation store'un
  özel/global bypass işlemleri ortak helper dışında ayrıca incelenmelidir.
- Worker `secret-delivery-outbox.ts` global claim/expire/delivery-ack SQL yolları.
- API `queue/bullmq-producer` iş kabulü; `homework-material-file-storage.ts`,
  `support-ticket-attachment-storage.ts`, `exam/s3-raw-import-archive-store.ts` S3 yazımları
  ve workerın transaction dışı provider/nesne işlemleri.
- Yeni `TENANT_DATABASE_BUSY` hatası mevcut API hata filtresinde genel 500 yanıtıdır.
  Gate 6C'de 503/tekrar-deneme iletişimiyle eşlenmelidir; bu dilimde hata gizlenmez veya işlem sürdürülmez.

`LOCAL_STATIC`: DB build/typecheck, API ve worker typecheck, tenant-db erişim,
mevcut measurement baseline (3 görev × 5 örnek) ve diff kontrolleri PASS. Ölçüm yeniden
toplanmadı; bu DB değişikliği mevcut web ölçüm özetini geçersiz kılmadı.
`LOCAL_TEST`: API helper ve doğrudan tüketiciler 125/125; tam API 1187 PASS / 4 SKIP,
tam DB 76/76 ve tam worker 220/220 PASS. Lock çakışması,
farklı kurum, readonly sorgu, reentrant sırası, callback engeli, rollback/connection-loss,
malformed sonuç ve erken completed temizliği injected SQL/lock modeliyle doğrulandı.
Bu model PostgreSQL sunucusu üzerinde gerçek paralel lock/bağlantı kesilmesi kanıtı değildir.
`EXTERNAL_NOT_RUN`: gerçek PG yarış/oturum kesilmesi, migration/deploy/reset/provider çağrısı.
`CI`, `STAGING`, `PRODUCTION`: bu dilim için `UNPROVEN`; Gate 6 **BLOCKED** kalır.

## Gate 6C — HTTP, dosya ve queue kabulü / kalıcı işlem kaydı (2026-09-07)

Tek yazıcı backend uygulama ajanıdır. Bu dilim HTTP ömrü, üç S3 yazma/silme adaptörü,
BullMQ/PDF üretici ve ortak worker sınırı, bunların DB activity tablosu, bağlı sözleşme,
katalog/RLS/evidence ve test dosyalarıyla sınırlıdır. Canlı veri, deploy, provider,
secret/config ve bağımsız UI akışı değiştirilmedi. Önizlemenin yeni tablo ve engel kodunu
okuyabilmesi için yalnız bağlı sistem API etiketleri eklendi.

- Yeni `TenantMutationActivity` tablosu yalnız devam eden veya sonucu belirsiz işleri
  tutar: tenant, yaşam döngüsü sürümü, işlem türü ve RUNNING/UNCERTAIN. Ham istek, dosya
  anahtarı, kişi bilgisi veya provider payload'ı tutulmaz. TTL/süre aşımıyla otomatik
  temizleme yoktur; kayıp süreç veya belirsiz dış etki operatör uzlaştırması gerektirir.
- Admission, Gate 6B paylaşımlı kilidi ve Tenant FOR SHARE altında ACTIVE ve yakalanmış
  sürümü doğrular; kayıt commit olmadan callback başlamaz. HTTP/S3/queue admission ayrıca
  güvenilir oturum/kullanıcı/üyelik sürümünü aynı transaction'da doğrular. Böylece eski
  doğrulanmış JWT'nin reset sonrasında yeni kurum sürümünü yakalaması da yetki sağlamaz.
- Global HTTP interceptor yalnız doğrulanmış tenant bağlamındaki POST/PUT/PATCH/DELETE
  işlemlerini sarar. Gerçek controller observable/promise bitene dek kayıt kalır;
  istemci bağlantısının kapanması kaydı erkenden çözmez. Callback hatası UNCERTAIN bırakır;
  hata 4xx olsa bile daha önce yan etki olmuş olabileceği için otomatik olarak güvenli sayılmaz.
- Doğrulanmış callback başarısında kayıt transaction içinde silinir; kalıcı her-istek geçmişi
  birikmez. DELETE commit yanıtı kaybolursa başarı dönülmez. Kayıt kalmış olabilir veya
  commit olmuş olabilir; ikinci durumda yokluğu güvenlidir çünkü beklenen iş zaten bitmiştir.
  Cleanup oturumu yeniden doğrulamaz: logout/suspend sonrası biten iş de kaydını kapatabilmelidir.
- Homework dosyası, destek eki ve raw-import S3 PUT; raw-import DELETE ayrı activity kullanır.
  Controller dış etki hatasını yakalayıp başarı dönse bile içteki UNCERTAIN kaydı korunur.
  Raw-import key'nin kodlanmış tenant bileşeni güvenilir context tenantıyla eşleşmelidir.
- Genel BullMQ Queue.add/retry ve GET üzerinden çağrılabilen ayrı PDF queue üreticisi aynı
  güvenilir yaşam döngüsü sürümünü server-side damgalar. Caller sürümü kullanılamaz.
  Redis dedupe eski job döndürürse tenant/sürüm doğrulanır ve stale job retry edilmez;
  job ID şekli ve mevcut status okuyucuları değiştirilmez.
- Altı normal worker ve ayrı PDF worker girişinde ACTIVE/sürüm admission uygulanır.
  Versionsız legacy veya eski yaşam döngüsündeki job processor'a ulaşmaz. Üretim worker
  PostgreSQL kullanır; test runner enjeksiyonu üretim entrypoint'inde verilmez. Worker poolu
  workerlar durduktan sonra kapatılır. API'nin mevcut resolverı production'da memory flaglerini yok sayar.
- Reset önizleme, worker başlangıcı, purge, dosya aşaması ve final aktivasyon kalan activity
  kayıtlarını kontrol eder. Reset workerının tabloyu silme veya güncelleme yetkisi yoktur.
  Yeni `MUTATION_ACTIVITY_PRESENT` önizleme engeli sayımla gösterilir.
  `TENANT_DATABASE_BUSY` ve admission hataları artık sabit kodlu 503 yanıtıyla döner.

Bu bir **yerel kabul/izleme sınırıdır; tam provider drain kanıtı değildir**. Başarılı
adapter promise'i beklenen çağrının döndüğünü kanıtlar; asenkron provider tarafındaki tüm
işlerin/delivery'nin sona erdiğini tek başına kanıtlamaz. `WRITE_QUIESCENCE_UNVERIFIED`
ve önizleme `allowed:false` korunur. Canlı reset ve pilot başlatılmadı.
SMS/notification adaptörleri bazı provider hatalarını reject yerine `status: failed`
sonucuyla döndürebilir; SMS işi failedCount ile tamamlanabilir. Bu çözümlenmiş sonuçlar
otomatik UNCERTAIN üretmez. Gate 6D provider sonuç sınıflandırması ve uzlaştırmasını
ayrıca tamamlamalıdır; burada her provider hatasının kaydedildiği iddia edilmez.

Sonraki Gate 6D'nin somut kapsamı:

1. Tenant bağlamı oluşmadan çalışan login/refresh/password-reset/activation yolları ile
   system-admin/global bypass mutasyonlarını gerçek hedef kurum ve başlangıç sürümüne bağlamak.
   Özel auth/audit/identity transaction yardımcıları yalnız sarılmış tenant HTTP içinde
   çağrıldıkları ölçüde bu lifetime kaydı kapsamındadır; bağımsız/global kullanım henüz kapsanmaz.
2. `secret-delivery-outbox.ts` global claim/expire/delivery ack akışına üretim anında tenant ve
   lifecycle provenance bağlamak; eski/global kaynakları fail-closed uzlaştırmak. Bu turda
   outbox veya pre-auth akışlarına güncel sürüm uydurulmadı.
3. UNCERTAIN kayıtları için gerçek PG/S3/queue/provider sonucunu doğrulayarak yetkili uzlaştırma
   yolu ve provider kabulü ile gerçek tamamlanma arasındaki sınırı kapatmak. Sırf yaşlandı,
   bağlantı kapandı veya daha sonra retry başarılı oldu diye eski belirsizlik silinmez.
4. Gerçek iki-tenant yarış, kesilmiş HTTP/PG bağlantısı ve belirsiz provider deneyiyle kapsamı
   doğrulamak. Ancak tüm yazma yolları bağlandıktan sonra quiescence guard açılabilir.

Temkinli sınır: doğrulanmış tenant HTTP hataları, hiç dış etki olmamış olsa bile
UNCERTAIN kayıt bırakabilir. Bu kayıtları güvenli sonuç kanıtı olmadan otomatik temizleyen
bir kestirme eklenmedi. Geçmiş/legacy queued job'ların versionsız olması da otomatik olarak
geçerli kabul edilmez; release öncesi uzlaştırılmalıdır.

Gate 6C doğrulaması:

- `LOCAL_STATIC`: shared/DB/API/worker/web typecheck ve build kontrolleri; Prisma/RLS
  (66 tenant tablosu), reset katalog (73 toplam tablo), tenant-db erişim, OpenAPI
  (245 path), bağlı evidence template ve diff kontrolleri PASS. Örnek RLS/evidence
  dosyalarındaki sayımlar yeni tabloyla eşitlendi; bunlar gerçek DB deneyi değildir.
- `LOCAL_TEST`: tam API **1195 PASS / 4 SKIP** (150 dosya PASS / 3 SKIP), tam DB
  **87/87**, tam worker **222/222**, fresh-build Playwright **38/38** PASS.
  Üretimde memory bayrağının etkisizliği, eski/current-epoch fakat iptal edilmiş oturum,
  HTTP unsubscribe, S3 key sahipliği, eski Redis dedupe payload'ı, stale/legacy worker,
  kalıcı belirsizlik ve kayıp commit yanıtları gerçek adapter + injected SQL ile doğrulandı.
- İlk tam API çalışmasında mevcut user-management e2e testinin `/auth/login` adımında
  tek 403 görüldü (1194 PASS / 1 FAIL / 4 SKIP). Kaynak değiştirilmeden ilgili dosya ve
  yeni HTTP testleri birlikte **22/22**, ardından tam API tekrarı **1195 PASS / 4 SKIP**
  geçti. Bu ilk geçici başarısızlık gizlenmedi; auth davranışı veya test eşiği gevşetilmedi.
- `LOCAL_SYNTHETIC`: bağlı iki önizleme etiketi kaynak özetini değiştirdiği için canonical
  `web:measurement-baseline:collect` çalıştırıldı; 3 görev × 5 örnek ve kontrol PASS.
  Baseline hash'i elle değiştirilmedi. Bu canlı performans veya release kanıtı değildir.
- `CI`, `STAGING`, `PRODUCTION`: bu yeni dilim için `UNPROVEN`.
  `EXTERNAL_NOT_RUN`: migration uygulama, gerçek PG concurrency/connection-loss,
  S3/Redis/provider hata enjeksiyonu, deploy, canlı reset ve pilot. Önceki iki görsel
  golden farkı bu kapsamda değiştirilmedi; tam CI PASS iddiası yoktur.

Gate 6C yerel kapsamı tamamlandı. Gate 6D yukarıdaki kaynak ve provider uzlaştırma
sınırlarını kapatmalıdır; ana Gate 6 hâlâ **BLOCKED**.

## Gate 6D — eski yetki kanıtı ve belirsiz gönderim tekrarları (2026-09-07)

Yerel kapsamın tek yazıcısı backend uygulama ajanıdır. Bu dilim auth/session/password-reset,
invitation kabulü ve outbox üreticileri; system tenant profil/durum/lisans işlemleri;
notification/SMS gönderimi ve worker tekrar sınırı; metadata tanısı ve bağlı DB/evidence
sözleşmeleridir. Başka UI akışı, canlı veri, secret/config, deploy veya provider işlemi yapılmadı.

- Worker activity kaydı artık server queueName/jobId referansına ve tenant/epoch/kind'e
  tekil bağlıdır. Aynı RUNNING/UNCERTAIN iş yeni callback veya yeni sağlayıcı gönderimi
  başlatamaz. Aynı key'nin yarışında SQL unique kısıtı da fail-closed davranır. Kayıtlar
  yaşlandıkları için silinmez; BullMQ'nun yeniden denemesi sağlayıcıyı yeniden çağıramaz.
- SMS ve doğrudan notification gönderiminde resolved `failed`, eksik/yanlış alıcı veya
  kanal, eksik makbuz ve eksik sonuç listesi başarı sayılmaz. SMS raporu yazımının ACK
  kaybı artık yutulmaz. Production SMS factory kalıcı Postgres reporter kullanır; başarılı
  mevcut rapor, kayıp Bull completion ACK sonrası tekrarın yeniden SMS göndermesini önler.
- Notification stable referansı caller Idempotency-Key'nin SHA-256 özetidir. Activity,
  `IdempotencyService.run` işleminin tamamını sarar; sağlayıcıdan sonra idempotency response
  commit ACK'si kaybolursa kayıt belirsiz kalır ve aynı key yeniden gönderim yapamaz.
- Outbox kendi PROCESSING/UNCERTAIN kaydını kullanır; ikinci activity tablosuna yazma
  yetkisi verilmez. TENANT/SYSTEM scope ve tenant başlangıç sürümü üreticilerde tutulur.
  Yeni kurumun epoch 0 değeri kendi oluşturma transactionından gelir; legacy kayıtlar
  güncel Tenant sürümüyle doldurulmaz. Provenance DB triggerıyla değiştirilemez.
- Claim, kurum shared advisory kilidi ve ACTIVE/epoch kontrolü altında sabit outbox
  kaydını atomik sahiplenir. Bounded 20 aday, pasif/legacy kurumun diğer kurumları
  engellemesini önler. Kaydın tenant/scope/epoch'u claim sonucunda tekrar doğrulanır.
- Eski PROCESSING stale-reclaim ve belirsiz provider auto-retry kaldırıldı. Expiry/clear
  yalnız hiç denenmemiş PENDING/attempts 0 kaydını güvenli EXPIRED yapabilir. Denenmiş
  veya PROCESSING/UNCERTAIN kayıt ciphertext'i silinse de belirsiz kalır; aynı claim ve
  provenance korunur. Legacy FAILED/EXPIRED + attempts>0 da reset/tanı engeline dahildir.
- Başarıda alıcı/kanalla eşleşen bounded provider receipt kalıcı kayda yazılır. Teslim
  kaydı ACK'si kaybolursa bilinen receipt UNCERTAIN satırında tutulabilir; yeniden gönderim
  yapılmaz. Tarihsel DELIVERED kaydının eski anlamı tek başına yeni terminal sağlayıcı kanıtı değildir.
- Normal login/refresh session yazımı, özgün User/kanonik üyelik sürümünü yeniden doğrular.
  Password rehash eski üyelik sürümüne CAS ile bağlıdır. Password-reset issue/confirm kilit
  sırası Tenant → mevcut user mutex → User/token şeklindedir; anonim yanlış parola veya
  geçersiz token için kalıcı activity açılmaz. Stale reset-request yarışı nötr yanıta döner.
- Password-reset ve email invitation kabulü aynı lookup snapshotından kaynak ve epoch
  alır; validation/hash sonrası AUTH activity, upsert ve audit dahil gerçek mutasyonu sarar.
  Yeni login sessionından sonraki audit de o sessionın geçerliliğiyle admission yapar.
- Çok-kurum seçim challenge'ı özgün membershipVersion ve lifecycleVersion imzalar;
  seçimden önce ikisi de karşılaştırılır. Login MFA challenge'ı özgün membershipVersion'a
  bağlıdır; eski/versionsız parola kanıtı ikinci faktör tüketilmeden reddedilir. Public
  kurum seçeneklerine bu iç sürümler eklenmez; enrollment sürüm kontrolü korunur.
- SYS tenant profil/status/license değişikliği validation/MFA sonrası açık ADMIN activity
  kullanır. ACTIVE/SUSPENDED hedef yalnız bu türde mümkündür; sistem actor doğrulaması için
  scoped bypass ve SYSTEM_ADMIN session/User kontrolü gerekir. Cleanup normal tenant RLS'dir.
  Mevcut lifecycle body CAS/idempotency ve clean-reset'in kendi MFA/durable operation yolu korunur.
- `GET /tenants/:id/reset-diagnostics` SYSTEM_ADMIN için ayrı cursorlarla 50'şer activity ve
  outbox metadata satırı döndürür. Gerçek READ ONLY kullanır; email/token/body/ciphertext veya
  ham caller reference göstermez. Silme, tekrar gönderme veya belirsizlik temizleme endpoint'i yoktur.

Outbox kanıt sözleşmesi v2:

- Secret worker rolü Outbox SELECT/UPDATE ve yalnız Tenant id/status/lifecycleVersion
  SELECT taşır; User SELECT, Tenant diğer kolonları ve Tenant yazma yetkisi reddedilir.
- Salt okunur smoke iki ayrı açıkça verilen private source ID ister: bir UNCERTAIN/tek
  deneme kaydı ve ayrı DELIVERED/tek deneme + receipt kaydı. İlk kayıt silinmez. En az
  300 saniyelik durum yaşı yalnız **gözlenen DB satırı istikrarıdır**; workerın çalıştığını
  veya providerın gizli bir gönderim yapmadığını tek başına kanıtlamaz. Bu tur beklenmedi/çalıştırılmadı.
- Eski aynı kayıt için attempts≥2 retry PASS sözleşmesi artık kabul edilmez. Örnekler ve
  release fixture zamanları yeni ayrı belirsizlik kanıtının gerçek zaman ilişkisini koruyacak
  şekilde güncellendi; bu dosyalar dış ortam kanıtı değildir.

Ana Gate 6 hâlâ BLOCKED: `WRITE_QUIESCENCE_UNVERIFIED` kaldırılmadı. Seçilen kaynak
sınırları yerel uygulanmıştır; bütün platformun sessizliği veya production reset kanıtlanmadı.
Kalan somut kapsam, bağımsız/global kullanılan session revoke/compromise yardımcıları,
MFA sayaç/audit işlemleri, global audit/cleanup ve alternatif activation girişlerinin aynı
lifetime/fence sözleşmesine ait envanteridir. Gerçek PostgreSQL yarış/bağlantı kesilmesi,
S3/queue/provider ve role/grant deneyi ayrıca gerekir.

Yetkili terminal uzlaştırma arayüzü hâlâ eksiktir: `infra/notification-gateway/src/index.mjs`
DurableObject içinde idempotency sonucu saklar, fakat yan etkisiz genel delivery receipt
lookup sunmaz. `/messages/latest` aktivasyon-URL kanıtına özeldir; terminal delivery kanıtı
olamaz. `/send` çağrısını lookup diye tekrar etmek, kayıt yoksa veya 30 günlük kayıt ömrü
bitmişse yeni gönderim yapabilir. Böyle bir çağrı veya checkbox ile UNCERTAIN temizliği
uygulanmadı. Tanı yanıtı bu nedenle `EXTERNAL_PROOF_REQUIRED` olarak kalır.

Gate 6D kanıt ve kapanış:

- `LOCAL_TEST`: son kaynakla tam API **1206 PASS / 4 SKIP** (151 dosya PASS / 3 SKIP),
  tam worker **230/230**, DB **96/96** PASS. Selection/MFA challenge sürümü hedefli
  **55/55**; notification idempotency receipt ACK-kaybı/same-key tek gönderim regresyonu
  dahil hedefli **22/22**; diagnostic/announcement/password reset hedefli **56/56** PASS.
- İlk tam API turu **1193 PASS / 2 FAIL / 4 SKIP** idi: iki eski announcement testi partial
  provider failure'ı tamamlanmış başarı bekliyordu. Yeni güvenli davranışa uygun tüm-receipt
  positive ve partial-failure negative testleriyle doğrulandı. Guard/eşik gevşetilmedi.
  Sonraki selection/MFA incelemesinde bulunan eski parola kanıtı yükseltme boşlukları da
  kapatıldı ve yukarıdaki son tam API turuna dahil edildi.
- `LOCAL_STATIC`: shared/DB/API/worker/web typecheck; DB/API/shared build ve fresh web
  measurement build; Prisma/RLS 66 tenant tablo/katalog 73 toplam tablo; OpenAPI **246 path**,
  tenant-db, idempotency **48 operation**, web token-storage ve diff PASS.
- Outbox v2 checker, aggregate summary, iki örnek ve normalize edilmiş release fixture
  zamanı birlikte güncellendi; `prod:evidence:templates:check` PASS. Örnek kanıtların
  17/17 gibi PASS çıktıları yalnız yerel fixture sözleşmesidir; gerçek dış kanıt değildir.
- `LOCAL_SYNTHETIC`: shared diagnostic DTO kaynak özetini değiştirdiği için canonical
  measurement collect/check yeniden çalıştı: **3 görev × 5 örnek PASS**. Hash elle yazılmadı.
- `admin-mfa:check`, `rate-limit:check`, `security:audit:check` çalıştırıldığında bunların
  statik kaynak checker değil dış kanıt checker olduğu doğrulandı. Sırasıyla
  `ADMIN_MFA_EVIDENCE_TARGET`, `RATE_LIMIT_EVIDENCE_TARGET`, `SECURITY_AUDIT_TARGET`
  verilmediği için exit 1 döndüler. Gerçek kanıtları `UNPROVEN`; örnek hedeflerle canlı
  başarı taklidi yapılmadı. Örnek/sözleşme doğrulamaları üstteki template PASS kapsamındadır.
- `CI`, `STAGING`, `PRODUCTION`: bu uncommitted yeni kaynak için `UNPROVEN`.
  `EXTERNAL_NOT_RUN`: migration/role grant uygulama, gerçek PG concurrency/connection-loss,
  provider iki-kayıt smoke, terminal receipt lookup, deploy, reset ve pilot. Önceki iki
  görsel golden farkı değiştirilmedi; tam CI PASS iddiası yoktur.

Gate 6D'nin seçili uygulama dilimi yerel tamamlandı. Eski selection ve MFA parola
kanıtlarının yeni User sürümüne taşınması artık reddedilir; kalan kapsam bu bilinen
credential-upgrade boşlukları değildir. Bağımsız/global MFA sayaç/audit/cleanup ve
alternatif girişlerin tam yaşam süresi envanteri ile gerçek provider terminal uzlaştırması
henüz kapanmadığından ana Gate 6 **BLOCKED** kalır. Yetkisiz destructive reconciliation
veya quiescence guardını açan bir geçiş eklenmedi.

## Gate 6E — bağımsız auth/audit/cleanup kaynak sınırları (2026-09-07)

Tek yazıcı backend uygulama ajanıdır. Bu dilim mevcut auth/session/password reset,
student-code activation ve audit yardımcıları ile gerçek çağıranlarını sınırlar.
Provider/gateway, schema/migration, secret/config, deploy veya canlı veri değiştirilmedi.
Parola değişiminin mevcut browser refresh beklentisi yeni güvenli oturum davranışıyla
çeliştiği için yalnız providers/api-client/password page ve bağlı login testleri düzeltildi.

| Değişen yüzey | Gerçek çağıran / kapsam | Kaynak ve kapanış kuralı |
|---|---|---|
| `AuthUserStore.enableTotp` | `confirmTotpSetup`, `confirmRequiredTotpEnrollment` | Özgün tenant/üyelik sürümü User CAS; normal tenant shared key → ACTIVE Tenant row → User. System hesabı ayrı User/version CAS. |
| `disableTotp`, counter/recovery tüketimi | `disableTotp`, `verifySecondFactor`; login challenge ve step-up | Asenkron doğrulamadan önce okunan immutable User snapshotı; eski sürüm yeni counter/code/secret'ı değiştiremez. |
| `mfaAttemptKey` | `verifySecondFactorWithAttemptLimit` | Hash materyali tenant/user/özgün üyelik sürümü/purpose içerir. Eski tamamlanma yalnız eski TTL key'ini etkiler. |
| `createTotpSetup`, güvenlik mutasyonlarında `requireOriginalUser` | Authenticated setup, parola değişimi, oturum iptal işlemleri | Context tenant/version, okunan User ile eşleşmelidir; eski context yeni setup proof üretemez. Salt profil/oturum okumaları mutasyon sayılmaz. |
| `updatePassword` | `changeCurrentPassword` | Hash beklenirken yakalanmış sürüm korunur; User CAS ve canonical membership sync. Post-update reread daha yeni sürüme geçmişse yeni nesil yetki döndürülmez. |
| `updatePasswordForReset` + transaction `updateUserPassword` | `confirmPasswordReset` | Admission snapshotı SQL User CAS'ye de taşınır. Memory staged commit de tekrar karşılaştırır. Çakışmada token consume rollback olur. |
| `revokeByUser` | MFA enable/disable, password change, self-PII revoke; TokenService delegasyonu | Önceki User sürümü üst sınırdır; güncellenmiş User.version kullanılarak yeni sessionlar iptal edilmez. PasswordResetTransaction içinde revoke atomik kalır. |
| `revokeOwned` / `revokeAllOwned` | Kullanıcının session yönetimi | Tenant/User ve özgün cutoff; yeni generation sessionları korunur. |
| `revoke` | Logout ve refresh başarısızlığındaki exact session | Değişmeyen session ID'den orijinal tenant/version alınır; shared key sonrası aynı tuple ile UPDATE. Kaybolmuş eski ID başka User/sessiona çevrilmez. |
| `markFamilyCompromised` | TokenService rotate/reuse; consumed token family lookup | Sabit family ID ve yakalanmış tenant/version. Current User lookup'ına genişletilmez; belirsiz cross-tenant family reddedilir. |
| `revokeByMembership` | TokenService membership cleanup | Tenant ve verilen eski-sürüm üst sınırı korunur; shared key'e katılır. |
| `revokeByTenant` | In-memory lifecycle transition; production lifecycle kendi atomik SQL'indedir | Source lifecycleVersion zorunlu; standalone Postgres helper aynı epoch'u doğrular. Memory caller zaten doğrulanmış expected+1 değerini kullanır. |
| UserManagement `setRoles`, in-memory profile deactivation | Tenant admin rol/profil işlemleri | Target'ın aktif session ID/version snapshotı **mutasyondan önce** alınır. Admin actor sürümü target sürümü yerine kullanılmaz. Production profile transactionının atomik iptali korunur. |
| Audit store create | `AuditLogService.record` ve gerçek service çağrıları | Known tenant insert shared key'e katılır; yalnız INSERT. Tarihsel tenant/actor/time yeniden etiketlenmez. Rollback kaybında bağlantı atılır. |
| Student-code `service.accept` + `store.accept` | Public student portal activation | Service ilk tenant id/epoch'u async license kontrolünden önce kopyalar. Store discovery → shared key → aynı epoch Tenant/license rowlock → Student/invitation/counter/upsert. Yanlış kod için activity açılmaz. |

Email invitation kabulü Gate 6D source/activity kapsamındadır. Owner onboarding tek yeni
Tenant/owner/token transactionındadır; yeni tenantın epoch 0 değeri eski kayıttan tahmin
edilmez. TOTP enrollment draft ve selection/login-MFA challenge sürüm kontrolleri korunur.
Platform-account için bu API'de ayrı bir runtime mutation yüzeyi bulunmadı; platform/system
kimliği normal tenant üyeliğine zorlanmadı.

Audit için bilinçli politika istisnası: AuditLog PRESERVE/append-only geçmişidir. Orijinal
işlemi anlatan geç audit, yeni akademik çalışma verisi gibi değerlendirilmez; createdAt,
actor veya tenant güncel epoch'a göre yeniden yazılmaz. Known-tenant INSERT reset exclusive
kilidiyle çakışır; event yazımı başarısızsa hata saklanmaz. Null/system audit ve privileged
bakım/restore işlemleri tenant akademik write-drain sessizliği iddiasına dahil değildir.
Audit UPDATE/DELETE veya eski nesle ait kanıtı yeniden etiketleyen yol eklenmedi.

Bağımsız MFA DB helperları kalıcı activity üretmez; Redis'teki global anonim login/IP
kötüye-kullanım sayaçları platform istisnası olarak aynı kaldı. **Mevcut Gate 6C authenticated
HTTP interceptor** hata sonrasında temkinli UNCERTAIN tutabilir; bu genel HTTP politikası
kaldırılmadı. Her yanlış authenticated parola isteği activity üretmez iddiası yapılmaz.

### Parola değişimi ve yeniden giriş

`providers.changePassword`, başarılı `/me/password` sonrasında eski refresh cookie'sini
kullanıyordu. Üyelik sürümü değiştiği için gerçek refresh reddedilirken sayfa yanlış biçimde
“Şifre değiştirilemedi” gösterebiliyordu; eski UI fixtureı bunu yapay refresh 200 ile gizliyordu.

Başarılı parola değişiminde bütün **eski cutoff** sessionları kapatılır; kullanılmayan
`revokeByUserExcept` gerçek caller taraması sonrası kaldırıldı. Client tek actor-bound POST
kullanır; otomatik refresh/replay yoktur. Confirmed success sonrası yalnız aynı remembered
actor/session/version yerel auth/cache temizliğine uygundur; React functional setter da
başka/yeni actor'ı korur. HTTP cevabı gecikirken yapılmış yeni login'i kapatan network logout
veya refresh gönderilmez. Zaten null client auth temizlenmiş kabul edilir. Başarısız parola
UPDATE'sinde auth korunur; güncel auth state yeniden login yönlendirmesini belirler.

### Gate 6E son kanıt ve kapanış

- `LOCAL_TEST`: Son kaynakta tam API **1216 PASS / 4 SKIP** (152 dosya PASS, 3 dosya SKIP).
  Kaynak sınırı regresyonları **72/72**; son parola/student activation ve değişmeyen support
  hedefli tekrarı **42/42** geçti. Eski kurum/üyelik sürümü, MFA sayaç namespace'i, token
  transaction CAS, eski family/cutoff, lisans beklenirken değişen kurum epoch'u ve yeni
  parola login'inin eski revoke'dan korunması doğrulandı.
- Bir önceki tam API çalışmasında support-ticket testinde `socket hang up` görüldü
  (**1214 PASS / 1 FAIL / 4 SKIP**). İlgisiz support kaynağı değiştirilmedi; hedefli
  tekrar ve yukarıdaki son tam API çalışması geçti. İlk dar çalışmalardaki eski SQL
  parametre/snapshot fixture beklentileri yalnız değişen sözleşmeye göre düzeltildi.
- `LOCAL_TEST`: Son Next auth/a11y seçimi **13/13**, `web:a11y:check` **11/11** ve
  `web:auth-contract:check` **17/17** PASS. Parola UPDATE hatası auth'u korur;
  confirmed success login'e döner; eski cookie ile refresh/logout yoktur. Geciken eski
  yanıt yeni remembered actor/cache'i silemez; zaten null auth güvenle temizlenmiş sayılır.
- `LOCAL_STATIC`: API typecheck/build, web typecheck, OpenAPI **246 path**, tenant-db,
  idempotency **48 operation**, web token-storage, web UX baseline ve `git diff --check`
  PASS. Tenant-db checker yalnız ilgili dosyanın incelenmiş `withAuthMutationQuery`
  wrapper'ını tanır; kaldırılmış doğrudan MFA bypass izinleri listeden çıkarıldı.
- `LOCAL_SYNTHETIC`: Son web kaynağıyla canonical measurement collect/check **3 görev ×
  5 örnek PASS**; baseline elle hash yazılmadan üretildi. Shared DB/worker kaynağı bu
  dilimde değişmediğinden önceki **DB 96 / worker 230** kanıtı tekrar çalıştırılmadı;
  bunlar Gate 6D sonuçlarıdır, yeni Gate 6E çalışması olarak sunulmaz.
- `EXTERNAL_NOT_RUN` / `UNPROVEN`: Gerçek PG yarış/connection-loss, Redis/provider
  terminal receipt uzlaştırması, deploy/reset/pilot çalıştırılmadı. Önceden eksik hedefle
  kalan MFA/rate-limit/security audit dış kanıtları örneklerle doldurulmadı.
  `CI`, `STAGING`, `PRODUCTION` bu dirty kaynak için kanıtlanmadı; önceki iki görsel
  golden farkı bu dilimde değiştirilmedi.

Gate 6E'nin seçili kaynak sınırları yerel olarak tamamlandı. Envanterdeki append-only
audit ve platform sayaç istisnaları tam platform sessizliği anlamına gelmez. Gerçek
dağıtık drain kanıtı ve sağlayıcının yan etkisiz terminal teslimat doğrulaması hâlâ
eksiktir; `WRITE_QUIESCENCE_UNVERIFIED` kaldırılmadı. Kurum yetkilisinin talebi reset
yetkisinin kaynağıdır, tek başına canlı reset izni değildir. Bu kapıda duruldu.

## Gate 6F — kayıtlı gateway kabul sonucuna yan etkisiz erişim (2026-09-07)

Kapsam gateway'in exact `/receipts` GET ve DO `/receipt` GET yolu, notification adapter'ın
bağımsız lookup fonksiyonu, mevcut reset tanı API'sindeki outbox receipt GET, shared/OpenAPI
sözleşmesi, testler ve bağlı runbook'tur. Yeni bağımlılık, schema/migration, UI veya
provider SDK eklenmedi. Send/retry/clear işlemi, deploy, secret/config veya canlı veri
değişimi yapılmadı.

DO bilinmeyen path/method için sendMessage'e düşmez; yalnız `/send` POST mevcut gönderim
yoludur. Dış gateway'in legacy gönderim route sözleşmesi korunur. Yeni send record'larının
var olan iki put payloadına tek kez yakalanmış createdAt/expiresAt/keyHash eklendi; alarm
aynı expiry'yi kullanır. Legacy record'a metadata geri doldurulmaz. Read akışı salt get
yapar; miss, invalid ve expired durumda da dispatch, put, setAlarm veya delete yapmaz.
Bearer zorunludur; endpoint response ve adapter fetch cache kapalı, redirect reddedilir.

API SYSTEM_ADMIN ve kurum yetkisi sonrası gerçek `READ ONLY` sorguyla exact outbox ID +
tenant eşleşmesini bulur. `sourceScope=TENANT` ve kayıtlı özgün epoch olmadan gateway
çağrılmaz; güncel Tenant epoch'u okunup eski kayda mal edilmez. Key caller'dan alınmaz,
`secret-delivery:<outbox.id>` olarak türetilir. Yerel receipt hash eşleşirse
`LOCAL_RECEIPT_MATCH`, yerel receipt yoksa `KEY_ONLY`; uyuşmazlık `UNVERIFIED` kalır.

Sonuç `PROVIDER_ACCEPTED` olsa bile yalnız gateway'in anahtar altında sakladığı sağlayıcı
kabulünü gösterir. KEY_ONLY tam payload korelasyonu değildir ve hiçbir kabul terminal
teslimat kanıtı değildir. Legacy/bozuk kayıt `UNVERIFIED`, bulunamayan `NOT_FOUND`, expired
`EXPIRED`, failed/eksik receipt `UNCERTAIN`, lookup erişim sorunu `UNAVAILABLE` sınıfındadır.
Strict response yalnız beş gateway alanı, canonical ISO zamanlar ve hash doğrular; API
adres/body/token/raw receipt/fingerprint döndürmez. Her durumda reconciliation
`EXTERNAL_PROOF_REQUIRED` kalır; outbox/activity satırı değişmez.

Bu dilim yapılandırılmış notification gateway üzerinden **secret-delivery outbox**
kayıtlarını okur. Genel SMS/announcement kayıtlarının veya gerçek provider terminal
teslimat durumunun sorgusu değildir; bu alanlar için lookup otoritesi icat edilmedi.

### Gate 6F son kanıt ve kapanış

- `LOCAL_TEST`: Gateway **39/39** (önceki 35 + 4 yeni test), adapter **25/25**, tenant
  service/controller hedefli **51/51**, son tam API **1220 PASS / 4 SKIP**. Yanlış bearer,
  kurum, key ve legacy provenance lookup'tan önce reddedilir. DO missing/invalid/expired/
  success okumalarında yalnız get gözlendi; put/alarm/delete/provider çağrısı sıfırdır.
  Yanlış path/method send'e düşmez. Yeni send sonrası ardışık read aynı expiry/sonucu
  döndürür ve ikinci gönderim yapmaz. Bozuk HTTP200 şekli/tarihi/keyHash/receipt ve
  yerel receipt uyuşmazlığı başarı sayılmaz.
- `LOCAL_STATIC`: API/shared-types/notification-adapter typecheck ve build, OpenAPI
  **247 path**, tenant-db, idempotency **48 operation**, token-storage ve diff PASS.
- `LOCAL_SYNTHETIC`: Shared sözleşme kaynak digest'ini değiştirdiği için ilk measurement
  check mismatch verdi; canonical collect/check **3 görev × 5 örnek PASS** ile yenilendi.
  Baseline hash elle yazılmadı; UI/golden kaynağı değiştirilmedi.
- DB/worker uygulaması bu dilimde değişmedi; tam DB/worker testi tekrar edilmedi.
  `CI`, `STAGING`, `PRODUCTION`: bu dirty kaynak için `UNPROVEN`.
  `EXTERNAL_NOT_RUN`: gateway deploy, gerçek GET/provider lookup, gönderim/retry,
  DB/veri mutasyonu, gerçek PG/Redis drain, reset/pilot. Mevcut dış MFA/rate-limit/security
  evidence eksikleri ve iki önceki görsel golden farkı bu dilimde kapatılmadı.

Gate 6F yerel olarak tamamlandı. Bu sonuç kabul kaydının salt okunabildiğini kanıtlar;
terminal teslimat veya güvenli destructive reconciliation kanıtı değildir. Hiçbir
outbox/activity belirsizliği temizlenmedi; `EXTERNAL_PROOF_REQUIRED` ve
`WRITE_QUIESCENCE_UNVERIFIED` durur. Kurum talebiyle başlayan reset akışı canlıda halen
kapalıdır. Commit/push/deploy yapılmadı; bu kapıda duruldu.

## Gate 6G — gerçek geçici PostgreSQL denemesinin hazırlığı (2026-09-07)

Bu kapı **çalıştırma değil, incelemeye hazır artifact** üretir. Tek yazıcı yalnız
`scripts/tenant-reset-postgres-drill.mjs`, bağlı `.test.mjs`, bu planlar ve runbook'tur.
Üretim kaynakları, guard, schema, migration, provider/gateway veya UI değiştirilmedi.
AGENTS.md canlı/geçici DB veri yazımı için açık kullanıcı onayı ister; `--execute` bayrağı
bu onayın yerine geçmez. Bu turda Docker start/pull/run veya DB işlemi yapılmadı.

Varsayılan dry-run **116 gerçek migration dosyası ve SHA256**, gerçek source digest ve
**11 senaryo** listeler; Docker/DB/runtime importu yapmaz. Gerçek mode yalnız onaylı
`default`/`desktop-linux` veya ayrı `colima-o-okul-reset-drill` context ve bilinen yerel Unix socket'te, context inspect exact
eşleşmesiyle açılır. Image `postgres:16`, `--pull=never`; eksik daemon/image önkoşuldur.
Ambient connection/loader override ve caller DATABASE_URL kabul edilmez. Fresh nonce/name/
label container yalnız loopback random port ve tmpfs kullanır; host DB mount edilmez.

| Gerçek çalıştırmada senaryo | Kullanılacak gerçek sınır | Kanıtın sınırı |
|---|---|---|
| Shared/exclusive ve başka kurum | `withTenantDb`, canonical key, runner ile aynı parameterized exclusive SQL; iki bağlantı | Tam HTTP/S3/Redis drain değildir. |
| Salt okuma ve session loss | PostgreSQL READ ONLY, `pg_terminate_backend`, süreli lock-release gözlemi | Dış provider işleminin durduğu anlamına gelmez. |
| App RLS/reset worker/secret worker | Ayrı login bağlantıları, `current_user=session_user`, gerçek `assertResetWorkerRole` | SET ROLE taklidi yok; üretim DSN kanıtı değildir. |
| Reset request/outbox guardları | Repo migration trigger/check/grantları üzerinde sentetik kayıtlar | Kurum talep UI/authority bütün akışı veya purge çalışmaz. |
| Eski epoch ve üyelik sürümü | Gerçek `runTenantMutationActivity`, `PostgresAuthUserStore.markTotpCounterUsed` | Epoch/member geçişi sentetik fixture'dır, full reset değildir. |

Bootstrap sadece fresh DB rolleri ve o çalışmaya ait üretilmiş login parolalarını kurar;
grants repo migration'larından gelir. Onaylı runtime denemesinde doğrudan SQL yöntemi
`_prisma_migrations` bağımlılığı nedeniyle bırakıldı. İzole, `.env` yüklemeyen geçici
config ile gerçek **Prisma migrate deploy** çalışır; başarılı ledger kayıtları ve
checksum'ları 116 dosyanın manifestiyle karşılaştırılır. Tam reset snapshot/backup/restore
kanıtı değildir. Shared/db
build sonrası mevcut kaynaklar repoda kurulu tsx ile yüklenir; dependency eklenmez.

Başlangıç ve final source/migration hashleri aynı olmalıdır. Başarıda yalnız tekrar
ID/name/nonce/image/tmpfs/loopback doğrulaması yapılmış kendi container'ı silinir. Başarısız
veya cevabı belirsiz yaratma otomatik retry/cleanup yapmaz; salt güvenli metadata içeren
run-unique kanıt dosyası bırakır. Sabit phase/scenario etiketi başarısız adımı gösterir.
Parola Docker'a izole child env ile gider; argv/kanıtta parola/DSN/log body yazılmaz;
tmpfs kalıcı backup değildir.
Somut komut ve operasyon sınırları [runbook'tadır](phase-6-ops-runbook.md).

`LOCAL_STATIC` / `LOCAL_TEST`: `node --check`, default dry-run ve **6/6** Node testi PASS.
Dry-run subprocess PATH'inde Docker/pg araçları yokken manifest üretti; bilinmeyen/çelişen
flag, remote/yanlış socket, ambient env override, yanlış container label/ID/image/mount/
port reddi doğrulandı. Bunlar SQL/RLS/concurrency runtime PASS olarak sunulmaz.

`EXTERNAL_NOT_RUN`: Docker başlatma/pull/container yaratma, DB migration/fixture/write,
gerçek PG rolleri/kilit yarışları, provider/Redis/S3/deploy/reset. `LOCAL_RUNTIME` henüz
**NOT_RUN**, `CI`/`STAGING`/`PRODUCTION` **UNPROVEN**. Gate 6G hazırlığı tamamlandığında
yalnız somut disposable hedefin çalıştırma onayı istenir; ana Gate 6 ve
`WRITE_QUIESCENCE_UNVERIFIED` kapalı kalır.


### Gate 6G — onaylı CLI çalıştırma sonucu (2026-09-07)

Yukarıdaki NOT_RUN kaydı hazırlık anına aittir. Kullanıcı geçici DB deneyini açıkça
onayladı ve Docker Desktop yerine CLI istedi. Kurulu Colima ile ayrı
`o-okul-reset-drill` profili oluşturuldu (2 CPU, 3 GiB RAM, 10 GiB disk, host mount yok,
aktif context değiştirilmedi). Varsayılan Colima profili kapalı kaldı. PostgreSQL 16
imajı yalnız bu profil için indirildi.

İlk deneme `42P01` ile `_prisma_migrations` eksikliğinde durdu; runner gerçek Prisma
migrate deploy ve checksum doğrulamasına geçirildi. İkinci denemede session termination
bildirimi gelmeden bağlantı havuza bırakılıyordu; kapanış bildirimi beklenerek düzeltildi.
Pool hata olayları ham bağlantı bilgisini yazdırmadan denemeyi başarısız kılar.
İki başarısız denemenin konteynerleri kimlik/name/nonce/image/tmpfs/port doğrulamasından
sonra manuel temizlendi; ayrı review kayıtları ilk sonucu silmeden tutuldu.

**LOCAL_RUNTIME PASS:** `artifacts/tenant-reset-postgres-drill/d36575d9b02329266601c43f.json`.
116 migration gerçek Prisma ile uygulandı; ledger ad/checksum eşleşti. Ortak/özel kilit,
başka kurumun ilerlemesi, READ ONLY, session-loss unlock, app RLS, reset ve secret worker
izinleri, request değişmezliği, outbox belirsizlik/provenance, eski epoch ve User-version
CAS olmak üzere **11/11 senaryo PASS**. Kaynak hash'i başlangıç/final aynı:
`3f75ecc1f9c2659d5abf224b83ed1699c8439012918d0b8ce88a685bb80acbaa`.
İmaj: `sha256:f1c3376c26f2609ab9f29f71f824103fe2fcd8ee0346485cb6122a4f93df6f94`.
Başarılı container otomatik kaldırıldı; profilin container listesi boş doğrulandı.

`LOCAL_STATIC`/`LOCAL_TEST`: 6/6 guard testi ve `git diff --check` PASS.
`ops:check`, `prod:plan:check`, `prod:evidence:templates:check` PASS; template içindeki
örnek staging/production sonuçları canlı kanıt sayılmaz. Çalışma sonunda ayrı Colima
profili durduruldu; profil ve imaj önbelleği diskte bırakıldı.
`CI`, `STAGING`, `PRODUCTION`: **UNPROVEN**. `EXTERNAL_NOT_RUN`: Redis/S3/provider,
backup/restore, tam reset, deploy ve pilot. Gate 6G yerel PG kapsamı tamamlandı;
ana Gate 6 ve `WRITE_QUIESCENCE_UNVERIFIED` kapalı kalır. Sıradaki kapsam gerçek
queue/provider işlerinin duraklatılması ve belirsiz teslimatların terminal uzlaştırılmasıdır.


## Gate 6H — gerçek Redis/BullMQ admission ve belirsiz gönderim deneyi (2026-09-07)

Kullanıcının sonraki adıma açık onayıyla tek yazıcı yalnız deney scriptleri, bağlı test
ve gate/runbook belgelerini değiştirdi. Üretim API/worker kodu, schema/migration,
provider ayarı, deploy ve canlı kayıtlar değişmedi. Ayrı yerel Colima profili kullanıldı.

`scripts/tenant-reset-postgres-drill.mjs --with-queue` mevcut PostgreSQL deneyine
`scripts/tenant-reset-queue-drill.mjs` içindeki beş senaryoyu ekler. Varsayılan ve
`--with-queue` dry-run Docker/DB/provider çağırmaz. `--execute` hâlâ açık onay gerektirir.
Redis 7 kendi nonce/name/label, yalnız loopback rastgele port, tmpfs `/data`, 256 MiB
bellek ve üretilmiş parola ile başlar. Parola argv/kanıta yazılmaz. Başarılı temizlikte
ID/image/label/tmpfs/port tekrar doğrulanır; başarısızlıkta kör yeniden deneme/silme yoktur.

Gerçek `createSmsBatchBullWorker`, BullMQ Queue, `runTenantMutationActivity`,
`requireNoTenantMutationActivity` ve `processSmsBatchJob` kaynakları kullanıldı.
SMS adapter'ı yerel olarak kabul-sonrası-zaman-aşımı varsayımını üretir; gerçek HTTP
isteği veya mesaj yoktur. Tenant durum/sürüm geçişleri doğrudan sentetik fixture SQL'idir;
bu çalışma production suspend API, worker process crash veya tüm queue türlerinin
uçtan uca deneyi değildir. Ortak admission sınırı SMS kuyruğu üzerinden doğrulandı.

| Senaryo | Sonuç |
|---|---|
| İş çalışırken reset kontrolü | Kalıcı activity kaydı `RESET_MUTATION_ACTIVITY_PRESENT` ile engelledi. |
| Kurum askıya alındığında | Yeni iş callback'e ulaşmadı; diğer kurumun işi tamamlandı. Devam eden iş bitene kadar reset engeli kaldı; callback bitince activity temizlendi. |
| Kurum yeniden açıldığında eski epoch | `TENANT_ACTIVITY_STALE`; callback çağrılmadı. |
| Sağlayıcı zaman aşımı ve otomatik retry | Adapter bir kez çağrıldı. İkinci BullMQ girişimi `TENANT_ACTIVITY_UNRESOLVED` ile durdu; üç deneme hakkı olsa da üçüncü otomatik gönderim olmadı. |
| Manuel job retry | Adapter çağrı sayısı yine bir; özgün `UNCERTAIN` satırı ve reset engeli korundu. |

**LOCAL_RUNTIME PASS:** `artifacts/tenant-reset-postgres-drill/06ba96e3564d98081fb13ad4.json`.
116 migration gerçek Prisma/ledger checksum doğrulamasıyla, önceki 11 PG senaryosu ve
**5/5 kuyruk senaryosu** aynı çalışmada geçti. Source digest artık worker/SMS/notification
kaynaklarını ve queue drill dosyasını da içerir; başlangıç/final eşleşmesi:
`476e2c5c1b0dfc973f67d677999caee9d543991712c80678169e9b60cad01176`.
Redis imajı: `sha256:71da9275c5f3fcb97d0fa0c8c5b36cc995327265420f17a04bfd544f458059f7`.
İlk denemede fixture job ID `active`, BullMQ'nun kendi key'iyle çakıştı. `drill-*`
kimlikleriyle düzeltildi; ilk FAIL kanıtı ve manuel temizleme review kaydı korundu.
Son başarılı PostgreSQL/Redis konteynerleri otomatik kaldırıldı; profilin container
listesi boş doğrulandı.

`LOCAL_TEST`: **8/8** Node guard/dry-run testi PASS. `LOCAL_STATIC`: syntax ve diff
kontrolü, `ops:check` (plan kontrolü dahil) ve `prod:evidence:templates:check` PASS.
Şablonlardaki örnek sonuçlar canlı kanıt değildir. Deney sonunda Colima profili
durduruldu; önbellekteki imajlar korundu. `CI`, `STAGING`, `PRODUCTION`: **UNPROVEN**.
`EXTERNAL_NOT_RUN`: gerçek provider terminal receipt, gateway deploy, S3, worker crash,
full reset/restore ve pilot. Üretimde tüm yazıcıların durduğu kanıtlanmadı;
`WRITE_QUIESCENCE_UNVERIFIED` kaldırılmadı. Yerel Gate 6H kapsamı tamamlandı.

Sıradaki dar kapsam: sağlayıcının kesin teslimat/başarısızlık bilgisini özgün gönderimle
bağlayan salt okuma doğrulaması. Gateway `PROVIDER_ACCEPTED`, süre aşımı, NOT_FOUND veya
queue failed durumu terminal teslimat kanıtı sayılamaz; bunlarla activity/outbox silinmez.


## Gate 6I — gerçek sağlayıcı sonucu erişim önkontrolü (2026-09-07)

**BLOCKED; tamamlanmadı.** Kullanıcı sonraki salt okuma adımını onayladı. Tek yazıcı
yalnız bu gate kaydı, ana plan, runbook ve güvenli metadata artifact'ını güncelledi.
Üretim kodu, env/secret, gateway deploy veya DB kaydı değişmedi.

Kaynak incelemesi: notification gateway EMAIL binding dönüşündeki messageId'yi
providerMessageId olarak döndürür; outbox başarılı ACK'de bu kimliği saklar.
Mevcut GET /receipts sadece gateway kabulünü ve hash'ini verir; kesin teslimat değildir.
WhatsApp config'te kapalıdır; bu tespit canlı config doğrulaması değildir.

[Cloudflare Analytics belgesi](https://developers.cloudflare.com/email-service/observability/metrics-analytics/)
zone düzeyindeki emailSendingAdaptive dataset'ini, Analytics Read gereksinimini ve
31 günlük saklamayı açıklar. [Yaşam döngüsü belgesi](https://developers.cloudflare.com/email-service/concepts/email-lifecycle/)
delivered sonucunu alıcı sunucunun kabulü; deliveryFailed sonucunu kalıcı hata veya
yeniden deneme sınırının tükenmesi olarak tanımlar. Okundu/insan tarafından görüldü
anlamına gelmez. Geçici hata ve olay bulunamaması kesin sonuç değildir.

Canlı erişim denemesi: mevcut yerel Wrangler OAuth oturumuyla yalnız o-okul.com zone
lookup GET çağrıldı; HTTP 403, provider code 9109. Kayıtlı token bitişi
2026-09-07T12:32:18.694Z, mevcut zamandan önce; kayıtlı scope listesinde analytics yok.
403'ün tek nedeni kesinleştirilmedi. Token/refresh token çıktıya veya artifact'a
yazılmadı; credential refresh/yeni yetki verme yapılmadı.
Kanıt: `artifacts/tenant-reset-provider-preflight/2026-09-07T19-39-19-403Z.json`.

Devam için o-okul.com'a ait geçerli Analytics Read erişimi gerekir (zone keşfi
kullanılacaksa Zone Read de gerekir). Sonra mevcut outbox/gateway kaydından tenant,
özgün epoch, gönderim zamanı ve providerMessageId salt okunarak bağlanmalı; messageId
ile aynı zone/sendingDomain/zaman aralığındaki gerçek sağlayıcı olayı doğrulanmalı.
Alıcı/subject/body/token dış kanıta çıkarılmaz; yalnız hash ve durum kullanılır.
Olay sorgusunun filtre/şema/sampling sınırları canlı şemayla kontrol edilmeden
absence veya kesilmiş liste kesin sonuç sayılmaz. ACK kaybında provider kimliği
bulunamıyorsa payload/kurum korelasyonu uydurulmaz.

LOCAL_STATIC: kaynak/kontrat incelemesi yapıldı. LOCAL_TEST: kod değişmedi, yeni test
gerekmiyor. Sağlayıcı erişim denemesi FAIL; terminal olay sorgusu EXTERNAL_NOT_RUN.
CI/STAGING/PRODUCTION teslimat ve reset kanıtı UNPROVEN. Hiçbir gönderim/retry,
activity/outbox silme veya reset yapılmadı. WRITE_QUIESCENCE_UNVERIFIED korunur.


### Gate 6I — tarayıcı ve DNS ile sağlayıcı ayrımı (2026-09-07)

Kullanıcının açtığı Cloudflare oturumunda salt okuma kontrolü yapıldı. Email Routing
sayfası onboarding gösterirken **Email Sending** listesinde o-okul.com **Enabled**,
DNS **Configured**, Emails sent **4** göründü. Bu sayaç belirli bir reset/outbox
gönderiminin terminal sonucu değildir.

Aynı anda public DNS: MX `1 smtp.google.com.`, SPF `v=spf1 include:_spf.google.com ~all`.
Gelen postanın Google'a yönlendirildiği doğrulandı; Google Workspace aboneliği veya
posta kutuları ayrıca incelenmedi. Uygulama kaynak kodundaki Cloudflare EMAIL binding
ile çelişki yok: mailbox/gelen posta ile uygulama bildirim gönderimi ayrı yüzeylerdir.

Önceki 403 bulgusu yerel CLI OAuth oturumuna aittir. Kullanıcının mevcut tarayıcı
oturumu Email Sending kaydını okuyabiliyor; Analytics API erişimi artık ilerlemenin
tek olası yolu olarak sunulmamalı. Sıradaki kontrol bu mevcut gönderici alan adının
Activity log'unda özgün gönderimle eşleşen olaydır. Terminal eşleşme henüz yapılmadı;
Gate 6I ve reset hâlâ tamamlanmış/açık değildir. Ayar değişikliği veya mesaj gönderimi yok.


### Gate 6I — mevcut gönderimin gerçek sonuç eşleştirmesi (2026-09-07)

Kullanıcı salt okuma eşleştirmesini onayladı. Cloudflare Email Sending → o-okul.com
Activity Log, son 30 günde 30 kayıt gösterdi (ilk sayfa 10 kayıt). Önceki listede
görülen 4 sayacı tüm geçmiş gönderim sayısı olarak yorumlanmamalı. Sentetik Gate D
aktivasyon kaydı seçildi; 2026-09-01T18:58:42Z **Delivered** olayı görüldü. Mesaj
başlığındaki x-o-okul-idempotency-key, production DB'deki tek SecretDeliveryOutbox
satırına exact eşleşti. Adres/konu benzerliğiyle eşleştirme yapılmadı.

DB sorguları BEGIN READ ONLY, 5s statement timeout ve yalnız seçili ID'ler ile
yapıldı. Outbox createdAt 18:58:40.160719Z; yerel ACK/deliveredAt 18:58:40.857Z;
provider message header 18:58:41Z; gerçek Delivered olayı 18:58:42Z. Yerel ACK
zamanının provider terminal teslimattan önce olduğu ayrımı korundu.

**PRODUCTION teslimat gözlemi PASS; Gate 6I reset bağlamı PARTIAL/BLOCKED.**
Seçilen outbox'ın tenant ve özgün IdentityInvitation kayıtları artık yok. Canlı
şemada outbox providerMessageId/sourceScope/tenantLifecycleVersion ve Tenant
lifecycleVersion alanları yok. Bu nedenle özgün/güncel epoch karşılaştırılamaz.
Çalışan API/worker imaj etiketi e4bde6f18991ddf2c8db5c0713d032720abf288a; yerel
Gate 6 kaynaklarının çalıştığı varsayılmadı.

Kanıt: `artifacts/tenant-reset-provider-preflight/2026-09-07T19-57-31-546Z-correlation.json`. Artifact yalnız ID hash'leri, durum ve zaman içerir; alıcı,
body, aktivasyon bağlantısı/token, raw message ID veya credential içermez.
Provider terminal sonucu ve exact outbox eşleşmesi doğrulandı. Bu tarihsel kayıt
güncel tenant resetini, tüm yazıcıların durmasını veya güvenli reconciliation'ı
kanıtlamaz. Kayıt silme, migration/deploy, yeni e-posta, retry veya reset yapılmadı.

Sonraki somut ihtiyaç: yereldeki gate kaynakları ile canlı schema/runtime farkını
release kapsamı olarak kapatmak ve mevcut kuruma bağlı, epoch bilgili gerçek bir
gönderim üzerinden salt okuma eşleştirmesini doğrulamak. Bu inceleme deploy yetkisi
değildir; WRITE_QUIESCENCE_UNVERIFIED korunur.

## Gate 6J — kontrollü yayın kapsamı hazırlandı (2026-09-07)

[Yayın kapsamı](system-admin-tenant-reset-release-scope.md) ve
`artifacts/tenant-reset-release-scope/2026-09-07T20-00-24-066Z.json` hazırlandı.
Manifest, plan öncesi 182 dosyanın path/hash envanterini içerir; hunk incelemesi
tamamlanmadığından dosya listesi yayın onayı değildir. Kullanıcının demo-kurum
belgesi hariç tutuldu; baseline dosyası ayrıca inceleme bekliyor.

Canlı ledger 109 migration, yerel 116; uygulanmış checksum farkı ve incomplete kayıt
yok. Bekleyen yedi migration sıralandı. Production'da 12 CLOSED kurum bulundu;
ilk migration bu değeri TENANT_STATUS_UNSUPPORTED ile reddedeceği için yayın
öncesi veri uyumluluğu **BLOCKER**. 16 ACTIVE kurum ve 15 attempted outbox satırı
(14 DELIVERED, 1 FAILED) gözlendi. Kimlik/PII içermeyen sayımlar geçicidir; cutover
öncesi yeniden alınır. API/worker/web runtime imajları ve PR #101 head e4bde6f…;
eski yeşil CI commit edilmemiş gate kaynaklarını içermez.

Gate 6J hazırlık kapsamı tamamlandı; releaseReady=false, resetAllowed=false.
Sıradaki tek gate CLOSED kayıtların read-only anlam/bağlı-veri incelemesi ve erişimi
kapalı tutan dönüşüm dilimidir. Bu tur commit/push/PR değişikliği, deploy/migration,
secret/env değişikliği veya provider gönderimi yapılmadı.

## Gate 6K — CLOSED uyumluluk dönüşümü ve dolu-veri deneyi (2026-09-07)

Tek yazıcı; yalnız yayınlanmamış `20260904120000_enforce_tenant_access_status`
migration'ı, mevcut disposable runner/testi, yeni `tenant-legacy-status-drill.mjs`
ve bağlı plan/runbook belgeleri. Production yalnız READ ONLY sorgulandı.

**PRODUCTION read-only:** 12 CLOSED kayıt, hepsinde son güncelleme
2026-08-25T22:49:56.048. Sistem kurumu bu kümede değil. 65 doğrudan tenantId tablosu
kontrolünde toplam 178 bağlı satır var; örneğin User 12, TenantMembership 12,
LicenseTerm 8, Exam 13, AuthSession 5, Student 2 ve PaymentPlan/Installment/Transaction
ikişer. Bu bir tam snapshot veya dolaylı/global veri kataloğu kanıtı değildir.
Geçerli ACTIVE oturum 0; ACTIVE kullanıcı ve üyelik 12'şer. Audit sorgusunda login,
raw-import ve RlsSmoke olayları var, kapanış nedeni/aktörü kanıtlanamadı. Bazı slug'lar
test çağrışımlı olsa da bu, tüm veriyi silme veya kurumu açma gerekçesi sayılmadı.
Anonim kanıt: `artifacts/tenant-reset-release-scope/closed-compatibility-20260907.json`.

Migration artık CLOSED değerini eski kapalı erişim durumu olarak kabul eder ve
**yalnız status'u SUSPENDED yapar**. Eski updatedAt dahil diğer Tenant alanları ve
bağlı satırlar korunur. updatedAt kesin kapanış tarihi olarak etiketlenmez; yeni
suspendedAt/reason uydurulmaz. Sistem kurumu CLOSED/SUSPENDED olursa dönüşüm başlamadan
reddedilir; UNKNOWN gibi diğer değerler yine tüm transaction'ı reddeder. TRIAL erişim
normalizasyonu önceki gibi ACTIVE olur, license plan TRIAL kalır. Constraint bundan
sonra yalnız ACTIVE/SUSPENDED kabul eder. CLOSED kurumlar otomatik ACTIVE yapılmaz.

**LOCAL_RUNTIME PASS:** `artifacts/tenant-reset-postgres-drill/db4886e1f0b65268bea16c2d.json`.
Gerçek Prisma ile önce 109 migration kuruldu. On iki CLOSED, ACTIVE/SUSPENDED/TRIAL
kontrolleri ve 36 bağlı User/AuthSession/LicenseTerm satırı sentetik olarak eklendi.
Bilinmeyen status ve CLOSED system için gerçek SQL hata+rollback sonrası tüm fixture
snapshot'ı aynı kaldı. Sonra kalan yedi migration uygulandı; eski kolonların JSON'ları
ve bağlı 36 satır birebir korundu (yalnız beklenen status/TRIAL updatedAt farkı).
Tekrar migrate deploy gerçek no-op olarak doğrulandı. Eski CLOSED kurum için gerçek
runTenantMutationActivity callback'i çağrılmadan TENANT_ACTIVITY_INACTIVE döndü.
Ek olarak önceki 11 PG + 5 Redis/BullMQ senaryosu aynı çalışmada PASS.

Migration SHA256: `db31451e4e4a0aa6711524206eed864a58106051f1320bb7fd7296b46dbf048e`.
Runtime source SHA256: `14b4e40d30a079e1d342a693565e95cb2c2576bdc548550fbcb90779602e6c4c`.
LOCAL_TEST: 9/9 runner guard/dry-run; DB suite 96/96 PASS. RLS 66 tablo, FK 112
composite + 2 raw invariant, catalog/audit partition kontrolleri PASS.
Schema/tenant-table eklenmedi, shared/OpenAPI şekli değişmedi. Seed etkisi yok;
`db:seed` çalıştırılmadı. Başarılı PG/Redis konteynerleri temizlendi.

**Kalan yayın engeli:** `staging-deploy.yml` migration sonrası
`ACCOUNT_MANAGEMENT_BACKFILL_MODE=APPLY` çalıştırıyor. Backfill `NOT IN
('DELETED','CLOSED')` filtresi nedeniyle dönüştürülmüş SUSPENDED kurumları owner
seçimine dahil edebilir. License backfill'in benzer kapsam etkisi de var. Bu gate
migration'ın veri korumasını kanıtlar; otomatik backfill dahil tüm release pipeline'ının
koruma kanıtı değildir. Backfill uyumluluğu ayrı dar gate'te çözülmeden yayın yapılmaz.

Gate 6K yerel migration hazırlığı tamam. PRODUCTION dönüşüm, yeni CI/STAGING deploy,
backup/restore, provider gönderimi ve reset EXTERNAL_NOT_RUN/UNPROVEN. Sonraki gate
otomatik hesap/lisans backfill'inin kapalı kurumlara dokunmamasını hazırlamak ve
aynı dolu-veri fixture'ında doğrulamak. WRITE_QUIESCENCE_UNVERIFIED korunur.

Gate 6K son doğrulama: source/migration hash'leri kanıtla eşleşti; syntax,
`git diff --check`, `ops:check` (plan kontrolü dahil) PASS. Colima deney profili
durduruldu; production CLOSED durumları değiştirilmedi.

## Kullanıcı onaylı test kurumu temizliği (2026-09-07)

Kullanıcı dna ve demoo dışındaki kurumların test verisi olduğunu belirtti ve silinmesini
onayladı. Bu, önceki salt okuma gate'lerinden farklı, açık bir canlı veri silme talebidir.
28 canlı kurum içinden dna, demoo ve zorunlu system tam kimlikleriyle korundu; demo
(demoo'dan farklı kurum) dahil 25 açık hedef kimliği sabitlendi.

İşlem öncesi PostgreSQL custom dump AES-256-GCM ile sunucuda şifrelendi; anahtar ayrı
0600 dosyasında tutuldu. Yedek, ağsız/tmpfs ayrı PostgreSQL konteynerine geri yüklendi.
Klon üzerinde gerçek SQL + ROLLBACK deneyi yapıldı. İlk prova Student/Enrollment
trigger'ının LicenseUsage üretimini yakaladı; FK'ler kapatılmadan çocuk-önce silme
sırasına bu bağımlılık eklendi. Bağımsız salt okuma incelemesindeki outbox çift yönlü
sahiplik, platform token ailesi ve audit composite-key korumaları eklendi. Korunan
kurumun kaynağına işaret eden test outbox fixture'ı işlemi reddetti ve geri alındı.

İşlem anında yedi BullMQ kuyruğunun active/wait/delayed/prioritized/waiting-children/
paused sayıları sıfırdı. Yeni şifreli precommit backup alındı. Canlı silme tek
transaction içinde, 25 exact id/slug/status ile üç korunan exact id/slug doğrulaması,
public tabloların yazma kilitleri ve 72 tablodaki korunacak içeriklerin SHA256/count
karşılaştırmasıyla yapıldı. İlişkisiz hedef outbox/consumed-refresh/password-reset
kayıtları, sonra FK sırasıyla kurum verileri silindi. AuditLog'un 139 hedef satırı
silinmedi; eski FK davranışıyla tenantId NULL oldu, diğer içerik ve composite anahtar
birebir korundu. Global PlatformAccount/PlatformSession/PlatformIdempotencyKey ve
kurumsuz global kullanıcılar aynı kaldı. API hard-delete yolu açılmadı.

**PRODUCTION PASS:** `artifacts/test-tenant-cleanup/production-commit.json` ve
`artifacts/test-tenant-cleanup/production-verification.json`.
Commit 2026-09-07T20:25:08Z onaylandı; ayrı READ ONLY doğrulamada yalnız
**dna ACTIVE, demoo ACTIVE, system ACTIVE** kaldı ve hedef tenantId taşıyan doğrudan
kayıt kalmadı. 12 eski CLOSED kurum da bu onaylı silme kapsamındaydı; canlı CLOSED
sayısı artık sıfırdır. Önceki CLOSED dönüşümü canlıya uygulanmadı.

Şifreli precommit yedek sunucuda:
`/root/o-okul-private/test-tenant-cleanup-e7eebeea7d2619f28666/backup-precommit.aesgcm`.
SHA256: `bfbd9c64936168ac3f7e66e2ca21063df3940a72467e955fc34460def7b82b14`.
Klon tekrar sahiplik doğrulandıktan sonra kaldırıldı. Yedek ve denetim geçmişi tutuldu.
S3 nesneleri, Redis'in tamamlanmış/başarısız iş geçmişi ve daha önce zaten kurum
kaydı kaybolmuş sahipsiz global kayıtlar bu hesap silme işleminde topluca silinmedi;
bu sonuç tüm dış depolarda veri imhası kanıtı değildir. Deploy, migration veya gerçek
fresh reset çalıştırılmadı; WRITE_QUIESCENCE_UNVERIFIED korunur.


## Gate 6L — hesap/lisans backfill uyumluluğu (2026-09-07)

Tek yazıcı ana ajan; kapsam iki backfill betiği, mevcut legacy/PostgreSQL deneyi ve
bu üç plan belgesi. Hesap normalizasyonu, owner seçimi, membership/teacher dönüşümü,
lisans oluşturma ve usage yenileme yalnız ACTIVE kurumları kapsar. Önkoşul/parity
sayımları da aynı kapsamı kullanır. SUSPENDED kurumları açmak veya verilerini düzeltmek
otomatik release backfill'inin görevi değildir. Transaction/rollback ve gerçek owner
kanıtı şartları korunur. System hesabının mevcut platform dönüşümü değiştirilmedi.

LOCAL_TEST: runner guardları 9/9; hesap ve lisans evidence contract'ları PASS.
LOCAL_RUNTIME: `artifacts/tenant-reset-postgres-drill/627ab7472096f10da415f41d.json`
PASS. 109 → 116 migration, eski 12 CLOSED kurumda status dışında veri korunması,
87 bağlı satır; DRY_RUN değişmezliği ve iki APPLY'da 13 SUSPENDED kurumun bağlı
verilerinin değişmezliği, iki aktif kurumun hesap/owner/öğretmen/lisans dönüşümü
kanıtlandı. 11 PG + 5 Redis senaryosu PASS; yalnız sahipliği doğrulanmış deney
konteynerleri kaldırıldı. Gerçek provider çağrısı yok.

İnceleme düzeltmesi: ilk artifact'in `systemPreserved:true` alanı yalnız system
Tenant satırı için kanıt taşır; system hesap/platform fixture'ı yoktur. Kaynak alan
adı `systemTenantRowPreserved` olarak daraltıldı; yeni aday hash'i son deneyde
kaydedilir. Bu sonuç canlı system hesap koruması veya yayın tamamlandı iddiası değildir.

CI/STAGING/PRODUCTION yeni aday için UNPROVEN. Sıradaki gate 6M: yayın akışında eski
API/worker/queue-board'u migration öncesinde temiz durdurma ve başarısızlıkta kapalı
bırakma; eski lifecycle E2E fixture'ını güncel onay akışına bağlama. Golden farkları
ayrıca güncel kaynak ve ekranlarla değerlendirilecek. Reset guardı kapalı kalır.


## Gate 6M — güvenli yayın sırası ve test uyumu (2026-09-07)

Tek yazıcı ana ajan; workflow, bağlı ops/staging-evidence kontrolleri, bir shell-akışı
regresyonu, mevcut login E2E ve iki Darwin görsel referansı kapsamda.

Migration öncesi eski public cutover PASS'ı kaldırılır; queue-board/API sonra worker
durdurulur. Exact container durumunda çalışan/OOM/zorla sonlandırılmış worker veya
başarısız durum sorgusu migration'ı engeller. Hesap ve lisans backfill sonrasında
başarı varsa aday servisler başlar. Hata halinde eski worker otomatik başlatılmaz.
10 senaryolu fake Docker testi gerçek workflow bloğunu çalıştırır; ops:check içine
runner guardlarıyla bağlandı. Salt okuma incelemesindeki boş çıktı + başarısız docker ps
riski, sorgu sonucu ayrı assignment ile kontrol edilerek giderildi.

Kurum yönetim E2E fixture'ı sunucu işlem izinlerini/sürümünü verir; exact kurum kodu,
MFA ve idempotency header'larını doğrular. Askıdan sonra giriş denemeden önce onayla
yeniden açar. Hedefli Playwright 1/1 PASS.

İki eski Darwin golden yeniden üretildi ve actual/diff görselleri incelendi. Mevcut
onaylı kodun canonical Kişiler/Akademik/Sınav/Finans/Ayarlar menüsü ve raporun
Yeniden hazırla düğmesi eski screenshot'lara yansımamıştı. Kullanıcının güncel kodu
esas alma talebi doğrultusunda yalnız bu iki referans güncellendi; uygulama tasarımı,
rapor metrikleri ve piksel eşikleri değiştirilmedi. Önce/sonra inceleme ekranları
`artifacts/gate6/gate6m-visual-review/` altında. Hedefli tekrar 2/2 PASS. Linux report
referansı da eski menüyü taşıyor; ilgili platformun gerçek CI çıktısıyla ayrıca
inceleme gerekiyor, Darwin görüntüsü Linux'a kopyalanmaz.

LOCAL_STATIC: ops:check PASS (son durum-sorgusu düzeltmesi yeni tam CI'da tekrar
koşulacak). LOCAL_TEST: hedefli web/görsel PASS, cutover hata senaryoları. CI ve canlı
cutover UNPROVEN. SSH read-only envanterinde o-okul-prod tek o-okul projesi; dört
uygulama image'ı e4bde6f18991ddf2c8db5c0713d032720abf288a. GitHub staging origin ve
dizini aynı production uygulamasını gösterir. Deploy/migration/provider çağrısı yok.
Sıradaki Gate 6N: hariç dosya korunarak bağımsız release snapshot/branch, tam CI ve
incelemeye hazır migration/bakım/yedek paketi. Kontrollü canlı yayın ayrı onay gerektirir.


Gate 6N son yerel uyumluluk eki: `20869eecaf54edbf7ffcc8ee.json` PASS. System için
sentetik kullanıcı/üyelik/platform hesabı ile ACTIVE ve REVOKED oturumlar eklendi;
parola/MFA/refresh/oturum durumları DRY_RUN ve iki APPLY'da aynı kaldı (yalnız
backfill'in updatedAt yenilemesi hariç). Önceki system-fixture kanıt boşluğu bu
LOCAL_RUNTIME deneyinde kapandı. Gerçek ölçüm baseline'ı 3 görev × 5 örnekle yeniden
üretildi. Yeni kaynak canlıya uygulanmadı; kontrollü yayın sırası release-scope belgesindedir.


### Gate 6N — gerçek CI bulguları ve düzeltmeler

İlk GitHub CI `34160868543`, `20260907120000_tenant_fresh_reset_operation` sırasında
migration hesabı CREATEROLE taşımadığı için durdu. Genel yetki artırılmadı;
`005_bootstrap_tenant_reset_worker_role.sh` yönetici bootstrap'ında yalnız dar NOLOGIN
reset rolünü hazırlar. CI ve kontrollü deploy bu adımı migration'dan önce çalıştırır.
Yerel runner da artık NOSUPERUSER/NOCREATEROLE/NOBYPASSRLS migration hesabını kullanır.
`236bfb647c7374ea45d4a42f.json` bu kimlikle 109→116 upgrade/backfill, system/kapalı kurum
koruması ve 11 PG + 5 Redis senaryosunda PASS. Source hash:
`9364363dcc3cdbdf18a2d41a27216631626595de3bb53c988ef782d40d4eac83`.
Eski superuser tabanlı deneyi dar migration rolü kanıtı saymayan bu ek esas alınır.

Tam yerel CI'ın sonraki gerçek engeli lisans ekranının yeni reset-request GET'inin
route smoke fixture'ında eksik olmasıydı (88/89 PASS). Fixture `{request:null}`
sözleşmesiyle tamamlandı; dört viewport'lu hedef test PASS. Bilinmeyen API çağrısını
reddeden kontrol korunur. Ölçümün fixture digest'i de canonical komutla yenilenir.
Bu iki başarısız çalışma tam CI PASS değildir; yeni aday koşusu ayrı takip edilir.
Deploy/production mutation/provider/reset yapılmadı.


Gate 6N bootstrap son negatifleri gerçek PostgreSQL’de PASS: mevcut LOGIN rolü,
rolün app'e verilmesi ve rolün başka role üyeliği TENANT_RESET_WORKER_ROLE_UNSAFE ile
reddedildi; temiz NOLOGIN rolünde tekrar aynı durum korundu. Kanıt: `4e13f19327e9fd1b39acc89f.json`.
Dar migrator + 94 bağlı satır/system hesap-oturum + backfill + 11 PG/5 Redis kontrolleri
aynı çalışmada PASS. Son runtime source SHA256: `d8a90ec235a9cf689959a1aab452b973b0d0720c683bb12f28893da2d66d5fa8`.
Bu bootstrap parola/login açmaz veya mevcut yetkiyi sessizce değiştirmez.


2026-09-08 Gate 6N CI eki: dc700a19 GitHub PG17 işinde bütün migration'lar ve
student grade-level kontrolü geçti. Sonraki iki PG test dosyası yeni @o-okul/db
import'unun dist çıktısı derlenmediği için yüklenemedi. CI'a yalnız gerekli
`pnpm --filter @o-okul/db... build` adımı eklendi. Aynı iki test dosyası artık
disposable runner'da zorunlu DB URL'leriyle de çalışır: `b4096676e28c89ebd9938a0e.json`
PASS; dar migrator/rol negatifleri, dolu upgrade/backfill, system koruması ve
11 PG + 5 Redis de aynı koşuda PASS. Son source hash: `0f306f032b4bff58319d7fafea28132acfe303d204a527643020e1b685018b5a`.
Kaynakta yetki engeli kaldırılmadı; bu hâlâ LOCAL_RUNTIME kanıtıdır.


### Gate 6N — tam yerel CI kapanışı (2026-09-08)

Exact aday `362a2d549e9714b5238e7d2836f2f56197455f02` üzerinde `pnpm run ci`
exit 0. UI 174, route 89, görsel 31; API 1218 PASS/6 SKIP, DB 94 PASS/2 SKIP,
worker 222 PASS/8 SKIP; OpenAPI 247 path, idempotency 48 işlem. Normal suite'te
atlanmış dış DB testleriyle ayrı gerçek PG koşusu karıştırılmaz. Yerel tam zincirdeki
önceki school HTTP parse hatası hedefli 56/56 ve bu tam tekrarda oluşmadı; kök neden
kanıtlanmadan uygulama/test eşiği değiştirilmedi.

Kanıt: `artifacts/tenant-reset-release-scope/gate6n-local-ci.json` ve hash'i bağlı
`artifacts/gate6/gate6n-362a2d54-full-ci.log`. Runtime kaynak hash'i son geçici PG
kanıtıyla eşleşti. GitHub run `34161751919` PostgreSQL ve UI/UX işleri PASS;
genel verify henüz tamamlanmadı. Yeni yayın/STAGING/PRODUCTION ve reset UNPROVEN.

Aday 194 dosyadır; release dalı ve taslak PR #102 mevcut PR #101 tabanını korur.
Bu son yerel plan notları aday kodunu değiştirmez; immutable adayın hash envanteri
`gate6n-candidate.json` içindedir. Asıl çalışma ağacında staging/commit yapılmadı.
İncelemeye hazır canlı işlem kapsamı: `artifacts/tenant-reset-release-scope/gate6n-approval-packet.md`.
Staging production hedefine bağlı olduğundan yeni şifreli backup/izole restore ve
kontrollü ilk yayın için açık onay gerekir. Tam reset ve pilot ayrı açık kapılardır.


### Gate 6N — exact aday CI kapanışı (2026-09-08)

**CI PASS:** https://github.com/4rmus/o-okul/actions/runs/34161751919 — exact head
`362a2d549e9714b5238e7d2836f2f56197455f02`. verify, account-management-postgres ve
ui-ux-rc üçü SUCCESS. Genel işte `pnpm run ci` SUCCESS; Linux görsel paketi 31/31,
route 89/89; API 1218 PASS/6 SKIP, DB 94 PASS/2 SKIP, worker 222 PASS/8 SKIP,
OpenAPI 247 path/idempotency 48 işlem. Ayrı PostgreSQL 17 işinde migration'lar,
grade-level ve gerçek hesap/lisans testleri SUCCESS. Linux referansları başka
platformdan kopyalanmadı; eşikler değişmedi. Yerel tam CI ayrıca PASS.

**PRODUCTION yalnız salt okuma:** son kontrolde dna/demoo/system ACTIVE, migration
109 ve incomplete 0; dört uygulama image'ı halen e4bde6f… . Yeni deploy, migration,
reset veya provider gönderimi yapılmadı. Tam reset/pilot hâlâ UNPROVEN ve guard kapalı.
Kanıtlar: `gate6n-github-ci.json`, `gate6n-local-ci.json`,
`gate6n-final-production-readonly.json`; tümü artifacts/tenant-reset-release-scope altında.

**Sonraki gerekli kullanıcı adımı:** `gate6n-approval-packet.md` içindeki hedef/SHA/
bakım, yeni private şifreli backup + izole restore ve yedi migration/backfill ile
kontrollü ilk production yayınına açık onay. "Staging" aynı canlı hedefi kullandığından
okuma izni veya test kurumu temizliği onayı bu yeni yayına taşınmaz. PR #101 main'e
merge edilmez; source adayı ayrı dalda sabittir. Tam resetin duraklatma, terminal
provider uzlaştırması, off-host restore, aynı-operation sürdürme ve tek pilot/14 gün
kapıları ilk korumalı yayından ayrı açık kalır. Bu kayıtla tamamlanmış gösterilmez.

## Gate 6P — API kapanış düzeltmesi (2026-09-08)

Tek yazıcı ana ajan; ayrı dal `fix/tenant-reset-shutdown-drain`, taban362a2d54.
Kapsam API mutation admission/settlement, reset dispatcher, PDF kaynak kapanışı ve
Compose API init; migration/RBAC/reset izni veya kullanıcı verisi değişmez.

Başlamış HTTP/platform ve iç içe işler gerçek sonuç kaydı bitene kadar izlenir.
Kapanışta geç gelen istek veya bitmiş async bağlam yeni pool/iş başlatamaz (503).
Kabul edilmiş nested işler tamamlanır; kapanış sırasında içte yakalanmış hata bile
başarılı drain sayılmaz. PDF readiness/completion ve dispatcher beklenir; pool/PDF
kapanışı HTTP kapanışı ve ortak drain sonrasındadır. Docker API `init: true` kaynakta
sağlandı; canlıdaki private override henüz yeni kaynak yayını değildir.

LOCAL_TEST: gerçek Nest HTTP bağlantı kopması/geç middleware, nested settlement,
platform POST, gecikmiş PDF ve dispatcher rejection dahil hedefli 88 test PASS.
DB activity/reset39 PASS, API typecheck ve ops kontrolü PASS. İlk tam API koşusunda
1224 PASS/1 HTTP parse FAIL/6 SKIP; ilgili dosya hedefli tekrarda geçti. Bu hata için
ürün koruması veya test eşiği değiştirilmedi. Son kaynakta tam `pnpm run ci` sürüyor;
sonuç gelmeden tam CI PASS sayılmaz. Salt okuma incelemede kalan P1/P2 yok.

PRODUCTION halen362a2d54; 6P yayınlanmadı. Tam reset guardı ve reset DSN kapalı.
Canlı salt okuma reset preflight'ında API/worker için backup/source/restore S3 ve
restore DB yapılandırmaları yok; secret değerleri okunmadı/yayımlanmadı. Sonraki dış
deney için ayrı off-host backup/restore ortamı ve güvenli erişim profili tanımlanmalı.
Kanıtlar ana çalışma ağacındaki `artifacts/tenant-reset-release-execution/shutdown-*`
ve `reset-external-preflight.json` dosyalarıdır.
