# Almanak 2.0 Gate D Çekirdek Ürün Staging Kanıtı

Tarih: 2026-08-12
Branch: `agent/almanac-gate-d-local-20260810`
Başlangıç commit'i: `5f852becb7c6f0a04ca96355e075d863a13838b7`
Runtime commit'i: `bb2779bc1087a150b648407385e3cee1d0122692`
Kanıt düzeyi: `LOCAL_STATIC`, `LOCAL_SYNTHETIC`, `GITHUB_CI`, `STAGING_DEPLOY`,
`STAGING_DB_RUNTIME`, `STAGING_API_RUNTIME`, `STAGING_LIVE_UI` ve `STAGING_PROVIDER_DELIVERY`
Dış durum: UAT-SYS-02 ve UAT-KURUM-01 `PASS`; pilot ve production `EXTERNAL_NOT_RUN`

## Sonuç

Gate D'nin repo, GitHub CI, staging deploy, iSEM optik/rapor, canlı UI/PDF/XLSX, gerçek PostgreSQL 10k,
tenant rollout/rollback ve sıfırdan kurum onboarding maddeleri `PASS` durumundadır. UAT-SYS-02 ve
UAT-KURUM-01 exact runtime üzerinde gerçek provider teslimiyle tamamlandı; Gate D kapandı. Bu belge
pilot, production veya go-live kanıtı değildir.

## Sınav, optik ve rapor

- Sınav/cevap anahtarı/optik/karantina/rapor servisleri tenant-wide yönetim ile atanmış öğretmen okuma
  kapsamını ayırır; kampüs kapsamlı çalışan tenant-geneli yazma veya rapor verisi alamaz.
- Disposable iSEM smoke ana fixture'da `90 soru / 21 katılımcı / 21 eşleşme / 0 karantina / 21 sonuç /
  21 rapor` üretir. Ayrı negatif probe bir satırı `OPEN` karantinaya alır, resolve ve idempotent replay
  sonrasında bir sonuç ve aynı snapshot'tan öğrenci JSON, XLSX ve PDF üretir.
- Smoke yalnız `docs/evidence-manifests/isem-optical-pipeline-inputs.json` içindeki kanonik TXT/XLSX
  adlarını ve exact SHA-256 değerlerini kabul eder; keyfi dosya, symlink ve realpath kaçışı reddedilir.
  Temiz checkout/staging için private fixture secret'ları geçici `0700/0600` input root'a alınır,
  smoke'a secret yerine yalnız mutlak root aktarılır ve wrapper başarı/hata halinde root'u temizler.
- Ham optik arşiv yazımı sonrası DB hatasında S3 nesnesi temizlenir; karantina resolve/replay yarım
  durumda yeni sonuç veya job çoğaltmaz.
- Production summary ve go-live checker, karantina probe'u olmadan veya probe alanlarından biri false
  iken PASS üretemez.

## Öğrenci, kurulum ve IAM

- `web.student-registry-v2` açık tenantta liste arama/filtre/sıralama/sayfalama SQL içinde çalışır.
  10.001 kayıtlı yerel sentetik test yalnız istenen 50 satırı döndürür ve 500 ms bütçesini geçmez.
- Import commit `Idempotency-Key` olmadan reddedilir. Dry-run ve commit aynı kampüs/sınıf ve tenant-geneli
  okul numarası kurallarını kullanır.
- `GET /students/:studentId/overview`, profil, enrollment, devamsızlık, ödev/not sayıları, son rapor,
  iletişim, akademik referanslar ve yetkili activity özetini tek read modelde verir. V2 açılışında legacy
  14 istek önce çalışmaz.
- Öğrenci ve guardian iletişimi API trust boundary'sinde maskelenir; privacy yetkisi olmayan öğretmen
  veya kampüs çalışanı browser cevabında ham telefon/e-posta almaz. Yetkisiz guardian araması ham
  telefon alanını kullanmaz; kampüs kapsamlı çalışan overview'u güvenli alanlarla 200 döner.
- `StudentContact` manuel ve import akışında şifreli/hash'li saklanır, izinleri default-off'tur ve hesap,
  membership, invitation veya session üretmez. Liste privacy yetkisi ya da öğrenci-self kapsamı ister;
  create zorunlu ve replay-safe `Idempotency-Key` kullanır. Öğrenci KVKK purge'u iletişim PII'sini
  anonimleştirip ayrı PII-safe audit sayımı üretir. V2 import legacy guardian kolonlarını reddeder.
- `product.guardian-read-only` yeni guardian yazma/davet/provisioning yollarını kapatır. Mevcut
  `GuardianStudent` izin varsayılanları false'a taşınmıştır.
- Kurulum readiness sunucu kayıtlarından hesaplanır. Genel, dönem, sınıflar, dersler, kişiler ve hazırlık
  adımlarının ayrı deep-link route'u vardır; tarayıcı geri/ileri ve refresh kanonik URL'yi korur.
- Çalışan rol/kampüs değişiklikleri tenant-wide STAFF bağlamı ister. Aynı çalışan için eşzamanlı PENDING
  davet partial unique index ve servis sözleşmesiyle tekilleşir; migration eski kopyalarda en yeniyi
  korur, diğerlerini revoke eder ve bekleyen teslimat payload'larını expire eder. Transaction içindeki
  tablo kilidi, cleanup ile unique index kurulumu arasındaki canlı yazma yarışını kapatır.
- MFA yalnız `SYSTEM_ADMIN` için zorunludur. Kurum sahibi, kurum yöneticisi ve alt kullanıcılar
  enrollment/challenge almaz; kurum çalışanı daveti ve rol güncellemesi MFA kodu veya
  `X-Step-Up-Token` istemez. Parola yenileme `User.membershipVersion` ile aktif
  `TenantMembership.version` değerini aynı transaction içinde artırır. Bu politika final staging
  runtime ve canlı tenant login akışında doğrulandı.

## Güvenlik ve veri sınırı

- Student 360, registry, teacher/school referansları ve raporlar tenant + campus + assignment sınırını
  sunucuda uygular; client-side maskeleme güvenlik kontrolü olarak kullanılmaz.
- Başka tenant nesneleri 404 ile gizlenir. Finans capability'si olmayan kullanıcı overview finans verisi
  ve payment-plan isteği alamaz.
- Yeni iki migration additive/forward-fix uyumludur: guardian izin varsayılanları default-off ve çalışan
  PENDING davet partial unique indexi. Guardian fiziksel silme yapılmamıştır.

## GitHub ve staging doğrulama

| Kontrol | Sonuç |
| --- | --- |
| iSEM producer exact CI | `87b7d9766c7299c44d3c6a119ffbb122ddcbbfc8`; Actions `31401323883 PASS` |
| iSEM producer exact deploy | Actions `31402240519 PASS` |
| Final UI-worker exact CI | `65f01988328fbffca3a52a7c267b5119302f075c`; Actions `31406897722 PASS` |
| Final UI-worker exact deploy | Actions `31408010202 PASS`; web/API/worker/queue-board exact image, health `PASS` |
| Gate D final exact CI | `bb2779bc1087a150b648407385e3cee1d0122692`; Actions `31542604334 PASS` |
| Gate D final exact deploy | Actions `31543523234 PASS`; web/API/worker/queue-board exact image, health `PASS`; rollback `ac5b82cad37f25ca243f80a0abfde6155c017e61` |
| UAT-SYS-02 + UAT-KURUM-01 | Exact runtime üzerinde kurum/ilk owner, gerçek activation e-postası, parola yenileme, tenant login ve kurulum `PASS`; 1 kampüs, 2 sınıf, 6 ders, 1 akademik yıl, 1 dönem |
| Provider/DB kapanışı | Gateway health release `27e26d43a731c170401de0a948af735a987cd71e`; outbox `DELIVERED`, attempts `1`, error `null`; owner/membership version parity `PASS` |
| iSEM optik/rapor artifact'i | `/root/o-okul/artifacts/staging/isem-optical-pipeline.json`; SHA-256 `1ea6e772b6f242d5e9d72c3fb5cc0ecdfe58103222b20874ebcd9366d5b6719d` |
| Canlı UI/PDF/XLSX/portal/logout | `/root/o-okul/artifacts/staging/live-ui-worker-result.json`; SHA-256 `9531c3bee54dacec83b99b7c07f308bee54c82c2ffd355bd31f448847220bb3b` |
| Gerçek PostgreSQL 10k registry | `app` rolü + RLS, 10 warmup + 100 örnek; birleşik p95 `21,655 ms`, max `76,974 ms`, eşik `500 ms PASS`; yanlış tenant `0`; rollback sonrası tenant/öğrenci `0/0` |
| 10k query-plan artifact'i | `/root/o-okul/artifacts/staging/student-registry-postgres-performance.json`; SHA-256 `4f1df5283837f34011426e2e8a398094f319e8cd09a1ea2f266063dc6ff71b86` |
| Rollout ON/rollback | Disposable tenantta baseline `[]` → `web.setup-v2` + `web.student-registry-v2` → `[]`; gerçek endpoint `200`; audit `feature_rollout.exposed`; aktif doğrulama session'ı `0` |
| Rollout artifact'i | `/root/o-okul/artifacts/staging/gate-d-feature-rollout.json`; SHA-256 `d061ff88d3eb05001af8877c34f171659c7d0c63f40f4d5cf81abd9f81181cd6` |

iSEM producer `87b7d9766...` üzerinde çalıştı. Bu commit ile final `65f019883...` arasındaki kaynak farkı
yalnız canlı Playwright akışı, onun checker'ı ve runbook'tur; producer/worker/API pipeline kodu değişmedi.
Final Playwright kaydı `65f019883...` exact deploy üzerinde rapor hazır durumu, XLSX/PDF indirme, öğrenci ve
veli portalı ile logout `204` + eski refresh `401` zincirini doğruladı. Dört public artifact `0644` ve
remote/local hash eşitliğinde saklandı; private UI input, geçici fixture root'ları ve başarısız doğrulama
session'ları temizlendi.

Final onboarding kaydı `bb2779bc1...` exact deploy üzerinde çalıştı. Commit'teki test ile staging'de
çalıştırılan dosyanın SHA-256 değeri eşitti. Önceki 11 sentetik tenantın hesapları devre dışı ve aktif
oturumları sıfır bırakıldı; veri silinmedi. Yalnız final başarılı tenant owner hesabı aktif kaldı.

## Yerel doğrulama

| Kontrol | Sonuç |
| --- | --- |
| API tam paket | `144 dosya / 1085 test PASS`; `2 dosya / 4 test skipped` |
| DB/Prisma/RLS/FK | `64 tenant tablo / 110 composite FK PASS` |
| StudentContact + purge + campus + guardian hedefli API | `88 test PASS`; 10k sentetik bütçe dahil |
| Web UX sözleşmesi | `132 test PASS`; idempotent retry negatifi dahil |
| Setup deep-link sözleşmesi | `9 test PASS` |
| Route manifest ve viewport smoke | `88 route / 19 modül`; `90 test PASS` |
| Görsel sözleşme | `32 test PASS` |
| OpenAPI | `238 path PASS` |
| Idempotency envanteri | `46 operasyon PASS` |
| Production evidence template/go-live contract | `PASS` |
| Private iSEM input materialization/hash preflight | `PASS` |
| Measurement baseline | `3 görev x 5 örnek PASS`; `LOCAL_SYNTHETIC` |
| API/web typecheck ve diff whitespace | `PASS` |
| Tam repo zinciri | Exact GitHub CI `31542604334 PASS`; yerel test zinciri ve temiz production web build `PASS` |

## Açık dış kanıt

- UAT-SYS-02 ve UAT-KURUM-01 bearer-korumalı activation evidence yüzeyi, private system-admin girdisi
  ve gerçek provider teslimiyle exact runtime üzerinde `PASS` oldu.
- Gerçek kullanıcı RUM, pilot, production ve go-live Gate D staging kapanışının dışındadır ve
  `EXTERNAL_NOT_RUN` kalır.

Gate D `PASS` ile kapandı. Sıradaki Gate E henüz başlatılmadı.
