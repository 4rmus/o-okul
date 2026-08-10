# Almanak 2.0 Gate D Çekirdek Ürün Yerel Kanıtı

Tarih: 2026-08-10
Branch: `agent/almanac-gate-d-local-20260810`
Başlangıç commit'i: `5f852becb7c6f0a04ca96355e075d863a13838b7`
Kanıt düzeyi: `LOCAL_STATIC` ve `LOCAL_SYNTHETIC`
Dış durum: `EXTERNAL_NOT_RUN`

## Sonuç

Gate D'nin repo ve yerel çalışma ağacı kapsamı `LOCAL_STATIC_PASS_WITH_STAGING_PENDING` durumundadır.
Gate D'nin “full staging pass” maddesi çalıştırılmadığı için genel gate sonucu `PARTIAL` kalır. Bu belge
GitHub CI, staging, pilot, deploy veya production kanıtı değildir.

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

## Güvenlik ve veri sınırı

- Student 360, registry, teacher/school referansları ve raporlar tenant + campus + assignment sınırını
  sunucuda uygular; client-side maskeleme güvenlik kontrolü olarak kullanılmaz.
- Başka tenant nesneleri 404 ile gizlenir. Finans capability'si olmayan kullanıcı overview finans verisi
  ve payment-plan isteği alamaz.
- Yeni iki migration additive/forward-fix uyumludur: guardian izin varsayılanları default-off ve çalışan
  PENDING davet partial unique indexi. Guardian fiziksel silme yapılmamıştır.

## Yerel doğrulama

| Kontrol | Sonuç |
| --- | --- |
| API tam paket | `144 dosya / 1076 test PASS`; `2 dosya / 4 test skipped` |
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
| Tam repo zinciri | `NEXT_E2E_PORT=43148 pnpm run ci PASS` |

## Dış kanıt durumu

Aşağıdakiler çalıştırılmadı ve PASS sayılmaz:

- GitHub Actions exact-SHA CI
- staging migration deploy ve gerçek 10k Postgres query-plan/p95 ölçümü
- gerçek tenantta iki rollout anahtarının birlikte açılması ve rollback
- staging UAT-KURUM-01 ile tam onboarding
- staging iSEM optik/UI-worker ve web/PDF/XLSX parity kaydı
- gerçek kullanıcı RUM, pilot, deploy, production ve go-live

Gate D ancak bu staging maddeleri exact commit/image kanıtına bağlandığında `PASS` olabilir.
