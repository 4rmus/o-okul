# Architecture Improvement Plan - 2026-06-21

## Kisa Verdict

Repo, production-bound multi-tenant egitim SaaS beklentisine gore olgun bir iskelete sahip:
rol bazli ekranlar, RLS check'leri, UAT matrisi, evidence template'leri ve smoke kapilari var.
Kalan ana risk, "kapilar var" ile "gercek staging/prod ve sozlesme kalitesi kanitlandi"
ayriminin bazi alanlarda hala kapanmamis olmasi.

Bu planin ilk fazi dusuk riskli gate sertlestirme, karar netlestirme ve gercek iSEM
fixture'inin kanit sozlesmesine baglanmasi uzerinden baslar. DB migration, OpenAPI schema
uretimi ve staging/prod evidence kosulari daha yuksek riskli oldugu icin ayri fazlara
bolunmustur.

## Kapsam Kilidi ve Varsayimlar

- V1 kapsam kilidi `docs/product-journeys-v1.md` ve `docs/DECISIONS.md` icindeki
  `DEC-20260613-01` kararidir: TXT/DAT optik import, rapor/karne, portallar,
  odeme/taksit takibi, iletisim ve evidence zinciri.
- Salon/oturma plani, online deneme oturumu, odeme saglayici/fatura/makbuz entegrasyonu
  ve OMR/fotograf optik okuma bu planla acilmaz; gerekirse yeni DEC gerekir.
- iSEM dosyalari kapsam genisletme degil, `OPEN-20260529-03` icin gercek format fixture
  ve staging evidence girdisidir.
- Lokal/static PASS, fixture testi, live smoke, staging/prod evidence ve pilot kaniti
  ayni sey degildir; release karari bu seviyeleri karistirmamalidir.

## Baslangic Kaniti

- Branch: `main`
- Worktree: bu guncelleme sirasinda kirliydi; mevcut web/a11y degisikliklerine dokunulmadan
  plan, karar, OpenAPI ve DB/FK dosyalari scoped olarak guncellendi.
- Node: `v24.15.0`, repo beklentisi `>=22` ile uyumlu.
- pnpm: NVM/Corepack yolu `11.5.0` donduruyor; PATH'teki `/Users/arair/Library/pnpm/pnpm`
  standalone shim'i `11.5.0/bin/pnpm ENOENT` ile bozuk. Dogrulama komutlari bu turda
  `corepack pnpm` veya `/Users/arair/.nvm/versions/node/v24.15.0/bin/pnpm` ile kosulmalidir.
- Agent orkestrasyonu: `product_scope_planner`, `exam_reporting_engineer`,
  `tenant_security_reviewer`, `qa_verification_engineer` ve `backend_api_engineer`
  read-only calisti; ana agent entegrasyon ve scoped dosya guncellemelerini sahiplendi.
- iSEM cevap anahtari: `ornek-veriler/iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx`,
  sha256 `cc39c0b606616e44945e46372924bbcffe5fa3702926c2a9faa6f0317ad1b08f`.
- iSEM optik TXT: `ornek-veriler/iSEM .txt`,
  sha256 `5b922f071055ceb99fc1f72f97fa48814d1ab6b87ad1558db7a284dd8d89c3db`.

## iSEM Gercek Veri Ozeti

| Kaynak | Gercek | Plan Etkisi |
| --- | --- | --- |
| Cevap anahtari Excel | Tek sheet `Detaylı Cevap Anahtarı`, `A1:G91`, 90 soru. Kolonlar: `BÖLÜM`, `SORU NO`, `B KARŞILIĞI`, `CEVAP`, `KAZANIM`, `KONU`, `BRANŞ`. | Excel import kabul kriteri artik 90 soru, 6 brans ve B kitapcik permutasyonunu sayisal dogrular. |
| Brans dagilimi | Turkce 20, Inkilap 10, Din 10, Ingilizce 10, Matematik 20, Fen 20. | Rapor karsilastirmalarinda farkli soru sayilari icin `Basari %` ana metrik, `Net` ve `Soru` baglam kalir. |
| TXT optik dosya | UTF-8/CRLF, 254 satir, her satir 171 karakter, 128 A ve 126 B kitapcik. | Parser fixture'i `OPTIK_7108_LGS` preset'iyle deterministik calismali. |
| TXT fixed-width alanlari | Ogrenci no `11..15`, TCKN-benzeri alan `37..48`, kitapcik `50`, cevap segmentleri `51:20`, `71:10`, `91:10`, `111:10`, `131:20`, `151:20`. | Ham TXT PII gibi ele alinmali; evidence, log, audit ve artifactlerde ham satir/kimlik/dosya adi tasinmamali. |
| Mevcut repo kaniti | `answer-key-excel-import.service.test.ts`, `optical-answer-parser.test.ts`, `optik-7108-real-pipeline.test.ts`, `smoke-isem-optical-pipeline-live.mjs`. | Plan sifirdan parser yazmayi degil, mevcut fixture -> smoke -> staging evidence merdivenini release kapisina cevirmeyi hedefler. |

## Bulgular

| Alan | Risk | Bulgu | Kullanici Etkisi | Dosya | Dogrulama |
| --- | --- | --- | --- | --- | --- |
| Urun/UAT | P1 | iSEM gercek TXT ve cevap anahtari geldi; risk artik "format belirsiz" degil, bu fixture'in `OPEN-20260529-03` kapanisina ve staging evidence'a dogru baglanmamasi. | Ana deger olan optik -> rapor/karne dongusu fixture'da yesil gorunup staging/pilot kaniti olmadan release edilebilir. | `docs/DECISIONS.md`, `docs/product-journeys-v1.md`, `ornek-veriler/**` | `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/answer-key-excel-import.service.test.ts`, `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/optik-7108-real-pipeline.test.ts src/jobs/optical-pilot-fixture.test.ts` |
| Urun/UAT | P1 | `UAT-KURUM-05/06` tam sinav dongusu icin fixture, smoke ve staging/prod evidence seviyeleri ayrilmali. | Operator akisi fixture testinde gecer ama PDF/Excel indirme, ogrenci/veli portal gorunumu veya live worker kaniti eksik kalabilir. | `scripts/smoke-isem-optical-pipeline-live.mjs`, `scripts/check-live-exam-cycle-evidence.mjs`, `docs/phase-6-production-readiness.md` | `corepack pnpm isem-answer-key:smoke`, `corepack pnpm isem-optical-pipeline:smoke`, `corepack pnpm live:exam-cycle:check`, `corepack pnpm live:ui-worker:smoke` |
| Privacy/Evidence | P1 | iSEM TXT gercek kisi verisi gibi ele alinmali; ham TXT, TCKN-benzeri alan, ogrenci adi veya ham dosya yolu production evidence'a giremez. | CI artifact, smoke JSON, log, S3 object key veya UAT raporu PII sizdirabilir. | `ornek-veriler/iSEM .txt`, `scripts/check-smoke-evidence-contract.mjs`, `scripts/check-prod-evidence-templates.mjs` | `corepack pnpm privacy:inventory:check`, `corepack pnpm pii:contact-policy:check`, `corepack pnpm prod:evidence:templates:check` |
| Privacy/Evidence | P1 | Raw import object key artik yerelde ham dosya adini tasimayacak sekilde sha segmenti altinda `source` objesine yaziliyor; evidence reference'lari icin staging/prod PII-safe kanit yine ayri kapida. | Operator dosya adinda kurum/sinif/ogrenci bilgisi varsa eski object listing veya release bundle PII tasiyabilirdi. | `apps/api/src/exam/raw-import-upload.service.ts`, `apps/api/src/exam/s3-raw-import-archive-store.ts`, `scripts/check-live-exam-cycle-evidence.mjs` | `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/raw-import-upload.service.test.ts src/exam/raw-import.controller.e2e.test.ts src/exam/s3-raw-import-archive-store.test.ts src/exam/postgres-raw-import-repository.test.ts src/exam/raw-import-quarantine-store.test.ts`, staging evidence PII negatifleri |
| Urun/UAT | P1 | Optik, onboarding, UI-worker ve release evidence sozlesmeleri hazir ama gercek staging/prod kosusu bekliyor. | Lokal/static PASS, musteri oncesi production kaniti sayilamaz. | `docs/product-journeys-v1.md`, `docs/phase-6-production-readiness.md` | `pnpm live:onboarding:smoke`, `pnpm live:ui-worker:smoke`, `pnpm uat:check`, `pnpm go-live:check` |
| Urun/UAT | P1 | `UAT-KURUM-07` odeme/taksit kabul satiri cok genis; baska idempotency akislari ayni PASS altinda. | Finans kabul kaniti netligini kaybeder, hatali release karari kolaylasir. | `docs/product-journeys-v1.md` | `node scripts/check-product-journeys.mjs`, `pnpm uat:check` |
| UI/UX | P1 | A11y kapisi sadece `critical` axe ihlallerini fail ediyordu. | `serious` seviye erisilebilirlik sorunu CI'da yesil kalabilirdi. | `apps/web/e2e-next/a11y-next.spec.ts` | `pnpm web:a11y:check` |
| Frontend | P1 | Rapor sayfasi acilista kampus, sinif, ders, sinav, seviye, ogrenci ve donem referanslarini birlikte yukluyor. | Buyuk tenant'ta yavas acilis ve PII minimizasyon riski. | `apps/web/app/(app)/kurum/raporlar/reports-page.tsx` | Buyuk fixture payload olcumu, `pnpm web:ux-contract:check`, `pnpm web:a11y:check` |
| Frontend | P1 | Optik calisma alani tek client component icinde cok fazla sorumluluk tasiyor. | Operator refresh/back sonrasi yarim isi kaybedebilir; queue/status ayrimi zor test edilir. | `apps/web/app/(app)/kurum/optik/parser-config-page.tsx` | `pnpm web:ux-contract:check`, hedefli optik e2e |
| Frontend | P2 | Hata/basari/queue mesajlarinda live region tutarliligi eksik. | Ekran okuyucu kullanan operator islem sonucunu kacirabilir. | `apps/web/app/(app)/kurum/raporlar/reports-page.tsx`, `apps/web/app/(app)/kurum/optik/parser-config-page.tsx` | Submit hata/basari e2e, `pnpm web:a11y:check` |
| Backend/API | P1 | OpenAPI artifact'i path sayisi yuksek olsa da request body ve response schema kapsami bos. | Frontend/dis entegrasyon dogru body/response sozlesmesini goremez. | `apps/api/src/openapi.ts`, `artifacts/openapi.json`, `scripts/generate-openapi.mjs` | `pnpm openapi:generate` ve schema coverage check |
| Backend/API | P1 | DTO/shared-types tek kaynak degil; request Zod semalari API icinde daginik. | UI/API/OpenAPI drift riski artar. | `packages/shared-types/src/index.ts`, `apps/api/src/student/student.controller.ts` | Shared contract typecheck, API test, OpenAPI schema check |
| Backend/API | P1 | Idempotency kapsami tutarsiz ve bircok kritik create/send/enqueue akisi opsiyonel. | Mobil/gateway retry ile cift kayit, cift duyuru veya kirli audit olusabilir. | `apps/api/src/http/idempotency.ts`, `apps/api/src/student/student.controller.ts`, `apps/api/src/announcement/announcement.controller.ts` | Replay/conflict e2e testleri |
| DB/RLS | P1 | Tenant relation FK checker bu turdan sonra 0 legacy istisna ile geciyor. | Lokal schema artik izlenen tenant parent iliskilerinde cross-tenant parent referansini DB seviyesinde engeller; live/staging veri preflight kaniti ayrica uretilmeli. | `packages/db/scripts/check-tenant-relation-fks.mjs`, `packages/db/prisma/schema.prisma` | `pnpm db:rls:check`, `pnpm tenant-db:check`, orphan/cross-tenant insert negatifleri |
| DB/RLS | P1 | `AnnouncementReceipt` parent/tenant FK boslugu lokal schema ve migration ile kapatildi; live/staging veri uzerinde orphan preflight henuz kosulmadi. | Canli tabloda orphan/cross-tenant satir varsa migration otomatik backfill yapmadan durmali. | `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260621164000_announcement_receipt_composite_fk/migration.sql` | Orphan scan, composite FK migration, `pnpm db:rls:check` |
| Privacy/Optik | P1 | `ImportQuarantine.rawRow` operator icin gerekli olabilir ama audit/log/Sentry/evidence disinda tutulmali. | Karantina response'u test loguna veya artifact'e yazilirsa ham satir ve cevap dizisi sizabilir. | `packages/db/prisma/schema.prisma`, `apps/api/src/exam/raw-import-quarantine-store.ts`, `apps/api/src/exam/raw-import.controller.e2e.test.ts` | `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/raw-import.controller.e2e.test.ts src/exam/raw-import-quarantine-store.test.ts`, `corepack pnpm privacy:inventory:check` |
| DB/Privacy | P2 | `contentBase64` inline dosya alani teknik olarak hala yazilabilir. | DB dump/backup/KVKK yuzeyi buyur. | `packages/db/prisma/schema.prisma`, `scripts/migrate-inline-upload-content-to-s3-live.mjs` | `pnpm inline-upload-content:check`, live dry-run pending satir sayisi |
| DB/Audit | P2 | `AuditLog.tenantId` nullable ve tenant silmede `SET NULL`. | Tenant bazli audit/KVKK evidence eksik gorunebilir. | `packages/db/prisma/schema.prisma`, audit partition migration | Live audit null siniflandirma raporu |

## P0/P1/P2 Oncelik Tablosu

| Oncelik | Is | Neden |
| --- | --- | --- |
| P0 | Yok | Bu turda dogrudan kanitlanmis auth bypass, data loss veya cross-tenant read bug bulunmadi. |
| P1 | A11y gate'i `critical + serious` seviyeye cikarmak | Dusuk riskli, dogrudan CI kalite kapisini guclendirir. |
| P1 | OpenAPI schema coverage ve DTO/shared-types tek kaynak plani | API sozlesmesi release evidence icin su an zayif. |
| P1 | Kalan tenant composite FK legacy borcunu azaltmak | `AnnouncementReceipt`, `AnnouncementDeliveryReport.announcement`, `Homework.class`, `Homework.sourceMaterial`, `SupportTicket.class`, `PaymentPlan.class`, `ReportSnapshot.class`, `StudentClassHistory.class`, `StudentEnrollment.class`, `Student.class`, `Student.responsibleTeacher`, `ScheduleLesson.class`, `StudySession.class`, `StudySessionStudent.studySession`, `StudySessionStudent.student`, `TeacherAssignment.class`, `TeacherAssignment.student`, `GuardianStudent.guardian`, `GuardianStudent.student` ve zorunlu teacher parent FK'leri lokal kapandi; diger 0 legacy iliski kaldi. |
| P1 | iSEM fixture -> smoke -> staging evidence zinciri | V1 ana degeri ve go-live karari buna bagli. |
| P1 | iSEM/RawImport privacy ve evidence redaction | Gercek TXT kisi verisi tasidigi icin release bundle PII sizdirmemeli. |
| P2 | Rapor sayfasi lazy reference/PII minimizasyonu | Performans ve privacy riskini azaltir. |
| P2 | Optik workspace URL state ve bolunmus paneller | Operator UX ve test edilebilirlik iyilesir. |
| P2 | Inline upload content write-disable karari | KVKK/backup yuzeyini daraltir. |
| P2 | Audit null tenant siniflandirmasi | Evidence raporlarini daha guvenilir yapar. |

## Evidence Seviyesi Matrisi

| Seviye | Ne Kanitlar | Ne Kanitlamaz | Release Kullanimi |
| --- | --- | --- | --- |
| Fixture testi | iSEM Excel/TXT formati, parser, B kitapcik hizalama ve scoring deterministik calisir. | Gercek staging servisleri, S3, queue, UI-worker, portal ve provider sagligini kanitlamaz. | Faz 4 kabul kapisi. |
| Local/live smoke | API, worker, DB, Redis ve S3 benzeri servislerle zincir calisir. | Musteri oncesi staging/prod evidence veya pilot onayi degildir. | Faz 5 on kosul. |
| Staging/prod evidence | Kalici artifact veya gercek HTTPS target ile release candidate kanitlanir. | Pilot kurumun is kabulunu tek basina kanitlamaz. | `prod:evidence:check`, `uat:check`, `go-live:check` girdisi. |
| Pilot kaniti | Kurum rol bazli UAT ve canli is akisi kabul edilir. | Yeni kapsam karari yerine gecmez. | Faz 10 go-live kapanisi. |

## Faz Durumu - 2026-06-21

| Faz | Durum | Bu tur kaniti | Kalan |
| --- | --- | --- | --- |
| Faz 1 - Gate ve Plan Netligi | `LOCAL_PASS` | `corepack pnpm --filter @uzman-hocam/web typecheck`, `corepack pnpm web:a11y:check`, `corepack pnpm web:ux-baseline:check`, `node scripts/check-product-journeys.mjs` gecti. | Broad CI ve staging kaniti Faz 5/Faz 10 kapsaminda. |
| Faz 2 - OpenAPI ve Shared Contract Kalitesi | `PARTIAL_LOCAL_PASS` | Kritik auth/MFA/password-reset, exam create/read/update/delete/list/participant list-create, parser-config suggestion/approval, answer-key read/publish, raw-import upload/evaluation/quarantine/summary/status, report generation-job/snapshot list/student snapshot/export/progress/detail/error-booklet ve portal report snapshot list/detail/error-booklet/progress dar slice'i, portal development-assessments read, teacher portal read-only mirror, student/guardian academic timeline, portal student/profile public records, notification-device public response, student-create, payment-plan create/update/list, announcement create/delivery/read/portal, school reference CRUD/class read-delete/teacher CRUD-purge-assignment/guardian CRUD-link-read, development criteria/assessment, teacher import commit idempotency, attendance, audit-log read, program create/update/read, teacher-note create/update/list, support-ticket create/update/read, homework create/update/read ve UAT-KURUM-07 idempotency envanteri icin shared/API/OpenAPI dogrulamalari gecti. Idempotent UAT mutasyonlarinda `Idempotency-Key`, request body ve `{ data }` response envelope coverage'i fail-fast korunur. | Henuz slice'a alinmamis yonetim student ana kayitlari/profil mutasyonlari, support-ticket portal mutasyonlari, diger genis read/mutation yuzeyleri ve shared-types tek kaynak kullanimi tamamlanmali. |
| Faz 3 - Tenant FK ve DB Butunlugu | `LOCAL_PASS_WITH_STAGING_PENDING` | Izlenen tenant parent iliskilerinde legacy FK allowlist sifirlandi; `Student.class`, `Student.responsibleTeacher`, `StudentClassHistory.class`, `StudentEnrollment.class`, `PaymentPlan.class`, `ReportSnapshot.class`, `Homework.sourceMaterial`, `SupportTicket.class` ve onceki slice'lar tenant composite FK'ye alindi; RLS live evidence artik 24 tenant composite relation icin `tenantFkPreflight` exact setini, 0 legacy allowlist, 0 orphan, 0 cross-tenant parent ve her relation icin cross-tenant insert negatifini ister. `corepack pnpm --filter @uzman-hocam/db test`, `corepack pnpm db:rls:check`, `corepack pnpm tenant-db:check`, `corepack pnpm --filter @uzman-hocam/api typecheck` ve hedefli API testleri gecti. | Kalan 0 legacy FK istisnasi; gercek live/staging DB artifact'i ve DB-level negatif insert kanitinin gercek ortamda uretilmesi tamamlanmali. |
| Faz 4 - Rapor/Optik UX ve Privacy Minimizasyonu | `PARTIAL_LOCAL_PASS` | iSEM fixture testleri, raw import object key dosya adi negatifleri, live exam cycle PII/raw TXT evidence negatifleri, KVKK raw import/upload audit diff redaction kontrolleri, PII contact policy ve prod evidence template/smoke contract check'leri gecti; KVKK inventory checker repo fixture target ile gecti; optik/rapor URL state, alert/status live-region, report snapshot list summary, portal development trend, student/guardian academic timeline PII yasaklari, portal student/profile userId ve ham kimlik yasaklari, notification-device token/userId response yasaklari, teacher profile public redaction ve progress PII/soru detayi yasak alan guardrail dilimleri lokal kontratla gecti. | Genis rapor/optik UI data-loading refactor'u, real `KVKK_INVENTORY_TARGET` staging/prod kaniti ve karantina/evidence artifact PII negatifleri tamamlanmali. |
| Faz 4A - iSEM Fixture Kapanisi | `LOCAL_PASS_WITH_STAGING_PILOT_PENDING` | `docs/DECISIONS.md` ve `docs/product-journeys-v1.md` iSEM fixture gercegine gore guncellendi; API/worker iSEM fixture testleri gecti. | `pnpm live:exam-cycle:check` staging artifact'i ve pilot UAT kaniti bekliyor. |
| Faz 5 - Gercek Evidence ve Provider Kapanisi | `EXTERNAL_NOT_RUN` | `corepack pnpm prod:plan:check` gecti; live exam cycle, iSEM optical, KVKK ve RLS/tenant-FK evidence sozlesmeleri exact sayilar, PII-safe JSON, audit diff redaction, tenant FK preflight ve production/go-live summary cross-check ile lokal olarak sertlestirildi; gercek evidence target'lari kosulmadi. | iSEM smoke, live exam cycle, UI-worker, provider smoke, staging/prod evidence ve pilot/go-live kanitlari uretilmeli. |

## Uygulama Fazlari

### Faz 1 - Gate ve Plan Netligi

- Amac: Dusuk riskli kalite kapisini sertlestirip kalan mimari borcu gorunur yapmak.
- Degisecek dosya alanlari: `docs/**`, `apps/web/e2e-next/a11y-next.spec.ts`.
- Sorumlu agent: `frontend_ux_engineer` + ana agent entegrasyonu.
- Kabul kriterleri:
  - A11y smoke `critical` ve `serious` axe ihlallerini fail eder.
  - Plan dosyasi P1/P2 isleri dosya, etki ve komutla baglar.
  - UAT/urun matrisi static check gecmeye devam eder.
- Test/dogrulama:
  - `corepack pnpm --filter @uzman-hocam/web typecheck`
  - `corepack pnpm web:a11y:check`
  - `corepack pnpm web:ux-baseline:check`
  - `node scripts/check-product-journeys.mjs`
- Risk ve rollback:
  - Risk dusuk; test daha kati oldugu icin mevcut serious ihlal varsa kirmiziya duser.
  - Rollback: `a11y-next.spec.ts` gate seviyesini eski `critical` filtresine dondurmek.

### Faz 2 - OpenAPI ve Shared Contract Kalitesi

- Amac: OpenAPI'nin sadece path listesi degil, body/response/envelope/idempotency sozlesmesi tasimasini saglamak.
- Degisecek dosya alanlari: `apps/api/src/openapi.ts`, ilgili controller DTO dekoratorleri,
  `packages/shared-types/**`, `scripts/generate-openapi.mjs`.
- Sorumlu agent: `backend_api_engineer`.
- Kabul kriterleri:
  - Mutasyon endpoint'lerinde request body semasi gorunur.
  - 2xx response'lari `{ data }` / `{ data, meta }` envelope semasiyla gorunur.
  - Opsiyonel header/query parametreleri OpenAPI'de required gorunmez.
  - Idempotency gereken endpoint envanteri testle korunur.
- Bu turda kapatilan dar slice:
  - `POST /api/v1/auth/login`, `POST /api/v1/auth/totp/verify`,
    `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`,
    `POST /api/v1/auth/password-reset/request`, `POST /api/v1/auth/password-reset/confirm`,
    `GET /api/v1/auth/totp/status`, `POST /api/v1/auth/totp/setup`,
    `POST /api/v1/auth/totp/confirm` ve `POST /api/v1/auth/totp/disable`
    shared request/response tiplerine baglandi. OpenAPI checker login MFA branch'inde
    `expiresAt/methods`, refresh/logout icin zorunlu `X-CSRF-Token`, refresh/logout body
    optionalitesi, logout `204` body yoklugu, password-reset request response'unda `resetToken`
    sizmamasi ve auth basari response'larinda `refreshToken`, `refreshTokenHash`,
    `tokenFamilyId`, parola hash'i ve TOTP secret/hash alanlarinin body'ye girmemesi
    kurallarini fail-fast kontrol eder. Runtime login/TOTP verify/refresh response'lari
    artik ham `SessionRecord` yerine public `Session` DTO'suna indirgenir.
  - Answer-key import/dry-run, raw-import upload, evaluation-job ve report-generation job
    endpoint'leri icin request body + `{ data }` response envelope semasi OpenAPI artifact'inde
    gorunur.
  - Idempotent exam/report mutasyonlarinda `Idempotency-Key` header'i OpenAPI'de
    opsiyonel olarak normalize edilir.
  - `POST /api/v1/payment-plans` ve `PATCH /api/v1/payment-plans/{planId}/installments/{installmentId}`
    shared request tiplerine baglandi; request body, `{ data }` response envelope ve opsiyonel
    `Idempotency-Key` header'i OpenAPI artifact'inde gorunur.
  - `scripts/generate-openapi.mjs` bu dar kontrat listesini request body, zorunlu `data`
    envelope ve opsiyonel idempotency header uzerinden fail-fast kontrol eder.
  - Payment slice icin `studentId`, `title`, `totalAmount`, `installments`, response `data`
    alanlari, `installments.minItems` ve taksit status enum'u da OpenAPI checker kapsamindadir.
  - `POST /api/v1/announcements`, `POST /api/v1/announcements/{id}/delivery-results` ve
    `POST /api/v1/announcements/{id}/deliveries` shared request tiplerine baglandi; request body,
    `{ data }` response envelope, create/delivery endpointlerinde opsiyonel `Idempotency-Key`, audience/channel/status
    enum'lari ve delivery queue response alanlari OpenAPI checker kapsamindadir.
  - Duyuru read/portal slice'i genisletildi: `GET /api/v1/announcements`,
    `GET /api/v1/announcements/{id}`, `GET /api/v1/announcements/{id}/recipients`,
    `GET /api/v1/announcements/{id}/delivery-reports`,
    `GET /api/v1/me/student/announcements`,
    `POST /api/v1/me/student/announcements/{id}/read`,
    `GET /api/v1/me/guardian/students/{studentId}/announcements`,
    `POST /api/v1/me/guardian/students/{studentId}/announcements/{id}/read`,
    `GET /api/v1/me/teacher/announcements` ve
    `POST /api/v1/me/teacher/announcements/{id}/read` OpenAPI artifact'inde
    `{ data }` / `{ data, meta }` zarfi, item required alanlari, audience/recipient/status
    enum'lari ve read `readAt` format kuraliyla fail-fast kontrol edilir.
  - API success envelope tipleri `ApiItemResponse<T>` ve `ApiListResponse<T>` olarak
    shared-types'a tasindi; `ApiResponseInterceptor` artik runtime envelope davranisini ayni
    ortak tipe yaslar.
  - `POST /api/v1/students` shared create request tipine baglandi; request body, `{ data }`
    response envelope, status/guardian relationship enum'lari ve opsiyonel `Idempotency-Key`
    header'i OpenAPI checker kapsamindadir. Replay ayni response'u, farkli body ise 409 dondurur.
  - `POST/PATCH /api/v1/classes`, `POST /api/v1/teachers/{id}/assignments` ve
    `PATCH /api/v1/teachers/{id}/assignments/{assignmentId}` shared request tiplerine baglandi;
    request body, `{ data }` response envelope, teacher assignment role enum'u, create icin
    `classId` veya `studentId` anyOf hedef kuralı ve PATCH `minProperties: 1` OpenAPI checker
    kapsamindadir.
  - `POST /api/v1/teachers/imports/dry-run` ve `POST /api/v1/teachers/imports`
    `TeacherImportRequest` shared request tipine baglandi; request body, `{ data }` response
    envelope, dry-run `dryRun/totalRows/validRows/errors/wouldImport` alanlari ve commit
    `importedRows/createdTeachers/createdAssignments/teachers/assignments` alanlari OpenAPI
    checker kapsamindadir. Commit endpoint'i opsiyonel `Idempotency-Key` kabul eder; replay
    ayni response'u, ayni key farkli dosya ise 409 dondurur ve OpenAPI artifact'inde header
    opsiyonel gorunur.
  - `POST/PATCH /api/v1/schedule-lessons`, `POST/PATCH /api/v1/study-sessions` ve
    `POST/PATCH /api/v1/teacher-notes` shared request tiplerine baglandi; request body,
    `{ data }` response envelope, teacher-note visibility enum'u, study-session `studentIds.minItems`
    ve `capacity.minimum` OpenAPI checker kapsamindadir.
  - `GET /api/v1/attendance`, `GET /api/v1/attendance/summary`,
    `POST /api/v1/attendance`, `PATCH /api/v1/attendance/{id}` ve
    `DELETE /api/v1/attendance/{id}` OpenAPI artifact'inde `{ data }` / `{ data, meta }`
    zarfi, 204 no-content silme davranisi, status enum'u ve date format kuraliyla fail-fast
    kontrol edilir. Create/update request tipleri `AttendanceCreateRequest` ve
    `AttendanceUpdateRequest` olarak shared-types'a tasindi; update sozlesmesi mevcut runtime
    davranisi gibi `status` alanini zorunlu tutar.
  - `POST/PATCH /api/v1/support-tickets`, `POST /api/v1/support-tickets/{id}/attachments`
    ve `POST /api/v1/support-tickets/{id}/comments` shared request tiplerine baglandi; request body,
    `{ data }` response envelope, support priority/status/content-type enum'lari, attachment/comment
    endpointlerinde opsiyonel `Idempotency-Key` ve attachment response'unda ham `fileBase64`/`contentBase64`
    bulunmamasi OpenAPI checker kapsamindadir.
  - `POST/PATCH /api/v1/homework/materials`, `POST /api/v1/homework/materials/{id}/files`,
    `POST /api/v1/homework/materials/{id}/assignments`, `POST /api/v1/homework`,
    `POST /api/v1/homework/from-material`, `PATCH /api/v1/homework/{id}` ve
    `PATCH /api/v1/homework/{id}/check-status` shared request tiplerine baglandi; request body,
    `{ data }` response envelope, dosya content-type enum'u, attachment benzeri homework file
    response'unda ham `fileBase64`/`contentBase64`/`storageKey` bulunmamasi, dosya/atama
    endpointlerinde opsiyonel `Idempotency-Key` ve homework/material PATCH `minProperties: 1`
    OpenAPI checker kapsamindadir.
  - School reference CRUD slice'i genisletildi: `GET/POST/PATCH/DELETE`
    `/api/v1/campuses`, `/api/v1/courses`, `/api/v1/grade-levels`,
    `/api/v1/learning-outcomes`, `/api/v1/academic-years`, `/api/v1/academic-terms`
    ve `GET/DELETE /api/v1/classes` OpenAPI artifact'inde `{ data }` / `{ data, meta }`
    zarfi, request body, 204 no-content delete ve tarih format kurallariyla fail-fast
    kontrol edilir. Campus, course, grade-level, learning-outcome, academic-year ve
    academic-term create/update request tipleri shared-types'a tasindi. Artifact gap olcumu
    bu dilimden sonra 233'ten 195'e indi.
  - Development criteria/assessment slice'i genisletildi: `GET/POST`
    `/api/v1/development/criteria` ve `/api/v1/development/assessments`
    OpenAPI artifact'inde `{ data }` / `{ data, meta }` zarfi, request body, visibility enum'u
    ve `scores.minItems=1` kurallariyla fail-fast kontrol edilir.
    `DevelopmentCriterionCreateRequest`, `DevelopmentAssessmentScoreInput` ve
    `DevelopmentAssessmentCreateRequest` shared-types'a tasindi. Artifact gap olcumu
    bu dilimden sonra 195'ten 189'a indi; kalan development bosluklari portal `/me/...`
    read yuzeyindedir.
  - Program/homework/payment/teacher-note read slice'i genisletildi: `GET`
    `/api/v1/schedule-lessons`, `/api/v1/schedule-lessons/{id}`,
    `/api/v1/study-sessions`, `/api/v1/study-sessions/{id}`,
    `/api/v1/teacher-notes`, `/api/v1/payment-plans`,
    `/api/v1/homework`, `/api/v1/homework/{id}`, `/api/v1/homework/materials`,
    `/api/v1/homework/materials/{id}`, `/api/v1/homework/materials/{id}/files`
    ve `/api/v1/homework/materials/{id}/assignments` endpointleri OpenAPI artifact'inde
    `{ data }` / `{ data, meta }` zarfi, mevcut record required alanlari, enum/minimum ve
    homework material file listesinde ham `contentBase64`/`fileBase64`/`storageKey`
    bulunmamasi kurallariyla fail-fast kontrol edilir. Artifact gap olcumu bu dilimden
    sonra 189'dan 177'ye indi; inline `fileBase64` dondurebilen homework download endpoint'i
    ayri privacy sozlesmesi gerektirdigi icin bu slice'a alinmadi.
  - Support-ticket read slice'i genisletildi: `GET /api/v1/support-tickets`,
    `GET /api/v1/support-tickets/{id}`, `GET /api/v1/support-tickets/{id}/attachments`
    ve `GET /api/v1/support-tickets/{id}/comments` OpenAPI artifact'inde `{ data }` /
    `{ data, meta }` zarfi, priority/status/content-type enum'lari, attachment `byteSize`
    minimumu ve attachment listesinde ham `contentBase64`/`fileBase64`/`storageKey`
    bulunmamasi kurallariyla fail-fast kontrol edilir. Artifact gap olcumu bu dilimden
    sonra 177'den 173'e indi; inline `fileBase64` dondurebilen support attachment download
    endpoint'i ayri privacy sozlesmesi gerektirdigi icin bu slice'a alinmadi.
  - Audit-log read slice'i genisletildi: `GET /api/v1/audit-logs`,
    `GET /api/v1/audit-logs/safe-list` ve `GET /api/v1/audit-logs/student-summary`
    OpenAPI artifact'inde `{ data, meta }` zarfi ve zorunlu audit alanlariyla fail-fast
    kontrol edilir. `safe-list` ve `student-summary` sozlesmeleri ham `diff`, actor id,
    tenant id ve entity id gibi detay alanlarini tasimayacak sekilde dar tutulur; tam
    `/audit-logs` listesi mevcut runtime davranisi gibi sanitize edilmis `diff` dondurebilir.
    Artifact gap olcumu bu dilimden sonra 173'ten 170'e indi.
  - Guardian CRUD/link/read slice'i genisletildi: `GET/POST/PATCH/DELETE`
    `/api/v1/guardians`, `POST /api/v1/guardians/{id}/purge-pii`,
    `GET/POST/PATCH/DELETE /api/v1/guardians/{id}/students`,
    `GET /api/v1/guardians/{id}/student-details`,
    `GET /api/v1/students/{id}/guardians`, `GET /api/v1/students/{id}/guardian-links`,
    `GET /api/v1/me/student/guardians` ve `GET /api/v1/me/student/guardian-links`
    OpenAPI artifact'inde `{ data }` / `{ data, meta }` zarfi, guardian relationship enum'u,
    ogrenci status enum'u ve purge sonrasi `phone` donmemesi kurallariyla fail-fast kontrol
    edilir. `GuardianCreateRequest`, `GuardianUpdateRequest`, `GuardianStudentLinkRequest`
    ve `GuardianStudentRelationRequest` shared-types'a tasindi. Guardian portal `profile`
    ve genis `/me/guardian/students/...` yuzeyleri PII beyaz liste/yasak alan kapisi
    netlestirilmeden bu slice'a alinmadi. Artifact gap olcumu bu dilimden sonra 170'ten
    152'ye indi.
  - Teacher CRUD/purge/read slice'i genisletildi: `GET/POST/PATCH/DELETE`
    `/api/v1/teachers`, `GET /api/v1/teachers/{id}/assignments` ve
    `POST /api/v1/teachers/{id}/purge-pii` OpenAPI artifact'inde `{ data }` /
    `{ data, meta }` zarfi, teacher assignment role enum'u, tarih formatlari ve public
    teacher response'unda `userId`/email/telefon/kimlik/photo/token/object key alanlarinin
    bulunmamasi kurallariyla fail-fast kontrol edilir. `TeacherCreateRequest` ve
    `TeacherUpdateRequest` shared-types'a tasindi; controller public teacher response'lari
    artik `userId` tasimaz. Assignment create/update icin mevcut `classId` veya `studentId`
    hedef kurali korunur; cross-tenant hedef negatifleri ve tarih sirasi gibi daha derin
    is kurallari ayri test/evidence kapsaminda kalir. Artifact gap olcumu bu dilimden
    sonra 152'den 143'e indi.
  - Answer-key read/publish slice'i genisletildi: `GET /api/v1/exams/{examId}/answer-keys`
    ve `POST /api/v1/exams/{examId}/answer-keys/{version}/publish` OpenAPI artifact'inde
    `{ data }` / `{ data, meta }` zarfi, `branches`, `scoringConfig`, `DRAFT/PUBLISHED`
    status enum'u ve publish sonrasi zorunlu `publishedAt` + `status=PUBLISHED`
    kurallariyla fail-fast kontrol edilir. Public response'ta ham `questions`,
    `keyData`, `correctAnswer`, `fileBase64`, `studentId` ve `participantNo` alanlari
    bulunamaz. Publish request body opsiyonel bos obje olarak kalir; opsiyonel
    `Idempotency-Key` header'i korunur. Artifact gap olcumu bu dilimden sonra 143'ten
    141'e indi.
  - Raw-import quarantine/status slice'i genisletildi: `GET`
    `/api/v1/exams/{examId}/raw-imports/{rawImportId}/quarantines`, `GET`
    `/api/v1/exams/{examId}/raw-imports/{rawImportId}/summary`, `GET`
    `/api/v1/exams/{examId}/raw-imports/{rawImportId}/evaluation-status`, `POST`
    `/api/v1/exams/{examId}/raw-imports/{rawImportId}/quarantines/{quarantineId}/resolve`
    ve `GET /api/v1/import-quarantines/summary` OpenAPI artifact'inde `{ data }` /
    `{ data, meta }` zarfi, count minimumlari, `OPEN/RESOLVED` ve `COMPLETED/RUNNING`
    status enum'lari, resolve sonrasi `evaluationJob`, opsiyonel `Idempotency-Key`
    header'i ve raw binary/file/kimlik alan yasaklariyla fail-fast kontrol edilir.
    `rawRow` sadece operator karantina endpoint'i public sozlesmesinde kalir; evidence/log
    PII negatifleri Faz 4/Faz 5 kapisinda ayrica korunur. Operation-contract envanteri
    bu dilimden sonra 154 covered / 123 open; raw-import/import-quarantines ozelinde acik
    operation kalmadi.
  - Parser-config suggestion/approval slice'i genisletildi: `POST`
    `/api/v1/exams/{examId}/parser-configs/suggestions` ve `POST`
    `/api/v1/exams/{examId}/parser-configs/approvals` OpenAPI artifact'inde `{ data }`
    zarfi, suggestion request icin `sampleText` / `fileBase64` / `preset` anyOf kuralı,
    `OPTIK_7108_LGS` preset enum'u, confidence/delimiter/version enum'lari, approval
    response `status=APPROVED`, skip-header minimumu ve opsiyonel `Idempotency-Key`
    header'iyle fail-fast kontrol edilir. `ParserConfigSuggestionRequest`,
    `ParserConfigSuggestionResult`, `ParserConfigApprovalRequest` ve `ParserConfigRecord`
    shared-types'a eklendi. Operation-contract envanteri bu dilimden sonra 156 covered /
    121 open; parser-config ozelinde acik operation kalmadi.
- Bilinen kalan kapsam:
  - Henuz slice'a alinmamis diger genis read/mutation yuzeyinde DTO/shared-types kaynakli
    request/response semalari henuz tam OpenAPI kontratina cevrilmedi.
  - `components.schemas` henuz shared-types/DTO tek kaynak sozlesmesini kanitlamiyor; mevcut
    overlay sadece dar kritik slice icin drift riskini azaltir.
  - UAT-KURUM-07 idempotency envanteri lokal olarak runtime/test/OpenAPI header,
    gerekli request body ve `{ data }` response envelope coverage'iyle korunur; ancak bu,
    henuz slice'a alinmamis diger request/response sema borcunu kapatmaz.
- Test/dogrulama:
  - `corepack pnpm --filter @uzman-hocam/api typecheck`
  - `corepack pnpm --filter @uzman-hocam/api test`
  - `corepack pnpm openapi:generate`
  - `corepack pnpm idempotency:inventory:check`
- Risk ve rollback:
  - Orta risk; controller dekoratorleri genis alana yayilir.
  - Rollback: once coverage checker'i non-release rapor modunda kosup, decorator migration'i endpoint gruplarina bolmek.

### Faz 3 - Tenant FK ve DB Butunlugu

- Amac: RLS disinda DB seviyesinde cross-tenant parent referanslarini engellemek.
- Degisecek dosya alanlari: `packages/db/prisma/schema.prisma`, yeni migrations,
  `packages/db/scripts/check-tenant-relation-fks.mjs`, ilgili DB/API testleri.
- Sorumlu agent: `data_platform_engineer` + `tenant_security_reviewer`.
- Kabul kriterleri:
  - Her legacy FK icin orphan/cross-tenant taramasi var.
  - `AnnouncementReceipt` parent/tenant FK ve orphan backfill kontrolu var.
  - Composite FK allowlist sayisi faz faz azalir.
- Bu turda kapatilan dar slice:
  - `Announcement` parent'i `tenantId + id` unique anahtari tasir.
  - `AnnouncementReceipt` artik `Tenant` ve `Announcement(tenantId, id)` composite FK relation'i tasir.
  - `AnnouncementDeliveryReport.announcement` legacy allowlist'ten cikarildi ve tenant composite FK'ye alindi.
  - Yeni migration, receipt ve delivery rows icin orphan/cross-tenant preflight fail-fast kontrolu yapar;
    otomatik backfill yapmaz.
  - Tenant relation checker bu iki duyuru relation'ini zorunlu composite relation olarak korur.
  - `Homework.class` tenant composite FK'ye alindi; migration homework class parent'i icin
    orphan/cross-tenant preflight fail-fast kontrolu yapar ve legacy istisna sayisi 21'e iner.
  - `ScheduleLesson.class` tenant composite FK'ye alindi; migration ders programi class parent'i
    icin orphan/cross-tenant preflight fail-fast kontrolu yapar ve legacy istisna sayisi 20'ye iner.
  - `StudySession.class`, `StudySessionStudent.studySession` ve `StudySessionStudent.student`
    tenant composite FK'ye alindi; migration etut, etut-ogrenci ve ogrenci parent'lari icin
    orphan/cross-tenant preflight fail-fast kontrolu yapar ve legacy istisna sayisi 17'ye iner.
  - `TeacherAssignment.class` ve `TeacherAssignment.student` tenant composite FK'ye alindi;
    migration nullable class/student parent'lari icin orphan/cross-tenant preflight fail-fast
    kontrolu yapar ve legacy istisna sayisi 15'e iner.
  - `GuardianStudent.guardian` ve `GuardianStudent.student` tenant composite FK'ye alindi;
    migration veli-ogrenci parent'lari icin orphan/cross-tenant preflight fail-fast kontrolu
    yapar ve legacy istisna sayisi 13'e iner.
  - `DevelopmentAssessment.teacher`, `TeacherAssignment.teacher`, `TeacherNote.teacher`,
    `ScheduleLesson.teacher` ve `StudySession.teacher` tenant composite FK'ye alindi; migration
    teacher parent'lari icin orphan/cross-tenant preflight fail-fast kontrolu yapar ve legacy
    istisna sayisi 8'e iner.
  - `Homework.sourceMaterial` ve `SupportTicket.class` tenant composite FK'ye alindi; migration
    source material ve support ticket class parent'lari icin orphan/cross-tenant preflight
    fail-fast kontrolu yapar ve legacy istisna sayisi 6'ya iner. Bu iki nullable iliskide
    hard-delete `SET NULL` semantigi, mevcut soft-delete uygulama davranisiyla uyumlu olarak
    DB seviyesinde `RESTRICT`e cekildi.
  - `PaymentPlan.class` ve `ReportSnapshot.class` tenant composite FK'ye alindi; migration
    odeme plani ve rapor snapshot class parent'lari icin orphan/cross-tenant preflight fail-fast
    kontrolu yapar ve legacy istisna sayisi 4'e iner. Bu nullable class context iliskilerinde
    hard-delete `SET NULL` semantigi, mevcut soft-delete uygulama davranisiyla uyumlu olarak
    DB seviyesinde `RESTRICT`e cekildi.
  - `StudentClassHistory.class` ve `StudentEnrollment.class` tenant composite FK'ye alindi;
    migration ogrenci sinif gecmisi ve enrollment class parent'lari icin orphan/cross-tenant
    preflight fail-fast kontrolu yapar ve legacy istisna sayisi 2'ye iner. Ana `Student.class`
    ve `Student.responsibleTeacher` iliskileri daha genis gorunurluk/scope etkisi nedeniyle
    ayri dilimde kalir.
  - `Student.class` ve `Student.responsibleTeacher` tenant composite FK'ye alindi; migration
    ana ogrenci class ve sorumlu ogretmen parent'lari icin orphan/cross-tenant preflight
    fail-fast kontrolu yapar ve legacy istisna sayisi 0'a iner. Bu nullable iliskilerde
    hard-delete `SET NULL` semantigi, mevcut soft-delete uygulama davranisiyla uyumlu olarak
    DB seviyesinde `RESTRICT`e cekildi.
- Bilinen kalan kapsam:
  - 0 legacy FK istisnasi hala allowlist'te izleniyor; tenant relation FK allowlist'i lokal olarak sifirlandi.
  - Bu lokal migration canli/staging veri uzerinde kosulmadi; preflight artifact'i ve negatif insert
    evidence'i Faz 5/staging kapisina bagli kalir.
- Test/dogrulama:
  - `corepack pnpm --filter @uzman-hocam/db test`
  - `corepack pnpm db:rls:check`
  - `corepack pnpm tenant-db:check`
- Risk ve rollback:
  - Yuksek risk; migration ve live data backfill gerekir.
  - Rollback: migration oncesi dry-run orphan raporu ve transaction icinde reversible DDL plani.

### Faz 4 - Rapor/Optik UX ve Privacy Minimizasyonu

- Amac: Rapor ve optik ekranlarini daha az PII yukleyen, daha test edilebilir operator workspace'lerine bolmek.
- Degisecek dosya alanlari: `apps/web/app/(app)/kurum/raporlar/**`,
  `apps/web/app/(app)/kurum/optik/**`, `apps/api/src/exam/**`, `apps/worker/src/jobs/**`,
  gerekirse scoped API endpoints.
- Sorumlu agent: `frontend_ux_engineer`, `exam_reporting_engineer`, `privacy_governance_reviewer`
  + ihtiyac halinde `backend_api_engineer`.
- Kabul kriterleri:
  - Rapor sayfasi ogrenci listelerini yalniz ilgili sekme/arama ihtiyacinda yukler.
  - Optik active step/exam context URL state ile korunur.
  - Hata ve basari mesajlari `role="alert"` / `role="status"` ile okunur.
  - Gercek iSEM Excel fixture'i 90 soru, 6 brans ve B kitapcik permutasyonunu deterministik dogrular.
  - Gercek iSEM TXT fixture'i 254 satir, 128 A / 126 B kitapcik, 90 cevap ve ornek skor zincirini dogrular.
  - Karantina ve raw import evidence ham TCKN-benzeri alan, ham satir, `fileBase64` veya ogrenci adi tasimaz.
  - Rapor/karne karsilastirmalarinda `Basari %` ana metrik; `Net` ve `Soru` baglam olarak kalir.
- Test/dogrulama:
  - `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/answer-key-excel-import.service.test.ts`
  - `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/optik-7108-real-pipeline.test.ts src/jobs/optical-pilot-fixture.test.ts`
  - `corepack pnpm --filter @uzman-hocam/web typecheck`
  - `corepack pnpm web:a11y:check`
  - `corepack pnpm web:ux-contract:check`
  - `corepack pnpm privacy:inventory:check`
  - `corepack pnpm pii:contact-policy:check`
- Risk ve rollback:
  - Orta risk; operator akisini etkiler.
  - Rollback: once component bolme yapmadan live-region ve URL state gibi cerrahi adimlarla ilerlemek.

### Faz 4A - iSEM Fixture Kapanisi

- Amac: `OPEN-20260529-03` icin gelen iSEM dosyalarini gercek format fixture'i olarak kilitlemek,
  ama staging/pilot kanitiyle karistirmamak.
- Degisecek dosya alanlari: `docs/DECISIONS.md`, `docs/product-journeys-v1.md`,
  `apps/api/src/exam/**`, `apps/worker/src/jobs/**`, `scripts/check-*.mjs` yalniz gerekiyorsa.
- Sorumlu agent: `exam_reporting_engineer` + `qa_verification_engineer`;
  privacy kontrolu icin `tenant_security_reviewer`.
- Kabul kriterleri:
  - `OPEN-20260529-03` durumu "fixture geldi; staging/pilot evidence ayri kapida bekliyor"
    seklinde netlesir.
  - Excel sha256 ve TXT sha256 fixture kabulunde izlenir.
  - `OPTIK_7108_LGS` preset'i fixed-width offsetleri ve 6 cevap segmentini korur.
  - En az bir bozuk/eksik ogrenci satiri quarantine negatifinde kalir; ham TCKN-benzeri alan
    evidence'a yazilmaz.
- Test/dogrulama:
  - `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/answer-key-excel-import.service.test.ts`
  - `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/optik-7108-real-pipeline.test.ts src/jobs/optical-answer-parser.test.ts`
  - `node scripts/check-product-journeys.mjs`
- Risk ve rollback:
  - Risk dusuk/orta; fixture kabulu dar alanda kalir.
  - Rollback: DEC/product journey dilini eski "gercek format bekleniyor" durumuna almak ve
    fixture gate'i release blocker yapmamak.

### Faz 5 - Gercek Evidence ve Provider Kapanisi

- Amac: Local/static PASS ile staging/prod evidence ayrimini kapatmak.
- Degisecek dosya alanlari: `docs/evidence-templates/**`, `scripts/check-*.mjs`, staging/prod artifact planlari.
- Sorumlu agent: `ops_release_engineer`, `privacy_governance_reviewer`, `messaging_integrations_engineer`,
  `qa_verification_engineer`.
- Kabul kriterleri:
  - Onboarding, live exam cycle, UI-worker report, UAT, pilot ve go-live evidence gercek staging/prod artifact'e bagli.
  - iSEM smoke zinciri staging servislerinde gecmeden tam sinav dongusu PASS sayilmaz:
    `isem-answer-key:smoke`, `isem-student-import:smoke`, `isem-optical-pipeline:smoke`.
  - iSEM pipeline 254 `ParsedAnswer MATCHED`, 0 quarantine fixture sonucu, 254 `ExamResult`,
    254 report result ve `ReportSnapshot READY` kanitlar.
  - Tam sinav dongusu PASS icin PDF/Excel indirme, ogrenci portali ve veli portali ayni release
    candidate uzerinden kanitlanir.
  - `ISEM_OPTICAL_PIPELINE_TARGET` ve `LIVE_EXAM_CYCLE_TARGET` kalici `file://` artifact veya
    gercek `https://` host kullanir; `/tmp`, symlink, placeholder host, ham `ornek-veriler` path'i
    veya PII iceren object key kabul edilmez.
  - SMS/e-posta/push provider smoke PII'siz delivery evidence uretir.
  - KVKK, retention, upload AV ve inline upload migration kanitlari placeholder degil.
- Test/dogrulama:
  - `corepack pnpm isem-answer-key:smoke`
  - `corepack pnpm isem-student-import:smoke`
  - `corepack pnpm isem-optical-pipeline:smoke`
  - `ISEM_OPTICAL_PIPELINE_TARGET=file:///.../isem-optical-pipeline.json corepack pnpm isem-optical-pipeline:evidence-check`
  - `LIVE_EXAM_CYCLE_TARGET=file:///.../live-exam-cycle.json corepack pnpm live:exam-cycle:check`
  - `corepack pnpm live:ui-worker:smoke`
  - `corepack pnpm live:ui-worker:result-check`
  - `corepack pnpm prod:evidence:templates:check`
  - `corepack pnpm prod:plan:check`
  - `corepack pnpm uat:check`
  - `corepack pnpm sms:smoke`
  - `corepack pnpm notification:smoke`
  - `corepack pnpm upload-av:check`
- Risk ve rollback:
  - Yuksek risk; gercek secret/provider/staging bagimliligi var.
  - Rollback: evidence kosularini once staging-only ve read-only artifact modunda calistirmak.

## Plan Kaydindaki Isler

- Mevcut plan kaydinda `apps/web/e2e-next/a11y-next.spec.ts` gate'i `critical + serious`
  axe ihlallerini engelleyecek sekilde sertlestirilmis gorunuyor.
- Bu guncellemede Faz 1 lokal olarak dogrulandi.
- `docs/DECISIONS.md` ve `docs/product-journeys-v1.md`, iSEM fixture'in geldigi ama staging/pilot
  kanitinin ayri kapida bekledigi gercegine gore guncellendi.
- Faz 4A icin API/worker fixture testleri calistirildi ve gecti.
- Faz 2 icin kritik auth/exam/raw-import/report OpenAPI slice'i lokal olarak dogrulandi:
  `corepack pnpm --filter @uzman-hocam/api typecheck`, `corepack pnpm --filter @uzman-hocam/api test`,
  `corepack pnpm --filter @uzman-hocam/api build`, `corepack pnpm openapi:generate` gecti.
- QA subagent review'i Faz 2'nin tam kapanmadigini dogruladi: genis mutasyon coverage'i ve
  shared-types tek kaynak sozlesmesi ayri implementation slice'i olarak acik kalmali.
- Auth/MFA/password-reset sozlesme slice'i genisletildi: `LoginRequest`, `AuthRefreshRequest`,
  `PasswordResetRequest`, `PasswordResetConfirmRequest`, `TotpChallengeVerifyRequest`,
  `TotpSetupConfirmRequest`, `TotpDisableRequest` ve ilgili response tipleri shared-types'a
  tasindi. `POST /api/v1/auth/login`, `POST /api/v1/auth/totp/verify`,
  `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`,
  `POST /api/v1/auth/password-reset/request`, `POST /api/v1/auth/password-reset/confirm`,
  `GET /api/v1/auth/totp/status`, `POST /api/v1/auth/totp/setup`,
  `POST /api/v1/auth/totp/confirm` ve `POST /api/v1/auth/totp/disable` OpenAPI artifact'inde
  gercek request/response davranisini tasir. Refresh/logout request body opsiyonel kalir,
  `X-CSRF-Token` zorunlu header olarak gorunur, logout `204` body tasimaz, password-reset
  request response'u `resetToken`/`expiresAt` sizdirmez ve auth success response'lari body'de
  `refreshToken` tasimaz. `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/auth/auth.service.test.ts src/auth/token-service.test.ts src/auth/session-store.test.ts src/http/api-response.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti.
  Ilk birlesik hedefli auth test kosusunda `socket hang up` flake'i goruldu; izole rerun'lar
  temiz gecti.
- Backend API subagent'in onerdigi `payment-plans` sozlesme slice'i uygulandi:
  `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/payment/payment.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti.
- PR gate subagent payment slice'inda P0/P1 bulgu bulmadi; P2 olarak isaretledigi payment OpenAPI
  alan/enum/minItems drift riski `scripts/generate-openapi.mjs` checker detaylariyla kapatildi.
- Announcement create/delivery sozlesme slice'i uygulandi:
  `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/announcement/announcement.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti.
- Announcement read/portal sozlesme slice'i uygulandi: `GET /api/v1/announcements`,
  `GET /api/v1/announcements/{id}`, recipient/delivery report read endpointleri ve
  ogrenci/veli/ogretmen `/me/**/announcements` list/read endpointleri OpenAPI artifact'inde
  `{ data }` / `{ data, meta }` zarfi, item required alanlari ve enum/`readAt` format
  kurallariyla gorunur. API success envelope tipleri `ApiItemResponse<T>` ve
  `ApiListResponse<T>` olarak shared-types'a tasindi. Backend API subagent read-only review'i
  bu slice icin endpoint listesini ve read POST'un retry'da `readAt` guncellemesi nedeniyle
  idempotency header eklenmemesi gerektigini dogruladi. `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/announcement/announcement.e2e.test.ts src/me/me-access-matrix.e2e.test.ts src/http/api-response.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti.
- PR gate subagent announcement create/delivery slice'inda P0/P1/P2 blocker bulmadi; kalan risk
  full idempotency envanteri ve elle yazilan OpenAPI overlay drift testi olarak plan kapsaminda kalir.
- Announcement create replay/conflict riski kapatildi: `POST /api/v1/announcements` opsiyonel
  `Idempotency-Key` kabul eder; replay ayni response'u, farkli body ise 409 dondurur ve OpenAPI
  artifact'inde header opsiyonel gorunur. `corepack pnpm --filter @uzman-hocam/api exec vitest run src/announcement/announcement.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti.
- Student create replay/conflict riski kapatildi: `POST /api/v1/students` opsiyonel
  `Idempotency-Key` kabul eder; `StudentCreateRequest` shared-types'a tasindi; replay ayni
  response'u, farkli body ise 409 dondurur ve OpenAPI artifact'inde request body, `{ data }`
  envelope, status enum'u ve header opsiyonel gorunur. `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/student/student.service.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti.
- PR gate subagent student-create slice'inda guardian validasyonunun create yan etkisinden sonra
  hata firlatabilecegini P1 buldu; guardian input parse'i store create/createMany oncesine alindi.
  `guardian: {}` + `Idempotency-Key` negatifinde ogrenci olusmadigi `src/app.e2e.test.ts` ile
  kanitlandi. Production bootstrap'in `{ data }` response envelope davranisi
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/http/api-response.e2e.test.ts`
  ile ayrica dogrulandi.
- School class/teacher-assignment sozlesme slice'i uygulandi: `ClassCreateRequest`,
  `ClassUpdateRequest`, `TeacherAssignmentCreateRequest` ve `TeacherAssignmentUpdateRequest`
  shared-types'a tasindi. `POST/PATCH /api/v1/classes`,
  `POST /api/v1/teachers/{id}/assignments` ve
  `PATCH /api/v1/teachers/{id}/assignments/{assignmentId}` OpenAPI artifact'inde request body
  ve `{ data }` response envelope tasir. Teacher assignment role enum'u, create icin
  `classId` veya `studentId` anyOf hedef kuralı ve class/assignment PATCH `minProperties: 1`
  checker kapsamindadir. `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/school/school.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti.
- Program/teacher-note sozlesme slice'i uygulandi: `ScheduleLessonCreateRequest`,
  `ScheduleLessonUpdateRequest`, `StudySessionCreateRequest`, `StudySessionUpdateRequest`,
  `TeacherNoteCreateRequest` ve `TeacherNoteUpdateRequest` shared-types'a tasindi.
  `POST/PATCH /api/v1/schedule-lessons`, `POST/PATCH /api/v1/study-sessions` ve
  `POST/PATCH /api/v1/teacher-notes` OpenAPI artifact'inde request body ve `{ data }`
  response envelope tasir. `scripts/generate-openapi.mjs` bu slice icin required alanlari,
  teacher-note visibility enum'unu, study-session `studentIds.minItems` ve `capacity.minimum`
  kurallarini fail-fast kontrol eder. `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`, `corepack pnpm --filter @uzman-hocam/api build`,
  `corepack pnpm openapi:generate` ve `corepack pnpm --filter @uzman-hocam/api exec vitest run src/program/schedule.e2e.test.ts src/program/study-session.e2e.test.ts src/teacher-note/teacher-note.e2e.test.ts`
  gecti.
- Backend API subagent program/teacher-note slice'inda zaman araligi ve bos PATCH risklerini
  P1/P2 olarak isaretledi; `ScheduleLesson` ve `StudySession` create/patch body validasyonu
  `endsAt > startsAt` kuralini, `ScheduleLesson`/`StudySession`/`TeacherNote` patch body'leri
  en az bir alan kuralini uygular hale getirildi. OpenAPI PATCH semalari `minProperties: 1`
  tasir ve `scripts/generate-openapi.mjs` `requestMinProperties`, `minimum`, `minItems` ve enum
  kurallarini fail-fast kontrol eder. Re-review P0/P1/P2 bulgu vermedi.
  `corepack pnpm --filter @uzman-hocam/api test` de gecti.
- Support-ticket sozlesme slice'i uygulandi: `SupportTicketCreateRequest`,
  `SupportTicketUpdateRequest`, `SupportTicketAttachmentCreateRequest` ve
  `SupportTicketCommentCreateRequest` shared-types'a tasindi. `POST/PATCH /api/v1/support-tickets`,
  `POST /api/v1/support-tickets/{id}/attachments` ve `POST /api/v1/support-tickets/{id}/comments`
  OpenAPI artifact'inde request body ve `{ data }` response envelope tasir. Attachment/comment
  create endpointlerinde `Idempotency-Key` opsiyonel gorunur; attachment response semasi ham
  `fileBase64`/`contentBase64` alanlarini yasaklar. `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/support-ticket/support-ticket.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti.
  Ilk tam API testinde `school.e2e.test.ts` icin tek seferlik HTTP parse flake'i goruldu;
  hedefli `school.e2e.test.ts` rerun ve sonraki tam `corepack pnpm --filter @uzman-hocam/api test`
  gecti (`110` dosya, `654` test). Backend API subagent, `requesterId` request contract drift'i
  ve attachment response `fileBase64` negatif test eksigini P1/P2 olarak isaretledi; `requesterId`
  public create request sozlesmesinden cikarildi, attachment e2e hem `contentBase64` hem `fileBase64`
  yoklugunu dogrular hale getirildi. Re-review P0/P1/P2 bulgu vermedi.
- Homework sozlesme slice'i uygulandi: `HomeworkMaterialCreateRequest`,
  `HomeworkMaterialUpdateRequest`, `HomeworkMaterialFileCreateRequest`,
  `HomeworkMaterialAssignmentCreateRequest`, `HomeworkCreateRequest`,
  `HomeworkFromMaterialCreateRequest`, `HomeworkUpdateRequest` ve `HomeworkCheckStatusRequest`
  shared-types'a tasindi. `POST/PATCH /api/v1/homework/materials`,
  `POST /api/v1/homework/materials/{id}/files`, `POST /api/v1/homework/materials/{id}/assignments`,
  `POST /api/v1/homework`, `POST /api/v1/homework/from-material`,
  `PATCH /api/v1/homework/{id}` ve `PATCH /api/v1/homework/{id}/check-status`
  OpenAPI artifact'inde request body ve `{ data }` response envelope tasir. Material file/assignment
  endpointlerinde `Idempotency-Key` opsiyonel gorunur; core homework endpointlerine desteklenmeyen
  idempotency header'i eklenmez. Homework file response semasi ham `fileBase64`/`contentBase64`/`storageKey`
  alanlarini yasaklar. Material ve homework PATCH body'leri en az bir alan kuralini uygular.
  `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/homework/homework.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti.
- Faz 4 raw import object key PII-safe dilimi lokal olarak kapatildi:
  `createRawImportS3Key` artik kullanici dosya adini object key'in son segmentine yazmaz;
  sha segmenti altinda sabit `source` objesi kullanir. Unit test ve HTTP e2e, `answers.dat`,
  iSEM ve TCKN-benzeri dosya adi parcalarinin `s3Key` icinde tasinmadigini dogrular.
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/raw-import-upload.service.test.ts src/exam/raw-import.controller.e2e.test.ts src/exam/s3-raw-import-archive-store.test.ts src/exam/postgres-raw-import-repository.test.ts src/exam/raw-import-quarantine-store.test.ts`,
  `corepack pnpm pii:contact-policy:check`, `corepack pnpm prod:evidence:templates:check`
  ve `node scripts/check-smoke-evidence-contract.mjs` gecti. `corepack pnpm privacy:inventory:check`
  bu ortamda `KVKK_INVENTORY_TARGET` olmadigi icin beklenen sekilde calismadi; real staging/prod
  KVKK kaniti Faz 5 kapisinda kalir.
- Faz 3 icin `AnnouncementReceipt` parent/tenant FK boslugu lokal olarak kapatildi; ayni
  duyuru parent'i uzerindeki `AnnouncementDeliveryReport.announcement` da composite FK'ye
  alindi ve legacy istisna sayisi 23'ten 22'ye indi.
- Faz 3 icin `Homework.class` legacy FK istisnasi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621172000_homework_class_composite_fk/migration.sql`
  orphan/cross-tenant class preflight'i ekler, `Homework.class` artik `[tenantId, classId]`
  -> `Class[tenantId, id]` composite FK kullanir ve tenant relation checker sonucu
  `65 composite, 21 izlenen legacy istisna` seviyesine iner. `corepack pnpm --filter @uzman-hocam/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @uzman-hocam/db test`, `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/homework/homework.e2e.test.ts`
  gecti.
- Faz 3 icin `ScheduleLesson.class` legacy FK istisnasi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621175000_schedule_lesson_class_composite_fk/migration.sql`
  orphan/cross-tenant class preflight'i ekler, `ScheduleLesson.class` artik `[tenantId, classId]`
  -> `Class[tenantId, id]` composite FK kullanir ve tenant relation checker sonucu
  `66 composite, 20 izlenen legacy istisna` seviyesine iner. `corepack pnpm --filter @uzman-hocam/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @uzman-hocam/db test`, `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/program/schedule.e2e.test.ts`
  gecti.
- Faz 3 icin study-session tenant FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621182000_study_session_composite_fks/migration.sql`
  `StudySession.class`, `StudySessionStudent.studySession` ve `StudySessionStudent.student`
  parent'lari icin orphan/cross-tenant preflight'i ekler. Bu uc relation artik tenant composite
  FK kullanir ve tenant relation checker sonucu `69 composite, 17 izlenen legacy istisna`
  seviyesine iner. `corepack pnpm --filter @uzman-hocam/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @uzman-hocam/db test`, `corepack pnpm tenant-db:check`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/program/study-session.e2e.test.ts`
  ve `corepack pnpm prod:plan:check` gecti. `tenant_security_reviewer` read-only review'i
  P0/P1/P2 bulgu vermedi; staging/prod preflight ve DB-level negatif insert kaniti Faz 5
  sahibinde kalir.
- Faz 3 icin teacher-assignment class/student FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621184500_teacher_assignment_class_student_composite_fks/migration.sql`
  nullable `TeacherAssignment.class` ve `TeacherAssignment.student` parent'lari icin
  orphan/cross-tenant preflight'i ekler. Bu iki relation artik tenant composite FK kullanir ve
  tenant relation checker sonucu `71 composite, 15 izlenen legacy istisna` seviyesine iner.
  `corepack pnpm --filter @uzman-hocam/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @uzman-hocam/db test`, `corepack pnpm tenant-db:check`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/school/teacher-assignment-store.test.ts`
  ve `corepack pnpm prod:plan:check` gecti. `tenant_security_reviewer` read-only review'i
  P0/P1/P2 bulgu vermedi; staging/prod preflight ve DB-level negatif insert kaniti Faz 5
  sahibinde kalir.
- Faz 3 icin guardian-student FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621191000_guardian_student_composite_fks/migration.sql`
  `GuardianStudent.guardian` ve `GuardianStudent.student` parent'lari icin orphan/cross-tenant
  preflight'i ekler; `Guardian` parent'i `tenantId + id` unique anahtari tasir. Bu iki relation
  artik tenant composite FK kullanir ve tenant relation checker sonucu
  `73 composite, 13 izlenen legacy istisna` seviyesine iner. `corepack pnpm --filter @uzman-hocam/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @uzman-hocam/db test`, `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/school/guardian-student-store.test.ts`
  gecti. `tenant_security_reviewer` read-only review'i P0/P1/P2 bulgu vermedi; staging/prod
  preflight ve DB-level negatif insert kaniti Faz 5 sahibinde kalir.
- Faz 3 icin zorunlu teacher parent FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621193000_teacher_composite_fks/migration.sql`
  `DevelopmentAssessment.teacher`, `TeacherAssignment.teacher`, `TeacherNote.teacher`,
  `ScheduleLesson.teacher` ve `StudySession.teacher` parent'lari icin orphan/cross-tenant
  preflight'i ekler; `Teacher` parent'i `tenantId + id` unique anahtari tasir. Bu bes relation
  artik tenant composite FK kullanir ve tenant relation checker sonucu
  `78 composite, 8 izlenen legacy istisna` seviyesine iner. `corepack pnpm --filter @uzman-hocam/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @uzman-hocam/db test`, `corepack pnpm tenant-db:check`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/program/schedule.e2e.test.ts src/program/study-session.e2e.test.ts src/teacher-note/teacher-note.e2e.test.ts src/school/teacher-assignment-store.test.ts src/development/development.service.test.ts`,
  `corepack pnpm prod:plan:check` ve `git diff --check` gecti. `tenant_security_reviewer`
  read-only review'i P0/P1/P2 bulgu vermedi; staging/prod preflight ve DB-level negatif insert
  kaniti Faz 5 sahibinde kalir.
- Faz 3 icin homework/support-ticket nullable parent FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621200000_homework_support_ticket_composite_fks/migration.sql`
  `Homework.sourceMaterial` ve `SupportTicket.class` parent'lari icin orphan/cross-tenant
  preflight'i ekler. Bu iki relation artik tenant composite FK kullanir; `SetNull` hard-delete
  semantigi, mevcut soft-delete davranisiyla uyumlu ve veri kaybina daha kapali olacak sekilde
  `Restrict`e cekildi. Tenant relation checker sonucu `80 composite, 6 izlenen legacy istisna`
  seviyesine iner. `corepack pnpm --filter @uzman-hocam/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`,
  `corepack pnpm --filter @uzman-hocam/db test`, `corepack pnpm db:rls:check`,
  `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/homework/homework.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts`
  gecti. `data_platform_engineer` read-only review'i bu iki iliskiyi en dusuk riskli siradaki
  dilim olarak onermisti; staging/prod preflight ve DB-level negatif insert kaniti Faz 5
  sahibinde kalir.
- Faz 3 icin payment/report nullable class FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621202000_payment_report_class_composite_fks/migration.sql`
  `PaymentPlan.class` ve `ReportSnapshot.class` parent'lari icin orphan/cross-tenant preflight
  ekler. Bu iki relation artik tenant composite FK kullanir; `SetNull` hard-delete semantigi,
  mevcut soft-delete davranisiyla uyumlu ve rapor/finans baglaminda veri kaybina daha kapali
  olacak sekilde `Restrict`e cekildi. Tenant relation checker sonucu
  `82 composite, 4 izlenen legacy istisna` seviyesine iner.
  `corepack pnpm --filter @uzman-hocam/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`,
  `corepack pnpm --filter @uzman-hocam/db test`, `corepack pnpm db:rls:check`,
  `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/payment/payment.e2e.test.ts src/payment/payment-store.test.ts src/report/report-generation.service.test.ts src/report/report-snapshot-store.test.ts`
  gecti. `data_platform_engineer` read-only review'i bu iki iliskiyi Student yasam dongusunden
  daha dar riskli siradaki dilim olarak onermisti; staging/prod preflight ve DB-level negatif
  insert kaniti Faz 5 sahibinde kalir.
- Faz 3 icin student lifecycle class FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621204000_student_lifecycle_class_composite_fks/migration.sql`
  `StudentClassHistory.class` ve `StudentEnrollment.class` parent'lari icin orphan/cross-tenant
  preflight ekler. Bu iki relation artik tenant composite FK kullanir; `SetNull` hard-delete
  semantigi, mevcut soft-delete davranisiyla uyumlu olacak sekilde `Restrict`e cekildi.
  Tenant relation checker sonucu `84 composite, 2 izlenen legacy istisna` seviyesine iner.
  `corepack pnpm --filter @uzman-hocam/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`,
  `corepack pnpm --filter @uzman-hocam/db test`, `corepack pnpm db:rls:check`,
  `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/student/student-class-history-store.test.ts src/student/student-enrollment-store.test.ts src/school/school.e2e.test.ts`
  gecti. Kalan `Student.class` ve `Student.responsibleTeacher` iliskileri ana ogrenci
  gorunurluk/ogretmen scope etkisi nedeniyle ayri, daha dikkatli migration diliminde kalir.
- Faz 3 icin ana ogrenci class/responsible-teacher FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621210000_student_class_teacher_composite_fks/migration.sql`
  `Student.class` ve `Student.responsibleTeacher` parent'lari icin orphan/cross-tenant preflight
  ekler. Bu iki relation artik tenant composite FK kullanir; `SetNull` hard-delete semantigi,
  mevcut soft-delete davranisiyla uyumlu olacak sekilde `Restrict`e cekildi. Tenant relation
  checker sonucu `86 composite, 0 izlenen legacy istisna` seviyesine iner.
  `corepack pnpm --filter @uzman-hocam/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`,
  `corepack pnpm --filter @uzman-hocam/db test`, `corepack pnpm db:rls:check`,
  `corepack pnpm tenant-db:check`,
  `corepack pnpm --filter @uzman-hocam/api typecheck` ve
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/student/student-profile.e2e.test.ts src/school/school.e2e.test.ts`
  gecti. Bu Faz 3'u lokal schema/test seviyesinde kapatir; canli/staging preflight ve
  DB-level negatif insert kaniti Faz 5 kapisinda kalir.
- Faz 4 icin optik/rapor URL state ve live-region dilimi lokal olarak kapatildi:
  `apps/web/app/(app)/kurum/optik/parser-config-page.tsx` optik `examId` ve aktif adimi
  URL state ile korur; `apps/web/app/(app)/kurum/raporlar/reports-page.tsx` aktif rapor
  sekmesini URL state ile korur. Global hata mesajlari `role="alert"`, islem durum
  mesajlari `role="status"` ile okunur. `apps/web/e2e-next/optik-workspace-contract-next.spec.ts`,
  `apps/web/e2e-next/report-workspace-contract-next.spec.ts` ve
  `scripts/check-web-ux-baseline.mjs` bu kontrati kilitler. `corepack pnpm --filter @uzman-hocam/web typecheck`,
  `corepack pnpm web:ux-baseline:check`,
  `corepack pnpm --filter @uzman-hocam/web exec playwright test -c playwright.next.config.ts e2e-next/optik-workspace-contract-next.spec.ts e2e-next/report-workspace-contract-next.spec.ts`,
  `corepack pnpm web:ux-contract:check`, `corepack pnpm web:a11y:check`
  ve `git diff --check` gecti. Bu Faz 4'u tamamen kapatmaz; genis UI data-loading
  refactor'u, real KVKK staging/prod target'i ve PII negatif artifact kanitlari acik kalir.
- Faz 2 icin attendance ve teacher import OpenAPI/shared-contract dilimleri lokal olarak
  kapatildi: `AttendanceCreateRequest`, `AttendanceUpdateRequest` ve `TeacherImportRequest`
  shared-types'a eklendi; `apps/api/src/attendance/attendance-validation.ts` ve
  `apps/api/src/school/school-validation.ts` ilgili Zod body semalarini shared request
  tiplerine yaslar. `apps/api/src/openapi-contracts.ts` ve `scripts/generate-openapi.mjs`
  attendance list/summary/create/update/delete ile teacher import dry-run/commit
  endpoint'lerini request body, `{ data }` / `{ data, meta }`, enum, format ve 204
  no-content kurallariyla kilitler. `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/attendance/attendance.e2e.test.ts src/school/school.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build`, `corepack pnpm openapi:generate`
  ve scoped `git diff --check` gecti. Faz 2 hala tam kapanmaz; genis endpoint envanteri,
  `components.schemas` tek kaynak kaniti ve kalan bulk/idempotency karar dalgasi o turda acik kaldi.
- Faz 2 icin teacher import commit idempotency dilimi lokal olarak kapatildi:
  `POST /api/v1/teachers/imports` opsiyonel `Idempotency-Key` kabul eder; replay ayni
  response'u, ayni key farkli dosya ise 409 dondurur. Idempotency request hash'i ham
  `fileBase64` yerine dosya SHA-256 degeriyle olusur. `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/school/school.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate`
  gecti; artifact spot-check `POST /api/v1/teachers/imports` icin opsiyonel
  `Idempotency-Key` header'ini dogruladi. Faz 2 yine tam kapanmaz; genis endpoint
  envanteri, `components.schemas` tek kaynak kaniti ve kalan idempotency karar tablosu bu turda acik kaldi.
- Faz 2 icin UAT-KURUM-07 idempotency envanteri lokal olarak korumaya alindi:
  `scripts/check-idempotency-inventory.mjs` 30 idempotency operation icin controller
  `Idempotency-Key` alimini, service `operation` anahtarini, replay/conflict e2e test
  tokenlarini ve OpenAPI artifact'inde opsiyonel `Idempotency-Key` header'ini
  (`required: false`, `maxLength: 128`, 409 aciklamasi) fail-fast dogrular.
  `package.json` icin `idempotency:inventory:check` script'i eklendi ve CI `openapi:generate`
  sonrasinda bu envanter kapisini kosar. Faz 2 yine tam kapanmaz; genis endpoint
  request/response coverage'i ve `components.schemas` tek kaynak kaniti aciktir.
- Faz 2 icin UAT-KURUM-07 idempotent mutasyon request/response overlay'i genisletildi:
  daha once sadece header'i normalize edilen `exam`, `parser-config`, `optical-form-template`,
  `answer-key publish`, `raw-import quarantine resolve`, `student import/enrollment`,
  `backup-restore` ve `sms-batch` endpoint'leri artik OpenAPI artifact'inde request body
  semasi ve/veya `{ data }` response envelope tasir. `scripts/check-idempotency-inventory.mjs`
  bu 30 operation icin OpenAPI response envelope ve body beklenen operasyonlarda request body
  semasini da fail-fast dogrular. `corepack pnpm --filter @uzman-hocam/api build`,
  `corepack pnpm openapi:generate` ve `corepack pnpm idempotency:inventory:check` gecti.
- Faz 2 icin exam read/update/list sozlesme dilimi lokal olarak genisletildi:
  `GET /api/v1/exams`, `GET /api/v1/exams/{examId}`, `PATCH /api/v1/exams/{examId}`,
  `DELETE /api/v1/exams/{examId}` ve `GET /api/v1/exams/{examId}/participants`
  artik OpenAPI artifact'inde beklenen request body, `{ data }`, list `meta` veya `204`
  no-content sozlesmesiyle fail-fast korunur. Generator status enumlarini da dogrular.
  `corepack pnpm --filter @uzman-hocam/api build`, `corepack pnpm openapi:generate`,
  `corepack pnpm idempotency:inventory:check` ve
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/exam.controller.e2e.test.ts`
  gecti. Bu dilim Faz 2'yi ilerletir; genis endpoint envanteri ve shared-types tek kaynak
  kaniti halen aciktir.
- Faz 4/Faz 5 icin live exam cycle evidence kontrati PII-safe ve exact-count hale getirildi:
  `LIVE_EXAM_CYCLE_TARGET` payload'i artik `fileName`, `rawRow`, `objectKey`, `s3Key`,
  `contentBase64`, `fileBase64`, ham `ornek-veriler/iSEM .txt` yolu, TCKN-benzeri 11 haneli
  deger, ham e-posta veya telefon tasidiginda fail-fast kirilir. `examCycle` icine
  `quarantineCount` eklendi ve iSEM LGS fixture icin 90 soru, 254 katilimci, 254 eslesme,
  0 quarantine, 254 sinav sonucu ve 254 rapor sonucu exact sayiyla dogrulanir. iSEM optical
  smoke evidence validator'i ayni exact sayilari ister; production summary de
  `reports.liveExamCycle.examCycle` ile `reports.isemOpticalPipeline` count/version alanlarini
  capraz eslestirir. `LIVE_EXAM_CYCLE_ALLOW_EXAMPLE_EVIDENCE=1 LIVE_EXAM_CYCLE_TARGET=...`
  ile live exam cycle template check, `ISEM_OPTICAL_PIPELINE_ALLOW_EXAMPLE_EVIDENCE=1 ...`
  ile iSEM optical evidence check, `PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE=1 ...`
  ile summary check, `node scripts/check-smoke-evidence-contract.mjs` ve
  `corepack pnpm prod:evidence:templates:check` gecti. Bu dilim kotu/eksik evidence'i reddeder;
  gercek staging/prod kosusu, provider smoke, pilot ve go-live kaniti hala Faz 5 dis bagimliligidir.
- Faz 4/Faz 5 icin KVKK inventory evidence raw import/upload redaction kapsami genisletildi:
  `auditDiffRedactionVerified.negativeControls` artik `fileName`, `objectKey`, `rawLine`,
  `rawRow`, `rawText`, `s3Key`, `sourceFileName` ve `sourceFilePath` alanlarini da zorunlu
  negatif kontrol sayar. Production summary ve go-live linked summary ayni audit diff bloğunu
  exact set ile dogrular; summary icinden `rawRow` dusurulen negatif senaryolar
  `prod:evidence:templates:check` icinde fail-fast kirilir. `KVKK_INVENTORY_TARGET=...`
  ile KVKK template check, `PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE=1 ...`
  ile summary check ve `corepack pnpm prod:evidence:templates:check` gecti. Bu dilim KVKK
  redaction kanit sozlesmesini guclendirir; real `KVKK_INVENTORY_TARGET` staging/prod kosusu
  ve runtime retention/purge karari halen aciktir.
- Faz 3/Faz 5 icin RLS live evidence tenant FK preflight sozlesmesi genisletildi:
  `RLS_LIVE_EVIDENCE_TARGET` payload'i artik `tenantFkPreflight` bloğu tasir. Bu blok
  `packages/db/scripts/check-tenant-relation-fks.mjs` tarafinda zorunlu tutulan 24 tenant
  composite relation'i exact listeler, `legacyAllowlistCount=0`, `orphanRows=0`,
  `crossTenantParentRows=0`, her relation icin `cross tenant insert` negatifini ve
  `migrationPreflightCommand` icinde `pnpm tenant-db:check` komutunu ister. Production summary
  ve go-live linked summary ayni tenant FK preflight setini dogrular; relation eksiltme,
  orphan sayisini 1 yapma ve linked summary relation drift negatifleri
  `corepack pnpm prod:evidence:templates:check` icinde fail-fast korunur.
  `RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE=1 RLS_LIVE_EVIDENCE_TARGET=...` ile RLS live template check,
  `PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE=1 ...` ile summary check,
  `GO_LIVE_ALLOW_EXAMPLE_EVIDENCE=1 ...` ile go-live check, `corepack pnpm prod:evidence:templates:check`
  ve `corepack pnpm tenant-db:check` gecti. Bu dilim kanit sozlesmesini guclendirir; gercek
  live/staging DB artifact'i halen uretilmelidir.
- Faz 2 icin school reference CRUD/class read-delete sozlesme dilimi lokal olarak kapatildi:
  `CampusCreateRequest`, `CampusUpdateRequest`, `CourseCreateRequest`, `CourseUpdateRequest`,
  `GradeLevelCreateRequest`, `GradeLevelUpdateRequest`, `LearningOutcomeCreateRequest`,
  `LearningOutcomeUpdateRequest`, `AcademicYearCreateRequest`, `AcademicYearUpdateRequest`,
  `AcademicTermCreateRequest` ve `AcademicTermUpdateRequest` shared-types'a tasindi; ilgili
  Zod body semalari bu tiplere baglandi. OpenAPI overlay ve generator, kampus/ders/seviye/
  kazanim/akademik yil/akademik donem CRUD ve class read-delete endpointlerinde request body,
  `{ data }` / `{ data, meta }` envelope, 204 delete ve tarih format sozlesmesini fail-fast
  korur. `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api build`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/school/school.e2e.test.ts`
  ve `corepack pnpm openapi:generate` gecti. Bu dilim Faz 2'yi ilerletir; guardian/teacher,
  portal/me, report read ve diger genis read/mutation yuzeyleri hala aciktir.
- Faz 2 icin development criteria/assessment sozlesme dilimi lokal olarak kapatildi:
  `DevelopmentCriterionCreateRequest`, `DevelopmentAssessmentScoreInput` ve
  `DevelopmentAssessmentCreateRequest` shared-types'a tasindi; Zod body semalari bu tiplere
  baglandi. OpenAPI overlay ve generator, `GET/POST /api/v1/development/criteria` ile
  `GET/POST /api/v1/development/assessments` endpointlerinde request body,
  `{ data }` / `{ data, meta }` envelope, visibility enum'u ve `scores.minItems=1`
  sozlesmesini fail-fast korur. `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/development/development.controller.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/http/api-response.e2e.test.ts src/http/api-version.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti.
  Bu dilim Faz 2'yi ilerletir; portal `/me/.../development-assessments` read yuzeyi ayri
  PII/RBAC slice'i olarak acik kalir.
- Faz 2 icin program/homework/payment/teacher-note read sozlesme dilimi lokal olarak
  kapatildi: `schedule-lessons`, `study-sessions`, `teacher-notes`, `payment-plans` ve
  ham icerik dondurmeyen `homework` read endpointleri mevcut record semalarina baglandi.
  OpenAPI overlay ve generator `{ data }` / `{ data, meta }` envelope, required alan,
  enum/minimum ve homework material file listesinde ham `contentBase64`/`fileBase64`/
  `storageKey` bulunmamasi sozlesmesini fail-fast korur. `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/program/schedule.e2e.test.ts src/program/study-session.e2e.test.ts src/teacher-note/teacher-note.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/homework/homework.e2e.test.ts src/payment/payment.e2e.test.ts`,
  `node --check scripts/generate-openapi.mjs`, `corepack pnpm --filter @uzman-hocam/api build`
  ve `corepack pnpm openapi:generate` gecti. Bu dilim Faz 2'yi ilerletir; homework download
  endpoint'i inline `fileBase64` dondurebildigi icin ayri privacy/OpenAPI sozlesmesi olarak
  acik kalir.
- Faz 2 icin support-ticket read sozlesme dilimi lokal olarak kapatildi:
  `support-tickets`, `support-tickets/{id}`, `support-tickets/{id}/attachments` ve
  `support-tickets/{id}/comments` mevcut public record semalarina baglandi. OpenAPI overlay
  ve generator `{ data }` / `{ data, meta }` envelope, priority/status/content-type enum'u,
  attachment `byteSize.minimum=1` ve attachment listesinde ham `contentBase64`/`fileBase64`/
  `storageKey` bulunmamasi sozlesmesini fail-fast korur. `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/support-ticket/support-ticket.e2e.test.ts`,
  `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/http/api-response.e2e.test.ts src/http/api-version.e2e.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate`
  gecti. Bu dilim Faz 2'yi ilerletir; support attachment download endpoint'i inline
  `fileBase64` dondurebildigi icin ayri privacy/OpenAPI sozlesmesi olarak acik kalir.
- Faz 2 icin answer-key read/publish sozlesme dilimi lokal olarak kapatildi:
  `GET /api/v1/exams/{examId}/answer-keys` ve
  `POST /api/v1/exams/{examId}/answer-keys/{version}/publish` OpenAPI overlay ve
  generator tarafinda `{ data }` / `{ data, meta }` envelope, `branches`,
  `scoringConfig`, status enum'u, publish `status=PUBLISHED`, zorunlu `publishedAt`
  ve ham cevap/PII alan yasaklariyla fail-fast korunur. `corepack pnpm --filter
  @uzman-hocam/api typecheck`, hedefli answer-key API/repository testleri,
  `corepack pnpm --filter @uzman-hocam/api build`, `corepack pnpm openapi:generate`
  ve `corepack pnpm idempotency:inventory:check` gecti. Bu dilim Faz 2'yi ilerletir;
  exam publish, parser-config suggestion/approval, genis kurum/teacher portal report snapshot
  listeleri ve genis portal `/me/**` yuzeyleri siradaki OpenAPI/shared-contract borcu olarak kalir.
- Faz 2 icin raw-import quarantine/status sozlesme dilimi lokal olarak kapatildi:
  `RawImportUploadRequest`, raw-import parse/evaluation/quarantine response tipleri
  shared-types'a eklendi; raw-import controller request semalari shared request tiplerine
  baglandi. OpenAPI overlay ve generator, karantina listesi, parse summary, evaluation
  status, resolve ve global quarantine summary endpointlerini envelope, minimum count,
  status enum'u, resolve `evaluationJob`, raw binary/file/kimlik alan yasaklari ve
  `Idempotency-Key` header'i ile fail-fast korur. `corepack pnpm --filter
  @uzman-hocam/shared-types typecheck`, `corepack pnpm --filter @uzman-hocam/api
  typecheck`, hedefli raw-import API/store testleri, `corepack pnpm --filter
  @uzman-hocam/api build`, `corepack pnpm openapi:generate` ve `corepack pnpm
  idempotency:inventory:check` gecti. Bu dilim raw-import/import-quarantines ozelinde
  acik operation-contract borcunu kapatir; staging evidence ve `rawRow` PII negatifleri
  Faz 4/Faz 5 sahibinde kalir.
- Faz 2 auth/session public DTO sertlestirmesi lokal olarak kapatildi:
  `POST /api/v1/auth/login`, `POST /api/v1/auth/totp/verify` ve
  `POST /api/v1/auth/refresh` response'lari ham `SessionRecord` yerine sadece public
  `Session` alanlarini dondurur. OpenAPI generator auth success response'larinda
  `refreshToken`, `refreshTokenHash`, `tokenFamilyId`, parola hash'i ve TOTP secret/hash
  alanlarini deep-forbidden kontrol eder. `corepack pnpm --filter @uzman-hocam/api
  typecheck`, hedefli auth/app e2e ve auth unit testleri, `corepack pnpm --filter
  @uzman-hocam/api build`, `corepack pnpm openapi:generate` ve `corepack pnpm
  idempotency:inventory:check` gecti.
- Faz 2 icin parser-config suggestion/approval sozlesme dilimi lokal olarak kapatildi:
  parser-config suggestion/approval request ve response tipleri shared-types'a eklendi;
  parser-config validation/service katmani bu tiplere baglandi. OpenAPI overlay ve
  generator, suggestion request `sampleText` / `fileBase64` / `preset` anyOf kuralini,
  `OPTIK_7108_LGS` preset enum'unu, suggestion confidence/delimiter/version enum'larini,
  approval response `status=APPROVED`, skip-header minimumunu ve approval
  `Idempotency-Key` header'ini fail-fast korur. `corepack pnpm --filter
  @uzman-hocam/shared-types typecheck`, `corepack pnpm --filter @uzman-hocam/api
  typecheck`, hedefli parser-config API/service/repository testleri, `corepack pnpm
  --filter @uzman-hocam/api build`, `corepack pnpm openapi:generate` ve `corepack pnpm
  idempotency:inventory:check` gecti. Bu dilim parser-config ozelinde acik
  operation-contract borcunu kapatir.
- Faz 2 icin report snapshot/export/progress dar sozlesme dilimi lokal olarak kapatildi:
  `GET /api/v1/exams/{examId}/reports/students/{studentId}/snapshots`,
  `GET /api/v1/exams/{examId}/reports/snapshots/{snapshotId}/export.xlsx`,
  `GET /api/v1/exams/{examId}/reports/snapshots/{snapshotId}/export.pdf` ve
  `GET /api/v1/exams/{examId}/reports/students/{studentId}/progress` OpenAPI overlay
  ve generator tarafinda `{ data }` / `{ data, meta }` envelope, snapshot
  `READY/STALE` status'u, export content-type/file/page/row count alanlari,
  progress `questionCount`/`successRate` alanlari ve student-scoped snapshot'ta ham
  cevap/file/kimlik alan yasaklariyla fail-fast korunur. `exam_reporting_engineer`
  read-only subagent'i bu dar slice'i genis snapshot/detail/error-booklet ve portal
  rapor yuzeylerinden ayirmayi onermisti. `corepack pnpm --filter @uzman-hocam/api
  typecheck`, `corepack pnpm --filter @uzman-hocam/api exec vitest run
  src/report/report-generation.controller.e2e.test.ts src/report/report-generation.service.test.ts`,
  `corepack pnpm --filter @uzman-hocam/api build` ve `corepack pnpm openapi:generate`
  gecti. Operation-contract envanteri bu dilimden sonra 277 toplam operation icinde
  160 covered / 117 open; acik report borcu genis kurum snapshot/detail/error-booklet
  ve `/me/**` portal rapor endpointlerinde kalir.
- Faz 2/Faz 4 icin kurum report detail/error-booklet sozlesme ve privacy guardrail dilimi lokal
  olarak kapatildi: `GET /api/v1/exams/{examId}/reports/snapshots/{snapshotId}/students/{studentId}`
  ve `GET /api/v1/exams/{examId}/reports/snapshots/{snapshotId}/students/{studentId}/error-booklet`
  OpenAPI overlay ve generator tarafinda `{ data }` envelope, karne `questionCount`/`successRate`,
  question status enum'u, hata kitapcigi dar response'u ve kimlik/iletisim/raw import/storage/file
  alan yasaklariyla fail-fast korunur. `privacy_governance_reviewer` read-only review'i ana karne
  raporundaki soru bazli `answer/correctAnswer` alanlarinin DEC/KVKK siniri gerektirdigini isaret
  etti; `docs/DECISIONS.md` icindeki `DEC-20260623-01` bu verinin yalniz yetkili karne/soru analizi
  ve hata kitapcigi amaciyla tasinabilecegini, evidence/log/list yuzeylerine ham cevap seti
  yazilamayacagini kilitler. Controller e2e'ye baska tenant ve kapsam disi teacher negatifleri
  eklendi. `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run
  src/report/report-generation.controller.e2e.test.ts src/report/report-generation.service.test.ts`
  (36 test), `corepack pnpm --filter @uzman-hocam/api build`, `corepack pnpm openapi:generate`,
  `node scripts/check-product-journeys.mjs` ve `corepack pnpm prod:plan:check` gecti.
  Operation-contract envanteri bu dilimden sonra 277 toplam operation icinde 162 covered / 115 open;
  acik report borcu genis kurum snapshot listesi ve `/me/**` portal rapor endpointlerinde kalir.
- Faz 2 icin portal report detail/error-booklet/progress sozlesme dilimi lokal olarak kapatildi:
  `GET /api/v1/me/student/reports/{examId}/snapshots/{snapshotId}`,
  `GET /api/v1/me/student/reports/{examId}/latest`,
  `GET /api/v1/me/student/reports/{examId}/snapshots/{snapshotId}/error-booklet`,
  `GET /api/v1/me/student/reports/{examId}/latest/error-booklet`,
  `GET /api/v1/me/student/reports/{examId}/progress`, teacher student detail/error-booklet/progress
  ve guardian student detail/latest/error-booklet/progress endpointleri kurum raporundaki ayni
  `{ data }` response, karne soru detayi, hata kitapcigi daraltilmis response'u,
  `questionCount`/`successRate` ve PII/raw import/storage/file yasaklariyla OpenAPI overlay +
  generator kapisina alindi. `GET /api/v1/me/teacher/reports/{examId}/snapshots` bilincli olarak
  bu dilim disinda tutuldu; genis `snapshotData` listesi ayri karar/contract ister.
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run
  src/me/me-access-matrix.e2e.test.ts src/report/report-generation.controller.e2e.test.ts
  src/report/report-generation.service.test.ts` (46 test), `corepack pnpm --filter
  @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti. Operation-contract envanteri
  bu dilimden sonra 277 toplam operation icinde 175 covered / 102 open; acik report borcu
  `GET /api/v1/exams/{examId}/reports/snapshots` ve
  `GET /api/v1/me/teacher/reports/{examId}/snapshots` endpointlerinde kalir.
- Faz 2/Faz 4 icin report snapshot list summary sozlesme ve runtime redaction dilimi lokal
  olarak kapatildi: `GET /api/v1/exams/{examId}/reports/snapshots` ve
  `GET /api/v1/me/teacher/reports/{examId}/snapshots` artik tam `snapshotData.students[].questions`
  tasimaz; liste cevabi report/class/branch/student total summary ile sinirlanir. OpenAPI overlay
  bu iki listeyi ayri summary schema'ya baglar; `scripts/generate-openapi.mjs` liste ve progress
  yuzeylerinde `questions`, `answer`, `correctAnswer`, `outcomes`, PII/raw import/storage/file
  alanlarini fail-fast yasaklar. `tenant_security_reviewer` read-only review'i teacher snapshot
  listesinin ham cevap seti tasimadan sozlesmeye alinmasini P1 on kosul olarak isaretledi.
  `node --check scripts/generate-openapi.mjs`, `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run
  src/me/me-access-matrix.e2e.test.ts src/report/report-generation.controller.e2e.test.ts
  src/report/report-generation.service.test.ts` (46 test), `corepack pnpm --filter
  @uzman-hocam/api build` ve `corepack pnpm openapi:generate` gecti. Operation-contract envanteri
  bu dilimden sonra 277 toplam operation icinde 177 covered / 100 open; acik report operation
  kalmadi. Faz 2 yine tam kapanmaz; genis portal/read/mutation yuzeyleri ve shared-types tek
  kaynak borcu devam eder.
- Faz 2/Faz 4 icin portal development-assessments read sozlesme dilimi lokal olarak kapatildi:
  `GET /api/v1/me/student/development-assessments` ve
  `GET /api/v1/me/guardian/students/{studentId}/development-assessments` artik OpenAPI
  artifact'inde `{ data, meta }` list envelope ve `DevelopmentTrendItem` schema'si tasir.
  Generator kapisi trend item icin `id`, `periodLabel`, `visibility`, `scores` zorunlu alanlarini,
  `visibility` enum'unu, `scores.minItems`, score/scale minimumlarini ve portal response'ta
  `tenantId`, `studentId`, `teacherId`, `assessmentId`, kimlik/iletisim alanlarinin
  bulunmamasini fail-fast korur. `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run
  src/development/development.service.test.ts src/development/development.controller.e2e.test.ts
  src/me/me-access-matrix.e2e.test.ts` (17 test), `corepack pnpm --filter @uzman-hocam/api build`,
  `corepack pnpm openapi:generate`, artifact schema negatif kontrolu, `corepack pnpm
  prod:plan:check` ve scoped `git diff --check` gecti. Operation-contract envanteri bu dilimden
  sonra 277 toplam operation icinde 179 covered / 98 open; Faz 2 yine tam kapanmaz. Read-only QA
  subagent'i siradaki dusuk riskli `/me/**` borcu olarak teacher portal mirror endpointlerini
  (`/me/teacher`, schedule, attendance, homework, materials, assignments, teacher-notes)
  onerdi; genis student/guardian profile ve mutasyon yuzeyleri ayri PII/mutasyon beyaz liste ister.
- Faz 2/Faz 4 icin teacher portal read-only mirror sozlesme dilimi lokal olarak kapatildi:
  `GET /api/v1/me/teacher`, `GET /api/v1/me/teacher/schedule`,
  `GET /api/v1/me/teacher/attendance`, `GET /api/v1/me/teacher/homework`,
  `GET /api/v1/me/teacher/homework/materials`,
  `GET /api/v1/me/teacher/homework/materials/{id}/assignments` ve
  `GET /api/v1/me/teacher/teacher-notes` mevcut kurum endpoint schema'lariyla OpenAPI overlay'e
  alindi. Generator kapisi teacher profile required alanlarini, schedule/attendance/homework/
  material assignment/teacher-note list envelope ve item required alanlarini, attendance status,
  teacher-note visibility, tarih formatlarini ve file/storage/token/kimlik alan yasaklarini
  fail-fast korur. Hedefli test `/me/teacher` cevabinda `userId`, email, telefon, nationalId,
  photoKey ve token alanlarinin donmedigini sabitler; bu test runtime'da `userId` sizdigini
  yakaladi ve `MeController.teacher()` public teacher response'a indirildi. `node --check
  scripts/generate-openapi.mjs`, `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/me/me-access-matrix.e2e.test.ts
  src/attendance/attendance.e2e.test.ts src/homework/homework.e2e.test.ts
  src/teacher-note/teacher-note.e2e.test.ts` (55 test), `corepack pnpm --filter
  @uzman-hocam/api build`, `corepack pnpm openapi:generate` ve artifact schema negatif
  kontrolu gecti. Operation-contract envanteri bu dilimden sonra 277 toplam operation icinde
  186 covered / 91 open; Faz 2 yine tam kapanmaz. Kalan portal borcu genis student/guardian
  profile, notification-device/support-ticket mutasyonlari ve shared-types tek kaynak gecisidir.
- Faz 2/Faz 4 icin student/guardian academic timeline sozlesme dilimi lokal olarak kapatildi:
  `GET /api/v1/me/student/class-history`, `GET /api/v1/me/student/enrollments`,
  `GET /api/v1/me/student/attendance`, `GET /api/v1/me/student/attendance/summary`,
  `GET /api/v1/me/student/teacher-notes` ve ayni guardian student scoped endpointleri
  OpenAPI overlay'e alindi. Generator kapisi list/envelope schema'larini, class-history ve
  enrollment tarih/status alanlarini, attendance status ve summary sayac minimumlarini,
  teacher-note visibility alaninin yalniz `GUARDIAN_STUDENT` olmasini ve nationalId/birthDate/
  email/phone/photoKey/file/storage/raw/token/userId alan yasaklarini fail-fast korur. Privacy
  review runtime RBAC/IDOR tarafini kosullu guvenli buldu; OpenAPI/evidence kapisi eklenmeden
  slice'in tamam sayilamayacagini isaret etti. `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/me/me-access-matrix.e2e.test.ts
  src/student/student-profile.e2e.test.ts src/attendance/attendance.e2e.test.ts
  src/teacher-note/teacher-note.e2e.test.ts` (26 test), `corepack pnpm --filter
  @uzman-hocam/api build`, `corepack pnpm openapi:generate` ve artifact schema negatif
  kontrolu gecti. Operation-contract envanteri bu dilimden sonra 277 toplam operation icinde
  196 covered / 81 open; Faz 2 yine tam kapanmaz. Kalan portal borcu profil/student ana
  kayitlari, notification-device/support-ticket portal mutasyonlari ve shared-types tek kaynak
  gecisidir.
- Faz 2/Faz 4 icin portal student/profile public record dilimi lokal olarak kapatildi:
  `GET /api/v1/me/student`, `GET /api/v1/me/student/profile`,
  `GET /api/v1/me/guardian/students` ve
  `GET /api/v1/me/guardian/students/{studentId}/profile` artik public student/profile
  OpenAPI schema'larina bagli. `StudentService` viewer response'lari subject `userId`
  alanini dondurmez; `PublicStudentRecord` ve `PublicStudentProfileRecord` shared-types'a
  eklendi. Generator kapisi list/envelope schema'larini, student status enum'unu, profile
  birthDate formatini ve nationalId/nationalIdEncrypted/nationalIdHash/token/userId yasaklarini
  fail-fast korur. `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/me/me-access-matrix.e2e.test.ts
  src/student/student-profile.e2e.test.ts src/app.e2e.test.ts` (49 test),
  `corepack pnpm --filter @uzman-hocam/api build`, `corepack pnpm openapi:generate` ve
  artifact schema negatif kontrolu gecti. Operation-contract envanteri bu dilimden sonra
  277 toplam operation icinde 200 covered / 77 open; Faz 2 yine tam kapanmaz. Kalan portal
  borcu notification-device/support-ticket portal mutasyonlari; kalan student borcu yonetim
  student ana kayitlari ve profil mutasyon/read sozlesmeleridir.
- Faz 2/Faz 4 icin notification-device public response dilimi lokal olarak kapatildi:
  `GET /api/v1/me/notification-devices`, `POST /api/v1/me/notification-devices` ve
  `DELETE /api/v1/me/notification-devices/{id}` artik request'te `provider`/`token`
  zorunlulugunu, response'ta public cihaz metadata'sini ve token/userId yasaklarini OpenAPI
  overlay ile tasir. `PublicNotificationDeviceTokenRecord` shared-types'a eklendi; servis
  provider/delivery icin tam cihaz kaydini korurken `/me/notification-devices` public API
  siniri token ve userId alanlarini dondurmez. Generator kapisi response list/envelope,
  `lastSeenAt`/`disabledAt` tarih formatlari ve token/userId/nationalId* yasaklarini fail-fast
  korur. `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @uzman-hocam/shared-types typecheck`,
  `corepack pnpm --filter @uzman-hocam/api typecheck`,
  `corepack pnpm --filter @uzman-hocam/api exec vitest run src/me/me-access-matrix.e2e.test.ts`
  (12 test), `corepack pnpm --filter @uzman-hocam/api build`, `corepack pnpm openapi:generate`
  ve artifact schema negatif kontrolu gecti. Operation-contract envanteri bu dilimden sonra
  277 toplam operation icinde 203 covered / 74 open; Faz 2 yine tam kapanmaz. Kalan portal
  borcu support-ticket portal mutasyonlari ve genis read/mutation yuzeyleridir.
