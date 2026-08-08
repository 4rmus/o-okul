# Karar Kaydı

Bu dosya PRD veya kullanıcı görüşmelerinden gelen kararları izlemek için tutulur. `prd.md` repoya
eklendiğinde bu kayıt PRD bölümlerine bağlanmalıdır.

## Format

Karar ID formatı: `DEC-YYYYMMDD-NN`.

Her karar şu alanları taşır: `Durum`, `Karar`, `Kaynak`, `Kanıt`, `Etkilenen ADR`, `Açık soru`,
`Son kontrol`.

## Onaylı Kararlar

### DEC-20260529-01 — Tenant izolasyonu

Durum: Onaylı
Karar: Shared PostgreSQL + RLS + tenant-aware Prisma savunması.
Kaynak: Kullanıcı görüşmesi.
Kanıt: `docs/ADR-0001-multi-tenancy.md`, `pnpm db:rls:check`.
Etkilenen ADR: ADR-0001
Açık soru: Yok
Son kontrol: 2026-05-29

### DEC-20260529-02 — İlk dağıtım modeli

Durum: Onaylı
Karar: VPS/self-hosted Docker Compose; TR datacenter gereksinimi.
Kaynak: Kullanıcı görüşmesi.
Kanıt: `docs/ADR-0002-deployment.md`, `pnpm docker:check`.
Etkilenen ADR: ADR-0002
Açık soru: Yok. Traefik v3.7.5 imajına geçildi; Docker label/routing uyumluluğu ve ACME Cloudflare
DNS-01 wildcard yapılandırması doğrulandı. Compose config kontrolü geçti; canlı HTTPS kanıtı ayrı
staging deployment ve `*.staging.o-okul.com` DNS'i bekliyor.
Son kontrol: 2026-08-04

### DEC-20260529-03 — Geliştirme modeli

Durum: Onaylı
Karar: Ana agent kritik yolu yürütür; subagent'lar ayrık inceleme, uygulama ve doğrulama işlerini alır.
Kaynak: Kullanıcı isteği.
Kanıt: `AGENTS.md`, `docs/codex-agent-architecture.md`, `pnpm agents:check`.
Etkilenen ADR: Yok
Açık soru: Yok
Son kontrol: 2026-05-29

### DEC-20260529-04 — Sınav kapsamı

Durum: Onaylı
Karar: TXT/DAT optik değerlendirme hedef kapsamda kalır. iSEM/3D/MUBA OPTİK-7108 gerçek TXT ve cevap
anahtarı dosyaları repo fixture'ı olarak kabul edilmiştir. Kullanıcının sağladığı referans kolon
görselleriyle tek OPTİK FORM 129, tek YANIT YAYINLARI ve OPTİK 840 LGS fiziksel presetleri desteklenir.
Birleşik 129 ve Yanıt presetleri mantıksal 120/160 soru alanlarını seçili sınavın TYT/AYT türünden üretir.
Kaynak: Kullanıcı görüşmesi ve referans kolon görselleri.
Kanıt: `docs/product-journeys-v1.md`;
`apps/worker/src/jobs/optical-pilot-fixture.test.ts`;
`apps/api/src/exam/answer-key-excel-import.service.test.ts`;
`apps/worker/src/jobs/optik-7108-real-pipeline.test.ts`;
`apps/worker/src/jobs/tyt-ayt-placeholder-pipeline.test.ts`;
`apps/worker/src/jobs/optical-answer-parser.test.ts`;
`apps/api/src/exam/parser-config-suggestion.service.test.ts`;
`apps/api/src/exam/parser-config.controller.e2e.test.ts`;
`apps/web/e2e-next/optik-workspace-contract-next.spec.ts`;
`scripts/smoke-isem-optical-pipeline-live.mjs`.
Etkilenen ADR: Yok
Açık soru: OPTİK 129 ve YANIT presetleri 120 TYT / 160 AYT Lorem Ipsum workbook, iki sentetik
fixed-width öğrenci satırı, A/B hizalama, puanlama ve READY snapshot zinciriyle in-memory job
composition seviyesinde doğrulandı. Bu kanıt gerçek Postgres evaluation/report persistence,
gerçek üretici TXT/DAT fixture'ı, resmî ÖSYM TYT/AYT puanı, PDF/portal görsel kabulü veya staging/prod
tam sınav döngüsü değildir; bunlar pilot kabulünden önce ayrı kanıt kapılarıdır.
Son kontrol: 2026-07-25

### DEC-20260529-05 — Kota davranışı

Durum: Onaylı
Karar: Kota aşımında hard-block uygulanır; ödeme/fatura entegrasyonu v1 kapsamı dışıdır.
Kaynak: Kullanıcı görüşmesi.
Kanıt: `apps/api/src/license/license.service.ts`, `docs/product-journeys-v1.md`.
Etkilenen ADR: Yok
Açık soru: Yok
Son kontrol: 2026-05-29

### DEC-20260529-06 — Dil

Durum: Onaylı
Karar: UI Türkçe; i18n'e hazır altyapı olabilir ama v1 tek dildir.
Kaynak: Kullanıcı görüşmesi.
Kanıt: `apps/web`, `docs/product-journeys-v1.md`.
Etkilenen ADR: Yok
Açık soru: Yok
Son kontrol: 2026-05-29

### DEC-20260530-01 — Destek eki depolama ve indirme

Durum: Onaylı
Karar: Destek bildirimi ekleri varsayılan olarak geriye uyumlu inline base64 saklar; prod/staging
için `SUPPORT_ATTACHMENT_STORAGE=s3` ile MinIO/S3 uyumlu obje depolama kullanılır. S3 modunda
veritabanı dosya içeriğini değil `storageKey` referansını taşır; `contentBase64` alanı eski inline
kayıtlarla geriye uyum için kalır. Liste endpoint'i dosya içeriğini veya storage key'i döndürmez;
indirme endpoint'i tenant/ticket eşleşmesini doğruladıktan sonra içeriği storage katmanından okur.
Kaynak: Ürün depolama ve destek kapsamı kararı.
Kanıt: `apps/api/src/support-ticket/support-ticket-attachment-storage.ts`, `docker-compose.yml`,
`GET /support-tickets/:id/attachments/:attachmentId/download`, `pnpm upload-av:check`.
Etkilenen ADR: ADR-0002
Açık soru: Prod bucket adı ve credential değerleri deployment sırasında secret olarak verilecek.
Son kontrol: 2026-05-30

### DEC-20260530-02 — SMS sağlayıcı güvenlik kapısı

Durum: Onaylı
Karar: Gerçek SMS sağlayıcısı seçilene kadar `SMS_PROVIDER=noop` yalnız lokal/test kullanım içindir.
`NODE_ENV=production` ortamında `SMS_ALLOW_NOOP_IN_PRODUCTION=true` açıkça verilmedikçe worker no-op
SMS adapter ile başlamaz. İlk gerçek sağlayıcı implementasyonu Netgsm REST v2 olarak eklendi;
canlı gönderim için `SMS_PROVIDER=netgsm`, `NETGSM_USERCODE`, `NETGSM_PASSWORD` ve
`NETGSM_MSG_HEADER` secret değerleri gerekir.
E-posta/push adapter tarafında `NOTIFICATION_PROVIDER=noop` yalnız lokal/test kullanım içindir; production
env kontrolü `NOTIFICATION_PROVIDER=http`, gerçek HTTPS endpoint, Bearer token ve
`pnpm notification:smoke` sonucunu zorunlu tutar. İlk production release gerçek e-posta gönderimini
kapsar; push sağlayıcısı ve cihaz hedefi sonraki release'e bırakılır ve o zamana kadar fail-closed kalır.
Kaynak: Ürün iletişim kapsamı ve Netgsm resmi REST v2 SMS dokümanı.
Kanıt: `packages/sms-adapter/src/index.ts`, `apps/worker/src/jobs/sms-batch-processor.ts`,
`packages/notification-adapter/src/index.ts`, `docker-compose.yml`, `.env.example`,
`pnpm sms:smoke`, `pnpm notification:smoke`.
Etkilenen ADR: Yok
Açık soru: Netgsm test credential/canlı hesap doğrulaması hâlâ `OPEN-20260529-04` altında bekliyor;
smoke komutu hazır, gerçek sağlayıcıda `SMS_SMOKE_CONFIRM=send` ister. E-posta için staging HTTP
provider credential'ı ve `NOTIFICATION_SMOKE_CONFIRM=send` sonucu gerekir; push ayrı karardır.
Son kontrol: 2026-05-30

### DEC-20260531-01 — Veli-öğrenci bağlama

Durum: DEC-20260801-01 ile güncellendi
Karar: Veli-öğrenci bağlantısını kurum yöneticisi kurar ve kaldırır; teacher rolü bağlantıları
okuyabilir, yazamaz. Telefon doğrulama ve veli self-service eşleştirme v1 kapsamı dışındadır.
Kaynak: Veli portalı ürün kararı.
Kanıt: `POST /guardians/:id/students`, `GET /guardians/:id/students`,
`DELETE /guardians/:id/students/:studentId`, `GuardianStudent` Postgres store smoke kapsamı.
Etkilenen ADR: ADR-0001
Açık soru: Yok
Son kontrol: 2026-05-31

### DEC-20260531-02 — Standart puan formülü

Durum: DEC-20260727-01 ile güncellendi
Karar: Bu karar yalnız `LEGACY` rapor snapshot'larının nasıl üretildiğini açıklar. Yeni snapshot'lar
`standardScore`, T-skor, yüzdelik veya `estimatedRawScore` üretmez. Mevcut immutable `READY`
snapshot'lar yeniden hesaplanmaz ve kullanıcı yüzeyinde `Eski hesaplama` olarak ayrıştırılır.
Kaynak: Rapor doğruluğu ürün kararı.
Kanıt: `apps/worker/src/jobs/scoring-engine.ts`, `PostgresExamEvaluationAdapter`,
`scoring-engine.test.ts`.
Etkilenen ADR: Yok
Açık soru: Yok
Son kontrol: 2026-05-31

### DEC-20260531-03 — Başarı oranı paydası

Durum: DEC-20260713-02 ile güncellendi
Karar: v1 raporlarında ayrı `successRate` alanı üretilmez; doğru/yanlış/boş/net alanları ayrı
taşınır. İleride yüzde gösterimi gerekirse payda `correct + wrong + blank` toplam soru sayısıdır.
Boş soru paydada yer alır, ancak net hesapta yanlış gibi ceza üretmez.
Kaynak: Mevcut ScoringEngine davranışı ve ürün kararı.
Kanıt: `apps/worker/src/jobs/scoring-engine.ts`, `scoring-engine.test.ts`.
Etkilenen ADR: Yok
Açık soru: Yok
Son kontrol: 2026-05-31

### DEC-20260613-01 — V1 ürün kapsam sınırı

Durum: Onaylı
Karar: V1 hedefi tek veya çok şubeli dershane/özel öğretim kurumunda TXT/DAT optik import,
rapor/karne, kişi portalları, ödeme/taksit takibi, duyuru/SMS/destek ve operasyon kanıt zinciridir.
Ödeme sağlayıcı/fatura/makbuz entegrasyonu v1 kapsamı dışıdır.
Kaynak: Kullanıcı kapsam kararı.
Kanıt: `docs/product-journeys-v1.md`, `status.md`.
Etkilenen ADR: Yok
Açık soru: Pilot kurum farklı optik format veya fatura entegrasyonu isterse Faz 4/Faz 10 karar
kapısında ayrı DEC açılır.
Son kontrol: 2026-06-13

### DEC-20260613-02 — Admin MFA ikinci faktörü

Durum: Onaylı
Karar: SYSTEM_ADMIN ve TENANT_ADMIN hesapları için ikinci faktör TOTP + tek kullanımlık recovery
code olarak uygulanır. SMS OTP v1'de ikinci faktör olarak kullanılmaz; SIM-swap ve maliyet riski
nedeniyle reddedilir. TOTP secret'ları AES-GCM ile şifreli saklanır, recovery code'lar HMAC hash
olarak tutulur ve MFA enable/disable işlemleri mevcut refresh session'ları iptal eder.
Kaynak: Güvenlik ve ürün kararı.
Kanıt: `apps/api/src/auth/totp-mfa.ts`, `apps/api/src/auth/auth.service.ts`,
`docs/evidence-templates/admin-mfa.example.json`, `scripts/check-admin-mfa-evidence.mjs`.
Etkilenen ADR: Yok
Açık soru: Production'da `ADMIN_MFA_MODE=required` geçişi pilot kurum admin enrollment'ı tamamlandıktan
sonra ayrı go-live kararıyla yapılır; repo sözleşmesi staging için `optional` POC'yi kabul eder.
Son kontrol: 2026-06-13

### DEC-20260613-04 — V1 karne görsel kabul eşiği

Durum: Onaylı
Karar: ADIGÜZEL hedef PDF'leri v1 için sayısal doğruluk ve görsel regresyon bazı olarak kalır; v1
go-live için UI/portal karne ekranlarının hedef PDF'e birebir piksel eşleşmesi beklenmez. Kabul
kapısı iki katmanlıdır: `pnpm karne:visual-targets` 3 hedef PDF render/hash boyutunu korur ve
`pnpm karne:visual-diff -- --target iSEM --ui <png> --max-diff-ratio 0.53 --max-mean-channel-delta 36`
kanıt screenshot'ları için üst sınırı uygular. Bu eşikler mevcut 16+ iterasyonluk kanıt serisindeki
ham diff oranı bandını release regresyon kapısına çevirir; daha iyi görsel yakınsama hedeflenir ama
v1'i bloklamaz. Repo CI kapısı ayrıca `Karne Önizleme` yüzeyini takip edilen Playwright baseline'ı
ile karşılaştırır; baseline eksikliği veya görsel sapma `pnpm karne:visual-contract:check` komutunu
kırmızıya düşürür ve karşılaştırma sessizce atlanamaz.
Kaynak: ADIGÜZEL visual-diff denemeleri ve ürün kararı.
Kanıt: `scripts/check-adiguzel-pdf-visual-targets.mjs`, `scripts/compare-karne-visual-evidence.mjs`,
`scripts/check-karne-visual-contract.mjs`, `pnpm karne:visual-contract:check`.
Etkilenen ADR: Yok
Açık soru: Gerçek kurum logosu, basılı karne marka uyumu ve nihai tasarım onayı pilot kurum
öncesinde ürün sahibi tarafından ayrıca imzalanacak; bu karar yalnız v1 teknik regresyon eşiğini
sabitler.
Son kontrol: 2026-06-13

### DEC-20260613-05 — V1 contact PII retention policy

Durum: Onaylı
Karar: TC kimlik alanı `STUDENT_PII_ENCRYPTION_KEY` ve `STUDENT_PII_HASH_KEY` ile şifreli+hash'li
kalır. Student.phone, Student.email, Guardian.phone ve User.email v1'de operasyonel iletişim,
login/davet, veli eşleştirme ve SMS/e-posta iş akışları için birincil veritabanında düz metin
operasyonel alan olarak saklanır. Guardian.email is not a persisted Guardian column; veli portal
hesap e-postası User.email ile temsil edilir. Bu alanlar log, Sentry event'i, audit diff'i, smoke
kanıtı veya production evidence artifact'ine ham değer olarak yazılamaz; `SENTRY_SEND_DEFAULT_PII=false`
ve redaction testleri bu sınırı korur.
Kaynak: KVKK/PII güvenlik kararı.
Kanıt: `apps/api/src/observability/logging.ts`, `apps/api/src/observability/sentry.ts`,
`scripts/check-kvkk-inventory-evidence.mjs`, `scripts/check-pii-contact-policy.mjs`,
`docs/evidence-templates/kvkk-inventory.example.json`, `pnpm pii:contact-policy:check`,
`pnpm privacy:inventory:check`.
Etkilenen ADR: Yok
Açık soru: Real staging/prod KVKK inventory, KVKK aydınlatma metni/DPA ve hukuk veya veri koruma
onayı üretim çıkışından önce ayrıca alınacak; repo kararı bu gerçek kanıtların yerine geçmez.
Son kontrol: 2026-06-13

### DEC-20260623-01 — Karne soru detayı veri sınırı

Durum: DEC-20260713-03 ile minimal rapor kimliği istisnası eklendi
Karar: V1 karne ekranı ve PDF/Excel raporları, yetkili kurum yöneticisi, kapsamı doğrulanmış öğretmen,
öğrenci ve bağlı veli için soru bazlı `answer`, `correctAnswer` ve `status` alanlarını gösterebilir.
Bu alanlar yalnız karne/soru analizi ve hata kitapçığı amacıyla response body'de bulunur; audit log,
smoke/evidence artifact'i, liste endpoint'i veya üretim kanıtında ham cevap seti olarak yazılamaz.
Ana öğrenci raporu, soru detayı taşısa bile kimlik, iletişim, storage key, raw import row veya dosya
içeriği alanlarını taşıyamaz. Hata kitapçığı, yanlış/boş soru remediation yüzeyi olarak daha dar kalır
ve öğrenci kimliği/bağlam/puan alanlarını genişletmez.
Kaynak: V1 rapor/karne kapsamı ve mevcut karne UI soru analizi.
Kanıt: `apps/api/src/report/report-generation.service.ts`,
`apps/api/src/report/report-generation.controller.e2e.test.ts`,
`apps/api/src/openapi-contracts.ts`, `apps/web/app/(app)/_shared/karne-sheet.tsx`,
`scripts/generate-openapi.mjs`.
Etkilenen ADR: Yok
Açık soru: Gerçek staging/prod KVKK inventory ve pilot veli/öğrenci aydınlatma metni onayı Faz 5/Faz 10
kapısında ayrıca üretilmelidir; bu karar local/static evidence yerine geçmez.
Son kontrol: 2026-06-23

### DEC-20260627-01 — Production v1 modernizasyon kapsam kilidi

Durum: Hesap ve guardian kapsamı DEC-20260801-01 ile güncellendi
Karar: Per-tenant `User`, TC/telefon ile giriş, zorunlu
şifre değişimi, akademik taksonomi (`Alan`, `GradeLevelCourse`, `Class.alanId`) ve PII kolon
düşürmeleri ayrı migration dalgaları olarak uygulanır. Bu dilimde veli finans/duyuru/destek
varsayılanları açık, SMS varsayılanı kapalıdır; SMS kodu ve Netgsm adapter kalır ama
`SMS_ENABLED=false` v1 varsayılanıdır ve SMS sağlayıcı kanıtı v1 go-live blocker'ı değildir.
Kaynak: Kullanıcı modernizasyon kararı.
Kanıt: `apps/api/src/school/guardian-student-store.ts`, `apps/api/src/school/school.service.ts`,
`apps/api/src/sms-batch/sms-batch.service.ts`, `apps/api/src/search/search.service.ts`, `.env.example`,
`packages/db/prisma/migrations/20260627123000_guardian_student_sms_default_off/migration.sql`,
`packages/db/prisma/migrations/20260627143000_drop_student_birthdate_guardian_relation_fields/migration.sql`,
`packages/db/prisma/migrations/20260627152000_add_global_search_trigram_indexes/migration.sql`,
`packages/db/prisma/migrations/20260627154000_add_alan_grade_level_courses/migration.sql`.
Etkilenen ADR: Yok
Açık soru: Per-tenant giriş yolu (`/k/{slug}/giris` veya kurum kodu alanı) ve akademik taksonomi
ortak ders kapsamı sonraki migration dalında netleştirilecek.
Son kontrol: 2026-06-27

### DEC-20260713-01 — Günlük sınıf yoklaması

Durum: Onaylı
Karar: V1 devamsızlık akışı ders saati bazlı değil, öğrenci başına takvim gününde tek kayıt olan
günlük sınıf yoklamasıdır. Kurum veya atanmış öğretmen sınıf+tarih seçer, aktif öğrenci listesini
tek atomik ve idempotent işlemle kaydeder. Yeni günlük akışta `courseId` kullanıcıdan istenmez;
eski kayıtların `courseId` değeri yalnız geriye uyumlu okuma için korunur. Dönem bağlamı sunucu
tarafında doğrulanır. Öğrencinin sınıf üyeliği ve öğretmen ataması yoklama tarihine göre
doğrulanır; transfer edilen öğrencinin eski yoklaması yeni sınıfa taşınmaz. Özetler sayfadaki
satırlardan değil, bütün yetkili filtreli sonuçtan üretilir.
Kaynak: Mevcut `Attendance` öğrenci+tarih tekillik kuralı ve UI/UX profesyonelleştirme kararı.
Kanıt: `apps/api/src/attendance`, `apps/web/app/(app)/kurum/devamsizlik`,
`GET /api/v1/attendance/daily`, `apps/api/src/attendance/attendance.e2e.test.ts`.
Etkilenen ADR: ADR-0001
Açık soru: Yok
Son kontrol: 2026-07-13

### DEC-20260713-02 — Başarı yüzdesi rapor ana metriğidir

Durum: DEC-20260727-01 ile güncellendi
Karar: `successRate` rapor snapshot, API, web, PDF ve Excel yüzeylerinde üretilir ve farklı soru
sayılarına sahip sınavları karşılaştırmak için ana metriktir. Payda aktif soru sayısıdır; iptal
edilmiş soru fiziksel soru sayısı doğrulamasında kalır ancak başarı ve puan paydasından çıkarılır.
Boş soru aktif paydada yer alır ve net hesabında yanlış cezası üretmez. `Net / Soru` ikincil,
`Deneme puanı` üçüncül bağlam olarak görünür kalır. Bu karar DEC-20260531-03 içindeki "ayrı
successRate üretilmez" bölümünün yerine geçer.
Kaynak: Mevcut worker snapshot sözleşmesi ve rapor/karne UI kabul kuralı.
Kanıt: `apps/worker/src/jobs/report-generation-job.ts`,
`apps/web/app/(app)/_shared/karne-sheet.tsx`, `pnpm karne:visual-contract:check`.
Etkilenen ADR: Yok
Açık soru: Yok
Son kontrol: 2026-07-13

### DEC-20260727-01 — Standart sapmasız LGS–YKS deneme puanı

Durum: Onaylı
Karar: Yeni LGS ve YKS sonuçları, ulusal ortalama veya standart sapma kullanılmadan, sürümlü
`TR-LGS-2026-NOSD-V1` ve `TR-YKS-2026-NOSD-V1` profilleriyle `100–500` aralığında tekrar
üretilebilir `O-Okul Deneme Puanı` üretir. Her aktif alt test için
`net = doğru - yanlış × ceza`, `oran = clamp(net / aktif soru sayısı, 0, 1)` ve toplam puan
`round(100 + 400 × ağırlıklı oran, 2)` olur. LGS cezası `1/3`, TYT/AYT cezası `1/4`'tür.
LGS ağırlıkları Türkçe/Matematik/Fen için `4`, diğer üç alt test için `1`; TYT ağırlıkları
Türkçe/Sosyal/Temel Matematik/Fen için `%33/%17/%33/%17`'dir. SAY, EA ve SÖZ puanları bağlı
TYT'nin `%40` payı ile sürümlü AYT alt test ağırlıklarını birleştirir. TYT için Türkçe veya
Matematik ham neti en az `0,5`; alan puanı için bağlı TYT ile ilgili AYT test çiftlerinden en az
biri `0,5` olmalıdır. Uygun olmayan sonuç gerekçeli `NOT_ELIGIBLE`, bağlı TYT yokluğu
`MISSING_TYT` olur.

İptal soru aktif soru ve puan paydasından çıkarılır; cevap düzeltmesi yeni cevap anahtarı sürümüyle
yeni append-only sonuç üretir. Resmî profilin ceza, soru bölümü veya sınav türü uyuşmazlığı
fail-closed reddedilir. LGS muafiyetinde mevcut alt test ağırlıkları yeniden normalize edilir ve
bu ürün varsayımı snapshot metadatasında taşınır. Her yeni skor görünümü
`officialComparable:false` taşır ve puan gösterilen her yüzey şu uyarıyı verir:
`Standart sapma kullanılmadan hesaplanan deneme puanıdır. Resmî MEB/ÖSYM sınav puanı değildir.`
Yalnız kurum ve sınıf içi rekabet sırası gösterilir; eşit puanlar aynı sırayı paylaşır. OBP,
yerleştirme puanı, YDT ve ulusal başarı sırası kapsam dışıdır.
Kaynak: 2026 MEB LGS ve 2026 ÖSYM YKS kılavuzlarındaki net, standartlaştırma ve test ağırlıkları;
ürün sahibi tarafından kilitlenen standart sapmasız deneme puanı kararı.
Kanıt: `apps/worker/src/jobs/scoring-engine.ts`,
`apps/worker/src/jobs/report-generation-job.ts`, `packages/shared-types/src/domain.ts`.
Etkilenen ADR: Yok
Açık soru: OBP, YDT ve yerleştirme puanı ayrı bir gelecek kararıdır.
Son kontrol: 2026-07-27

### DEC-20260713-03 — Tekrar üretilebilir raporda minimal öğrenci kimliği

Durum: Onaylı
Karar: Kullanıcıya sunulan karne, PDF ve Excel çıktısının daha sonra aynı kimlikle tekrar
üretilebilmesi için rapor snapshot'ındaki öğrenci satırına yalnız üretim anındaki `displayName` ve
`studentNo` dondurulur. Bu iki alan tenant-kapsamlı snapshot saklama süresine tabidir. TC kimlik,
telefon, e-posta, adres, storage key ve ham import içeriği snapshot'a eklenmez; dondurulan alanlar
log, audit diff, smoke veya production evidence artifact'ine yazılmaz. Normalize kimlik izi
snapshot içerik hash'ine katılır ama `inputRefs` içinde saklanmaz; ad/numara değişikliği yeni
immutable snapshot üretir. Öğrenci PII silme akışı tenant-kapsamlı snapshot'lardaki bu iki alanı
da temizler ve bu adım başarısız olursa öğrenci temizliği fail-closed durur. Bu karar
DEC-20260623-01'deki kimlik yasağını yalnız bu iki kullanıcıya dönük alan için daraltır.
Kaynak: Rapor tekrar üretilebilirliği ve profesyonel PDF/Excel kimlik ihtiyacı.
Kanıt: `apps/worker/src/jobs/postgres-report-generation-adapter.ts`,
`apps/worker/src/jobs/report-generation-job.ts`, `apps/worker/src/jobs/report-pdf-render-job.ts`.
Etkilenen ADR: ADR-0002
Açık soru: Gerçek staging/prod KVKK envanteri ve pilot aydınlatma metni onayı ayrıca gereklidir.
Son kontrol: 2026-07-13

### DEC-20260801-01 — Kurum, hesap, lisans ve erişim modeli

Durum: Onaylı; additive migration ve tenant bazlı cutover bekliyor
Karar: Sözleşmeli müşteri veri izolasyonu ve lisans sınırı olan tek `Tenant`, şubeler tenant
altındaki `Campus` olarak kalır. Fiyatlama aktif öğrenci kotasına dayanır; çalışan hesapları ücretli
koltuk değildir. Yıllık veya çok yıllık lisans dönemleri geriye dönük değiştirilmez: yeni
`LicenseTerm` segmentleri eklenir. Dönem öncesinde giriş kapalı, dönem sonunda 14 gün salt-okunur,
15-90. günlerde dondurulmuş saklama ve 91. günde legal hold/retention kontrolüne bağlı imha süreci
uygulanır. Normal API tenant graph'ını fiziksel silemez.

Tenant hesabı, çalışan/öğrenci profili, tenant üyeliği ve session birbirinden ayrılır. Giriş
`kurum kodu + kurum içi kullanıcı kimliği` ile yapılır; T.C. kimlik numarası ve telefon kullanıcı adı,
ilk parola veya reset parolası olamaz. Aynı kişi farklı tenantlarda ayrı hesap kullanır. Çalışan aynı
zamanda öğretmense tek hesapla, capability birleşimi olmadan `STAFF` ve `TEACHER` personaları
arasında geçiş yapar. Öğrenci personası çalışan hesabıyla birleşmez.

Yetkilendirme altı sabit paket ve kapsam üzerinden yürür: `TENANT_OWNER`, `TENANT_ADMIN`,
`OPERATIONS_STAFF`, `FINANCE_STAFF`, `TEACHER`, `STUDENT`. Rank karşılaştırması yerine exact
capability ve tenant/campus/öğretmen ataması kapsamı kullanılır. `SYSTEM_ADMIN` tenant rolü
olmaktan çıkarılıp ayrı control plane hesabına taşınır; tenant verisine süreli, MFA'lı ve auditli
breakglass dışında erişemez.

Öğrenci profili zorunlu, portal hesabı opsiyoneldir. `GUARDIAN` rolü, hesabı, session'ı ve portalı
emekliye ayrılacaktır; yeni hedef yalnız login yetkisi olmayan `StudentContact` kaydıdır. Mevcut
guardian runtime, fixture ve UAT sözleşmeleri additive model, veri envanteri, doğrulanmış yedek,
veri sahibi onayı ve gözlem süresi tamamlanmadan kaldırılmaz. Bu karar DEC-20260531-01'in tamamının
ve DEC-20260627-01'in TC/telefon girişi ile guardian kapsamının yerine geçer; ikinci karardaki
akademik taksonomi ve SMS varsayımları değişmez.
Kaynak: Ürün sahibinin onayladığı kurum ve hesap yönetimi mimarisi.
Kanıt: `docs/account-management-architecture-plan.md`, `packages/db/prisma/schema.prisma`,
`packages/shared-types/src/role-capabilities.ts`,
`apps/api/src/identity-provisioning/profile-lifecycle-store.ts`,
`packages/db/prisma/migrations/20260801190000_add_account_management_foundation/migration.sql`,
`docs/product-journeys-v1.md`.
Etkilenen ADR: ADR-0001, ADR-0002
Açık soru: Yok. Runtime geçişi DEC'te tanımlanan güvenlik ve geri dönüş kapılarıyla PR-1–PR-8
dilimlerinde yapılacaktır; bu karar tek başına staging veya production capability kanıtı değildir.
Son kontrol: 2026-08-01

### DEC-20260804-01 — Kurum subdomaini tenant giriş bağlamıdır

Durum: Onaylı; staging wildcard DNS/TLS ve runtime cutover kanıtı bekliyor
Karar: Her kurum tek paylaşımlı uygulama ve veritabanı üzerinde `{tenantSlug}.o-okul.com`
adresinde çalışır. Kurum hostu login, parola sıfırlama, aktivasyon ve oturum isteklerinde tenant
bağlamını belirler; token/session tenantı host tenantıyla eşleşmek zorundadır. Öğrenci numarası,
personel numarası ve doğrulanmış e-posta tenant-local login kimlikleridir. `Tenant.slug` oluşturma
sonrasında değiştirilemez. Cookie'ler host-only kalır; tenant başına deployment, global login
tekilliği, kampüs subdomaini ve özel kurum domaini v1 kapsamı dışındadır. Eski `/k/{slug}/giris`
yolu production aktivasyonundan sonra 30 gün yönlendirilir ve sonra emekliye ayrılır. Wildcard TLS
Cloudflare DNS-01 ile, zone-kapsamlı dar yetkili secret kullanılarak yönetilir.
Kaynak: Ürün sahibinin onayladığı kurum subdomaini ve hibrit giriş planı.
Kanıt: `docs/tenant-subdomain-login-architecture-plan.md`, `apps/api/src/http/tenant-host.ts`,
`docker-compose.traefik.yml`, auth/web host izolasyonu testleri.
Etkilenen ADR: ADR-0001, ADR-0002
Açık soru: Yok. Yerel/static PASS gerçek DNS, wildcard sertifika, staging deploy veya canlı cutover
kanıtı değildir.
Son kontrol: 2026-08-04

### DEC-20260808-01 — WhatsApp opsiyonel ve varsayılan kapalı bildirim kanalıdır

Durum: Onaylı; yerel temel hazır, runtime/provider ve dış ortam kanıtı yok
Karar: WhatsApp Cloud API opsiyonel bir bildirim kanalıdır ve `WHATSAPP_ENABLED=false` ile
varsayılan kapalı kalır. İlk sürüm yalnız outbound gönderimdir; Meta onaylı utility template içinde
PII içermeyen portal bağlantısı kullanılır. WhatsApp izni kanal bazlı opt-in/opt-out olarak tutulur,
varsayılanı `false` olur ve mevcut `canReceiveSms` izni yeniden kullanılmaz. İzin yoksa veya kanal
kapalıysa e-posta ve uygulama içi bildirim fallback'i korunur; SMS disabled kalır.

MFA, login, davet ve parola sıfırlama; ham not, sınav sonucu, finans ve sağlık içeriği; medya
gönderimi ve inbound destek bu kapsamın dışındadır. Repo içinde SMS izninden bağımsız, tenant +
`phoneHash` + amaç bazlı `WhatsAppConsent` projection'ı; `StudentContact` veri sahibi bağı taşıyan
append-only `WhatsAppConsentEvent` geçmişi; onaylı utility template kabul eden default-off
Meta gateway adaptörü; ham gövde imzasını doğrulayıp güvenli durum özetini tekrar işlemeyen webhook
temeli bulunur. Meta API'nin kabul ettiği mesaj kimliği teslim kanıtı değildir; webhook bu dilimde
duyuru veya teslimat durumunu değiştirmez.

WABA/telefon/template onayları, gerçek credential ve deploy, izin yönetimi/geri çekme yüzeyi,
gönderim anı izin kontrolü, tenant-bound outbound mesaj kaydı ve webhook teslim uzlaştırması,
KVKK/DPA onayı ve gerçek staging gönderim/teslim kanıtı tamamlanmadan capability açılamaz.
Yerel/mock test ve static sözleşme kontrolleri WhatsApp capability veya teslimat kanıtı değildir.
Bu kapalı temel sürümünde `WhatsAppConsent` veya `WhatsAppConsentEvent` runtime kaydı yazılmaz ve
staging/production KVKK envanterinde iki kayıt sayısı da sıfır olmak zorundadır. Yerel DB/store
sözleşmesi aynı tenant içindeki aynı telefonlu kardeş kayıtlarını ortak izin kapsamında tutar;
herhangi bir bağlı contact geri çektiğinde ortak projection kapanır. Grant/withdraw/re-grant
append-only geçmişi, contact FK'sı, idempotency ve RLS/least-privilege kontrolleri yerel olarak
hazırdır. Saklama/imha kararı, purge yolu ve kullanıcı yüzeyi olmadan gerçek izin kaydı yazılamaz.
Doğrudan inactive/version 0 projection INSERT yalnız eventless telefon kapsamı rezervasyonudur;
runtime bağlantısı olmayan bu P2 satır da `recordCount` hesabına girer. Aktivasyon öncesi
`ContactIdentity` ile numara yeniden tahsisi doğrulaması, keyed phone HMAC ve anahtar rotasyonu ve
gerçek staging DB'den salt sayım artifact'i üreten generator tamamlanmalıdır.

Kanal izni amaç, aydınlatma sürümü, kaynak, kayıt ve geri çekme zamanıyla tutulur; her gönderim
anında yeniden doğrulanır ve geri çekme kuyruktaki bekleyen gönderileri bastırır. Geri çekme yolu
inbound sohbet gerektirmeden web/uygulama yüzeyinden erişilebilir olur. Portal bağlantısı sabit ve
kimlik doğrulamalı olur; URL, provider metadata, log veya evidence içinde öğrenci/tenant kimliği,
telefon, magic-link tokenı veya sır taşıyamaz. Meta/BSP alt işleyenleri, işleme ülkeleri, telefon ve
teslim metadata'sı veri envanteri, saklama/silme süresi ve yurt dışı aktarım mekanizması hukuk/veri
koruma sorumlusu tarafından onaylanmadan `WHATSAPP_ENABLED=true` değişikliği kabul edilemez.

İlk doğrulama için tek tenant ve O-Okul numarasıyla sınırlı pilot önerilir. Genel release öncesinde
tenant-owned WABA/numara ile merkezi O-Okul topolojisi arasında kalite, izolasyon, operasyon ve veri
işleme risklerini kapsayan ayrı karar kapısı zorunludur.
Kaynak: Ürün sahibinin onayladığı WhatsApp entegrasyonu ilk güvenli dilimi.
Kanıt: `.env.example`, `docs/evidence-templates/staging-evidence.env.example`,
`scripts/check-prod-env.mjs`, `scripts/check-staging-evidence-env.mjs`,
`packages/db/prisma/migrations/20260808150000_add_whatsapp_consent_foundation/migration.sql`,
`packages/db/prisma/migrations/20260808170000_add_whatsapp_consent_lifecycle/migration.sql`,
`apps/api/src/whatsapp-consent/whatsapp-consent-store.test.ts`,
`packages/notification-adapter/src/index.test.ts`, `infra/notification-gateway/src/index.test.mjs`,
`docs/product-journeys-v1.md`, `docs/phase-6-production-readiness.md`.
Etkilenen ADR: Yok
Açık soru: Provider ve genel release topolojisi pilot öncesi/sonrası ayrı kararla seçilecektir.
Son kontrol: 2026-08-08

## Faz Öncesi Onay Gerektirenler

| ID | Faz | Bloklar mı? | Soru | Beklenen kanıt |
|---|---|---|---|---|
| OPEN-20260529-03 | Faz 4 / Faz 10 | Hayır | iSEM fixture geldi; pilot sınav döngüsü kabulü üretildi mi? | Gerçek iSEM fixture testleri + staging `pnpm live:exam-cycle:check` artifact'i tamam; kalan pilot UAT kanıtı |
| OPEN-20260529-04 | Faz 5 | Hayır | Netgsm test credential/canlı hesap doğrulaması nasıl yapılacak? | Test hesabı secretları + `pnpm sms:smoke` canlı/staging sonucu |
