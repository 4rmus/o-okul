# V1 Urun Yolculuklari ve UAT Matrisi

Kaynak: `claudedocs/prod-plan-2026-06-12.md` Faz 1.

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
`TXT/DAT optik -> guvenilir rapor/karne -> veli/ogrenci gorunumu -> odeme ve iletisim takibi`
dongusudur.

V1 kapsam disi maddeler:

- Salon/oturma plani ve sinav salonu operasyonu: `V1_OUT`.
- Online deneme oturumu ve canli sinav izleme: `V1_OUT`.
- Odeme saglayici, fatura ve makbuz entegrasyonu: `V1_OUT`; finans modulu alacak/taksit takibidir.
- OMR goruntu tarama veya fotograf uzerinden optik okuma: `V1_OUT`; TXT/DAT import korunur.

Karar kaydi: `docs/DECISIONS.md` `DEC-20260613-01`.

## Modul Sahipligi

Bu tablo Faz 1 icin tek guncel kapsam kilididir. Bir modulun durumu degisirse ayni degisiklikte
yolculuk matrisi, UAT senaryo iskeleti ve ilgili evidence checker/template guncellenir.

| Modul | Sahip agent | UAT kapsami | Kabul kilidi | Kapsam disi |
|---|---|---|---|---|
| Sistem yonetimi ve release kaniti | `ops_release_engineer` | UAT-SYS-01, UAT-SYS-02, UAT-SYS-03, UAT-SYS-04 | Kurum acma, lisans/status, audit/observability ve release evidence akislari staging/prod kanitini local/static PASS'ten ayirir. | Otomatik faturalama, satis CRM'i |
| Kurum operasyon paneli | `frontend_ux_engineer` + `backend_api_engineer` | UAT-KURUM-01, UAT-KURUM-02, UAT-KURUM-03, UAT-KURUM-04 | Kurulum, kisi/rol, donem/program/etut/devamsizlik isleri tenant/RBAC sozlesmesiyle calisir. | Salon/oturma plani |
| Optik sinav ve rapor/karne | `exam_reporting_engineer` | UAT-KURUM-05, UAT-KURUM-06 | TXT/DAT import, cevap anahtari, karantina, scoring, rapor snapshot ve PDF/Excel uretimi tekrar uretilebilir kanit verir. | Online deneme, OMR/fotograf optik okuma |
| Finans ve iletisim | `backend_api_engineer` + `messaging_integrations_engineer` | UAT-KURUM-07, UAT-KURUM-08 | Odeme/taksit takibi idempotenttir; duyuru, SMS, destek ve materyal akislari PII-safe evidence ile ayrilir. | Odeme saglayici, fatura, makbuz entegrasyonu |
| Ogretmen portali | `frontend_ux_engineer` + `tenant_security_reviewer` | UAT-TEACHER-01, UAT-TEACHER-02, UAT-TEACHER-03 | Ogretmen yalniz kendi sinif/ogrenci kapsaminda okur/yazar; negatif erisim 403 ile kanitlanir. | Tenantlar arasi gorunum |
| Ogrenci portali | `frontend_ux_engineer` + `tenant_security_reviewer` | UAT-STUDENT-01, UAT-STUDENT-02, UAT-STUDENT-03 | Ogrenci kendi profil, odev, devamsizlik, not, rapor, duyuru ve destek akisini kullanir; baska ogrenci verisi kapali kalir. | Ogrenci self-service kurum transferi |
| Veli portali | `frontend_ux_engineer` + `tenant_security_reviewer` | UAT-GUARDIAN-01, UAT-GUARDIAN-02, UAT-GUARDIAN-03 | Veli sadece bagli ogrenci ve izinli finans/rapor verisini gorur; bagli olmayan ogrenci ve kapali finans izni 403 olur. | Veli self-service eslestirme |
| DB, RLS, PII ve evidence guardrail | `data_platform_engineer` + `privacy_governance_reviewer` | UAT-SYS-04, UAT-KURUM-02, UAT-KURUM-05, UAT-KURUM-06, UAT-KURUM-07, UAT-KURUM-08, UAT-TEACHER-03, UAT-STUDENT-03, UAT-GUARDIAN-03 | Tenant FK/RLS, audit redaction, bypass siniri, retention ve evidence hedefleri kod/test kapilarinda korunur. | Ham PII iceren evidence veya audit diff'i |

## Faz 1 Kabul Kriterleri

- V1 kapsam disi kararlar `docs/DECISIONS.md` `DEC-20260613-01` ile ayni kalir.
- Her UAT senaryosu yolculuk matrisi, senaryo iskeleti, evidence template, checker ve UAT rollback ekraninda gorunur.
- Her UAT senaryosu en az bir modul sahipligi satirina baglidir.
- `PASS`, `PARTIAL`, `CONTRACT_READY_EXTERNAL_NOT_RUN` ve `EXTERNAL_NOT_RUN` etiketleri local/statik kanit ile staging/prod kanitini karistirmaz.
- Kapsam genislemesi gerekiyorsa once yeni DEC acilir; bu dosya tek basina kapsam genisletmez.

## Yolculuk Matrisi

| Persona | Adim | Durum | Repo kaniti | UAT senaryosu | Backlog |
|---|---|---|---|---|---|
| SYSTEM_ADMIN | Ortam saglik, audit ve observability ekranlarini acar | PARTIAL | `apps/web/app/(app)/sistem/**`, `apps/api/src/metrics/metrics.e2e.test.ts`, `apps/api/src/audit-log/audit-log.e2e.test.ts` | UAT-SYS-01 | Faz 9 canli dashboard kaniti |
| SYSTEM_ADMIN | Kurum listeler, arar, siralar ve sayfalar | PARTIAL | `apps/api/src/tenant/tenant.controller.e2e.test.ts`, `apps/web/e2e-next/login-next.spec.ts` | UAT-SYS-01 | Canli audit/observability dashboard kaniti UAT-SYS-01'i kapatir |
| SYSTEM_ADMIN | Kurum + ilk admin olusturur | PARTIAL | `apps/api/src/tenant/tenant.service.test.ts`, `apps/api/src/tenant/tenant-store.test.ts`, `apps/web/e2e-next/login-next.spec.ts`, `apps/web/e2e-next/live-onboarding-next.spec.ts` | UAT-SYS-02 | Faz 7 `pnpm live:onboarding:smoke` staging kaniti |
| SYSTEM_ADMIN | Lisans, plan, koltuk ve status yonetir | PASS | `apps/api/src/tenant/tenant.controller.e2e.test.ts`, `apps/api/src/context/request-context.middleware.test.ts` | UAT-SYS-03 | Yok |
| SYSTEM_ADMIN | Release kanitlarini ve rollback hedefini denetler | EXTERNAL_NOT_RUN | `docs/phase-6-production-readiness.md`, `scripts/check-prod-evidence.mjs`, `scripts/check-deployment-rollback-evidence.mjs`, `docs/evidence-templates/uat.example.json` | UAT-SYS-04 | Faz 9/Faz 10 staging kaniti |
| TENANT_ADMIN/ASSISTANT_ADMIN | Kurulum sihirbazinda kampus, seviye, sinif, ders ve donem hazirlar | PARTIAL | `apps/web/app/(app)/kurum/kurulum/setup-wizard.tsx`, `apps/api/src/school/school.e2e.test.ts`, `apps/web/e2e-next/live-onboarding-next.spec.ts` | UAT-KURUM-01 | Faz 7 `pnpm live:onboarding:smoke` staging kaniti |
| TENANT_ADMIN/ASSISTANT_ADMIN | Ogrenci, veli ve ogretmen kayitlarini yonetir | PASS | `apps/api/src/school/school.e2e.test.ts`, `apps/api/src/student/student-profile.e2e.test.ts`, `apps/web/e2e-next/login-next.spec.ts` | UAT-KURUM-02 | Yok |
| TENANT_ADMIN | Kullanici, rol ve kimlik davetlerini yonetir | PARTIAL | `apps/api/src/user-management/user-management.e2e.test.ts`, `apps/api/src/identity-invitation/identity-invitation.e2e.test.ts` | UAT-KURUM-03 | Saglayici e-posta teslim kaniti Faz 9 |
| TENANT_ADMIN/ASSISTANT_ADMIN | Donem, program, etut ve devamsizlik islemlerini yurutur | PASS | `apps/api/src/program/schedule.e2e.test.ts`, `apps/api/src/program/study-session.e2e.test.ts`, `apps/api/src/attendance/attendance.e2e.test.ts` | UAT-KURUM-04 | Yok |
| TENANT_ADMIN/ASSISTANT_ADMIN | Sinav olusturur, cevap anahtari ve optik import zincirini yurutur | CONTRACT_READY_EXTERNAL_NOT_RUN | `apps/api/src/exam/exam.controller.e2e.test.ts`, `apps/api/src/exam/answer-key.controller.e2e.test.ts`, `apps/api/src/exam/raw-import.controller.e2e.test.ts`, `scripts/check-isem-optical-pipeline-evidence.mjs`, `scripts/check-live-exam-cycle-evidence.mjs` | UAT-KURUM-05 | Faz 4 `pnpm isem-optical-pipeline:evidence-check` ara kaniti ve `pnpm live:exam-cycle:check` staging kaniti |
| TENANT_ADMIN/ASSISTANT_ADMIN | Rapor/karne uretir ve indirir | CONTRACT_READY_EXTERNAL_NOT_RUN | `apps/api/src/report/report-generation.controller.e2e.test.ts`, `apps/worker/src/jobs/report-generation-job.test.ts`, `apps/worker/src/jobs/report-pdf-render-job.test.ts`, `apps/web/e2e-next/live-ui-worker-report-next.spec.ts`, `scripts/check-live-exam-cycle-evidence.mjs` | UAT-KURUM-06 | Faz 4 `pnpm live:exam-cycle:check` ve `pnpm live:ui-worker:smoke` staging kaniti |
| TENANT_ADMIN/ASSISTANT_ADMIN | Odeme plani ve taksit takibi yapar | PASS | `apps/api/src/payment/payment.e2e.test.ts`, `apps/api/src/http/idempotency.test.ts` | UAT-KURUM-07 | Odeme/fatura entegrasyonu `V1_OUT` |
| TENANT_ADMIN/ASSISTANT_ADMIN | Duyuru, SMS sablonu, destek ve materyal islemlerini yurutur | PARTIAL | `apps/api/src/announcement/announcement.e2e.test.ts`, `apps/api/src/sms-batch/sms-batch.e2e.test.ts`, `apps/api/src/support-ticket/support-ticket.e2e.test.ts`, `apps/api/src/homework/homework.e2e.test.ts` | UAT-KURUM-08 | SMS/e-posta saglayici smoke Faz 9 |
| TEACHER | Kendi sinif/ogrenci kapsaminda liste ve profil okur | PASS | `apps/api/src/me/me-access-matrix.e2e.test.ts`, `apps/api/src/app.e2e.test.ts` | UAT-TEACHER-01 | Yok |
| TEACHER | Programini, duyurularini, destek taleplerini ve odev materyallerini kullanir | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/support-ticket/support-ticket.e2e.test.ts`, `apps/api/src/homework/homework.e2e.test.ts` | UAT-TEACHER-02 | Yok |
| TEACHER | Kapsam disi ogrenci/sinif verisine erisemez | PASS | `apps/api/src/tenant/tenant-access.test.ts`, `apps/api/src/school/assert-teacher-assigned.test.ts`, `apps/api/src/report/report-generation.service.test.ts` | UAT-TEACHER-03 | Yok |
| STUDENT | Portalda profil, sinif/kayit gecmisi, odev, devamsizlik, not ve rapor okur | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/me/me-access-matrix.e2e.test.ts`, `apps/web/app/(app)/portals/student-portal-page.tsx` | UAT-STUDENT-01 | Yok |
| STUDENT | Kendi duyurusunu okundu isaretler ve destek talebi acar | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/support-ticket/support-ticket.e2e.test.ts` | UAT-STUDENT-02 | Yok |
| STUDENT | Baska ogrencinin verisini goremez | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/me/me-access-matrix.e2e.test.ts` | UAT-STUDENT-03 | Yok |
| GUARDIAN | Bagli ogrencilerini ve izin kapsaminda profil/rapor/odeme verisini gorur | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/payment/payment.e2e.test.ts`, `apps/web/app/(app)/portals/guardian-portal-page.tsx` | UAT-GUARDIAN-01 | Yok |
| GUARDIAN | Duyuru okundu, bildirim tercihi ve destek talebi akisini yurutur | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/announcement/announcement.e2e.test.ts`, `apps/api/src/support-ticket/support-ticket.e2e.test.ts` | UAT-GUARDIAN-02 | E-posta/push saglayici smoke Faz 9 |
| GUARDIAN | Bagli olmayan ogrenciye veya kapali finans iznine erisemez | PASS | `apps/api/src/app.e2e.test.ts`, `apps/api/src/payment/payment.e2e.test.ts`, `apps/api/src/tenant/tenant-access.test.ts` | UAT-GUARDIAN-03 | Yok |

## UAT Senaryo Iskeleti

| ID | Amaç | Minimum kanit | Durum |
|---|---|---|---|
| UAT-SYS-01 | Sistem admin sistem paneli, kurum listesi ve audit/observability ekranlarini acar | `pnpm --filter @uzman-hocam/web test:e2e`, `pnpm observability:uat:check` | PARTIAL |
| UAT-SYS-02 | Sistem admin kurum ve ilk admin olusturur; yeni admin login olur | `apps/api/src/tenant/tenant.service.test.ts`, `pnpm live:onboarding:smoke` | PARTIAL |
| UAT-SYS-03 | Lisansi biten tenant read-only kalir; yazma 403 doner | `apps/api/src/tenant/tenant.controller.e2e.test.ts` | PASS |
| UAT-SYS-04 | Release, evidence ve rollback zinciri staging raporuyla gecilir | `pnpm prod:evidence:check`, `pnpm deployment:rollback:check`, `pnpm uat:check` | EXTERNAL_NOT_RUN |
| UAT-KURUM-01 | Kurum admin sifir veriden kurulum sihirbazini tamamlar | `apps/web/app/(app)/kurum/kurulum/setup-wizard.tsx`, `pnpm live:onboarding:smoke` | PARTIAL |
| UAT-KURUM-02 | Kisi kaydi ve iliski yonetimi calisir | `pnpm --filter @uzman-hocam/api exec vitest run src/school/school.e2e.test.ts src/student/student-profile.e2e.test.ts` | PASS |
| UAT-KURUM-03 | Kullanici ve davet akisi calisir | `pnpm --filter @uzman-hocam/api exec vitest run src/user-management/user-management.e2e.test.ts src/identity-invitation/identity-invitation.e2e.test.ts` | PARTIAL |
| UAT-KURUM-04 | Donem, program, etut ve devamsizlik isleri calisir | `pnpm --filter @uzman-hocam/api exec vitest run src/program src/attendance` | PASS |
| UAT-KURUM-05 | Sinav, cevap anahtari, optik import ve karantina operator akisi calisir | `pnpm isem-optical-pipeline:evidence-check`, `pnpm live:exam-cycle:check`, `pnpm live:ui-worker:smoke` | CONTRACT_READY_EXTERNAL_NOT_RUN |
| UAT-KURUM-06 | Rapor, karne PDF/Excel ve portal gorunumu calisir | `pnpm report-generation:smoke`, `pnpm live:exam-cycle:check`, `pnpm live:ui-worker:smoke` | CONTRACT_READY_EXTERNAL_NOT_RUN |
| UAT-KURUM-07 | Odeme plani/taksit, ogrenci import commit, ogretmen import commit, bireysel/toplu ogrenci kayit yenileme ve transfer, sinav create/publish/participant, parser config approval, optik template create/apply, cevap anahtari create/import/publish, raw import enqueue/quarantine resolve, rapor uretim enqueue, duyuru teslimi, destek ek/yorum, odev materyal dosyasi/atamasi, backup/restore job ve SMS batch yazimlari idempotent calisir | `pnpm --filter @uzman-hocam/api exec vitest run src/payment src/http/idempotency.test.ts src/app.e2e.test.ts src/school/school.e2e.test.ts src/exam/exam.controller.e2e.test.ts src/exam/parser-config.controller.e2e.test.ts src/exam/optical-form-template.controller.e2e.test.ts src/exam/answer-key.controller.e2e.test.ts src/exam/raw-import.controller.e2e.test.ts src/report/report-generation.controller.e2e.test.ts src/announcement/announcement.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts src/homework/homework.e2e.test.ts src/operations/backup-restore.controller.e2e.test.ts src/sms-batch/sms-batch.e2e.test.ts`, `pnpm idempotency:inventory:check`, `scripts/check-idempotency-inventory.mjs` | PASS |
| UAT-KURUM-08 | Duyuru, SMS, destek ve materyal isleri calisir | `pnpm notification:smoke`, `pnpm sms:smoke`, `pnpm upload-av:check` | PARTIAL |
| UAT-TEACHER-01 | Ogretmen kendi kapsaminda ogrenci ve rapor gorur | `pnpm --filter @uzman-hocam/api exec vitest run src/me/me-access-matrix.e2e.test.ts src/report/report-generation.service.test.ts` | PASS |
| UAT-TEACHER-02 | Ogretmen destek/duyuru/odev gunluk islerini yurutur | `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts src/homework/homework.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts` | PASS |
| UAT-TEACHER-03 | Ogretmen kapsam disi yazma/okuma denemesinde 403 alir | `pnpm --filter @uzman-hocam/api exec vitest run src/tenant src/school/assert-teacher-assigned.test.ts` | PASS |
| UAT-STUDENT-01 | Ogrenci portalda kendi profil, odev, devamsizlik ve raporunu gorur | `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts src/me/me-access-matrix.e2e.test.ts` | PASS |
| UAT-STUDENT-02 | Ogrenci duyuru okur ve destek talebi acar | `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts` | PASS |
| UAT-STUDENT-03 | Ogrenci baska subject verisine erisemez | `pnpm --filter @uzman-hocam/api exec vitest run src/me/me-access-matrix.e2e.test.ts` | PASS |
| UAT-GUARDIAN-01 | Veli bagli ogrenci profil/rapor/odeme verisini gorur | `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts src/payment/payment.e2e.test.ts` | PASS |
| UAT-GUARDIAN-02 | Veli duyuru, bildirim tercihi ve destek akisini yurutur | `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts src/announcement/announcement.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts` | PASS |
| UAT-GUARDIAN-03 | Veli bagli olmayan ogrenciye veya kapali finans iznine erisemez | `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts src/payment/payment.e2e.test.ts` | PASS |

## Backlog Baglantisi

- Faz 2: Yoğun listelerde performans, tablet/a11y ve karne gorsel kabul esigi. Repo ici ilk a11y kapisi:
  `pnpm web:a11y:check` landing, login, kurum dashboard shell'i ve 768x1024 tablet viewport'ta
  kritik axe ihlallerini ve yatay tasmayi tarar.
  Landing performans kapisi `pnpm web:performance:check` ile WebP hero asset butcesini ve server/no-query
  marketing route sozlesmesini dogrular.
  `pnpm web:ux-baseline:check` bu a11y, tablet overflow, landing performans ve asset sozlesmelerini
  tek repo contract olarak kilitler.
- Faz 4: `UAT-KURUM-05` icin `scripts/check-isem-optical-pipeline-evidence.mjs` iSEM cevap
  anahtari, optik TXT, raw import arsivi, evaluation ve report snapshot ara kanitini tutar.
  iSEM/OPTIK-7108 repo fixture tarafi gercek Excel/TXT ornekleriyle sabitlenmistir:
  `apps/api/src/exam/answer-key-excel-import.service.test.ts` 90 soruluk cevap anahtarini ve
  B kitapcik permutasyonunu, `apps/worker/src/jobs/optik-7108-real-pipeline.test.ts`
  254 satirlik TXT parse, A/B kitapcik hizalama ve ornek skor zincirini dogrular.
  `UAT-KURUM-05` ve `UAT-KURUM-06` icin `scripts/check-live-exam-cycle-evidence.mjs`
  iSEM cevap anahtari, optik pipeline, raw import, report-generation ve mock'suz
  `apps/web/e2e-next/live-ui-worker-report-next.spec.ts` kanitlarini tek JSON'da baglar.
  Gercek staging kanit kosusu hala bekliyor.
- Faz 7: Landing repo yuzeyi `apps/web/app/page.tsx` ve `apps/web/public/images/landing-hero-education-ops.png`
  ile hazir. `UAT-SYS-02` ve `UAT-KURUM-01` icin `apps/web/e2e-next/live-onboarding-next.spec.ts`
  ve `pnpm live:onboarding:smoke` hazir; staging kanit kosusu bekliyor.
- Faz 9: `UAT-SYS-04`, saglayici smoke'lari, Traefik HTTPS, observability ve evidence zinciri.
- Faz 10: Bu matristen tureyen rol bazli staging/prod UAT raporu, `pnpm pilot:check`
  ile dogrulanan pilot kurum kapanisi ve `pnpm go-live:check` ile final karar paketi.
