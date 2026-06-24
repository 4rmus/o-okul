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
| Urun/UAT | P1 | iSEM gercek TXT ve cevap anahtari geldi; risk artik "format belirsiz" degil, bu fixture'in `OPEN-20260529-03` kapanisina ve staging evidence'a dogru baglanmamasi. | Ana deger olan optik -> rapor/karne dongusu fixture'da yesil gorunup staging/pilot kaniti olmadan release edilebilir. | `docs/DECISIONS.md`, `docs/product-journeys-v1.md`, `ornek-veriler/**` | `corepack pnpm --filter @o-okul/api exec vitest run src/exam/answer-key-excel-import.service.test.ts`, `corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/optik-7108-real-pipeline.test.ts src/jobs/optical-pilot-fixture.test.ts` |
| Urun/UAT | P1 | `UAT-KURUM-05/06` tam sinav dongusu icin fixture, smoke ve staging/prod evidence seviyeleri ayrilmali. | Operator akisi fixture testinde gecer ama PDF/Excel indirme, ogrenci/veli portal gorunumu veya live worker kaniti eksik kalabilir. | `scripts/smoke-isem-optical-pipeline-live.mjs`, `scripts/check-live-exam-cycle-evidence.mjs`, `docs/phase-6-production-readiness.md` | `corepack pnpm isem-answer-key:smoke`, `corepack pnpm isem-optical-pipeline:smoke`, `corepack pnpm live:exam-cycle:check`, `corepack pnpm live:ui-worker:smoke` |
| Privacy/Evidence | P1 | iSEM TXT gercek kisi verisi gibi ele alinmali; ham TXT, TCKN-benzeri alan, ogrenci adi veya ham dosya yolu production evidence'a giremez. | CI artifact, smoke JSON, log, S3 object key veya UAT raporu PII sizdirabilir. | `ornek-veriler/iSEM .txt`, `scripts/check-smoke-evidence-contract.mjs`, `scripts/check-prod-evidence-templates.mjs` | `corepack pnpm privacy:inventory:check`, `corepack pnpm pii:contact-policy:check`, `corepack pnpm prod:evidence:templates:check` |
| Privacy/Evidence | P1 | Raw import object key artik yerelde ham dosya adini tasimayacak sekilde sha segmenti altinda `source` objesine yaziliyor; evidence reference'lari icin staging/prod PII-safe kanit yine ayri kapida. | Operator dosya adinda kurum/sinif/ogrenci bilgisi varsa eski object listing veya release bundle PII tasiyabilirdi. | `apps/api/src/exam/raw-import-upload.service.ts`, `apps/api/src/exam/s3-raw-import-archive-store.ts`, `scripts/check-live-exam-cycle-evidence.mjs` | `corepack pnpm --filter @o-okul/api exec vitest run src/exam/raw-import-upload.service.test.ts src/exam/raw-import.controller.e2e.test.ts src/exam/s3-raw-import-archive-store.test.ts src/exam/postgres-raw-import-repository.test.ts src/exam/raw-import-quarantine-store.test.ts`, staging evidence PII negatifleri |
| Urun/UAT | P1 | Optik, onboarding, UI-worker ve release evidence sozlesmeleri hazir ama gercek staging/prod kosusu bekliyor. | Lokal/static PASS, musteri oncesi production kaniti sayilamaz. | `docs/product-journeys-v1.md`, `docs/phase-6-production-readiness.md` | `pnpm live:onboarding:smoke`, `pnpm live:ui-worker:smoke`, `pnpm uat:check`, `pnpm go-live:check` |
| Urun/UAT | P1 | `UAT-KURUM-07` odeme/taksit kabul satiri cok genis; baska idempotency akislari ayni PASS altinda. | Finans kabul kaniti netligini kaybeder, hatali release karari kolaylasir. | `docs/product-journeys-v1.md` | `node scripts/check-product-journeys.mjs`, `pnpm uat:check` |
| UI/UX | P1 | A11y kapisi sadece `critical` axe ihlallerini fail ediyordu. | `serious` seviye erisilebilirlik sorunu CI'da yesil kalabilirdi. | `apps/web/e2e-next/a11y-next.spec.ts` | `pnpm web:a11y:check` |
| Frontend | P1 | Rapor sayfasi acilista artik ogrenci listesini yuklemiyor; ogrenci listesi rapor sorgusuna, karne/progress/hata kitapcigi detaylari kullanici secimine ertelendi. Sinif filtresi veya snapshot `classId` varsa ogrenci listesi `/students?classId=...` ile daralir; sinifsiz/sinav geneli raporda yalniz katilimci/snapshot ogrenci id'leri `/students/:id` ile yuklenir. | Ilk acilis PII ve payload yuzeyi daraldi; sinifli ve sinifsiz rapor sorgulari genel ogrenci listesine dusmeden calisir. Buyuk tenant'ta ileride tek batch endpoint performans iyilestirmesi olabilir. | `apps/web/app/(app)/kurum/raporlar/reports-page.tsx`, `apps/web/e2e-next/report-workspace-contract-next.spec.ts` | `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/report-workspace-contract-next.spec.ts`, `corepack pnpm web:ux-contract:check` |
| Frontend | P1 | Optik calisma alani tek client component icinde cok fazla sorumluluk tasiyor. | Operator refresh/back sonrasi yarim isi kaybedebilir; queue/status ayrimi zor test edilir. | `apps/web/app/(app)/kurum/optik/parser-config-page.tsx` | `pnpm web:ux-contract:check`, hedefli optik e2e |
| Frontend | P2 | Hata/basari/queue mesajlarinda live region tutarliligi eksik. | Ekran okuyucu kullanan operator islem sonucunu kacirabilir. | `apps/web/app/(app)/kurum/raporlar/reports-page.tsx`, `apps/web/app/(app)/kurum/optik/parser-config-page.tsx` | Submit hata/basari e2e, `pnpm web:a11y:check` |
| Backend/API | P1 | OpenAPI artifact'i path sayisi yuksek olsa da request body ve response schema kapsami bos. | Frontend/dis entegrasyon dogru body/response sozlesmesini goremez. | `apps/api/src/openapi.ts`, `artifacts/openapi.json`, `scripts/generate-openapi.mjs` | `pnpm openapi:generate` ve schema coverage check |
| Backend/API | P1 | DTO/shared-types tek kaynak degil; request Zod semalari API icinde daginik. | UI/API/OpenAPI drift riski artar. | `packages/shared-types/src/index.ts`, `apps/api/src/student/student.controller.ts` | Shared contract typecheck, API test, OpenAPI schema check |
| Backend/API | P1 | Idempotency kapsami tutarsiz ve bircok kritik create/send/enqueue akisi opsiyonel. | Mobil/gateway retry ile cift kayit, cift duyuru veya kirli audit olusabilir. | `apps/api/src/http/idempotency.ts`, `apps/api/src/student/student.controller.ts`, `apps/api/src/announcement/announcement.controller.ts` | Replay/conflict e2e testleri |
| DB/RLS | P1 | Tenant relation FK checker bu turdan sonra 0 legacy istisna ile geciyor. | Lokal schema artik izlenen tenant parent iliskilerinde cross-tenant parent referansini DB seviyesinde engeller; live/staging veri preflight kaniti ayrica uretilmeli. | `packages/db/scripts/check-tenant-relation-fks.mjs`, `packages/db/prisma/schema.prisma` | `pnpm db:rls:check`, `pnpm tenant-db:check`, orphan/cross-tenant insert negatifleri |
| DB/RLS | P1 | `AnnouncementReceipt` parent/tenant FK boslugu lokal schema ve migration ile kapatildi; live/staging veri uzerinde orphan preflight henuz kosulmadi. | Canli tabloda orphan/cross-tenant satir varsa migration otomatik backfill yapmadan durmali. | `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20260621164000_announcement_receipt_composite_fk/migration.sql` | Orphan scan, composite FK migration, `pnpm db:rls:check` |
| Privacy/Optik | P1 | `ImportQuarantine.rawRow` operator icin gerekli olabilir ama audit/log/Sentry/evidence disinda tutulmali. | Karantina response'u test loguna veya artifact'e yazilirsa ham satir ve cevap dizisi sizabilir. | `packages/db/prisma/schema.prisma`, `apps/api/src/exam/raw-import-quarantine-store.ts`, `apps/api/src/exam/raw-import.controller.e2e.test.ts` | `corepack pnpm --filter @o-okul/api exec vitest run src/exam/raw-import.controller.e2e.test.ts src/exam/raw-import-quarantine-store.test.ts`, `corepack pnpm privacy:inventory:check` |
| DB/Privacy | P2 | `contentBase64` inline dosya alani staging verisinde hala var: live dry-run `HomeworkMaterialFile` ve `SupportTicketAttachment` icin 2+2 pending satir buldu; hash audit bu satirlarda `sha256` eksikligini PII basmadan sayiyor. | DB dump/backup/KVKK yuzeyi buyur; eksik hash onarimi ve tekrar hash audit gecmeden S3 migration kaniti uretmek veri butunlugu riski tasir. | `packages/db/prisma/schema.prisma`, `scripts/migrate-inline-upload-content-to-s3-live.mjs`, `scripts/audit-inline-upload-content-hashes-live.mjs`, `scripts/repair-inline-upload-content-sha-live.mjs` | `pnpm inline-upload-content:audit`, `pnpm inline-upload-content:hash-audit`, `pnpm inline-upload-content:repair-sha`, tekrar `pnpm inline-upload-content:hash-audit`, `INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true pnpm inline-upload-content:migrate`, `pnpm inline-upload-content:check` |
| DB/Privacy | P1 | Inline upload, homework material ve support attachment S3 `storageKey` uretimi hash-only kaliba cekildi: key artik sadece sabit prefix ve `sha256` segmentinden olusur; parent id ve ham dosya adi key'e girmez. Orphan S3 object reconciliation icin PII-safe audit komutu eklendi. | Object listing, storage log veya monitoring yuzeyinde kurum/sinif/kisi bilgisinin key'den yeniden tanimlanma riski daraldi; yarim migration sonrasi DB referansi olmayan obje sayisi gorunur oldu. | `scripts/migrate-inline-upload-content-to-s3-live.mjs`, `scripts/audit-inline-upload-orphan-s3-live.mjs`, `apps/api/src/homework/homework-material-file-storage.ts`, `apps/api/src/support-ticket/support-ticket-attachment-storage.ts` | Hash-only object-key unit testleri, `pnpm prod:readiness:check`, `pnpm ops:check`, `pnpm inline-upload-content:hash-audit`, `pnpm inline-upload-content:orphan-audit` sonrasi onayli migration dry-run |
| DB/Audit | P2 | `AuditLog.tenantId` nullable ve tenant silmede `SET NULL`; null tenant audit satirlari artik kanit sozlesmesiyle siniflandirilmali. | Tenant bazli audit/KVKK evidence eksik gorunebilir. | `packages/db/prisma/schema.prisma`, `scripts/check-audit-null-tenant-evidence.mjs`, audit partition migration | `AUDIT_NULL_TENANT_EVIDENCE_TARGET=... pnpm audit-null-tenant:check`, live audit null siniflandirma raporu |

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
| Faz 1 - Gate ve Plan Netligi | `LOCAL_PASS` | `corepack pnpm --filter @o-okul/web typecheck`, `corepack pnpm web:a11y:check`, `corepack pnpm web:ux-baseline:check`, `node scripts/check-product-journeys.mjs` gecti. | Broad CI ve staging kaniti Faz 5/Faz 10 kapsaminda. |
| Faz 2 - OpenAPI ve Shared Contract Kalitesi | `LOCAL_PASS` | Kritik auth/MFA/password-reset, exam create/read/update/delete/list/participant list-create, parser-config suggestion/approval, optical-form-template list/create/apply, answer-key read/publish, raw-import upload/evaluation/quarantine/summary/status, report generation-job/snapshot list/student snapshot/export/progress/detail/error-booklet ve portal report snapshot list/detail/error-booklet/progress dar slice'i, portal development-assessments read, teacher portal read-only mirror, student/guardian academic timeline, portal student/profile public records, yonetim student core/profile read-update-delete, student import-export/enrollment lifecycle, student class-history/enrollment/teacher-assignment read ve purge/tenant update residual, message-template CRUD, identity-invitation public response/token redaction, notification-device public response, support-ticket portal mutasyonlari, student-create, payment-plan create/update/list, announcement create/delivery/read/portal, school reference CRUD/class read-delete/teacher CRUD-purge-assignment/guardian CRUD-link-read, development criteria/assessment, teacher import commit idempotency, attendance, audit-log read, program create/update/read, teacher-note create/update/list, support-ticket create/update/read, homework create/update/read, health/ready raw response, metrics raw text, download/no-content delete, sms-batch create/report/preview, backup-restore list/create/tenant-export, me profile/tenant, portal homework/notification-preference read-update, tenant admin read-update-delete, tenant create/first-admin token redaction, tenant-user list-create-role-update, role-preview token-scope, kalan teacher/guardian portal read ve privacy inventory/self-purge dilimleri ve UAT-KURUM-07 idempotency envanteri icin shared/API/OpenAPI dogrulamalari gecti. Required-operation envanteri 277 toplam operation icinde 277 covered / 0 open; idempotent UAT mutasyonlarinda `Idempotency-Key`, request body ve `{ data }` response envelope coverage'i fail-fast korunur. | Lokal contract gate kapandi; staging/dis entegrasyon ve generated schema tek-kaynaklastirma sertlestirmesi Faz 5/sonraki hardening kapsaminda izlenmeli. |
| Faz 3 - Tenant FK ve DB Butunlugu | `STAGING_RLS_PASS_WITH_PROD_CHAIN_PENDING` | Izlenen tenant parent iliskilerinde legacy FK allowlist sifirlandi; `Student.class`, `Student.responsibleTeacher`, `StudentClassHistory.class`, `StudentEnrollment.class`, `PaymentPlan.class`, `ReportSnapshot.class`, `Homework.sourceMaterial`, `SupportTicket.class` ve onceki slice'lar tenant composite FK'ye alindi; RLS live evidence artik 24 tenant composite relation icin `tenantFkPreflight` exact setini, 0 legacy allowlist, 0 orphan, 0 cross-tenant parent ve her relation icin cross-tenant insert negatifini ister. gercek live/staging DB artifact'i remote/staging `o-okul-server` uzerinde `artifacts/staging/reports/rls-live.json` olarak uretildi; 54 tenant tablo, 24 relation, 0 orphan/cross-tenant parent, 600 tenant-scope sorgu ve 316.29 rps ile `RLS_LIVE_EVIDENCE_TARGET=file://... corepack pnpm rls:live:check` kapisindan gecti. | Kalan 0 legacy FK istisnasi; RLS staging artifact'inin production summary/live-status zincirine baglanmasi ve production/pilot asamasinda tekrar kosulmasi bekliyor. |
| Faz 4 - Rapor/Optik UX ve Privacy Minimizasyonu | `PARTIAL_LOCAL_PASS` | iSEM fixture testleri, raw import object key dosya adi negatifleri, live exam cycle PII/raw TXT evidence negatifleri, iSEM optik smoke karantina/raw evidence PII negatifleri, KVKK raw import/upload audit diff redaction kontrolleri, PII contact policy ve prod evidence template/smoke contract check'leri gecti; KVKK inventory checker repo fixture target ile gecti; optik/rapor URL state, alert/status live-region, optik karantina `rawRow` UI PII negatifleri ve arama disi genis `/students` yuklememe kontrati, optik rapor context tekil/dedupe ogrenci yukleme ve memoized tablo/analiz turevleri, report workspace lazy ve class/participant-scoped ogrenci liste/detay yukleme, report analytics component/perf bolme, report snapshot list summary, API smoke log Authorization/raw request redaction guardrail'i, portal development trend, student/guardian academic timeline PII yasaklari, portal student/profile userId ve ham kimlik yasaklari, yonetim student core/profile userId/ham kimlik/storage yasaklari, student purge-pii profile PII temizligi, notification-device token/userId response yasaklari, support-ticket portal requesterId/file-storage-token yasaklari, teacher profile public redaction ve progress PII/soru detayi yasak alan guardrail dilimleri lokal kontratla gecti; iSEM 254 satir staging real-data smoke ve UI-worker portal sonucu Faz 4A/Faz 5 kanitina baglandi; remote/staging `artifacts/staging/reports/kvkk-inventory.json` 845 ogrenci, 16 ogretmen, 67 veli, 61 kullanici aggregate sayimi, 21 audit redaction negatif kontrolu ve bos `gaps` ile `KVKK_INVENTORY_TARGET=file://... corepack pnpm privacy:inventory:check` kapisindan gecti. | KVKK staging artifact'inin production summary/live-status zincirine baglanmasi ve production/pilot asamasinda tekrar kosulmasi bekliyor. |
| Faz 4A - iSEM Fixture Kapanisi | `STAGING_ISEM_AND_LIVE_EXAM_PASS_WITH_PILOT_PENDING` | `docs/DECISIONS.md` ve `docs/product-journeys-v1.md` iSEM fixture gercegine gore guncellendi; API/worker iSEM fixture testleri gecti; local Postgres/Redis/MinIO uzerinde `corepack pnpm isem-optical-pipeline:smoke` 254 matched, 0 quarantine, 254 `ExamResult`, 254 report result ve PII-safe `artifacts/local/isem-optical-pipeline.json` ile gecti; remote/staging `o-okul-server` uzerinde `artifacts/staging/isem-optical-pipeline.json` 254 matched, 0 quarantine, 254 `ExamResult`, 254 report result, bos `gaps` ve PII-safe grep ile `ISEM_OPTICAL_PIPELINE_TARGET=file://... corepack pnpm isem-optical-pipeline:evidence-check` kapisindan gecti; ayni release candidate icin `artifacts/staging/live-ui-worker-result.json` PDF/XLSX indirme, ogrenci/veli portal gorunumu, `reportStatus=READY`, bos `gaps` ve PII-safe grep ile `LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET=file://... corepack pnpm live:ui-worker:result-check` kapisindan gecti; `artifacts/staging/live-exam-cycle.json` 5 komutluk staging zinciri, 254/254 iSEM sayilari, PDF/Excel ve ogrenci/veli portal gorunumu ile `LIVE_EXAM_CYCLE_TARGET=file://... corepack pnpm live:exam-cycle:check` kapisindan gecti. | Pilot UAT kaniti ve bu staging artifact'lerinin production summary/live-status zincirine baglanmasi bekliyor. |
| Faz 5 - Gercek Evidence ve Provider Kapanisi | `LOCAL_SMOKE_PASS_EXTERNAL_PENDING` | `corepack pnpm prod:plan:check` gecti; live exam cycle, iSEM optical, UI-worker result, KVKK, RLS/tenant-FK, restore drill, AI karne ozeti, inline upload migration, audit null tenant, rate-limit ve GitHub CI evidence sozlesmeleri exact sayilar, PII-safe JSON, audit diff redaction, tenant FK preflight, UI-worker PDF/Excel/portal sonucu, restore critical table sayimlari, AI disabled-mode stop-rule, inline upload write-disable/TTL/pending/migrated tutarliligi, null tenant breakdown/unknown=0, iki farkli rate-limit instance URL'i, secret URL/reference reddi, staging release bundle kalici path kontrolu, provider smoke masked-recipient/providerMessageId guardrail'i, production summary projection ve production/go-live summary cross-check ile lokal olarak sertlestirildi; remote/staging iSEM optical pipeline, live UI-worker result, live exam cycle, restore drill, AI karne ozeti disabled-mode, KVKK inventory, RLS live, audit null tenant, rate-limit Redis, inline upload migration ve GitHub CI artifact'leri kalici `artifacts/staging/**` yolunda uretildi ve checker'lardan gecti ama henuz production summary/live-status zincirine baglanmadi. Remote first-gates teshisi alert secret eksigi ve self-signed TLS nedeniyle PASS manifest uretmedi. | First-gates icin gercek alert webhook secret'lari ve public TLS/domain smoke'u, provider smoke, production summary/live-status ve pilot/go-live kanitlari uretilmeli. |
| Faz 10 - Pilot ve Go-live Kapanisi | `EXTERNAL_NOT_RUN` | Pilot, go-live, production summary ve Canli Durum sozlesmeleri `pilot:check`, `go-live:check`, `live:status:check` ve `prod:evidence:templates:check` ile lokal fixture seviyesinde korunuyor; remote/staging `artifacts/staging/smoke/report-generation.json` perf artifact'i 10.000 sonuc/ogrenci, `generationDurationMs=9271`, `generationDurationMsMax=60000`, `commandsPassed=["pnpm report-generation:perf"]` ve bos `gaps` ile smoke evidence validator'dan gecti. | Gercek pilot kapanis raporu, 18/18 Canli Durum PASS bundle'i, go-live karar paketi, production summary, UAT, rollback ve alert artifact'leri staging/prod ortamda uretilmeli; report-generation perf artifact'i production summary/live-status zincirine baglanmali. |

## Faz Kapanis Kanit Haritasi

| Faz | Acik kanit | Zorunlu hedef/komut | Canli Durum baglantisi | Kapanis kosulu |
| --- | --- | --- | --- | --- |
| Faz 3 - Tenant FK ve DB Butunlugu | Gercek live/staging DB ve DB-level negatif insert kaniti. | `RLS_LIVE_EVIDENCE_TARGET=file:///... corepack pnpm rls:live:check`, `corepack pnpm db:rls:check`, `corepack pnpm db:rls:check:live`, `corepack pnpm rls:load:smoke`, `corepack pnpm tenant-db:check`. | `RLS live kanıtı`. | `reports.rlsLive.tenantFkPreflight` 24 relation, 0 legacy allowlist, 0 orphan, 0 cross-tenant parent, bos `gaps`. |
| Faz 4 - Rapor/Optik UX ve Privacy Minimizasyonu | KVKK inventory ve iSEM staging real-data privacy/perf kaniti. | `KVKK_INVENTORY_TARGET=file:///... corepack pnpm privacy:inventory:check`, `ISEM_OPTICAL_PIPELINE_TARGET=file:///... corepack pnpm isem-optical-pipeline:evidence-check`. | `KVKK inventory kanıtı`, `iSEM optical pipeline kanıtı`. | Ham TXT/TCKN/ogrenci adi/object key PII yok; 254 matched sonuc ve staging/prod kalici artifact var. |
| Faz 4A - iSEM Fixture Kapanisi | iSEM fixture'in staging tam sinav dongusune ve pilot UAT'a baglanmasi. | `ISEM_OPTICAL_PIPELINE_TARGET=file:///... corepack pnpm isem-optical-pipeline:evidence-check`, `LIVE_EXAM_CYCLE_TARGET=file:///... corepack pnpm live:exam-cycle:check`, `PILOT_EVIDENCE_TARGET=file:///... corepack pnpm pilot:check`. | `iSEM optical pipeline kanıtı`, `Live exam cycle kanıtı`, `Pilot kapanış kanıtı`. | 254 `ExamResult`, 254 report result, PDF/Excel, ogrenci/veli portal gorunumu ve pilot acceptance ayni release candidate uzerinde kanitlanir. |
| Faz 5 - Gercek Evidence ve Provider Kapanisi | Staging/prod evidence bundle, UI-worker result, provider, migration, audit, GitHub CI, AI summary, kimlik göçü, finansal saklama ve rate-limit kanitlari. | `corepack pnpm prod:env:check`, `corepack pnpm prod:evidence:check --summary-file artifacts/staging/production-summary.json`, `corepack pnpm prod:evidence:summary:check`, `STAGING_RELEASE_ARTIFACTS_TARGET=/path/to/artifacts/staging corepack pnpm staging:release-artifacts:check`, `RESTORE_DRILL_TARGET=file:///... corepack pnpm restore:drill:check`, `AI_REPORT_SUMMARY_EVIDENCE_TARGET=file:///... corepack pnpm ai-report-summary:check`, `IDENTITY_MIGRATION_TARGET=file:///... corepack pnpm identity-migration:check`, `FINANCIAL_RETENTION_TARGET=file:///... corepack pnpm financial-retention:check`, `LIVE_EXAM_CYCLE_TARGET=file:///... corepack pnpm live:exam-cycle:check`, `ISEM_OPTICAL_PIPELINE_TARGET=file:///... corepack pnpm isem-optical-pipeline:evidence-check`, `LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET=file:///... corepack pnpm live:ui-worker:result-check`, `GITHUB_CI_EVIDENCE_TARGET=file:///... corepack pnpm github-ci:check`, `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET=file:///... corepack pnpm inline-upload-content:check`, `AUDIT_NULL_TENANT_EVIDENCE_TARGET=file:///... corepack pnpm audit-null-tenant:check`, `RATE_LIMIT_EVIDENCE_TARGET=file:///... corepack pnpm rate-limit:check`, `RLS_LIVE_EVIDENCE_TARGET=file:///... corepack pnpm rls:live:check`, `SMS_PROVIDER_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/sms-provider.json corepack pnpm sms:smoke`, `NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/notification-provider.json corepack pnpm notification:smoke`, `UAT_EVIDENCE_TARGET=file:///... corepack pnpm uat:check`. | `Restore drill kanıtı`, `AI karne özeti kanıtı`, `Kimlik göçü kanıtı`, `Finansal saklama kanıtı`, `Live exam cycle kanıtı`, `iSEM optical pipeline kanıtı`, `Live UI-worker result kanıtı`, `GitHub CI kanıtı`, `Inline upload migration kanıtı`, `Audit null tenant kanıtı`, `Rate limit Redis kanıtı`, `RLS live kanıtı`, `SMS provider kanıtı`, `Notification provider kanıtı`, `Staging/prod UAT`. | Production summary tum required checks ve reports alanlarini kalici, PII-safe, symlink/temp olmayan target'lardan toplar. |
| Faz 10 - Pilot ve Go-live Kapanisi | Pilot kapanisi, production summary, live-status bundle ve go-live karar paketi. | `PILOT_EVIDENCE_TARGET=file:///... corepack pnpm pilot:check`, `GO_LIVE_EVIDENCE_TARGET=file:///... corepack pnpm go-live:check`, `LIVE_STATUS_EVIDENCE_TARGET=file:///... corepack pnpm live:status:check`, `REPORT_GENERATION_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/report-generation.json corepack pnpm report-generation:perf`. | 18/18 Canli Durum PASS; ozellikle `Report generation perf kanıtı`, `Pilot kapanış kanıtı`, `Go-live karar paketi`. | `goLiveDecision=APPROVED`, 18/18 gate PASS, linked summary/pilot/live-status target/date/reference eslesmesi, `result=PASS`, `environment=production`, bos `gaps`. |

## Canli Durum Gate Sahiplik Haritasi

| Gate | Sahip faz | Komut | Source | PASS icin minimum |
| --- | --- | --- | --- | --- |
| Traefik HTTPS smoke | Faz 5 | `pnpm traefik:https:smoke` | `productionEvidenceSummary.smokeEvidence.traefikHttps` | HTTPS status/HSTS ve kalici release summary eslesir. |
| TR datacenter/provider kanıtı | Faz 5 | `pnpm deployment:region:check` | `productionEvidenceSummary.reports.deploymentRegion` | `environment=production`, TR provider/region ve evidence reference kalici artifact'ten gelir. |
| Restore drill kanıtı | Faz 5 | `pnpm restore:drill:check` | `productionEvidenceSummary.reports.restoreDrill` | Restore edilen DB'de Tenant, AuditLog, ReportSnapshot ve migration sayimlari en az 1, bos `errors` ve kalici artifact vardir. |
| GitHub CI kanıtı | Faz 5 | `pnpm github-ci:check` | `productionEvidenceSummary.reports.githubCi` | Ayni release commit'i icin `.github/workflows/ci.yml` basarili run, `pnpm run ci` job adimi, run/job URL eslesmesi ve bos `gaps` kalici artifact'te vardir. |
| AI karne özeti kanıtı | Faz 5 | `pnpm ai-report-summary:check` | `productionEvidenceSummary.reports.aiReportSummary` | `provider.mode=disabled`, `validation.externalProviderNotCalled=true`, `kvkk.piiSentToModel=false`, yorum üretimi kapalı, üç komutluk kanıt seti ve bos `gaps` vardir. |
| Kimlik göçü kanıtı | Faz 5 | `pnpm identity-migration:check` | `productionEvidenceSummary.reports.identityMigration` | STUDENT/GUARDIAN/TEACHER source, linked user ve tenant membership sayıları eşit, invitation flow tutarlı, dört canonical doğrulama ve bos `gaps` vardir. |
| Finansal saklama kanıtı | Faz 5 | `pnpm financial-retention:check` | `productionEvidenceSummary.reports.financialRetention` | Gercek karar sahibi/referansi, pozitif PaymentPlan/PaymentInstallment sayımı, purge exception ve iki canonical purge davranisi bos `gaps` ile kanitlanir. |
| Live exam cycle kanıtı | Faz 5 | `pnpm live:exam-cycle:check` | `productionEvidenceSummary.reports.liveExamCycle` | iSEM dongusu, PDF/Excel ve portal gorunumleri ayni release candidate uzerinde kanitlanir. |
| iSEM optical pipeline kanıtı | Faz 4A | `pnpm isem-optical-pipeline:evidence-check` | `productionEvidenceSummary.reports.isemOpticalPipeline` | 254 matched sonuc, 0 quarantine ve PII-safe staging/prod artifact vardir. |
| Live UI-worker result kanıtı | Faz 5 | `pnpm live:ui-worker:result-check` | `productionEvidenceSummary.reports.liveUiWorkerResult` | READY result, PDF/XLSX indirme ve ogrenci/veli portal gorunumu kalici artifact'te vardir. |
| KVKK inventory kanıtı | Faz 4 | `pnpm privacy:inventory:check` | `productionEvidenceSummary.reports.kvkkInventory` | Gercek veri sayimlari, audit diff redaction ve bos `gaps` korunur. |
| RLS live kanıtı | Faz 3 | `pnpm rls:live:check` | `productionEvidenceSummary.reports.rlsLive` | `tenantFkPreflight`, load smoke, 0 orphan ve 0 cross-tenant parent kanitlanir. |
| Inline upload migration kanıtı | Faz 5 | `pnpm inline-upload-content:check` | `productionEvidenceSummary.reports.inlineUploadMigration` | contentBase64 write-disable, TTL ve pending/migrated tutarliligi gecer. |
| Audit null tenant kanıtı | Faz 5 | `pnpm audit-null-tenant:check` | `productionEvidenceSummary.reports.auditNullTenant` | null tenant breakdown toplamla eslesir, `unknown.count=0`, bos `gaps` vardir. |
| Rate limit Redis kanıtı | Faz 5 | `pnpm rate-limit:check` | `productionEvidenceSummary.reports.rateLimit` | Redis store, iki farkli API instance URL'i, API/login/path smoke ve command seti kalici artifact'te vardir; target/reference URL'leri secret query/userinfo/fragment tasimaz. |
| SMS provider kanıtı | Faz 5 | `pnpm sms:smoke` | `productionEvidenceSummary.smokeEvidence.smsProvider` | Gercek provider, masked recipient, providerMessageId ve bos `gaps` vardir. |
| Notification provider kanıtı | Faz 5 | `pnpm notification:smoke` | `productionEvidenceSummary.smokeEvidence.notificationProvider` | E-posta/push smoke gercek alici maskesiyle ve bos `gaps` ile gecer. |
| Report generation perf kanıtı | Faz 10 | `pnpm report-generation:perf` | `productionEvidenceSummary.smokeEvidence.reportGeneration` | 10k sonuc/ogrenci ve `generationDurationMsMax=60000` esigi gecer. |
| Staging/prod UAT | Faz 10 | `pnpm uat:check` | `productionEvidenceSummary.reports.uat` | UAT release/rollback/restore referanslari go-live paketiyle eslesir. |
| Deployment rollback tatbikatı | Faz 10 | `pnpm deployment:rollback:check` | `productionEvidenceSummary.reports.deploymentRollback` | Servis image tag, rollback komutlari ve kronoloji gecer. |
| Pilot kapanış kanıtı | Faz 10 | `pnpm pilot:check` | `pilotEvidence` | 14+ gun pilot, AC-01..AC-10, gercek optik/karne/portal dongusu ve bos `gaps`. |
| Go-live karar paketi | Faz 10 | `pnpm go-live:check` | `goLiveEvidence` | `goLiveDecision=APPROVED`, linked summary/pilot/live-status ve onaylar gecer. |
| Alert bildirim kanalı | Faz 10 | `pnpm alert:webhook:smoke` | `productionEvidenceSummary.smokeEvidence.alertWebhook` | Bearer auth, 2xx webhook ve kalici summary eslesmesi vardir. |

## Tamamlanma Denetimi

| Denetim | Kabul edilen kanit | Yanlis pozitif olarak reddedilir |
| --- | --- | --- |
| Faz status guncellemesi | Faz 3/4/4A/5/10 satirlari yalniz ilgili kapanis haritasi ve Canli Durum gate sahiplik satirlari gercek kanitla kapandiginda daha ileri statuye tasinir. | Fixture/local smoke tek basina final kapanis kaniti degildir. |
| Artifact hedef hijyeni | Kalici, symlink olmayan `file://` artifact veya gercek `https://` hedef; parent dizin de symlink degildir; URL userinfo, query veya fragment tasimaz. | `/tmp`, `/var/tmp`, `artifacts/local/**`, `docs/evidence-templates/**`, placeholder/test/example/redacted host, secret/env dosyasi, userinfo/query/fragment tasiyan URL veya `ALLOW_EXAMPLE_EVIDENCE` ile uretilmis kanit. |
| Production summary zinciri | `corepack pnpm prod:env:check`, `corepack pnpm prod:evidence:check --summary-file artifacts/staging/production-summary.json` ve `corepack pnpm prod:evidence:summary:check` ayni release candidate artifact setini dogrular. | Elle yazilmis summary, eksik required check/report, first-gates target sapmasi veya source artifact ile eslesmeyen summary. |
| Canli Durum transition | `LIVE_STATUS_EVIDENCE_TARGET=file:///... corepack pnpm live:status:check` 18/18 PASS verir; source date/reference/result/environment production summary, pilot ve go-live artifact'leriyle eslesir. | `0/18` veya kismi PASS, staging/FAIL source, source date/reference sapmasi veya farkli artifact setine baglanan live-status bundle. |
| Pilot ve go-live paketi | `PILOT_EVIDENCE_TARGET` ve `GO_LIVE_EVIDENCE_TARGET` gercek JSON'lari `pilot:check` ve `go-live:check` ile gecer; `goLiveDecision=APPROVED`, bos `gaps`, imzali onaylar ve cutover kronolojisi vardir. | Pilot kabul imzasi, role approval, DPA/KVKK, rollback/restore veya linked pilot/live-status/summary hedeflerinden biri eksikse kapanis yoktur. |
| Performans ve privacy | `REPORT_GENERATION_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/report-generation.json corepack pnpm report-generation:perf` 10k sonuc/ogrenci ve 60 sn esigini gecer; kanitlar ham TXT/TCKN/e-posta/telefon/ogrenci adi tasimaz. | `report-generation:smoke`, ham `ornek-veriler` path'i, ham object key, ham alici veya PII iceren release bundle. |
| Son dogrulama | Target'li artifact komutlari, `LIVE_STATUS_EVIDENCE_TARGET=file:///... corepack pnpm live:status:check` 18/18 PASS, `PILOT_EVIDENCE_TARGET=file:///... corepack pnpm pilot:check`, `GO_LIVE_EVIDENCE_TARGET=file:///... corepack pnpm go-live:check`, `PRODUCTION_EVIDENCE_SUMMARY_TARGET=file:///... LIVE_STATUS_EVIDENCE_TARGET=file:///... PILOT_EVIDENCE_TARGET=file:///... GO_LIVE_EVIDENCE_TARGET=file:///... corepack pnpm prod:external-evidence:check`, `corepack pnpm prod:evidence:templates:check`, `corepack pnpm prod:readiness:check`, `corepack pnpm ops:check`, `corepack pnpm prod:plan:check` ve `git diff --check` gecer. | Target'siz `corepack pnpm live:status:check` ile gelen `0/18` PASS, sadece `prod:evidence:templates:check`, sadece bare `ops:check`, target'siz veya `ALLOW_EXAMPLE_EVIDENCE=1` ile calisan `prod:external-evidence:check`, dar unit test veya yalniz statik dokuman guncellemesi final kabul kaniti sayilmaz. |

## Kapanis Calistirma Sirasi

Bu sira, kalan Faz 3/4/4A/5/10 hedeflerini gercek artifact uretimine baglar. Bir satir
`PASS` olmadan sonraki satirin release karari alinmaz; basarisiz satir Faz durumunu ileri
tasimaz.

| Sira | Kapsam | Komut paketi | Uretilen artifact | Gecis karari |
| --- | --- | --- | --- | --- |
| 1 | Preflight bundle hijyeni | `corepack pnpm prod:env:check`, `corepack pnpm staging:evidence-env:check`, `corepack pnpm staging:release-artifacts:check`, `corepack pnpm staging:release-gaps:summary -- --artifacts-dir artifacts/staging --gap-report-file artifacts/local/staging-release-gap-report.json`, `corepack pnpm staging:release-artifacts:archive-unexpected -- --apply`, `corepack pnpm prod:evidence:templates:check` | Kalici `artifacts/staging/**` veya gercek `https://` hedefleri; temp, symlink, placeholder ve secret/env dosyasi yok; `STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE=1` yalniz template fixture bundle'inda calisir, gercek release bundle kapisinda yasaktir; final disi diagnostik/log girdileri manifestli archive'a tasinir. Gap summary `missingRequiredFiles`, `unexpectedFiles`, `invalidFiles`, `mismatchFailures`, `blockedChecks` ve `openClosureItems` sayilarini handoff icin basar. | Artifact seti temiz degilse Faz 5/Faz 10 baslamaz. |
| 2 | Infra ve provider ilk kapilar | `corepack pnpm staging:first-gates:check`, `corepack pnpm traefik:https:smoke`, `corepack pnpm deployment:region:check`, `corepack pnpm alert:webhook:smoke`, `SMS_PROVIDER_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/sms-provider.json corepack pnpm sms:smoke`, `NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/notification-provider.json corepack pnpm notification:smoke`, `corepack pnpm rate-limit:check` | Traefik, region, alert, SMS/notification ve Redis rate-limit kanitlari ayni release candidate referansina baglanir. | Canli Durum'da ilgili Faz 5 gate'leri yalniz source `PASS` ve `environment=production` ise PASS olur. |
| 3 | Tenant, privacy ve veri kanitlari | `corepack pnpm db:rls:check:live`, `corepack pnpm rls:live:check`, `corepack pnpm privacy:inventory:check`, `corepack pnpm inline-upload-content:check`, `corepack pnpm audit-null-tenant:check` | RLS live, KVKK inventory, inline upload migration ve audit null tenant artifact'leri ham PII tasimadan uretilir. | Faz 3 ve Faz 4 status'u ancak 0 orphan, 0 cross-tenant parent, bos `gaps` ve PII negatifleriyle ilerler. |
| 4 | Sinav, rapor ve UAT kanitlari | `corepack pnpm isem-optical-pipeline:evidence-check`, `corepack pnpm live:exam-cycle:check`, `corepack pnpm live:ui-worker:result-check`, `corepack pnpm report-generation:perf`, `corepack pnpm uat:check` | iSEM 254 sonuc, PDF/Excel, portal gorunumu, 10k perf ve UAT artifact'leri ayni release candidate icin uretilir. | Faz 4A/Faz 5 kapanisi ancak local smoke degil staging/prod artifact ile ilerler. |
| 5 | Production summary ve Canli Durum terfisi | `corepack pnpm prod:evidence:check --summary-file artifacts/staging/production-summary.json`, `corepack pnpm prod:evidence:summary:check`, `LIVE_STATUS_EVIDENCE_TARGET=file:///... corepack pnpm live:status:check` | Production summary tum required check/report alanlarini toplar; Canli Durum bundle'i 18/18 dis gate PASS olur. | 18/18 altinda veya source date/reference sapmasinda Faz 5/Faz 10 ilerlemez. |
| 6 | Pilot, rollback ve go-live karari | `PILOT_EVIDENCE_TARGET=file:///... corepack pnpm pilot:check`, `corepack pnpm deployment:rollback:check`, `GO_LIVE_EVIDENCE_TARGET=file:///... corepack pnpm go-live:check`, `corepack pnpm ops:check`, `corepack pnpm prod:plan:check` | Pilot kabul, rollback kronolojisi, onaylar, cutover ve go-live karar paketi ayni summary/live-status hedeflerine baglanir. | Faz 10 yalniz `goLiveDecision=APPROVED`, bos `gaps`, imzali onaylar ve rollback/restore referanslariyla kapanir. |
| 7 | Faz status degisimi | `PRODUCTION_EVIDENCE_SUMMARY_TARGET=file:///... LIVE_STATUS_EVIDENCE_TARGET=file:///... PILOT_EVIDENCE_TARGET=file:///... GO_LIVE_EVIDENCE_TARGET=file:///... corepack pnpm prod:external-evidence:check`, `REMOTE_EVIDENCE_HOST=o-okul-server REMOTE_EVIDENCE_ROOT=/root/o-okul ... corepack pnpm prod:remote-evidence:check`, `git diff --check`, final hedefli testler ve yukaridaki artifact komutlari. | Dokuman, summary, live-status ve go-live JSON'lari birbirini isaret eder; `prod:external-evidence:check` local artifact setini, `prod:remote-evidence:check` remote/staging hostta aynı final checker ve 18/18 Canli Durum zincirini tekrarlar. | Faz 5 ancak `EXTERNAL_EVIDENCE_PASS`, Faz 10 ancak `GO_LIVE_APPROVED` statüsüne tasinir; bu statu degisikligi linked artifact'ler ve remote final readiness olmadan yapilmaz. |

## Kalan 10 Artifact Kapanis Matrisi

Remote `/root/o-okul/artifacts/staging` gap raporu son kontrolde `missingCount=10`,
`foundReleaseSummaryCount=0` ve `overallStatus=BLOCKED` verdi. Asagidaki tablo, her eksigin
gercek kapanis komutunu ve neden henuz final PASS sayilamadigini sabitler; `ALLOW_EXAMPLE_EVIDENCE`
veya fixture/local smoke bu satirlari kapatamaz.
`scripts/check-staging-release-artifacts.mjs`, `STAGING_RELEASE_GAP_REPORT_FILE` verildiginde
`missingRequiredFiles[].remediation` ve release summary `blockedChecks[].remediation` alanlarina
bu komut/onkosul/blocker bilgisini, ayrica `phase`, `ownerAgent`, `evidenceGate` ve
`nextActionKind` handoff metadata'sini de yazar; gap JSON'u bu yuzden ops handoff icin tek kaynak
olarak kullanilabilir ama release evidence yerine gecmez.
`openClosureItems[]` ise first-gates manifest'i eksikken manifest, Traefik HTTPS ve alert webhook
alt kanitlarini ayri kapanis isi olarak gosterir; bu yuzden remote durumda `missingRequiredFiles=10`
olsa bile release-summary ile birlikte 13 acik kapanis kalemi gorunur.
`corepack pnpm staging:release-gaps:summary -- --artifacts-dir artifacts/staging --gap-report-file artifacts/local/staging-release-gap-report.json`
ayni kontrolu kosar ve terminalde her eksik artifact icin `command`, `ownerAgent`, `phase`,
`evidenceGate`, `nextActionKind`, `prerequisite` ve `blocker`
ozetini basar; `release-summary-*.json` henuz yokken bile final bundle'a girmemesi gereken
root/`reports`/`smoke`/`first-gates` dosyalari `unexpectedFiles[]` altinda gorunur. CLI artik
`missingRequiredFiles`, `unexpectedFiles`, `invalidFiles`, `mismatchFailures`, `blockedChecks` ve `openClosureItems`
sayilarini ayri basar; bu yuzden "eksik kanit" ile "temizlenmesi gereken paket girdisi" karismaz.
CLI eski gap JSON'unu yeniden kullanmaz; checker yazim onayi ve komut baslangicindan eski olmayan
`generatedAt` ister. Bundle blokluysa exit code yine basarisiz kalir.
`reports/audit-null-tenant.json` release bundle icin beklenen zorunlu report setindedir; bu
kanit artik `unexpectedFiles[]` temizligi degil, production summary `reports.auditNullTenant`
zincirine baglanacak kalici Faz 5 kaniti olarak dogrulanir.
Final bundle disi kalan diagnostik/log/calisma girdileri silinmeden
`corepack pnpm staging:release-artifacts:archive-unexpected -- --artifacts-dir artifacts/staging --gap-report-file artifacts/local/staging-release-gap-report.json --archive-dir artifacts/local/staging-release-unexpected-<tag> --apply`
ile `artifacts/local/**` altina tasinir; komut dry-run default'tur, taze gap raporundaki
`unexpectedFiles[]` disinda dosya tasimaz ve `manifest.json` yazar.
Remote `o-okul-server` uzerinde bu akış `artifacts/local/staging-release-unexpected-2026-06-24-preflight`
archive dizinine 9 final disi girdiyi manifestli tasidi; taze gap raporu artik
`unexpectedFiles=0`, `missingRequiredFiles=10`, `blockedChecks=1` gosterir. Rate-limit raw smoke
girdisi de `artifacts/local/staging-release-unexpected-rate-limit-smoke-2026-06-24` altina
manifestli arsivlenmistir; final `reports/rate-limit.json` bundle'da kalir.

| Eksik artifact | Owner / faz | Gate | Next action | Guncel blocker |
| --- | --- | --- | --- | --- |
| `first-gates/first-gates-manifest.json` | `ops_release_engineer` / Faz 5 infra-provider | `staging:first-gates:check` | `external_tls_and_alert_secret` | Public TLS/HSTS domain ve gerçek alert webhook secret yok; self-signed/IP TLS release evidence değildir. |
| `reports/deployment-region.json` | `ops_release_engineer` / Faz 5 deployment region | `deployment:region:check` | `provider_contract_evidence` | Provider console/sozlesme veya first-party TR datacenter reference saglanmadi; public IP lookup tek basina kabul edilmiyor. |
| `reports/deployment-rollback.json` | `infra_dr_engineer` / Faz 10 rollback | `deployment:rollback:check` | `rollback_drill` | Gercek bozuk image deploy, healthcheck reject ve previous-pass rollback summary referanslari yok. |
| `reports/identity-migration.json` | `auth_session_engineer` / Faz 5 identity | `identity-migration:check` | `approval_and_subject_data` | Remote sayim `Student=0`, `Guardian=0`, `Teacher=0`, `IdentityInvitation=0`; approval/reference ve subject verisi yok. |
| `reports/financial-retention.json` | `privacy_governance_reviewer` / Faz 5 finans-KVKK | `financial-retention:check` | `policy_approval_and_finance_data` | Remote sayim `PaymentPlan=0`, `PaymentInstallment=0`; Finance/KVKK onayi ve pozitif canli finans kaydi yok. |
| `reports/observability-uat.json` | `observability_sre_engineer` / Faz 5 observability | `observability:uat:check` | `monitoring_stack_and_alert_artifact` | Prometheus/Grafana/Loki HTTPS endpointleri, dashboard/alert referanslari ve alert delivery artifact'i saglanmadi. |
| `reports/external-monitoring.json` | `observability_sre_engineer` / Faz 5 dis monitoring | `external-monitoring:check` | `external_monitoring_drill` | Uptime/monitoring node, public health/login/TLS monitorleri ve outage drill delivery kaniti yok. |
| `reports/admin-mfa.json` | `auth_session_engineer` / Faz 5 Admin MFA | `admin-mfa:check` | `admin_enrollment_and_login_negatives` | Gercek admin enrollment, MFA secret key seti ve login/recovery/session evidence referanslari saglanmadi. |
| `reports/security-audit.json` | `tenant_security_reviewer` / Faz 5 security audit | `security:audit:check` | `public_https_and_auth_data_controls` | Public HTTPS/header target'lari, auth control ve data control evidence referanslari yok. |
| `reports/uat.json` | `qa_verification_engineer` / Faz 5 UAT | `uat:check` | `role_based_uat_artifacts` | 12 komut PASS evidence seti ve 21 persona senaryo artifact'i yok; first-gates/TLS de henuz PASS degil. |
| `release-summary-*.json` | `ops_release_engineer` / Faz 5-10 summary | `prod:evidence:summary:check` | `generate_after_all_required_artifacts` | Yukaridaki 10 artifact ve first-gates PASS olmadan summary yazmak false evidence olur; su an 0 summary var. |

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
  - `corepack pnpm --filter @o-okul/web typecheck`
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
  - `corepack pnpm --filter @o-okul/api typecheck`
  - `corepack pnpm --filter @o-okul/api test`
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
  - `corepack pnpm --filter @o-okul/db test`
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
- Bu turda kapatilan dar slice:
  - Rapor sayfasi ilk acilista `/students` listesini artik yuklemez; kampus, sinif, ders,
    sinav, seviye ve donem referanslari ilk sorgu icin kalir.
  - Ogrenci listesi yalniz kullanici `Raporu getir` aksiyonunu calistirinca ve snapshot varsa
    yuklenir; sinif filtresi veya snapshot `classId` varsa `/students?classId=...` ile daralir.
  - Sinifsiz/sinav geneli raporda genis `/students` listesine dusulmez; katilimci ve snapshot
    ogrenci id'leri dedupe edilip mevcut `/students/:id` public kayitlariyla yuklenir.
  - Karne, progress ve hata kitapcigi detaylari rapor sorgusunda otomatik yuklenmez; kullanici
    ogrenci satirindan karneyi actiginda yuklenir.
  - Playwright kontrati ilk acilista 0 ogrenci liste/detay istegini, sinifli sorguda
    `/students?classId=...` istegini, sinifsiz sorguda 0 genis `/students` ve dedupe edilmis
    `/students/:id` isteklerini, ogrenci seciminden sonra 3 detay istegini fail-fast dogrular.
  - Optik karantina kontrati, API cevabindaki `rawRow` ham TCKN-benzeri alan, e-posta,
    cevap dizisi ve ham satir tasisa bile UI tablo govdesinde yalniz satir, sebep, durum
    ve islem alanlarinin gorundugunu; ham `rawRow` degerlerinin body metnine sizmadigini
    fail-fast dogrular.
  - Optik karantina satirlarini getirmek artik otomatik genis `/students` listesini yuklemez;
    ogrenci secenekleri yalniz operatorun arama aksiyonuyla `/students?q=...&limit=10`
    uzerinden gelir. Karantina select state'i rapor katilimci tablosu ogrenci context'inden
    ayrildi.
  - iSEM optik smoke evidence sozlesmesi artik `rawRow`, `rawLine`, `sourceFileName`,
    TCKN-benzeri deger, ham telefon/e-posta, ham TXT path ve izinli string alanlara gomulmus
    uzun optik satir/cevap dizisi gibi karantina/raw import sizintilarini ortak smoke validator
    seviyesinde reddeder.
- Test/dogrulama:
  - `corepack pnpm --filter @o-okul/api exec vitest run src/exam/answer-key-excel-import.service.test.ts`
  - `corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/optik-7108-real-pipeline.test.ts src/jobs/optical-pilot-fixture.test.ts`
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/optik-workspace-contract-next.spec.ts`
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/report-workspace-contract-next.spec.ts`
  - `corepack pnpm --filter @o-okul/web typecheck`
  - `corepack pnpm web:a11y:check`
  - `corepack pnpm web:ux-contract:check`
  - `corepack pnpm karne:visual-contract:check`
  - `corepack pnpm smoke:evidence:check`
  - `corepack pnpm prod:evidence:templates:check`
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
  - `corepack pnpm --filter @o-okul/api exec vitest run src/exam/answer-key-excel-import.service.test.ts`
  - `corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/optik-7108-real-pipeline.test.ts src/jobs/optical-answer-parser.test.ts`
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
  - Onboarding, live exam cycle, UI-worker report ve provider evidence gercek staging/prod artifact'e bagli;
    UAT, pilot ve go-live bu artifact'leri Faz 10 girdisi olarak kullanir.
  - iSEM smoke zinciri staging servislerinde gecmeden tam sinav dongusu PASS sayilmaz:
    `isem-answer-key:smoke`, `isem-student-import:smoke`, `isem-optical-pipeline:smoke`.
  - iSEM pipeline 254 `ParsedAnswer MATCHED`, 0 quarantine fixture sonucu, 254 `ExamResult`,
    254 report result ve `ReportSnapshot READY` kanitlar.
  - Tam sinav dongusu PASS icin PDF/Excel indirme, ogrenci portali ve veli portali ayni release
    candidate uzerinden kanitlanir.
  - `ISEM_OPTICAL_PIPELINE_TARGET` ve `LIVE_EXAM_CYCLE_TARGET` kalici `file://` artifact veya
    gercek `https://` host kullanir; `/tmp`, symlink, placeholder host, ham `ornek-veriler` path'i
    veya PII iceren object key kabul edilmez.
  - `ISEM_OPTICAL_PIPELINE_TARGET`, `LIVE_EXAM_CYCLE_TARGET` referanslari ve
    `LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET` local smoke ciktilarinin tutuldugu `artifacts/local/**`
    yolunu staging/prod kaniti gibi kabul etmez; `LIVE_EXAM_CYCLE_TARGET` evidence reference'lari
    `isem-optical-pipeline.json`/`.log` ve `live-ui-worker-result.json`/`live-ui-worker-report.json`
    dosya adlariyla gercek iSEM optical pipeline ve UI-worker kanitini acikca baglar.
  - `LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET`, `prod:evidence:check --summary-file` icinde
    `reports.liveUiWorkerResult` olarak yazilir; production summary ve go-live linked summary
    bu rapor olmadan PASS alamaz.
  - Staging release artifact bundle hedefi kalici artifact path'i olmali; `STAGING_RELEASE_ARTIFACTS_TARGET`
    `/tmp` veya `/var/tmp` altinda, symlink parent zincirinde veya secret/env dosyasi iceren bundle
    uzerinden PASS alamaz.
  - SMS/e-posta/push provider smoke PII'siz delivery evidence uretir; masked recipient disinda
    ham telefon/e-posta/push endpoint'i, bos veya sahte `providerMessageId` ve placeholder/test
    notification smoke alicilari PASS alamaz.
  - KVKK, retention, upload AV ve inline upload migration kanitlari placeholder degil.
- Test/dogrulama:
  - `corepack pnpm isem-answer-key:smoke`
  - `corepack pnpm isem-student-import:smoke`
  - `corepack pnpm isem-optical-pipeline:smoke`
  - `ISEM_OPTICAL_PIPELINE_TARGET=file:///.../isem-optical-pipeline.json corepack pnpm isem-optical-pipeline:evidence-check`
  - `LIVE_EXAM_CYCLE_TARGET=file:///.../live-exam-cycle.json corepack pnpm live:exam-cycle:check`
  - `corepack pnpm live:ui-worker:smoke`
  - `LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET=file:///.../live-ui-worker-result.json corepack pnpm live:ui-worker:result-check`
  - `corepack pnpm prod:env:check`
  - `corepack pnpm staging:evidence-env:check`
  - `STAGING_RELEASE_ARTIFACTS_TARGET=/path/to/artifacts/staging corepack pnpm staging:release-artifacts:check`
  - `corepack pnpm staging:first-gates:check`
  - `corepack pnpm prod:evidence:check --summary-file artifacts/staging/production-summary.json`
  - `corepack pnpm prod:evidence:summary:check`
  - `corepack pnpm prod:evidence:templates:check`
  - `corepack pnpm prod:plan:check`
  - `AI_REPORT_SUMMARY_EVIDENCE_TARGET=file:///.../ai-report-summary.json corepack pnpm ai-report-summary:check`
  - `IDENTITY_MIGRATION_TARGET=file:///.../identity-migration.json corepack pnpm identity-migration:check`
  - `FINANCIAL_RETENTION_TARGET=file:///.../financial-retention.json corepack pnpm financial-retention:check`
  - `UAT_EVIDENCE_TARGET=file:///.../uat.json corepack pnpm uat:check`
  - `RLS_LIVE_EVIDENCE_TARGET=file:///.../rls-live.json corepack pnpm rls:live:check`
  - `RATE_LIMIT_EVIDENCE_TARGET=file:///.../rate-limit.json corepack pnpm rate-limit:check`
  - `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET=file:///.../inline-upload-content-migration.json corepack pnpm inline-upload-content:check`
  - `AUDIT_NULL_TENANT_EVIDENCE_TARGET=file:///.../audit-null-tenant.json corepack pnpm audit-null-tenant:check`
  - `SMS_PROVIDER_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/sms-provider.json corepack pnpm sms:smoke`
  - `NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/notification-provider.json corepack pnpm notification:smoke`
  - `corepack pnpm upload-av:check`
- Risk ve rollback:
  - Yuksek risk; gercek secret/provider/staging bagimliligi var.
  - Rollback: evidence kosularini once staging-only ve read-only artifact modunda calistirmak.

### Faz 10 - Pilot ve Go-live Kapanisi

- Amac: Pilot kurum kabulunu, production summary zincirini ve go-live kararini tek kanit paketiyle kapatmak.
- Degisecek dosya alanlari: `docs/evidence-templates/**`, `docs/phase-6-production-readiness.md`,
  `docs/phase-6-ops-runbook.md`, `scripts/check-go-live-evidence.mjs`,
  `scripts/check-live-status-evidence.mjs`, staging/prod artifact hedefleri.
- Sorumlu agent: `ops_release_engineer`, `qa_verification_engineer`, `privacy_governance_reviewer`.
- Kabul kriterleri:
  - `PILOT_EVIDENCE_TARGET` gercek production pilot raporuna baglanir; 14+ gun pilot, AC-01..AC-10,
    gercek import, optik dongu, rapor/karne, PDF/Excel, veli portali ve bos `gaps` zorunludur.
  - `GO_LIVE_EVIDENCE_TARGET` ayni artifact setindeki production summary, pilot ve live-status bundle'ina
    cozulur; placeholder/test/example/redacted hedefler normal kosuda reddedilir.
  - Canli Durum 18/18 dis gate `PASS` olur; her gate source date/reference, source `result=PASS`
    ve source `environment=production` sozlesmesini tasir.
  - `report-generation:perf` 10k sonuc, 10k ogrenci ve `generationDurationMsMax=60000` esigiyle
    go-live linked production summary icinde yer alir; `report-generation:smoke` Faz 10 kapanisi sayilmaz.
- Test/dogrulama:
  - `PILOT_EVIDENCE_TARGET=file:///.../pilot.json corepack pnpm pilot:check`
  - `GO_LIVE_EVIDENCE_TARGET=file:///.../go-live.json corepack pnpm go-live:check`
  - `LIVE_STATUS_EVIDENCE_TARGET=file:///.../live-status.json corepack pnpm live:status:check`
  - `REPORT_GENERATION_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/report-generation.json corepack pnpm report-generation:perf`
  - `PRODUCTION_EVIDENCE_SUMMARY_TARGET=file:///.../production-summary.json corepack pnpm prod:evidence:summary:check`
  - `UAT_EVIDENCE_TARGET=file:///.../uat.json corepack pnpm uat:check`
  - `DEPLOYMENT_ROLLBACK_TARGET=file:///.../deployment-rollback.json corepack pnpm deployment:rollback:check`
  - `corepack pnpm prod:evidence:templates:check`
  - `corepack pnpm ops:check` (statik/toparlayici gate; target'li 18/18 Canli Durum yerine gecmez)
  - `corepack pnpm prod:plan:check`
- Risk ve rollback:
  - Yuksek risk; canli kurum, provider, production summary ve onay zinciri bagimliligi var.
  - Rollback: go-live kararini `APPROVED` yerine `ON_HOLD` tutmak, release candidate'i staging'de
    dondurmak ve sadece read-only artifact tekrar kosulari yapmak.

## Plan Kaydindaki Isler

- Mevcut plan kaydinda `apps/web/e2e-next/a11y-next.spec.ts` gate'i `critical + serious`
  axe ihlallerini engelleyecek sekilde sertlestirilmis gorunuyor.
- Bu guncellemede Faz 1 lokal olarak dogrulandi.
- `docs/DECISIONS.md` ve `docs/product-journeys-v1.md`, iSEM fixture'in geldigi ama staging/pilot
  kanitinin ayri kapida bekledigi gercegine gore guncellendi.
- Faz 4A icin API/worker fixture testleri calistirildi ve gecti.
- Faz 2 icin kritik auth/exam/raw-import/report OpenAPI slice'i lokal olarak dogrulandi:
  `corepack pnpm --filter @o-okul/api typecheck`, `corepack pnpm --filter @o-okul/api test`,
  `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate` gecti.
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
  `refreshToken` tasimaz. `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/auth/auth.service.test.ts src/auth/token-service.test.ts src/auth/session-store.test.ts src/http/api-response.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate` gecti.
  Ilk birlesik hedefli auth test kosusunda `socket hang up` flake'i goruldu; izole rerun'lar
  temiz gecti.
- Backend API subagent'in onerdigi `payment-plans` sozlesme slice'i uygulandi:
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/payment/payment.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate` gecti.
- PR gate subagent payment slice'inda P0/P1 bulgu bulmadi; P2 olarak isaretledigi payment OpenAPI
  alan/enum/minItems drift riski `scripts/generate-openapi.mjs` checker detaylariyla kapatildi.
- Announcement create/delivery sozlesme slice'i uygulandi:
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/announcement/announcement.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate` gecti.
- Announcement read/portal sozlesme slice'i uygulandi: `GET /api/v1/announcements`,
  `GET /api/v1/announcements/{id}`, recipient/delivery report read endpointleri ve
  ogrenci/veli/ogretmen `/me/**/announcements` list/read endpointleri OpenAPI artifact'inde
  `{ data }` / `{ data, meta }` zarfi, item required alanlari ve enum/`readAt` format
  kurallariyla gorunur. API success envelope tipleri `ApiItemResponse<T>` ve
  `ApiListResponse<T>` olarak shared-types'a tasindi. Backend API subagent read-only review'i
  bu slice icin endpoint listesini ve read POST'un retry'da `readAt` guncellemesi nedeniyle
  idempotency header eklenmemesi gerektigini dogruladi. `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/announcement/announcement.e2e.test.ts src/me/me-access-matrix.e2e.test.ts src/http/api-response.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate` gecti.
- PR gate subagent announcement create/delivery slice'inda P0/P1/P2 blocker bulmadi; kalan risk
  full idempotency envanteri ve elle yazilan OpenAPI overlay drift testi olarak plan kapsaminda kalir.
- Announcement create replay/conflict riski kapatildi: `POST /api/v1/announcements` opsiyonel
  `Idempotency-Key` kabul eder; replay ayni response'u, farkli body ise 409 dondurur ve OpenAPI
  artifact'inde header opsiyonel gorunur. `corepack pnpm --filter @o-okul/api exec vitest run src/announcement/announcement.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate` gecti.
- Student create replay/conflict riski kapatildi: `POST /api/v1/students` opsiyonel
  `Idempotency-Key` kabul eder; `StudentCreateRequest` shared-types'a tasindi; replay ayni
  response'u, farkli body ise 409 dondurur ve OpenAPI artifact'inde request body, `{ data }`
  envelope, status enum'u ve header opsiyonel gorunur. `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/student/student.service.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate` gecti.
- PR gate subagent student-create slice'inda guardian validasyonunun create yan etkisinden sonra
  hata firlatabilecegini P1 buldu; guardian input parse'i store create/createMany oncesine alindi.
  `guardian: {}` + `Idempotency-Key` negatifinde ogrenci olusmadigi `src/app.e2e.test.ts` ile
  kanitlandi. Production bootstrap'in `{ data }` response envelope davranisi
  `corepack pnpm --filter @o-okul/api exec vitest run src/http/api-response.e2e.test.ts`
  ile ayrica dogrulandi.
- School class/teacher-assignment sozlesme slice'i uygulandi: `ClassCreateRequest`,
  `ClassUpdateRequest`, `TeacherAssignmentCreateRequest` ve `TeacherAssignmentUpdateRequest`
  shared-types'a tasindi. `POST/PATCH /api/v1/classes`,
  `POST /api/v1/teachers/{id}/assignments` ve
  `PATCH /api/v1/teachers/{id}/assignments/{assignmentId}` OpenAPI artifact'inde request body
  ve `{ data }` response envelope tasir. Teacher assignment role enum'u, create icin
  `classId` veya `studentId` anyOf hedef kuralı ve class/assignment PATCH `minProperties: 1`
  checker kapsamindadir. `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/school/school.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate` gecti.
- Program/teacher-note sozlesme slice'i uygulandi: `ScheduleLessonCreateRequest`,
  `ScheduleLessonUpdateRequest`, `StudySessionCreateRequest`, `StudySessionUpdateRequest`,
  `TeacherNoteCreateRequest` ve `TeacherNoteUpdateRequest` shared-types'a tasindi.
  `POST/PATCH /api/v1/schedule-lessons`, `POST/PATCH /api/v1/study-sessions` ve
  `POST/PATCH /api/v1/teacher-notes` OpenAPI artifact'inde request body ve `{ data }`
  response envelope tasir. `scripts/generate-openapi.mjs` bu slice icin required alanlari,
  teacher-note visibility enum'unu, study-session `studentIds.minItems` ve `capacity.minimum`
  kurallarini fail-fast kontrol eder. `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`, `corepack pnpm --filter @o-okul/api build`,
  `corepack pnpm openapi:generate` ve `corepack pnpm --filter @o-okul/api exec vitest run src/program/schedule.e2e.test.ts src/program/study-session.e2e.test.ts src/teacher-note/teacher-note.e2e.test.ts`
  gecti.
- Backend API subagent program/teacher-note slice'inda zaman araligi ve bos PATCH risklerini
  P1/P2 olarak isaretledi; `ScheduleLesson` ve `StudySession` create/patch body validasyonu
  `endsAt > startsAt` kuralini, `ScheduleLesson`/`StudySession`/`TeacherNote` patch body'leri
  en az bir alan kuralini uygular hale getirildi. OpenAPI PATCH semalari `minProperties: 1`
  tasir ve `scripts/generate-openapi.mjs` `requestMinProperties`, `minimum`, `minItems` ve enum
  kurallarini fail-fast kontrol eder. Re-review P0/P1/P2 bulgu vermedi.
  `corepack pnpm --filter @o-okul/api test` de gecti.
- Support-ticket sozlesme slice'i uygulandi: `SupportTicketCreateRequest`,
  `SupportTicketUpdateRequest`, `SupportTicketAttachmentCreateRequest` ve
  `SupportTicketCommentCreateRequest` shared-types'a tasindi. `POST/PATCH /api/v1/support-tickets`,
  `POST /api/v1/support-tickets/{id}/attachments` ve `POST /api/v1/support-tickets/{id}/comments`
  OpenAPI artifact'inde request body ve `{ data }` response envelope tasir. Attachment/comment
  create endpointlerinde `Idempotency-Key` opsiyonel gorunur; attachment response semasi ham
  `fileBase64`/`contentBase64` alanlarini yasaklar. `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/support-ticket/support-ticket.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate` gecti.
  Ilk tam API testinde `school.e2e.test.ts` icin tek seferlik HTTP parse flake'i goruldu;
  hedefli `school.e2e.test.ts` rerun ve sonraki tam `corepack pnpm --filter @o-okul/api test`
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
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/homework/homework.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate` gecti.
- Faz 4 raw import object key PII-safe dilimi lokal olarak kapatildi:
  `createRawImportS3Key` artik kullanici dosya adini object key'in son segmentine yazmaz;
  sha segmenti altinda sabit `source` objesi kullanir. Unit test ve HTTP e2e, `answers.dat`,
  iSEM ve TCKN-benzeri dosya adi parcalarinin `s3Key` icinde tasinmadigini dogrular.
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/exam/raw-import-upload.service.test.ts src/exam/raw-import.controller.e2e.test.ts src/exam/s3-raw-import-archive-store.test.ts src/exam/postgres-raw-import-repository.test.ts src/exam/raw-import-quarantine-store.test.ts`,
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
  `65 composite, 21 izlenen legacy istisna` seviyesine iner. `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @o-okul/db test`, `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @o-okul/api exec vitest run src/homework/homework.e2e.test.ts`
  gecti.
- Faz 3 icin `ScheduleLesson.class` legacy FK istisnasi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621175000_schedule_lesson_class_composite_fk/migration.sql`
  orphan/cross-tenant class preflight'i ekler, `ScheduleLesson.class` artik `[tenantId, classId]`
  -> `Class[tenantId, id]` composite FK kullanir ve tenant relation checker sonucu
  `66 composite, 20 izlenen legacy istisna` seviyesine iner. `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @o-okul/db test`, `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @o-okul/api exec vitest run src/program/schedule.e2e.test.ts`
  gecti.
- Faz 3 icin study-session tenant FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621182000_study_session_composite_fks/migration.sql`
  `StudySession.class`, `StudySessionStudent.studySession` ve `StudySessionStudent.student`
  parent'lari icin orphan/cross-tenant preflight'i ekler. Bu uc relation artik tenant composite
  FK kullanir ve tenant relation checker sonucu `69 composite, 17 izlenen legacy istisna`
  seviyesine iner. `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @o-okul/db test`, `corepack pnpm tenant-db:check`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/program/study-session.e2e.test.ts`
  ve `corepack pnpm prod:plan:check` gecti. `tenant_security_reviewer` read-only review'i
  P0/P1/P2 bulgu vermedi; staging/prod preflight ve DB-level negatif insert kaniti Faz 5
  sahibinde kalir.
- Faz 3 icin teacher-assignment class/student FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621184500_teacher_assignment_class_student_composite_fks/migration.sql`
  nullable `TeacherAssignment.class` ve `TeacherAssignment.student` parent'lari icin
  orphan/cross-tenant preflight'i ekler. Bu iki relation artik tenant composite FK kullanir ve
  tenant relation checker sonucu `71 composite, 15 izlenen legacy istisna` seviyesine iner.
  `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @o-okul/db test`, `corepack pnpm tenant-db:check`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/school/teacher-assignment-store.test.ts`
  ve `corepack pnpm prod:plan:check` gecti. `tenant_security_reviewer` read-only review'i
  P0/P1/P2 bulgu vermedi; staging/prod preflight ve DB-level negatif insert kaniti Faz 5
  sahibinde kalir.
- Faz 3 icin guardian-student FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621191000_guardian_student_composite_fks/migration.sql`
  `GuardianStudent.guardian` ve `GuardianStudent.student` parent'lari icin orphan/cross-tenant
  preflight'i ekler; `Guardian` parent'i `tenantId + id` unique anahtari tasir. Bu iki relation
  artik tenant composite FK kullanir ve tenant relation checker sonucu
  `73 composite, 13 izlenen legacy istisna` seviyesine iner. `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @o-okul/db test`, `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @o-okul/api exec vitest run src/school/guardian-student-store.test.ts`
  gecti. `tenant_security_reviewer` read-only review'i P0/P1/P2 bulgu vermedi; staging/prod
  preflight ve DB-level negatif insert kaniti Faz 5 sahibinde kalir.
- Faz 3 icin zorunlu teacher parent FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621193000_teacher_composite_fks/migration.sql`
  `DevelopmentAssessment.teacher`, `TeacherAssignment.teacher`, `TeacherNote.teacher`,
  `ScheduleLesson.teacher` ve `StudySession.teacher` parent'lari icin orphan/cross-tenant
  preflight'i ekler; `Teacher` parent'i `tenantId + id` unique anahtari tasir. Bu bes relation
  artik tenant composite FK kullanir ve tenant relation checker sonucu
  `78 composite, 8 izlenen legacy istisna` seviyesine iner. `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`, `corepack pnpm db:rls:check`,
  `corepack pnpm --filter @o-okul/db test`, `corepack pnpm tenant-db:check`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/program/schedule.e2e.test.ts src/program/study-session.e2e.test.ts src/teacher-note/teacher-note.e2e.test.ts src/school/teacher-assignment-store.test.ts src/development/development.service.test.ts`,
  `corepack pnpm prod:plan:check` ve `git diff --check` gecti. `tenant_security_reviewer`
  read-only review'i P0/P1/P2 bulgu vermedi; staging/prod preflight ve DB-level negatif insert
  kaniti Faz 5 sahibinde kalir.
- Faz 3 icin homework/support-ticket nullable parent FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621200000_homework_support_ticket_composite_fks/migration.sql`
  `Homework.sourceMaterial` ve `SupportTicket.class` parent'lari icin orphan/cross-tenant
  preflight'i ekler. Bu iki relation artik tenant composite FK kullanir; `SetNull` hard-delete
  semantigi, mevcut soft-delete davranisiyla uyumlu ve veri kaybina daha kapali olacak sekilde
  `Restrict`e cekildi. Tenant relation checker sonucu `80 composite, 6 izlenen legacy istisna`
  seviyesine iner. `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`,
  `corepack pnpm --filter @o-okul/db test`, `corepack pnpm db:rls:check`,
  `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @o-okul/api exec vitest run src/homework/homework.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts`
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
  `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`,
  `corepack pnpm --filter @o-okul/db test`, `corepack pnpm db:rls:check`,
  `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @o-okul/api exec vitest run src/payment/payment.e2e.test.ts src/payment/payment-store.test.ts src/report/report-generation.service.test.ts src/report/report-snapshot-store.test.ts`
  gecti. `data_platform_engineer` read-only review'i bu iki iliskiyi Student yasam dongusunden
  daha dar riskli siradaki dilim olarak onermisti; staging/prod preflight ve DB-level negatif
  insert kaniti Faz 5 sahibinde kalir.
- Faz 3 icin student lifecycle class FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621204000_student_lifecycle_class_composite_fks/migration.sql`
  `StudentClassHistory.class` ve `StudentEnrollment.class` parent'lari icin orphan/cross-tenant
  preflight ekler. Bu iki relation artik tenant composite FK kullanir; `SetNull` hard-delete
  semantigi, mevcut soft-delete davranisiyla uyumlu olacak sekilde `Restrict`e cekildi.
  Tenant relation checker sonucu `84 composite, 2 izlenen legacy istisna` seviyesine iner.
  `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`,
  `corepack pnpm --filter @o-okul/db test`, `corepack pnpm db:rls:check`,
  `corepack pnpm tenant-db:check` ve
  `corepack pnpm --filter @o-okul/api exec vitest run src/student/student-class-history-store.test.ts src/student/student-enrollment-store.test.ts src/school/school.e2e.test.ts`
  gecti. Kalan `Student.class` ve `Student.responsibleTeacher` iliskileri ana ogrenci
  gorunurluk/ogretmen scope etkisi nedeniyle ayri, daha dikkatli migration diliminde kalir.
- Faz 3 icin ana ogrenci class/responsible-teacher FK dilimi lokal olarak kapatildi:
  `packages/db/prisma/migrations/20260621210000_student_class_teacher_composite_fks/migration.sql`
  `Student.class` ve `Student.responsibleTeacher` parent'lari icin orphan/cross-tenant preflight
  ekler. Bu iki relation artik tenant composite FK kullanir; `SetNull` hard-delete semantigi,
  mevcut soft-delete davranisiyla uyumlu olacak sekilde `Restrict`e cekildi. Tenant relation
  checker sonucu `86 composite, 0 izlenen legacy istisna` seviyesine iner.
  `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts`,
  `node packages/db/scripts/check-tenant-relation-fks.mjs`,
  `corepack pnpm --filter @o-okul/db test`, `corepack pnpm db:rls:check`,
  `corepack pnpm tenant-db:check`,
  `corepack pnpm --filter @o-okul/api typecheck` ve
  `corepack pnpm --filter @o-okul/api exec vitest run src/student/student-profile.e2e.test.ts src/school/school.e2e.test.ts`
  gecti. Bu Faz 3'u lokal schema/test seviyesinde kapatir; canli/staging preflight ve
  DB-level negatif insert kaniti Faz 5 kapisinda kalir.
- Faz 4 icin optik/rapor URL state ve live-region dilimi lokal olarak kapatildi:
  `apps/web/app/(app)/kurum/optik/parser-config-page.tsx` optik `examId` ve aktif adimi
  URL state ile korur; `apps/web/app/(app)/kurum/raporlar/reports-page.tsx` aktif rapor
  sekmesini URL state ile korur. Global hata mesajlari `role="alert"`, islem durum
  mesajlari `role="status"` ile okunur. `apps/web/e2e-next/optik-workspace-contract-next.spec.ts`,
  `apps/web/e2e-next/report-workspace-contract-next.spec.ts` ve
  `scripts/check-web-ux-baseline.mjs` bu kontrati kilitler. `corepack pnpm --filter @o-okul/web typecheck`,
  `corepack pnpm web:ux-baseline:check`,
  `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/optik-workspace-contract-next.spec.ts e2e-next/report-workspace-contract-next.spec.ts`,
  `corepack pnpm web:ux-contract:check`, `corepack pnpm web:a11y:check`
  ve `git diff --check` gecti. Bu Faz 4'u tamamen kapatmaz; genis UI data-loading
  refactor'u, real KVKK staging/prod target'i ve PII negatif artifact kanitlari acik kalir.
- Faz 4 icin rapor workspace lazy ogrenci liste/detay yukleme dilimi lokal olarak
  kapatildi: `apps/web/app/(app)/kurum/raporlar/reports-page.tsx` artik sayfa acilisinda
  `/students` listesini yuklemez; liste yalniz `Raporu getir` sonrasi snapshot varsa yuklenir.
  Karne, progress ve hata kitapcigi detaylari rapor sorgusunda otomatik gelmez, kullanici
  ogrenci satirindan karneyi actiginda yuklenir. `apps/web/e2e-next/report-workspace-contract-next.spec.ts`
  ilk acilista 0 ogrenci liste/detay istegini, sinifli sorgudan sonra 1 adet
  `/students?classId=...` istegini, sinifsiz raporda 0 genis `/students` ve dedupe edilmis
  `/students/:id` isteklerini, karne seciminden sonra 3 detay istegini dogrular.
  `corepack pnpm --filter @o-okul/web typecheck`,
  `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/report-workspace-contract-next.spec.ts`
  ve `corepack pnpm web:ux-contract:check` gecti. Kalan risk performans icin ileride tek
  batch endpoint dusunulebilmesidir; privacy acisindan genis ogrenci listesi yukleme kapisi
  lokal kontratta kapandi.
- Faz 4 icin rapor analitik paneli component/perf dilimi lokal olarak kapatildi:
  `apps/web/app/(app)/kurum/raporlar/reports-page.tsx` icindeki `activeTab === "analytics"`
  blogu ayni dosyada `ReportAnalyticsPanel` component'ine tasindi. Branch radar, kazanım
  satirlari, sinif barlari, sinav sonuc donut'u ve progress points gibi chart/table turevleri
  artik ana rapor workspace render'inda degil, yalniz analitik sekmesi gorunurken uretilir.
  Referans map'leri, ogrenci sonuc satirlari, snapshot context/input refs ve secili sinav etiketi
  `useMemo` ile sabitlendi; mevcut lazy chart import'lari, `next-report-analytics-section`
  class'i, `Rapor özeti`, `Kurum analitiği`, `Başarı %`, `Net` ve `Soru` gorunur kontratlari
  degismedi. `scripts/check-web-ux-baseline.mjs` `function ReportAnalyticsPanel` ve memoized
  derived-data guardrail'lerini izler. `corepack pnpm --filter @o-okul/web typecheck`,
  `corepack pnpm web:ux-baseline:check` ve
  `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/report-workspace-contract-next.spec.ts`
  gecti. Bu, optik workspace icin daha genis component/perf hardening'i ve real KVKK staging/prod
  target'ini kapatmaz.
- Faz 4 icin optik rapor context privacy/perf dilimi lokal olarak kapatildi:
  `apps/web/app/(app)/kurum/optik/parser-config-page.tsx` artik rapor uretimi veya
  `Raporları getir` yenilemesi sirasinda filtresiz `/students` listesini yuklemez.
  Rapor context'i once READY/STALE snapshot ve participant kayitlarindan gereken ogrenci
  id'lerini cikarir, id'leri dedupe eder ve yalniz `/students/:id` detaylarini ister.
  Karantina ogrenci aramasi `q + limit` ile sinirli kalir; genis liste endpoint'i
  arama disi akista kullanilmaz. Ayni dilimde `QuarantineResolutionPanel` ogrenci secenekleri
  ve kolonlari, `OpticalReportPanel` snapshot kolonlari ve `studentRows`, `useMemo` ile
  sabitlendi; `Optik katılımcı sonuçları` kolonlari `opticalStudentResultColumns` olarak
  module-level tasindi. `apps/web/e2e-next/optik-workspace-contract-next.spec.ts` rapor
  uretimi ve rapor yenileme sonrasi `optik rapor üretimi geniş /students listesi yüklememeli`
  ve `optik rapor yenileme geniş /students listesi yüklememeli` negatiflerini, `Ada Kaya`
  sonuc gorunumunu ve tekil `/students/student-a` detay yolunu dogrular. `scripts/check-web-ux-baseline.mjs`
  bu tokenlari, `loadStudentsByIds`, `reportStudentIds`, `opticalStudentResultColumns` ve
  `loadStudents(accessToken).catch(() => [])` no-token guardrail'ini izler.
  `corepack pnpm --filter @o-okul/web typecheck`,
  `corepack pnpm web:ux-baseline:check` ve
  `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/optik-workspace-contract-next.spec.ts`
  gecti. Bu lokal kontrat, iSEM 254 satir/staging real-data performans kaniti veya real
  KVKK staging/prod artifact'i yerine gecmez.
- Faz 4 icin optik karantina `rawRow` UI PII negatif dilimi lokal olarak kapatildi:
  `apps/web/e2e-next/optik-workspace-contract-next.spec.ts` artik karantina response'unda
  ham TCKN-benzeri alan, e-posta, cevap dizisi ve ham satir bulunan bir kaydi fixture'a
  ekler; UI sadece satir numarasi, sebep, durum ve islem alanlarini gosterir. Test,
  `rawRow` icindeki hostile degerlerin sayfa body metnine sizmadigini dogrular. Ayni dilimde
  `apps/web/app/(app)/kurum/optik/parser-config-page.tsx` karantina satiri yukleme sonrasi
  otomatik/filtresiz `/students` cagrisini kaldirdi; ogrenci secenekleri ayri state'te ve
  yalniz `q + limit=10` arama aksiyonuyla gelir. Bu dilim operator UI sizintisini ve
  karantina DOM'unda genis ogrenci listesi riskini kapatir; kalici staging/prod evidence
  artifact PII negatifleri Faz 5 dis kanit kapisinda kalir.
- Faz 4/Faz 5 icin iSEM optik smoke evidence karantina/raw PII negatif dilimi lokal olarak
  kapatildi: `scripts/smoke-evidence.mjs` iSEM optik smoke payload'ini artik ham karantina
  alan adlari (`rawRow`, `rawLine`, `rawText`, `sourceFileName`, `nationalId`, TCKN vb.)
  ve allowed alanlara gizlenmis TCKN-benzeri deger, ham e-posta veya ham TXT dosya yolu
  ile ham telefon ve uzun optik satir/cevap dizisi icin recursive olarak tarar; hash/SHA alanlari
  bu kontrolun disinda kalir.
  `scripts/check-smoke-evidence-contract.mjs` rawRow, rawLine, TCKN-benzeri parser version,
  ham `ornek-veriler/iSEM .txt` path, ham optik satir, ham telefon, ham e-posta,
  `sourceFileName`, `objectKey` ve `s3Key` negatiflerini fail-fast fixture'a ekledi.
  `corepack pnpm
  smoke:evidence:check`, `corepack pnpm prod:evidence:templates:check` ve `corepack pnpm
  --filter @o-okul/web typecheck` gecti; ayrica
  `ISEM_OPTICAL_PIPELINE_ALLOW_EXAMPLE_EVIDENCE=1 ISEM_OPTICAL_PIPELINE_TARGET=file://$PWD/docs/evidence-templates/isem-optical-pipeline.example.json node scripts/check-isem-optical-pipeline-evidence.mjs`
  gecti. Bu lokal sozlesme gercek staging/prod evidence
  artifact'inin yerini almaz; o artifact'lerin uretilmesi Faz 5 dis kosusunda kalir.
- Faz 4/Faz 5 icin iSEM optik local live smoke ve log/privacy hardening dilimi
  ilerletildi: local Colima/Docker uzerinde Postgres, Redis ve MinIO kaldirildi,
  `corepack pnpm --filter @o-okul/db exec prisma migrate status --config prisma.config.ts`
  `Database schema is up to date!` dondurdu ve
  `S3_ACCESS_KEY_ID=minioadmin S3_SECRET_ACCESS_KEY=minioadmin123 S3_BUCKET=o-okul-local ISEM_OPTICAL_PIPELINE_SMOKE_EVIDENCE_FILE=artifacts/local/isem-optical-pipeline.json corepack pnpm isem-optical-pipeline:smoke`
  gecti. Artifact `254 student/participant/matched`, `0 quarantine`, `254 ExamResult`,
  `254 reportResult`, `reportReady=true`, `gaps=[]` ve 2 hashli ornek skor tasir;
  direct payload validation `validateSmokeEvidencePayload(... expectedCheck: "isem_optical_pipeline_smoke")`
  ile gecti. `package.json` iSEM smoke komutu artik POSIX shell env atamasina bagli olmadan
  Node wrapper ile varsayilan `LOG_ENABLED=false` calisir; basari/hata loglari ham ogrenci
  no/internal id tasimaz, ornek skor loglari sadece `sampleN` ve count/net degerlerini yazar.
  `apps/api/src/observability/logging.ts` pino-http logunda ham request objesi ve
  Authorization header'i basmayacak sekilde daraltildi; `apps/api/src/observability/logging.test.ts`
  ham log satirinda e-posta, bearer token ve `authorization` metnini negatif dogrular.
  `ISEM_OPTICAL_PIPELINE_UI_WORKER_EVIDENCE_FILE` yalniz `private` path segmenti altinda
  0600 modunda yazilir; `LIVE_UI_WORKER_EVIDENCE_PATH` preflight'i public credential
  input path'ini ve 0600 disi izinleri reddeder. `corepack pnpm live:ui-worker:evidence-contract`,
  `corepack pnpm smoke:evidence:check`, hedefli API logging testi ve `corepack pnpm
  isem-optical-pipeline:smoke` gecti. Bu local smoke, staging/prod veya pilot kaniti
  yerine gecmez; Faz 5 dis kanit kapisi acik kalir.
- Faz 5 staging release bundle kalicilik kapisi lokal olarak sertlestirildi:
  `scripts/check-staging-release-artifacts.mjs` artik `STAGING_RELEASE_ARTIFACTS_TARGET`
  hedefinin `/tmp` veya `/var/tmp` altinda kalmasini reddeder; `scripts/check-prod-evidence-templates.mjs`
  temp path negatifini ve example evidence bayragi kapaliyken fixture bundle'in kirilmasini fail-fast
  korur ve `scripts/check-prod-readiness.mjs` bu statik beklentiyi
  izler. Bu, staging/prod kosusunun yerine gecmez; yalniz gercek kosudan indirilen bundle'in
  gecici path'ten kalici release kaniti gibi sayilmasini engeller.
- Faz 5 staging first-gates manifest target'i lokal olarak sertlestirildi:
  `STAGING_FIRST_GATES_TARGET` artik lokal temp path, symlink manifest dosyasi veya symlink
  parent directory uzerinden gelen manifest'i okumadan once reddeder; `prod:evidence:templates:check`
  temp/symlink negatifleriyle bu guardrail'i korur. Bu, staging/prod first-gates kosusunu
  uretmez; yalniz indirilen manifest target'inin kalici artifact oldugunu fail-fast kanitlar.
- Faz 5 production evidence projection ve iSEM/live-exam baglantisi lokal olarak sertlestirildi:
  `scripts/check-prod-evidence.mjs` summary uretirken KVKK `auditDiffRedactionVerified` ve RLS
  `tenantFkPreflight` bloklarini artik production summary'ye tasir; boylece zorunlu redaction ve
  tenant-FK preflight kanitlari summary projection'inda kaybolmaz. `scripts/check-isem-optical-pipeline-evidence.mjs`
  `artifacts/local/**` altindaki local smoke artifact'ini staging/prod kaniti olarak reddeder.
  `scripts/check-live-exam-cycle-evidence.mjs` tam sinav dongusu `evidenceReferences` listesinin
  iSEM ve UI-worker kanitini yalniz beklenen artifact dosya adlariyla baglamasini ister; substring
  marker dosyalari PASS sayilmaz. Yeni negatifler
  `scripts/check-prod-evidence-templates.mjs` ve iSEM readiness beklentileri `scripts/check-prod-readiness.mjs`
  icinde fail-fast korunur. Bu yine gercek staging/prod kosusu yerine gecmez; yalniz yanlis
  veya eksik kanitin PASS sayilmasini engeller.
- Faz 5 local smoke artifact ayrimi genisletildi: `scripts/check-live-exam-cycle-evidence.mjs`
  artik `evidenceReferences` icinde `artifacts/local/**` referansini reddeder; `scripts/check-live-ui-worker-result-evidence.mjs`
  `LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET` icin ayni local artifact reddini uygular.
  `scripts/check-prod-evidence-templates.mjs`, `scripts/check-live-ui-worker-evidence-contract.mjs`
  ve `scripts/check-prod-readiness.mjs` bu negatifleri lokal kapida korur. Bu degisiklik
  staging/prod evidence uretmez; local smoke ciktilarinin dis kanit gibi kullanilmasini engeller.
- Faz 5/Faz 10 local artifact hedef hijyeni provider ve Canli Durum zincirine genisletildi:
  `scripts/check-prod-evidence.mjs` provider smoke evidence file hedeflerinde,
  `scripts/check-live-status-evidence.mjs` `LIVE_STATUS_EVIDENCE_TARGET` icin,
  `scripts/generate-live-status-evidence.mjs` `LIVE_STATUS_EVIDENCE_OUTPUT` ve bagli
  go-live live-status hedefi icin, `scripts/check-go-live-evidence.mjs` ise
  `GO_LIVE_EVIDENCE_TARGET` ve `liveStatusEvidence.evidenceTarget` icin `artifacts/local/**`
  altini reddeder. `scripts/check-prod-evidence-templates.mjs` ve
  `scripts/check-prod-plan-status.mjs` bu negatifleri lokal kapida korur. Bu degisiklik
  staging/prod kanit uretmez; local smoke dosyalarinin final provider, Canli Durum veya
  go-live artifact'i gibi sayilmasini engeller.
- Faz 10 final external evidence kapisi eklendi: `scripts/check-final-external-evidence.mjs`
  ve `corepack pnpm prod:external-evidence:check` artik `PRODUCTION_EVIDENCE_SUMMARY_TARGET`,
  `LIVE_STATUS_EVIDENCE_TARGET`, `PILOT_EVIDENCE_TARGET` ve `GO_LIVE_EVIDENCE_TARGET`
  olmadan calismaz; production summary, 18/18 Canli Durum, pilot ve go-live checker'larini
  tek sirada kosar ve bu hedeflerin ayni artifact setine baglandigini dogrular.
  Final hedefleri `https://` ise gercek host olmali; `file://` ise lokal temp, `artifacts/local/**`,
  symlink dosya veya symlink parent dizin olamaz. `*_ALLOW_EXAMPLE_EVIDENCE=1` bayraklari
  ve `LIVE_STATUS_READINESS_PATH` icin pass-readiness fixture override'i bu final kapida reddedilir;
  final Canli Durum yalniz `docs/phase-6-production-readiness.md` ile dogrulanir.
  Bu, `corepack pnpm ops:check` sonucunun veya fixture/template kosularinin final dis kanitla karistirilmasini engeller;
  gercek staging/prod artifact'leri yine uretilmeden Faz 10 kapanmaz.
- Faz 5 provider smoke evidence PII guardrail'i lokal olarak sertlestirildi:
  `scripts/smoke-sms-provider.mjs` artik gercek SMS smoke icin bos `providerMessageId`
  ile kanit yazmaz; `scripts/smoke-evidence.mjs` SMS ve notification recipient alanlarinda
  maskeli degeri zorunlu tutar, ham telefon/e-posta/push endpoint'i ve sahte/test provider id'lerini
  reddeder. `scripts/check-prod-env.mjs` production notification smoke alicilarinda
  placeholder/test/example degerleri reddeder; `scripts/check-go-live-evidence.mjs` bagli
  production summary icindeki provider recipient alanlarini ayrica maskeli ve PII'siz ister.
  `scripts/check-smoke-evidence-contract.mjs`, `scripts/check-prod-evidence-templates.mjs`,
  `scripts/check-prod-readiness.mjs` ve `scripts/check-ops-config.mjs` bu negatifleri lokal
  kapida korur. Bu degisiklik provider/staging smoke kaniti uretmez; yalniz ham alici veya sahte
  provider kanitinin release/go-live PASS sayilmasini engeller.
- Faz 2 icin attendance ve teacher import OpenAPI/shared-contract dilimleri lokal olarak
  kapatildi: `AttendanceCreateRequest`, `AttendanceUpdateRequest` ve `TeacherImportRequest`
  shared-types'a eklendi; `apps/api/src/attendance/attendance-validation.ts` ve
  `apps/api/src/school/school-validation.ts` ilgili Zod body semalarini shared request
  tiplerine yaslar. `apps/api/src/openapi-contracts.ts` ve `scripts/generate-openapi.mjs`
  attendance list/summary/create/update/delete ile teacher import dry-run/commit
  endpoint'lerini request body, `{ data }` / `{ data, meta }`, enum, format ve 204
  no-content kurallariyla kilitler. `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/attendance/attendance.e2e.test.ts src/school/school.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate`
  ve scoped `git diff --check` gecti. Faz 2 hala tam kapanmaz; genis endpoint envanteri,
  `components.schemas` tek kaynak kaniti ve kalan bulk/idempotency karar dalgasi o turda acik kaldi.
- Faz 2 icin teacher import commit idempotency dilimi lokal olarak kapatildi:
  `POST /api/v1/teachers/imports` opsiyonel `Idempotency-Key` kabul eder; replay ayni
  response'u, ayni key farkli dosya ise 409 dondurur. Idempotency request hash'i ham
  `fileBase64` yerine dosya SHA-256 degeriyle olusur. `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/school/school.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate`
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
  semasini da fail-fast dogrular. `corepack pnpm --filter @o-okul/api build`,
  `corepack pnpm openapi:generate` ve `corepack pnpm idempotency:inventory:check` gecti.
- Faz 2 icin exam read/update/list sozlesme dilimi lokal olarak genisletildi:
  `GET /api/v1/exams`, `GET /api/v1/exams/{examId}`, `PATCH /api/v1/exams/{examId}`,
  `DELETE /api/v1/exams/{examId}` ve `GET /api/v1/exams/{examId}/participants`
  artik OpenAPI artifact'inde beklenen request body, `{ data }`, list `meta` veya `204`
  no-content sozlesmesiyle fail-fast korunur. Generator status enumlarini da dogrular.
  `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate`,
  `corepack pnpm idempotency:inventory:check` ve
  `corepack pnpm --filter @o-okul/api exec vitest run src/exam/exam.controller.e2e.test.ts`
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
  redaction kanit sozlesmesini guclendirir; runtime retention/purge karari ve production/pilot
  tekrar kosusu ayri kanit olarak izlenir.
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
- Faz 3/Faz 5 icin AuditLog null tenant siniflandirma kaniti lokal olarak eklendi:
  `scripts/check-audit-null-tenant-evidence.mjs` ve
  `docs/evidence-templates/audit-null-tenant.example.json`, `AuditLog.tenantId IS NULL`
  satirlarini `system`, `deletedTenant` ve `unknown` breakdown'iyle zorunlu hale getirir;
  `unknown.count=0`, `totalRows = tenantRows + nullTenantRows`, breakdown toplami
  `nullTenantRows`, kalici/symlink olmayan target ve bos `gaps` guardrail'leri korunur.
  `prod:evidence:check --summary-file` bu raporu `reports/audit-null-tenant.json` olarak
  yazar; production summary ve go-live linked summary ayni `auditNullTenant` bloklarini
  dogrular. Bu dilim kanit sozlesmesini guclendirir; gercek `AUDIT_NULL_TENANT_EVIDENCE_TARGET`
  staging/prod artifact'i halen uretilmelidir.
- Faz 5 icin inline upload migration evidence semantik negatifleri lokal olarak genisletildi:
  `prod:evidence:templates:check`, `contentBase64WriteDisabled=false`,
  `downloadUrlExpiresInSeconds=301`, migration sonrasi `pendingRows=1`,
  `pendingBase64Characters=1` ve dry-run pending satirindan az `migratedRows` durumlarini
  fail-fast reddeder. `SupportTicketAttachment` Postgres store testi de S3 `storageKey`
  yaziminda insert parametresinin `contentBase64=null` kaldigini ve public record'da
  `contentBase64/storageKey` donmedigini homework testiyle simetrik korur. Bu dilim
  kanit sozlesmesini guclendirir; gercek dry-run + onayli migrate artifact'i ve
  `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET` staging/prod kosusu halen Faz 5 dis kanitidir.
- Faz 5 icin staging evidence env sozlesmesi audit null tenant hedefiyle senkronize edildi:
  `AUDIT_NULL_TENANT_EVIDENCE_TARGET` artik `prod:env:check` required evidence target setinde,
  `docs/evidence-templates/staging-evidence.env.example` icinde ve ops/readiness statik
  kapilarinda zorunlu gorunur. Bu dilim `prod:evidence:check` icinde kosulan audit null tenant
  raporunun staging secret env'de eksik kalip evidence job sirasinda gec fail etmesini engeller;
  gercek `AUDIT_NULL_TENANT_EVIDENCE_TARGET` staging/prod artifact'i yine uretilmelidir.
- Faz 5 icin UI-worker result target'i staging/prod env sozlesmesine baglandi:
  `LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET` artik `.env.example`, staging evidence secret ornegi,
  `prod:env:check` required evidence target seti ve staging env negatifleri icinde zorunludur.
  Ayrica `prod:evidence:check --summary-file` bu target'i okuyup `reports.liveUiWorkerResult`
  olarak yazar; production summary ve go-live linked summary bu raporu, `pnpm live:ui-worker:smoke`
  komutunu, PDF/Excel indirme ve ogrenci/veli portal gorunumunu zorunlu tutar. Bu, kalici result
  artifact'inin secret/env hazirliginda veya release summary zincirinde eksik kalmasini engeller.
  Bu turda remote/staging result artifact'i uretilmistir; production summary/live-status zincirine
  baglanmadigi surece Faz 5 final kapanisi sayilmaz.
- Faz durum tablosu artik `prod:plan:check` tarafindan korunur: Faz 3/4/4A/5/10 satirlari
  staging/prod, pilot ve go-live kanitlari tamamlanmadan `LOCAL_PASS` ya da tamamlandi
  anlamina gelen bir duruma cekilemez; `reports.liveUiWorkerResult` ve kalan dis kanit
  token'lari eksilirse statik kapida fail-fast yakalanir.
- Faz 10 go-live report-generation perf kaniti lokal olarak sertlestirildi:
  go-live linked production summary artik `pnpm report-generation:smoke` ile kapanmaz;
  `commandsPassed=["pnpm report-generation:perf"]`, `resultCount>=10000`,
  `studentCount>=10000` ve `thresholds.generationDurationMsMax=60000` sartlarini arar.
  `prod:evidence:templates:check` bu sozlesme icin smoke-command, 10k alti ve threshold
  negatiflerini kosar. Bu guardrail gercek perf artifact'i yerine gecmez; Faz 10 icin
  canli/staging `report-generation:perf` kaniti production summary/live-status zincirine hala baglanmalidir.
- Faz 5/Faz 10 icin Canli Durum gate seti genisletildi:
  live-status transition bundle'i artik yalniz 7 ust seviye kapidan olusmaz; live exam cycle,
  iSEM optical pipeline, UI-worker result, KVKK inventory, RLS live, inline upload migration,
  audit null tenant, rate limit, SMS/notification provider ve report-generation perf kanitlarini
  da 18 gate'lik PASS/NOT_RUN sozlesmesine baglar. Production readiness belgesinde bu yeni
  dis kanitlar `NOT_RUN` kalir; `prod:plan:check` bu satirlarin sessizce dusmesini engeller.
  `pnpm live:status:generate` ornek bundle'i 18/18 PASS fixture olarak uretebilir ama gercek
  staging/prod artifact'leri uretilmeden Faz 5/Faz 10 tamamlanmis sayilmaz.
- Faz 5 staging first-gates promotion guardrail'i genisletildi:
  staging release bundle artik first-gates Traefik URL/status/HSTS ve alert webhook URL/status/auth
  scheme alanlarini final `summary.smokeEvidence` ile eslestirir. Boylece farkli host veya farkli
  webhook ile alinmis erken gate kaniti ayni release summary'ye terfi edemez. `prod:evidence:templates:check`
  first-gates target mismatch negatifini kosar; gercek Traefik/alert staging artifact'i yine dis
  kanit olarak uretilmelidir.
- Faz 5/Faz 10 Canli Durum source guardrail'i sertlestirildi:
  live-status ve go-live linked live-status checker'lari artik source nesnesinde `result` varsa
  `PASS`, `environment` varsa `production` arar; `prod:evidence:templates:check` `FAIL` ve
  staging source negatiflerini kosar. Boylece PASS gate, staging veya fail olmus kaynak artifact'ten
  turetilerek terfi edemez. Bu guardrail gercek staging/prod artifact'lerinin yerine gecmez.
- Faz 2 icin school reference CRUD/class read-delete sozlesme dilimi lokal olarak kapatildi:
  `CampusCreateRequest`, `CampusUpdateRequest`, `CourseCreateRequest`, `CourseUpdateRequest`,
  `GradeLevelCreateRequest`, `GradeLevelUpdateRequest`, `LearningOutcomeCreateRequest`,
  `LearningOutcomeUpdateRequest`, `AcademicYearCreateRequest`, `AcademicYearUpdateRequest`,
  `AcademicTermCreateRequest` ve `AcademicTermUpdateRequest` shared-types'a tasindi; ilgili
  Zod body semalari bu tiplere baglandi. OpenAPI overlay ve generator, kampus/ders/seviye/
  kazanim/akademik yil/akademik donem CRUD ve class read-delete endpointlerinde request body,
  `{ data }` / `{ data, meta }` envelope, 204 delete ve tarih format sozlesmesini fail-fast
  korur. `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api build`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/school/school.e2e.test.ts`
  ve `corepack pnpm openapi:generate` gecti. Bu dilim Faz 2'yi ilerletir; guardian/teacher,
  portal/me, report read ve diger genis read/mutation yuzeyleri hala aciktir.
- Faz 2 icin development criteria/assessment sozlesme dilimi lokal olarak kapatildi:
  `DevelopmentCriterionCreateRequest`, `DevelopmentAssessmentScoreInput` ve
  `DevelopmentAssessmentCreateRequest` shared-types'a tasindi; Zod body semalari bu tiplere
  baglandi. OpenAPI overlay ve generator, `GET/POST /api/v1/development/criteria` ile
  `GET/POST /api/v1/development/assessments` endpointlerinde request body,
  `{ data }` / `{ data, meta }` envelope, visibility enum'u ve `scores.minItems=1`
  sozlesmesini fail-fast korur. `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/development/development.controller.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/http/api-response.e2e.test.ts src/http/api-version.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate` gecti.
  Bu dilim Faz 2'yi ilerletir; portal `/me/.../development-assessments` read yuzeyi ayri
  PII/RBAC slice'i olarak acik kalir.
- Faz 2 icin program/homework/payment/teacher-note read sozlesme dilimi lokal olarak
  kapatildi: `schedule-lessons`, `study-sessions`, `teacher-notes`, `payment-plans` ve
  ham icerik dondurmeyen `homework` read endpointleri mevcut record semalarina baglandi.
  OpenAPI overlay ve generator `{ data }` / `{ data, meta }` envelope, required alan,
  enum/minimum ve homework material file listesinde ham `contentBase64`/`fileBase64`/
  `storageKey` bulunmamasi sozlesmesini fail-fast korur. `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/program/schedule.e2e.test.ts src/program/study-session.e2e.test.ts src/teacher-note/teacher-note.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/homework/homework.e2e.test.ts src/payment/payment.e2e.test.ts`,
  `node --check scripts/generate-openapi.mjs`, `corepack pnpm --filter @o-okul/api build`
  ve `corepack pnpm openapi:generate` gecti. Bu dilim Faz 2'yi ilerletir; homework download
  endpoint'i inline `fileBase64` dondurebildigi icin ayri privacy/OpenAPI sozlesmesi olarak
  acik kalir.
- Faz 2 icin support-ticket read sozlesme dilimi lokal olarak kapatildi:
  `support-tickets`, `support-tickets/{id}`, `support-tickets/{id}/attachments` ve
  `support-tickets/{id}/comments` mevcut public record semalarina baglandi. OpenAPI overlay
  ve generator `{ data }` / `{ data, meta }` envelope, priority/status/content-type enum'u,
  attachment `byteSize.minimum=1` ve attachment listesinde ham `contentBase64`/`fileBase64`/
  `storageKey` bulunmamasi sozlesmesini fail-fast korur. `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/support-ticket/support-ticket.e2e.test.ts`,
  `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/http/api-response.e2e.test.ts src/http/api-version.e2e.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate`
  gecti. Bu dilim Faz 2'yi ilerletir; support attachment download endpoint'i inline
  `fileBase64` dondurebildigi icin ayri privacy/OpenAPI sozlesmesi olarak acik kalir.
- Faz 2 icin answer-key read/publish sozlesme dilimi lokal olarak kapatildi:
  `GET /api/v1/exams/{examId}/answer-keys` ve
  `POST /api/v1/exams/{examId}/answer-keys/{version}/publish` OpenAPI overlay ve
  generator tarafinda `{ data }` / `{ data, meta }` envelope, `branches`,
  `scoringConfig`, status enum'u, publish `status=PUBLISHED`, zorunlu `publishedAt`
  ve ham cevap/PII alan yasaklariyla fail-fast korunur. `corepack pnpm --filter
  @o-okul/api typecheck`, hedefli answer-key API/repository testleri,
  `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate`
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
  @o-okul/shared-types typecheck`, `corepack pnpm --filter @o-okul/api
  typecheck`, hedefli raw-import API/store testleri, `corepack pnpm --filter
  @o-okul/api build`, `corepack pnpm openapi:generate` ve `corepack pnpm
  idempotency:inventory:check` gecti. Bu dilim raw-import/import-quarantines ozelinde
  acik operation-contract borcunu kapatir; staging evidence ve `rawRow` PII negatifleri
  Faz 4/Faz 5 sahibinde kalir.
- Faz 2 auth/session public DTO sertlestirmesi lokal olarak kapatildi:
  `POST /api/v1/auth/login`, `POST /api/v1/auth/totp/verify` ve
  `POST /api/v1/auth/refresh` response'lari ham `SessionRecord` yerine sadece public
  `Session` alanlarini dondurur. OpenAPI generator auth success response'larinda
  `refreshToken`, `refreshTokenHash`, `tokenFamilyId`, parola hash'i ve TOTP secret/hash
  alanlarini deep-forbidden kontrol eder. `corepack pnpm --filter @o-okul/api
  typecheck`, hedefli auth/app e2e ve auth unit testleri, `corepack pnpm --filter
  @o-okul/api build`, `corepack pnpm openapi:generate` ve `corepack pnpm
  idempotency:inventory:check` gecti.
- Faz 2 icin parser-config suggestion/approval sozlesme dilimi lokal olarak kapatildi:
  parser-config suggestion/approval request ve response tipleri shared-types'a eklendi;
  parser-config validation/service katmani bu tiplere baglandi. OpenAPI overlay ve
  generator, suggestion request `sampleText` / `fileBase64` / `preset` anyOf kuralini,
  `OPTIK_7108_LGS` preset enum'unu, suggestion confidence/delimiter/version enum'larini,
  approval response `status=APPROVED`, skip-header minimumunu ve approval
  `Idempotency-Key` header'ini fail-fast korur. `corepack pnpm --filter
  @o-okul/shared-types typecheck`, `corepack pnpm --filter @o-okul/api
  typecheck`, hedefli parser-config API/service/repository testleri, `corepack pnpm
  --filter @o-okul/api build`, `corepack pnpm openapi:generate` ve `corepack pnpm
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
  rapor yuzeylerinden ayirmayi onermisti. `corepack pnpm --filter @o-okul/api
  typecheck`, `corepack pnpm --filter @o-okul/api exec vitest run
  src/report/report-generation.controller.e2e.test.ts src/report/report-generation.service.test.ts`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate`
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
  eklendi. `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run
  src/report/report-generation.controller.e2e.test.ts src/report/report-generation.service.test.ts`
  (36 test), `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate`,
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
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run
  src/me/me-access-matrix.e2e.test.ts src/report/report-generation.controller.e2e.test.ts
  src/report/report-generation.service.test.ts` (46 test), `corepack pnpm --filter
  @o-okul/api build` ve `corepack pnpm openapi:generate` gecti. Operation-contract envanteri
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
  `node --check scripts/generate-openapi.mjs`, `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run
  src/me/me-access-matrix.e2e.test.ts src/report/report-generation.controller.e2e.test.ts
  src/report/report-generation.service.test.ts` (46 test), `corepack pnpm --filter
  @o-okul/api build` ve `corepack pnpm openapi:generate` gecti. Operation-contract envanteri
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
  bulunmamasini fail-fast korur. `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run
  src/development/development.service.test.ts src/development/development.controller.e2e.test.ts
  src/me/me-access-matrix.e2e.test.ts` (17 test), `corepack pnpm --filter @o-okul/api build`,
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
  scripts/generate-openapi.mjs`, `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts
  src/attendance/attendance.e2e.test.ts src/homework/homework.e2e.test.ts
  src/teacher-note/teacher-note.e2e.test.ts` (55 test), `corepack pnpm --filter
  @o-okul/api build`, `corepack pnpm openapi:generate` ve artifact schema negatif
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
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts
  src/student/student-profile.e2e.test.ts src/attendance/attendance.e2e.test.ts
  src/teacher-note/teacher-note.e2e.test.ts` (26 test), `corepack pnpm --filter
  @o-okul/api build`, `corepack pnpm openapi:generate` ve artifact schema negatif
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
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts
  src/student/student-profile.e2e.test.ts src/app.e2e.test.ts` (49 test),
  `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate` ve
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
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts`
  (12 test), `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate`
  ve artifact schema negatif kontrolu gecti. Operation-contract envanteri bu dilimden sonra
  277 toplam operation icinde 203 covered / 74 open; Faz 2 yine tam kapanmaz. Kalan portal
  borcu support-ticket portal mutasyonlari ve genis read/mutation yuzeyleridir.
- Faz 2/Faz 4 icin support-ticket portal mutasyon dilimi lokal olarak kapatildi:
  `GET/POST /api/v1/me/student/support-tickets`,
  `GET/POST /api/v1/me/guardian/students/{studentId}/support-tickets` ve
  `GET/POST /api/v1/me/teacher/support-tickets` OpenAPI overlay ve generator kapisina
  alindi. `PortalSupportTicketCreateRequest`, `TeacherPortalSupportTicketCreateRequest` ve
  `PublicPortalSupportTicketRecord` shared-types'a eklendi; student/guardian POST body artik
  `studentId`/`tenantId`/`requesterId`/`status` override edemez, teacher POST body `tenantId`
  override edemez. Portal response'lari runtime'da `requesterId` dondurmez; generator response
  list/envelope, priority/status enum, `createdAt` format ve requesterId/userId/fileBase64/
  contentBase64/storageKey/downloadUrl/token/nationalId* yasaklarini fail-fast korur. Tenant
  security review OpenAPI tek basina yeterli olmadigini, runtime redaction gerektigini P1
  olarak isaretledi ve bu runtime redaction eklendi. `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/support-ticket/support-ticket.e2e.test.ts
  src/me/me-access-matrix.e2e.test.ts` (36 test), `corepack pnpm --filter @o-okul/api build`,
  `corepack pnpm openapi:generate` ve artifact schema negatif kontrolu gecti. Operation-contract
  envanteri bu dilimden sonra 277 toplam operation icinde 209 covered / 68 open; Faz 2 yine
  tam kapanmaz. Kalan lokal contract borcu yonetim student ana kayitlari/profil mutasyonlari,
  diger genis read/mutation yuzeyleri ve shared-types tek kaynak gecisidir.
- Faz 2/Faz 4 icin yonetim student core/profile read-update-delete dilimi lokal olarak
  kapatildi: `GET /api/v1/students`, `GET/PATCH/DELETE /api/v1/students/{id}` ve
  `GET/PATCH /api/v1/students/{id}/profile` OpenAPI overlay ve generator kapisina
  alindi. `StudentUpdateRequest` ve `StudentProfileUpdateRequest` shared-types'a eklendi;
  core student response'lari runtime'da public kayit beyaz listesine indirildi ve `userId`,
  ham kimlik, iletisim/profil ve storage alanlarini dondurmez. Profile response'lari
  `userId`, ham TC, encrypted/hash TC ve storage/token alanlarini yasaklar; profile request
  ham `nationalId` girdisini yalnizca yazma girdisi olarak kabul eder ve `photoKey` de
  `students/{studentId}/...` sinirina cekildi. Tenant security subagent'i `GET /students`
  `userId` sizintisini P1 olarak isaretledi; bu runtime mapper beyaz listesiyle kapatildi.
  `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/student/student-profile.e2e.test.ts
  src/app.e2e.test.ts` (37 test), `corepack pnpm --filter @o-okul/api build`,
  `corepack pnpm openapi:generate`, student core/profile artifact negatif kontrolu,
  `corepack pnpm prod:plan:check` ve scoped `git diff --check` gecti. Operation-contract
  envanteri bu dilimden sonra 277 toplam operation icinde 215 covered / 62 open; Faz 2
  yine tam kapanmaz. Kalan lokal contract borcu diger genis read/mutation yuzeyleri ve
  shared-types tek kaynak gecisidir.
- Faz 2 icin student import-export/enrollment lifecycle sozlesme dilimi lokal olarak
  kapatildi: `GET /api/v1/students/export`, `POST /api/v1/students/imports/dry-run`,
  `POST /api/v1/students/imports`, `POST /api/v1/students/enrollments/bulk-renew`,
  `POST /api/v1/students/{id}/enrollments/renew` ve
  `POST /api/v1/students/{id}/enrollments/transfer` OpenAPI overlay ve generator kapisina
  alindi. `StudentImportRequest`, `StudentImportDryRunResult`, `StudentImportResult`,
  `StudentExportResult`, `StudentEnrollmentActionRequest`, `StudentBulkEnrollmentRequest`
  ve `StudentBulkEnrollmentResult` shared-types'a eklendi. Import commit response'u runtime'da
  public student kaydina indirildi; `userId`, ham kimlik, iletisim/profil ve storage/token
  alanlari donmez. `bulk-renew` mutasyonu tum ogrenci ve hedef class erisimlerini preflight
  yapmadan kayit yazmaz; tenant disi ikinci ogrenci ilk ogrencide kismi enrollment olusturamaz.
  Transfer endpoint'inin classId olmadan `data: null` donebilmesi OpenAPI'de nullable kayit
  olarak temsil edilir. QA subagent'i dry-run bos schema, transfer nullable contract, bulk
  `studentIds.minItems` ve kismi mutasyon risklerini isaretledi; bu kapilar eklendi.
  `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/student/student-profile.e2e.test.ts
  src/app.e2e.test.ts` (38 test), `corepack pnpm --filter @o-okul/api build`,
  `corepack pnpm openapi:generate` ve student import/enrollment artifact negatif kontrolu
  gecti. Operation-contract envanteri bu dilimden sonra 277 toplam operation icinde
  221 covered / 56 open; Faz 2 yine tam kapanmaz. Kalan lokal contract borcu diger genis
  read/mutation yuzeyleri ve shared-types tek kaynak gecisidir.
- Faz 2/Faz 4 icin kalan student lifecycle read/purge/tenant update dilimi lokal olarak
  kapatildi: `GET /api/v1/students/{id}/class-history`,
  `GET /api/v1/students/{id}/enrollments`,
  `GET /api/v1/students/{id}/teacher-assignments`,
  `POST /api/v1/students/{id}/purge-pii` ve `PATCH /api/v1/students/{id}/tenant`
  OpenAPI overlay ve generator kapisina alindi. `StudentTenantUpdateRequest` shared-types'a
  eklendi; purge ve tenant update response'lari runtime'da public student kaydina indirildi.
  Student PII purge artik yalniz ad/soyad degil, `nationalIdEncrypted`, `nationalIdHash`,
  `birthDate`, `phone`, `email` ve `photoKey` alanlarini da temizler. Generator class-history,
  enrollment ve teacher-assignment liste envelope'larini, student status/teacher assignment role
  enum'larini, tarih formatlarini ve userId/nationalId*/iletisim/storage/token yasaklarini
  fail-fast korur. `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/student/student-store.test.ts
  src/school/school.e2e.test.ts src/student/student-profile.e2e.test.ts` (46 test),
  `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate` ve
  student lifecycle residual artifact negatif kontrolu gecti. Operation-contract envanteri
  bu dilimden sonra 277 toplam operation icinde 226 covered / 51 open; Faz 2 yine tam
  kapanmaz. Kalan lokal contract borcu diger genis read/mutation yuzeyleri ve shared-types
  tek kaynak gecisidir.
- Faz 2 icin message-template CRUD sozlesme dilimi lokal olarak kapatildi:
  `GET/POST /api/v1/message-templates`, `GET/PATCH/DELETE /api/v1/message-templates/{id}`
  OpenAPI overlay ve generator kapisina alindi. `MessageTemplateCreateRequest` ve
  `MessageTemplateUpdateRequest` shared-types'a eklendi; API Zod body semalari bu tiplere
  baglandi. Generator list/tekil response envelope'larini, create `name`/`body` zorunlulugunu,
  `SMS` channel enum'unu, `minLength: 1`, delete `204` no-body davranisini ve response'ta
  `deletedAt`, userId, nationalId*, file/storage/token alan yasaklarini fail-fast korur.
  `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run src/message-template/message-template.e2e.test.ts
  src/message-template/message-template-store.test.ts` (9 test),
  `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate` ve
  message-template artifact negatif kontrolu gecti. Operation-contract envanteri bu dilimden
  sonra 277 toplam operation icinde 231 covered / 46 open; Faz 2 yine tam kapanmaz.
  Kalan lokal contract borcu diger genis read/mutation yuzeyleri ve shared-types tek kaynak
  gecisidir.
- Faz 2 icin identity-invitation public response ve token redaction sozlesme dilimi lokal
  olarak kapatildi:
  `GET/POST /api/v1/identity-invitations`, `POST /api/v1/identity-invitations/accept`
  ve `POST /api/v1/identity-invitations/{id}/resend` shared request/response tiplerine,
  OpenAPI overlay'e ve generator kapisina alindi. Controller create/resend response'lari
  artik ham `activationToken` dondurmez; accept response'u yalnizca `status` ve `acceptedAt`
  ile sinirlanir. Generator list/create/resend response'larinda `activationToken`, `token`,
  `tokenHash`, `password`, `refreshToken` ve `acceptedUserId` yasaklarini, accept response'unda
  tenant/subject/email/user/token alan yasaklarini fail-fast korur. `node --check
  scripts/generate-openapi.mjs`, `corepack pnpm --filter @o-okul/shared-types
  typecheck`, `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run
  src/identity-invitation/identity-invitation.e2e.test.ts` (5 test),
  `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate` ve
  identity-invitation artifact negatif kontrolu gecti. Operation-contract envanteri bu
  dilimden sonra 277 toplam operation icinde 235 covered / 42 open; Faz 2 yine tam
  kapanmaz. Kalan lokal contract borcu diger genis read/mutation yuzeyleri ve shared-types
  tek kaynak gecisidir.
- Faz 2/Faz 4A icin optical-form-template list/create/apply sozlesme dilimi lokal olarak
  kapatildi:
  `GET/POST /api/v1/optical-form-templates` ve
  `POST /api/v1/optical-form-templates/{templateId}/apply` shared request tiplerine,
  OpenAPI overlay'e ve generator kapisina alindi. Generator list/create response'larinda
  `encoding`, `delimiter`, `skipHeaderLines`, `status`, `createdAt` ve `updatedAt` alanlarini;
  create/apply request body'lerini; create/apply `Idempotency-Key` header'ini; optik template
  ve applied parser-config response'larinda `fileBase64`, `sampleText`, `rawRow`, token/hash
  alan yasaklarini fail-fast korur. `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run
  src/exam/optical-form-template.controller.e2e.test.ts
  src/exam/optical-form-template.service.test.ts` (6 test), `corepack pnpm --filter
  @o-okul/api build`, `corepack pnpm openapi:generate` ve optical-form-template
  artifact negatif kontrolu gecti. Operation-contract envanteri bu dilimden sonra 277
  toplam operation icinde 238 covered / 39 open; Faz 2 yine tam kapanmaz. Kalan lokal
  contract borcu diger genis read/mutation yuzeyleri ve shared-types tek kaynak gecisidir.
- Faz 2 icin health/metrics raw response, download response ve no-content delete sozlesme
  dilimi lokal olarak kapatildi:
  `GET /health`, `GET /health/ready`, `GET /api/v1/metrics`,
  `GET /api/v1/support-tickets/{id}/attachments/{attachmentId}/download`,
  `GET /api/v1/homework/materials/{id}/files/{fileId}/download`,
  `DELETE /api/v1/teachers/{id}/assignments/{assignmentId}`,
  `DELETE /api/v1/homework/materials/{id}`, `DELETE /api/v1/homework/{id}`,
  `DELETE /api/v1/schedule-lessons/{id}`, `DELETE /api/v1/study-sessions/{id}` ve
  `DELETE /api/v1/teacher-notes/{id}` OpenAPI checker kapsamindadir. Metrics endpoint'i
  global prefix/interceptor altinda raw `text/plain` kalir; health response'lari `{ data }`
  zarfi tasimaz; delete endpoint'leri 204/no-content; download endpoint'leri file metadata
  response'u verir ve `contentBase64`, storage/object key, token/hash alanlarini artifact
  seviyesinde yasaklar. `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/api typecheck`, hedefli 9 API e2e dosyasi
  (127 test), `corepack pnpm --filter @o-okul/api build` ve
  `corepack pnpm openapi:generate` gecti. Required-operation envanteri bu dilimden sonra
  277 toplam operation icinde 249 covered / 28 open; Faz 2 yine tam kapanmaz.
- Faz 2 icin SMS batch ve backup/tenant-export sozlesme dilimi lokal olarak kapatildi:
  `POST /api/v1/sms-batches`, `GET /api/v1/sms-batches/{jobId}`,
  `POST /api/v1/sms-batches/recipients/preview`, `GET /api/v1/backup-restore-jobs`,
  `POST /api/v1/backup-restore-jobs` ve
  `GET /api/v1/backup-restore-jobs/tenant-export` shared-types, OpenAPI overlay ve
  generator kapisina alindi. Generator SMS response'larinda queue/report/preview required
  alanlarini, recipient/template minLength/minItems kurallarini, `Idempotency-Key` header'ini
  ve token/storage/raw-content yasaklarini; backup job'larda operation/status enum'larini,
  target/confirmation minLength kurallarini, raw tenant-export required alanlarini ve
  token/storage/ham kimlik yasaklarini fail-fast korur. `node --check
  scripts/generate-openapi.mjs`, `corepack pnpm --filter @o-okul/shared-types
  typecheck`, `corepack pnpm --filter @o-okul/api typecheck`, hedefli
  `sms-batch`, `backup-restore` ve `api-response` e2e kosusu (19 test),
  `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate`
  ve SMS/backup/export artifact negatif kontrolu gecti. Required-operation envanteri bu
  dilimden sonra 277 toplam operation icinde 255 covered / 22 open; Faz 2 yine tam kapanmaz.
- Faz 2/Faz 4 icin `/me` profile/tenant ve portal homework/notification-preference sozlesme
  dilimi lokal olarak kapatildi:
  `GET /api/v1/me/profile`, `GET/PATCH /api/v1/me/tenant`,
  `GET /api/v1/me/student/homework/material-assignments`,
  `GET /api/v1/me/guardian/homework/material-assignments`,
  `GET /api/v1/me/guardian/students/{studentId}/homework/material-assignments` ve
  `GET/PATCH /api/v1/me/guardian/students/{studentId}/notification-preferences`
  shared-types, OpenAPI overlay ve generator kapisina alindi. Generator session context
  response'unu kaynak kayit/PII alanlarindan ayirir; tenant profile update request'inde
  sadece `name`, `institutionType`, `contactEmail`, `logoUrl` alanlarini kabul eder;
  portal homework/preference response'larinda token, storage key, raw content ve ham kimlik
  alan yasaklarini fail-fast korur. `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`, hedefli `me-access-matrix`,
  `tenant`, `support-ticket` ve `app` e2e kosusu (74 test),
  `corepack pnpm --filter @o-okul/api build`, `corepack pnpm openapi:generate`
  ve `/me` artifact negatif kontrolu gecti. Required-operation envanteri bu dilimden sonra
  277 toplam operation icinde 263 covered / 14 open; Faz 2 yine tam kapanmaz.
- Faz 2 icin tenant admin ve tenant-user sozlesme/P0 guvenlik dilimi lokal olarak kapatildi:
  `GET /api/v1/tenants`, `GET/PATCH/DELETE /api/v1/tenants/{id}`,
  `GET/POST /api/v1/tenant-users` ve
  `PATCH /api/v1/tenant-users/{userId}/roles` shared-types, OpenAPI overlay ve
  generator kapisina alindi. `PATCH /tenants/{id}` artik create'e ait `id` ve
  `firstAdmin` alanlarini Zod seviyesinde reddeder. `POST /tenant-users` mevcut global
  e-posta conflict'inde `User.passwordHash` satirini guncellemez; mevcut kullanici sadece
  tenant membership'e baglanir, boylece baska tenant admin'inin bilinen e-posta uzerinden
  parola ele gecirme riski kapatildi. Generator tenant-user role enum'unda `SYSTEM_ADMIN`
  bulunmamasini, roles `minItems`, e-posta/tarih/koltuk limit formatlarini ve tenant/tenant-user
  response'larinda activation token, parola, password hash, refresh token ve token/hash alan
  yasaklarini fail-fast korur. `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run
  src/user-management/user-management-store.test.ts
  src/user-management/user-management.e2e.test.ts
  src/tenant/tenant.controller.e2e.test.ts` (16 test),
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate`
  gecti. Required-operation envanteri bu dilimden sonra 277 toplam operation icinde
  270 covered / 7 open; acik operation listesi:
  `GET /api/v1/me/guardian/students/{studentId}/payment-plans`,
  `GET /api/v1/me/teacher/lookups`, `GET /api/v1/me/teacher/students`,
  `GET /api/v1/privacy/inventory`, `POST /api/v1/privacy/me/purge-pii`,
  `POST /api/v1/role-previews` ve `POST /api/v1/tenants`. `POST /api/v1/tenants`
  first-admin invitation response token'u ve first-admin audit raw e-posta borcu nedeniyle
  bu turda bilincli olarak covered sayilmadi.
- Faz 2 icin role-preview token-scope sozlesme dilimi lokal olarak kapatildi:
  `POST /api/v1/role-previews` shared-types, OpenAPI overlay ve generator kapisina alindi.
  Bu endpoint bilincli olarak `previewToken` dondurur; generator bu beklenen alanla birlikte
  target role enum'unu sadece `TEACHER/STUDENT/GUARDIAN` ile sinirlar, `mode=READ_ONLY`,
  `expiresAt/createdAt` date-time, `targetSubjectId.minLength` ve request body required
  alanlarini fail-fast kontrol eder. Response'da access token, activation token, parola,
  password hash, refresh token ve token hash alanlari yasak kalir. Runtime test success
  response'unda `previewToken` disinda access/refresh token ve parola/hash alanlari olmadigini,
  cross-tenant/missing subject durumunda token verilmedigini ve `SYSTEM_ADMIN` hedef rolunun
  Zod ile reddedildigini korur. `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run
  src/role-preview/role-preview.controller.e2e.test.ts` (3 test),
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate`
  gecti. Required-operation envanteri bu dilimden sonra 277 toplam operation icinde
  271 covered / 6 open; acik operation listesi:
  `GET /api/v1/me/guardian/students/{studentId}/payment-plans`,
  `GET /api/v1/me/teacher/lookups`, `GET /api/v1/me/teacher/students`,
  `GET /api/v1/privacy/inventory`, `POST /api/v1/privacy/me/purge-pii` ve
  `POST /api/v1/tenants`.
- Faz 2/Faz 4 icin kalan teacher/guardian portal read sozlesme ve privacy dilimi lokal
  olarak kapatildi:
  `GET /api/v1/me/teacher/lookups`, `GET /api/v1/me/teacher/students` ve
  `GET /api/v1/me/guardian/students/{studentId}/payment-plans` OpenAPI overlay ve
  generator kapisina alindi. `/me/teacher/students` runtime cevabi internal `StudentRecord`
  yerine `PublicStudentRecord` kullanacak sekilde daraltildi; boylece `userId` ve portal
  hesap baglantisi ogretmen listesine sizmaz. Generator teacher portal read response'larinda
  e-posta, ham kimlik, telefon, photo/storage key, raw content, userId ve token/hash alanlarini;
  guardian payment-plan response'unda ham kimlik/iletisim/storage/token alanlarini; payment
  taksit status enum'u, tutar minimumlari ve tarih formatlarini fail-fast kontrol eder.
  `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run
  src/me/me-access-matrix.e2e.test.ts src/payment/payment.e2e.test.ts` (30 test),
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate`
  gecti. Required-operation envanteri bu dilimden sonra 277 toplam operation icinde
  274 covered / 3 open; acik operation listesi:
  `GET /api/v1/privacy/inventory`, `POST /api/v1/privacy/me/purge-pii` ve
  `POST /api/v1/tenants`.
- Faz 2/Faz 4 icin privacy inventory ve self-purge sozlesme dilimi lokal olarak kapatildi:
  `GET /api/v1/privacy/inventory` ve `POST /api/v1/privacy/me/purge-pii` shared-types,
  OpenAPI overlay ve generator kapisina alindi. `SelfPurgeResult` shared-types'a tasindi
  ve AuthService ayni tipi yeniden export eder. KVKK inventory response'u sadece generic
  `displayRef`, `kind`, `piiCategories` ve `purgeAvailable` alanlarini tasir; generator
  ad/soyad/e-posta/telefon/ham kimlik/storage/raw content/userId/token alanlarini yasaklar.
  Self-service purge response'u sadece `userId`, opsiyonel `tenantId` ve `purgedAt`
  doner; e-posta, ad, parola/hash, refresh token ve token/hash alanlari fail-fast yasaktir.
  `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run
  src/privacy/privacy.controller.e2e.test.ts
  src/audit-log/audit-log.e2e.test.ts src/payment/payment.e2e.test.ts` (35 test),
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate`
  gecti. Required-operation envanteri bu dilimden sonra 277 toplam operation icinde
  276 covered / 1 open; kalan tek acik operation `POST /api/v1/tenants`.
- Faz 2/Faz 4 icin tenant create ve first-admin token/audit PII dilimi lokal olarak kapatildi:
  `POST /api/v1/tenants` shared-types, OpenAPI overlay ve generator kapisina alindi.
  First-admin invitation akisi artik password reset token'unu store'a hash olarak yazar ama
  response'a ham `activationToken` dondurmez; response yalniz `activationTokenIssued` ve
  `activationTokenExpiresAt` gibi token tasimayan kanit alanlarini tasir. First-admin audit
  diff'i raw admin e-postasi yerine `emailProvided: true` yazar. Generator tenant create
  request'inde `name/slug` required, first-admin e-posta/mode/parola minimumlari, tarih ve
  seat limit kurallarini; response oneOf branch'lerinde `TenantRecord` veya
  `{ tenant, admin }` required alanlarini; activation token, parola/hash, refresh token ve
  token/hash alan yasaklarini fail-fast kontrol eder. `node --check scripts/generate-openapi.mjs`,
  `corepack pnpm --filter @o-okul/shared-types typecheck`,
  `corepack pnpm --filter @o-okul/api exec vitest run
  src/tenant/tenant.service.test.ts src/tenant/tenant.controller.e2e.test.ts
  src/user-management/user-management.e2e.test.ts` (22 test),
  `corepack pnpm --filter @o-okul/api typecheck`,
  `corepack pnpm --filter @o-okul/api build` ve `corepack pnpm openapi:generate`
  gecti. Required-operation envanteri bu dilimden sonra 277 toplam operation icinde
  277 covered / 0 open; Faz 2 lokal contract gate'i kapanmis sayilir.
- Faz 5/Faz 10 icin final external evidence env/runbook baglantisi lokal olarak
  sertlestirildi:
  `PRODUCTION_EVIDENCE_SUMMARY_TARGET` artik `.env.example`, staging evidence env ornegi,
  `prod:env:check` required evidence target seti ve staging evidence env sozlesmesi icinde
  zorunludur. `docs/phase-6-ops-runbook.md` final dis kanit adimi artik production summary,
  live-status, pilot ve go-live target'larini ayni komutta
  `corepack pnpm prod:external-evidence:check` ile baglar; target'siz `ops:check`, `0/18`
  Canli Durum, `*_ALLOW_EXAMPLE_EVIDENCE=1`, lokal temp path, `artifacts/local/**`,
  symlink target, userinfo/query/fragment tasiyan URL veya placeholder/example/redacted HTTPS host
  final kabul sayilmaz. Bu sozlesme
  `scripts/check-ops-config.mjs` ve `scripts/check-prod-readiness.mjs` statik beklentilerine
  baglandi. `node --check scripts/check-prod-env.mjs`,
  `node --check scripts/check-ops-config.mjs`,
  `node --check scripts/check-prod-readiness.mjs`,
  `node scripts/check-prod-env.mjs --contract .env.example`,
  `corepack pnpm staging:evidence-env:check`,
  `corepack pnpm prod:evidence:templates:check`,
  `corepack pnpm prod:readiness:check`, `corepack pnpm prod:plan:check` ve
  `corepack pnpm ops:check` gecti. Bu guardrail gercek production summary, 18/18 Canli Durum,
  pilot ve go-live artifact setini uretmez; Faz 5/Faz 10 kapanisi icin target'li
  `prod:external-evidence:check` halen zorunludur.
- Faz 5/Faz 10 icin evidence target URL secret hijyeni lokal olarak sertlestirildi:
  `scripts/check-prod-env.mjs`, `scripts/check-prod-evidence.mjs` ve
  `scripts/check-final-external-evidence.mjs` artik production/final evidence target URL'lerinde
  userinfo, query veya fragment kabul etmez; boylece `https://user:pass@...`,
  `?token=...` veya `#...` tasiyan kanit hedefleri release/final kapilarindan gecemez.
  `scripts/check-prod-evidence-templates.mjs` prod env, prod evidence ve final external evidence
  secret URL negatiflerini kosar; `scripts/check-ops-config.mjs`,
  `scripts/check-prod-readiness.mjs` ve `scripts/check-prod-plan-status.mjs` bu kuralı
  statik olarak izler. Bu guardrail gercek staging/prod artifact uretmez; final target'li
  `prod:external-evidence:check` halen dis kanit gerektirir.
- Faz 5/Faz 10 icin tekil evidence target URL secret hijyeni kapatildi:
  read-only ops subagent `PILOT_EVIDENCE_TARGET`, `GO_LIVE_EVIDENCE_TARGET`,
  `PRODUCTION_EVIDENCE_SUMMARY_TARGET` ve go-live linked summary/pilot/live-status target'larinda
  userinfo/query/fragment reddi eksigini dogruladi. Bu turda
  `scripts/check-production-evidence-summary.mjs`, `scripts/check-pilot-evidence.mjs` ve
  `scripts/check-go-live-evidence.mjs` ayni target hijyeniyle sertlestirildi;
  `scripts/check-prod-evidence-templates.mjs` production summary, pilot, go-live root ve
  go-live linked target secret URL negatiflerini kosar. Bu da lokal guardrail'dir; gercek
  production summary, 18/18 Canli Durum, pilot ve go-live artifact'leri uretilmeden Faz 5/Faz 10
  tamamlanmis sayilmaz.
- Faz 5/Faz 10 final dış kanıt fixture hedefi reddi eklendi: `scripts/check-final-external-evidence.mjs`
  artık final target'larda `docs/evidence-templates/**` dosyalarını kabul etmez. Template kontrolleri
  kendi `*_ALLOW_EXAMPLE_EVIDENCE=1` modunda kalır; final `prod:external-evidence:check` ise kalıcı
  staging/prod artifact veya gerçek HTTPS hedef ister. `scripts/check-prod-evidence-templates.mjs`
  bu negatif senaryoyu geçici artifact kopyalarıyla doğrular.
- 2026-06-23 remote/staging salt-okunur kanıt audit'i: `o-okul-server` erişimi çalışıyor,
  `/root/o-okul` altında Docker stack ayakta ve API `{"status":"ok"}`, web `127.0.0.1:3001`
  HTTP 200 döndürüyor. Ancak `artifacts/` altında final zinciri için gereken
  `production-summary`/`release-summary`, `live-status`, `pilot`, `go-live`, `uat`, `isem`,
  `live-exam`, `live-ui`, `kvkk`, `audit-null` veya `inline-upload` artifact seti bulunmadı;
  yalnız eski `single-node-2026-06-14/rls-load-smoke.json` ve eski smoke/UI artifact'leri görüldü.
  Remote repo lokal final kapıya göre geride: `node scripts/check-live-status-evidence.mjs`
  remote'da `0/7 dış kanıt PASS` veriyor ve `scripts/check-final-external-evidence.mjs` remote'da
  bulunmuyor. Bu nedenle Faz 5/Faz 10 kapanışı için sıradaki gerçek adım, güncel guardrail'leri
  remote/staging'e taşıyıp gerçek staging/prod artifact setini üretmek ve ardından target'li
  `prod:external-evidence:check` koşmaktır.
- Faz 5/Faz 10 için remote final readiness kapısı eklendi: `scripts/check-remote-final-evidence-readiness.mjs`
  ve `corepack pnpm prod:remote-evidence:check`, `REMOTE_EVIDENCE_HOST`/`REMOTE_EVIDENCE_ROOT`
  üzerinden remote repo final checker'ını, API/web health'i, 18/18 Canlı Durum sonucunu ve aynı
  target setiyle remote `check-final-external-evidence.mjs` sonucunu salt-okunur doğrular. Bu
  komut CI statik kapısına eklenmez; kapanış sırasının target'lı remote/staging doğrulama adımıdır.
- Remote final readiness target hijyeni final kapıyla hizalandı: `prod:remote-evidence:check`
  artık remote target URL'lerinde userinfo/query/fragment yanında placeholder HTTPS host,
  remote `/tmp`/`/var/tmp`, `artifacts/local/**` ve `docs/evidence-templates/**` fixture
  hedeflerini de reddeder. Bu, hatalı remote target'ların Faz 5/Faz 10 kapanışı gibi
  sayılmasını engeller; gerçek artifact seti ve 18/18 Canlı Durum hâlâ zorunludur.
- Remote final readiness davranışı fake-SSH testiyle sabitlendi: `REMOTE_*` target'ları hem
  remote `live:status` hem remote `check-final-external-evidence.mjs` komutuna env prefix olarak
  geçer; invalid `artifacts/local/**` target ise SSH'e çıkmadan kırılır. Kapı artık yerel
  `*_ALLOW_EXAMPLE_EVIDENCE=1` bayraklarını SSH'e çıkmadan reddeder ve remote node komutlarını
  aynı bayrakları `env -u` ile temizleyerek çalıştırır. Gerçek
  `o-okul-server` koşusunda target env'leri verildiğinde kapı artık env eksikliğinden değil,
  remote repo final checker/package script geriliği ve eksik `live-status.json` artifact'i nedeniyle
  kırılıyor. Bu nedenle kalan iş hâlâ güncel guardrail'leri remote/staging'e taşımak ve gerçek
  production summary/live-status/pilot/go-live artifact setini üretmektir.
- Remote/staging guardrail farkı dar kapsamlı kapatıldı: `scripts/check-final-external-evidence.mjs`,
  `scripts/check-remote-final-evidence-readiness.mjs`, güncel production summary/live-status/pilot/
  go-live checker'ları ve `docs/phase-6-production-readiness.md` remote `/root/o-okul` altına
  senkronlandı; remote `package.json` yalnız `prod:external-evidence:check` ve
  `prod:remote-evidence:check` script anahtarlarıyla güncellendi. Öncesinde remote backup
  `artifacts/guardrail-sync-2026-06-23/` altına alındı ve kalıcı target kökü
  `/root/o-okul/artifacts/staging` oluşturuldu. Target'lı
  `prod:remote-evidence:check` artık checker/script geriliği nedeniyle değil,
  `release-summary.json`, `live-status.json`, `pilot.json` ve `go-live.json` gerçek artifact
  dosyaları henüz üretilmediği için kırılıyor.
- Remote/staging iSEM optical pipeline kanıtı üretildi: `o-okul-server` üzerinde
  `STAGING_ENVIRONMENT=staging`, kurum kontrollü smoke e-posta domain'i ve kalıcı
  `artifacts/staging/isem-optical-pipeline.json` hedefiyle `corepack pnpm isem-optical-pipeline:smoke`
  geçti. Artifact `result=PASS`, `environment=staging`, 254 student/participant/matched/
  `ExamResult`/report result, 0 quarantine, boş `gaps`, `pipelineDurationPassed=true` ve
  `commandsPassed=["pnpm isem-optical-pipeline:smoke"]` içeriyor. `ISEM_OPTICAL_PIPELINE_TARGET=file://...`
  ile `corepack pnpm isem-optical-pipeline:evidence-check` geçti; public artifact için ham TXT path,
  e-posta, base64, raw row/line ve TCKN-benzeri 11 hane grep negatifleri temiz. Private
  `artifacts/staging/private/live-ui-worker-input.json` 0600 izinle üretildi ve release paketine
  konmamalı.
- Live UI-worker result staging kanıtı üretildi: remote `apps/web/playwright.next.config.ts`
  external `NEXT_E2E_BASE_URL`, webServer skip ve self-signed TLS toleransı alacak şekilde
  senkronlandı; `live-ui-worker-report-next.spec.ts` login redirect, sekmeli rapor, PDF/Excel
  indirme ve portal karne detayı gerçek UI akışına göre sertleştirildi. `o-okul-server`
  üzerinde `NEXT_E2E_BASE_URL=https://212.108.107.190`, `NEXT_E2E_SKIP_WEB_SERVER=1`,
  `NEXT_E2E_IGNORE_HTTPS_ERRORS=1`, private 0600 input ve kalıcı
  `artifacts/staging/live-ui-worker-result.json` hedefiyle `corepack pnpm live:ui-worker:smoke`
  geçti. Result artifact `result=PASS`, `environment=staging`, `reportStatus=READY`,
  `downloadedArtifacts=["xlsx","pdf"]`, `studentPortalViewed=true`, `guardianPortalViewed=true`,
  boş `gaps` ve `commandsPassed=["pnpm live:ui-worker:smoke"]` içeriyor.
  `LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET=file://... corepack pnpm live:ui-worker:result-check`
  geçti; public artifact için e-posta/parola/token/base64/raw satır ve 11 hane grep negatifleri
  temiz. Bu staging result, production summary/live-status zincirine henüz bağlanmadığı için
  Faz 5 final kapanışı sayılmaz.
- Live exam cycle staging kanıtı üretildi: remote `o-okul-server` üzerinde `pnpm isem-answer-key:smoke`,
  `pnpm raw-import:smoke` ve `pnpm report-generation:smoke` yeniden koşturuldu; report generation
  kanıtı `artifacts/staging/smoke/report-generation.json` dosyasına yazıldı. Daha önce geçen iSEM optical pipeline ve
  live UI-worker result artifact'leriyle aynı staging release candidate altında PII-safe
  `artifacts/staging/live-exam-cycle.json` oluşturuldu. Bu artifact 90 soru, 1 booklet variant,
  254 participant/matched/ExamResult/report result, 0 quarantine, 2 indirilen artifact, PDF/Excel,
  ogrenci/veli portal gorunumu, 5 komutluk `commandsPassed` seti ve boş `gaps` taşır.
  `LIVE_EXAM_CYCLE_TARGET=file://$PWD/artifacts/staging/live-exam-cycle.json corepack pnpm live:exam-cycle:check`
  geçti; public artifact için e-posta/parola/token/base64/raw satır/object key ve 11 hane grep negatifleri
  temiz. Bu Faz 4A live-exam halkasını kapatır; production summary/live-status ve pilot/go-live
  zincirine bağlanmadığı sürece Faz 5/Faz 10 final kapanışı sayılmaz.
- Audit null tenant staging kanıtı üretildi: remote `o-okul-server` üzerinde `AuditLog`
  tablosundan yalnız aggregate sayım ve sınıflandırma okuyan PII-safe sorgu ile
  `artifacts/staging/reports/audit-null-tenant.json` oluşturuldu. Artifact `totalRows=0`,
  `tenantRows=0`, `nullTenantRows=0`, `system=0`, `deletedTenant=0`, `unknown=0`, boş `gaps`
  ve `commandsPassed=["pnpm audit-null-tenant:check"]` içerir. `AUDIT_NULL_TENANT_EVIDENCE_TARGET`
  kalıcı staging artifact'ini gösterirken `corepack pnpm audit-null-tenant:check` geçti; public artifact ve aggregate query log'u için
  e-posta/parola/token/base64/raw satır/object key ve 11 hane grep negatifleri temiz. Bu Faz 5
  audit-null halkasını ilerletir; production summary/live-status zincirine bağlanmadığı sürece
  Faz 5/Faz 10 final kapanışı sayılmaz.
- KVKK inventory staging kanıtı üretildi: remote `o-okul-server` üzerinde `Student`,
  `Teacher`, `Guardian` ve `User` tablolarından yalnız aggregate `COUNT(*)` okuyan PII-safe
  sorgu ile `artifacts/staging/reports/kvkk-inventory.json` oluşturuldu. Artifact 845 öğrenci,
  16 öğretmen, 67 veli, 61 kullanıcı, dört canonical KVKK purge action'ı, `/audit-logs` için
  21 audit diff redaction negatif kontrolü ve boş `gaps` taşır. Remote audit-log redaction
  testleri `corepack pnpm --filter @o-okul/api exec vitest run src/audit-log/audit-log.service.test.ts src/audit-log/audit-log.e2e.test.ts`
  ile 19/19 geçti; `KVKK_INVENTORY_TARGET=file://$PWD/artifacts/staging/reports/kvkk-inventory.json corepack pnpm privacy:inventory:check`
  geçti. Public artifact ve aggregate count log'u için e-posta/parola/token/base64/raw satır/object
  key ve 11 hane grep negatifleri temiz. Bu Faz 4 KVKK halkasını staging düzeyinde ilerletir;
  production summary/live-status ve pilot/go-live zincirine bağlanmadığı sürece Faz 5/Faz 10
  final kapanışı sayılmaz.
- Traefik self-signed/IP smoke kanıt ayrımı sertleştirildi: `scripts/smoke-traefik-https.mjs`
  artık `TRAEFIK_HTTPS_SMOKE_ALLOW_INSECURE_TLS=true` ile birlikte
  `TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE` verilirse fail-fast kırılır. Böylece IP/self-signed
  teşhis koşusu, public TLS `PASS` smoke artifact'i gibi production summary veya go-live zincirine
  taşınamaz. `docs/phase-6-production-readiness.md` ve `docs/phase-6-ops-runbook.md` aynı sınırı
  açıklar; gerçek Faz 5 Traefik kapanışı için hâlâ domain/public TLS ve kalıcı
  `traefik_https_smoke` artifact'i gerekir.
- RLS live staging kanıtı üretildi: remote `o-okul-server` üzerinde `.env.local` ile
  `corepack pnpm db:rls:check`, `corepack pnpm db:rls:check:live`,
  `STAGING_ENVIRONMENT=staging RLS_LOAD_SMOKE_EVIDENCE_FILE=artifacts/staging/rls-live/rls-load-smoke.json corepack pnpm rls:load:smoke`
  ve `corepack pnpm tenant-db:check` kalıcı `artifacts/staging/rls-live/*.log|json`
  hedeflerine yazılarak geçti. Public özet `artifacts/staging/reports/rls-live.json`
  54 tenant tablo, 24 tenant composite relation, 0 legacy allowlist, 0 orphan, 0 cross-tenant
  parent, 54 cross-tenant read check, 8 write/with-check negatif, 600 sorgu, 316.29 rps ve
  boş `gaps` taşır; `RLS_LIVE_EVIDENCE_TARGET=file://$PWD/artifacts/staging/reports/rls-live.json corepack pnpm rls:live:check`
  geçti ve RLS artifact/log seti için PII/secret grep negatifleri temiz. `scripts/check-rls-live-evidence.mjs`
  ayrıca `RLS_LIVE_EVIDENCE_TARGET` ve `evidenceReferences` içinde userinfo/query/fragment
  reddiyle sertleştirildi; `prod:evidence:templates:check` bu negatifleri korur. Bu Faz 3
  RLS halkasını staging düzeyinde ilerletir; production summary/live-status ve pilot/go-live
  zincirine bağlanmadığı sürece Faz 5/Faz 10 final kapanışı sayılmaz.
- Rate-limit Redis kanıtı false-positive guardrail'i sertleştirildi: `scripts/smoke-rate-limit-live.mjs`
  kalıcı evidence yazarken smoke/login URL'lerinin `https://`, userinfo/query/fragment'siz ve
  birbirinden farklı olmasını ister. `scripts/check-rate-limit-evidence.mjs` `RATE_LIMIT_EVIDENCE_TARGET`,
  `instances[].baseUrl` ve `evidenceReferences[]` için secret URL/reference reddini, iki farklı
  instance label/URL kontrolünü ve kalıcı evidence için `https://` instance URL şartını uygular.
  `scripts/check-prod-evidence-templates.mjs`, `docs/phase-6-production-readiness.md` ve
  `docs/phase-6-ops-runbook.md` bu 12 alanlı sözleşmeyi ve duplicate/secret/`artifacts/local/**`
  negatiflerini korur.
  Remote staging'de `docker-compose.rate-limit-shard.yml` ile ikinci API shard eklendi,
  `API_RATE_LIMIT_ENABLED=true` kalıcı runtime env'e alındı ve `reports/rate-limit.json`
  `RATE_LIMIT_EVIDENCE_TARGET=file://$PWD/artifacts/staging/reports/rate-limit.json pnpm rate-limit:check`
  ile PASS oldu. Bu Faz 5 rate-limit halkasını staging düzeyinde kapatır; production summary,
  live-status ve go-live zincirine bağlanmadığı sürece final kapanış sayılmaz.
- Inline upload migration evidence reference guardrail'i sertleştirildi:
  `scripts/check-inline-upload-content-migration-evidence.mjs` artık
  `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET` ve `evidenceReferences[]` içinde userinfo/query/fragment,
  signed URL, raw `storageKey`/`objectKey`/`s3Key`, `contentBase64`/`fileBase64` ve upload object
  key pattern'lerini reddeder. Migration report output temp guardrail'i macOS `/private/tmp`
  hedeflerini de kapsar. `scripts/check-prod-evidence-templates.mjs`,
  `docs/phase-6-production-readiness.md` ve `docs/phase-6-ops-runbook.md` bu negatifleri korur.
  Bu guardrail onaylı migration çalıştırmaz; `Inline upload migration kanıtı` gerçek migrate
  ve checker PASS olmadan `NOT_RUN` kalır.
- Inline upload live migration denemesi gerçek blocker yakaladı: `scripts/migrate-inline-upload-content-to-s3-live.mjs`
  `pg_total_relation_size($1::regclass)` ifadesinde camelCase tablo adını `homeworkmaterialfile`
  olarak çözdüğü için live dry-run önce kırılıyordu; script `format('%I', $1::text)::regclass`
  ve numeric subject snapshot normalizasyonuyla düzeltildi. Remote/staging dry-run artık gerçek DB'den
  `homework_material_files` ve `support_ticket_attachments` için 2+2 pending satır, toplam 16
  base64 karakter ve 2+2 total row raporluyor. API container içindeki gerçek S3 env'iyle
  `INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true` çalıştırıldığında ilk homework satırında
  `sha256 mismatch` görüldü ve migration DB update öncesi durdu; sonraki dry-run pending satırların
  değişmediğini doğruladı. Bunun üzerine script onaylı migrate öncesinde tüm pending satırları
  PII taşımadan sha preflight'tan geçirir hale getirildi; yeni guardrail S3 write/DB update
  başlamadan `homework_material_files: checked=2, sha256Mismatch=2` ve
  `support_ticket_attachments: checked=2, sha256Mismatch=2` özetini vererek duruyor.
  `pnpm inline-upload-content:hash-audit` bu durumu `contentBase64`, `tenantId`, `fileName`,
  `storageKey`, object key veya signed URL yazmadan `pendingRows`, `checkedRows`,
  `sha256MismatchRows`, `invalidBase64Rows`, `missingSha256Rows` ve `gaps` alanlarıyla kalıcı
  diagnostik artifact'e döker. Remote staging'de `2026-06-24T07:00:30.777Z` koşusu
  `homework_material_files` ve `support_ticket_attachments` için 2+2 pending satırda
  `missingSha256Rows=2+2`, `sha256MismatchRows=0`, `invalidBase64Rows=0` ve
  `gaps=["pending_inline_upload_missing_sha256_repair_required"]` üretti. Bu artifact
  `reports/inline-upload-content-migration.json` yerine geçmez. Bu turda
  `scripts/repair-inline-upload-content-sha-live.mjs` ve `pnpm inline-upload-content:repair-sha`
  eklendi: varsayılan dry-run `INLINE_UPLOAD_CONTENT_SHA_REPAIR_APPROVED=true` olmadan DB'ye
  yazmaz, onaylı modda yalnız `storageKey IS NULL`, dolu `contentBase64` ve eksik/invalid
  `sha256` satırlarında hash'i mevcut içerikten hesaplar. Rapor sadece subject bazlı
  `pendingRows`, `existingSha256Rows`, `repairableRows`, `invalidBase64Rows`, `repairedRows`,
  `pendingBase64Characters`, `tableSizeBytes`, `commandsPassed` ve `gaps` alanlarını yazar;
  ham `contentBase64`, `tenantId`, row id, `fileName`, `storageKey`, object key veya signed URL
  yazmaz. Remote staging'de dry-run repair, onaylı repair, tekrar hash audit, onaylı S3
  migration ve `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET=file://... corepack pnpm inline-upload-content:check`
  koşusu tamamlandı; final artifact checker PASS verdi ve inline upload bundle eksik listesinden çıktı.
- Inline upload ve yeni upload storage key minimizasyonu kapatıldı: migration script'i artık pending
  satırlardan `fileName`/parent id okumaz ve S3 key'i `subject.prefix/sha256` olarak üretir.
  `apps/api/src/homework/homework-material-file-storage.ts` ve
  `apps/api/src/support-ticket/support-ticket-attachment-storage.ts` yeni yazımlarda aynı hash-only
  kalıbı kullanır; unit testler key içinde tenant id, material/ticket id veya dosya adı bulunmadığını
  doğrular. Migration DB update'i S3 put sonrasında yarış nedeniyle satır güncelleyemezse önce
  DB'de aynı `storageKey` referansı var mı bakar; referans yoksa objeyi `DeleteObjectCommand`
  ile temizler, referans varsa aynı hash-only objeyi silmeden raw row id/key yazmadan fail-fast durur.
  Process crash/kill durumunda cleanup callback'i çalışmayabileceği için kalan P2 takip işi orphan
  S3 object reconciliation kanıtıdır. `pnpm inline-upload-content:orphan-audit` eklendi; S3
  prefix'lerini ve DB `storageKey` referanslarını karşılaştırıp sadece subject/prefix bazlı
  `listedObjects`, `dbReferencedObjects`, `orphanObjects`, `dbReferencedMissingObjects`,
  `invalidKeyObjects`, `legacyDbStorageKeyRows`, `commandsPassed` ve `gaps` alanlarını yazar.
  Ham object key, tenant id, parent id, dosya adı, signed URL veya içerik yazmaz; `orphan-audit.json`
  final migration kanıtı değil, migration sonrası reconciliation kanıtıdır. Remote staging'de
  `2026-06-24T07:15:08.322Z` koşusu `result=PASS`, `status=NO_ORPHANS`, iki subject için
  `listedObjects=0`, `dbReferencedObjects=0`, `orphanObjects=0`, `invalidKeyObjects=0`,
  `legacyDbStorageKeyRows=0` ve boş `gaps` üretti. Onaylı migration sonrası tekrar koşulan
  orphan audit `listedObjects=2`, `dbReferencedObjects=2`, `referencedObjectsPresent=2`,
  `orphanObjects=0`, `dbReferencedMissingObjects=0`, `invalidKeyObjects=0` ve
  `legacyDbStorageKeyRows=0` ile final migration artifact'ine bağlandı.
- Report generation perf staging kanıtı üretildi: remote `o-okul-server` üzerinde `.env.local`
  ile `STAGING_ENVIRONMENT=staging REPORT_GENERATION_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/report-generation.json corepack pnpm report-generation:perf`
  çalıştırıldı. Artifact `result=PASS`, `environment=staging`, `status=READY`, 10.000 result,
  10.000 student, 20 class, 2 branch, `generationDurationMs=9271`, `generationDurationMsMax=60000`,
  `commandsPassed=["pnpm report-generation:perf"]` ve boş `gaps` taşır. Repo smoke evidence
  validator'ı bu artifact'i geçti; artifact top-level ham e-posta/parola/tenantId/userId/examId/
  snapshotId/firstStudentId/contentBase64/rawRow/rawLine taşımıyor. Bu Faz 10 perf halkasını
  staging düzeyinde ilerletir; production summary/live-status ve pilot/go-live zincirine
  bağlanmadığı sürece Faz 10 final kapanışı sayılmaz.
- UAT, deployment region ve deployment rollback kanıt guardrail'leri sertleştirildi:
  `UAT_EVIDENCE_TARGET`, `DEPLOYMENT_REGION_TARGET` ve `DEPLOYMENT_ROLLBACK_TARGET` userinfo/query/
  fragment taşıyamaz; UAT restore/scenario evidence, deployment region `evidenceReference`,
  rollback servis `evidenceReference` ve `evidenceReferences` alanları da secret-bearing URL veya
  referansları reddeder. `prod:evidence:templates:check` bu negatifleri korur. Bu değişiklik
  gerçek UAT/region/rollback koşularını çalıştırmaz; ilgili Faz 5/Faz 10 kanıtları hâlâ
  staging/prod artifact zinciriyle üretilmelidir.
- Final/prod/live/go-live evidence target temp-path guardrail'i macOS `/private/tmp` kapsamına
  genişletildi: `scripts/check-final-external-evidence.mjs`, `scripts/check-prod-evidence.mjs`,
  `scripts/check-live-status-evidence.mjs` ve `scripts/check-go-live-evidence.mjs` artık
  `/tmp`, `/var/tmp` ve `/private/tmp` hedeflerini final/staging kanıt olarak reddeder;
  `prod:evidence:templates:check` hem genel target seti hem de final/prod evidence için bu
  negatifleri korur.
- Remote final evidence kapanışı yeniden denetlendi: `o-okul-server` altında mevcut kalıcı
  staging artifact'leri `isem-optical-pipeline.json`, `live-exam-cycle.json`,
  `live-ui-worker-result.json`, `reports/kvkk-inventory.json`, `reports/rls-live.json`,
  `reports/audit-null-tenant.json` ve `smoke/report-generation.json` ile sınırlı. Final
  kapının beklediği `artifacts/staging/release-summary.json`, `live-status.json`, `pilot.json`
  ve `go-live.json` yok. Bu hedeflerle remote
  `corepack pnpm prod:external-evidence:check` çalıştırıldığında dört hedef de
  `okunabilir file artifact olmalı` hatasıyla kırıldı; aynı target setiyle
  `corepack pnpm prod:remote-evidence:check` remote `live:status:check` ve remote final external
  checker aşamalarında aynı eksikliği raporladı. Bu yüzden Faz 5/Faz 10 hâlâ final kapanış
  değildir; sıradaki zorunlu iş gerçek production summary, 18/18 live-status, pilot ve go-live
  artifact setini üretmektir.
- TR datacenter/provider kanıtı için yanlış pozitif guardrail'i güçlendirildi: remote
  `o-okul-server` üzerinde `api`, `worker`, `postgres`, `redis`, `minio/object-storage`,
  `web` ve `traefik` servisleri read-only olarak görüldü; public IP `212.108.107.190` için
  IP lookup `TR/Istanbul` ve `AS212219 HOSTING DUNYAM` döndürüyor. Bu yalnız teşhis sinyalidir,
  provider console/contract veya kalıcı first-party artifact yerine final kanıt sayılmaz.
  `scripts/check-deployment-region-evidence.mjs` artık `evidenceReference` olarak `ipinfo.io`,
  `ip-api.com`, `ipapi.co`, `api.ipify.org` gibi public IP lookup hedeflerini tek başına
  reddeder; `prod:evidence:templates:check` bu negatif senaryoyu korur. Bu nedenle
  `TR datacenter/provider kanıtı` hâlâ `NOT_RUN` kalır.
- Deployment region artifact üretim yolu eklendi: `scripts/generate-deployment-region-evidence.mjs`
  ve `pnpm deployment:region:generate`, gerçek `DEPLOYMENT_REGION_PROVIDER`,
  `DEPLOYMENT_REGION_REGION`, `DEPLOYMENT_REGION_DATACENTER_COUNTRY_CODE=TR`,
  `DEPLOYMENT_REGION_DATA_RESIDENCY_VERIFIED=true`, kalıcı
  `DEPLOYMENT_REGION_EVIDENCE_REFERENCE` ve exact
  `DEPLOYMENT_REGION_SERVICES_VERIFIED=api,worker,postgres,redis,object-storage` olmadan
  `reports/deployment-region.json` yazmaz. Generator çıktıyı hemen
  `DEPLOYMENT_REGION_TARGET=file://... pnpm deployment:region:check` ile doğrular ve public IP
  lookup referansını final kanıt olarak kabul etmez. Remote/staging ortamda sağlayıcı
  console/sözleşme veya first-party TR datacenter artifact referansı henüz sağlanmadığı için
  `reports/deployment-region.json` bundle eksik listesinde kalır. Lokal ve remote
  `node --check`, eksik env fail-fast ve public IP lookup fail-fast doğrulamaları dosya
  yazmadan kırıldı; `prod:plan:check`, `prod:readiness:check`,
  `prod:evidence:templates:check` ve `ops:check` iki ortamda da geçti. Bu ara turdaki remote gap raporu
  `result=NOT_RELEASE_EVIDENCE`, `overallStatus=BLOCKED`, 12 eksik zorunlu artifact ve 0
  `release-summary-*.json` gösteriyordu; güncel sayı yukarıdaki Kalan 10 Artifact Kapanis Matrisi'nde izlenir.
- Staging release bundle canonical rapor konumu ilerletildi: daha önce checker'dan geçmiş
  `artifacts/staging/live-exam-cycle.json`, `artifacts/staging/isem-optical-pipeline.json` ve
  `artifacts/staging/live-ui-worker-result.json` remote üzerinde `artifacts/staging/reports/`
  altına kopyalandı. Bu üç hedef yeni canonical konumlarından sırasıyla
  `live:exam-cycle:check`, `isem-optical-pipeline:evidence-check` ve
  `live:ui-worker:result-check` ile geçti. `scripts/check-staging-release-artifacts.mjs`
  artık `reports/live-ui-worker-result.json` dosyasını da zorunlu rapor setine dahil eder;
  `prod:evidence:templates:check` bu bundle fixture'ını korur. Restore-drill artifact'i sonraki
  turda canonical `reports/restore-drill.json` konumunda üretildiği için bu eksik listeden düştü.
  Bundle hâlâ final PASS değildir: `first-gates/first-gates-manifest.json`, deployment/
  identity/financial/upload-av/observability/external-monitoring/admin-mfa/security/
  inline-upload/rate-limit/UAT raporları ve `release-summary-*.json` eksik olduğu için
  `STAGING_RELEASE_ARTIFACTS_TARGET=/root/o-okul/artifacts/staging corepack pnpm staging:release-artifacts:check`
  kırmızı kalır.
- GitHub CI kanıtı gerçek GitHub Actions metadata'sından üretildi: `4rmus/o-okul`
  `89fa803bdb5ae775c64617a8fbc71f7ed58c887c` commit'i için `.github/workflows/ci.yml`
  run `27993832864` success durumunda ve job adımları içinde `pnpm run ci` var. Lokal
  `artifacts/staging/reports/github-ci.json` üretildi, remote canonical konuma kopyalandı ve
  hem lokal hem remote `GITHUB_CI_EVIDENCE_TARGET=file://... corepack pnpm github-ci:check`
  kapısından geçti. Bu yüzden `reports/github-ci.json` staging bundle eksik listesinden düştü;
  bundle yine yukarıdaki kalan raporlar ve `release-summary-*.json` eksikliği nedeniyle
  kırmızı kalır.
- First-gates ve rate-limit staging teşhisi bu turda final PASS artifact üretmedi: remote
  `.env.local` içinde `API_URL`, `NODE_ENV`, `API_RATE_LIMIT_ENABLED` ve
  `LOGIN_ATTEMPT_LIMITER_STORE` set olsa da `TRAEFIK_HTTPS_SMOKE_URL`,
  `ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_TOKEN` ve ikinci API instance/LB shard URL'leri yok.
  Teşhis amaçlı first-gates koşusu Traefik HTTPS adımında `self-signed certificate` hatasıyla
  durdu; `staging:first-gates:smoke` artık final dışı `artifacts/local/**` output-dir'ünü de
  reddeder. Alert webhook secret'ı
  olmadığı için `first-gates/first-gates-manifest.json` üretmek doğru olmaz. Rate-limit kanıtı
  sonradan ikinci shard ve gerçek smoke ile PASS edildi; bu nedenle bu blokta kalan doğru sıradaki
  iş gerçek alert secret ve public TLS/domain hedefi sağlandıktan sonra first-gates smoke + checker
  zincirini yeniden koşmaktır.
- Staging release bundle gap raporu eklendi: `scripts/check-staging-release-artifacts.mjs`
  başarısız bundle koşusunda isteğe bağlı `STAGING_RELEASE_GAP_REPORT_FILE=...` hedefiyle
  `reportType=staging_release_artifacts_gap_report`, `result=NOT_RELEASE_EVIDENCE`,
  `overallStatus=BLOCKED`, `releaseEvidence=false` ve `canPromote=false` içeren makine-okunur
  eksik/uyumsuzluk raporu yazabilir. Bu mod checker exit code'unu yeşile çevirmez, `PASS`,
  `commandsPassed`, boş `gaps`, `reports` veya `smokeEvidence` gibi release-evidence alanları
  taşımaz ve staging bundle dizininin içine yazılamaz. `prod:evidence:templates:check` eksik
  `reports/rate-limit.json` negatifinde bu non-evidence shape'i korur.
- Restore-drill gerçek artifact üretim yolu eklendi: `scripts/generate-restore-drill-evidence.mjs`
  ve `pnpm restore:drill:generate`, Docker Compose postgres servisinden custom-format dump alıp
  geçici restore DB'ye geri yükler, `Tenant`, `AuditLog`, `ReportSnapshot` ve `_prisma_migrations`
  sayımlarını restore edilen DB'den okur, geçici DB/dump'ı temizler ve yalnız
  `check-restore-drill-evidence.mjs` sözleşmesindeki 7 alanı `reports/restore-drill.json`
  olarak yazar. `backup:restore:smoke` hâlâ pre-evidence'tır; final restore-drill yerine geçmez.
  Remote/staging `o-okul-server` üzerinde
  `STAGING_ENVIRONMENT=staging RESTORE_DRILL_OUTPUT=artifacts/staging/reports/restore-drill.json corepack pnpm restore:drill:generate`
  çalıştırıldı; artifact `Tenant=13`, `AuditLog=431`, `ReportSnapshot=11`,
  `_prisma_migrations=60`, boş `errors`, gerçek `sourceBackup`/`targetDatabase` ve
  `environment=staging` ile yazıldı. `RESTORE_DRILL_TARGET=file:///root/o-okul/artifacts/staging/reports/restore-drill.json corepack pnpm restore:drill:check`
  geçti; secret/PII anahtar grep'i temiz. Restore sonrası remote staging gap raporu artık
  `reports/restore-drill.json` eksikliği göstermedi; o noktada 14 eksik artifact ve 0
  `release-summary-*.json` nedeniyle bundle hâlâ `NOT_RELEASE_EVIDENCE/BLOCKED` kaldı.
- AI karne özeti disabled-mode artifact üretim yolu eklendi:
  `scripts/generate-ai-report-summary-evidence.mjs` ve `pnpm ai-report-summary:generate`,
  `AI_REPORT_SUMMARY_PROVIDER=disabled` dışındaki runtime'ı reddeder, worker/API report testlerini
  koşar ve `DEC-20260613-03` stop-rule referansıyla `provider.mode=disabled`,
  `piiSentToModel=false`, `externalProviderNotCalled=true`, yorum üretimi kapalı ve boş `gaps`
  taşıyan `reports/ai-report-summary.json` üretir. Bu kanıt AI/template yorumu açmaz; yalnız bu
  release'te dış AI çağrısı yapılmadığını ve yorum taslağı üretilmediğini release bundle'a bağlar.
  Remote/staging `o-okul-server` üzerinde
  `STAGING_ENVIRONMENT=staging AI_REPORT_SUMMARY_PROVIDER=disabled AI_REPORT_SUMMARY_OUTPUT=artifacts/staging/reports/ai-report-summary.json corepack pnpm ai-report-summary:generate`
  çalıştırıldı; worker `report-generation-job.test.ts` 8 test, API
  `report-generation.service.test.ts` 19 test geçti ve
  `AI_REPORT_SUMMARY_EVIDENCE_TARGET=file:///root/o-okul/artifacts/staging/reports/ai-report-summary.json corepack pnpm ai-report-summary:check`
  PASS verdi. Artifact `result=PASS`, `environment=staging`, `provider.mode=disabled`,
  `kvkk.piiSentToModel=false`, `validation.externalProviderNotCalled=true`, 3 komut ve boş
  `gaps` taşıyor; dar secret/PII taraması temiz. Güncel gap raporu artık
  `reports/ai-report-summary.json` eksikliği göstermiyor; kalan 11 artifact ve 0
  `release-summary-*.json` nedeniyle bundle hâlâ `NOT_RELEASE_EVIDENCE/BLOCKED`.
- Kimlik göçü artifact üretim yolu eklendi: `scripts/generate-identity-migration-evidence.mjs`
  ve `pnpm identity-migration:generate`, gerçek `IDENTITY_MIGRATION_APPROVED_BY`,
  `IDENTITY_MIGRATION_APPROVAL_REFERENCE` ve `IDENTITY_MIGRATION_ACTIVATION_MODE` olmadan
  artifact yazmaz. Generator staging/prod DB'de `STUDENT`, `GUARDIAN` ve `TEACHER` kayıtları
  için `sourceRecords == linkedUsers == tenantMembershipsCreated` eşitliğini ister; identity
  invitation ve tenant user management e2e testleri geçmeden `reports/identity-migration.json`
  yazmaz. Generator hedefli API e2e testlerini `DATABASE_URL`, `DIRECT_DATABASE_URL`, `NODE_ENV`
  ve `ADMIN_MFA_MODE` env'lerinden izole eder; boylece canlı DB env'i test login akisini bozsa da
  subject sayimi yine `DIRECT_DATABASE_URL` uzerinden staging/prod DB'den okunur. Son remote
  read-only sayim `Student=0`, `Guardian=0`, `Teacher=0`, `IdentityInvitation=0` gosterdi; bu
  yuzden kimlik göçü gerçek PASS için hazır değildir ve `reports/identity-migration.json` bundle
  eksik listesinde kalır.
- Finansal saklama artifact üretim yolu eklendi: `scripts/generate-financial-retention-evidence.mjs`
  ve `pnpm financial-retention:generate`, gerçek `FINANCIAL_RETENTION_APPROVED_BY`,
  `FINANCIAL_RETENTION_APPROVAL_REFERENCE`, `FINANCIAL_RETENTION_LEGAL_BASIS`,
  `FINANCIAL_RETENTION_PERIOD_YEARS` ve `FINANCIAL_RETENTION_PURGE_EXCEPTION=true` değerleri
  olmadan artifact yazmaz. Generator payment e2e içindeki KVKK purge ödeme planı koruma testini koşar, staging/prod
  DB'den `PaymentPlan` ve `PaymentInstallment` sayar, pozitif kayıt yoksa veya onay alanı
  placeholder/example/redacted/test içerirse durur. Generator hedefli payment e2e testini
  `DATABASE_URL`, `DIRECT_DATABASE_URL`, `NODE_ENV`, `ADMIN_MFA_MODE`, `PERSISTENCE_DRIVER` ve `IDEMPOTENCY_STORE` env'lerinden izole eder;
  boylece canlı DB env'i test login akisini bozsa da finans sayimi yine `DIRECT_DATABASE_URL`
  uzerinden staging/prod DB'den okunur. Son remote read-only sayim `PaymentPlan=0` ve
  `PaymentInstallment=0` gösterdi. Izolasyon sonrasi remote probe'da payment e2e 16/16 gecti,
  ardindan `financialRecords.paymentPlans` sifirdan buyuk olmadigi icin artifact yazmadan durdu;
  ayrica gerçek finansal saklama onay sahibi, onay referansı ve yasal dayanak env'i henüz sağlanmadığı için
  `reports/financial-retention.json` üretilmedi ve bundle eksik listesinde kalır.
- Read-only infra/observability ajan denetimi restore drill, deployment region, deployment rollback,
  observability UAT, external monitoring, security audit ve admin MFA raporlarının bu turda gerçek
  staging artifact olarak güvenle üretilemeyeceğini doğruladı. Restore için önce
  `backup:restore:smoke` yalnız ön kanıt sayılıyordu; yukarıdaki generator eklenip gerçek
  `restore-drill` raporu üretildikten sonra bu eksik kapandı. Region için public IP/ASN lookup,
  provider console/sözleşme veya first-party TR datacenter artifact'i yerine geçmez; rollback için
  gerçek başarısız image ve geri alma tatbikatı olmadan elle yazılmış JSON operasyonel kanıt
  sayılmaz. Observability/security/admin MFA checker'ları da doğru şekilli JSON'u doğrular, fakat
  linked log/screenshot/monitor kayıtlarının canlı sistemden geldiğini tek başına kanıtlamaz; bu
  nedenle bu raporlar production summary, live-status, pilot ve go-live zincirine bağlanmadan
  Faz 5/Faz 10 kapanışı olarak işaretlenmez.
- Deployment rollback artifact üretim yolu eklendi: `scripts/generate-deployment-rollback-evidence.mjs`
  ve `pnpm deployment:rollback:generate`, gerçek rollback drill onayı, bozuk image/release candidate,
  farklı rollback image tag'i, `drillStartedAt <= drillCompletedAt <= checkedAt`, migration rollback
  onayı, command log referansı, bozuk release summary, rollback summary ve `web/api/worker` servis
  kanıtları olmadan `reports/deployment-rollback.json` yazmaz. Generator çıktıyı hemen
  `DEPLOYMENT_ROLLBACK_TARGET=file://... pnpm deployment:rollback:check` ile doğrular ve
  `artifacts/local`, temp path, symlink parent, placeholder/example/redacted/test veya secret-bearing
  reference değerlerini reddeder. Alt ajan read-only denetimi de gerçek bozuk image tatbikatı
  yapılmadan doğru kapanış artifact'i üretmenin güvenli olmadığını ve önce fail-fast generator
  eklenmesi gerektiğini doğruladı. Remote/staging ortamda bozuk image enjekte etme + geri alma
  tatbikatı, command log ve linked summary referansları henüz sağlanmadığı için
  `reports/deployment-rollback.json` bundle eksik listesinde kalır. Lokal ve remote
  `node --check`, eksik env fail-fast ve placeholder/secret reference fail-fast doğrulamaları
  dosya yazmadan kırıldı; `prod:plan:check`, `prod:readiness:check`,
  `prod:evidence:templates:check` ve `ops:check` iki ortamda da geçti. Bu ara turdaki remote gap raporu
  `result=NOT_RELEASE_EVIDENCE`, `overallStatus=BLOCKED`, 12 eksik zorunlu artifact ve 0
  `release-summary-*.json` gösteriyordu; güncel sayı yukarıdaki Kalan 10 Artifact Kapanis Matrisi'nde izlenir.
- Upload AV artifact üretim yolu eklendi: `scripts/generate-upload-av-evidence.mjs` ve
  `pnpm upload-av:generate`, `UPLOAD_AV_SCANNER=clamav`, gerçek scanner karar/onay alanları,
  fail-closed onayları, `CLAMAV_HOST`/`CLAMAV_PORT` ve unreachable scanner test hedefi olmadan
  artifact yazmaz. Generator ClamAV `VERSION` ve `INSTREAM` üzerinden temiz dosya ve EICAR test
  vektörünü gerçek scanner'a gönderir, unreachable scanner hedefinin fail-closed kırılmasını bekler,
  `upload-av-scanner`, homework ve support-ticket hedefli API testlerini koşar ve çıktıyı hemen
  `UPLOAD_AV_TARGET=file://... pnpm upload-av:check` ile doğrular. Remote/staging'de
  `docker compose --profile av up -d clamav` ile ClamAV başlatıldı; ilk freshclam güncellemesi CDN
  403/cooldown verdi ama mevcut `ClamAV 1.5.2/28038` imza verisiyle TCP `VERSION`, clean scan,
  EICAR malware scan ve unavailable scanner fail-closed testi geçti. Generator testleri `.env.local`
  DB env'iyle çalışınca homework e2e login 401 verdiği için `scripts/generate-upload-av-evidence.mjs`
  hedefli API testlerini `DATABASE_URL`, `DIRECT_DATABASE_URL`, `NODE_ENV`, `ADMIN_MFA_MODE`, `PERSISTENCE_DRIVER` ve `IDEMPOTENCY_STORE`
  env'lerinden izole edecek şekilde sertleştirildi. Temiz env koşusunda 3 test dosyası/37 test geçti,
  `reports/upload-av.json` yazıldı ve `UPLOAD_AV_TARGET=file://... pnpm upload-av:check` PASS verdi.
  Güncel remote gap raporu `result=NOT_RELEASE_EVIDENCE`, `overallStatus=BLOCKED`, 11 eksik zorunlu
  artifact ve 0 `release-summary-*.json` gösterir; upload AV artık eksik listesinde değildir.
- Admin MFA artifact üretim yolu eklendi: `scripts/generate-admin-mfa-evidence.mjs` ve
  `pnpm admin-mfa:generate`, gerçek `DIRECT_DATABASE_URL`, `ADMIN_MFA_MODE`, MFA secret'ları,
  sekiz login/recovery/session doğrulama bayrağı ve sekiz gerçek evidence reference olmadan
  artifact yazmaz. Generator aktif tenant DB'sinde SYSTEM_ADMIN/TENANT_ADMIN sayımlarını okur,
  tüm zorunlu adminler TOTP enrollment'lı değilse, recovery code hash'i yoksa, auth MFA testleri
  veya API typecheck geçmezse `reports/admin-mfa.json` üretmez; ürettiği çıktıyı hemen
  `ADMIN_MFA_EVIDENCE_TARGET=file://... pnpm admin-mfa:check` ile doğrular. Alt ajan read-only
  denetimi repo içinde daha önce yalnız checker/template/docs olduğunu, gerçek admin enrollment,
  password-only block, TOTP/recovery reuse ve session revoke kanıtı olmadan Admin MFA kapanışının
  doğru sayılamayacağını doğruladı. Lokal ve remote `node --check`, package script kontrolü, eksik
  env fail-fast doğrulaması, `prod:plan:check`, `prod:readiness:check`, `prod:evidence:templates:check`
  ve `ops:check` geçti. Bu ara turdaki remote gap raporu `result=NOT_RELEASE_EVIDENCE`,
  `overallStatus=BLOCKED`, 12 eksik zorunlu artifact ve 0 `release-summary-*.json` gösteriyordu;
  güncel sayı yukarıdaki Kalan 10 Artifact Kapanis Matrisi'nde izlenir;
  eksikler içinde `reports/admin-mfa.json` da var.
- Security audit artifact üretim yolu eklendi: `scripts/generate-security-audit-evidence.mjs` ve
  `pnpm security:audit:generate`, gerçek `SECURITY_AUDIT_APP_URL`, `SECURITY_AUDIT_API_URL`,
  `SECURITY_AUDIT_HEADERS_URL`, `RLS_LIVE_EVIDENCE_TARGET`, sekiz auth/data güvenlik doğrulama
  bayrağı ve beş gerçek evidence reference olmadan artifact yazmaz. Generator `prod:env:check`,
  `web:token-storage:check`, `rls:live:check`, `/health`, `/health/ready` ve altı security header
  kontrolü geçmeden `reports/security-audit.json` üretmez; çıktıyı hemen
  `SECURITY_AUDIT_TARGET=file://... pnpm security:audit:check` ile doğrular. Lokal `node --check`,
  package script kontrolü ve eksik env fail-fast doğrulaması dosya yazmadan geçti. Remote gerçek
  HTTPS endpoint/header, auth control ve RLS live referansları sağlanmadan `reports/security-audit.json`
  bundle eksik listesinde kalır; bu local/static PASS değil, yalnızca doğru fail-fast üretim yoludur.
- Observability UAT artifact üretim yolu eklendi: `scripts/generate-observability-uat-evidence.mjs`
  ve `pnpm observability:uat:generate`, gerçek `OBSERVABILITY_UAT_PROMETHEUS_URL`,
  `OBSERVABILITY_UAT_GRAFANA_URL`, `OBSERVABILITY_UAT_LOKI_URL`, alert webhook smoke artifact'i,
  exact dashboard/alert listeleri ve dört gerçek evidence reference olmadan artifact yazmaz. Generator
  Prometheus `/-/ready`, Grafana `/api/health`, Loki `/ready` ve alert webhook smoke JSON'unu doğrular;
  çıktıyı hemen `OBSERVABILITY_UAT_TARGET=file://... pnpm observability:uat:check` ile geçirir.
  `OBSERVABILITY_UAT_TARGET`, `OBSERVABILITY_UAT_OUTPUT` ve `OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET`
  için secret URL ve `artifacts/local/**` negatifleri template check içinde korunur.
  Lokal `node --check`, package script kontrolü ve eksik env fail-fast doğrulaması dosya yazmadan
  geçti. Remote gerçek observability endpoint'leri ve alert delivery artifact'i sağlanmadan
  `reports/observability-uat.json` bundle eksik listesinde kalır; bu da local/static PASS değil,
  yalnızca doğru fail-fast üretim yoludur.
- External monitoring artifact üretim yolu eklendi: `scripts/generate-external-monitoring-evidence.mjs`
  ve `pnpm external-monitoring:generate`, gerçek Uptime Kuma node host/region/network bilgisi,
  public HTTPS `API /health`, `API /health/ready`, web login ve TLS URL'leri, alert webhook 2xx
  sonucu, outage drill timestamp'leri ve üç gerçek evidence reference olmadan artifact yazmaz.
  Generator public endpoint'leri canlı fetch ile kontrol eder, TLS sertifika geçerlilik gününü
  gerçek peer certificate üzerinden hesaplar, outage latency değerlerini timestamp farklarından
  üretir ve çıktıyı hemen `EXTERNAL_MONITORING_TARGET=file://... pnpm external-monitoring:check`
  ile doğrular. Lokal `node --check`, package script kontrolü ve eksik env fail-fast doğrulaması
  dosya yazmadan geçti. Remote gerçek dış izleme node'u, outage drill ve TLS/monitor kanıtları
  sağlanmadan `reports/external-monitoring.json` bundle eksik listesinde kalır; bu da final PASS
  değil, doğru fail-fast üretim yoludur.
- UAT artifact üretim yolu eklendi: `scripts/generate-uat-evidence.mjs` ve `pnpm uat:generate`,
  gerçek `UAT_TESTER`, release candidate, rollback image, restore backup referansı, 12 zorunlu
  komutun PASS/evidence listesini taşıyan `UAT_COMMAND_EVIDENCE_TARGET` ve 21 UAT senaryosunun
  exact ID/persona/PASS/evidence setini taşıyan `UAT_SCENARIOS_TARGET` olmadan artifact yazmaz.
  Generator template cümleleri, placeholder/redacted/example/test, temp path, `artifacts/local`,
  userinfo/query/fragment taşıyan referansları reddeder; `UAT_OUTPUT`, `UAT_COMMAND_EVIDENCE_TARGET`
  ve `UAT_SCENARIOS_TARGET` için `artifacts/local/**` negatifleri template check içinde korunur; çıktıyı hemen
  `UAT_EVIDENCE_TARGET=file://... pnpm uat:check` ile doğrular. Lokal `node --check`, package
  script kontrolü ve eksik env fail-fast doğrulaması dosya yazmadan geçti. Gerçek rol bazlı UAT
  koşusu, komut kanıtları ve persona evidence artifact'leri sağlanmadan `reports/uat.json` bundle
  eksik listesinde kalır; bu final PASS değil, doğru fail-fast üretim yoludur.
- Inline upload migration final artifact üretim yolu eklendi: `scripts/generate-inline-upload-content-migration-evidence.mjs`
  ve `pnpm inline-upload-content:generate`, gerçek dry-run artifact'i
  `INLINE_UPLOAD_CONTENT_DRY_RUN_TARGET`, onaylı migrate artifact'i
  `INLINE_UPLOAD_CONTENT_APPROVED_MIGRATION_TARGET`, orphan audit artifact'i
  `INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_TARGET`, gerçek approval owner/reference, S3 storage
  modu, signed-url indirme modu, `downloadUrlExpiresInSeconds<=300`, write-disable ve inline-read
  uyumluluk onayları olmadan `reports/inline-upload-content-migration.json` yazmaz. Generator
  dry-run `DRY_RUN`, migration `MIGRATED`, iki subject seti, migration sonrası pending satır/byte
  sıfırı ve migrated row >= dry-run pending row koşullarını kontrol eder; çıktıyı hemen
  `INLINE_UPLOAD_CONTENT_MIGRATION_TARGET=file://... pnpm inline-upload-content:check` ile
  doğrular. Lokal `node --check`, package script kontrolü, eksik env fail-fast, örnek
  dry-run/migrated parçalarıyla pozitif generator koşusu, `prod:plan:check`, `prod:readiness:check`,
  `prod:evidence:templates:check` ve `ops:check` geçti; remote sync sonrası `node --check`,
  `prod:readiness:check` ve `ops:check` geçti. Remote/staging'de
  `pnpm inline-upload-content:repair-sha` dry-run 2+2 repairable satır, invalid base64 0 buldu;
  onaylı repair 2+2 `sha256` değerini doldurdu; tekrar hash audit 4/4 match verdi. Ardından
  dry-run migration 2+2 pending satırı kaydetti, `INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true`
  migrate 2+2 satırı S3'e taşıyıp pending row/byte değerini sıfırladı, orphan audit
  `NO_ORPHANS` ve final `reports/inline-upload-content-migration.json` checker PASS verdi.
  Bu ara turdaki remote gap raporu `result=NOT_RELEASE_EVIDENCE`, `overallStatus=BLOCKED`, 12 eksik
  zorunlu artifact ve 0 `release-summary-*.json` gösteriyordu; güncel sayı yukarıdaki Kalan 10 Artifact
  Kapanis Matrisi'nde izlenir; inline upload migration artık eksik
  listesinde değildir.
- Rate-limit Redis final artifact üretim yolu eklendi: `scripts/generate-rate-limit-evidence.mjs`
  ve `pnpm rate-limit:generate`, gerçek `pnpm rate-limit:smoke` çıktısını
  `RATE_LIMIT_SMOKE_EVIDENCE_TARGET=file:///.../smoke/rate-limit.json` üzerinden okur,
  önce input smoke artifact'ini `pnpm rate-limit:check` ile doğrular, sonra
  `RATE_LIMIT_EVIDENCE_OUTPUT=artifacts/staging/reports/rate-limit.json` altına yazar ve
  aynı final raporu tekrar checker'dan geçirir. Komut eksik input/output, lokal temp path,
  `artifacts/local/**`, symlink parent/file ve userinfo/query/fragment taşıyan file URL durumlarında
  dosya yazmadan kırılır.
  `docker-compose.rate-limit-shard.yml` tek node staging için host port açmayan ikinci API shard'ı
  sağlar; Traefik `/__rate-limit-shard` prefix'ini strip ederek bu container'a yönlendirir. Bu
  rate-limit Redis paylaşım kanıtı yolunu açar ama public TLS/first-gates kanıtı yerine geçmez;
  Traefik gerçek edge IP'siyle `X-Forwarded-For` değerini sabitlediğinde smoke script'i
  `RATE_LIMIT_SMOKE_RESET_API_LIMIT_BEFORE_API=true` ve
  `RATE_LIMIT_SMOKE_RESET_API_LIMIT_BEFORE_LOGIN=true` ile yalnız API limiter smoke key'ini
  temizleyip API/login limiter fazlarını ayrı doğrulayabilir; `differentIpNotLocked` negatifi
  `RATE_LIMIT_LOGIN_SMOKE_OTHER_IP_URL` ile lokal API portundan ayrıştırılabilir. Final
  Remote/staging'de `api-primary` ve `api-rate-limit-shard` URL'leriyle gerçek smoke PASS edildi,
  final `reports/rate-limit.json` üretildi ve raw `smoke/rate-limit.json` final bundle dışı olduğu
  için `artifacts/local/staging-release-unexpected-rate-limit-smoke-2026-06-24` altına arşivlendi.
- First-gates alert webhook smoke fail-fast güvenliği sertleştirildi: `scripts/smoke-alert-webhook.mjs`
  artık `ALERT_WEBHOOK_URL` için `https://` gerçek host, userinfo/query/fragment yokluğu ve
  lokal/test host reddini network isteğinden önce uygular. Böylece yanlış webhook URL'sine bearer
  secret gönderilmeden komut kırılır. Bu guardrail `prod:evidence:templates:check` içindeki HTTP URL,
  secret URL ve local host negatifleriyle korunur; `check-ops-config` de aynı script beklentilerini
  denetler. Bu değişiklik gerçek first-gates PASS artifact'i üretmez: remote/staging hâlâ public
  TLS/HSTS domain ve gerçek alert webhook secret sağlanmadan `first-gates/first-gates-manifest.json`
  eksik listesinde kalır.
- Traefik IP edge ile ACME domain edge birlikte config edilirken router'lar artık service adını açıkça
  taşır: `web -> web`, `api -> api`, `web-ip -> web-ip`, `api-ip -> api-ip`. Bu, domain geçiş
  provasındaki ambiguous Traefik service hatasını tekrar ettirmemek için `docker:check`,
  `prod:readiness:check` ve `ops:check` statik kapılarıyla korunur. Bu yalnızca geçiş guardrail'idir;
  gerçek first-gates PASS için hâlâ public TLS/HSTS domain ve alert webhook kanıtı gerekir.
- Deployment rollback kanıtı false-pass riski azaltıldı: `scripts/check-deployment-rollback-evidence.mjs`
  artık üç servislik `servicesVerified` setinde her servis `imageTag` değerinin top-level
  `rollbackImageTag` ile aynı image versiyonuna döndüğünü kontrol eder; generator da aynı
  uyumsuzluğu artifact yazmadan reddeder. `prod:evidence:templates:check` içine servis image
  versiyon uyumsuzluğu negatifi eklendi ve `prod:readiness:check`/`ops:check` bu guardrail'i
  sentinel token'larla izler. Bu gerçek rollback drill artifact'i üretmez; `reports/deployment-rollback.json`
  hâlâ bozuk image tatbikatı, rollback summary ve servis health kanıtları sağlanmadan eksik kalır.
- Production evidence summary false-pass riski azaltıldı: `scripts/check-prod-evidence.mjs`
  artık herhangi bir `*_ALLOW_EXAMPLE_EVIDENCE=1` bayrağı açıkken alt checker/smoke script
  çalıştırmadan kırılır. Bu, template modundaki fixture gevşetmelerinin `prod:evidence:check
  --summary-file` üzerinden gerçek production summary'ye taşınmasını engeller. Negatif test
  `prod:evidence:templates:check` içinde korunur; `prod:readiness:check` ve `ops:check`
  bu guardrail'i sentinel token'larla izler.
