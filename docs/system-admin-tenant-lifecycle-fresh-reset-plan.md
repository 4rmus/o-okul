# Sistem Admin Kurum Yaşam Döngüsü ve Fresh Reset Planı

## İlerleme kaydı — 2026-09-07

Bu kayıt, aşağıdaki kullanıcı planını değiştirmeden mevcut checkout durumunu ayırır.

| Kapı | Güncel durum |
|---|---|
| Gate 1 | `LOCAL_STATIC` ve `LOCAL_TEST` tamam. `TRIAL → ACTIVE` migrationı kaynakta hazır, hiçbir veritabanında bu çalışma sırasında uygulanmadı. |
| Gate 2 | `LOCAL_STATIC` ve `LOCAL_TEST` tamam. Hedefe bağlı MFA, zorunlu idempotency, lifecycle sürümü, atomik askıya alma/yeniden açma ve detay ekranı tamamlandı. Canlı DB/migration ve runtime kanıtı `UNPROVEN`. |
| Gate 3 | `LOCAL_STATIC` ve `LOCAL_TEST` tamam. Katalog, PII-safe preview ve PG/S3 backup/restore adapter kodu doğrulandı. Gerçek dış ortam restore kanıtı `UNPROVEN`; legal-hold kaynağı olmadığı için reset önizlemeleri bloklu. |
| Gate 4 | `LOCAL_STATIC` ve `LOCAL_TEST` tamam. Operation/API/MFA/dar SQL rolü/worker ve aynı-operation recovery doğrulandı. Legal-hold ve write-quiescence otoriteleri yok; canlı yürütme kapalı. |
| Gate 5 | `LOCAL_STATIC` ve `LOCAL_TEST` tamam. Mevcut yönetim sekmesinde önizleme/onay/GET uzlaştırma ve sunucu kaynaklı işlem izinleri doğrulandı; canlı kapılar değiştirilmedi. |
| Gate 6 | Gate 6A–6F seçili kaynak dilimleri `LOCAL_STATIC`/`LOCAL_TEST` tamam; 6G/6H geçici PG + Redis deneyi **LOCAL_RUNTIME PASS** (116 migration, 11 PG + 5 kuyruk senaryosu). **BLOCKED**: tüm yazıcıların duraklatılması, gerçek provider ve terminal uzlaştırma kanıtı yok. Canlı reset/pilot/genel açılış yapılmadı. [Kapsam ve kanıt](system-admin-tenant-reset-gate6-preflight.md). |

Gate 1 tamamlamaları: erişim durumu/lisans ayrımı, strict profil PATCH ve değişmez slug,
owner + kampüs + lisans zorunlu onboarding, retired hard-delete, system koruması ve
SYSTEM_ADMIN rol mirasının kesilmesi. Son incelemede profil SQL'inin eşzamanlı status/lisans
verilerini ezmesi giderildi; bilinmeyen mevcut status hem store geçişinde hem dashboard
kritik işlem düğmesinde fail-closed engellendi. `system` kurumunun kendi profil yolu da açıkça reddedilir.

Gate 1 kanıtları:

- `LOCAL_STATIC`: shared/API/web typecheck; DB account-management foundation; 64 tenant tablo RLS;
  tenant-db; AuditLog partition/maintenance; OpenAPI 240 yol; web UX baseline kontrolleri geçti.
- `LOCAL_TEST`: API tam paketi 147 dosya / 1132 test geçti (3 dosya / 4 test atlandı);
  son API değişiklikleri sonrası tenant/RBAC 8 dosya / 75 test geçti. DB 3 dosya / 8 test;
  web a11y 11 tarayıcı kontrolü geçti. Sistem-kurum tarayıcı sözleşmesinde ilk çalıştırmada 8,
  oturum hazırlama düzeltmesi sonrası hedefli tekrarda 1 test geçti; 9 senaryonun tamamı doğrulandı.
- Salt-okunur güvenlik incelemesi: Gate 1 kapsamında P0/P1/P2 engel bulunmadı.
- `CI`: bu çalışma için çalıştırılmadı.
- `STAGING`, `PRODUCTION`: bu değişiklikler için `UNPROVEN`.
- `EXTERNAL_NOT_RUN`: deploy, provider, canlı DB mutation ve reset yapılmadı.

### Gate 2 kapanışı — 2026-09-06

Amaç: `SYSTEM_ADMIN` kurum erişimini, her istek için hedefe bağlı MFA ve kurum sürümüyle
atomik değiştirir. Tek yazıcı `auth_session_engineer`; auth/session, tenant, doğrudan bağlı
shared/OpenAPI/DB/web ve audit alanları kapsamındadır. Reset/worker, canlı işlem ve ilgisiz
kullanıcı dosyaları kapsam dışı kaldı.

- `TENANT_LIFECYCLE_CHANGE` kanıtı kullanıcı + aktif system session + membership sürümü +
  hedef kurum + istenen status + beklenen lifecycle sürümüne bağlıdır. Optional MFA modunda da
  gerçek TOTP veya tek kullanımlık yedek kod gerekir; MFA kapalıysa işlem açılmaz. Mevcut
  `OWNER_ADMIN_CHANGE` amacı korunur.
- İstek exact slug ve `SECURITY_REVIEW | INSTITUTION_REQUEST | OPERATIONS_REVIEW` gerekçe
  kodunu zorunlu tutar. Serbest metin, e-posta veya kişi bilgisi gerekçe kabul edilmez.
- PostgreSQL'de `PlatformIdempotencyKey`, tenant status/sürüm, tüm aktif tenant session iptalleri,
  PII-safe audit ve saklanan işlem sonucu tek transactiondadır. Herhangi bir yazım hatası rollback
  olur. Aynı key ve gövde aynı sonucu döndürür; hedef kurum da hash içindedir. Replay mevcut sürüm
  kontrolünden önce çözülür. Replay için geçerli MFA kanıtı gerekir; süresi biten kanıt aynı özgün
  kurum/status/version için yenilenebilir ve aynı idempotency key ile tekrar denenebilir.
- Yeni status mevcut status ile aynı ve sürüm güncelse yalnız işlem sonucu kaydedilir: sürüm,
  audit ve session değişmez. Gerçek geçişte sürüm bir artar; askı zamanı/gerekçe set edilir,
  yeniden açmada temizlenir. Eski access/refresh oturumları yeniden etkinleşmez.
- Session create/replace, Tenant ACTIVE satırını `FOR SHARE` ile session yazımından önce kilitler;
  lifecycle işlemiyle aynı kilit sırasını kullanır. Böylece askıya alma sırasında başlamış giriş
  transactionları session iptaliyle sıralanır.
- Detay ekranı exact slug, gerekçe seçimi ve MFA ister. Ağ sonucu belirsizse aynı body/key/proof
  korunur; pencere kapanıp aynı işlem yeniden açılabilir. Sürüm çakışmasında güncel kayıt okunur
  ve yeni onay gerekir. Listeye kritik işlem düğmesi eklenmedi.

Gate 2 kanıtları:

- `LOCAL_STATIC`: shared/API/web typecheck; bağımlılık/API ve Next build; DB foundation
  (yeni additive lifecycle migration kontrolü dahil), RLS/tenant-db; AuditLog parent/partition ve
  maintenance sözleşmesi; web token-storage; OpenAPI **240 yol** ve output contract;
  idempotency inventory **47 işlem**; web UX baseline geçti.
- `LOCAL_TEST`: çekirdek değişiklik sonrası API tam paketi **147 dosya / 1142 test** geçti
  (**3 dosya / 4 test** atlandı). Son ek PostgreSQL replay/rollback/no-op, session kilit sırası
  ve audit redaksiyon regresyonları **3 dosya / 34 test** geçti. Ön hedefli auth/tenant paketi
  **7 dosya / 98 test** geçti. DB paketi **3 dosya / 8 test** geçti.
- `LOCAL_TEST`: Playwright **23/23** geçti: **12** sistem-kurum sözleşmesi (1280×900 ve
  390×844 exact onay, klavye/focus, belirsiz retry + kapat/aç, MFA hatası, conflict/refetch dahil)
  ve **11** erişilebilirlik kontrolü.
- Salt-okunur kapanış incelemesinde yeni **P0/P1/P2** engel bulunmadı.
- `CI`: çalıştırılmadı. `STAGING` ve `PRODUCTION`: `UNPROVEN`.
- `EXTERNAL_NOT_RUN`: canlı/disposable PostgreSQL concurrency/rollback/grant deneyi, migration
  uygulaması, provider, deploy ve reset yapılmadı. SQL transaction testleri gerçek DB runtime
  kanıtı değildir. Memory adapter yalnız yerel test/örnek çalışmasıdır; dağıtık atomiklik kanıtı
  PostgreSQL transactionı ve sonraki canlı doğrulama kapısına aittir.

Gate 2 kapanışında duruldu; sonraki kapı Gate 3 idi. Gate 3 güncel durumu aşağıdadır.


### Gate 3 yerel kapanışı — 2026-09-07

Amaç: eksiksiz, sabit veri/nesne envanteri ve kaynakta silme/yazma yapmadan doğrulanabilen
tenant yedek paketi. Kapsam: DB catalog/snapshot ve kontrolleri, tenant preview/backup/S3
adapterları, shared/OpenAPI, iç operasyon aracı ve doğrudan runbook. Gate 1–2 ve ilgisiz
kullanıcı değişiklikleri korundu; reset worker, yeni dashboard, kaynak mutation yok.

- **71 tablo** ve scalar kolonları sabit katalogla kilitli. Yeni doğrudan/dolaylı/global tablo
  veya kolon CI kontrolünde ve runtime snapshot sınırında fail-closed reddedilir. Gerçek
  AuditLog partition bağlantıları ayrı tanınır.
- Owner/User/Employee projectionı doğrulanır; tüm tutarlı aktif ownerlar korunur. Geçerli
  owner+teacher desteklenir, auxiliary üyelikler temizlenecek olarak sayılır. Aktif öğrenci,
  veli veya çelişkili staff projectionı bloklanır; eksik/inaktif owner korunmuş gibi sayılmaz.
- Yeni `GET /tenants/:id/clean-reset-preview` yalnız `tenant:clean-reset` yetkili SYSTEM_ADMIN
  içindir. `system` korunur. Kategori/sayım, lifecycle sürümü, content digest ve blocker kodu
  döner; `blockerCounts` bilinen sayıları, bilinmeyenlerde `null` değerini taşır. Ham PII,
  hesap kimliği veya object key çıkmaz.
- Finans/destek/gerçek izinler ve soft-deleted kayıtlar bloklanır. Temizlenmiş iletişim izin
  geçmişi kanıtlanamadığı için StudentContact muhafazakâr bloklanır. Redis'nin yedi kuyruğu
  doğru prefix ile, failed/retry ve scheduler durumları dahil okunur; DB iş kayıtları ayrı sayılır.
- **Legal-hold kaynağı yok:** `LEGAL_HOLD_UNVERIFIED` ve `allowed=false` her zaman korunur.
  Env boolean ile aşılmaz. Yedek geri döndürülebilirliği, reset yapma izni değildir.
- Snapshot `REPEATABLE READ READ ONLY` ve ham PostgreSQL JSON metnidir; satır limiti/soft-delete
  filtresi yoktur. Hassas sayılar/zamanlar korunur. Aynı snapshot'a bağlı schema archive,
  `_prisma_migrations` geçmişi ve gerçek nesne baytları pakete alınır.
- PlatformAccount FK bağımlılıkları, asıl platform kimlik/sırları yerine sentetik ve giriş
  yapamayan projection olarak etiketlenir; ilgisiz platform hesap/sessionları alınmaz.
- Kaynak object envanteri tüm sayfaları okur; eksik/orphan/bilinmeyen key ve SHA-256 farkı
  başarısızlık nedenidir. Aynı dosyanın tekrar referansı birleştirilir. Arbitrary logo URL'si
  indirilmez. Paket öncesi ve restore sonrası kaynak tekrar karşılaştırılır.
- Ayrı/private/HTTPS off-host hedefe AES-256-GCM paket yazılır ve gerçek readback doğrulanır.
  Önceden hazırlanmış boş disposable PG/S3 hedefi zorunludur. Restore standart
  `pre-data → gerçek tablo satırları/ledger → post-data` sırasındadır; mevcut triggerlar
  devre dışı bırakılmaz. Gerçek geri yüklenmiş satır/ledger/constraint ve object GET hashleri
  eşleşmeden `VERIFIED` receipt verilmez.
- 512 MiB bellek paketi sınırı açık hatadır; veri kırpılıp PASS üretilmez. Daha büyük tenant
  streaming arşiv uygulaması ister. Çıktı yalnız hash/sayı/opaque operationId içerir.

Operasyon önkoşulları ve tüm env/kanıt sınırları:
[Gate 3 backup runbook](system-admin-tenant-reset-backup-runbook.md).

Gate 3 kanıtları:

- `LOCAL_STATIC`: DB/shared/API build ve ilgili tip kontrolleri, 71 tablo/kolon catalog,
  64 tenant tablo RLS, AuditLog partition/maintenance, tenant-db ve diff kontrolleri geçti.
  Son snapshot sınırı düzeltmesinden sonra API build/typecheck ve tenant-db yeniden geçti;
  OpenAPI **241 yol** ve output contract, idempotency inventory **47 işlem** doğrulandı.
  Worker ve web typecheck geçti; iç operasyon aracının JavaScript sözdizimi doğrulandı.
- `LOCAL_TEST`: son snapshot/nesne sahipliği, owner ve blocker sayımı değişiklikleri sonrası
  API hedefli paketi **5 dosya / 38 test**, tam DB paketi **4 dosya / 14 test** geçti.
  DB paketine dahil yeni katalog testleri **6 testtir**. Mevcut backup worker regresyonları
  **3 dosya / 17 test** geçti.
  Geniş API çalışmasında **1173 test geçti, 1 test socket hang up ile başarısız oldu,
  4 test atlandı**. İlgili ExamController dosyası kod değişikliği olmadan hedefli tekrarlandı
  ve **27/27** geçti; bu sonuç tek seferde tamamen başarılı bir tam paket çalışması değildir.
  Producer wiring testleri guardlarda sıfır target yazımı, source drift, post-data hata,
  gerçek target verisi bozulması ve migration ledger dahil başarılı fixture roundtrip'i kapsar.
- İncelemede bulunan platform sırrı kapsamı, hedef güvenliği, owner projectionı ve blocker
  sayımı sorunları giderildi. Nesne sahipliği için global kimlik metadatası yalnız ortak
  salt-okunur DB snapshot sınırında okunur; preview veya yedek paketine eklenmez.
- Bunlar injected PG/S3/process testleridir. Gerçek PostgreSQL constraint kurulumu ve gerçek
  S3/private/off-host/restore çalışması bu test sonuçlarından kanıtlanmış sayılmaz.
- `CI`: çalıştırılmadı. `STAGING`, `PRODUCTION`: `UNPROVEN`.
- `EXTERNAL_NOT_RUN`: gerçek kaynak okuması/backup/restore, provider işlemi, deploy, migration
  uygulaması ve reset yapılmadı. İç CLI'nin gerçek hedeflere yazması ayrıca action-time açık
  onay gerektirir.

Gate 3 yerel uygulama ve test kapanışında duruldu; sıradaki kapı Gate 4 idi.
Gate 3'ün dış ortam kanıtı ve authoritative legal-hold kaynağı tamamlanmadan
reset hazır/çalışır kabul edilmez.

### Gate 4 yerel kapanışı — 2026-09-07

Amaç: sabit `CLEAN_SETUP_V1` işi, backend-owned yedek provenance ve transaction/object checkpoint.
Tek yazıcı data-platform uygulama ajanıdır. Kapsam DB/schema/migration/RLS, tenant API/MFA,
shared/OpenAPI, reset worker/queue ve doğrudan test/runbook'tur. Gate 5 ekranları, Gate 6 canlı
aktivasyon, provider/DB mutation, deploy ve ilgisiz kullanıcı dosyaları kapsam dışı kaldı.

- Başlatma önce Gate 2 SUSPENDED ve fresh preview ister; ACTIVE istekleri açık önkoşul hatasıdır.
  SYSTEM_ADMIN, exact slug, sabit gerekçe, zorunlu key ve tenant/preset/version/digest MFA gerekir.
  Tek unfinished operasyon DB unique index ile korunur; aynı key/body tek operasyonu döndürür.
  202 yanıtı kaybolup operationId bilinmiyorsa özgün Idempotency-Key ile
  `GET /tenants/:id/clean-reset-jobs` current actor + tenant + key lookup yapılır; yeni POST
  gerekmez. Kimlik öğrenilince mevcut operationId GET kullanılır. İki GET de salt-okunurdur;
  dispatcher eksik enqueue'yu aynı job kimliğiyle uzlaştırır.
- Yeni tenant tablosu `TenantFreshResetOperation` FORCE RLS ve app SELECT/INSERT/UPDATE taşır;
  app DELETE yoktur. Katalog **72 tablo / 65 tenant tablo** oldu. Worker rolü fixed DELETE/column
  UPDATE ve restrictive tenant policy alır, broad DB bağlantısına fallback yapmaz. Yeni rol
  NOLOGIN'dir; migration uygulanmadı, seed/backfill yapılmadı ve gerekli değildir.
- Gerçek purge SQL'i tek transactiondadır. Bütün geçerli aktif ownerlar korunur; owner+teacher,
  auxiliary membership, kampüs scope, nullable employee ve token-family/outbox sırası kapsanır.
  Membership sürümü artırılır, mustChangePassword kullanılır, tüm eski session/reset/invite/device
  kayıtları iptal edilir/silinir. Existing lisans triggerları ve append-only audit korunur.
- Gate 3 helperları mevcut shared DB/server paketine taşındı; API import yolları re-export ile
  korunur. Tam raw backup, dar current-operation digest projection, JSONB sırasına dayanıklı HMAC,
  immutable package binding, post-data sonrası durable HMAC attestation ve gerçek restore-target
  re-verification ile lost-receipt recovery var. Attestation öncesi crash manuel BLOCKED kalır;
  yalnız satır/sayım eşliğiyle eksik constraint/trigger kurulumu başarılı sayılmaz.
- DB commit ile OBJECTS checkpoint birlikte kalır; object hatasında tenant askıda ve aynı iş kaldığı
  aşamadadır. Manifest dışı key kullanılmaz; mevcut bayt/hash/ETag farklıysa silme yapılmaz. Yokluk
  ve owner/temizlik postcondition kontrolünden sonra COMPLETED + ACTIVE aynı commit'tedir.
- **Bağımsız iki operasyon engeli:** authoritative legal-hold ve tenant write-quiescence/drain
  kaynağı yoktur. Request ve worker/purge default-deny çalışır. Env/caller boolean bunları aşamaz.
  Session revoke ve queue snapshot eski HTTP/upload yazımlarını tek başına durdurmaz; bu fence
  entegrasyonu ve gerçek runtime kanıtı olmadan reset production-ready kabul edilmez.

Detay ve operasyon önkoşulları: [reset runbook](system-admin-tenant-reset-backup-runbook.md).

Gate 4 kanıtları:

- `LOCAL_STATIC`: DB/shared/API build ve ilgili tip kontrolleri, worker/web typecheck,
  72 tablo/kolon katalog kontrolü, 65 tenant tablo RLS, restrictive worker rolü ve tek unfinished
  operasyon sözleşmesi, AuditLog partition/maintenance ve tenant-db geçti. OpenAPI **243 yol**
  ve output contract, idempotency inventory **48 işlem**, `git diff --check` başarılı.
- `LOCAL_TEST`: geniş API paketi **149 dosya / 1165 test** geçti; **3 dosya / 4 test** atlandı.
  Son salt-okunur key lookup ve sözleşme değişiklikleri sonrasında hedefli API/MFA paketi
  **4 dosya / 76 test** geçti; gerçek HTTP lookup/header senaryoları bu pakete dahildir.
- `LOCAL_TEST`: son kaynakla tam DB paketi **9 dosya / 57 test** geçti. Kapsam; owner/NULL
  personel koruması, UTC digest, token sırası, rollback/checkpoint, bağımsız legal-hold ve
  write-quiescence engelleri, JSONB sırasından bağımsız makbuz ve eksik/sahte attestation reddidir.
  Geniş worker paketi **35 dosya / 218 test**, son worker bağlantı kontrolü **2/2** geçti.
- Salt-okunur akış ve DB kapanış incelemelerinde açık P0/P1/P2 bulgu kalmadı. Restore-tamamlama
  attestation'ı yazılmadan çökme, otomatik başarıya çevrilmez; belgelenen manuel BLOCKED sınırıdır.
- Bunlar injected PG/S3/process `LOCAL_TEST` ve kaynak `LOCAL_STATIC` kanıtlarıdır. Gerçek
  PostgreSQL yetki/RLS/FK/rollback, eşzamanlılık ve bağlantı kaybı ile gerçek S3 yürütmesini kanıtlamaz.
- `CI`: çalıştırılmadı. `STAGING`, `PRODUCTION`: `UNPROVEN`.
- `EXTERNAL_NOT_RUN`: deploy, migration uygulaması, gerçek backup/restore, reset veya provider mutation.

Gate 4 yerel kapanışında duruldu; sıradaki kapı Gate 5 idi. Legal-hold ve write-quiescence kaynakları
ile gerçek runtime kanıtı olmadan canlı reset hazır kabul edilmez.


### Gate 5 yerel kapanışı — 2026-09-07

Amaç: mevcut kurum detayının “Kurum yönetimi” sekmesinde güvenli sabit temizleme akışı.
Tek yazıcı frontend uygulama ajanıdır. Sahiplik: detay/private reset paneli, system API client,
dar tek-deneme auth helperı, ilgili shared/OpenAPI/salt-okunur tenant metadata ve testler.
Gate 1–4 ve ilgisiz kullanıcı dosyaları korunur; reset motoru, worker, migration, provider ve canlı
veri işlemleri kapsam dışıdır.

- Tenant detay GET'i object/queue envanterinden bağımsız ve sınırlı bir okuma ile server-owned
  `management.allowedActions` ve son/devam eden operasyonu verir. FAILED/BLOCKED dahil her
  tamamlanmamış iş yeniden açma ve yeni temizleme aksiyonlarını gizler; okuma hatası kapalıdır.
- Önizleme yalnız Türkçe kategori/sayım ve korunan owner sayısını gösterir. Eksik/bilinmeyen
  kategori, blocker, sürüm, digest, sayım, durum veya metadata başlatmayı kapatır. Üretim
  preview `allowed:false`, legal-hold ve write-quiescence engelleri değiştirilmedi.
- Exact kurum kodu, sabit gerekçe ve tenant/preset/version/digest bağlı tek-deneme MFA gerekir.
  İptal, sekmeden çıkış, tenant/actor/session/membership değişimi geç gelen MFA sonucunun
  mutation göndermesini engeller. Aynı session token yenilenmesi desteklenir; başka aktör/session
  yenilenmesinde kritik istek gönderilmez.
- Onaylanan istek tek POST gönderir. Yalnız actor+tenant-scoped rastgele idempotency key
  session storage içinde tutulur; kod/proof/token/body/PII saklanmaz. Belirsiz, 5xx veya bozuk
  başarılı cevapta aynı key ile GET lookup, sonra op-id GET kullanılır; GET 404 yeni POST açmaz.
  Kesin ve bilinen ön-kabul 4xx reddi güncel okuma ve yeni açık kullanıcı onayı ister.
- QUEUED/RUNNING/BLOCKED/FAILED/COMPLETED ve aşamalar sade Türkçe gösterilir. Geçmiş tamamlanan
  iş yeni isteğin kayıp cevabını gölgelemez. COMPLETED tenant/önizleme/listeyi yeniler ve kurum
  sahiplerinin sonraki girişte zorunlu parola değişimini açıklar.

Gate 5 kanıtları:

- `LOCAL_TEST`: son kaynakla Playwright **45/45** geçti: **34** sistem-kurum sözleşmesi
  (22 Gate 5 kontrolü dahil) ve **11** erişilebilirlik kontrolü. 1280×900 ve 390×844,
  axe/focus, MFA iptali, farklı tenant/aktör, aynı oturum token yenilemesi, temizlenmiş auth
  durumunda eski tokenın kullanılmaması, GET 404, kesin ret ve kayıp/bozuk POST cevabı kapsandı.
- `LOCAL_TEST`: geniş API çalışmasında **1171 test geçti, 1 test socket hang up ile başarısız
  oldu, 4 test atlandı**. İlgili support-ticket dosyası ve değişen tenant service/controller
  birlikte hedefli tekrarlandı; **3 dosya / 60 test** geçti. Tek seferde tamamen başarılı
  tam API paketi iddiası yoktur. İlk hedefli tenant paketi **34/34** geçmişti.
- `LOCAL_STATIC`: shared/DB/API build, API/web typecheck, Next build, OpenAPI **243 yol** ve
  negatif çıktı sözleşmesi, tenant-db, web UX baseline, token-storage ve diff kontrolleri geçti.
  Salt-okunur metadata sorgusu mevcut transaction callback biçimiyle doğrulandı; kontrol
  gevşetilmedi. Contract testlerinden yalnız geçici screenshot yazımları kaldırıldı.
- `LOCAL_TEST`: sentetik yanıtlarla üretilen masaüstü/mobil önizleme ve tamamlanma görselleri
  `artifacts/gate5` altında incelendi. Bunlar gerçek kurum reseti veya canlı veri kanıtı değildir.
- Salt-okunur güvenlik incelemesinde engelleyici bulgu kalmadı. İletişim/MFA verisi depolanmaz;
  yalnız aktör ve tenant kapsamlı opaque işlem anahtarı tutulur. Auth tamamen temizlendiğinde
  kritik tek-deneme istemcisi eski tokena dönmez.
- `CI`: çalıştırılmadı. `STAGING`, `PRODUCTION`: `UNPROVEN`.
- `EXTERNAL_NOT_RUN`: migration, deploy, gerçek backup/restore/reset ve provider mutation.

Gate 5 yerel kapanışında duruldu. Gate 6'ya otomatik geçilmez; legal-hold/write-quiescence ve gerçek runtime kanıtı olmadan
canlı temizleme hazır kabul edilmez.

### Gate 6 ön hazırlığı — 2026-09-07

Kullanıcının sonraki kapı isteğiyle release ön hazırlığı yapıldı; gerçek Gate 6 **BLOCKED**.
[Ön hazırlık paketi](system-admin-tenant-reset-gate6-preflight.md) sahiplik, mevcut komutlar,
özel yapılandırma adları, disposable/staging/pilot kabulü ve en küçük sonraki kaynak dilimini tutar.

- `LOCAL_STATIC`: iki reset guardı koşulsuz hata, snapshot blockerları ve preview `allowed:false`
  halen kaynakta sabittir. Gerçek yetkili karar ve yazma duraklatma kaynağı bağlanmadan env/onay
  reseti açamaz. Worker image PostgreSQL istemcileri, compose reset aktarımı, tek pilot sınırı
  ve operasyona bağlı hedef hazırlama/sürdürme yolu da eksiktir. Ops statik ve diff kontrolleri geçti.
- `LOCAL_TEST`: notification gateway 35 test geçti. Tam yerel CI, yeni 65. tenant tablosunun
  RLS example dosyalarında eksik olması nedeniyle durdu. İki bağlı şablonun tablo/sayıları ve
  bağlı statik beklentiler düzeltildi; `pnpm prod:evidence:templates:check` **PASS**.
  Ölçüm özeti gerçek yerel toplama komutuyla yenilendi (3 görev × 5 örnek).
  Eski birleşik rol fixtureları düzeltildi: hedefli 9/9, tam UI sözleşmesi 172/172 ve
  route family 89/89 geçti. Görsel paket 28 PASS / 3 FAIL ile durdu; kurum detayı fixtureı
  düzeltildikten sonra hedefli 1/1 geçti. Yan menü ve rapor golden görsellerindeki iki fark
  açık bırakıldı; referanslar/eşikler değiştirilmedi. **Tam yerel CI PASS değil.**
  Kalan lint/typecheck/test/build/OpenAPI/idempotency zinciri ayrıca **PASS**: API 1172 PASS / 4 SKIP,
  DB 57/57, worker 220/220, OpenAPI 243 path, idempotency 48 operation.
- `CI`: HEAD `e4bde6f18991ddf2c8db5c0713d032720abf288a` için başarılı PR run `33801131409`
  var; Gate 1–5'in uncommitted dosyalarını kapsamaz. GitHub main
  `e2f06372b383a0545e347334686c8ee0d4fc259d` olarak salt-okunur doğrulandı.
- `STAGING`, `PRODUCTION`: fresh reset `UNPROVEN`; gerçek pilot saati başlamadı.
- `EXTERNAL_NOT_RUN`: migration/rol/secret/config değişikliği, deploy, gerçek backup/restore/reset
  ve provider mutasyonu. Genel açılım yapılmadı.

### Gate 6A — kurum talebi yetkisi (2026-09-07)

Kullanıcı kararı: kurum admini kendi kurumunun yenilenmesi için talep göndermişse,
sistem admin reseti başlatabilmelidir. Yetki kaynağı sorusu çözüldü; yeni dış hukuki
sağlayıcı beklenmez. Sabit CLEAN_SETUP_V1 talebi Tenant üzerinde kalıcı tutulur,
claim operasyonuna tekil bağlanır; eksik/iptal/eski/başka operasyonda kullanılmış talep
reddedilir. STAFF TENANT_ADMIN/TENANT_OWNER güncel DB oturum/üyelik/User doğrulamasıyla
kendi kurumuna talep gönderebilir. Sistem admin kurum adına talep üretemez.

Lisans dönemleri ekranında açık talep onayı ve geri çekme; sistem ekranında kaynak talep
numarası/tarihi gösterilir. Request claim aynı transaction'da, yedek/digest/worker/purge/final
kontrollerine bağlıdır; worker talep üretemez. Finans/destek/consent saklama kuralları korunur.
Tam DB 65/65, API hedefli 47/47, fresh build Playwright 38/38; typecheck, RLS65,
katalog, tenant-db, UX baseline ve OpenAPI245 geçti (`LOCAL_STATIC`/`LOCAL_TEST`).
Erişilebilirlik11/11 ve canonical measurement collect/check (3 görev × 5 örnek,
`LOCAL_SYNTHETIC`) geçti; ölçüm özeti gerçek yerel toplamayla yenilendi.
Gerçek migration/DB yarış/trigger/PG-S3 reset/deploy/pilot `EXTERNAL_NOT_RUN`;
CI/STAGING/PRODUCTION bu dilim için `UNPROVEN`. Ayrıntılar [Gate 6A kaydında](system-admin-tenant-reset-gate6-preflight.md).

### Gate 6B — ortak DB kilidi (2026-09-07)

Bağlantılı package ve API ortak tenant DB transactionları kurum bazlı paylaşımlı try-lock,
reset runner aynı anahtarda session exclusive try-lock kullanır. Çakışmada callback/reset
ilerlemez; normal rollback hatasında bağlantı atılır, runner her çıkışta kendi kilitlerini
çözüp bağlantısını kapatır. Reset durum sorguları gerçek `BEGIN READ ONLY` ile okunabilir.
API tüketici 125/125, tam API 1187 PASS / 4 SKIP, tam DB 76/76 ve worker 220/220 PASS
(`LOCAL_TEST`, injected lock/SQL; gerçek PG yarış kanıtı değil). DB build/typecheck,
API/worker typecheck, tenant-db, mevcut measurement baseline ve diff kontrolleri PASS. Ayrıntılar ve somut kalan yollar [Gate 6B kaydında](system-admin-tenant-reset-gate6-preflight.md).

Global bypass/null tenant ve bağlantısız legacy adapterlar, auth/audit özel transactionları,
secret-delivery-outbox doğrudan SQL'i, HTTP upload/S3/provider ve queue iş kabulü bu kilidin
dışındadır. Eski isteklerin reset sonrası yeniden yazmasını önleyen kalıcı sürüm fence'i
henüz yoktur. `WRITE_QUIESCENCE_UNVERIFIED` kaldırılmadı; canlı reset açılmadı.

### Gate 6C — HTTP/S3/queue kabulü ve kalıcı belirsizlik (2026-09-07)

TenantMutationActivity kaydı, ACTIVE/başlangıç sürümü ve API oturum/User/üyelik sürümü
aynı transaction'da doğrulanmadan callback başlamamasını sağlar. HTTP subscriber
ayrılsa da controller gerçekten bitene dek kayıt kalır. Üç S3 sink'i, BullMQ/PDF üreticisi
ve normal/PDF worker girişleri bağlandı; başka tenant key'i, eski Redis payload'ı ve
legacy/stale worker job'ı reddedilir. Başarı kaydı siler; reject veya kayıp süreç
RUNNING/UNCERTAIN bırakır. TTL/otomatik belirsizlik temizliği yoktur.

Yeni tablo RLS/katalog ve örnek evidence sayımlarına eklendi (66 tenant, 73 toplam tablo).
Tam API 1195 PASS / 4 SKIP, DB 87/87, worker 222/222, Playwright 38/38 PASS;
typecheck/build, OpenAPI 245, template/tenant-db ve canonical measurement (3×5,
LOCAL_SYNTHETIC) geçti. İlk API çalışmasındaki tek admin-login 403, kaynak değiştirilmeden
hedefli 22/22 ve tam tekrar 1195 PASS / 4 SKIP ile geçti; ayrıntı [Gate 6C kaydındadır](system-admin-tenant-reset-gate6-preflight.md).

Sonraki Gate 6D: pre-auth/system-global mutasyonları ve secret-delivery-outbox için
başlangıç tenant/sürüm bağlama; UNCERTAIN ve resolved-failed provider sonuçlarını gerçek
sonuçlarla uzlaştırma; gerçek PG/S3/queue hata deneyi. Normal authenticated tenant HTTP
altındaki özel DB çağrıları lifetime kaydıyla kapsanır; bağımsız/global yollar henüz
kapsanmaz. Her provider başarısızlığı reject değildir; worker promise başarısı uzaktaki
asenkron işlemin tamamlandığını tek başına kanıtlamaz. Quiescence guard bu yüzden kapalıdır.

Gate 6C yerel tamamlandı. Yazma duraklatma halen doğrulanamadığı
ve runtime araç/bağlantıları eksik olduğu için Gate 6 **BLOCKED**; talep tek başına canlı reseti açmaz.


---

Aşağıdaki metin özgün planın başlangıç durumudur; güncel durum yukarıdadır.


## 1. Bugünkü durum ve kilitlenen kapsam

Mevcut kaynak koduna göre:

| İşlem | SYSTEM_ADMIN | Kurum sahibi/yöneticisi |
|---|---|---|
| Kurum listeleme/oluşturma | Var | Yok |
| Kurumu askıya alma | API’de var, ancak güvenli/atomik değil | Yok |
| Kurumu kalıcı silme | Yok; endpoint `410 TENANT_HARD_DELETE_RETIRED` döner | Yok |
| Kurumun tüm verisini temizleme | Yok | Yok |
| Fresh reset | Yok | Yok |
| Tekil kayıt silme/KVKK temizliği | Platform panelinde yok | Yetkisi ölçüsünde bazı kayıtlar için var |

Kalıcı silme hem API’de kapalıdır hem normal DB rolünden alınmıştır: [tenant.controller.ts](/Users/arair/works/o-okul/apps/api/src/tenant/tenant.controller.ts:67), [migration.sql](/Users/arair/works/o-okul/packages/db/prisma/migrations/20260802000000_revoke_tenant_delete_from_app/migration.sql:1).

Mevcut tutarsızlıklar:

- `SYSTEM_ADMIN`, `system` tenantını ve serbest metin durum değerlerini güncelleyebiliyor.
- Dashboard `slug` gönderiyor ancak API bunu reddediyor; `TRIAL` hem plan hem erişim durumu gibi kullanılıyor.
- Owner/lisans olmadan kurum açabilen eski API yolları hâlâ mevcut.
- Askıya alma, session iptali ve audit aynı transaction içinde değil.
- Mevcut BACKUP işi gerçek yedek üretmiyor; yalnız hedefi doğruluyor. Kurum export’u da eksik ve tablo başına 5.000 satırla sınırlı: [backup-restore-job.ts](/Users/arair/works/o-okul/apps/worker/src/jobs/backup-restore-job.ts:108), [tenant-data-export-store.ts](/Users/arair/works/o-okul/apps/api/src/operations/tenant-data-export-store.ts:23).

Kilitlenen ürün kararları:

- İlk sürüm: güvenli askıya alma/yeniden açma + `CLEAN_SETUP_V1` fresh reset.
- Yalnız `SYSTEM_ADMIN` çalıştırabilir; kurum tarafında talep veya self-service yüzeyi olmayacak.
- Tenant ID, slug, kurum profili, lisans geçmişi ve tüm aktif `TENANT_OWNER` hesapları korunacak.
- Owner dışındaki hesaplar, kişiler, akademik/operasyonel veriler ve bağlı dosyalar sabit preset ile temizlenecek.
- Finans, destek, gerçek izin kaydı veya legal hold varsa reset bloklanacak.
- Tüm owner oturumları iptal edilecek ve sonraki girişte parola değiştirmeleri zorunlu olacak.
- Reset başarıyla doğrulanınca tenant otomatik `ACTIVE` olacak; hata halinde `SUSPENDED` kalacak.
- Tenant bazlı, dosyaları da içeren geri yüklenebilir paket zorunlu olacak.
- Staging kanıtı → tek production pilotu → genel kullanım sırası izlenecek.
- Kalıcı tenant imhası ve kategori seçmeli reset kapsam dışı kalacak.

Fresh reset, yedek saklandığı için hukuki anlamda kalıcı imha değildir. Saklama süreleri veri sınıfına göre belirlenmeli; silme/yok etme işlemleri kayıt altına alınmalı ve bu işlem kayıtları en az üç yıl korunmalıdır. [KVKK imha yönetmeliği](https://www.kvkk.gov.tr/Icerik/5441/KISISEL-VERILERIN-SILINMESI-YOK-EDILMESI-VEYA-ANONIM-HALE-GETIRILMESI-HAKKINDA-YONETMELIK)

## 2. API, yetki ve veri sözleşmesi

### Control-plane sözleşmesi

- Ortak tip `TenantAccessStatus = "ACTIVE" | "SUSPENDED"` olacak; `TRIAL` yalnız lisans planıdır.
- `Tenant` kaydına `lifecycleVersion`, `suspendedAt` ve PII içermeyen `suspendedReason` eklenecek.
- Mevcut `TRIAL` durumları migration sırasında `ACTIVE` yapılacak; diğer bilinmeyen değerler migrationı durduracak.
- `system` tenantı tüm mutation yollarında değiştirilemez olacak.
- `PATCH /tenants/:id` yalnız kurum profilini değiştirecek; `slug`, status ve lisans alanlarını kabul etmeyecek.
- `DELETE /tenants/:id` mevcut `410` davranışını koruyacak; kullanılmayan service/store hard-delete kodu kaldırılacak.
- `POST /tenants` yalnız owner + kampüs + lisans içeren mevcut atomik/idempotent onboarding şeklini kabul edecek.

Yeni uçlar:

- `PATCH /tenants/:id/status`
  - Body: `status`, `expectedLifecycleVersion`, `reason`, `confirmationText`.
  - Header: `Idempotency-Key`, target-bound `X-Step-Up-Token`.
  - Capability: `tenant:lifecycle`.
  - Status değişimi, tüm tenant sessionlarının iptali ve audit aynı DB transactionında gerçekleşecek.

- `GET /tenants/:id/clean-reset-preview`
  - Yalnız kategori ve sayım döndürecek; owner adı/e-posta/TC veya dosya anahtarı göstermeyecek.
  - Korunan/silinecek sayımlar, blocker kodları, lifecycle sürümü ve `preflightDigest` içerecek.

- `POST /tenants/:id/clean-reset-jobs`
  - Body: `preset: "CLEAN_SETUP_V1"`, `expectedLifecycleVersion`, `preflightDigest`, `reason`, exact slug onayı.
  - Header: zorunlu `Idempotency-Key` ve tenant/action/version bağlı MFA kanıtı.
  - Başarı: `202` ve tek operasyon kimliği.

- `GET /tenants/:id/clean-reset-jobs/:operationId`
  - `QUEUED | RUNNING | BLOCKED | FAILED | COMPLETED` durumu, aşama ve PII-safe sonuç sayımları döndürecek.
  - Belirsiz ağ sonucunda yeni POST yapılmayacak; aynı operasyon bu uçtan uzlaştırılacak.

`SYSTEM_ADMIN` artık role-rank yoluyla tenant rollerini miras almayacak. Açık capability’ler `tenant:manage`, `tenant:lifecycle` ve `tenant:clean-reset` olacak. MFA amaçlarına `TENANT_LIFECYCLE_CHANGE` ve `TENANT_CLEAN_RESET` eklenecek.

### `CLEAN_SETUP_V1` veri matrisi

| Karar | Veri |
|---|---|
| Koru | Tenant kimliği/profili/slug, `LicenseTerm`, `LicenseUsage`, aktif owner User/Membership/Employee kayıtları, AuditLog, backup/reset makbuzları |
| Normalize et | Owner kampüs scope ve ek teacher/student personalarını kaldır; membership sürümünü artır; tüm session/token/device kayıtlarını iptal et; `mustChangePassword=true` yap |
| Temizle | Owner dışı hesaplar ve profiller; kampüs, dönem, sınıf, ders; öğrenci/öğretmen/veli/contact; sınav/import/rapor; yoklama/program/ödev/duyuru/SMS; tenant idempotency kayıtları ve bağlı nesneler |
| Blokla | Herhangi bir finans işlemi, destek kaydı/eki, gerçek consent kaydı, aktif veya doğrulanmamış legal hold, sıfır aktif owner, projection uyuşmazlığı, çalışan queue işi, bilinmeyen tenant tablosu veya object key |

Tenant bazlı yedek paketi; bütün hedef DB satırlarını, bağlı object-storage içeriklerini, tablo/nesne sayımlarını ve SHA-256 manifestini içerecek. Paket private off-host hedefte tutulacak ve resetten önce disposable PostgreSQL + S3 ortamına geri yüklenerek sayım/hash eşliği kanıtlanacak. Yeni yedek kütüphanesi eklenmeyecek; mevcut PostgreSQL, AWS SDK ve BullMQ desenleri genişletilecek.

DB temizliği tek transaction olacak. Object temizliği yalnız DB commit’inden sonra, yedek manifestindeki exact key listesiyle idempotent yürütülecek. Object doğrulaması başarısızsa tenant açılmayacak ve aynı operasyon kaldığı aşamadan devam edecek.

## 3. Geliştirme loop’u ve kapılar

Her kapıda aynı loop uygulanacak:

1. Mevcut sözleşmeyi ve dirty worktree’yi doğrula.
2. Hatalı/istenen davranışı hedefli testle kilitle.
3. Tek yazıcıyla en küçük değişikliği yap.
4. Hedefli testler ve güvenlik incelemesini çalıştır.
5. `LOCAL_STATIC`, `LOCAL_TEST`, `CI`, `STAGING`, `PRODUCTION` kanıtlarını ayrı kaydet.
6. Kapı bitince dur; sonraki kapıya otomatik geçme.

### Gate 1 — Mevcut control-plane sözleşmesini düzelt

- Status/plan ayrımı, `system` koruması, slug değişmezliği ve unknown-status fail-closed davranışı.
- `TRIAL → ACTIVE` kontrollü migrationı ve DB status CHECK.
- Dashboard PATCH payload/API/OpenAPI uyumu.
- Retired service/store hard-delete kodunun kaldırılması.
- Canonical onboarding dışındaki ownerless create yollarının kapatılması.
- `SYSTEM_ADMIN` role-rank mirasının kesilmesi.

Tek yazıcı: `backend_api_engineer`; güvenlik ve DB incelemesi salt okunur.

Bu en küçük güvenli ilk PR’dır; reset veya worker içermez.

### Gate 2 — Atomik askıya alma ve yeniden açma

- Target-bound MFA, idempotency ve lifecycle-version kontrolü.
- Tenant status değişimi + tüm sessionların revoke edilmesi + PII-safe audit aynı transactionda.
- AuditLog parent/partition tablolarında `app` rolünden `UPDATE/DELETE` alınması.
- Dashboard’da yalnız detay sayfasında “Askıya al / yeniden aç”; liste satırında kritik buton yok.
- Eski access/refresh tokenlar yeniden açmadan sonra da geçersiz kalmalı.

Tek yazıcı: `auth_session_engineer`; `tenant_security_reviewer` kapanış incelemesi.

### Gate 3 — Reset envanteri ve gerçek geri dönüş paketi

- Her tenant tablosunu `PRESERVE | DELETE | BLOCK` olarak sınıflandıran tek sabit katalog.
- Yeni tenant tablosu sınıflandırılmamışsa CI fail-closed.
- PII-safe preview ve bütün blocker sayımları.
- Tenant bazlı DB+object paket üretimi, özel hedefe yazma ve izole restore doğrulaması.
- Bu kapıda hiçbir reset/silme yapılmaz.

Tek yazıcı: `infra_dr_engineer`; privacy ve data-platform incelemesi salt okunur.

### Gate 4 — Clean-reset worker

- `TenantFreshResetOperation` tablosu, tek aktif operasyon unique kuralı ve deterministik BullMQ işi.
- Ayrı, dar yetkili worker DB rolü; `Tenant` ve AuditLog silme yetkisi yok.
- Sabit preset temizliği, owner koruma/normalizasyonu, token/session iptali ve object reconciliation.
- Başarıda tenant otomatik `ACTIVE`; owner eski parolasıyla yalnız zorunlu parola yenileme ekranına ulaşabilir.
- DB hatasında sıfır kısmi değişiklik; object hatasında tenant `SUSPENDED` ve aynı operasyon retry edilir.

Tek yazıcı: `data_platform_engineer` veya `backend_api_engineer`; aynı kapıda ikinci yazıcı kullanılmaz.

### Gate 5 — Sistem admin dashboard reset akışı

Mevcut kurum detay sayfasındaki “Kurum yönetimi” sekmesi kullanılacak:

- Erişim durumu ve `allowedActions`.
- Reset önizlemesi: yalnız kategori/sayım, korunan owner sayısı ve blockerlar.
- Gerekçe, exact slug, target-bound MFA ve sabit idempotency key.
- `RUNNING/BLOCKED/FAILED/COMPLETED` görünümü ve GET ile uzlaştırma.
- Blocker veya bilinmeyen veri varsa başlat butonu hiç gösterilmez.
- Kurum tarafındaki ekranlara reset veya kapatma eklenmez.

Yeni wizard, route ailesi veya tasarım altyapısı eklenmeyecek.

Tek yazıcı: `frontend_ux_engineer`.

### Gate 6 — Staging, pilot ve genel açılış

- Disposable ortam: iki tenant izolasyonu, çoklu owner, owner-teacher personası, DB rollback ve object retry.
- Exact-SHA staging: sentetik tenant backup → isolated restore → reset → owner zorunlu parola değişimi → setup readiness.
- Ayrı açık onayla tek production pilotu; sıfır blocker, kurum/veri sahibi işlem referansı ve gerçek backup makbuzu zorunlu.
- En az 14 günlük pilotta restore, audit, owner erişimi ve orphan/object sayımları izlenir.
- Pilot kapandıktan sonra mevcut rollout mekanizmasındaki geçici reset anahtarı kaldırılarak genel SYSTEM_ADMIN kullanımına açılır.
- Her staging/production veri mutasyonu action-time açık kullanıcı onayı ister.

Tek yazıcı/release sahibi: `ops_release_engineer`.

Kalıcı tenant purge, offboarding sonrası hukuki imha, çift-admin onayı, slug tombstone ve kurum self-service ancak gerçek ihtiyaç oluşursa ayrı karar ve program olacaktır.

## 4. Test ve kabul planı

Zorunlu senaryolar:

- Tenant rollerinin bütün lifecycle/reset uçlarından `403` alması.
- `system` tenantının ve yanlış/legacy status değerlerinin değişmemesi.
- Askıya alma audit veya session revoke hatasında tamamen rollback olması.
- Aynı idempotency key’in tek status değişimi veya tek reset operasyonu üretmesi.
- MFA kanıtının başka tenant/action/version için kullanılamaması.
- Finance/support/consent/legal-hold ve soft-deleted kayıtların reseti bloklaması.
- İki tenant testinde hedef dışındaki bütün satır/nesne hashlerinin değişmemesi.
- Tüm aktif ownerların korunması; ek personaların temizlenmesi; owner dışı hesapların kalmaması.
- Eski access/refresh/reset/invitation tokenlarının geçersiz olması.
- DB commit başarısızsa object silme çağrısının yapılmaması.
- Object temizliği tamamlanmadan tenantın `ACTIVE` olmaması.
- Başarı sonrası owner girişinin doğrudan zorunlu parola yenilemeye gitmesi.
- Preview, audit, log ve evidence içinde ham PII/object key bulunmaması.
- 1280×900 ve 390×844 dashboard, klavye/focus/loading/error kontrolleri.

Ana doğrulamalar:

```sh
pnpm --filter @o-okul/shared-types typecheck
pnpm --filter @o-okul/api typecheck
pnpm --filter @o-okul/api test
pnpm --filter @o-okul/db test
pnpm --filter @o-okul/worker test
pnpm db:rls:check
pnpm tenant-db:check
pnpm audit-log-partition:check
pnpm openapi:generate
pnpm --filter @o-okul/web typecheck
pnpm web:a11y:check
pnpm web:ux-baseline:check
pnpm run ci
```

Varsayımlar:

- Fresh reset aktif çalışma alanını temizler; KVKK anlamında kalıcı imha iddiası taşımaz.
- Reset yetkisi, kurum admininin kendi kurumu için oluşturduğu kalıcı CLEAN_SETUP_V1 yenileme talebidir. Talep kimliği operasyon ve audit ile bağlanır; mevcut finans/destek/consent saklama engelleri bağımsızdır.
- Lisans düzenleme UI’si, kalıcı kurum silme ve kategori seçmeli reset bu programda yapılmaz.
- Mevcut checkout için kaynak incelemesi ve yerel test kanıtı vardır; yeni reset davranışı bakımından staging ve production şu an `UNPROVEN` durumundadır.


### Gate 6D — eski credential kanıtları ve belirsiz gönderim tekrarları (2026-09-07)

Worker referansları tenant/epoch/kind/queue-job kimliğine tekil bağlandı; aynı belirsiz
operasyon sağlayıcıyı tekrar çağıramaz. SMS/notification non-sent/eksik/mismatched receipt
ve kalıcı rapor/idempotency ACK kaybı başarı sayılmaz. Outbox provenance üretim anından
bağlı ve değiştirilemez; legacy epoch doldurulmaz, denenmiş satır stale-reclaim veya expiry
ile güvenli duruma taşınmaz. Tanı endpoint'i yalnız metadata ve bounded cursor sayfaları
sunar; kanıtsız clear/retry yoktur.

Login/refresh son session yazımı ve rehash özgün üyelik sürümüne bağlıdır; password-reset
ve invitation kabulü başlangıç kaynak/epoch snapshotıyla tüm gerçek mutasyon/audit ömrünü
izler. Yeni sessiondan sonraki audit ayrıca o sessionı doğrular. Çok-kurum selection
challenge'ı üyelik+kurum sürümünü, login MFA challenge'ı özgün üyelik sürümünü imzalar;
eski/legacy parola kanıtları yeni User'a yükseltilemez. SYS profile/status/license yazımı
validation/MFA sonrası ayrı ADMIN admission kullanır; platform/system auth ayrımı korunur.

Son tam API **1206 PASS / 4 SKIP**, worker **230/230**, DB **96/96**; selection/MFA
hedefli **55/55**, provider/idempotency hedefli **22/22** PASS. Typecheck/build,
RLS66/katalog73, OpenAPI246, idempotency48, web token-storage, evidence templates ve
canonical measurement3×5 LOCAL_SYNTHETIC geçti. İlk partial-provider-success beklentili
iki API testinin düzeltilmesi ve son başarılı tekrar [Gate 6D kaydındadır](system-admin-tenant-reset-gate6-preflight.md).

Outbox evidence v2, farklı iki source kaydının tek-denemeli belirsizlik ve receipt'li
başarısını ayrı gözler; belirsiz kaydı temizlemez. Yeni minimal Tenant kolon okuma grantı,
checker ve runbook beraber güncellendi. Gerçek smoke çalıştırılmadı. Admin MFA, rate-limit
ve security-audit dış kanıt checkerları hedef verilmediği için exit1 döndü; bunlar
UNPROVEN/EXTERNAL_NOT_RUN olarak bırakıldı.

Yerel Gate 6D tamamdır; bütün Gate 6 kapanmadı. Bağımsız/global MFA audit/sayaç/cleanup
yaşam süresi ve gerçek PG/provider terminal uzlaştırması hâlâ gerekir. Notification
Gateway /send replayi yan etkisiz lookup değildir; /messages/latest terminal proof
sunmaz. `WRITE_QUIESCENCE_UNVERIFIED` ve canlı reset kapısı açıkça kapalı kalır.

### Gate 6E — bağımsız auth yazılarında özgün kaynak sınırı (2026-09-07)

MFA secret/counter/recovery ve parola yazımları özgün kurum/üyelik sürümüyle CAS yapar;
MFA Redis sayaçları da aynı nesle ayrılır. Oturum/family iptalleri eski ID veya sürüm üst
sınırına bağlıdır; rol/parola değişiminden sonraki yeni oturumlar eski istekle kapatılamaz.
Student activation ilk kurum epoch'unu lisans sorgusundan önce yakalar; DB key/rowlock
sırası ve aynı epoch kontrolü bu kaynağı korur. Audit yalnız append-only geçmiş politikası
istisnasıyla bilinen kurumun ortak kilidine katılır; geçmiş olay yeni nesle etiketlenmez.

Başarılı parola değişiminden sonra eski refresh artık denenmez: eski nesil oturumlar
kapatılır, yalnız aynı actor'ın yerel auth/cache'i temizlenir ve yeniden giriş gösterilir.
Başarısız değişim auth'u korur; geciken eski cevap yeni login'i silemez veya logout yapamaz.

Son tam API **1216 PASS / 4 SKIP**, hedefli kaynak regresyonları **72/72**, son bağlı
API tekrarı **42/42**, Next auth/a11y **13/13**, a11y **11/11**, auth-contract **17/17**
PASS. API/web typecheck, API build, OpenAPI246, tenant-db, idempotency48, token-storage,
UX baseline, canonical measurement **3×5 LOCAL_SYNTHETIC** ve diff kontrolleri geçti.
Support testindeki tek geçici socket hatası ve değişmeden geçen tekrar dahil ayrıntı
[Gate 6E envanter ve kanıt kaydındadır](system-admin-tenant-reset-gate6-preflight.md).

Yerel Gate 6E tamamlandı; gerçek PG/Redis/provider drain ve yan etkisiz terminal receipt
kanıtı yoktur. Platform sayaçları ve tarihsel audit politikası tam sessizlik iddiası değildir.
`WRITE_QUIESCENCE_UNVERIFIED` korunur; ana Gate 6 **BLOCKED**, canlı reset kapalıdır.
Schema, migration, provider, secret/config, deploy veya canlı veri değişmedi. Bu kapıda duruldu.

### Gate 6F — secret-delivery kayıtlı gateway kabulünü salt okuma (2026-09-07)

Sistem yöneticisinin outbox tanı GET'i gerçek kurum/kayıt ve özgün epoch üzerinden gateway
anahtarını türetir. Gateway exact readonly route'u yalnız saklı record'u okur; gönderim,
retry, clear, alarm uzatma veya delete yoktur. Yeni gönderimlerin mevcut record yazımında
aynı zaman/keyHash metadata'sı saklanır; legacy kayıtlar doldurulmaz ve UNVERIFIED kalır.
Bearer, no-store, redirect reddi, strict şekil/zaman/hash kontrolleri birlikte uygulanır.

Yerel receipt hash eşleşmesi `LOCAL_RECEIPT_MATCH`, receipt yoksa `KEY_ONLY` korelasyonudur.
`PROVIDER_ACCEPTED` yalnız anahtar altındaki sağlayıcı kabulünü gösterir; terminal teslimat
değildir. KEY_ONLY tam payload kanıtı değildir. Mismatch/eksik/expired/erişilemeyen kayıtlar
ayrı güvenli durumlarda kalır; hiçbir sonuç belirsizliği temizlemez. Bu yalnız yapılandırılmış
notification gateway ve secret-delivery outbox kapsamıdır, genel SMS/announcement sorgusu değildir.

Son tam API **1220 PASS / 4 SKIP**, hedefli tenant API **51/51**, gateway **39/39** ve
notification adapter **25/25** PASS. API/shared/adapter typecheck ve build, OpenAPI **247 path**,
tenant-db, idempotency **48**, token-storage kontrolleri geçti. Son kanıt sınıfları
[Gate 6F kaydındadır](system-admin-tenant-reset-gate6-preflight.md).

Yerel Gate 6F tamamlandı. Gateway deploy'u, canlı lookup/send veya DB işlemi yapılmadı.
Gerçek provider terminal uzlaştırması ve dağıtık drain kanıtı eksik; ana Gate 6 **BLOCKED**,
`WRITE_QUIESCENCE_UNVERIFIED` ve `EXTERNAL_PROOF_REQUIRED` korunur. Bu kapıda duruldu.

### Gate 6G — geçici PostgreSQL doğrulama artifact'ı (2026-09-07)

`scripts/tenant-reset-postgres-drill.mjs` varsayılan salt okuma manifesti, **116** repo
migration dosyası/hash ve **11** gerçek PG senaryosuyla hazırlandı. Yalnız açık çalıştırma
bayrağı ve onaylı yerel Docker context/socket, fresh PostgreSQL16 container, loopback random
port ve tmpfs kabul eder. Caller DATABASE_URL/env loader ve remote hedef reddedilir.
Başarıdaki temizlik yalnız yeniden doğrulanan run-owned container içindir; hatada otomatik
retry/silme yoktur. `--pull=never` eksik image'ı gizlice çekmez.

Node syntax, default dry-run ve **6/6** guard/orchestration testi PASS. Gerçek runtime
**NOT_RUN**: Docker açılmadı, image/container/DB oluşturulmadı, SQL uygulanmadı. Sonraki
işlem için somut artifact ve disposable hedefe açık kullanıcı onayı gerekir; flag onay
değildir. SQL mode Prisma engine/ledger, backup veya full reset kanıtı üretmez.
Kaynak, kapsam ve komut [Gate 6G kaydında](system-admin-tenant-reset-gate6-preflight.md)
ve [runbook'ta](phase-6-ops-runbook.md) yer alır. Ana Gate 6 **BLOCKED** kalır.


### Gate 6G çalıştırma güncellemesi (2026-09-07)

Kullanıcı onayıyla Docker CLI + ayrı Colima profili üzerinde gerçek PostgreSQL 16
deneyi tamamlandı: **116 migration ve 11/11 senaryo PASS**. Hazırlıkta seçilen doğrudan
SQL yöntemi yerine gerçek Prisma migrate deploy kullanıldı; ledger checksum'ları
kaynak manifestiyle doğrulandı. `.env` yüklenmedi; üretim veritabanına bağlanılmadı.
Kanıt: `artifacts/tenant-reset-postgres-drill/d36575d9b02329266601c43f.json`.
Başarılı ve incelenen başarısız deney konteynerleri temizlendi. Ayrıntılar ve önceki
NOT_RUN kaydını güncelleyen sonuç [Gate 6G kaydında](system-admin-tenant-reset-gate6-preflight.md).
Bu yerel PG kanıtı tam reset/backup/restore/queue/provider veya production kanıtı değildir.
Ana Gate 6 **BLOCKED**, `WRITE_QUIESCENCE_UNVERIFIED` korunur.


### Gate 6H — yerel gerçek kuyruk kanıtı (2026-09-07)

Açık onayla mevcut geçici PostgreSQL deneyine ayrı Redis 7 ve gerçek BullMQ/SMS worker
admission akışı eklendi. **116 migration, 11 PG + 5 kuyruk senaryosu PASS**.
8/8 guard/dry-run testi PASS. Sağlayıcı timeout'u yerel adapter ile taklit edildi;
otomatik ve manuel retry ikinci gönderime yol açmadı, `UNCERTAIN` reseti engelledi.
Kanıt: `artifacts/tenant-reset-postgres-drill/06ba96e3564d98081fb13ad4.json`.
[Gate 6H kapsamı ve sınırları](system-admin-tenant-reset-gate6-preflight.md).
Gerçek provider terminal receipt/tüm yazıcıların drain kanıtı yok; ana Gate 6 BLOCKED.

### Gate 6I — sağlayıcı erişim engeli (2026-09-07)

Gerçek Cloudflare Email Service sonucuna geçişte mevcut OAuth oturumu ile yapılan
o-okul.com zone GET sorgusu 403/9109 döndü. Oturum süresi geçmiş; kayıtlı analytics
yetkisi yok. Gate 6I **BLOCKED**, terminal receipt sorgulanamadı. Geçerli Analytics Read
erişimi ve özgün outbox/gateway gönderim korelasyonu olmadan kesin sonuç üretilemez.
Kod/DB/provider ayarı değişmedi, mesaj gönderilmedi. [Ayrıntı ve kanıt](system-admin-tenant-reset-gate6-preflight.md).

### Gate 6I — tarayıcı üzerinden gerçek teslimat eşleştirmesi (2026-09-07)

Mevcut Cloudflare tarayıcı oturumuyla tarihsel sentetik aktivasyon gönderiminin
Delivered olayı ve x-o-okul-idempotency-key başlığı okundu. Başlık production
SecretDeliveryOutbox'taki tek satırla eşleşti. Terminal teslimat + outbox eşleştirmesi
doğrulandı; bağlı tenant ve invitation artık yok, canlı şemada epoch/provenance
alanları da yok. Gate 6I güncel reset bağlamında PARTIAL/BLOCKED kalır.
Canlı kayıtlara yazılmadı. Sıradaki ihtiyaç yerel gate kaynaklarının schema/runtime
farkını kontrollü release kapsamına almak; tarihsel teslimattan reset izni üretmemektir.

### Gate 6J — yayın kapsamı ve veri uyumluluğu engeli (2026-09-07)

[Kontrollü yayın kapsamı](system-admin-tenant-reset-release-scope.md) hazırlandı:
182 dosyalık snapshot envanteri, yedi bekleyen migration, exact runtime/PR/CI
karşılaştırması, doğrulama sırası ve geri dönüş sınırları. Canlı 109 migration'ın
hash'i yerelle eşleşiyor. Ancak 12 CLOSED kurum ilk yeni status migration'ını
engelliyor. Sonraki gate bu kayıtların anlamını ve veri bağlarını read-only inceleyip
erişimi kapalı tutan dönüşümü hazırlamak. Gate 6J hazırlığı tamam; yayın/reset açılmadı.

### Gate 6K — CLOSED migration uyumluluğu (2026-09-07)

12 CLOSED kurumun bağlı verileri salt okunarak incelendi; kapanış nedeni kanıtlanamadı.
Yayınlanmamış status migration'ı CLOSED → SUSPENDED yapacak, updatedAt/diğer alanlar
ve bağlı verileri koruyacak şekilde düzeltildi. Geçici gerçek PostgreSQL'de 109 → 116
migration yükseltmesi, 12 kapalı kurum/36 bağlı kayıt, rollback/no-op ve kapalı admission
kontrolleri PASS; DB 96/96, runner 9/9, 11 PG + 5 queue senaryosu PASS.
Production'a uygulanmadı. Yeni engel: staging deploy'un otomatik hesap backfill'i
SUSPENDED'a dönüşen kayıtları tekrar owner kapsamına alabilir. Sonraki gate bu
backfill uyumluluğudur; yayın/reset hâlâ kapalıdır. [Kanıt](system-admin-tenant-reset-gate6-preflight.md).

### Kullanıcı kapsam değişikliği — test kurumları silindi (2026-09-07)

Kullanıcının açık talebiyle dna/demoo ve sistem altyapı kurumu korundu; diğer 25 test
kurumu yedek + izole restore/prova sonrasında canlı DB'den silindi. Korunacak verilerin
72 tablodaki özetleri değişmedi; audit geçmişi korundu. Ayrı doğrulamada üç ACTIVE
kurum kaldı, hedef tenantId kayıtları yok. 12 CLOSED kurum artık canlıda bulunmadığından
önceki CLOSED veri dönüşümü canlı ihtiyaç olmaktan çıktı. Kaynaktaki uyumluluk
migration'ı ve testleri silinmedi. Yayın adayı/fresh reset yine ayrı kanıt gerektirir.
[Ayrıntı](system-admin-tenant-reset-gate6-preflight.md).


### Gate 6L — yayın backfill uyumluluğu

2026-09-07: hesap/lisans betikleri yalnız ACTIVE kurumları dönüştürecek şekilde
daraltıldı. Gerçek dolu PostgreSQL deneyinde 109 → 116 migration, 87 bağlı satırın
korunması, 13 SUSPENDED kurumda DRY_RUN + iki APPLY değişmezliği ve iki aktif kurumun
dönüşümü PASS. Runner 9/9, hesap/lisans contract'ları PASS. Kanıt ve system fixture
sınırı gate6-preflight Gate 6L'de. Bu sonuç LOCAL_TEST/LOCAL_RUNTIME; canlı yayın,
backup/restore veya reset başarısı değildir. Sonraki gate güvenli cutover sırası,
güncel E2E/görsel referans incelemesi ve ayrılmış adayın tam CI doğrulamasıdır.


### Gate 6M — kontrollü yayın hazırlığı

2026-09-07: migration öncesi temiz writer durdurma, eski public PASS invalidasyonu,
hata halinde kapalı kalma ve lisans backfill yayın sırasına bağlandı. Testler gerçek
workflow bloğunu fake Docker ile çalıştırır. Kurum yönetimi MFA/sürüm E2E 1/1 ve
incelenmiş iki Darwin görsel referansı 2/2 PASS. Güvenlik eşikleri değişmedi. Kapsam
ve kanıt sınırları preflight Gate 6M'de. Mevcut staging hedefi production ile aynıdır;
yeni kaynağın canlı doğrulaması henüz yapılmadı. Sıradaki Gate 6N ayrılmış aday ve tam CI.


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
