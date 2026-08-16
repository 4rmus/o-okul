# V1 Urun Yolculuklari ve UAT Matrisi

Kaynak: `docs/DECISIONS.md` ve güncel kod/test sözleşmeleri. Kullanıcıya dönük ürün dili ve
pazarlama iddiaları için eş sözleşme `docs/marketing-claims.md` dosyasıdır.

Bu dosya v1 icin hangi kurum tipi, hangi roller ve hangi gunluk islerin desteklendigini
repo kanitiyla baglar. Staging/prod UAT raporu bu senaryo kimliklerini kullanir.

## Durum Etiketleri

- `PASS`: Repo icinde kod, test veya statik gate kaniti var.
- `PARTIAL`: Ana akış var; canli ortam, saglayici veya UX kaniti eksik.
- `CONTRACT_READY_EXTERNAL_NOT_RUN`: Repo kanit sozlesmesi hazir; gercek staging/prod kosusu bekliyor.
- `MISSING`: V1 icin gerekli ama repo kaniti yok; backlog fazina baglandi.
- `V1_OUT`: Bilincli kapsam disi; `DEC-20260613-01` altinda kararli.
- `EXTERNAL_NOT_RUN`: Repo kapisi hazir; staging/prod, saglayici veya pilot kaniti bekliyor.

## Kapsam Karari

V1 hedef kurum tipi: tek veya cok subeli dershane/ozel ogretim kurumu. V1 ana degeri
`TXT/DAT optik -> guvenilir rapor/karne -> kurum/ogretmen/ogrenci yetkili gorunumu -> odeme ve
iletisim takibi` dongusudur.

V1 kapsam disi maddeler:

- Odeme saglayici, fatura ve makbuz entegrasyonu: `V1_OUT`; finans modulu alacak/taksit takibidir.

Karar kaydi: `docs/DECISIONS.md` `DEC-20260613-01`.

### Giris ve platform siniri

- Kanonik kurum girisi `{tenantSlug}.o-okul.com` adresinde tenant-local `loginName + password`
  sozlesmesidir. Kullaniciya "kurumun O-Okul adresi" ve "kurum ici kullanici adi" denir; formda
  kurum kodu istenmez. T.C. kimlik numarasi ve telefon kullanici adi veya varsayilan parola olamaz.
- Ogrenci numarasi, personel numarasi ve dogrulanmis e-posta ayni tenant icinde login kimligi
  olabilir. Global kullanici adi, kampus subdomaini ve ozel kurum domaini v1 kapsam disidir.
- `SYSTEM_ADMIN` hedefte tenant personası degil, ayri control-plane hesabidir. Tenant verisine
  varsayilan erisimi yoktur; sureli, MFA'li ve auditli breakglass disinda kurum verisi acilmaz.

Karar kayitlari: `DEC-20260801-01` ve `DEC-20260804-01`.

## Mevcut Runtime ve Hedef Persona Ayrimi

Mevcut gecis runtime'i `SYSTEM_ADMIN`, `TENANT_OWNER`, `TENANT_ADMIN`, `ASSISTANT_ADMIN`,
`OPERATIONS_STAFF`, `FINANCE_STAFF`, `TEACHER`, `STUDENT` ve `GUARDIAN` rollerini tanir. Asagidaki
yolculuk/UAT matrisi bu calisan yuzeylerin kanitini korur; hedef urun personasini genisletmez.

Hedef urun ve pazarlama personalari:

| Teknik rol | Kullaniciya donuk persona | Sinir |
|---|---|---|
| `TENANT_OWNER` | Kurum sahibi | Kurum, guvenlik ve yetki sahipligi; platform/lisans kosullarini degistiremez |
| `TENANT_ADMIN` | Kurum yoneticisi | Kurumun yetkili yonetim ve operasyon alani |
| `OPERATIONS_STAFF` | Operasyon calisani | Kayit, sinif, sinav, yoklama ve duyuru; finans ve guvenlik haric |
| `FINANCE_STAFF` | Finans calisani | Odeme plani ve taksit takibi; akademik sonuc erisimi yok |
| `TEACHER` | Ogretmen | Atanmis sinif, ders ve ogrenci kapsami |
| `STUDENT` | Ogrenci | Yalniz kendi profil ve akademik verisi |

`ASSISTANT_ADMIN` gecis roludur ve hedefte `OPERATIONS_STAFF` ile yer degistirir. `SYSTEM_ADMIN`
platform operasyonudur; musteri personası veya kurum yoneticisi degildir. `GUARDIAN` mevcut
route/session/UAT kapilari kaldirilana kadar gecis destekli runtime personasidir, yeni pazarlama
personasi degildir. Hedefte login yetkisi olmayan `StudentContact` bulunur; bu kayit da persona
sayilmaz. Guardian emekliligi ancak `DEC-20260801-01` envanter, yedek, onay ve gozlem kapilariyla
tamamlanir.

## Modul Sahipligi

Bu tablo Faz 1 icin tek guncel kapsam kilididir. Bir modulun durumu degisirse ayni degisiklikte
yolculuk matrisi, UAT senaryo iskeleti ve ilgili evidence checker/template guncellenir.

| Modul | Sahip agent | UAT kapsami | Kabul kilidi | Kapsam disi |
|---|---|---|---|---|
| Sistem yonetimi ve release kaniti | `ops_release_engineer` | UAT-SYS-01, UAT-SYS-02, UAT-SYS-03, UAT-SYS-04 | Kurum acma, lisans/status, audit/observability ve release evidence akislari staging/prod kanitini local/static PASS'ten ayirir. | Otomatik faturalama, satis CRM'i |
| Kurum operasyon paneli | `frontend_ux_engineer` + `backend_api_engineer` | UAT-KURUM-01, UAT-KURUM-02, UAT-KURUM-03, UAT-KURUM-04 | Kurulum, kisi/rol, donem/program/etut/devamsizlik isleri tenant/RBAC sozlesmesiyle calisir. | - |
| Optik sinav ve rapor/karne | `exam_reporting_engineer` | UAT-KURUM-05, UAT-KURUM-06 | TXT/DAT import, cevap anahtari, karantina, scoring, rapor snapshot ve PDF/Excel uretimi tekrar uretilebilir kanit verir. | - |
| Finans ve iletisim | `backend_api_engineer` + `messaging_integrations_engineer` | UAT-KURUM-07, UAT-KURUM-08 | Odeme/taksit takibi idempotenttir; duyuru, SMS disabled path, destek ve materyal akislari PII-safe evidence ile ayrilir. WhatsApp alt kapsami `WHATSAPP_ENABLED=false` ile default-off ve `CONTRACT_READY_EXTERNAL_NOT_RUN` durumundadir. | Odeme saglayici, fatura, makbuz entegrasyonu; WhatsApp inbound destek, medya ve auth teslimi |
| Ogretmen portali | `frontend_ux_engineer` + `tenant_security_reviewer` | UAT-TEACHER-01, UAT-TEACHER-02, UAT-TEACHER-03 | Ogretmen yalniz kendi sinif/ogrenci kapsaminda okur/yazar; negatif erisim 403 ile kanitlanir. | Tenantlar arasi gorunum |
| Ogrenci portali | `frontend_ux_engineer` + `tenant_security_reviewer` | UAT-STUDENT-01, UAT-STUDENT-02, UAT-STUDENT-03 | Ogrenci kendi profil, odev, devamsizlik, not, rapor, duyuru ve destek akisini kullanir; baska ogrenci verisi kapali kalir. | Ogrenci self-service kurum transferi |
| Veli portali (gecis) | `frontend_ux_engineer` + `tenant_security_reviewer` | UAT-GUARDIAN-01, UAT-GUARDIAN-02, UAT-GUARDIAN-03 | Mevcut runtime'da veli sadece bagli ogrenci ve izinli finans/rapor verisini gorur; bagli olmayan ogrenci ve kapali finans izni 403 olur. | Yeni guardian edinimi, veli self-service eslestirme |
| DB, RLS, PII ve evidence guardrail | `data_platform_engineer` + `privacy_governance_reviewer` | UAT-SYS-04, UAT-KURUM-02, UAT-KURUM-05, UAT-KURUM-06, UAT-KURUM-07, UAT-KURUM-08, UAT-TEACHER-03, UAT-STUDENT-03, UAT-GUARDIAN-03 | Tenant FK/RLS, audit redaction, bypass siniri, retention ve evidence hedefleri kod/test kapilarinda korunur. | Ham PII iceren evidence veya audit diff'i |

## Faz 1 Kabul Kriterleri

- V1 kapsam disi kararlar `docs/DECISIONS.md` `DEC-20260613-01` ile ayni kalir.
- Her UAT senaryosu yolculuk matrisi, senaryo iskeleti, evidence template, checker ve UAT rollback ekraninda gorunur.
- Her UAT senaryosu en az bir modul sahipligi satirina baglidir.
- `PASS`, `PARTIAL`, `CONTRACT_READY_EXTERNAL_NOT_RUN` ve `EXTERNAL_NOT_RUN` etiketleri local/statik kanit ile staging/prod kanitini karistirmaz.
- Kapsam genislemesi gerekiyorsa once yeni DEC acilir; bu dosya tek basina kapsam genisletmez.
- Hedef urun metni yalniz `docs/marketing-claims.md` icindeki guvenli ifadeleri kullanir; mevcut
  guardian runtime/UAT kaniti yeni guardian pazarlama vaadi sayilmaz.

## Yolculuk Matrisi

Bu matris mevcut runtime ve evidence borcunu gosterir. `GUARDIAN` satirlari gecis guvenligini
korur; hedef persona veya yeni musteri vaadi olusturmaz. `SYSTEM_ADMIN` satirlari da mevcut
operasyon yuzeyini belgeler; hedef control-plane ayriminin tamamlandigi anlamina gelmez.

| Persona | Adim | Durum | Repo kaniti | UAT senaryosu | Backlog |
|---|---|---|---|---|---|
| SYSTEM_ADMIN | Ortam saglik, audit ve observability ekranlarini acar | PARTIAL | `apps/web/app/(app)/sistem/**`, `apps/api/src/metrics/metrics.e2e.test.ts`, `apps/api/src/audit-log/audit-log.e2e.test.ts` | UAT-SYS-01 | Faz 9 canli dashboard kaniti |
| SYSTEM_ADMIN | Kurum listeler, arar, siralar ve sayfalar | PARTIAL | `apps/api/src/tenant/tenant.controller.e2e.test.ts`, `apps/web/e2e-next/login-next.spec.ts` | UAT-SYS-01 | Canli audit/observability dashboard kaniti UAT-SYS-01'i kapatir |
| SYSTEM_ADMIN | Kurum + ilk admin olusturur | PASS | `apps/api/src/tenant/tenant.service.test.ts`, `apps/api/src/tenant/tenant-store.test.ts`, `apps/web/e2e-next/login-next.spec.ts`, `apps/web/e2e-next/live-onboarding-next.spec.ts` | UAT-SYS-02 | Yok |
| SYSTEM_ADMIN | Lisans, plan, koltuk ve status yonetir | PASS | `apps/api/src/tenant/tenant.controller.e2e.test.ts`, `apps/api/src/context/request-context.middleware.test.ts` | UAT-SYS-03 | Yok |
| SYSTEM_ADMIN | Release kanitlarini ve rollback hedefini denetler | EXTERNAL_NOT_RUN | `docs/phase-6-production-readiness.md`, `scripts/check-prod-evidence.mjs`, `scripts/check-deployment-rollback-evidence.mjs`, `docs/evidence-templates/uat.example.json` | UAT-SYS-04 | Faz 9/Faz 10 staging kaniti |
| TENANT_ADMIN/ASSISTANT_ADMIN | Kurulum sihirbazinda kampus, seviye, sinif, ders ve donem hazirlar | PASS | `apps/web/app/(app)/kurum/kurulum/setup-wizard.tsx`, `apps/api/src/school/school.e2e.test.ts`, `apps/web/e2e-next/live-onboarding-next.spec.ts` | UAT-KURUM-01 | Yok |
| TENANT_ADMIN/ASSISTANT_ADMIN | Ogrenci, veli ve ogretmen kayitlarini yonetir | PASS | `apps/api/src/school/school.e2e.test.ts`, `apps/api/src/student/student-profile.e2e.test.ts`, `apps/web/e2e-next/login-next.spec.ts` | UAT-KURUM-02 | Yok |
| TENANT_ADMIN | Kullanici, rol ve kimlik davetlerini yonetir | PASS | `apps/api/src/user-management/user-management.e2e.test.ts`, `apps/api/src/identity-invitation/identity-invitation.e2e.test.ts`, `apps/web/e2e-next/live-onboarding-next.spec.ts` | UAT-KURUM-03 | Gate E UAT'i exact CI davranisina ve staging aktivasyon e-postasi/cleanup kanitina birlikte baglanir |
| TENANT_ADMIN/ASSISTANT_ADMIN | Donem, program, etut ve gunluk sinif yoklamasi islemlerini yurutur | PASS | `apps/api/src/program/schedule.e2e.test.ts`, `apps/api/src/program/study-session.e2e.test.ts`, `apps/api/src/attendance/attendance.e2e.test.ts` | UAT-KURUM-04 | Yok |
| TENANT_ADMIN/ASSISTANT_ADMIN | Sinav olusturur, cevap anahtari ve optik import zincirini yurutur | CONTRACT_READY_EXTERNAL_NOT_RUN | `apps/api/src/exam/exam.controller.e2e.test.ts`, `apps/api/src/exam/answer-key.controller.e2e.test.ts`, `apps/api/src/exam/raw-import.controller.e2e.test.ts`, `scripts/check-isem-optical-pipeline-evidence.mjs`, `scripts/check-live-exam-cycle-evidence.mjs` | UAT-KURUM-05 | Faz 4 `pnpm isem-optical-pipeline:evidence-check` ara kaniti ve `pnpm live:exam-cycle:check` staging kaniti |
| TENANT_ADMIN/ASSISTANT_ADMIN | Rapor/karne uretir ve indirir | CONTRACT_READY_EXTERNAL_NOT_RUN | `apps/api/src/report/report-generation.controller.e2e.test.ts`, `apps/worker/src/jobs/report-generation-job.test.ts`, `apps/worker/src/jobs/report-pdf-render-job.test.ts`, `apps/web/e2e-next/live-ui-worker-report-next.spec.ts`, `scripts/check-live-exam-cycle-evidence.mjs` | UAT-KURUM-06 | Faz 4 `pnpm live:exam-cycle:check` ve `pnpm live:ui-worker:smoke` staging kaniti |
| TENANT_ADMIN/ASSISTANT_ADMIN | Odeme plani ve taksit takibi yapar | PASS | `apps/api/src/payment/payment.e2e.test.ts`, `apps/api/src/http/idempotency.test.ts` | UAT-KURUM-07 | Odeme/fatura entegrasyonu `V1_OUT` |
| TENANT_ADMIN/ASSISTANT_ADMIN | Duyuru, SMS disabled path, destek ve materyal islemlerini yurutur | PASS | `apps/api/src/announcement/announcement.e2e.test.ts`, `apps/api/src/sms-batch/sms-batch.e2e.test.ts`, `apps/api/src/support-ticket/support-ticket.e2e.test.ts`, `apps/api/src/homework/homework.e2e.test.ts`, `packages/notification-adapter/src/index.test.ts`, `infra/notification-gateway/src/index.test.mjs`, `packages/db/prisma/migrations/20260808170000_add_whatsapp_consent_lifecycle/migration.sql`, `apps/api/src/whatsapp-consent/whatsapp-consent-store.test.ts`, `apps/web/app/(app)/kurum/duyurular/announcements-page.tsx`, `apps/web/e2e-next/data-table-mobile-contract-next.spec.ts`, `docs/DECISIONS.md` | UAT-KURUM-08 | Faz 6 repo kapsami kapandi; e-posta saglayici smoke Faz 9'da kalir. WhatsApp alt kapsami `CONTRACT_READY_EXTERNAL_NOT_RUN` ve default-off'tur; salt-okunur lifecycle gorunumu vardir. Retention/purge, izin grant/withdraw UI/API, send-time kontrol, outbound ledger, `ContactIdentity` numara yeniden tahsisi, keyed phone HMAC/rotasyon, staging DB sayım generator'ı, teslim uzlastirmasi ve provider smoke'u yoktur |
| TEACHER | Kendi sinif/ogrenci kapsaminda liste ve profil okur | PASS | `apps/api/src/me/me-access-matrix.e2e.test.ts`, `apps/api/src/app.e2e.test.ts` | UAT-TEACHER-01 | Yok |
| TEACHER | Programini, duyurularini, destek taleplerini ve odev materyallerini kullanir | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/support-ticket/support-ticket.e2e.test.ts`, `apps/api/src/homework/homework.e2e.test.ts` | UAT-TEACHER-02 | Yok |
| TEACHER | Kapsam disi ogrenci/sinif verisine erisemez | PASS | `apps/api/src/tenant/tenant-access.test.ts`, `apps/api/src/school/assert-teacher-assigned.test.ts`, `apps/api/src/report/report-generation.service.test.ts` | UAT-TEACHER-03 | Yok |
| STUDENT | Portalda profil, sinif/kayit gecmisi, odev, devamsizlik, not ve yetkili READY raporlarini okur | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/me/me-access-matrix.e2e.test.ts`, `apps/api/src/me/me-report-index.service.test.ts`, `apps/web/e2e-next/portal-report-panel-next.spec.ts` | UAT-STUDENT-01 | Yok |
| STUDENT | Kendi duyurusunu okundu isaretler ve destek talebi acar | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/support-ticket/support-ticket.e2e.test.ts` | UAT-STUDENT-02 | Yok |
| STUDENT | Baska ogrencinin verisini goremez | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/me/me-access-matrix.e2e.test.ts` | UAT-STUDENT-03 | Yok |
| GUARDIAN | Bagli ogrencilerini ve izin kapsaminda profil/READY rapor/odeme verisini gorur | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/payment/payment.e2e.test.ts`, `apps/api/src/me/me-report-index.service.test.ts`, `apps/web/e2e-next/student-guardian-portal-contract-next.spec.ts` | UAT-GUARDIAN-01 | Yok |
| GUARDIAN | Duyuru okundu, bildirim tercihi ve destek talebi akisini yurutur | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/announcement/announcement.e2e.test.ts`, `apps/api/src/support-ticket/support-ticket.e2e.test.ts` | UAT-GUARDIAN-02 | E-posta/push saglayici smoke Faz 9 |
| GUARDIAN | Bagli olmayan ogrenciye veya kapali finans iznine erisemez | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/payment/payment.e2e.test.ts`, `apps/api/src/tenant/tenant-access.test.ts` | UAT-GUARDIAN-03 | Yok |

## UAT Senaryo Iskeleti

| ID | Amaç | Minimum kanit | Durum |
|---|---|---|---|
| UAT-SYS-01 | Sistem admin sistem paneli, kurum listesi ve audit/observability ekranlarini acar | `pnpm --filter @o-okul/web test:e2e`, `pnpm observability:uat:check` | PARTIAL |
| UAT-SYS-02 | Sistem admin kurum ve ilk admin olusturur; yeni admin login olur | `apps/api/src/tenant/tenant.service.test.ts`, `pnpm live:onboarding:smoke` | PASS |
| UAT-SYS-03 | Lisansi biten tenant read-only kalir; yazma 403 doner | `apps/api/src/tenant/tenant.controller.e2e.test.ts` | PASS |
| UAT-SYS-04 | Release, evidence ve rollback zinciri staging raporuyla gecilir | `pnpm prod:evidence:check`, `pnpm deployment:rollback:check`, `pnpm uat:check` | EXTERNAL_NOT_RUN |
| UAT-KURUM-01 | Kurum admin sifir veriden kurulum sihirbazini tamamlar | `apps/web/app/(app)/kurum/kurulum/setup-wizard.tsx`, `pnpm live:onboarding:smoke` | PASS |
| UAT-KURUM-02 | Kisi kaydi ve iliski yonetimi calisir | `pnpm --filter @o-okul/api exec vitest run src/school/school.e2e.test.ts src/student/student-profile.e2e.test.ts` | PASS |
| UAT-KURUM-03 | Kullanici ve davet akisi calisir | `pnpm --filter @o-okul/api exec vitest run src/user-management/user-management.e2e.test.ts src/identity-invitation/identity-invitation.e2e.test.ts` + `pnpm live:onboarding:smoke`; staging aktivasyon e-postasi ve sentetik tenant/session cleanup artifact'i zorunludur | PASS |
| UAT-KURUM-04 | Donem, program, etut ve idempotent gunluk sinif yoklamasi calisir | `pnpm --filter @o-okul/api exec vitest run src/program src/attendance` | PASS |
| UAT-KURUM-05 | LGS, TYT ve bagli AYT sinavi; surumlu cevap anahtari, iptal/duzeltme karari, optik import, karantina ve standart sapmasiz deneme puani akisi hedef SHA'da calisir | `pnpm isem-optical-pipeline:evidence-check`, `pnpm live:exam-cycle:check`, `pnpm live:ui-worker:smoke` | CONTRACT_READY_EXTERNAL_NOT_RUN |
| UAT-KURUM-06 | Ayni immutable snapshot ogrenci satiri tekli/toplu web, kurum PDF'i, tekli/toplu karne PDF'i ve Excel'de ayni Basari %, Net/Soru ve Deneme puanini verir; resmi olmayan puan uyarisi gorunur | `pnpm report-generation:smoke`, `pnpm live:exam-cycle:check`, `pnpm live:ui-worker:smoke` | CONTRACT_READY_EXTERNAL_NOT_RUN |
| UAT-KURUM-07 | Odeme plani/taksit, ogrenci import commit, ogretmen import commit, bireysel/toplu ogrenci kayit yenileme ve transfer, sinav create/publish/participant, parser config approval, optik template create/apply, cevap anahtari create/import/publish, raw import enqueue/quarantine resolve, rapor uretim enqueue, duyuru teslimi, destek ek/yorum, odev materyal dosyasi/atamasi, backup/restore job ve SMS batch yazimlari idempotent calisir | `pnpm --filter @o-okul/api exec vitest run src/payment src/http/idempotency.test.ts src/app.e2e.test.ts src/school/school.e2e.test.ts src/exam/exam.controller.e2e.test.ts src/exam/parser-config.controller.e2e.test.ts src/exam/optical-form-template.controller.e2e.test.ts src/exam/answer-key.controller.e2e.test.ts src/exam/raw-import.controller.e2e.test.ts src/report/report-generation.controller.e2e.test.ts src/announcement/announcement.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts src/homework/homework.e2e.test.ts src/operations/backup-restore.controller.e2e.test.ts src/sms-batch/sms-batch.e2e.test.ts`, `pnpm idempotency:inventory:check`, `scripts/check-idempotency-inventory.mjs` | PASS |
| UAT-KURUM-08 | Duyuru, SMS kapalı yol, destek ve materyal isleri calisir; WhatsApp default-off kalir | Hedefli API duyuru/SMS/destek/materyal testleri, `pnpm sms:smoke` disabled-path sonucu ve `apps/web/e2e-next/data-table-mobile-contract-next.spec.ts` salt-okunur WhatsApp lifecycle gorunumunu kanitlar. Faz 6 repo davranisi `PASS`tir. Gercek e-posta provider kaniti Faz 9'a, WhatsApp retention/purge, izin yonetimi, send-time kontrol, ledger, provider ve staging kaniti kullanici karariyla sonraya birakilmistir; WhatsApp alt kapsami `DEC-20260808-01` uyarinca `WHATSAPP_ENABLED=false` ve `CONTRACT_READY_EXTERNAL_NOT_RUN` kalir. | PASS |
| UAT-TEACHER-01 | Ogretmen kendi kapsaminda ogrenci ve rapor gorur | `pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts src/report/report-generation.service.test.ts` | PASS |
| UAT-TEACHER-02 | Ogretmen destek/duyuru/odev gunluk islerini yurutur | `pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/homework/homework.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts` | PASS |
| UAT-TEACHER-03 | Ogretmen kapsam disi yazma/okuma denemesinde 403 alir | `pnpm --filter @o-okul/api exec vitest run src/tenant src/school/assert-teacher-assigned.test.ts` | PASS |
| UAT-STUDENT-01 | Ogrenci portalda kendi profil, odev, devamsizlik ve raporunu gorur | `pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/me/me-access-matrix.e2e.test.ts` | PASS |
| UAT-STUDENT-02 | Ogrenci duyuru okur ve destek talebi acar | `pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts` | PASS |
| UAT-STUDENT-03 | Ogrenci baska subject verisine erisemez | `pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts` | PASS |
| UAT-GUARDIAN-01 | Veli bagli ogrenci profil/rapor/odeme verisini gorur | `pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/payment/payment.e2e.test.ts` | PASS |
| UAT-GUARDIAN-02 | Veli duyuru, bildirim tercihi ve destek akisini yurutur | `pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/announcement/announcement.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts` | PASS |
| UAT-GUARDIAN-03 | Veli bagli olmayan ogrenciye veya kapali finans iznine erisemez | `pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/payment/payment.e2e.test.ts` | PASS |

## Backlog Baglantisi

- Faz 2: Yoğun listelerde performans, tablet/a11y ve karne gorsel kabul esigi. Repo ici ilk a11y kapisi:
  `pnpm web:a11y:check` landing, login ve kurum dashboard shell'ini
  320/375/414/768/1024/1440 viewport matrisi içinde tarar; kritik axe ihlallerini ve yatay
  tasmayi engeller. Landing ilk ekran hiyerarşisi ayrıca 1280x800 landing fold viewport ile
  korunur.
  Landing performans kapisi `pnpm web:performance:check` ile Optik → Rapor → Portal yüzeyini ve server/no-query
  marketing route sozlesmesini dogrular.
  `pnpm web:ux-baseline:check` bu a11y, responsive overflow, landing performans ve iş akışı sozlesmelerini
  tek repo contract olarak kilitler.
- Faz 4: `UAT-KURUM-05` icin `scripts/check-isem-optical-pipeline-evidence.mjs` iSEM cevap
  anahtari, optik TXT, raw import arsivi, evaluation ve report snapshot ara kanitini tutar.
  iSEM/3D/MUBA OPTIK-7108 repo fixture tarafi gercek Excel/TXT ornekleriyle sabitlenmistir:
  `apps/api/src/exam/answer-key-excel-import.service.test.ts` 90 soruluk cevap anahtarini ve
  B kitapcik permutasyonunu, `apps/worker/src/jobs/optik-7108-real-pipeline.test.ts`
  iSEM, 3D ve MUBA TXT parse, A/B kitapcik hizalama ve ornek skor zincirini dogrular.
  Kullanici referans kolonlariyla eklenen tek OPTIK FORM 129, tek YANIT YAYINLARI ve OPTIK 840 LGS
  fiziksel presetleri sentetik sabit satirlarla kolon, kitapcik ve mantiksal 120/160/90 soru sirasi
  seviyesinde dogrulanir. `apps/api/src/exam/answer-key-excel-import.service.test.ts` sentetik
  Lorem Ipsum workbook'larla 120 TYT ve 160 AYT dry-run/import, bolum bazli soru dagilimi ve
  ters B kitapcik permutasyonunu; `apps/worker/src/jobs/tyt-ayt-placeholder-pipeline.test.ts`
  iki fiziksel presetin TYT/AYT senaryolari icin iki fixed-width satir, iki katilimci, A/B hizalama, deterministik puanlama
  ve iki ogrencili READY snapshot zincirini dogrular. Yeni LGS/TYT/AYT sonucunda legacy
  `estimatedRawScore` ve `standardScore` uretilmez; `TR-LGS-2026-NOSD-V1` veya
  `TR-YKS-2026-NOSD-V1` profiliyle `officialComparable:false` deneme puani uretilir. Evaluation,
  parser cevap sayisi ile cevap anahtari aktif+iptal fiziksel soru sayisini
  esit ister ve LGS/TYT/AYT icin sirasiyla 90/120/160 soru kuralini fail-closed uygular.
  Bu sentetik in-memory job composition kaniti gercek Postgres
  evaluation/report persistence, gercek uretici TXT/DAT fixture'i,
  resmi MEB/OSYM puan kaniti, PDF/portal gorsel kabulu veya staging/prod cycle kaniti degildir.
  `UAT-KURUM-05` ve `UAT-KURUM-06` icin `scripts/check-live-exam-cycle-evidence.mjs`
  iSEM cevap anahtari, optik pipeline, raw import, report-generation ve mock'suz
  `apps/web/e2e-next/live-ui-worker-report-next.spec.ts` kanitlarini tek JSON'da baglar.
  Gercek staging kanit kosusu hala bekliyor.
- Faz 7: Landing repo yuzeyi `apps/web/app/page.tsx` içindeki PII içermeyen
  Optik → Rapor → Portal iş akışıyla hazır. Sentetik hero asset render dışı tutulur; dosyalar
  açık silme onayı olmadan geri dönüş olanağı için korunur.
  `UAT-SYS-02` ve `UAT-KURUM-01` icin `apps/web/e2e-next/live-onboarding-next.spec.ts`
  ve `pnpm live:onboarding:smoke` exact `bb2779bc1087a150b648407385e3cee1d0122692` staging
  runtime üzerinde gerçek activation provider teslimiyle `PASS`.
- Faz 9: `UAT-SYS-04`, saglayici smoke'lari, Traefik HTTPS, observability ve evidence zinciri.
- Faz 10: Bu matristen tureyen rol bazli staging/prod UAT raporu, `pnpm pilot:check`
  ile dogrulanan pilot kurum kapanisi ve `pnpm go-live:check` ile final karar paketi.
