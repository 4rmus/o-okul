# Kurum lifecycle/reset kontrollü yayın paketi

> Tarihsel kayıt: geçmiş durum ve iş listeleri yazıldıkları aşamaya aittir.
> Cihaz yedeği/geri yüklemenin güncel kapsamı ve sonuçları
> [tek yayın ve işletim özetinde](tenant-device-restore-release.md) tutulur.

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

Aşağıdaki Gate 6N kaydı yayın öncesi tarihsel kapsamdır; güncel Gate 6O sonucu üsttedir.
Bu belge güncel yürütme sırasıdır; 6J/6K tarihsel snapshot'ları ve 25 kurum temizliği
[preflight](system-admin-tenant-reset-gate6-preflight.md) içinde korunur.

## Güncel kapsam

- Taban kaynak ve halen çalışan dört uygulama image etiketi:
  `e4bde6f18991ddf2c8db5c0713d032720abf288a`.
- Ayrı çalışma ağacı: `/Users/arair/works/o-okul-tenant-reset-release`.
  Dal: `release/tenant-lifecycle-guarded-20260907`.
- Mevcut PR #101 tabanı `fix/setup-grade-level-course-links` korunur. Bu taban main'den
  13 commit ileridedir; yeni yayın paketi bu PR tabanına ayrı draft PR olarak ayrılır.
  Eski PR'nin yeşil CI'si yeni kaynağın kanıtı değildir; main'e merge/deploy yapılmaz.
- 191 exact path incelemesi: lifecycle/request, API/auth/mutation admission,
  worker/provenance, DB/RLS/7 migration, shared/web, receipt adapter/gateway ve bağlı
  test/evidence/runbook dosyaları. İlk manifest:
  `artifacts/tenant-reset-release-scope/gate6n-candidate.json`.
- `docs/demo-kurum-veri-kurulum-plani.md` hariçtir. Kaynak digest'ine bağlı ölçüm
  baseline'ı canonical 3 görev × 5 örnek çalıştırılarak üretilir. İki Darwin golden,
  mevcut onaylı menü/düğme kaynakları ve actual/diff incelemesiyle güncellendi;
  piksel eşikleri ve ürün tasarımı değişmedi. Linux report referansı ayrı CI incelemesidir.
- İlk paket korumalı lifecycle/talep/diagnostics yayınıdır. `requireResetWriteQuiescence`
  engeli korunur; `TENANT_RESET_DATABASE_URL` ve reset Compose wiring'i eklenmez.
  Gateway ayrı dağıtılır; uygulama SHA'sı gateway sürümünü kanıtlamaz. Receipt mevcut
  gateway'de yoksa UNAVAILABLE sonucu guardı açmaz.

## Yenilenmiş canlı salt okuma kanıtı

`o-okul-prod` üzerinde tek `o-okul` Compose projesi var. GitHub staging değişkenleri
`/root/o-okul` ve `https://o-okul.com` kullanır; ayrı staging varsayılmaz.
2026-09-07T20:45Z civarı READ ONLY transaction sonuçları:

- Yalnız **dna, demoo, system**, üçü ACTIVE; başka kurum veya CLOSED kayıt yok.
- 109 migration tamamlanmış; yarım migration ve mevcut checksum farkı sıfır.
- İki kurumun owner kaynağı ve lisans mirror'ı hazır; eksik lisans snapshot'ı sıfır.
- System parola/MFA alanı ve mevcut platform oturum refresh/status farkı sıfır.
  Platformda 32, legacy system'de 33 oturum var; eksik bir platform karşılığı ACTIVE.
  Bu sayımlar kesim anında yenilenmelidir; migration bunları kendiliğinden doğrulamış sayılmaz.
- Yedi eski outbox satırı DELIVERED. Bu eski etiketler terminal provider receipt veya
  epoch doğrulaması değildir; toplu yeniden damgalama/yeniden gönderim yok.

Kanıt dosyaları `artifacts/tenant-reset-release-scope/gate6n-live-*.json` ve
`gate6n-migrations.json`. Secret, alıcı veya mesaj içerikleri tutulmadı.

## Gate 6O’da uygulanan migration sırası

| Migration | SHA256 başlangıcı |
|---|---|
| 20260904120000_enforce_tenant_access_status | `db31451e4e4a…` |
| 20260904130000_enforce_audit_log_append_only | `1cc57b044f17…` |
| 20260906120000_tenant_lifecycle_version | `5d32f218b72f…` |
| 20260907120000_tenant_fresh_reset_operation | `e8f008bb2ee8…` |
| 20260907140000_tenant_reset_request | `feb95a9f5d87…` |
| 20260907160000_tenant_mutation_activity | `7cc7ba7362f0…` |
| 20260907180000_delivery_provenance_and_retry_fence | `9d55a913a492…` |

Tam hash'ler `gate6n-migrations.json` içindedir. İlk migration CLOSED → SUSPENDED,
TRIAL → ACTIVE yapar; diğer Tenant alanlarını/kapalı kurum bağlı verilerini korur.
Canlı CLOSED artık sıfırdır; dönüşüm kaynak uyumluluğudur. System kapalıysa veya
bilinmeyen status varsa transaction reddedilir. Audit append-only, lifecycle sürümü,
reset operation/request/activity ve provenance/retry korumaları sonraki migration'lardır.

Hesap ve lisans backfill'leri yalnız ACTIVE kurumlardaki kendi dönüşümünü yapar;
SUSPENDED kurumun hesabı, üyeliği, öğretmeni, lisansı veya usage'ı değiştirilmez.
System platform dönüşümünün mevcut davranışı korunur. Preflight/owner kanıtı ve
SERIALIZABLE rollback kuralları geçerlidir.

## Yayın öncesi ve kontrollü kesim

1. Exact aday için tam yerel CI ve GitHub CI; Linux görsel farkının gerçek artifact'le
   incelenmesi. Migration/backfill ve cutover kontrolü aynı adaydan geçmeli.
2. Canlı kesim için ayrı açık onay: production hedefi, bakım kesintisi, aynı aday SHA,
   yedi migration + hesap/lisans backfill kapsamı ve korunan üç kurum somutlaştırılır.
3. Onaylı işlemde yeni şifreli precommit backup ve izole restore/prova alınır;
   korunan kurum/global verilerinin önce/sonra sayım/hash ve hesap/RBAC kontrolü hazırlanır.
   Önceki test temizliği yedeği yeni kesimin güncel backup'ı sayılmaz. Yedek ve anahtar
   private kanalda ayrı tutulur; canlı env/secret bu pakete yazılmaz.
4. Image pull/config/owner-decision kontrolünden sonra eski public PASS kaldırılır;
   queue-board/API 60s, worker 300s içinde durdurulur. Exact container durumları,
   temiz worker exit'i, OOM olmaması ve yeniden başlamama doğrulanır. Durum sorgusu
   başarısızsa işlem durur. Kuyruklar ve belirsiz işler korunur; retry/clean yok.
5. Bootstrap → yedi migration → hesap preflight/backfill → lisans backfill.
   Hepsi başarılıysa aynı aday API/worker/web/queue-board başlar. Hata halinde
   yazıcılar kapalı kalır; eski worker otomatik çalıştırılmaz.
6. Exact SHA → CI → deploy → image ID → health/readiness → korunan kurum/RBAC/
   epoch/provenance doğrulanır. Ancak bundan sonra yeni public cutover kanıtı yayımlanır.

Eski image'a geri dönmek DB rollback kanıtı değildir. Yeni epoch/UNCERTAIN kayıtları
oluşmuşsa eski worker retry yapabilir. Hata halinde incelenmiş forward-fix veya ayrı
onaylı, denenmiş restore kullanılır; ledger/constraint değişikliğiyle hata örtülmez.

## Tam reset için ayrıca kalanlar

- Provider terminal sonucunu exact source/tenant/epoch ile eşleyip kalıcı belirsiz
  activity/outbox kaydını atomik, denetlenebilir ve tekrar gönderimsiz sonuçlandırma.
- Tüm yazıcıları kapsayan, operasyon boyunca doğrulanan gerçek duraklatma otoritesi;
  mevcut koşulsuz guard kanıt olmadan kaldırılmaz.
- Gerçek off-host şifreli backup ve PG/S3 izole restore, aynı-operation hedef hazırlama/
  kesinti sonrası sürdürme, image araçları ve dar rol/wiring doğrulaması.
- API/worker/purge/finalize tarafında aynı exact pilot sınırı. dna/demoo/system reset
  hedefi değildir; ayrı sentetik/pilot kurum için kullanıcı girdisi gerekir.
- İki kurumlu uçtan uca reset ve hata enjeksiyonu; ardından plandaki en az 14 gerçek
  günlük pilot. Yerel test veya temizlik restore deneyi bunun yerine geçmez.

## Kanıt durumu

- LOCAL_STATIC/LOCAL_TEST: hedefli MFA E2E 1/1, incelenmiş Darwin görsel 2/2,
  workflow cutover 10/10, runner guardları 9/9 ve backfill contract'ları PASS.
- LOCAL_RUNTIME: `20869eecaf54edbf7ffcc8ee.json` gerçek 109 → 116 upgrade, 13 kapalı
  kurum koruması, iki aktif kurum dönüşümü, system parola/MFA ve ACTIVE/REVOKED
  oturumları (yalnız backfill updatedAt değişimi hariç), DRY_RUN ve iki APPLY, 11 PG +
  5 Redis senaryosu PASS. Tam reset veya dış provider kanıtı değildir.
- CI: yeni aday çalıştırılacak. İlk tam yerel deneme kaynak digest'i eski ölçüm
  baseline'ında durdu; gerçek ölçüm yeniden üretildi. Yeni tam sonuç ayrıca kaydedilir.
- STAGING/PRODUCTION: yeni aday serving/cutover/reset UNPROVEN.
- EXTERNAL_NOT_RUN: deploy, migration, yeni gönderim, fresh reset ve pilot.

**Sonraki gate: adayın tam CI kapanışı ve production etkisi açık somut yayın onayı.**


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
