# Kurum lifecycle/reset kontrollü yayın paketi

2026-09-07. **Aday ayrıldı; yeni CI ve canlı cutover henüz tamamlanmadı. Reset kapalı.**
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

## Bekleyen migration sırası

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
