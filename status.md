# O-Okul Durum

Son güncelleme: 2026-10-10

Güncel GitHub `main` snapshotı `937b32c6bd510183d9e5fccfbbe29be1e0acb697`dir. CI
`33509083048` ve Staging Deploy `33510589276` `PASS`; deployment-cutover artifact'i web, API,
worker ve queue-board için aynı SHA image etiketini doğrular. 2 Eylül public kontrolünde production
`/health` ve `/health/ready` `200`, staging karşılıkları `418` döndürdü. Bu nedenle exact-SHA
`STAGING_DEPLOY` kanıtlıdır; güncel public staging runtime, production image parity, pilot ve go-live
`UNPROVEN` kalır.

Çalışma alanındaki öğrenci seviye dilimi, sınıfı boşaltırken Student/açık enrollment tutarlılığını ve
toplu yenilemede ara hata sonrası öğrenci-bazlı tekrar güvenli devamı düzeltir. Öğrenci/idempotency
hedefli testleri, okul e2e, API typecheck, idempotency envanteri ve `git diff --check` yerelde `PASS`tir.
Bu belge değişiklikleri `LOCAL_TEST` düzeyinde kaydeder; branch/PR CI, main, staging ve production
kanıtları yalnız ilgili exact-SHA kapıları tamamlandıkça ayrıca yükseltilir.

24 Ağustos tarihsel inceleme snapshotı: Gate D runtime commit'i `bb2779bc1087a150b648407385e3cee1d0122692`;
Gate E WAL exact-SHA staging commit'i `b2b91d9ec160d43d119937336782127e7e77325d`.
Kanıt düzeyi: Gate A, Gate B ve Gate C `LOCAL_STATIC`; Gate D `GITHUB_CI`, `STAGING_DEPLOY`,
`STAGING_DB_RUNTIME`, `STAGING_API_RUNTIME`, `STAGING_LIVE_UI` ve `STAGING_PROVIDER_DELIVERY`
kanıtı taşır. Gate D `PASS`; Gate E WAL archive izin düzeltmesi `LOCAL_STATIC` ve
`LOCAL_SYNTHETIC`, `GITHUB_CI`, `STAGING_DEPLOY` ve `STAGING_WAL_RUNTIME` kanıtı taşır.
Gate E'nin geri kalanı açık; pilot ve production `EXTERNAL_NOT_RUN`.
Exact-SHA staging `pnpm wal:archive:smoke`, main CI `31735017355` ve Staging Deploy
`31735953577` üzerinde `PASS`; PII-safe activation artifact'i `9195500657`, digest'i
`sha256:8b63ccf7c8fbc0d7309b789d0c5bbaf91c72c01300d5349beff0d47945709697`.
Faz 6 repo davranışı `LOCAL_STATIC` / `LOCAL_SYNTHETIC` düzeyinde kapalıdır; WhatsApp dış kanıtı
kullanıcı kararıyla sonraya bırakılmış ve capability kapalı tutulmuştur.

23 Ağustos 2026 canlı veri temizliğinde daha önce kapatılan 11 sentetik tenant yedeksiz silindi;
aktif kullanıcı/oturum ve kişi verisi yokluğu, exact aday kümesi ve rollback edilen prova ile
doğrulandı. Sistem tenantı, kalan 6 tenant ve 67 mevcut AuditLog kaydı korundu. PII-safe kanıt
`docs/almanac-2-synthetic-tenant-cleanup-evidence.md` dosyasındadır. PR #79 uygulama adayı
`795286daf...` exact CI `32645879234` üç işte `PASS`; merge/deploy yapılmadı.
Bu sonuç `PRODUCTION_DB_RUNTIME` veri temizliği kanıtıdır; production go-live ve Gate F hâlâ
`EXTERNAL_NOT_RUN` durumundadır. Null-tenant audit sınıflandırması `system=72`,
`deletedTenant=100`, `unknown=0` ve checker `PASS`tir. Audit saklama/imha süresi privacy/go-live
kararı olarak açıktır.

24 Ağustos 2026'da owner doğrulaması eksik 3 test tenant, exact ürün sahibi onayı ve rollback edilen
prova sonrasında yedeksiz silindi. Sistem tenantı ve owner-backed 3 tenant korundu; ownerless `0`.
Account-management backfill dry-run `READY`, apply `PASS`, missing `0`, blockers/gaps `[]`.
Exact test grafiğindeki finans, destek/ek, ödev/dosya ve raw-import/report fixture satırları ile
mevcut tenantla eşleşmeyen 2 raw-import nesnesi (3.838 bayt) silindi; bucket nesne sayısı `0`.
Audit sınıflandırması `228` toplam, `53` tenant bağlı, `175` null-tenant;
`system=72`, `deletedTenant=103`, `unknown=0` ve checker `PASS`tir.

PR #79 `ce321b927...` olarak squash merge edildi. Main CI `32649882436` ve Staging Deploy
`32749363674` `PASS`; web, API, worker ve queue-board exact `ce321b927...`, rollback image
`8a3ec5e...`. Public health/readiness/root-system-tenant login `200`, legacy tenant login `307`
exact tenant `/giris`; cutover, first-gates, HTTPS/alert ve WAL kanıtları `PASS`, gaps `[]`.
Bu sonuç `STAGING_DEPLOY/STAGING_RUNTIME`dır; Gate F ve production go-live `EXTERNAL_NOT_RUN` kalır.

5 Ağustos 2026 ürün kararları: giriş kurum subdomaini + tenant-local kimliktir; guardian ürün
kapsamından çıkarılacaktır; hukuk/KVKK incelemesi bu fazda repo uygulamasını ve pilot hazırlığını
bloklamaz ancak production purge/go-live için hukuk kanıtı sayılmaz. Kapasite tenant başına 2.000
aktif çalışan hesabı runtime üst sınırı ve 1.000 çalışan yük kabul hedefi olarak netleştirilmiştir.

Bu dosya tamamlanan işleri, açık işleri ve release kanıt seviyesini tek yerde tutar. Tarihsel
planlar ve faz günlükleri kaldırılmıştır; güncel ürün kapsamı ve release sözleşmeleri aşağıdaki
kanonik dosyalardadır.

## Doğruluk Hiyerarşisi

1. Çalışan kod, Prisma şeması, migration ve testler.
2. `AGENTS.md` ve makine tarafından denetlenen repo sözleşmeleri.
3. `docs/DECISIONS.md` ve `docs/product-journeys-v1.md`.
4. Bu dosya ve `docs/llm-wiki/README.md`.
5. `docs/phase-6-production-readiness.md` ile `docs/phase-6-ops-runbook.md`.

Yerel `PASS`, staging veya production kanıtı sayılmaz. Canlı durum yalnız SHA, image etiketi,
ortam ve tarih içeren kalıcı evidence ile yükseltilir.

## Tamamlanan İşler

- Kullanıcı tarafından iptal edilen dört ürün kapsamı uygulama, shared type, OpenAPI, runtime
  ayarı, evidence zinciri ve aktif dokümanlardan çıkarıldı.
- Eski ana plan, modernizasyon/UI planları, `claudedocs` arşivi, faz checklist ve faz raporları
  kaldırıldı. Aktif release sözleşmeleri ve dar teknik kontratlar korundu.
- Rapor üretim anahtarı istemciden kaldırıldı. API sınav/rapor/filtre kapsamını, worker ise gerçek
  sonuç anahtarları ile answer-key/parser/engine sürümlerini SHA-256 kimliğine katar. Aynı gerçek
  girdi aynı snapshotı, değişen sonuç içeriği veya sürümü yeni snapshotı üretir.
- Yalnız `SYSTEM_ADMIN` için zorunlu MFA kapsamında kısa ömürlü enrollment yanıtı ve doğrulama endpoint'i eklendi. Normal
  oturum TOTP doğrulamasından önce üretilmiyor; etkinleştirme atomik koşulla tekrar tüketime kapalı.
  Üyelik sürümü Prisma şeması ve migration ile kalıcılaştırıldı.
- KVKK öğrenci/öğretmen envanteri, ham değerleri döndürmeden TCKN, telefon, e-posta ve fotoğraf
  varlığını kategori olarak izler; purge alanları ve audit örneklemiyle hizalıdır.
- `withBypassRlsQuery` kullanımları dosya ve fonksiyon bazlı allowlist ile fail-closed denetleniyor.
- Karantina çözümleme işi tenant kapsamlı ve deterministik queue kimliği kullanıyor. Enqueue sonrası
  DB yazımı kesilirse retry aynı BullMQ işini hedefler; yeni genel outbox katmanı eklenmedi.
- SMS enqueue içeriği deterministik queue kimliği ve delivery report ile repo içi tekrarları
  sınırlar. Netgsm upstream idempotency anahtarı sunmadığı için provider çağrısı sonrası process
  çökmesi bakımından davranış `at-least-once` olarak kabul edilir; `exactly-once` iddiası yoktur.

## Almanak 2.0 Gate A — Yerel Kapanış (2026-08-09)

- **S-01:** iSEM producer, checker ve template'leri tek fixture sözleşmesinden `90 soru / 1 kitapçık /
  21 katılımcı / 21 eşleşme / 0 karantina / 21 sonuç / 21 rapor` bekler. Producer'ın private
  UI-worker girdisi `generatedAt`, `tenantSlug`, `loginName` ve portal login alanlarını doğrudan üretir.
- **S-02:** `/audit-logs`, `/audit-logs/safe-list` ve `/audit-logs/student-summary` route ailesi
  `tenant-audit:read` exact capability, aktif `STAFF` persona, tenant bağlamı ve normal RLS şartıyla
  çalışır. Normal `SYSTEM_ADMIN`, personasız/teacher bağlamı ve RLS bypass 403 alır; tenant audit
  okumaları için `listForAdmin` bypass yolu kaldırılmıştır.
- **Kalan envanter:** `roleRank` ve 25 controller dosyasındaki 151 `@Roles` annotation hâlâ açıktır.
  Bunlar Gate A'nın ilk exact-capability diliminin değil, sonraki route-family ve control-plane
  kesimlerinin kapsamıdır; tam RBAC dönüşümü tamamlandı iddiası yoktur.
- **Sonuç:** `pnpm run ci` ve Gate A hedefli kontrolleri aynı yerel diff üzerinde `PASS`.
  GitHub CI, gerçek UI-worker oturumu, staging, provider, deploy ve production `EXTERNAL_NOT_RUN`.

## Almanak 2.0 Gate B — Foundation Ready Yerel Kapanış (2026-08-10)

- **Kararlar:** ADR-0003–ADR-0010 kabul edildi. Route/feature sınırı, workflow/list standardı,
  default-off rollout, PII-safe analytics ve control-plane hedefi repo kararlarına bağlandı.
- **Architecture/route:** TypeScript AST checker; dependency yönü, control-plane/tenant, portal/admin,
  marketing/API, client/private-env, non-literal import ve symlink kaçışlarını fail-closed denetler.
  Route manifest 81 aktif route ve 19 modül kararını dosya sistemi/persona/trust-boundary ile eşler.
- **Rollout:** Dokuz anahtarlı katalog default-off'tur. Yalnız güvenilir request tenant bağlamı,
  exact environment, başlangıç/bitiş süresi, exact capability ve başarılı audit enabled sonuç verir.
  Hiçbir tenantta flag açılmadı; rollout RBAC/RLS yerine geçmez.
- **Analytics/ölçüm:** Product event kataloğu exact alan/değer allowlist'i ve 30 PII negatif fixture
  taşır. Serbest correlation/error alanı yoktur. Üç kritik görev için dedicated Next build, mocked API,
  görev başına beş örnek ve sıfır runtime hata içeren `LOCAL_SYNTHETIC` baseline kaydedildi.
- **Açık geçiş borcu:** Legacy `SYSTEM_ADMIN` tenant-role/realm ayrımı ve üç salt sunum bileşeni
  allowlist'i `PARTIAL`dır; `CP-01`/`UI-01` tamamlandı iddiası yoktur. Gate B kapanışında Gate C
  henüz başlatılmamıştı; güncel Gate C durumu aşağıdadır.
- **Sonuç:** Gate B hedefli kontroller, `pnpm run ci`, `git diff --check` ve iki bağımsız P0/P1
  incelemesi yerelde `PASS`. GitHub CI, gerçek kullanıcı gözlemi, analytics transportu, tenant flag
  aktivasyonu, staging, deploy ve production `EXTERNAL_NOT_RUN`.

## Almanak 2.0 Gate C — İlk Dikey Dilim Yerel Kapanış (2026-08-10)

- **Shell v2:** `web.shell-v2` yalnız sunucunun çözdüğü tenant/session/persona bağlamıyla kurum
  navigasyonunu yedi iş grubuna ayırır. Bayrak kapalı, yanıt bozuk veya endpoint hatalıysa legacy shell
  kullanılır; query/localStorage değeri rollout açamaz.
- **Sınav çalışma alanı:** `GET /exams/:examId/workspace`, mevcut sınav ve katılımcı depolarından
  salt okunur hazırlık özeti üretir. Yeni `/kurum/sinavlar/[examId]` route'u beş hazırlık adımı ve
  mevcut optik/rapor geçişlerini gösterir; yeni yazma endpoint'i veya DB migrationı yoktur.
- **Güvenlik:** Route `academic:manage` exact capability, tenant bağlamı ve açık admin rol/persona
  sınırını birlikte uygular. Başka tenant 404 alır; öğretmen, öğrenci, veli, sistem, role-preview ve
  kampüs kapsamlı çalışan reddedilir. Response öğrenci/katılımcı kimliği taşımaz.
- **Rollback:** (Tarihçe) `web.exam-workspace-v2` Berrak G6'da ADR-0008 cutover ile emekli oldu; çalışma
  alanı kanoniktir ve rollback önceki image'a dönüşle yapılır. Compose yalnız server-side rollout
  environment/JSON değerlerini API'ye geçirir; istemciye allowlist veya public env verilmez.
- **Kapsam sınırı:** Gerçek tenant aktivasyonu yapılmadı. Önceden var olan kampüs kapsamlı rapor
  erişim borcu bu salt okunur dilimde değiştirilmedi; kampüs kapsamlı pilot veya Gate D açılmadan önce
  ayrı güvenlik diliminde kapanmalıdır.
- **Sonuç:** Gate C hedefli API/Playwright, 82 route manifesti, 234 path OpenAPI, üç görev x beş örnek
  measurement baseline, Docker/Compose ve izole portta tam `pnpm run ci` yerelde `PASS`.
  Bağımsız güvenlik ve PR yeniden incelemelerinde açık P0/P1 kalmadı.
  GitHub CI, gerçek tenant flag aktivasyonu, staging, deploy, RUM/UAT, pilot ve production
  `EXTERNAL_NOT_RUN`.

## Almanak 2.0 Gate D — Çekirdek Ürün Staging Kapanışı (2026-08-12)

- **Sınav/optik/rapor:** Ana iSEM fixture'ı 21 eşleşme/sonuç/rapor üretir. Ayrı gerçek karantina probe'u
  `OPEN → resolve → idempotent replay → sonuç → aynı snapshot JSON/XLSX/PDF` zincirini doğrular;
  go-live checker probe olmadan PASS vermez. Private fixture temiz checkout'ta staging secret'larından
  geçici, hash-doğrulamalı input root'a alınır ve run sonunda temizlenir.
- **Öğrenci:** Registry v2 server-side query kullanır; 10.001 kayıt sentetik bütçesi 500 ms altındadır.
  Import commit idempotency anahtarı ister. Tek overview read model legacy 14 istek fanout'unu kaldırır.
- **PII ve campus scope:** Öğrenci/guardian/öğretmen telefon ve e-postası API'de maskelenir. Öğretmen,
  kampüs çalışanı, finans ve tenant sınırları sunucuda uygulanır; client maskesi yetki kontrolü değildir.
  Kampüs kapsamlı personel tenant-geneli kimlik davetlerini listeleyemez, oluşturamaz veya yeniden gönderemez.
- **StudentContact/guardian geçişi:** İletişim kişisi manuel ve import akışında şifreli saklanır, tüm
  izinleri default-off'tur ve hesap/session/davet üretmez. Okuma privacy/self sınırındadır; create
  zorunlu replay-safe idempotency anahtarı taşır; kişi silme ve öğrenci KVKK purge'u iletişim PII'sini,
  hash'leri ve izin kanıtını anonimleştirir.
  Guardian read-only rollout yeni yazma ve davet yollarını kapatır; fiziksel silme yapılmaz.
- **Kurulum/IAM:** Server readiness, altı deep-link kurulum route'u, çalışan rol/kampüs tenant-wide
  sınırı ve eşzamanlı PENDING çalışan daveti unique sözleşmesi hazırdır. Migration en yeni daveti
  korur; eski kopyaları revoke eder ve teslimat payload'larını expire eder; migration kilidi index
  kurulumu sırasındaki canlı yazma yarışını kapatır.
- **MFA politikası:** MFA yalnız `SYSTEM_ADMIN` için zorunludur. Kurum sahibi,
  kurum yöneticisi ve alt kullanıcılar enrollment/challenge almaz; çalışan daveti ve rol değişimi MFA
  kodu veya `X-Step-Up-Token` istemez. `owner:manage`, tenant kapsamı, üyelik sürümü ve son aktif sahip
  korumaları devam eder. Parola yenilemedeki user/membership sürüm eşliği staging login akışında
  doğrulandı.
- **Staging kanıtı:** Exact CI/deploy, iSEM 21 sonuç/rapor + gerçek karantina probe'u, canlı
  UI/PDF/XLSX/öğrenci/veli/logout, `app` rolü ve RLS altında 10k registry p95 `21,655 ms`, yanlış tenant
  `0`, disposable veri rollback'i ve iki rollout anahtarının gerçek endpointte `OFF → ON → OFF` zinciri
  `PASS`. Dört public artifact remote/local hash eşitliğiyle saklandı; aktif doğrulama session'ı `0`.
- **Sonuç:** API `144/1085`, web UX `132`, route smoke `90`, route manifest `88/19`, görsel `32`,
  OpenAPI `238`, idempotency `46`, RLS `64/110`, production evidence template, ölçüm baseline,
  exact GitHub CI `31542604334` ve staging deploy `31543523234` `PASS`. UAT-SYS-02 ve
  UAT-KURUM-01 gerçek activation e-postası, parola yenileme, tenant login ve kurulumla exact runtime
  üzerinde `PASS`; genel Gate D kapandı. Gate E yalnız WAL archive izin kök-neden dilimiyle başladı.

## Faz 6 — Portallar, İletişim, Destek ve Finans Repo Kapanışı (2026-08-12)

- **Öğretmen/öğrenci portalları:** Günlük özet ve öncelikli görevler ilk görünümde yer alır. Portal
  route'ları persona-kapsamlı `/me/**` okumalarını kullanır; legacy/geniş dataset yollarının çağrılmadığı
  mobil/tablet tarayıcı sözleşmeleriyle korunur.
- **İletişim/destek:** Duyuru composer, alıcı/okunma raporu, provider teslim raporundan ayrı görünür;
  destek master-detail ve materyal akışları mevcut API/test sözleşmeleriyle çalışır. SMS release
  kapsamı dışında ve disabled-path'tedir.
- **WhatsApp sınırı:** Duyuru ekranı mutasyonsuz default-off izin yaşam döngüsü görünümünü gösterir.
  İzin yönetimi veya runtime kaydı açılmaz; `WHATSAPP_ENABLED=false` ve sıfır kayıt kuralı sürer.
  Kullanıcı dış ortam/provider kanıtını sonraya bırakmıştır; alt kapsam
  `CONTRACT_READY_EXTERNAL_NOT_RUN` kalır.
- **Finans:** Özet, taksit/tahsilat master-detail, idempotent transaction ve finans/akademik yetki
  ayrımı mevcut API ve tarayıcı negatif testleriyle korunur. Ödeme sağlayıcı/fatura/makbuz `V1_OUT`tur.
- **Sonuç:** Faz 6 repo davranışı `LOCAL_STATIC` / `LOCAL_SYNTHETIC` düzeyinde kapanmıştır. Hedefli
  API paketi 8 dosya/168 test, portal/iletişim/finans Playwright paketi 34 test, web typecheck,
  product journey, production plan, account-management DB, SMS disabled-path, ops ve production
  evidence template kontrolleri ve üç görev x beş örnek measurement baseline `PASS`tir. İzole portta
  `NEXT_E2E_PORT=43162 pnpm run ci` tam repo zinciri de `PASS`tir. Bu kapanış staging/provider,
  production veya Gate E kapanışı değildir; Gate F başlatılmamıştır.

## Production Teknik Aktivasyonu — 2026-08-05

- Mevcut sunucu kullanıldı; yeni VPS kurulmadı. `DOMAIN`, uygulama URL'leri, CORS ve Sentry ortam adı
  `o-okul.com` / `production` olarak aktive edildi.
- Web, API, worker ve queue-board aynı image SHA ile çalışıyor:
  `3e460783b35436dbd33dbc534ce57e2139d40f3f`. `/login`, `/health` ve `/health/ready` apex üzerinde
  `200`; wildcard host üzerinde `/health` ve `/health/ready` `200`, `/login` beklenen `307 /giris`.
- Cloudflare authoritative DNS üzerinde `*.o-okul.com A 212.108.107.190`, `DNS only`, TTL `Auto`
  kaydedildi. 1.1.1.1 ve 8.8.8.8 ilk sorguda aynı IP'yi döndürdü.
- Traefik/Let's Encrypt origin sertifikası `o-okul.com` ve `*.o-okul.com` SAN'larını içeriyor;
  geçerlilik sonu 3 Kasım 2026. API router'ın redundant ACME isteği giderildi.
- Kesim öncesi env, compose, ACME ve PostgreSQL yedeği
  `/root/o-okul-cutover-backups/20260805T161400Z` altında; checksum ve `pg_restore --list` kontrolü geçti.
- Bu teknik aktivasyon go-live onayı değildir. `pnpm prod:env:check` canlı sunucuda hâlâ `FAIL`:
  notification provider/inbox smoke, güvenli harici S3, Sentry, WAL/off-host backup, pull edilebilir image
  rollback hedefi, restore tatbikatı, alerting, RLS/MFA/UAT/pilot ve go-live evidence
  hedefleri tamamlanmalıdır.

## Silinen Tarihsel Kayıtlar

- Kök plan ve `claudedocs` altındaki tarihsel tasarım/uygulama planları.
- Tarihli development, architecture, modernization, assessment ve tam modül audit belgeleri.
- Faz 0-6 raporları ve faz 0-2/A-E checklist dosyaları.
- Eski UI rollout planı; aktif kabul ölçütleri `docs/ui-ux-professionalization-contract.md` içinde.

Korunan aktif sözleşmeler:

- `docs/DECISIONS.md`
- `docs/product-journeys-v1.md`
- `docs/phase-6-production-readiness.md`
- `docs/phase-6-ops-runbook.md`
- `docs/ui-ux-professionalization-contract.md`
- `docs/phase-b-list-query-contract.md`
- `docs/llm-wiki/README.md`

## Açık İşler

Güncel sıralama `docs/ozel-k12-strateji-ve-yol-haritasi-plan.md` §11 (DEC-20261010-01, onaylı) içindedir.
`docs/account-management-architecture-plan.md` bölüm 6'daki eski Gate E/F listesi bu planla yer değiştirdi.

1. S1: staging rol UAT'ı sürüyor (`docs/staging-uat-s1.md`). S1-01..S1-03 PASS (2026-10-10/11); S1-04 sürüyor,
   S1-05..S1-14 başlamadı. Kapanan bulgular: F-04, F-06..F-13, F-15, F-16 (#159, #161–#166, #168). Açık: F-14
   e-posta yalnız doğrulanmış hedeflere gidiyor (Yüksek; S1-05 davet akışını bekletir). 2026-10-15 panel
   kontrolü: `o-okul.com` Email Sending'de Enabled ve DNS Configured, yani kısıt kalkmış olabilir (UNPROVEN);
   ürün sahibi kararıyla S1-04'te finans davetini doğrulanmamış bir adrese yeniden göndererek doğrulanacak.
   F-01 davet e-postası spama düşüyor (Yüksek): DMARC `p=none`, SPF `softfail`; karar: önce Cloudflare DMARC
   Management raporları, politika sonra. Etkinleştirme panelden yapılmadı (ajan için DNS değişikliği izni
   yok); ürün sahibi Email > DMARC Management'tan açacak. F-03 davet iptali (#180) ve F-11 bağ kaldırma
   (#182) main ve staging'de; F-02 tek adımda yönetici daveti, F-05 içe aktarmada sınıf yönlendirmesi ve
   kabul/iptal yarışı telafisi #184 ile main'de (`52ce7d03e`, 2026-10-14). Yarışta geri alınan kabulün
   oluşturduğu hesap kullanılmıyorsa silinir (#185, `78a0e0bdd`; var olan hesabın parolası
   değişmez). Öğrenci kodu ve veli daveti iptal ekranları ile öğrenci kabulünde ulusal kimlikle eşleşen hesabın
   korunması #191 ile main ve staging'de (`df86002b7`); ulusal kimlikle eşleşmede kabulün parolayı
   sıfırlaması ürün sahibi kararıyla korunur (2026-10-15). Deneme lisansı 2026-10-17 00:00 UTC'de biter;
   ürün sahibi S1-14'te salt okunur geçişi gözler, ardından sistem yöneticisi olarak PRO dönem açar. Kontrol noktası 2026-11-14.
2. S2: PR #153 lisans sonu veri imhası main'de (`2b0ef97`, staging deploy PASS); imha, sıfırlama motorunun yazma sessizliği kapısı açılana kadar çalışmaz.
3. S4: §3.4 doğrulama planı (dosya talebi, görüşmeler, pilot taahhüdü); ürün sahibi işi.
4. S5/S6: PO-3 kapasite ölçümü ve PO-10 production kanıt zinciri; PO-10 tarihi 2027-01-03'te.
5. S3: PO-2 off-host TR yedek; ürün sahibi kararıyla en sona kaldı (2026-10-10). Aday karşılaştırması `docs/po-2-tr-s3-karsilastirma.md`.
6. Staging deploy altyapısı (IMG, 2026-10-14/15): imaj çekme 20 dk sınırına takılıyordu. IMG-1 (#186) bağımlılık
   katmanını kaynaktan ayırdı ve dört imaja tek `node_modules` katmanı verdi; IMG-2c (#187, düzeltme #188) çekmeyi
   servisler durmadan 30 dk bütçeyle üç denemeye ve deploy işini 50 dk'ya aldı, Traefik smoke'a sınırlı yeniden
   deneme ekledi; IMG-2d (#189) derleme önbelleğini GHCR `buildcache:<hedef>`'e taşıdı (`type=gha` hiç
   yazılmıyordu). Kabul ölçümü karşılandı (STAGING, #191 deploy `38750057836`): `node_modules`
   `bd106670c2e0` ve Chromium `9209bd9dd1bd` aynı kaldı, dört derlemede `pnpm install` önbellekten geldi,
   deploy adımı 2 dk 41 sn. Staging otomatik deploy 2026-10-15'te açıldı (`STAGING_AUTO_DEPLOY=true`). Ağ teşhisi (STAGING, salt okunur;
   hiçbir ayar değişmedi): Cloudflare Origin Analytics'te TCP el sıkışması 1,2 sn; sunucu her Cloudflare
   bağlantısında tek SYN görüp hemen yanıtlıyor, sunucuda düşürme yok (UFW, conntrack, listen kuyruğu),
   doğrudan bağlantılar 30–70 ms. En tutarlı açıklama Cloudflare'in ilk SYN'inin sağlayıcı ağında düşmesi
   (UNPROVEN). Seçenek: Cloudflare Tunnel (belgeye göre tüm planlarda var); ürün sahibi maliyet ve süre
   sordu, karar açık. `*.o-okul.com` ve `staging.o-okul.com` pilot edge kararına kadar DNS only kalır
   (2026-10-15 kararı); bu yüzden Tunnel yalnız `o-okul.com`'u etkiler.

Önceki plandan devralınan kalemler (`docs/account-management-architecture-plan.md` bölüm 6). Durumlar
2026-10-15'te main `c619b8f7e` üzerinde kod okumayla yeniden doğrulandı (LOCAL_STATIC):

- Öğrenci tutarlılığı/tekrar güvenliği dilimi (`8b9cf6be8`, #99; sınıf temizlemede açık kayıt da sınıfsız,
  toplu yenilemede öğrenci başına anahtar) KAPANDI: main'de ve sonraki exact-SHA kanıtlarında var (CI
  `38767657174` + STAGING_DEPLOY `38770379316`, `c619b8f7e`). Staging'de davranış ölçümü UNPROVEN.
- P0 `@Roles` kesimi KISMİ: 22 controller'da 154 `@Roles` (plan 146 diyordu), 208 `@RequireCapability`.
  `@Roles` `roleRank` ile çalıştığı için `@Roles("TEACHER")` route'larından yönetici rolleri de geçer.
  Artış 2026-10-15'ten beri `pnpm api:roles-inventory:check` ile CI'da engellenir. İlk route ailesi
  `teacher-note` taşındı (`note:read-assigned` / `note:write-assigned`; kabul edilen rol kümesi değişmedi):
  21 dosyada 150 `@Roles` kaldı. Sıradaki aileler küçükten büyüğe: `search`, `announcement`, okul
  controller'ları; en büyüğü `me.controller.ts` (81).
- P0 ayrı platform auth realm KISMİ: `PlatformAccount`/`PlatformSession` şeması ve backfill var, runtime
  kullanımı yok; sistem yöneticisi hâlâ `system` tenant oturumuyla girer.
- P0 süreli/MFA'lı breakglass AÇIK: `RlsBypassGuard` rol, kapsam, gerekçe ve audit ister ama süre ve MFA
  step-up istemez; `@AllowBreakGlassRlsBypass()` hiçbir route'ta yok.
- P1 offboarding KISMİ (lisans sonu imhası #153 var, `POST /tenants/:id/offboarding` yok, imha yazma
  sessizliği kapısını bekler); cursor KISMİ (`/employees`, `/students/portal-access` var; `/students`,
  `/tenant-users`, `/identity-invitations` yok); staging tablolu toplu import AÇIK; outbox grant revoke AÇIK
  (gerçek sağlayıcı teslim kanıtını bekler).

### Dilim kapanış kaydı

Plan `docs/ozel-k12-strateji-ve-yol-haritasi-plan.md` §10.1 uyarınca her dilim kapanışında bir satır eklenir.

| Tarih | Dilim | Kanıt sınıfı | SHA / PR | Plan gün / gerçek gün |
|---|---|---|---|---|
| 2026-10-04 | KV-1 veli kimlik flag kaldırma | CI `37230972132` + STAGING_DEPLOY `37232029614` PASS | `44b93ed` / PR #125 | 5–10 / 2 |
| 2026-10-04 | Hijyen PO-1 + KV-6 | CI `37233050361` + STAGING_DEPLOY `37234136071` PASS (toplu merge #137) | `b424444` / PR #126 | 2,5–5 / 2 |
| 2026-10-04 | AK-1 + AK-2 tenant kapıları ve not şeması | aynı (#137) | `b767d38` / PR #127 | 5–10 / 2 |
| 2026-10-04 | AK-3 + AK-4 gradebook API ve not ekranı | aynı (#137) | `5c27298` / PR #128 | 15–25 / 2 |
| 2026-10-04 | KF-5 kartsız deneme + gecelik yedek | aynı (#137); staging restore drill PASS 2026-10-05 | `dd11ba2` / PR #131 | 2,5–7,5 / 2 |
| 2026-10-04 | KF-10 doğrulama kiti | aynı (#137) | `f641860` / PR #132 | 5–10 / 2 |
| 2026-10-04 | KF-1 muhasebe 403, KF-2 ödeme planı, KV-9 MFA | aynı (#137) | PR #136, #135, #134 | 5–10, 10–20, – / 1 |
| 2026-10-05 | KV-7 push, KV-4 veli özeti + PWA, AK-6 ödev teslimi | CI `37275036320` + STAGING_DEPLOY `37276592056` PASS (toplu merge #141) | PR #138, #139, #140 | 10–15, –, – / 1 |
| 2026-10-05 | KV-3, KV-3b–e veli daveti ve bağlama | son: CI `37307143622` + STAGING_DEPLOY `37308747203` PASS | PR #143, #145–#148 | – / 1 |
| 2026-10-05 | KF-9 fiyat sayfası, KV-8 otomatik veli bildirimleri | Kendi run'ları runner almadığı için düştü (kod hatası değil); kod `f712fda` ile CI `38048883293` + STAGING_DEPLOY `38049664810` PASS | PR #151, #152 | 7,5–15, 15–25 / 1 |
| 2026-10-10 | Ajan/skill yönetişimi: Claude Code kanonik yüzey, Codex kaldırıldı, `.claude/settings.json` subagent sınırları, `pnpm agents:check` sahiplik/gate/roster denetimi (plan dışı araç dilimi) | CI (main `38048883293` PASS) + STAGING_DEPLOY (Staging Deploy #188 `38049664810` PASS; dört servis `f712fda` imajı, cutover artifact'i yayınlandı) | `f712fda` / PR #154 | – / 1 |
| 2026-10-13 | Idempotency kapsamı: 23505→409, `code` zorunlu, 14 uca anahtar, gerekçeli istisna listesi, 24 saat saklama (Dilim 1.1 hariç) | CI `38393601309` PASS + STAGING_DEPLOY `38402654154` PASS (dört servis `0accd7d2d`); saklama sweep'i staging worker log'unda saatlik çalışıyor | `5e03fc163` / PR #173, baseline düzeltmesi `0accd7d2d` / PR #174 | – / 1 |
| 2026-10-13 | Idempotency Dilim 1.1: bekleyen e-posta daveti tekil indeksi, otomatik davette yeniden kullanım | Main CI `38448933680` PASS (ilk main koşusu `38441995907` backfill testi kapanış yarışıyla düştü, düzeltme #177) + STAGING_DEPLOY `38456086610` PASS (elle dispatch, main `56120c677`; dört servis `56120c677` imajı). Staging salt okunur doğrulama (2026-10-13 19:50 UTC): migration `20261013160000` kaydı 19:47 UTC, `IdentityInvitation_one_pending_email_link_key` kısmi tekil indeksi kurulu, çift bekleyen davet 0, bekleyen EMPLOYEE 1 / STUDENT 2 değişmedi, migration REVOKED satır üretmedi. Not: otomatik deploy `38451338291` yalnız preflight koşmuştu (`STAGING_AUTO_DEPLOY` kapalı); ilk elle dispatch `38454887848` docs merge'inin CI'ı bitmeden tetiklendiği için `github-ci-evidence`'ta düştü, staging'e dokunmadı | `8ca26e768` / PR #175, test düzeltmesi `e5d57b21b` / PR #177, kayıt PR #178 | – / 1 |
| 2026-10-13 | UAT F-03 davet iptali: `POST /identity-invitations/:id/revoke`, Çalışanlar ve öğretmen ayrıntısında "Daveti iptal et", süresi dolmuş davet bekleyen sayılmaz (S1 bulgu dilimi) | CI `38479108671` PASS + STAGING_DEPLOY `38481232415` PASS (elle dispatch, dört servis `adcca4617`). Staging doğrulama (23:13 UTC, salt okunur): kimliksiz `POST …/revoke` 401 (deploy öncesi 404), `…/resend` 401, bilinmeyen rota 404, `/health` ve `/health/ready` 200; migration sayısı 126 değişmedi, UAT kurumu davet durumları değişmedi | `adcca4617` / PR #180 | – / 1 |
| 2026-10-14 | UAT F-11 izleyen iş: `DELETE /grade-levels/:id/courses/:courseId` (academic:manage, 204; aktif öğretmen ataması varsa 409 `GRADE_LEVEL_COURSE_IN_USE`), Seviyeler penceresinde "Bağı kaldır" (S1 bulgu dilimi) | CI `38554098464` PASS + STAGING_DEPLOY `38561474048` PASS (elle dispatch, rollback etiketi `adcca4617`; preflight 0,4 / evidence 0,4 / build 3,5 / deploy 8,2 / evidence 1,2 dk; dört servis `6b97e107c` imajı, web/api/queue-board healthy). Staging doğrulama (12:25 UTC, salt okunur, API konteyneri içinden `uat-s1-okulu` host'u ile): kimliksiz `DELETE /api/v1/grade-levels/x/courses/y` 401 (rota yayında), `…/revoke` 401, bilinmeyen rota 404, `/health` ve `/health/ready` 200; migration sayısı 126 değişmedi (PR migration içermiyor). Not: otomatik deploy koşusu `38556291332` yalnız preflight koştu (`STAGING_AUTO_DEPLOY` kapalı) | `6b97e107c` / PR #182 | – / 1 |
| 2026-10-14 | UAT F-02 tek adımda yönetici daveti, F-05 içe aktarmada sınıf yönlendirmesi, davet kabul/iptal yarışı telafisi (S1 bulgu dilimi) | CI `38574242758` PASS + STAGING_DEPLOY `38576635724` PASS (elle dispatch, rollback etiketi `6b97e107c`; dört servis `52ce7d03e`). Staging doğrulama (14:15 UTC, salt okunur): `/health`, `/health/ready` ve `/kurum/calisanlar` 200, migration sayısı 126 değişmedi; tek UNCERTAIN activity kaydı 2026-10-01 tarihli sentetik `rls-tenant-b` worker işi, bu dilimle ilgisiz | `52ce7d03e` / PR #184 | – / 1 |
| 2026-10-14 | #184 incelemesi P2-2: geri alınan davet kabulünün oluşturduğu kullanılmayan hesabın silinmesi (`deleteUnusedTenantUser`; var olan hesabın parolası değişmez) | CI `38581254778` PASS + STAGING_DEPLOY `38599058389` PASS (ilk dispatch `38594341634` imaj çekmede 20 dk zaman aşımı, staging değişmedi, onaylı yeniden deneme); dört servis `78a0e0bdd`, kimliksiz revoke 401, health 200, migration 126 (STAGING, salt okunur) | `78a0e0bdd` / PR #185 | – / 1 |
| 2026-10-14 | IMG-1: Dockerfile'da bağımlılık katmanı kaynaktan ayrıldı, worker ortak `node_modules` katmanına bağlandı (çalışma zamanı değişmedi) | CI `38625807972` PASS + STAGING_DEPLOY `38632974369` PASS (ilk dispatch `38628169361` çekmede 20 dk zaman aşımı; yeniden denemede deploy adımı 16 dk 13 sn; evidence işi Traefik smoke zaman aşımıyla düştü, onaylı yeniden çalıştırmayla deneme 2'de PASS); dört imaj tek `node_modules` katmanı (`d496e9d271d5`), migration 126 | `342ea5ac6` / PR #186 | – / 1 |
| 2026-10-15 | IMG-2c: imaj çekme servisler durmadan 30 dk bütçeyle üç deneme, deploy işi 50 dk, Traefik smoke'a sınırlı yeniden deneme | CI `38642349815` PASS; STAGING_DEPLOY `38686591623` deploy adımı PASS (çekme tek denemede 343 sn, adım 8 dk 20 sn) ama evidence işi FAIL: smoke kanıtına eklenen `attempts` alanı sabit 11 alanlı şemayı bozdu (SMOKE_EVIDENCE_PAYLOAD_INVALID); staging çalışır kaldı | `ab3a42cf7` / PR #187 | – / 1 |
| 2026-10-15 | IMG-2c gerilemesi düzeltmesi (`attempts` kanıttan çıkarıldı) ve IMG-2d: derleme önbelleği GHCR `buildcache:<hedef>` (önceki `type=gha` cache hiç yazılmıyordu) | CI `38705116032` (#188) ve `38711336549` (#189) PASS + STAGING_DEPLOY `38713167161` beş işte PASS (kanıt işi dahil), deploy adımı 8 dk; dört önbellek manifesti GHCR'a yazıldı; dört servis `de0bbced0`, migration 126, health 200. Kalıcılık kabulü açık: bir sonraki bağımlılık değişmeyen deploy | `7419f4731` / PR #188, `de0bbced0` / PR #189 | – / 1 |
| 2026-10-15 | Öğrenci kodu ve veli daveti iptal ekranları; öğrenci kabulünde ulusal kimlikle eşleşen hesabın geri almada korunması (S1 bulgu dilimi) | CI `38747200244` PASS + STAGING_DEPLOY `38750057836` beş işte PASS (elle dispatch); derleme 3 dk 27 sn, deploy adımı 2 dk 41 sn, IMG katman özetleri aynı (kabul karşılandı); dört servis `df86002b7`, migration 126, health 200, kimliksiz revoke 401 | `df86002b7` / PR #191 | – / 1 |
| 2026-10-15 | K7 öğretmen ayrıntısı yalnız o öğretmenin davetlerini ister (`q=<teacherId>`); K8 sıfırlama anlık görüntüsü saati veritabanından (`now()`); staging otomatik deploy açıldı | CI `38767657174` PASS (ilk PR koşusu `verify`'da Gate B baseline kaynak özeti yüzünden düştü, baseline temiz ağaçta yenilendi) + ilk OTOMATİK STAGING_DEPLOY `38770379316` (`workflow_run`, elle dispatch yok) beş işte PASS: preflight 0,5 / evidence 0,5 / build 3,6 / deploy 2,6 / evidence 1,4 dk. Staging salt okunur doğrulama (2026-10-15 16:47 UTC): web/api/worker/queue-board `c619b8f7e` imajı, web/api/queue-board healthy, migration 126 (PR migration içermiyor), api `/health` ve `/health/ready` 200 | `c619b8f7e` / PR #192 | – / 1 |
| 2026-10-15 | P0 legacy-rol kesimi, ilk aile: `/teacher-notes` uçları `@Roles("TEACHER")` yerine `note:read-assigned` / `note:write-assigned` (kabul edilen rol kümesi aynı); `@Roles` 154 → 150 | LOCAL_TEST: api 1413 test PASS; yetki matrisi e2e testi eski ve yeni controller'da aynı sonuç; rol-yetki birim testi. CI ve otomatik staging deploy merge sonrası | bu PR | – / 1 |

Not: `38565136132` (2026-10-14, `82ae7be74`) boş bir Staging Deploy koşusudur. Aynı commit başka bir oturumca deploy edilmişti (`38561474048`). Araya giren docs merge'i yüzünden `github-ci-evidence` işinde düştü; staging değişmedi.

Tüm satırlarda plan günü efor haftası × 5 iş günüdür; gerçek gün dilim başlangıcından merge'e takvim günüdür. Kanıt main'e girme ve deploy kanıtıdır; dilimlerin kabul metrikleri STAGING'de ölçülmedi (UNPROVEN, S1).

Guardian fiziksel silme, grant revoke, production deploy veya go-live; ilgili teknik güvenlik kapıları
ve gerçek ortam kanıtı olmadan yapılamaz. Workspace mailbox/alias testi tamamlanmıştır; exact-SHA
uygulama-provider teslim testi yerine geçmez. Şablon veya statik checker sonucu canlı kanıt yerine kullanılamaz.

## Doğrulama

2026-08-12 Gate D final yerel + staging sonuçları:

- API tam paket: 144 dosya/1085 test; DB/RLS: 64 tenant tablo/110 composite FK `PASS`.
- Student registry/import/overview/PII, setup deep-link, IAM ve optik hedefli web/API kontrolleri;
  10k sentetik registry bütçesi ve same-snapshot karantina export probe'u `PASS`.
- Web UX 132, route smoke 90, görsel 32; route manifest 88 route/19 modül; OpenAPI 238 path;
  idempotency 46 operasyon; production evidence/go-live template ve üç görev x beş örnek güncel
  measurement baseline `PASS`.
- Tam repo zinciri `NEXT_E2E_PORT=43148 pnpm run ci`: `PASS`.
- Exact GitHub CI `31542604334`, deploy `31543523234`, staging iSEM/UI/PDF/XLSX, gerçek PostgreSQL 10k p95 ve tenant rollout
  rollback: `PASS`; public artifact hash'leri `docs/almanac-2-gate-d-evidence.md` içinde kayıtlıdır.
- UAT-SYS-02/UAT-KURUM-01: gerçek provider delivery, activation, parola yenileme, tenant login ve
  kurulum `PASS`; final DB sonucu 1 kampüs, 2 sınıf, 6 ders, 1 akademik yıl ve 1 dönemdir.
- Gate E WAL archive volume sahipliği disposable Docker projectte `postgres:postgres 0700`, gerçek
  `pg_switch_wal()` ve `pnpm wal:archive:smoke` ile `PASS`; `pnpm docker:check`, `pnpm ops:check` ve
  `pnpm prod:evidence:templates:check` `PASS`.
- Exact-SHA merge `b2b91d9ec160d43d119937336782127e7e77325d`: main CI `31735017355` üç işte,
  Staging Deploy `31735953577` preflight/build/deploy/evidence zincirinde `PASS`. Web, API, worker
  ve queue-board aynı SHA image tag'iyle çalışır; `/health`, `/health/ready` ve `/login` HTTP 200'dür.
- WAL artifact `9195500657` repo validatoründen `environment=staging`, S3 hedefi,
  `archiveMode=on`, `walLevel=replica`, geçerli marker/archive hash'leri ve `gaps=[]` ile `PASS`;
  artifact digest'i `sha256:8b63ccf7c8fbc0d7309b789d0c5bbaf91c72c01300d5349beff0d47945709697`.
  Canlı WAL dizini `postgres:postgres 0700`, yazılabilir ve doğrulama anında 10 arşiv dosyası taşır.
- Gate D `PASS`; Gate E WAL dış kanıt dilimi kapandı. Gate E'nin geri kalanı açık; pilot ve
  production `EXTERNAL_NOT_RUN`, Gate F başlatılmadı.

2026-08-10 Gate C yerel sonuçları:

- Workspace API: 1 dosya/26 test; tenant/role/persona/campus/PII negatifleri `PASS`.
- Gate C Playwright: enabled, disabled, error, malformed, rol/persona ve legacy senaryoları;
  320/414/768/1024/1440 görünüm,
  sıfır mutation ve aynı-sınav rollback kontrolü `PASS`.
- Web UX: 129 sözleşme, 84 route smoke ve 32 görsel test; route manifest 82 route/19 modül kararı
  `PASS`.
- Shared/API/web typecheck, Docker/Compose, OpenAPI 234 path, ölçüm baseline 3 görev x 5 örnek,
  `NEXT_E2E_PORT=43127 pnpm run ci` ve `git diff --check`: `PASS` (`LOCAL_STATIC` /
  `LOCAL_SYNTHETIC`).
- GitHub Actions CI, gerçek tenant rollout, staging/production, deploy, RUM/UAT ve pilot:
  `EXTERNAL_NOT_RUN`.

2026-08-10 Gate B yerel sonuçları:

- Architecture, route manifest, feature rollout, product analytics ve measurement baseline
  kontrolleri: `PASS`.
- Rollout/audit/RBAC hedefi: 4 dosya/41 test; analytics: 2 pozitif/30 negatif fixture; route manifest:
  81 route/19 modül kararı; measurement: 3 görev x 5 örnek ve 0 runtime hata `PASS`.
- RLS: 64 tenant tablo/110 composite FK; web token storage, PII policy, UX baseline, API/shared/web
  typecheck, OpenAPI 233 path ve tam `pnpm run ci`: `PASS` (`LOCAL_STATIC`).
- İki bağımsız son inceleme: açık P0/P1 yok.
- GitHub Actions CI, staging/production tenant rollout, gerçek RUM/kullanıcı gözlemi, analytics
  transportu, deploy ve production: `EXTERNAL_NOT_RUN`.

2026-08-09 Gate A yerel sonuçları:

- Disposable PostgreSQL/Redis/MinIO üzerinde gerçek iSEM optik producer smoke: `PASS`; 21 katılımcı,
  21 eşleşme, 0 karantina, 21 sonuç ve 21 rapor.
- Producer artifact'i, ortak evidence checker, live-exam-cycle checker, UI-worker input contract ve
  bütün evidence template kontrolleri: `PASS` (`LOCAL_STATIC`).
- RBAC hedefli `src/rbac src/auth src/tenant`: 20 dosya/156 test `PASS`; tenant RLS, token-storage,
  API/shared/web typecheck ve audit negatif matrisleri `PASS`.
- `pnpm run ci` ve `git diff --check`: `PASS` (`LOCAL_STATIC`; GitHub Actions CI değildir).
- Gerçek UI-worker browser sonucu, GitHub CI, staging, provider, deploy ve production:
  `EXTERNAL_NOT_RUN`.

2026-08-05 plan kontrolü:

- `pnpm agents:check`, `pnpm product-journeys:check`, `pnpm prod:plan:check`: `PASS`.
- API ve web typecheck: `PASS`.
- `pnpm prod:evidence:templates:check`: örnek/template sözleşmesi `PASS`; canlı kanıt değildir.
- Production domain/DNS/TLS ve temel endpoint kontrolleri canlı `PASS`; `pnpm prod:env:check` canlı `FAIL`.
- Tam `pnpm run ci`, uygulama-provider inbox, restore, UAT, pilot ve production evidence gate'leri çalıştırılmadı.
- Çalışma ağacında kullanıcıya ait support/notification/UI değişiklikleri korunmuştur.

2026-07-13 yerel sonuçları:

- `pnpm run ci`: `PASS`.
- API: 115/115 test dosyası, 752/752 test.
- Worker: 33/33 test dosyası, 173/173 test.
- Web: 6/6 a11y, 1/1 backup/restore paneli, 85/85 UX sözleşme testi.
- DB/RLS: 57 tenant tablo, 100 composite tenant FK.
- OpenAPI: 207 path; output contract `PASS`.
- Idempotency: 43 operasyon; header ve response envelope sözleşmesi `PASS`.
- Agent, journey, ops, Docker, evidence template, lint, typecheck ve production build: `PASS`.
- Son tenant/güvenlik re-review: P0/P1/P2 bulgu yok.
- Hedefsiz canlı durum kontrolü: `0/17`; bu sonuç dış kanıt olmadığını gösterir.

Değişikliklerin zorunlu kapanış zinciri:

```sh
pnpm agents:check
pnpm product-journeys:check
pnpm prod:plan:check
pnpm prod:evidence:templates:check
pnpm ops:check
pnpm docker:check
pnpm --filter @o-okul/shared-types typecheck
pnpm --filter @o-okul/api test
pnpm --filter @o-okul/worker test
pnpm openapi:generate
pnpm --filter @o-okul/web typecheck
pnpm run ci
git diff --check
```

Sonuçlar ancak komutlar bu çalışma ağacında yeniden çalıştırıldıktan sonra `PASS` olarak yazılır.
