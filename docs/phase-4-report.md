# Faz 4 Durum Raporu

## Tamamlanan repo içi kapsam

- Faz 4 raporlama hattı için ilk küçük dilim olarak worker tarafında `report-generation` job
  işlemcisi eklendi.
- `report-generation` payload'ı `entityId` değerini `examId`, `contentHash` değerini rapor girdisi
  sürümü olarak kullanır; `reportType` şimdilik yalnız `EXAM_RESULT_SUMMARY` kabul eder.
- Mevcut `ExamResult` kayıtlarından tekrar üretilebilir `ReportSnapshot` adayı üreten saf özet
  fonksiyonu eklendi.
- Snapshot `inputRefs` içinde kullanılan `resultKey`, `answerKeyVersion`, `parserConfigVersion` ve
  `engineVersion` listesini taşır.
- Snapshot `snapshotData` içinde sonuç sayısı, genel ortalamalar, branş ortalamaları ve öğrenci
  bazlı toplam/branş skor özetleri bulunur.
- `PostgresReportGenerationAdapter`, tenant context içinde `ExamResult` kayıtlarını okur ve
  `ReportSnapshot` tablosuna `READY` status ile kayıt yazar.
- BullMQ daemon artık `exam-evaluation`, `excel-import` ve `report-generation` worker'larını aynı
  Redis connection/prefix sözleşmesiyle başlatır.
- API tarafında `report-generation` producer sözleşmesi `reportType = EXAM_RESULT_SUMMARY` alanını
  zorunlu taşıyacak şekilde sıkılaştırıldı.
- `POST /exams/:examId/reports/generation-jobs` endpoint'i eklendi; yalnız `TENANT_ADMIN` rolüyle
  çalışır ve rapor üretim isteğini `report-generation` kuyruğuna gönderir.
- Endpoint şimdilik rapor girdisi sürümünü `contentHash` body alanından açıkça ister; `ExamResult`
  setinden otomatik hash üretme ayrı DB-backed dilime bırakıldı.
- `GET /exams/:examId/reports/snapshots` endpoint'i eklendi; `TENANT_ADMIN` ve `TEACHER` rolleri
  tenant içindeki hazır rapor snapshot'larını okuyabilir.
- Report snapshot okuma yolu default demo/in-memory store ile repo içi dashboard'u kırmadan çalışır;
  `REPORT_SNAPSHOT_STORE=postgres` ile Postgres `ReportSnapshot` tablosunu tenant-aware sorgular.
- Web dashboard'a sınav raporu paneli eklendi; hazır snapshot varsa durum, sonuç sayısı, ortalama
  net, standart puan ve ilk branş özetleri gösterilir.
- `GET /exams/:examId/reports/snapshots/:snapshotId/export.xlsx` endpoint'i eklendi; hazır snapshot
  verisinden `Summary`, `Branches` ve `Students` sayfaları olan Excel çıktısı üretir.
- Web rapor paneline `Excel indir` aksiyonu eklendi; snapshot export response'u base64 `.xlsx`
  dosyasına çevrilip tarayıcı indirmesi başlatılır.
- Rapor snapshot üretimi sınıf başarı analizini de taşır: her sınıf için sonuç sayısı, ortalama
  doğru/yanlış/boş/net/ham puan/standart puan hesaplanır.
- `PostgresReportGenerationAdapter`, `ExamResult` kayıtlarını `Student` ve `Class` ile tenant
  içinde join ederek sınıf bilgisini rapor girdisine taşır.
- Web rapor özetinde ilk sınıf başarı satırları gösterilir; Excel çıktısına `Classes` sayfası ve
  öğrenci satırlarına `classId/className` alanları eklendi.
- `GET /exams/:examId/reports/snapshots/:snapshotId/students/:studentId` endpoint'i eklendi;
  hazır snapshot içinden öğrencinin toplam ve branş bazlı sınav raporunu döner.
- Web rapor özetinde ilk öğrenci için sınıf, toplam net ve ilk branş neti gösterilir.
- `GET /exams/:examId/reports/snapshots/:snapshotId/export.pdf` endpoint'i eklendi; hazır
  snapshot verisinden tek sayfalık PDF rapor çıktısı üretir.
- Web rapor paneline `PDF indir` aksiyonu eklendi; snapshot PDF response'u base64 `.pdf`
  dosyasına çevrilip tarayıcı indirmesi başlatılır.
- PDF export yolu zengin HTML şablonuna taşındı; `REPORT_PDF_BROWSER_EXECUTABLE_PATH` veya
  `PUPPETEER_EXECUTABLE_PATH` verilirse `puppeteer-core` ile A4 PDF render edilir, tarayıcı yolu
  yoksa mevcut basit PDF yedeği korunur.
- API Docker image'ı Chromium paketini kurar ve
  `REPORT_PDF_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser` değerini sabitler; Puppeteer PDF
  render yolu container içinde doğrudan çalışabilecek hale getirildi.
- `pnpm report-generation:smoke` komutu eklendi; canlı Postgres/Redis üzerinde örnek sınav
  sonucu seed eder, gerçek `report-generation` kuyruğuna iş gönderir, worker'ın `ReportSnapshot`
  kaydını `READY` ürettiğini doğrular.
- `pnpm report-generation:perf` komutu eklendi; canlı Postgres/Redis üzerinde 10.000 örnek
  `ExamResult` kaydı seed eder, gerçek `report-generation` kuyruğu ile 10.000 öğrencilik
  `ReportSnapshot` üretimini doğrular.
- Worker rapor motoru için 10.000 öğrenci girdili performans testi eklendi; saf snapshot üretimi
  sonuç sayısı, öğrenci listesi, sınıf/branş kırılımları ve süre eşiğiyle doğrulanır.
- Web rapor paneline hazır snapshot geçmişinden ortalama net gelişim grafiği eklendi; son
  snapshotlar tarih sırasına alınır, net değişimi ve bar grafiği gösterilir.
- `GET /exams/:examId/reports/students/:studentId/progress` endpoint'i eklendi; hazır snapshot
  geçmişinden öğrencinin sınavlar arası toplam net ve standart puan gelişimini döner.
- Web rapor paneli ilk öğrenci için progress endpointini çağırır; öğrencinin sınavlar arası net
  değişimi ve kısa gelişim grafiği rapor özetinde gösterilir.
- `scripts/k6-report-listing.js` eklendi; canlı API üzerinde hazır 10.000 öğrencilik
  `ReportSnapshot` listesini ve öğrenci progress endpointini k6 ile ölçer.
- `report-listing:k6:check` statik kapısı CI'a bağlandı; k6 senaryosunun 10.000 öğrenci eşiği,
  snapshot liste endpointi, progress endpointi ve p95 süre eşikleri korunur.
- Canlı k6 kanıtı alındı: `tenant-a` altında 10.000 sonuçluk snapshot üretildi, API
  `REPORT_SNAPSHOT_STORE=postgres` ile başlatıldı, `grafana/k6` container'ı 1 VU/5 sn koşuda
  snapshot p95 `126.42ms`, student progress p95 `62.73ms`, check rate `%100`, failed request `%0`
  sonucunu verdi.

## Çalıştırılan doğrulamalar

- `pnpm --filter @uzman-hocam/worker test -- report-generation postgres-report-generation bullmq-worker`
- `pnpm --filter @uzman-hocam/worker typecheck`
- `pnpm --filter @uzman-hocam/api test -- report-generation job-producer bullmq-producer`
- `pnpm --filter @uzman-hocam/api typecheck`
- `pnpm run ci`
- `pnpm --filter @uzman-hocam/api test -- report-generation report-snapshot-store`
- `pnpm --filter @uzman-hocam/api typecheck`
- `pnpm --filter @uzman-hocam/web typecheck`
- `pnpm --filter @uzman-hocam/web build`
- `pnpm --filter @uzman-hocam/web test:e2e`
- `pnpm --filter @uzman-hocam/api test -- report-generation report-snapshot-store`
- `pnpm --filter @uzman-hocam/api typecheck`
- `pnpm --filter @uzman-hocam/web typecheck`
- `pnpm --filter @uzman-hocam/web build`
- `pnpm --filter @uzman-hocam/web test:e2e`
- `pnpm --filter @uzman-hocam/worker test -- report-generation postgres-report-generation`
- `pnpm --filter @uzman-hocam/api test -- report-generation report-snapshot-store`
- `pnpm --filter @uzman-hocam/worker typecheck`
- `pnpm --filter @uzman-hocam/api typecheck`
- `pnpm --filter @uzman-hocam/web typecheck`
- `pnpm --filter @uzman-hocam/web test:e2e`
- `pnpm --filter @uzman-hocam/web build`
- `pnpm --filter @uzman-hocam/api test -- report-generation report-snapshot-store`
- `pnpm --filter @uzman-hocam/api typecheck`
- `pnpm --filter @uzman-hocam/web typecheck`
- `pnpm --filter @uzman-hocam/web test:e2e`
- `pnpm --filter @uzman-hocam/web build`
- `pnpm run ci`
- `pnpm --filter @uzman-hocam/api test -- report-generation report-snapshot-store`
- `pnpm --filter @uzman-hocam/api typecheck`
- `pnpm --filter @uzman-hocam/web typecheck`
- `pnpm --filter @uzman-hocam/web test:e2e`
- `pnpm --filter @uzman-hocam/web build`
- `pnpm run ci`
- `node --check scripts/smoke-report-generation-live.mjs`
- `pnpm --filter @uzman-hocam/api build`
- `pnpm --filter @uzman-hocam/worker build`
- `pnpm report-generation:smoke`
- `pnpm report-generation:perf` — 10.000 sonuç; seed 1241ms, snapshot generation 7273ms
- `pnpm --filter @uzman-hocam/worker test -- report-generation`
- `pnpm --filter @uzman-hocam/web typecheck`
- `pnpm --filter @uzman-hocam/web test:e2e`
- `pnpm --filter @uzman-hocam/web build`
- `pnpm run ci`
- `pnpm --filter @uzman-hocam/api test -- report-generation report-snapshot-store`
- `pnpm --filter @uzman-hocam/api typecheck`
- `pnpm --filter @uzman-hocam/web typecheck`
- `pnpm --filter @uzman-hocam/web test:e2e`
- `pnpm --filter @uzman-hocam/web build`
- `pnpm --filter @uzman-hocam/api test -- report-generation report-snapshot-store`
- `pnpm --filter @uzman-hocam/api typecheck`
- `pnpm docker:check`
- `pnpm --filter @uzman-hocam/api typecheck`
- `pnpm --filter @uzman-hocam/api test -- report-generation report-snapshot-store`
- `pnpm report-listing:k6:check`
- `node --check scripts/k6-report-listing.js`
- `node --check scripts/check-k6-report-listing.mjs`
- `pnpm db:migrate`
- `REPORT_GENERATION_SMOKE_TENANT_ID=tenant-a REPORT_GENERATION_SMOKE_USER_ID=user-tenant-a pnpm report-generation:perf` — 10.000 sonuç; seed 1255ms, snapshot generation 442ms
- `pnpm --filter @uzman-hocam/api build`
- `pnpm --filter @uzman-hocam/api test -- report-snapshot-store`
- `docker run --rm -v "$PWD/scripts:/scripts:ro" -e API_BASE_URL=http://host.docker.internal:3100 -e API_TOKEN=<redacted> -e EXAM_ID=exam-report-smoke-3d4c1e91-c4ef-4620-aaed-a4338823ecf8 -e STUDENT_ID=student-report-smoke-3d4c1e91-c4ef-4620-aaed-a4338823ecf8-00000 -e EXPECTED_RESULT_COUNT=10000 -e K6_VUS=1 -e K6_DURATION=5s grafana/k6:latest run /scripts/k6-report-listing.js`

## Geçiş Kontrolü

- Faz 4 raporlama hattı için worker snapshot üretimi, API snapshot okuma, öğrenci raporu,
  gelişim raporu, Excel/PDF export, web rapor görünümü ve 10.000+ öğrenci k6 kanıtı tamamlandı.
- Faz 5'e geçiş için açık kalan repo içi raporlama işi yok; sonraki fazda mesaj, duyuru,
  materyal ve destek kapsamı ayrı küçük dilimlerle ilerletilecek.
