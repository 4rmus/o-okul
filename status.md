# O-Okul Durum

Son güncelleme: 2026-08-12
İnceleme snapshotı: Gate D runtime commit'i `bb2779bc1087a150b648407385e3cee1d0122692`;
Gate D kapanışı ve Gate E WAL dilimi `agent/gate-d-onboarding-closure-20260810` izole worktree'sindedir.
Kanıt düzeyi: Gate A, Gate B ve Gate C `LOCAL_STATIC`; Gate D `GITHUB_CI`, `STAGING_DEPLOY`,
`STAGING_DB_RUNTIME`, `STAGING_API_RUNTIME`, `STAGING_LIVE_UI` ve `STAGING_PROVIDER_DELIVERY`
kanıtı taşır. Gate D `PASS`; Gate E WAL archive izin düzeltmesi `LOCAL_STATIC` ve
`LOCAL_SYNTHETIC`, exact-SHA staging WAL kanıtı `EXTERNAL_NOT_RUN`. Pilot ve production
`EXTERNAL_NOT_RUN`.

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
- **Rollback:** `web.exam-workspace-v2` kapalı veya rollout endpoint'i hatalıysa workspace API hiç
  çağrılmaz ve aynı `examId` ile legacy sınav görünümüne dönülür. Compose yalnız server-side rollout
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
  rollback hedefi, restore tatbikatı, alerting/external monitoring, RLS/MFA/UAT/pilot ve go-live evidence
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

Güncel sıralama `docs/account-management-architecture-plan.md` bölüm 6 içindedir:

1. P0: kalan 25 controller/151 `@Roles` envanterini route ailesi bazında exact capability + persona +
   scope modeline kesme; ayrı platform auth realm ve süreli/MFA'lı breakglass akışını kurma.
2. P1: StudentContact, guardian emekliliği, offboarding/import/cursor ve outbox grant revoke dilimleri.
3. Canlı SHA için CI parity; uygulamanın ürettiği davet/reset e-postası için gerçek provider/inbox ve MFA;
   rol bazlı UAT; pull edilebilir image rollback/restore; izleme, pilot ve go-live.

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
  `pnpm prod:evidence:templates:check` `PASS`. Exact-SHA staging/deploy kanıtı `EXTERNAL_NOT_RUN`.
- Gate D `PASS`; Gate E kapanmadı. Pilot ve production `EXTERNAL_NOT_RUN`.

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
