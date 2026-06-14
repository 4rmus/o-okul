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
Kaynak: Kullanıcı görüşmesi / master plan §2.
Kanıt: `MASTER_PLAN.md` §2, `docs/ADR-0001-multi-tenancy.md`.
Etkilenen ADR: ADR-0001
Açık soru: Yok
Son kontrol: 2026-05-29

### DEC-20260529-02 — İlk dağıtım modeli

Durum: Onaylı
Karar: VPS/self-hosted Docker Compose; TR datacenter gereksinimi.
Kaynak: Kullanıcı görüşmesi / master plan §2 ve §3.7.
Kanıt: `MASTER_PLAN.md` §2/§3.7, `docs/ADR-0002-deployment.md`.
Etkilenen ADR: ADR-0002
Açık soru: Yok. Traefik v3.7.5 imajına geçildi; v2->v3 geçiş rehberindeki kademeli Docker
label/routing uyumluluğu ve ACME HTTP-01/entrypoint kullanımı resmi Traefik dokümantasyonu ile
doğrulandı. Compose config kontrolü geçti; canlı HTTPS kanıtı staging domain bekliyor.
Son kontrol: 2026-06-13

### DEC-20260529-03 — Geliştirme modeli

Durum: Onaylı
Karar: Ana agent kritik yolu yürütür; subagent'lar ayrık inceleme, uygulama ve doğrulama işlerini alır.
Kaynak: Kullanıcı isteği / master plan §6.
Kanıt: `MASTER_PLAN.md` §6, `docs/phase-0-checklist.md`.
Etkilenen ADR: Yok
Açık soru: Yok
Son kontrol: 2026-05-29

### DEC-20260529-04 — Sınav kapsamı

Durum: Onaylı
Karar: TXT/DAT optik değerlendirme hedef kapsamda; gerçek örnek dosya gelene kadar parser kontrollü
beta kabul edilir.
Kaynak: Kullanıcı görüşmesi / master plan §2 ve §5.
Kanıt: `MASTER_PLAN.md` §2/§5; `docs/phase-3-report.md` sentetik pilot fixture notu;
`apps/worker/src/jobs/optical-pilot-fixture.test.ts`.
Etkilenen ADR: Yok
Açık soru: Gerçek cihazdan alınmış TXT/DAT örneği ve cevap anahtarı formatı geldiğinde gerçek cihaz
fixture'ı eklenmeli.
Son kontrol: 2026-06-02

### DEC-20260529-05 — Kota davranışı

Durum: Onaylı
Karar: Kota aşımında hard-block uygulanır; ödeme/fatura entegrasyonu v1 kapsamı dışıdır.
Kaynak: Master plan §2.
Kanıt: `MASTER_PLAN.md` §2.
Etkilenen ADR: Yok
Açık soru: Yok
Son kontrol: 2026-05-29

### DEC-20260529-06 — Dil

Durum: Onaylı
Karar: UI Türkçe; i18n'e hazır altyapı olabilir ama v1 tek dildir.
Kaynak: Master plan §2.
Kanıt: `MASTER_PLAN.md` §2.
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
Kaynak: Master plan §3.7 ve Faz 5 destek kapsamı.
Kanıt: `apps/api/src/support-ticket/support-ticket-attachment-storage.ts`, `docker-compose.yml`,
`GET /support-tickets/:id/attachments/:attachmentId/download`, `docs/phase-5-report.md`.
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
E-posta/push tarafında `NOTIFICATION_PROVIDER=noop` yalnız lokal/test kullanım içindir; production
env kontrolü `NOTIFICATION_PROVIDER=http`, gerçek HTTPS endpoint, Bearer token ve
`pnpm notification:smoke` sonucunu zorunlu tutar.
Kaynak: Master plan Faz 5 SMS adapter kapsamı ve Netgsm resmi REST v2 SMS dokümanı.
Kanıt: `packages/sms-adapter/src/index.ts`, `apps/worker/src/jobs/sms-batch-processor.ts`,
`packages/notification-adapter/src/index.ts`, `docker-compose.yml`, `.env.example`,
`pnpm sms:smoke`, `pnpm notification:smoke`.
Etkilenen ADR: Yok
Açık soru: Netgsm test credential/canlı hesap doğrulaması hâlâ `OPEN-20260529-04` altında bekliyor;
smoke komutu hazır, gerçek sağlayıcıda `SMS_SMOKE_CONFIRM=send` ister. E-posta/push için
staging HTTP provider credential'ı ve `NOTIFICATION_SMOKE_CONFIRM=send` sonucu bekliyor.
Son kontrol: 2026-05-30

### DEC-20260531-01 — Veli-öğrenci bağlama

Durum: Onaylı
Karar: Veli-öğrenci bağlantısını kurum yöneticisi kurar ve kaldırır; teacher rolü bağlantıları
okuyabilir, yazamaz. Telefon doğrulama ve veli self-service eşleştirme v1 kapsamı dışındadır.
Kaynak: Master plan §2 varsayılanı ve devam eden geliştirme hedefi.
Kanıt: `POST /guardians/:id/students`, `GET /guardians/:id/students`,
`DELETE /guardians/:id/students/:studentId`, `GuardianStudent` Postgres store smoke kapsamı.
Etkilenen ADR: ADR-0001
Açık soru: Yok
Son kontrol: 2026-05-31

### DEC-20260531-02 — Standart puan formülü

Durum: Onaylı
Karar: v1 puanlama varsayılanı mevcut davranışı korur: ham puan ve standart puan toplam nete
eşittir. Sınav bazlı `scoringConfig` içinde `rawScoreMultiplier`, `standardScoreBase` ve
`standardScoreMultiplier` verilirse standart puan deterministik olarak
`standardScoreBase + rawScore * standardScoreMultiplier` formülüyle hesaplanır. T-skor, yüzdelik ve
gerçek sıralama hesapları pilot veri olmadan v1 kapsamına alınmaz.
Kaynak: Master plan §2 ve §5, Faz 3 puanlama riski.
Kanıt: `apps/worker/src/jobs/scoring-engine.ts`, `PostgresExamEvaluationAdapter`,
`scoring-engine.test.ts`.
Etkilenen ADR: Yok
Açık soru: Yok
Son kontrol: 2026-05-31

### DEC-20260531-03 — Başarı oranı paydası

Durum: Onaylı
Karar: v1 raporlarında ayrı `successRate` alanı üretilmez; doğru/yanlış/boş/net alanları ayrı
taşınır. İleride yüzde gösterimi gerekirse payda `correct + wrong + blank` toplam soru sayısıdır.
Boş soru paydada yer alır, ancak net hesapta yanlış gibi ceza üretmez.
Kaynak: Master plan §10.7 açık sorusu ve mevcut ScoringEngine davranışı.
Kanıt: `apps/worker/src/jobs/scoring-engine.ts`, `scoring-engine.test.ts`.
Etkilenen ADR: Yok
Açık soru: Yok
Son kontrol: 2026-05-31

### DEC-20260613-01 — V1 ürün kapsam sınırı

Durum: Onaylı
Karar: V1 hedefi tek veya çok şubeli dershane/özel öğretim kurumunda TXT/DAT optik import,
rapor/karne, kişi portalları, ödeme/taksit takibi, duyuru/SMS/destek ve operasyon kanıt zinciridir.
Salon/oturma planı, online deneme oturumu, ödeme sağlayıcı/fatura/makbuz entegrasyonu ve OMR
görüntü tarama v1 kapsamı dışıdır.
Kaynak: `claudedocs/prod-plan-2026-06-12.md` Faz 1 ve Faz 7.
Kanıt: `docs/product-journeys-v1.md`, `docs/MASTER_PLAN.md` sınav ve kota kararları,
`docs/development-plan-2026-06-02.md` kapsam dışı notları.
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
Kaynak: `claudedocs/prod-plan-2026-06-12.md` §6.10.
Kanıt: `apps/api/src/auth/totp-mfa.ts`, `apps/api/src/auth/auth.service.ts`,
`docs/evidence-templates/admin-mfa.example.json`, `scripts/check-admin-mfa-evidence.mjs`.
Etkilenen ADR: Yok
Açık soru: Production'da `ADMIN_MFA_MODE=required` geçişi pilot kurum admin enrollment'ı tamamlandıktan
sonra ayrı go-live kararıyla yapılır; repo sözleşmesi staging için `optional` POC'yi kabul eder.
Son kontrol: 2026-06-13

### DEC-20260613-03 — AI karne özeti template fallback'i

Durum: Onaylı
Karar: Karne/veli özeti için ilk üretilebilir katman LLM'siz, deterministik template fallback olarak
`ReportSnapshot.snapshotData.commentary` ve öğrenci `commentary` alanlarına yazılır. Production
runtime'da `AI_REPORT_SUMMARY_PROVIDER` yalnız `disabled` veya `template` kabul eder; `anthropic`
dış sağlayıcı yolu ayrıca uygulanıp onaylanana kadar fail-fast kalır.
Kaynak: `claudedocs/prod-plan-2026-06-12.md` §6.11 stop-rule.
Kanıt: `apps/worker/src/jobs/report-generation-job.ts`,
`docs/evidence-templates/ai-report-summary.example.json`,
`scripts/check-ai-report-summary-evidence.mjs`.
Etkilenen ADR: Yok
Açık soru: Dış LLM POC'si yapılacaksa öğretmen değerlendirme rubriği ve KVKK aktarım kararı hangi
release candidate'a bağlanacak?
Son kontrol: 2026-06-13

### DEC-20260613-04 — V1 karne görsel kabul eşiği

Durum: Onaylı
Karar: ADIGÜZEL hedef PDF'leri v1 için sayısal doğruluk ve görsel regresyon bazı olarak kalır; v1
go-live için UI/portal karne ekranlarının hedef PDF'e birebir piksel eşleşmesi beklenmez. Kabul
kapısı iki katmanlıdır: `pnpm karne:visual-targets` 3 hedef PDF render/hash boyutunu korur ve
`pnpm karne:visual-diff -- --target iSEM --ui <png> --max-diff-ratio 0.53 --max-mean-channel-delta 36`
kanıt screenshot'ları için üst sınırı uygular. Bu eşikler mevcut 16+ iterasyonluk kanıt serisindeki
ham diff oranı bandını release regresyon kapısına çevirir; daha iyi görsel yakınsama hedeflenir ama
v1'i bloklamaz.
Kaynak: `claudedocs/prod-plan-2026-06-12.md` D4/Faz 2 ve `docs/development-plan-2026-06-02.md`
ADIGÜZEL visual-diff denemeleri.
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
Kaynak: `claudedocs/prod-plan-2026-06-12.md` A6 ve `docs/MASTER_PLAN.md` KVKK/PII notları.
Kanıt: `apps/api/src/observability/logging.ts`, `apps/api/src/observability/sentry.ts`,
`scripts/check-kvkk-inventory-evidence.mjs`, `scripts/check-pii-contact-policy.mjs`,
`docs/evidence-templates/kvkk-inventory.example.json`, `pnpm pii:contact-policy:check`,
`pnpm privacy:inventory:check`.
Etkilenen ADR: Yok
Açık soru: Real staging/prod KVKK inventory, KVKK aydınlatma metni/DPA ve hukuk veya veri koruma
onayı üretim çıkışından önce ayrıca alınacak; repo kararı bu gerçek kanıtların yerine geçmez.
Son kontrol: 2026-06-13

## Faz Öncesi Onay Gerektirenler

| ID | Faz | Bloklar mı? | Soru | Beklenen kanıt |
|---|---|---|---|---|
| OPEN-20260529-03 | Faz 3 | Evet | Gerçek cihaz TXT/DAT ve cevap anahtarı formatı nedir? | Gerçek cihaz örnek dosyası + sentetik pilot fixture yanına gerçek parser fixture |
| OPEN-20260529-04 | Faz 5 | Hayır | Netgsm test credential/canlı hesap doğrulaması nasıl yapılacak? | Test hesabı secretları + `pnpm sms:smoke` canlı/staging sonucu |
