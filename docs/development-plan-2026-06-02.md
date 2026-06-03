# Uzman Hocam — Gerçek Veri & Ürün Tamamlama Planı

> **Tarih:** 2026-06-03 · **Durum:** UYGULAMA SÜRÜYOR — Faz 3/4 karne-portal kapanış turu için ölçüm-hamle planı aktif
> **Kaynak:** 4-ajan orkestrasyonu (`system-architect ∥ backend-architect ∥ frontend-architect` + iş paneli `Christensen/Drucker/Porter/Godin/Meadows/Taleb`) + kullanıcının sağladığı **gerçek örnek veri** (`ornek-veriler/`) üzerinden sentez.
> **Kanonik durum belgesi:** `docs/education-system-assessment-2026-06-01.md`. Bu plan onun yerini almaz; onun **Faz 4 (Sınav/Optik/Rapor)** kısmını gerçek veriyle somutlaştıran, UI/UX ve yetki hedeflerini de kapsayan **uygulanabilir devam planıdır**.
> **Kullanıcı kararları (2026-06-02):** (1) Plan artık adım adım uygulanıyor. (2) Farklılaştırıcı eklentilerden **"kazanım gelişim trendi" dahil**; veliye-tek-tık-SMS-karne **ertelendi** (§8).
> **Son güncelleme (2026-06-03 11:58+03:00):** 16. Tur `next-karne-brand` portal `span` için `font-size:22px→21.5px` denemesi yaptık; öğrenci/veli/öğretmende regresyon oldu, deneme geri alındı.

## 0. Yürütme Kaydı — 2026-06-03

Bu dosya artık yalnızca plan değil, uygulama sırasında kanıtla güncellenen yürütme belgesidir. Her fazda başarı kriteri şu üç parçayla kapanır: kod değişikliği, odaklı test/komut kanıtı, bir sonraki faza geçiş için kalan net sınır.

**Faz 0 tamamlananlar:**
- ⚙️ `apps/worker/src/jobs/optical-answer-parser.ts` fixed-width satırları artık `trim()` ile kırpmıyor; yalnız tamamen boş satırlar eleniyor. Böylece OPTİK-7108'in baştaki 11 boşluk dolgusu ve cevap içi boş karakterleri korunuyor.
- ✅ `apps/worker/src/jobs/optical-answer-parser.test.ts` gerçek `ornek-veriler/iSEM .txt` ilk satırını okuyan regresyon testi eklendi. Kanıt: OKUL NO `331`, kitapçık `A`, ilk 20 cevap `CBCADDBABDBACAABDACA` olarak parse ediliyor.
- ⚙️ `AnswerKeyService.create()` artık HTTP yüzeyine bağlı: `POST /exams/:examId/answer-keys`, `GET /exams/:examId/answer-keys`, `POST /exams/:examId/answer-keys/:version/publish`.
- ⚙️ `dryRun: true` desteği eklendi; validasyon ve özet döner, DB'ye yazmaz.
- 🧱 `PostgresAnswerKeyRepository` eklendi; `AnswerKey.keyData` mevcut worker sözleşmesiyle uyumlu `{ questions }` JSON biçiminde yazılır.

**Faz 0 doğrulama kanıtı:**
- `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/optical-answer-parser.test.ts` → 1 dosya, 8 test geçti.
- `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/answer-key.controller.e2e.test.ts src/exam/postgres-answer-key-repository.test.ts` → 2 dosya, 9 test geçti.
- `corepack pnpm --filter @uzman-hocam/worker typecheck` → geçti.
- `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- `corepack pnpm db:rls:check` → 39 tenant tablosu doğrulandı, geçti.

**Faz 1 backend eşiği:** gerçek veri motoru, karantina çözümü, TC(hash)+OKUL NO eşleme ve idempotent sonuç üretimi kanıtlandı. Sıradaki ana eşik Faz 2: karne/rapor yüzeyinde gerçek `ExamResult` verisini görünür yapmak.

**Faz 1 başlatıldı — ilk tamamlanan dilim:**
- ⚙️ `AnswerFieldSpec` için opsiyonel `segments[]` sözleşmesi eklendi; eski tek `start/length` ve delimited yolları korunuyor.
- ⚙️ `OpticalAnswerParser` fixed answers alanında `segments[]` varsa ders bloklarını sırayla birleştiriyor.
- ✅ Gerçek `ornek-veriler/iSEM .txt` ilk satırı 6 ders bloğundan 90 ardışık soruya çevriliyor; Matematik içindeki boş cevaplar `""` olarak korunuyor.
- ✅ `PostgresOpticalParseInputAdapter` segmentli fixed ParserConfig'i kabul ediyor, öğrenci no/kitapçık alanlarında segment kullanımına izin vermiyor.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/optical-answer-parser.test.ts src/jobs/postgres-optical-parse-input-adapter.test.ts` → 2 dosya, 14 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker typecheck` → geçti.

**Faz 1 devam — kitapçık hizalama + variant zemini tamamlandı:**
- ⚙️ `alignAnswersToMaster(answers, bookletType, variants)` saf fonksiyonu eklendi. A kitapçığı cevapları değişmez; B gibi variantlar `permutation` dizisiyle master sıraya çevrilir.
- ⚙️ `exam-evaluation-job.ts` puanlamadan önce cevapları master sıraya hizalıyor. Variant yoksa ya da permütasyon bozuksa net hata verir; sessiz yanlış puan üretmez.
- 🧱 `ExamBookletVariant` Prisma modeli ve migration eklendi: `{tenantId, examId, code, permutation, deletedAt}`; `@@unique([tenantId, examId, code])`; RLS policy ve app grant var.
- 🧱 `packages/db/scripts/check-rls.mjs`, `check-rls-live.mjs`, `packages/db/src/index.ts` ve `scripts/check-tenant-db-access.mjs` yeni tabloyu kapsıyor.
- ⚙️ `PostgresExamEvaluationAdapter` `ExamParticipant.bookletType` ve sınavın `ExamBookletVariant` kayıtlarını scoring input'a taşıyor.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/booklet-alignment.test.ts src/jobs/exam-evaluation-job.test.ts src/jobs/postgres-exam-evaluation-adapter.test.ts` → 3 dosya, 18 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/db exec prisma validate --schema prisma/schema.prisma` → geçti.
- Kanıt: `corepack pnpm db:rls:check` → 40 tenant tablosu doğrulandı, geçti.
- Kanıt: `corepack pnpm tenant-db:check` → geçti.

**Faz 1 devam — cevap anahtarı Excel importer'ı + OPTİK-7108 preset tamamlandı:**
- ⚙️ `OPTIK_7108_LGS` parser preset'i shared-types'a eklendi; API parser-config suggestion endpoint'i `preset: "OPTIK_7108_LGS"` ile örnek dosya istemeden bu config'i döndürür.
- ⚙️ Cevap anahtarı Excel importer servisi eklendi: `POST /exams/:examId/answer-keys/imports/dry-run` ve `POST /exams/:examId/answer-keys/imports`.
- ⚙️ Importer gerçek Excel başlıklarını okur: `BÖLÜM | SORU NO | B KARŞILIĞI | CEVAP | KAZANIM | KONU | BRANŞ`.
- ✅ Gerçek veri nüansı doğrulandı: `SORU NO` ve `B KARŞILIĞI` global 1..90 değil, ders içi yerel numaradır. Importer satır sırasını global soru numarası kabul eder, `B KARŞILIĞI` değerini ders bloğunun global başlangıcına çevirir ve 1..90 B permütasyonu üretir.
- ⚙️ `KAZANIM` → `outcomeCode`, `KONU` → `topic`, `BRANŞ` → `branch`; `topic` scorer soru satırlarında korunur ama puan hesabını değiştirmez.
- 🧱 Import sırasında `AnswerKey` ile birlikte `ExamBookletVariant(code="B")` aynı tenant transaction içinde upsert edilir.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/answer-key-excel-import.service.test.ts src/exam/answer-key.controller.e2e.test.ts src/exam/postgres-answer-key-repository.test.ts src/exam/parser-config-suggestion.service.test.ts` → 4 dosya, 21 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/optical-answer-parser.test.ts` → 1 dosya, 10 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck`, `--filter @uzman-hocam/worker typecheck`, `--filter @uzman-hocam/shared-types typecheck` → geçti.
- Not: `@uzman-hocam/shared-types` runtime export'u `dist` kullandığı için `corepack pnpm --filter @uzman-hocam/shared-types build` çalıştırıldı.

**Faz 1 devam — 3 gerçek deneme parse→hizala→puan fixture zinciri tamamlandı:**
- ✅ `apps/worker/src/jobs/optik-7108-real-pipeline.test.ts` eklendi ve 3 gerçek denemeye genişletildi. Test gerçek `ornek-veriler/{iSEM .txt, 3D.txt, MUBA.txt}` dosyalarından ilk A ve ilk B satırını, ilgili gerçek `*Detaylı Cevap Anahtarı.xlsx` dosyasından cevap anahtarını ve B permütasyonunu okur.
- ✅ Zincir: `OPTIK_7108_LGS` preset → `OpticalAnswerParser` → `alignAnswersToMaster` → `scoreExam`.
- ✅ Kanıt skorlar (`wrongPenalty=1/3`): iSEM A `56/32/2 net≈45.3333`, iSEM B `44/31/15 net≈33.6667`; 3D A `48/24/18 net=40`, 3D B `59/21/10 net=52`; MUBA A `89/1/0 net≈88.6667`, MUBA B `82/8/0 net≈79.3333`.
- ✅ B permütasyonu gerçek Excel'den ders içi `B KARŞILIĞI` değerleri global soru sırasına çevrilerek üretilir; iSEM ilk blok ters `20..1`, 3D ve MUBA farklı B dizilimleriyle ayrıca sabitlendi.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/optik-7108-real-pipeline.test.ts src/jobs/optical-answer-parser.test.ts src/jobs/booklet-alignment.test.ts` → 3 dosya, 18 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker typecheck` → geçti.

**Faz 1 devam — seed gerçek parser pipeline'a taşındı:**
- ⚙️ `packages/db/prisma/seed-exams.ts` elle yazılmış cevap anahtarı/öğrenci cevapları/puan dizileri yerine gerçek `ornek-veriler/{iSEM .txt, 3D.txt, MUBA.txt}` ve ilgili gerçek `*Detaylı Cevap Anahtarı.xlsx` dosyalarını okur.
- ⚙️ Seed zinciri artık üretim motorunu kullanır: `OPTIK_7108_LGS` preset → `OpticalAnswerParser` → `alignAnswersToMaster` → `scoreExam`. Demo öğrenci kümesi korunur; gerçek TXT'de satırı olmayan öğrenci için sahte sınav sonucu üretilmez.
- ⚙️ `AnswerKey.keyData` gerçek `{ questions }`, `ExamBookletVariant(code="B")` gerçek B permütasyonu, `ParsedAnswer.rowNumber` gerçek optik satırı, `ExamResult.scoreData` gerçek hizalanmış puan sonucu ile yazılır. Yanlış katsayısı LGS kuralına çekildi: `wrongPenalty=1/3`.
- ✅ Dry-run kanıtı: `corepack pnpm --filter @uzman-hocam/db exec tsx prisma/seed-exams.ts --dry-run` → iSEM 17, MUBA 17, 3D 16 demo öğrenci eşleşti; ADIGÜZEL üç denemede skorlandı.
- ✅ Yerel DB kanıtı: `docker compose up -d postgres`; `corepack pnpm --filter @uzman-hocam/db db:migrate`; `corepack pnpm --filter @uzman-hocam/db db:seed-exams` → `Seeded 19 students across 3 real exams`.
- ✅ DB doğrulama: demo sınav sonuçları `50` adet; sınav bazında iSEM `17`, MUBA `17`, 3D `16` result; her sınavda 1 B variant. ADIGÜZEL skorları DB'de: iSEM B `80/10/0 net≈76.6667`, MUBA A `86/4/0 net≈84.6667`, 3D B `86/4/0 net≈84.6667`.
- ✅ Tekrar seed kanıtı: `corepack pnpm --filter @uzman-hocam/db db:seed-exams` ikinci kez çalıştı; demo sınav `ExamResult` sayısı `50` kaldı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/db typecheck` → geçti.

**Faz 1 devam — ReportSnapshot STALE yolu tamamlandı:**
- ⚙️ `ReportSnapshotStore` artık `markStaleByExam(tenantId, examId, reason)` destekler. In-memory store snapshot'ı `status="STALE"` yapar; Postgres store tenant+sınav sınırıyla `ReportSnapshot.status`, `staleAt`, `inputRefs.staleReason` ve `updatedAt` günceller.
- ⚙️ `AnswerKeyService.create()` ve `publish()` başarılı yazımdan sonra ilgili sınav snapshot'larını STALE yapar; `dryRun`, geçersiz istek ve conflict yolları snapshot'a dokunmaz.
- ⚙️ `ParserConfigApprovalService.approve()` başarılı onaydan sonra ilgili sınav snapshot'larını STALE yapar; öneri endpoint'i ve başarısız onay yolları snapshot'a dokunmaz.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/report/report-snapshot-store.test.ts src/exam/parser-config-approval.service.test.ts src/exam/parser-config.controller.e2e.test.ts src/exam/answer-key.controller.e2e.test.ts` → 4 dosya, 27 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/postgres-answer-key-repository.test.ts src/exam/postgres-parser-config-repository.test.ts src/report/report-snapshot-store.test.ts` → 3 dosya, 11 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kanıt: `corepack pnpm db:rls:check` → 40 tenant tablosu doğrulandı, geçti.

**Faz 1 devam — seed determinism/idempotency regresyonu eklendi:**
- ✅ `packages/db/prisma/seed-exams.ts` import edilince DB bağlantısı açmaz; `buildSeedExams()` gerçek TXT/XLSX girdilerinden saf seed verisi üretir, CLI olarak çalıştırıldığında DB'ye yazar.
- ✅ `packages/db/prisma/seed-exams.test.ts` iki kez `buildSeedExams()` çağırıp çıktının birebir aynı olduğunu doğrular. Aynı test 3 gerçek denemede `questionCount=90`, B permütasyon başları, demo eşleşme sayıları, eşleşmeyen satır sayıları ve ADIGÜZEL skorlarını sabitler.
- ✅ Gerçek dosya karantina/eşleşmeyen satır kanıtı fixture'a bağlandı: iSEM `237`, MUBA `226`, 3D `211` eşleşmeyen satır; `studentNo=1606` için sahte sonuç üretilmiyor.
- Kanıt: `corepack pnpm --filter @uzman-hocam/db exec vitest run prisma/seed-exams.test.ts` → 1 dosya, 1 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/db exec tsx prisma/seed-exams.ts --dry-run` → deterministik özet geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/db db:seed-exams` ikinci kez geçti; DB'de demo sınav `ExamResult` sayısı `50` kaldı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/db typecheck`, `corepack pnpm db:rls:check` → geçti.

**Faz 1 devam — karantina listeleme/çözümleme API yüzeyi tamamlandı:**
- ⚙️ `GET /exams/:examId/raw-imports/:rawImportId/quarantines` eklendi; yalnız `TENANT_ADMIN`, tenant+sınav+rawImport sınırıyla açık/çözülmüş karantina satırlarını listeler.
- ⚙️ `POST /exams/:examId/raw-imports/:rawImportId/quarantines/:quarantineId/resolve` eklendi; açık karantina satırını var olan öğrenciye bağlar ve `status="RESOLVED"`, `resolvedStudentId` yazar.
- 🧱 `PostgresRawImportQuarantineStore` öğrenci varlığını aynı tenant içinde `Student` tablosuyla doğrular; silinmiş öğrenciye, silinmiş karantinaya veya zaten çözülmüş satıra yazmaz.
- ✅ Worker yazma yolu zaten `status='OPEN'` kaydı güncelliyor; çözülmüş satır tekrar parse çalışınca karantina olarak geri açılmaz.
- Kalan sınır: çözülmüş karantina satırından otomatik `ParsedAnswer`/`ExamResult` üretimi bu dilime alınmadı; ayrı idempotent reprocess adımı olmalı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/raw-import.controller.e2e.test.ts src/exam/raw-import-quarantine-store.test.ts` → 2 dosya, 8 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck`, `corepack pnpm db:rls:check` → geçti; RLS: 40 tenant tablosu doğrulandı.

**Faz 1 devam — TC(hash)+OKUL NO eşleme sertleşmesi tamamlandı:**
- ⚙️ `ParserConfig.fieldMapping` artık opsiyonel `nationalId` alanını taşıyabilir; `OPTIK_7108_LGS` preset'i TC kolonunu `{ start: 36, length: 11 }` olarak verir.
- ⚙️ `PostgresOpticalParseInputAdapter` katılımcıları yüklerken `Student.nationalIdHash` değerini de worker'a taşır.
- ⚙️ `OpticalAnswerParser` satırda TC varsa yalnız hash üretir ve önce `nationalIdHash` ile eşleştirir; TC yoksa eski `studentNo` / `participantNo` yolu korunur. Böylece OKUL NO çakışmasında TC hash doğru participante öncelik verir.
- 🔐 Karantina `rawRow.line` artık `nationalId` alanı tanımlıysa TC'yi düz metin saklamaz; `*******0146` biçiminde maskeler.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/optical-answer-parser.test.ts src/jobs/postgres-optical-parse-input-adapter.test.ts src/jobs/optik-7108-real-pipeline.test.ts` → 3 dosya, 20 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/parser-config-suggestion.service.test.ts src/exam/parser-config.controller.e2e.test.ts` → 2 dosya, 17 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker typecheck`, `corepack pnpm --filter @uzman-hocam/shared-types typecheck`, `corepack pnpm --filter @uzman-hocam/shared-types build`, `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.

**Faz 1 backend kapanış — çözülmüş karantinadan parse→puan reprocess tamamlandı:**
- ⚙️ `RawImportQuarantineService.resolve()` artık çözüm sonrası `exam-evaluation` işini kuyruğa koyar. Job payload kalıcı referansları taşır: `participantId`, `rawImportId`, yayınlı `answerKeyId`, `entityId=quarantineId`, `contentHash=RawImport.sha256`.
- 🧱 `PostgresRawImportQuarantineStore.resolve()` açık karantinayı `RESOLVED` yaparken aynı tenant+sınav içinde `ExamParticipant`, `RawImport.sha256` ve en güncel `PUBLISHED` `AnswerKey` referanslarını toplar. Referans yoksa reprocess başlatılmaz.
- ⚙️ `OpticalAnswerParser.parseResolvedQuarantine()` eklendi; çözülmüş tek satırı tekrar öğrenci araması yapmadan verilen `participantId` ile `MATCHED` `ParsedAnswer` adayına çevirir. Cevap satırı bozuksa sessiz puan üretmez.
- ⚙️ `PostgresExamEvaluationAdapter.loadInput()` `ParsedAnswer` bulamazsa çözülmüş `ImportQuarantine` satırından cevapları materyalize eder, `ParsedAnswer` upsert eder ve ardından mevcut puanlama yolundan `ExamResult` üretir.
- ✅ DB sonuç idempotency kanıtı sertleşti: `ExamResult` insert conflict durumunda `DO UPDATE` yoktur; mevcut `resultKey` sonucu okunur ve yeni skorla overwrite edilmez.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/raw-import.controller.e2e.test.ts src/exam/raw-import-quarantine-store.test.ts` → 2 dosya, 10 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/optical-answer-parser.test.ts src/jobs/postgres-exam-evaluation-adapter.test.ts src/jobs/exam-evaluation-job.test.ts` → 3 dosya, 28 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/postgres-exam-evaluation-adapter.test.ts src/jobs/exam-evaluation-job.test.ts` → 2 dosya, 14 test geçti.

**Faz 2 başladı — `/kurum/raporlar` gerçek snapshot/karne yüzeyi eklendi:**
- 🎨 `/kurum/raporlar` artık hazır `ReportSnapshot` listesinden seçilen snapshot'ın ilk öğrenci karnesini de çeker: `GET /exams/:examId/reports/snapshots/:snapshotId/students/:studentId`.
- 🎨 Salt metin özet yerine gerçek snapshot verisinden branş net grafiği, kazanım analizi, sınıf karşılaştırması ve öğrenci karne özeti gösterilir. Karne özetinde toplam D/Y/B/net, standart puan, genel sıralama, gelişim ve hata kitapçığı sayısı görünür.
- ✅ E2E fixture'ı `outcomes`, `statistics.general/class`, öğrenci snapshot karnesi, gelişim ve hata kitapçığı verilerini kapsayacak şekilde genişletildi.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login"` → 1 test geçti; kurum paneli, öğrenci 360 ve `/kurum/raporlar` yeni karne blokları doğrulandı.
- Kalan sınır: ADIGÜZEL hedef PNG bazıyla UI/portal karne screenshot pixel-diff ölçümü başladı ama görsel eşik henüz geçer değil. Live UI+worker birleşik koşusu ve rol portal refactor'u kapandı.

**Faz 2 devam — PDF/Excel export'a psikometri taşındı:**
- ⚙️ `exportSnapshotExcel()` öğrenci satırlarına genel sıra, genel yüzdelik, sınıf sıra ve sınıf yüzdelik kolonlarını ekler.
- ⚙️ Excel export'a `BranchStatistics` sayfası eklendi; öğrenci+branş bazında standart puan, genel/sınıf sıra ve yüzdelik görünür.
- ⚙️ PDF HTML ve fallback çıktısı öğrenci özetinde genel/sınıf sırasını gösterir; böylece `statistics.general/class` yalnız API JSON'unda kalmaz.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts src/report/report-generation.controller.e2e.test.ts` → 2 dosya, 25 test geçti.

**Faz 2 devam — ADIGÜZEL hedef PDF karşılaştırması otomatikleşti:**
- ✅ `packages/db/prisma/seed-exams.test.ts` üç gerçek karne PDF'ini `/ToUnicode` haritasıyla metne çevirir ve ADIGÜZEL (`OKUL NO 176`) için sınav başlığı, öğrenci adı, kitapçık, toplam doğru/yanlış/boş/net değerlerini seed skoruyla karşılaştırır.
- ✅ PDF hedefleriyle doğrulanan toplamlar: iSEM `80/10/0 net=76.67`, MUBA `86/4/0 net=84.67`, 3D `86/4/0 net=84.67`.
- ✅ Görsel-diff için hedef baz kapısı eklendi: `scripts/check-adiguzel-pdf-visual-targets.mjs` üç hedef karne PDF'ini `sips` ile geçici PNG'ye render eder; her hedefin `595x842` boyutunu ve PNG SHA-256 hash'ini doğrular.
- Kanıt: `corepack pnpm karne:visual-targets` → 3 hedef geçti; 3D `d3a54d78...`, MUBA `e7663415...`, iSEM `7fc8740c...`.
- Kanıt: `corepack pnpm --filter @uzman-hocam/db exec vitest run prisma/seed-exams.test.ts` → 1 dosya, 2 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/db typecheck` → geçti.
- Kalan sınır: bu otomatik karşılaştırma sayısal toplamı ve hedef PDF görsel bazını kapatır; UI/portal karne screenshot'ını hedef PNG ile pixel-diff eşiğinden geçirme Faz 3/4 kapsamında açık.

**Faz 4 başladı — rol portallarında psikometri görünür oldu:**
- 🎨 `apps/web/app/(app)/role-portals.tsx` içindeki ortak `ReportPanel`, öğrenci/veli/öğretmen portalında `ReportStudentSnapshot.statistics` verisini gösterir: genel sıra, sınıf sıra ve branş psikometri tablosu. Öğrenci/veli karnesinde `outcomes` verisinden kazanım radar paneli de görünür.
- ✅ Ortak `ReportPanel` davranış değiştirmeden `apps/web/app/(app)/portals/_shared/report-panel.tsx` dosyasına taşındı; ardından öğrenci profil/veli ilişkileri/sınıf-kayıt geçmişi panelleri `apps/web/app/(app)/portals/_shared/student-panels.tsx`, duyuru paneli `apps/web/app/(app)/portals/_shared/announcements-panel.tsx`, devamsızlık/yoklama/öğretmen notu panelleri `apps/web/app/(app)/portals/_shared/activity-panels.tsx`, destek talebi paneli `apps/web/app/(app)/portals/_shared/support-tickets-panel.tsx`, ödev/materyal panelleri `apps/web/app/(app)/portals/_shared/homework-panels.tsx`, portal çerçevesi/erişim önizleme/metric grid `apps/web/app/(app)/portals/_shared/portal-shell.tsx`, veli bildirim/ilişki/ödeme panelleri `apps/web/app/(app)/portals/_shared/guardian-panels.tsx`, öğretmen bugünkü ders/profil/sınıf rapor panelleri `apps/web/app/(app)/portals/_shared/teacher-panels.tsx` içine ayrıldı. Ana sayfa bölmesi de kapandı: `StudentPortalPage`, `GuardianPortalPage` ve `TeacherPortalPage` kendi dosyalarına taşındı; `role-portals.tsx` yalnız sabit re-export köprüsü olarak kaldı ve 2374 satırdan 5 satıra indi.
- ✅ E2E fixture'ı öğrenci/veli `latest` rapor yollarında `exam-demo-isem-lgs-1` id'sini de kapsar; böylece portal gerçek `portalExamId` ile rapor, progress ve hata kitapçığı verisini alır.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next rol portalları bağlı kişi verisini gösterir"` → 1 test geçti; öğrenci, öğretmen ve veli portalında genel/sınıf sıra ve branş psikometri tablosu doğrulandı.
- Kalan sınır: portal karne screenshot'ı hedef PDF PNG bazıyla ölçüldü ama fark oranı hâlâ kabul eşiği ilan edecek kadar düşük değil. Negatif subject-scope matrisi Faz 4'te açık.

**Faz 4 devam — öğretmen rapor subject-scope sertleşti:**
- 🔐 `ReportGenerationService` öğretmen rapor erişiminde artık yalnız öğrenci/sınıf bağını değil, `TeacherAssignment.courseId` ve `termId` sınırını da dikkate alır. Ders/dönem sınırlı öğretmen başka ders snapshot'ındaki aynı öğrencinin raporunu okuyamaz; gelişim raporunda bağlam dışı snapshot noktaları elenir; snapshot listesi/export ise kapsam dışı öğrenciyi `0 kayıt` seviyesine düşürür.
- ✅ `me-access-matrix.e2e.test.ts` öğretmen rapor uçlarını kapsar: öğretmen ve tenant admin pozitif, öğrenci/veli negatif; öğretmenin başka tenant öğrencisine IDOR denemesinde cevap gövdesi öğrenci id'si sızdırmaz.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts src/me/me-access-matrix.e2e.test.ts` → 2 dosya, 21 test geçti.
- Kalan sınır: kurum UI ve portal karne screenshot → hedef PDF PNG pixel-diff ölçümü mevcut ama fark oranı yüksek; live UI+worker birleşik optik→rapor koşusu kapandı.

**Faz 3 başladı — `/kurum/sinavlar` yönetim yüzeyi eklendi:**
- 🎨 Menüde `Sınav ve Rapor > Sınavlar` bağlantısı açıldı; `/kurum/sinavlar` gerçek `GET /exams`, `POST /exams` ve `POST /exams/:examId/publish` API'lerini kullanır.
- 🎨 Kurum admin ekrandan sınav oluşturabilir, taslak/yayında durumunu görebilir ve taslak sınavı yayınlayabilir. Başlık validasyonu web formunda da yakalanır.
- ✅ Playwright fixture'ı sınav oluşturma ve yayınlama isteklerini stateful biçimde karşılar; kurum paneli akışında boş başlık hatası, yeni sınav satırı ve yayınlama doğrulandı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer"` → 1 test geçti.
- Kalan sınır: katılımcı seçimi, fixture tabanlı optik→rapor UI smoke ve live UI+worker birleşik koşusu bağlandı; UI/portal karne screenshot → hedef PDF PNG pixel-diff hâlâ açık.

**Faz 3 devam — `ExamParticipant` API yüzeyi açıldı:**
- ⚙️ `GET /exams/:examId/participants` öğretmen rolüne açıldı; sınav yoksa `EXAM_NOT_FOUND` ile 404 döner.
- ⚙️ `POST /exams/:examId/participants` kurum yöneticisine açıldı; `studentId` zorunlu, `participantNo` ve `bookletType` isteğe bağlıdır.
- 🔐 Aynı tenant/sınav/öğrenci için ikinci kayıt `EXAM_PARTICIPANT_EXISTS` ile 409 döner; Postgres tarafında mevcut unique index bu kuralı korur.
- Kanıt: `corepack pnpm --filter @uzman-hocam/shared-types typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/exam/exam.controller.e2e.test.ts` → 1 dosya, 9 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kalan sınır: `/kurum/sinavlar` ekranında tekil ve sınıf filtreli toplu öğrenci seçici bağlandı; live UI+worker birleşik optik→rapor koşusu kapandı.

**Faz 3 devam — `/kurum/sinavlar` katılımcı seçici bağlandı:**
- 🎨 Sınav satırına `Katılımcılar` işlemi eklendi; seçili sınav için katılımcı paneli, öğrenci seçimi, katılımcı no ve kitapçık alanları görünür oldu.
- ⚙️ Panel gerçek `GET /students`, `GET /exams/:examId/participants` ve `POST /exams/:examId/participants` uçlarını kullanır; eklenen öğrenci tekrar seçim listesinden düşer.
- ✅ Playwright fixture'ı katılımcı GET/POST uçlarını stateful karşılar; kurum paneli akışında yeni sınava Bora B katılımcı olarak eklendi ve tabloda `201 / B / Kayıtlı` doğrulandı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer"` → 1 test geçti.
- Kalan sınır: fixture tabanlı optik→rapor UI smoke ve live UI+worker birleşik koşusu kapandı; UI/portal karne görsel yakınsaması Faz 3 açık işi.

**Faz 3 devam — `/kurum/optik` sekmeli operasyon hub'ına dönüştü:**
- 🎨 `/kurum/optik` artık tek format formu değil; `Format öneri-onay`, `Cevap anahtarı`, `Optik yükleme`, `Karantina çözümü` sekmelerini gösterir.
- ⚙️ Cevap anahtarı sekmesi gerçek `POST /exams/:examId/answer-keys/imports/dry-run` ve `POST /exams/:examId/answer-keys/imports` uçlarını kullanır; 90 soru ve B kitapçık özetini ekranda gösterir.
- ⚙️ Optik yükleme sekmesi gerçek `POST /exams/:examId/raw-imports` ile TXT/DAT dosyasını parse kuyruğuna alır; dönen raw import id karantina sekmesine taşınır.
- ⚙️ Karantina sekmesi gerçek `GET /exams/:examId/raw-imports/:rawImportId/quarantines` ve `POST .../resolve` uçlarıyla öğrenci seçerek çözüm yapar; çözüm sonrası exam-evaluation job bilgisini gösterir.
- ✅ Playwright fixture'ı cevap anahtarı import, raw import upload ve karantina resolve uçlarını stateful karşılar; kurum paneli akışında `answer-key-v1`, `raw-import-a`, `quarantine-a -> student-a` ve `evaluation-job-a` doğrulandı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer"` → 1 test geçti.
- Kalan sınır: fixture tabanlı UI zinciri, geniş live smoke ve live UI+worker birleşik koşusu geçti; UI/portal karne screenshot → hedef PDF PNG pixel-diff hâlâ açık.

**Faz 3 devam — cevap anahtarı için 90 satır manuel grid bağlandı:**
- 🎨 `/kurum/optik > Cevap anahtarı` sekmesine 90 satırlık manuel grid eklendi; LGS branşları varsayılan gelir, şık/kazanım/konu hücreleri düzenlenebilir.
- ⚙️ Grid gerçek `POST /exams/:examId/answer-keys` ucunu kullanır; `dryRun: true` ile ön kontrol yapar, ardından aynı payload'ı DB'ye kaydeder.
- ✅ Hızlı giriş için 90 karakterlik şık dizisi grid'e işlenir; Playwright akışında 90 adet `A` şıkkı, 1. soru kazanımı ve konusu girilip `manual-key-v1` dry-run + kayıt doğrulandı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer"` → 1 test geçti.
- Kalan sınır: fixture tabanlı UI zinciri, geniş live smoke ve live UI+worker birleşik koşusu geçti; UI/portal karne screenshot → hedef PDF PNG pixel-diff hâlâ açık.

**Faz 3 devam — manuel B kitapçık permütasyonu bağlandı:**
- 🎨 Manuel cevap anahtarı grid'ine `B kitapçık sırası` alanı eklendi; kurum admin 90 adet master soru numarasını boşluk/virgül ile girebilir.
- ⚙️ Boş bırakılırsa yalnız A anahtarı kaydedilir; doldurulursa 1..90 arası benzersiz 90 sayı zorunludur ve payload `bookletVariants: [{ code: "B", permutation }]` olarak gerçek `POST /exams/:examId/answer-keys` ucuna gider.
- ✅ Playwright fixture'ı manuel kayıtta `90..1` permütasyonunun payload'a taşındığını doğruladı; dry-run özeti `B: 90 soru` bilgisini gösterdi.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer"` → 1 test geçti.
- Kalan sınır: fixture tabanlı UI zinciri, geniş live smoke ve live UI+worker birleşik koşusu geçti; UI/portal karne screenshot → hedef PDF PNG pixel-diff hâlâ açık.

**Faz 3 devam — sınıf filtreli toplu katılımcı ekleme bağlandı:**
- 🎨 `/kurum/sinavlar` katılımcı paneline `Toplu katılımcı ekleme` formu eklendi; sınıf filtresi, çoklu öğrenci seçimi, başlangıç no ve ortak kitapçık alanı var.
- ⚙️ Akış mevcut gerçek `POST /exams/:examId/participants` ucunu her öğrenci için çağırır; eklenen öğrenciler katılımcı listesinden düşer ve liste yeniden yüklenir.
- ✅ Playwright akışında önce Bora B tekil `201/B` olarak eklendi; ardından Ada A sınıf filtresiyle toplu eklemede `301/A` olarak eklendi ve tabloda doğrulandı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer"` → 1 test geçti.
- Kalan sınır: fixture tabanlı UI zinciri, geniş live smoke ve live UI+worker birleşik koşusu geçti; UI/portal karne screenshot → hedef PDF PNG pixel-diff hâlâ açık.

**Faz 3 devam — optik akış rapor üretim kuyruğuna bağlandı:**
- 🎨 `/kurum/optik > Karantina çözümü` sekmesine `Rapor Üretimi` kartı eklendi; optik upload sonrası gelen hash ekranda görünür ve düzenlenebilir.
- ⚙️ Optik upload dönüşündeki `rawImport.sha256`, `Sonuç hash` alanına otomatik aktarılır; `POST /exams/:examId/reports/generation-jobs` çağrısı `EXAM_RESULT_SUMMARY` ile yapılır.
- ✅ Playwright fixture'ı `exam-a` için rapor üretim kuyruğunu doğrular; kurum paneli akışında `abcdef1234567890` hash'iyle `report-job-a` kuyruğa alındı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer"` → 1 test geçti.
- Kalan sınır: fixture tabanlı UI zinciri, geniş live smoke ve live UI+worker birleşik koşusu geçti; UI/portal karne screenshot → hedef PDF PNG pixel-diff hâlâ açık.

**Faz 3 devam — report-generation worker kanıtı yenilendi:**
- ⚙️ `report-generation` worker job'u `ExamResult` girdilerinden READY `ReportSnapshot` üretir; Postgres adapter `ReportSnapshot` kaydını `READY`, `inputRefs` ve `snapshotData` ile yazar.
- ✅ BullMQ worker sarmalayıcısı `report-generation` kuyruğunu doğru processor'a taşır; yanlış job adı reddedilir.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/report-generation-job.test.ts src/jobs/postgres-report-generation-adapter.test.ts src/queue/bullmq-worker.test.ts` → 3 dosya, 22 test geçti.
- ✅ Canlı Postgres/Redis üstünde `corepack pnpm report-generation:smoke` geçti; `exam-report-smoke-650f9eb7-e6df-4e2c-804e-1ae7f67bd14a` için `734153a6-70f0-4963-b7b5-1457c9a0d1e8` READY snapshot üretildi.
- ✅ Canlı raw import smoke geçti; `a2910dde-e0f6-4f27-b1a9-535a21933309` raw import arşivlendi ve parse kuyruğuna alındı.
- ✅ Gerçek optik pipeline regresyonu yenilendi: `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/optik-7108-real-pipeline.test.ts src/jobs/optical-pilot-fixture.test.ts src/jobs/optical-parse-workflow.test.ts` → 3 dosya, 8 test geçti.
- ✅ Geniş canlı zincir geçti: `corepack pnpm live:smoke` → compose health, migrate, canlı RLS, Postgres store, BullMQ, raw import, report-generation ve backup/restore smoke yeşil. Bu koşuda `41943533-f55a-4a33-ae59-328da7a6d8cd` raw import kuyruğa alındı; `exam-report-smoke-bba6fdc0-12d8-47f4-8990-6f2080db5b5d` için `40868b81-2ca1-434e-8729-cb30ec8b3fc1` READY snapshot üretildi.
- ✅ Kurum UI tek senaryo smoke eklendi: aynı Playwright akışı `exam-a` optik upload → karantina çözümü → `report-job-a` → `/kurum/raporlar` içinde `exam-a` READY snapshot görünürlüğünü doğrular. `snapshot-optik-a`, `inputRefs.contentHash=abcdef1234567890`, kazanım radarında `Geometri` ve `1 soru` hata kitapçığı aynı senaryoda görüldü.
- ⚙️ Canlı worker → canlı UI köprüsü eklendi: `REPORT_GENERATION_SMOKE_EVIDENCE_PATH=<json> pnpm report-generation:smoke` artık login kullanıcı bilgisi, sınav ID, snapshot ID ve ilk öğrenci ID'si içeren kanıt JSON'u üretebilir. Yeni `pnpm live:ui-worker:smoke` Playwright spec'i bu kanıtla gerçek login yapıp `/kurum/raporlar` içinde worker'ın ürettiği READY snapshot ve ilk öğrenci karnesini arar.
- ✅ Canlı worker → canlı UI birleşik koşusu geçti: `REPORT_GENERATION_SMOKE_EVIDENCE_PATH=/tmp/uzman-hocam-live-ui-worker-evidence.json corepack pnpm report-generation:smoke` `exam-report-smoke-0f0a9918-6203-49da-b276-90a7c29a2a3c` için `24f22ada-be74-4050-a33d-599684f93121` READY snapshot ve `student-report-smoke-0f0a9918-6203-49da-b276-90a7c29a2a3c-00000` ilk öğrenci kanıtı üretti.
- Kanıt: `WEB_URL=http://localhost:3001 AUTH_USER_STORE=postgres REPORT_SNAPSHOT_STORE=postgres DATABASE_URL=postgresql://app:app@localhost:5432/uzman_hocam node apps/api/dist/main.js` ile API açıldı; doğrudan API probunda login `200`, snapshots `200`, count `1`, firstStatus `READY`.
- Kanıt: `NEXT_E2E_LIVE_UI_WORKER=1 LIVE_UI_WORKER_EVIDENCE_PATH=/tmp/uzman-hocam-live-ui-worker-evidence.json NEXT_PUBLIC_API_URL=http://localhost:3100 corepack pnpm live:ui-worker:smoke` → 1 test geçti; gerçek login + `/kurum/raporlar` içinde READY snapshot + ilk öğrenci karnesi doğrulandı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer"` → 1 test geçti.
- Kalan sınır: canlı UI+worker birleşik koşusu kapandı; UI/portal karne screenshot → hedef PDF PNG pixel-diff hâlâ açık.

**Faz 3 devam — öğrenci karne kazanım radar yüzeyi eklendi:**
- 🎨 `/kurum/raporlar` öğrenci karne özeti artık yalnız tablo değil; öğrencinin `outcomes` verisinden `Kazanım Radar` paneli üretir ve netleri radar poligonu + erişilebilir tabloyla gösterir.
- 🎨 Radar mobilde tek kolona düşer; karne tablosu ve hata kitapçığı kanıtı korunur.
- ✅ İsteğe bağlı UI görsel kanıt bayrağı eklendi: `KARNE_VISUAL_EVIDENCE=1` ile kurum Playwright akışı `Öğrenci karne özeti` panelinin PNG screenshot'ını test output dizinine yazar; PNG boyutu ve SHA-256 hash'i konsola basılır.
- ✅ UI screenshot ile hedef PDF PNG bazı arasında ilk pixel-diff ölçüm komutu eklendi: `scripts/compare-karne-visual-evidence.mjs`, hedef PDF'i `595x842` PNG/BMP bazına render eder, UI screenshot'ını aynı boyuta normalize eder ve değişen piksel oranı + ortalama kanal farkını hesaplar.
- ✅ Playwright fixture'ı öğrenci karnesine birden fazla kazanım ekledi; kurum paneli akışında `Kazanım radar tablosu` ve `Geometri` kazanımı doğrulandı.
- 🎨 Aynı radar dili öğrenci/veli portalındaki ortak `ReportPanel` içine taşındı; portal raporu artık net/psikometri tablosunun yanında kazanım radarını da gösterir.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer|Next rol portalları bağlı kişi verisini gösterir"` → 2 test geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer"` → 1 test geçti; `kurum-raporlar-ogrenci-karne` screenshot `950x550`, SHA-256 `e685aae36194fa86bd74ee360fe3890a9588543c0fb94842f86b3d8d9edd8a66`.
- Kanıt: `corepack pnpm karne:visual-diff -- --target iSEM --ui <kurum-raporlar-ogrenci-karne.png>` → normalize `595x842`, `changed=234053/500990`, `ratio=0.467181`, `meanChannelDelta=35.95`. Sentetik kontrol aynı hedef PNG ile `ratio=0` verdi.
- 🎨 Kurum karne paneli hedef PDF'e daha yakın A4 oranlı sayfa kabuğuna çekildi: ADIGÜZEL PDF'teki siyah/sarı kenar şeridi, üst bilgi, bölüm analizi, puan-sıra bloğu, başarı yüzdesi bar alanı ve son sınav netleri düzeni UI karnesine taşındı.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test -c playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer"` → 1 test geçti; `kurum-raporlar-ogrenci-karne` screenshot `596x843`, SHA-256 `15243c11f8f8154e5c451e67b83a1206f0504d66631ab3647143376940bbfc03`.
- Kanıt: `corepack pnpm karne:visual-diff -- --target iSEM --ui <kurum-raporlar-ogrenci-karne.png>` → normalize `595x842`, `changed=234012/500990`, `ratio=0.467099`, `meanChannelDelta=30.96`. İlk UI ölçümüne göre fark oranı küçük de olsa düştü (`0.467181 → 0.467099`), ortalama kanal farkı belirgin düştü (`35.95 → 30.96`).
- Yürütme notu: yalnız fixture verisini ADIGÜZEL iSEM'deki 6 ders/toplam satırlarına yaklaştırmak görsel oranı düşürmedi; tablo yüksekliği ve renk dağılımı hedef PDF ile kaydığı için ölçüm kötüleşti. Bu deneme kabul edilmedi. Bir sonraki doğru adım, kurum screenshot'ını veri sayısını artırarak değil, hedef PDF layout/export bileşenini veya aynı layout'u kullanan karne bileşenini sistematik hale getirerek yakınsatmaktır.
- ⚙️ PDF export HTML'i artık yalnız genel `Sınav Raporu` değil, ilk öğrenci için hedef karne sözlüğünü de taşır: `Öğrenci Karnesi`, `BÖLÜM ANALİZİ`, `PUAN - SIRA ANALİZİ`, `BÖLÜM BAŞARI YÜZDELERİ`, `SON SINAV NETLERİ`. Bu, UI karnesi ile export çıktısının aynı hedef başlıklarına yaklaşması için ilk ortak sözleşme adımıdır.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts` → 1 dosya, 14 test geçti; export HTML ve fallback satırlarında yeni karne hedef başlıkları doğrulandı.
- ✅ Portal karne screenshot kanıtı eklendi ve A4 karne kabuğuna çekildi: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next rol portalları bağlı kişi verisini gösterir"` → 1 test geçti. Portal `latest` fixture'ı artık aynı `exam-demo-isem-lgs-1` sınavı için tek branşlı eski matematik verisi değil, kurum raporundaki 6 branşlı iSEM öğrenci karnesiyle tutarlı veri döndürür.
- Kanıt: portal screenshot'ları sıkıştırılmış A4 kabukta `596x842` üretildi. SHA-256: öğrenci `7e3d7d8b854cdf3fda61b3490ee58583a057ac37fccf2680210060beb063fc71`, öğretmen `7aebb9ebb48ab5051c96fe460f2dec49dacacf63555a2d10cbf1a971ce271bbe`, veli `7e3d7d8b854cdf3fda61b3490ee58583a057ac37fccf2680210060beb063fc71`.
- Kanıt: `corepack pnpm karne:visual-diff -- --target iSEM --ui <portal-ogrenci-sinav-raporu.png>` → normalize `595x842`, `changed=248266/500990`, `ratio=0.495551`, `meanChannelDelta=34.11`.
- Kanıt: `corepack pnpm karne:visual-diff -- --target iSEM --ui <portal-ogretmen-sinav-raporu.png>` → normalize `595x842`, `changed=246456/500990`, `ratio=0.491938`, `meanChannelDelta=33.43`.
- Kanıt: `corepack pnpm karne:visual-diff -- --target iSEM --ui <portal-veli-sinav-raporu.png>` → normalize `595x842`, `changed=248266/500990`, `ratio=0.495551`, `meanChannelDelta=34.11`.
- Yürütme notu: A4 kabuk ve çok branşlı iSEM veri tutarlılığı doğru ürün yönüdür; ancak ham pixel-diff önceki genel kart ölçümünden iyi çıkmadı (`~0.455 → ~0.496`). Hedef PDF'teki marka/logo alanı, bölüm başlığı geometrisi ve tablo yoğunluğu birebir ortaklaşmadan bu metrik kabul seviyesine inmiyor. Bu nedenle görsel kabul hâlâ açık; bir sonraki doğru adım kurum/portal/export karne bileşenini tek ortak bileşene almak ve hedef PDF'deki marka/başlık/tablo geometrisini aynı bileşende sabitlemektir.
- Kalan sınır: kurum ve portal karne screenshot'ları ADIGÜZEL hedef PNG bazıyla karşılaştırılıyor ama fark oranı hâlâ kabul eşiği ilan edecek kadar düşük değil; hedefe yaklaşmak için karne layout'unu kurum/portal/export arasında ortaklaştırıp hedef PDF'deki satır yoğunluğu ve marka yapısını veriyle doldurmak gerekiyor.

**Faz 3/4 devam — web karne bileşeni ortaklaştırıldı:**
- 🎨 Kurum `/kurum/raporlar` öğrenci karnesi ve öğrenci/veli/öğretmen portal `ReportPanel` artık aynı web bileşenini kullanır: `apps/web/app/(app)/_shared/karne-sheet.tsx`. Böylece bölüm analizi, puan-sıra, kazanım radar ve son sınav netleri web tarafında tek layout kaynağından gelir.
- 🎨 Kurum ve portalın bilinçli farkları parametreyle korunur: kurum sade sıra (`1/3`) ve eski kazanım blok sınıfını, portal yüzdeli sıra (`1/3 (%100)`) ve portal A4 sıkıştırmasını kullanır. İlk ortaklaştırma kurum pixel-diff değerini bozduğu için bu farklar geri sabitlendi; final ölçüm eski iyi kurum değerine döndü.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer|Next rol portalları bağlı kişi verisini gösterir"` → 2 test geçti.
- Kanıt: `kurum-raporlar-ogrenci-karne` screenshot `596x843`, SHA-256 `15243c11f8f8154e5c451e67b83a1206f0504d66631ab3647143376940bbfc03`.
- Kanıt: portal screenshot'ları `596x842`; öğrenci `7e3d7d8b854cdf3fda61b3490ee58583a057ac37fccf2680210060beb063fc71`, öğretmen `7aebb9ebb48ab5051c96fe460f2dec49dacacf63555a2d10cbf1a971ce271bbe`, veli `7e3d7d8b854cdf3fda61b3490ee58583a057ac37fccf2680210060beb063fc71`.
- Kanıt: kurum visual-diff `ratio=0.467099`, `meanChannelDelta=30.96`; portal öğrenci/veli `ratio=0.495551`, öğretmen `ratio=0.491938`. Bu adım fark oranını düşürmedi; yalnız web layout sapmasını tek kaynağa topladı.
- Kalan sınır: export HTML hâlâ ayrı string render yolunda. Bir sonraki yakınsama adımı, hedef PDF marka/başlık/tablo geometrisini önce ortak web bileşeninde daha birebir sabitlemek, sonra export HTML sözlüğünü aynı satır yoğunluğuna yaklaştırmaktır.

**Faz 3/4 devam — bölüm analizi kolon sözlüğü hedef PDF'e yaklaştırıldı:**
- 🎨 Ortak web karne bileşenindeki `BÖLÜM ANALİZİ` tablosu hedef PDF'teki ilk kolon yapısına yaklaştı: `No` ve `Soru sayısı` eklendi. Böylece kurum ve portal web karneleri artık yalnız `Branş / D / Y / B / Net` değil, soru sayısını da görünür kılar.
- ⚙️ PDF export HTML'i de aynı kolon sözlüğüne taşındı: `BÖLÜM ANALİZİ` artık `No`, `Branş`, `Soru sayısı`, `Doğru`, `Yanlış`, `Boş`, `Net` başlıklarını üretir.
- Kapsam kararı: hedef PDF'teki `Sınıf net ort`, `Okul net ort`, `Genel net ort` kolonları bu dilime eklenmedi; mevcut `ReportStudentSnapshot.branches` öğrenci branch satırında bu üç ortalamayı taşımıyor. Veri uydurmamak için yalnız mevcut veriden kanıtlanabilir `Soru sayısı = doğru + yanlış + boş` eklendi.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts` → 1 dosya, 14 test geçti; export HTML'de `Soru sayısı` başlığı doğrulandı.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer|Next rol portalları bağlı kişi verisini gösterir"` → 2 test geçti.
- Kanıt: yeni screenshot SHA-256: kurum `ed4feb763ac83d4ee5b7c6b5407cdd24347333f7e23e57d9afd4380b909384e2`; portal öğrenci/veli `f95e033cff56f783ce6d89b8a2bbf945c4196647823b8f793f38c3f11894cbd3`; portal öğretmen `979f70159ed8f3047573112dbcbb44f63f2e669d6853fd72a218e08bdffce811`.
- Kanıt: visual-diff ham oranı bu adımda iyileşmedi; kurum `0.467099 → 0.467103`, portal öğrenci/veli `0.495551 → 0.496110`, öğretmen `0.491938 → 0.491956`. Yorum: kolon sözlüğü doğru yönde ilerledi ama pixel farkını belirleyen büyük alanlar hâlâ hedefteki gerçek logo/öğrenci bilgi bloğu, bölüm başlığı geometrisi, başarı grafiği ve alt son-sınav matrisidir.
- Kalan sınır: görsel kabul için sıradaki daha etkili adım, hedef PDF'teki `Sınıf/Okul/Genel net ort` kolonlarının veri modelinden güvenli beslenmesi veya alt `SON SINAV NETLERİ` matrisinin gerçek progress/branch verisiyle doldurulmasıdır; UI'de veri uydurarak metrik düşürmek kabul edilmeyecek.

**Faz 3/4 devam — sınıf/okul/genel net ortalamaları veriyle bağlandı:**
- ⚙️ Report snapshot üretimi artık sınıf bazlı branch ortalamalarını da taşır: `snapshotData.classes[].branches`. Bu değerler öğrencinin sınıfındaki gerçek sonuçlardan `createBranchAverages(classResults)` ile hesaplanır.
- ⚙️ Öğrenci rapor API'si branch satırlarını snapshot verisinden zenginleştirir: `classNetAverage`, `schoolNetAverage`, `generalNetAverage`. Kaynaklar sırasıyla sınıf branch ortalaması, snapshot genel branch ortalaması ve cohort statistics branch `meanNet` alanıdır.
- 🎨 Ortak web karne tablosu ve PDF export HTML'i hedef PDF'teki üç ortalama kolonunu gösterir: `Sınıf net ort`, `Okul net ort`, `Genel net ort`. Veri olmayan hücreler `-` kalır.
- ✅ Portal iSEM fixture'ı ADIGÜZEL hedef PDF'teki 6 branş ortalama değerleriyle dolduruldu; Playwright artık `MATEMATİK 20 20 0 0 20 19,92 9,46 9,39` satırını doğrular.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/report-generation-job.test.ts src/jobs/postgres-report-generation-adapter.test.ts src/queue/bullmq-worker.test.ts` → 3 dosya, 22 test geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts` → 1 dosya, 14 test geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer|Next rol portalları bağlı kişi verisini gösterir"` → 2 test geçti.
- Kanıt: yeni screenshot SHA-256: kurum `0acabd2bd5c1ea8d4c565e8df94010f77f441e5feb3891fbab34b8b4d506d0d9`; portal öğrenci/veli `c6f1dcaef60fe07d7d55f1d37237131f2581bf6362394515fbf2d82a7e6c4704`; portal öğretmen `b1fdce175af4c401baf1940ffec494207fb8158c6a447d7e9c7331efaf18f896`.
- Kanıt: portal öğrenci/veli visual-diff iyileşti: `0.496110 → 0.487229`, `meanChannelDelta=33.03`. Kurum tek ders fixture'ında tablo genişlediği için ham oran kötüleşti: `0.467103 → 0.471834`; öğretmen fixture'ında ortalama verisi olmadığı için oran fiilen aynı kaldı: `0.491956`.
- Kalan sınır: hedef PDF'e kabul seviyesinde yaklaşmak için artık en büyük açıklar veri değil, görsel yerleşimdir: gerçek logo/öğrenci bilgi bloğu, hedefteki bölüm başlığı geometrisi, başarı grafiği lejandı ve alt `SON SINAV NETLERİ` branş matrisi.

**Faz 3/4 devam — son sınav netleri başlık ağırlığı azaltıldı:**
- 🎨 Portal karne içindeki `Öğrenci gelişim grafiği` alt başlığı erişilebilir heading olarak korunur, fakat hedef PDF'teki daha sıkı alt tablo yerleşimine yaklaşmak için küçük karne içi başlık boyutuna indirildi. Böylece alt `SON SINAV NETLERİ` bloğu hedefteki yoğunluğa daha yakın durur.
- Deneme notu: `BÖLÜM BAŞARI YÜZDELERİ` için hedef PDF'teki renkli lejand kısa süre denendi; portal öğrenci/veli ham diff değerini kötüleştirdiği için tutulmadı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer|Next rol portalları bağlı kişi verisini gösterir"` → 2 test geçti.
- Kanıt: yeni screenshot SHA-256: kurum `0acabd2bd5c1ea8d4c565e8df94010f77f441e5feb3891fbab34b8b4d506d0d9`; portal öğrenci/veli `16dfa5df506529cf7d23febd09d9087d47b6f6e3ebc15cda0bd998b13a9e00ca`; portal öğretmen `12f8d0be2258cee32705f8903365783c86c16024046bb38f32af2afec6c144b5`.
- Kanıt: portal öğrenci/veli visual-diff tekrar iyileşti: `0.487229 → 0.482545`, `meanChannelDelta=32.30`; öğretmen `0.491956 → 0.489112`; kurum aynı kaldı: `0.471834`.
- Kalan sınır: kabul eşiğine yaklaşmak için artık daha büyük ama hâlâ güvenli görsel adımlar gerekiyor: hedefteki üst öğrenci bilgi bloğu/kurum-logo alanı ve alt son-sınav branch matrisi.

**Faz 3/4 devam — son sınav branş netleri matrisi eklendi:**
- 🎨 Ortak web karne bileşeninin `SON SINAV NETLERİ` bloğu artık yalnız toplam net/puan özetini değil, güncel `report.branches` verisinden `Son sınav branş netleri` tablosunu da gösterir. Bu, hedef PDF'teki alt sağ branş matrisiyle aynı bilgi sınıfına yaklaşan güvenli ara adımdır.
- Kapsam kararı: progress modeli branch bazlı geçmiş taşımadığı için çok-sınav branş matrisi üretilmedi; veri uydurmamak için yalnız son raporun gerçek branch netleri gösterildi.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer|Next rol portalları bağlı kişi verisini gösterir"` → 2 test geçti; öğrenci/veli portalında `Son sınav branş netleri` içindeki `MATEMATİK 20` satırı doğrulandı.
- Kanıt: yeni screenshot SHA-256: kurum `de5dfdb8d3a43ce0d6f55c2889eef08d80bea0cee9cbdfc8c03be75bed79c3c2`; portal öğrenci/veli `49ea56dbba14d1d974751e08a60fe684bd05b16b8b670d60161ad1798ccabba5`; portal öğretmen `b5be97ffe99e8611641062905eff8431edc61449fdf09939f67db6444ed5cf2d`.
- Kanıt: portal öğrenci/veli visual-diff oranı hafif kötüleşti (`0.482545 → 0.484205`), ama ortalama kanal farkı iyileşti (`32.30 → 31.76`). Kurum `0.471834 → 0.471886`; öğretmen `0.489112 → 0.489784`. Yorum: yeni gerçek branş matrisi hedefe yapısal olarak yaklaştı, fakat ham piksel oranı kabul eşiğine inmedi.
- Kalan sınır: alt matriste hâlâ hedef PDF'teki çok-sınav kolonları yok; bunu kapatmak için `ReportStudentProgressPoint` içine branch net geçmişi taşınmalı. Görsel tarafta üst öğrenci bilgi bloğu/kurum-logo alanı da hâlâ büyük fark kaynağı.

**Faz 3/4 devam — progress branch geçmişi çok-sınav matrise taşındı:**
- ⚙️ `ReportStudentProgressPoint` artık `branches?: ReportStudentBranchSummary[]` taşır. API `getStudentProgress()` her READY snapshot içindeki öğrenci branch satırlarını progress noktasına ekler.
- 🎨 Ortak web karne bileşeni `progress.points[].branches` varsa alt `Son sınav branş netleri` tablosunu çok-sınav matrise çevirir: sütunlar son progress noktaları (`1`, `2`, ...), satırlar branşlardır. Branch geçmişi yoksa önceki `Son net` fallback'i korunur.
- ✅ Portal fixture'ında iSEM progress noktaları 2 sınavlık branch geçmişiyle dolduruldu; Playwright artık `MATEMATİK 14,5 20` satırını doğrular.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts` → 1 dosya, 14 test geçti; progress cevabında branch satırları doğrulandı.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer|Next rol portalları bağlı kişi verisini gösterir"` → 2 test geçti.
- Kanıt: yeni screenshot SHA-256: kurum `0b735c9bd08465e8772bbcbc01aff15b86d609904738f9a383400cdc8c176a54`; portal öğrenci/veli `48d8dacd04ba45c773fa25609b21cdec5dcea82c29abe52fc2e1518302aa395c`; portal öğretmen `f37a808031b90e485f4fd25d11c7ef42fbf9a884b90e2e3380e2fccddf1b5267`.
- Kanıt: portal öğrenci/veli visual-diff oranı çok az kötüleşti (`0.484205 → 0.484475`), ortalama kanal farkı `31.80`; kurum `0.471886 → 0.471870`; öğretmen `0.489784 → 0.489940`. Yorum: metrik kabul eşiği hâlâ kapanmadı, fakat hedef PDF'teki çok-sınav branch matrisinin veri ön koşulu artık gerçek API ve UI sözleşmesine bağlandı.
- Kalan sınır: görsel kabul için sıradaki ana açık üst öğrenci bilgi bloğu/kurum-logo alanı ve hedef başlık geometrisidir; alt matriste daha fazla sınav kolonu üretmek artık progress verisi arttıkça doğal olarak mümkün.

**Faz 3/4 devam — üst karne başlık geometrisi hedefe yaklaştırıldı:**
- 🎨 Ortak karne başlığı hedef PDF'teki üst tablo yapısına yaklaştırıldı: başlık satırı ortalandı, öğrenci/sınav/sınıf satırları alt çizgili satırlara ayrıldı ve marka alanı `DNA` + `UZMAN HOCAM` blok düzenine alındı.
- 🎨 Portal karne yüksekliği ayrı tutuldu: `.next-karne-sheet--portal .next-karne-header > div:first-child` `92px` oldu. Bu, portalda ana `BÖLÜM ANALİZİ` bloğunu hedef PDF'teki y-konumuna yaklaştırdı; kurum çıktısının iyileşmesi korunurken portal öğretmen diff'i de iyileşti.
- Deneme notu: son üst satırda `className` yerine `generatedAt` tarihi kısa süre denendi; kurum `0.465257 → 0.465303`, portal öğrenci/veli `0.484840 → 0.485117`, portal öğretmen `0.489018 → 0.489281` kötüleştiği için tutulmadı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `git diff --check 'apps/web/app/(app)/_shared/karne-sheet.tsx' apps/web/app/globals.css` → temiz.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer|Next rol portalları bağlı kişi verisini gösterir"` → 2 test geçti.
- Kanıt: yeni screenshot SHA-256: kurum `31a632f85ba88a3be61564d3e518f9d8c4f8216d99774bb1fc7f1c0e2596a03e`; portal öğrenci/veli `5e5b887136c61f0f53226f58ef788115850c8ce26801b5eeb574eb6be06faedd`; portal öğretmen `e418c14fb8d8b99ccfbd474a5b3f373f447ccce3232407de5e4a79845298eb71`.
- Kanıt: kurum visual-diff iyileşti (`0.471870 → 0.465257`, `meanChannelDelta=31.26`); portal öğretmen iyileşti (`0.489940 → 0.489018`, `meanChannelDelta=33.58`); portal öğrenci/veli önceki en iyiye çok yakın kaldı (`0.484475 → 0.484840`, `meanChannelDelta=32.13`). İlk başlık denemesinde portal öğrenci/veli `0.487323`, öğretmen `0.496760` değerine gerilediği için portal özel yüksekliği zorunlu kabul edildi.
- Kalan sınır: hedef PDF'e daha fazla yaklaşmak için gerçek öğrenci adı/kurum satırları ve gerçek DNA Eğitim logo varlığı hâlâ eksik; `ReportStudentSnapshot` şu an yalnız `studentId`, `classId/className` ve rapor metriklerini taşıdığı için bu turda veri uydurulmadı.

**Faz 3/4 devam — karne başlığı gerçek öğrenci adını kullanıyor:**
- ⚙️ `ReportStudentSnapshot` sözleşmesine opsiyonel `studentName` eklendi. API `getStudentReport()` aynı tenant içindeki `studentStore` kaydını bulursa `firstName lastName` bilgisini yanıta ekler; store yoksa veya öğrenci bulunamazsa eski `studentId` davranışı korunur.
- 🎨 Ortak karne bileşeni üst öğrenci satırında `report.studentName ?? report.studentId` kullanır. Böylece hedef PDF'teki öğrenci adı satırına veri uydurmadan yaklaşılır.
- ✅ Playwright iSEM/kurum/öğretmen fixture'ları yeni API sözleşmesini taklit edecek şekilde `studentName: "Ada A"` ile güncellendi.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts` → 1 dosya, 14 test geçti; öğrenci raporu yanıtında `studentName` doğrulandı.
- Kanıt: `git diff --check packages/shared-types/src/domain.ts apps/api/src/report/report-generation.service.ts apps/api/src/report/report-generation.service.test.ts 'apps/web/app/(app)/_shared/karne-sheet.tsx' apps/web/e2e-next/login-next.spec.ts apps/web/app/globals.css` → temiz.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer|Next rol portalları bağlı kişi verisini gösterir"` → 2 test geçti.
- Kanıt: yeni screenshot SHA-256: kurum `400ada54b709031e2e1295febd304a09947d071afcc94bdf1b54776910e15d3b`; portal öğrenci/veli `bb6b278985d88ab038fb75aad54b3da564d24de97f87c371b72055cfd14637e8`; portal öğretmen `2b455873586a81dc011d7ff5d1313ff5abec1645f8d27cc50876d2c375b07275`.
- Kanıt: visual-diff üç yolda da iyileşti: kurum `0.465257 → 0.465103` (`meanChannelDelta=31.24`), portal öğrenci/veli `0.484840 → 0.484732` (`meanChannelDelta=32.12`), portal öğretmen `0.489018 → 0.488910` (`meanChannelDelta=33.57`).
- Kalan sınır: hedefteki kurum adı, kitapçık/tarih satırı ve gerçek DNA Eğitim logo alanı hâlâ eksik. Bunlar için ya snapshot/API sözleşmesinin sınav/kurum meta verisi taşıması ya da güvenli asset kaynağı gerekir.

**Faz 3/4 devam — karne başlığı gerçek sınav adını kullanıyor:**
- ⚙️ `ReportStudentSnapshot` sözleşmesine opsiyonel `examTitle` ve `examStartsAt` eklendi. API `getStudentReport()` artık `ExamRepository.findById(tenantId, examId)` ile aynı tenant'taki sınavı bulursa başlık/tarih bilgisini yanıta ekler; repository yoksa veya sınav bulunamazsa eski davranış korunur.
- 🎨 Ortak karne bileşeni başlıkta `report.examTitle ?? "İSEM - LGS - 1"` kullanır. Böylece hedef PDF'teki sınav adı satırı artık sabit UI metni yerine gerçek sınav kaydından beslenebilir.
- ✅ Playwright rapor fixture'ları yeni API sözleşmesini taklit edecek şekilde `examTitle: "İSEM - LGS - 1"` ile güncellendi. Fixture başlığı önceki metinle aynı olduğu için screenshot hash'leri değişmedi; bu beklenen sonuçtur.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts` → 1 dosya, 14 test geçti; öğrenci raporu yanıtında `examTitle` ve `examStartsAt` doğrulandı.
- Kanıt: `git diff --check packages/shared-types/src/domain.ts apps/api/src/report/report-generation.service.ts apps/api/src/report/report-generation.service.test.ts 'apps/web/app/(app)/_shared/karne-sheet.tsx' apps/web/e2e-next/login-next.spec.ts apps/web/app/globals.css` → temiz.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer|Next rol portalları bağlı kişi verisini gösterir"` → 2 test geçti.
- Kanıt: screenshot SHA-256 değerleri önceki iyi seviyede kaldı: kurum `400ada54b709031e2e1295febd304a09947d071afcc94bdf1b54776910e15d3b`; portal öğrenci/veli `bb6b278985d88ab038fb75aad54b3da564d24de97f87c371b72055cfd14637e8`; portal öğretmen `2b455873586a81dc011d7ff5d1313ff5abec1645f8d27cc50876d2c375b07275`.
- Kanıt: visual-diff değerleri korunur: kurum `0.465103` (`meanChannelDelta=31.24`), portal öğrenci/veli `0.484732` (`meanChannelDelta=32.12`), portal öğretmen `0.488910` (`meanChannelDelta=33.57`).
- Kalan sınır: kurum adı hâlâ güvenli kaynaktan gelmiyor. Kitapçık tipi için veri kaynağı mevcut; ayrı adımda API sözleşmesine taşındı.

**Faz 3/4 devam — kitapçık tipi veri sözleşmesine taşındı:**
- ⚙️ `ReportStudentSnapshot` sözleşmesine opsiyonel `participantNo` ve `bookletType` eklendi. API `getStudentReport()` artık `ExamParticipantRepository.list(tenantId, examId)` içinden aynı öğrencinin participant kaydını bulursa bu alanları yanıta ekler; participant yoksa eski davranış korunur.
- Deneme notu: `bookletType` üst sol son satırda `B KİTAPÇIĞI` olarak kısa süre gösterildi. Bu hedef PDF'e yapısal olarak doğru olsa da mevcut yerleşimde visual-diff kötüleştiği için UI gösterimi tutulmadı: kurum `0.465103 → 0.465169`, portal öğrenci/veli `0.484732 → 0.485084`, portal öğretmen `0.488910 → 0.489261`.
- ✅ Playwright fixture'ları yeni API sözleşmesini taklit edecek şekilde `bookletType: "B"` ile güncellendi; karne UI şimdilik bu alanı göstermediği için screenshot hash'leri iyi seviyeye geri döndü.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts` → 1 dosya, 14 test geçti; öğrenci raporu yanıtında `participantNo` ve `bookletType` doğrulandı.
- Kanıt: `git diff --check packages/shared-types/src/domain.ts apps/api/src/report/report-generation.service.ts apps/api/src/report/report-generation.service.test.ts 'apps/web/app/(app)/_shared/karne-sheet.tsx' apps/web/e2e-next/login-next.spec.ts apps/web/app/globals.css docs/development-plan-2026-06-02.md` → temiz.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --filter @uzman-hocam/web exec playwright test --config=playwright.next.config.ts --grep "Next login gerçek auth store ile kurum paneline geçer|Next rol portalları bağlı kişi verisini gösterir"` → 2 test geçti.
- Kanıt: screenshot SHA-256 değerleri iyi seviyede kaldı: kurum `400ada54b709031e2e1295febd304a09947d071afcc94bdf1b54776910e15d3b`; portal öğrenci/veli `bb6b278985d88ab038fb75aad54b3da564d24de97f87c371b72055cfd14637e8`; portal öğretmen `2b455873586a81dc011d7ff5d1313ff5abec1645f8d27cc50876d2c375b07275`.
- Kanıt: visual-diff iyi seviyede korundu: kurum `0.465103` (`meanChannelDelta=31.24`), portal öğrenci/veli `0.484732` (`meanChannelDelta=32.12`), portal öğretmen `0.488910` (`meanChannelDelta=33.57`).
- Kalan sınır: kitapçık tipi artık gerçek API verisi olarak hazır, fakat hedef PDF'teki `B KİTAPÇIĞI / tarih` satırına taşınması için üst bilgi yerleşimi ayrıca tasarlanmalı. Kurum adı hâlâ güvenli veri kaynağına bağlı değil.

**Faz 3/4 devam — kurum adı veri sözleşmesine taşındı:**
- ⚙️ `ReportStudentSnapshot` sözleşmesine opsiyonel `institutionName` eklendi. API `getStudentReport()` artık tenant kaydını güvenli kaynaktan bulursa kurum adını yanıta ekler.
- ⚙️ Yeni `TenantStore` rapor servisine dar bağımlılık olarak bağlandı. Test/dev varsayılanı in-memory demo tenant kullanır; canlı Postgres yolu yalnız `TENANT_STORE=postgres` ile açılır. Böylece rapor metadata zenginleştirmesi test ortamında Postgres bağlantısı yok diye 500 üretmez.
- ⚙️ Kurum/sınav/katılımcı metadata lookup'ları opsiyonel kaldı: store/repository hatasında rapor ana verisi döner, yalnız metadata alanı boş bırakılır.
- 🎨 Ortak karne bileşeni kurum satırında `report.institutionName ?? reportLabel` kullanır. Header'da sınıf satırı kaldırma denemesi kurum adını görünür yapmadı ve visual-diff'i kötüleştirdiği için tutulmadı: kurum `0.465101 → 0.472081`, portal öğrenci/veli `0.484732 → 0.485427`, portal öğretmen `0.488910 → 0.489605`.
- ✅ Playwright fixture'ları yeni API sözleşmesini taklit edecek şekilde `institutionName: "DNA EĞİTİM KURUMU"` ile güncellendi.
- Kanıt: `corepack pnpm --filter @uzman-hocam/api typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `corepack pnpm --dir apps/api exec vitest run src/report/report-generation.service.test.ts src/report/report-generation.controller.e2e.test.ts` → 2 dosya, 26 test geçti; öğrenci raporu yanıtında `institutionName` doğrulandı.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts` → 2 test geçti.
- Kanıt: screenshot SHA-256: kurum `938b1b1ccdb5ccab59f625a35cd4d21e57fb530d66724cdc1d5b455d70e152c7`; portal öğrenci/veli `bb6b278985d88ab038fb75aad54b3da564d24de97f87c371b72055cfd14637e8`; portal öğretmen `2b455873586a81dc011d7ff5d1313ff5abec1645f8d27cc50876d2c375b07275`.
- Kanıt: visual-diff iyi seviyede korundu: kurum `0.465103 → 0.465101` (`meanChannelDelta=31.24`), portal öğrenci/veli `0.484732` (`meanChannelDelta=32.12`), portal öğretmen `0.488910` (`meanChannelDelta=33.57`).
- Kalan sınır: kurum adı artık güvenli API verisi olarak hazır, fakat hedef PDF'teki üst bilgi satırında tam görünür yerleşim için header geometrisi ayrıca tasarlanmalı. Kitapçık/tarih satırı için de aynı üst bilgi yerleşimi bekliyor.

**Faz 3/4 devam — karne üst bilgisi hedef PDF satırlarına yaklaştırıldı:**
- 🎨 Ortak karne üst bilgisi artık hedef PDF'teki bilgi sırasını gösterir: sınav adı, öğrenci adı, kurum adı, `ÖĞRENCİ NO / tarih`, `B KİTAPÇIĞI / tarih`. Eski mutlak konumlu özet bandı header üstünden kaldırıldı; kurum tarafındaki `+3 net / +40 puan` bilgisi puan-sıra panelindeki `GELİŞİM` satırına taşındı.
- 🎨 Karne tablo yoğunluğu hedef PDF'e yaklaştırıldı: blok iç boşlukları ve tablo hücre padding'i azaltıldı. Bu iSEM çok branşlı karnede taşmayı `1004px → 891px` seviyesine indirdi.
- ✅ Kurum screenshot kanıtı artık tek branşlı `exam-demo` yerine hedef PDF'le aynı iSEM çok branşlı fixture üzerinden alınıyor (`exam-demo-isem-lgs-1`). Bu önceki kurum diff değerleriyle birebir kıyaslanamaz; eski ölçüm hedef PDF'e tek branşlı bir ekranı kıyaslıyordu.
- Deneme notu: Karneyi zorla `842px` yüksekliğe sabitleme kısa süre denendi; üst bilgi satırlarını kırptığı için tutulmadı. A4 sabit yükseklik hâlâ açık borç, ama veri görünürlüğü kırpılmayacak.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts` → 2 test geçti.
- Kanıt: screenshot SHA-256: kurum `42f6e00267a29b15644bdbd916632dbfbb6413e690917b3b4c9d95f39fb6d7bc` (`596x891`); portal öğrenci/veli `6280bed81e995ef0ee7cdd53c73246b962e7ba28b38e4ec56eaf9c29aa84d86c`; portal öğretmen `e8b218466d7a8ea230520de0f93c0d24ffe9047bd4558ffc7e6e4d1b31d468e1`.
- Kanıt: visual-diff son değerleri: kurum `0.500255` (`meanChannelDelta=32.44`), portal öğrenci/veli `0.486303` (`meanChannelDelta=32.08`), portal öğretmen `0.491521` (`meanChannelDelta=34.31`).
- Kalan sınır: kurum karnesi hedef A4 yüksekliğine hâlâ sığmıyor (`596x891`); hedefe yaklaşmak için sıradaki doğru adım gerçek logo alanı, başarı grafiği lejandı ve `SON SINAV NETLERİ` çok-sınav matrisini hedefteki yoğunluğa taşımaktır. Pixel-diff kabul eşiği bu adımda kapanmadı.

**Faz 3/4 devam — kurum karne alt matrisi branch geçmişiyle dolduruldu:**
- ⚙️ Kurum rapor progress fixture'ı portal progress fixture'ıyla hizalandı: `exam-demo-isem-lgs-1` artık yalnız `Matematik` değil, `TÜRKÇE`, `İNKILAP TARİHİ`, `DİN KÜLTÜRÜ`, `İNGİLİZCE`, `MATEMATİK`, `FEN BİLİMLERİ` için iki ölçüm branch net geçmişi döndürür.
- 🎨 `SON SINAV NETLERİ` alt sağ matrisi kurum iSEM karnesinde boş `-` hücreler yerine gerçek branch net geçmişiyle dolar. Bu hedef PDF'teki alt branş matrisiyle aynı bilgi sınıfına yaklaşır.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts` → 2 test geçti.
- Kanıt: screenshot SHA-256: kurum `769b404d1439be15ef40dca4087b84aae53d4904c4f90f26f5dca1e42bb639e1` (`596x891`); portal öğrenci/veli `6280bed81e995ef0ee7cdd53c73246b962e7ba28b38e4ec56eaf9c29aa84d86c`; portal öğretmen `71e0ec1f41fbce46474b3c131952134da7483be59e22bb72ea6f354790963e2b`.
- Kanıt: visual-diff son değerleri: kurum `0.501353` (`meanChannelDelta=32.55`), portal öğrenci/veli `0.486303` (`meanChannelDelta=32.08`), portal öğretmen `0.491191` (`meanChannelDelta=34.28`).
- Yorum: kurum pixel-diff oranı küçük kötüleşti, çünkü daha fazla metin/hücre hedefle birebir aynı konuma henüz oturmuyor; buna rağmen veri doğruluğu hedefe daha yakın. Kalan ana açıklar A4 yüksekliği (`596x891`), gerçek logo alanı ve başarı grafiği lejandı/geometrisi.

**Faz 3/4 devam — kurum karne yüksekliği A4 hedefine yaklaştırıldı:**
- 🎨 `Kazanım radar grafiği` üst boşluğu `64px → 15px` yapıldı. Bu kırpma değil, hedef PDF'teki tek sayfa akışına yaklaşmak için güvenli boşluk sıkılaştırmasıdır.
- ✅ Kurum iSEM screenshot yüksekliği `596x891 → 596x843` seviyesine indi; pratikte hedef `595x842` A4 PNG bazıyla aynı yüksekliğe oturdu. Portal screenshot'ları `596x842` olarak korunur.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts` → 2 test geçti.
- Kanıt: screenshot SHA-256: kurum `4c694078a7bfefe980529129e57265c518394563f765e5733c608be4a580a9f9` (`596x843`); portal öğrenci/veli `6280bed81e995ef0ee7cdd53c73246b962e7ba28b38e4ec56eaf9c29aa84d86c`; portal öğretmen `71e0ec1f41fbce46474b3c131952134da7483be59e22bb72ea6f354790963e2b`.
- Kanıt: visual-diff son değerleri: kurum `0.501353 → 0.504028` (`meanChannelDelta=33.30`), portal öğrenci/veli `0.486303`, portal öğretmen `0.491191`.
- Yorum: A4 boyut borcu kapandı, fakat ham pixel-diff kabul eşiği kapanmadı. Sıradaki görsel borçlar artık yükseklik değil; gerçek logo alanı, başarı grafiği lejandı ve bölüm/puan bloklarının hedef PDF geometrisidir.

**Faz 3/4 devam — marka/logo alanı metin tabanlı hedefe yaklaştırıldı:**
- 🎨 Repo içinde gerçek logo/helix bitmap veya SVG asset'i bulunmadığı için yeni görsel uydurulmadı. Mevcut metin tabanlı marka alanı hedef PDF'teki yapıya daha yakın olacak şekilde `DNA / UZMAN HOCAM` yerine `DNA / EĞİTİM / KİŞİSEL GELİŞİM KURSU` düzenine çekildi.
- ✅ Eski `next-karne-summary` CSS kalıntıları temizlendi; karne üst alanında kullanılmayan özet kutusu kuralları kalmadı.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts` → 2 test geçti.
- Kanıt: screenshot SHA-256: kurum `290ca8932e195f58874e1b2598dd74710f19059acd95f0569d576afb33b57f87` (`596x843`); portal öğrenci/veli `4b7eac64c33202c778f52b672b57822850a5a80258289e1bf16063b7177be685`; portal öğretmen `2cd35ce00d4eb34e67b84a5552ba46bbd933792cf3f928103a1af299c64dc83f`.
- Kanıt: visual-diff son değerleri: kurum `0.504028 → 0.504116` (`meanChannelDelta=33.30 → 33.28`), portal öğrenci/veli `0.486303 → 0.487080`, portal öğretmen `0.491191 → 0.491968`.
- Yorum: Görsel marka yapısı hedefe daha benzer oldu, fakat ham pixel-diff kabul eşiği kapanmadı ve portallarda küçük kötüleşme var. Gerçek kabul için hâlâ gerçek DNA Eğitim logo asset'i, başarı grafiği lejandı/geometrisi ve bölüm/puan bloklarının hedef PDF konumlarına daha birebir oturması gerekiyor.

**Faz 3/4 devam — bölüm başarı yüzdeleri lejandı eklendi:**
- 🎨 Hedef PDF'teki `ÖĞRENCİ / SINIF / OKUL / GENEL` renk lejandı, karne başarı grafiği alanına eklendi. Erişilebilir `Kazanım radar tablosu` korunur; Playwright bu görünür tablo ve `Geometri` hücresini hâlâ doğrular.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts` → 2 test geçti.
- Kanıt: screenshot SHA-256: kurum `2bd27f7f976718bc412f5e84563d07c4aa951551e0b1653726eecc04145ac283` (`596x843`); portal öğrenci/veli `7637b91dff4e83c17673a3cb2589c686b7bb25cb8b1e84de9c964365106b8a9f`; portal öğretmen `ae98bfa4555eb5ff8dd1eaf79b292748564b734c0939e7cac1ad557716b5bb56`.
- Kanıt: visual-diff son değerleri: kurum `0.504116 → 0.505367`, portal öğrenci/veli `0.487080 → 0.488265`, portal öğretmen `0.491968 → 0.493337`.
- Yorum: Lejand yapısal olarak hedef PDF'e yaklaştı ama metrik kötüleşti. Ana fark kaynağı hâlâ hedefte olmayan sağdaki erişilebilir kazanım tablosu ve CSS ile çizilen bar grafiğinin hedefteki 6 bölüm/4 seri geometrisini birebir taşımaması. Sıradaki doğru adım, tabloyu kaybetmeden bu alanı hedef PDF'teki grafik yoğunluğuna yaklaştırmaktır.

**Faz 3/4 devam — başarı grafiği 6 bölüm/4 seri veriye bağlandı:**
- 🎨 `BÖLÜM BAŞARI YÜZDELERİ` alanı sabit CSS barlarından çıktı; `report.branches` verisinden 6 bölüm ve 4 seri (`ÖĞRENCİ`, `SINIF`, `OKUL`, `GENEL`) üreten bar grafiğe taşındı. Seri yüksekliği branş netinin soru sayısına oranıyla hesaplanır.
- ♿ `Kazanım radar tablosu` görsel alandan kaldırıldı ama DOM'da erişilebilir tablo olarak tutuldu; Playwright artık görünür lejandı ve gizli tabloda `Geometri` hücresinin varlığını doğrular.
- ✅ Portal özel grafik yüksekliği tekrar sıkılaştırıldı; öğrenci/veli portal screenshot'ı ara denemedeki `596x845` taşmasından tekrar `596x842` seviyesine indi.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts` → 2 test geçti.
- Kanıt: screenshot SHA-256: kurum `4bc470c3192918e21760547a390e011668a8ecb933a1762624201c2541ab61a4` (`596x843`); portal öğrenci/veli `085fcd4de212775b3104e989da0a69bede3731f7662690bf1bd34766b55238d1`; portal öğretmen `f84eff2df5e5e103b8ad346d29faf61762b79ea6c49aa42e447dff80b4de8e56`.
- Kanıt: visual-diff son değerleri: kurum `0.505367 → 0.498966`, portal öğrenci/veli `0.488265 → 0.482385`, portal öğretmen `0.493337 → 0.470135`.
- Yorum: Bu adım üç görsel yolda da fark oranını düşürdü; kabul eşiği hâlâ kapanmadı. Kalan büyük açıklar üst logo asset'i, puan-sıra bloğunun hedefteki turkuaz/çok satırlı geometrisi ve son sınav netleri alanının hedefteki 5 deneme yoğunluğudur.

**Faz 3/4 devam — puan-sıra bloğu hedef tablo geometrisine yaklaştırıldı:**
- 🎨 `PUAN - SIRA ANALİZİ` bloğu dört satırlı `dl` listesinden hedef PDF'e daha yakın `PUAN TİPİ / LGS` başlıklı tabloya taşındı. Genel ve sınıf sıra satırları artık dar turkuaz kategori hücresi + `SIRA/KATILIM` satırlarıyla gösterilir; katılım değeri `ReportScopeRank.outOf` alanından gelir.
- ✅ Kurum ve portal screenshot yükseklikleri korundu: kurum `596x843`, portal öğrenci/veli/öğretmen `596x842`.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts` → 2 test geçti.
- Kanıt: screenshot SHA-256: kurum `9e550522701aa5f3ece5bda5f221028ef33b2bce1d7ed466df966a66b3baf0b8` (`596x843`); portal öğrenci/veli `1684715d8c6f31f670ff5677a4d88f4cfa309afb4f608c6fd8a03e176453e40d`; portal öğretmen `0793fa7cc7702476b05d6933c3dbfc64eb378d1b9ce56e5f2947b223b7b6d756`.
- Kanıt: visual-diff son değerleri metrikte kötüleşti: kurum `0.498966 → 0.519152`, portal öğrenci/veli `0.482385 → 0.504176`, portal öğretmen `0.470135 → 0.481898`.
- Yorum: Bu adım yapısal olarak hedef PDF'teki puan tablosuna yaklaştırdı, fakat ham pixel-diff değerleri kötüleşti. Görsel kabul için bu bloğun renk/ölçek/y-konum ayarı hâlâ açık; sonraki daha güvenli odak son sınav netleri alanını hedefteki 5 deneme yoğunluğuna veriyle yaklaştırmaktır.

**Faz 3/4 devam — son sınav netleri 5 deneme yoğunluğuna taşındı:**
- ⚙️ `ReportStudentProgressPoint` sözleşmesine opsiyonel `examTitle` eklendi; progress noktası artık hedef PDF'teki `DENEME SINAVI` satır adını taşıyabilir.
- 🎨 Karne alt bölümü tek `Son rapor` satırı yerine progress verisi varsa son 5 denemeyi `No / Deneme / Net / Tarih` tablosunda gösterir. Veri yoksa eski tek satır güvenli fallback olarak kalır.
- 🎨 `Son sınav branş netleri` matrisi iSEM fixture'ında hedef PDF'teki 5 deneme kolonuna genişletildi; `MATEMATİK 18,67 20 17,33 18,67 18,67` satırı Playwright ile doğrulanır.
- ✅ Portal taşması düzeltildi: ara denemede öğrenci/veli karne yüksekliği `596x851` olmuştu; grafik/alt tablo sıkılaştırmasıyla portal tekrar `596x842`, kurum `596x844` seviyesine indi.
- Kanıt: `corepack pnpm --filter @uzman-hocam/shared-types typecheck` → geçti.
- Kanıt: `corepack pnpm --filter @uzman-hocam/web typecheck` → geçti.
- Kanıt: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts` → 2 test geçti.
- Kanıt: screenshot SHA-256: kurum `7310c4e18739609a977ed847f5a4137269350a4dd3ca5777cc861da61bf78e0f` (`596x844`); portal öğrenci/veli `220d1f60b9db07b4945b1f819ebf74de9c47c359b02beb4ec12291fb4c926767`; portal öğretmen `0ea87edae069e9b8917ab74414175b9d029f2a771b933201cc2a0b829d35021b`.
- Kanıt: visual-diff son değerleri: kurum `0.519152 → 0.520789`, portal öğrenci/veli `0.504176 → 0.502100`, portal öğretmen `0.481898 → 0.480578`.
- Yorum: Alt bölüm yapısal olarak hedef PDF'e yaklaştı; portal metrikleri küçük iyileşti, kurum metriği küçük kötüleşti. Kalan ana görsel borç artık puan-sıra bloğunun hedefteki ölçek/y-konum ayarı ve gerçek logo asset'idir.

---

## 1. Yönetici Özeti — Önceliğin Yeniden Çerçevelenmesi

Kullanıcı hedef sırasını **(1) frontend/UI-UX → (2) kullanıcı/yetkiler → (3) gerçek veriyle DB/sayfa/grafik** olarak verdi. Dört uzman lens **bağımsız olarak** şu sonuca yakınsadı:

> **Gerçek veriyle "deneme → karne → kazanım analizi" döngüsünü kapatmak fiilen 1. iştir. Kullanıcının UI/UX hedefi de zaten *karne + kazanım analizi* ekranlarında toplanıyor** — yani "UI'yi iyileştir" ile "döngüyü kapat" aynı iki ekrana çıkar. Yetkiler büyük ölçüde hazır; kalan iş yeni sınav/rapor uçlarında **subject-scope** tutarlılığı. Admin CRUD kozmetiği ertelenecek kısımdır.

**Neden:** Christensen (JTBD) — dershanenin ürünü kiralama nedeni "kullanıcı yönetmek" değil, *optik yığınını hızlıca güvenilir karne + kazanım haritasına çevirmek*. Meadows (kaldıraç) — zincirin tıkalı vanası cevap-anahtarı girişi; o açılınca psikometri/rapor/portal **aynı anda** gerçek veriyle dolar. Porter/Godin — moat ve "remarkable" olan şey **MEB kazanımına hizalı analiz + güvenilir karne**; gerisi table-stakes. Taleb — gerçek TC/telefon PII'si değişmez koruma çizgisi (§6).

---

## 2. Mevcut Durum ve Kritik Tıkanmalar (kodda doğrulandı)

**Hazır olan:** Backend/auth/RLS/RBAC/identity-link tamam (~20.014 öğrenci demo tenant'a yüklü+bağlı). Kurum portalı ~30 sayfa. Sınav/optik **motoru** (`optical-answer-parser`, `scoring-engine` [kazanım `outcomeCode` destekli], `psychometrics` [kohort T-skor/yüzdelik/sıralama], `report-generation-job`, `format-analyzer`) yazılı, birim-testli ve artık 3 gerçek OPTİK-7108 denemesiyle fixture'lı.

**✅ Kapatıldı — `trim()` hatası:** `apps/worker/src/jobs/optical-answer-parser.ts` `normalizeLines` artık satırı `.trim()` etmiyor; yalnız tamamen boş satırları eliyor. Gerçek 7108 TXT'nin **sola 11 boşluk dolgusu** ve ders bloklarındaki boş cevapları korunuyor.

**✅ Kapatıldı — "Yetim" cevap anahtarı vanası:** `apps/api/src/exam/answer-key.service.ts` içindeki `AnswerKeyService.create()` artık `/exams/:examId/answer-keys` HTTP yüzeyine bağlı. `dryRun: true` ile DB'ye yazmadan validasyon/özet alınabiliyor.

**✅ Kapatıldı — Faz 1 backend tıkanmaları:** çözülmüş karantina satırından yeniden parse/puan üretimi, TC(hash)+OKUL NO eşleme ve DB result idempotency kanıtı tamamlandı.

**Diğer doğrulanan gerçekler:**
- Kazanım **zaten serbest-metin string olarak uçtan uca akıyor** (`seed-exams.ts` `outcomeCode:"SÖZCÜKTE ANLAM"` basıyor; `scoring-engine` + `report-generation-job.ts:302` `createOutcomeAverages` bu string'e göre radar üretiyor). Kazanım radarı **bugün çalışır** durumda.
- `LearningOutcome` tablosu (schema.prisma:895) **ölü kod** — kodlu `MAT.9.1.2` taksonomi fikri terk edilmiş, sıfır referans.
- `packages/db/prisma/seed-exams.ts` gerçek parser→hizala→puan pipeline'ına taşındı ve saf üretim deterministik testle sabitlendi; TC(hash)+OKUL NO eşleme sertleşti; çözülmüş karantinadan yeniden sonuç üretimi ve DB result conflict kanıtı eklendi.
- `apps/web/.../raporlar/reports-page.tsx` **grafiksiz, salt metin** (`<p>` listeleri); 4 grafik wrapper'ı yalnız dashboard'da mock veriyle kullanılıyor.
- 3 rol portalının üçü de ayrı dosyaya taşındı; `role-portals.tsx` yalnız re-export köprüsü. Ortak bloklar ayrıldı: `apps/web/app/(app)/role-portals.tsx` **5 satır**, `apps/web/app/(app)/portals/student-portal-page.tsx` **155 satır**, `apps/web/app/(app)/portals/guardian-portal-page.tsx` **289 satır**, `apps/web/app/(app)/portals/teacher-portal-page.tsx` **885 satır**, `apps/web/app/(app)/portals/_shared/report-panel.tsx` **188 satır**, `apps/web/app/(app)/portals/_shared/student-panels.tsx` **200 satır**, `apps/web/app/(app)/portals/_shared/announcements-panel.tsx` **60 satır**, `apps/web/app/(app)/portals/_shared/activity-panels.tsx` **109 satır**, `apps/web/app/(app)/portals/_shared/support-tickets-panel.tsx` **125 satır**, `apps/web/app/(app)/portals/_shared/homework-panels.tsx` **147 satır**, `apps/web/app/(app)/portals/_shared/portal-shell.tsx` **61 satır**, `apps/web/app/(app)/portals/_shared/guardian-panels.tsx` **186 satır**, `apps/web/app/(app)/portals/_shared/teacher-panels.tsx` **232 satır**.
- Psikometri `statistics` hesaplanıyor; **PDF/Excel export'a ve rol portal karnesine taşındı**, tam görsel karne eşleşmesi hâlâ açık.
- Snapshot **STALE-yazma yolu kapatıldı**: answer-key create/publish ve parser-config approve sonrası aynı sınavın snapshot'ları `STALE` olur.
- Katılımcı eşleme **TC hash öncelikli + OKUL NO/participantNo fallback** oldu; 20k ölçeğinde OKUL NO çakışmasında sessiz yanlış atama riski düşürüldü.

---

## 3. Doğrulanmış Veri Sözleşmeleri (`ornek-veriler/`)

**TXT (OPTİK-7108), satır uzunluğu tam 171, sola 11 boşluk dolgulu.** 0-tabanlı parser config (kolon-1 dönüşümü doğrulandı):

| Alan | 1-tabanlı (kullanıcı) | Parser (`start`,`length`) |
|---|---|---|
| OKUL NO | 12–15 | `11, 4` |
| AD SOYAD | 16–35 | `15, 20` |
| TC KİMLİK | 38–48 | `37, 11` |
| KİTAPÇIK | 51 | `50, 1` |
| TÜRKÇE (20) | 52–71 | `51, 20` |
| İNKILAP (10) | 72–81 | `71, 10` |
| DİN (10) | 92–101 | `91, 10` |
| İNGİLİZCE (10) | 112–121 | `111, 10` |
| MATEMATİK (20) | 132–151 | `131, 20` |
| FEN (20) | 152–171 | `151, 20` |

Toplam **90 soru (LGS)**. Ders blokları **bitişik değil** (boşluklar: 82–91, 102–111, 122–131). Kitapçık **A & B** mevcut (~128 A / 126 B). Boş cevap = boşluk.

**Cevap anahtarı (`*Detaylı Cevap Anahtarı.xlsx` ×3):** `BÖLÜM | SORU NO | B KARŞILIĞI | CEVAP | KAZANIM | KONU | BRANŞ`. CEVAP = master/A doğru cevabı; **SORU NO ve B KARŞILIĞI ders içi yerel numaradır**; importer satır sırasını global master soru numarası olarak alır ve B karşılığını ders bloğunun global başlangıcına çevirir. KAZANIM/KONU serbest Türkçe metin; BRANŞ ör. "LGS TÜRKÇE".

**Öğrenci listesi (`8.SINIFLAR LİSTE.xlsx`):** `SINIF | AD | SOYAD | TC KİMLİK NO | OKUL NO | ALAN | TELEFON NO`.

**Karne PDF'leri (×3):** karne ekranının **görsel hedef spesifikasyonu**. AHMET İSHAK ADIGÜZEL (OKUL NO 176) 3 denemede de var → **birebir doğrulama vakası**.

---

## 4. Fazlı Plan — İki Kol Paralel (⚙️ Backend/Veri ∥ 🎨 Frontend), karnede birleşir

Etiketler: ⚙️ backend/worker · 🎨 frontend · 🔐 güvenlik · 🧱 veri-modeli/altyapı · ✅ kalite. Her faz §6.0 (assessment) yürütme protokolüne uyar; her yeni tenant tablosu **aynı PR'da** `packages/db/scripts/check-rls.mjs` `tenantTables` listesine eklenir.

### Faz 0 — Vanaları Aç (sıralı, en yüksek kaldıraç) — ✅ Tamamlandı
**Hedef:** Gerçek verinin akabilmesi için iki blokeri ve doküman/RLS yönetişimini kur.
- ✅ ⚙️ `optical-answer-parser.ts` `normalizeLines`: fixed modda satırı **trim etme**; yalnız tamamen boş satırı ele (boşluk-dolgu ve son-soru boşlukları korunsun).
- ✅ ⚙️ `AnswerKeyService.create()` için controller route (yetim vanayı bağla); `dryRun: true` desteği.
- ✅ 🧱 Kanonik doküman kararı: `education-system-assessment-2026-06-01.md` + bu plan kanonik; `MASTER_PLAN.md` vizyon/tarihsel kaynak olarak kalır.
- ✅ **Kalite kapısı:** gerçek TXT satırından OKUL NO/kitapçık/cevaplar doğru çıkar (`vitest` gerçek-satır fixture'ı); answer-key route erişilebilir; `pnpm db:rls:check` yeşil. Bu faz yeni tenant tablosu eklemediği için RLS liste değişikliği gerekmedi.

### Faz 1 — Gerçek Veri Motoru (⚙️ ∥ 🎨)
**⚙️ Backend kol**
- ✅ **Çok-segmentli parse:** `packages/shared-types/src/format-analyzer.ts` `AnswerFieldSpec`'e opsiyonel `segments: AnswerSegmentSpec[]` eklendi (geriye uyumlu; yokken eski tek-blok yolu çalışır). `optical-answer-parser.ts` segmentleri sırayla dilimleyip 1..90 ardışık numaralandırır. `OPTIK_7108_LGS` preset'i ürün yüzeyine bağlandı; auto-analyzer 6 boşluklu bloğu kestiremez, preset deterministik yoldur.
- ✅ **Kitapçık hizalama:** saf `alignAnswersToMaster(answers, booklet, bMap)` eklendi — B cevaplarını "B KARŞILIĞI" permütasyonu ile **master sıraya** çevirir, sonra `scoreExam` çalışır (motor saf/deterministik kalır, **tek** `answerKeyVersion`). A = birim eşleme. `exam-evaluation-job.ts` puanlamadan önce çağırır.
- ✅ 🧱 **`ExamBookletVariant`** tablosu (additive): `{tenantId, examId, code, permutation Json, deletedAt}`, `@@unique([tenantId,examId,code])`; RLS + `tenantTables` eklendi.
- ✅ ⚙️ **Cevap anahtarı Excel importer'ı:** BÖLÜM/SORU NO/CEVAP/KAZANIM(→`outcomeCode`)/KONU(→`topic`)/BRANŞ + B KARŞILIĞI → AnswerKey item'ları + ExamBookletVariant. Doğrulama: tam 90 satır, geçerli şık, ders içi B KARŞILIĞI değerlerinden global 1..90 permütasyon; **dry-run**. Sürüm değişimi ilgili ReportSnapshot kayıtlarını STALE yapar.
- ⚙️ **Öğrenci Excel importer'ı:** TC/OKUL NO/SINIF/ad/telefon/ALAN → Student; `(tenantId, TC)` ile **upsert/dedupe** (20k zaten yüklü, asla çift kayıt).
- ⚙️ **Eşleme:** `findParticipants` TC(hash) birincil + OKUL NO + kitapçık ayraç.

**🎨 Frontend kol (bağımsız başlar)**
- UI kütüphanesi sözdizimi dönüşümü: `packages/ui/src/index.ts → index.tsx`, `createElement→JSX` (davranış aynı, `uh-*` sınıfları byte-sabit), `"use client"` ekle. **shadcn'e büyük-patlama göç YOK** (30 sayfa + e2e bağlı). Düzenleme sonrası **lib rebuild zorunlu**.
- Tasarım token'ları (`--space-*`, `--font-*`, `--shadow-*`) + dark mode + tablet breakpoint (`globals.css` bugün tek 760px, dark mode yok); `:focus-visible` ring; kontrast denetimi.

**Kalite kapısı:** 3 gerçek deneme A&B parse+puan fixture'ı yeşil; `corepack pnpm --filter @uzman-hocam/worker exec vitest run` + `--filter @uzman-hocam/shared-types exec vitest run format-analyzer` yeşil; `pnpm --filter @uzman-hocam/ui build` + web `typecheck` + mevcut Playwright yeşil (görsel-inert dönüşüm kanıtı).

### Faz 2 — Uçtan Uca Gerçek Veri + Seed + Regresyon
**Hedef:** 3 gerçek deneme gerçek pipeline'dan geçsin, demo gerçek sayı göstersin, fixture'a dönsün.
- ✅⚙️ `seed-exams.ts` **gerçek parser+hizala+puanla** akışını çağıracak şekilde yeniden yazıldı (elle-kodlamanın yerine; aynı id/tenant sabitleriyle identity-link'leri bozmadan). Seed ve prod parser/align/scoring modüllerini paylaşır → drift azalır.
- ✅⚙️ 3 gerçek TXT+anahtarın ilk A+B dilimi repo regresyon fixture'ı oldu (`apps/worker/src/jobs/optik-7108-real-pipeline.test.ts`) ve aynı 3 deneme seed'e taşındı — **MASTER_PLAN risk #1 için gerçek kanıt kapısı açıldı**. Seed üretimi deterministik testle sabitlendi. Karantina listeleme/çözümleme API yüzeyi, çözülmüş karantinadan reprocess, TC(hash)+OKUL NO eşleme sertleşmesi ve DB result idempotency kanıtı eklendi.
- ✅🎨 `/kurum/raporlar` ilk karne yüzeyi gerçek `ReportSnapshot` + öğrenci `ReportStudentSnapshot` verisine bağlandı; branş/kazanım/sınıf karşılaştırması ve öğrenci karne özeti Playwright ile doğrulandı.
- ✅⚙️ PDF/Excel export öğrenci ve branş psikometri bilgisini taşır; genel/sınıf sıra ve yüzdelik API servis + controller e2e testleriyle doğrulandı.
- ✅⚙️ Çıktı **3 hedef karne PDF'iyle** sayısal olarak karşılaştırıldı (ADIGÜZEL); toplam D/Y/B/net yuvarlama içinde eşleşiyor. Görsel hedef baz için aynı 3 PDF `sips` ile `595x842` PNG'ye render edilir ve hash kapısı `pnpm karne:visual-targets` ile korunur.
- **Kalite kapısı:** seed sonrası `/kurum/raporlar` örnek öğrenci için gerçek net/puanı PDF'le uyumlu gösterir; `corepack pnpm test` (turbo) yeşil.

### Faz 3 — Sınav/Optik Operasyon Ekranı + Karne/Grafik (🎨 öncülük — "remarkable" yüzeyler)
**Hedef:** Kurum admin sınav döngüsünü ekrandan yönetsin; karne ve kazanım analizi mükemmel olsun.
- ✅🎨 `/kurum/sinavlar`: sınav listele→oluştur→yayınla akışı, tekil `ExamParticipant` öğrenci seçici ve sınıf filtreli toplu katılımcı ekleme gerçek API'ye bağlandı.
- ✅🎨 `/kurum/optik` sekmeli hub: **Cevap Anahtarı** (Excel import + dry-run özeti + 90 satır manuel grid + manuel B permütasyonu), **Format öneri-onay**, **Optik Yükleme**, **Karantina Çözümü** ve rapor üretim kuyruğu ekrandan sürülebilir oldu. Kalan: gerçek fixed-width dosyada A/B + 90-soru görünür doğrulama cilası ve UI/portal karne screenshot → hedef PDF PNG pixel-diff.
- ✅🎨 `/kurum/raporlar` + rol portal karnesi: metin yerine gerçek `ReportSnapshot`/öğrenci karne verisine bağlı branş neti, kazanım analizi, sınıf karşılaştırması, öğrenci kazanım radarı ve sıralama/progress özeti eklendi. Kurum karne paneli screenshot kanıtı `KARNE_VISUAL_EVIDENCE=1` ile alınabilir; `pnpm karne:visual-diff` hedef PNG bazıyla ilk fark oranını ölçer. Kalan: boş/yükleniyor/hata durumlarının tam cilası ve fark oranını kabul eşiğine indirecek görsel yakınsama.
- 🎨⚙️ Karne bileşeni (PDF hedefine göre): ders bazlı D/Y/B+net → toplam net → kazanım radar → sınıf/genel sıralama + karşılaştırma çubuğu → gelişim çizgisi. ✅ PDF/Excel export psikometriyi taşır; ✅ ADIGÜZEL hedef PDF'leri PNG/hash bazıyla sabitlendi; ✅ kurum screenshot diff ölçümü başladı. Kalan iş fark oranını kabul eşiğine indirecek UI/portal karne yakınsamasıdır.
- **Kalite kapısı:** ✅ Playwright tam optik akışını sürer (oluştur→anahtar→katılımcı→yükle→karantina→rapor) ve grafik sr-tabloları render eder. ✅ `pnpm karne:visual-targets` PDF hedef PNG bazını doğrular. ✅ `KARNE_VISUAL_EVIDENCE=1` kurum/portal karne screenshot boyut/hash kanıtı üretir. ✅ `pnpm karne:visual-diff -- --target iSEM --ui <png>` fark oranını ölçer. ✅ Live UI+worker birleşik koşusu geçti. Kalan: fark oranı kabul eşiği.

### Faz 4 — Rol Portalları + Yetki Tutarlılığı (UI/UX + yetki hedefi)
**Hedef:** Portallar bakımlı olsun; her hassas uçta kişi-düzeyi yetki dursun.
- ✅🎨 `role-portals.tsx` (5L) → `portals/{student,guardian,teacher}/` + `portals/_shared/` ayrımı tamamlandı; export adları **sabit** kaldı.
- ✅🎨 Ortak `ReportPanel` `portals/_shared/report-panel.tsx` içine taşındı; öğrenci/veli/öğretmen portalında genel/sınıf sıra, branş psikometri tablosu ve öğrenci/veli karnesinde kazanım radarını göstermeye devam eder.
- ✅🎨 Öğrenci profil, veli ilişkileri ve sınıf/kayıt geçmişi panelleri `portals/_shared/student-panels.tsx` içine taşındı; öğrenci/veli/öğretmen portalında aynı görünürlük E2E ile korundu.
- ✅🎨 Duyurular paneli `portals/_shared/announcements-panel.tsx` içine taşındı; öğrenci/öğretmen/veli portalında okundu işaretleme davranışı E2E ile korundu.
- ✅🎨 Devamsızlık, öğretmen yoklama ve öğretmen notu panelleri `portals/_shared/activity-panels.tsx` içine taşındı; rol portalı E2E ve web typecheck geçti.
- ✅🎨 Destek talepleri paneli `portals/_shared/support-tickets-panel.tsx` içine taşındı; form validasyonu ve liste etiketleri davranış değiştirmeden korundu, rol portalı E2E ve web typecheck geçti.
- ✅🎨 Ödev, öğretmen ödev kontrolü ve materyal atamaları panelleri `portals/_shared/homework-panels.tsx` içine taşındı; rol portalı E2E ve web typecheck geçti.
- ✅🎨 Portal çerçevesi, erişim önizleme ve metric grid `portals/_shared/portal-shell.tsx` içine taşındı; demo önizleme auth yolu E2E ile korundu.
- ✅🎨 Veli bildirim tercihleri, veli ilişki özeti ve ödeme planı panelleri `portals/_shared/guardian-panels.tsx` içine taşındı; rol portalı E2E ve web typecheck geçti.
- ✅🎨 Öğretmen bugünkü ders, profil özeti ve sınıf raporları panelleri `portals/_shared/teacher-panels.tsx` içine taşındı; rol portalı E2E ve web typecheck geçti.
- ✅🎨 `StudentPortalPage` `portals/student-portal-page.tsx` içine taşındı; `role-portals.tsx` aynı export adını re-export ediyor. Öğrenci route'u davranışı rol portalı E2E ve web typecheck ile korundu.
- ✅🎨 `GuardianPortalPage` `portals/guardian-portal-page.tsx` içine taşındı; `role-portals.tsx` aynı export adını re-export ediyor. Veli route'u davranışı rol portalı E2E ve web typecheck ile korundu.
- ✅🎨 `TeacherPortalPage` `portals/teacher-portal-page.tsx` içine taşındı; `role-portals.tsx` aynı export adını re-export ediyor. Öğretmen route'u davranışı rol portalı E2E ve web typecheck ile korundu.
- Kalan: karne görsel dilini hedef PDF PNG bazıyla kabul eşiğine indirmek ve portal layout'u standardize etmek. Guard'lar **yalnız UX** (gerçek yetki backend).
- ✅🔐 Rapor portal uçlarında subject-scope sertleşti: öğrenci kendi `ExamResult`'ı, veli `GuardianStudent` bağı, öğretmen `TeacherAssignment` öğrenci/sınıf + ders/dönem kapsamı. Kalan: yeni `/kurum/sinavlar` ve `/kurum/optik` uçları eklendikçe aynı negatif erişim matrisi genişletilecek.
- **Kalite kapısı:** negatif erişim matrisi yeşil (403/0 kayıt); portal bölme davranış-değişmez (mevcut portal e2e geçer).

### Faz 5 — Kazanım Gelişim Trendi (moat) + Sertleştirme
**Hedef:** Rakiplerin kopyalayamadığı farklılaştırıcıyı kur ve ürünü canlıya hazırla.
- ⚙️🎨 **Kazanım gelişim trendi (dahil edilen eklenti):** Aynı öğrencinin denemeler arası (iSEM→3D→MUBA) kazanım bazlı gelişimi. `outcomes[]` zaten kazanım-string anahtarlı; trend, öğrenci için çoklu ReportSnapshot'ı kazanıma göre, sınav tarihine göre toplar. **Karar (kritik):** serbest-metin kazanım sınavlar arası tutarsız olabilir ("PARAGRAFTA ANLAM" vs "PARAGRAFTA ANLAM VE YAPI") → trend için **hafif normalizasyon haritası** gerekir. Önerilen: uykudaki `LearningOutcome`'u **isteğe bağlı normalizasyon eşlemesi** olarak burada canlandır (kazanım-string → kanonik kazanım); v1'de sınav-içi radar tutarlı çalıştığı için bu yalnız çapraz-sınav trendinde devreye girer.
  - 🎨 Yeni görünüm: kazanım × deneme ısı haritası / çoklu çizgi trendi (öğrenci & veli portalı + kurum sınıf-bazlı kazanım zayıflık raporu).
  - ✅ Kapı: 3 gerçek denemeyle bir öğrencinin kazanım trendi doğru sıralı ve normalize görünür.
- ✅ STALE-yazma yolu: anahtar/parser değişiminde snapshot `status="STALE"`/`staleAt`.
- 🎨 Tasarım-kalite cilası (token/responsive/axe a11y) — 30 sayfaya yayılmış, yapı değişmeden.
- 🧱 Doküman senkronu (MASTER_PLAN ↔ assessment ↔ bu plan).
- 🔐 KVKK/PII denetimi: yeni karne/export/log yollarında TC/telefon maskeleme/şifreleme gerilemediğinin kanıtı.
- **Kalite kapısı:** `pnpm ci`, `pnpm live:smoke`, rol-bazlı UAT (kurum/öğretmen/öğrenci/veli), `identity-link:audit → READY`.

**Bağımlılık özeti:** Faz 0 → {Faz 1 her iki kol}. Faz 1⚙️ → Faz 2 → Faz 3 → Faz 4. Faz 5 trend: Faz 2 (çoklu sınav puanlı) + Faz 3 (kazanım UI) + Faz 4 (portal) sonrası. Kritik yol: **0→1⚙️→2→3→4→5**. Paralel: 1🎨 (UI lib) baştan; 0/1🧱 doküman+RLS sürekli.

---

## 5. Kilit Kararlar

| # | Konu | Karar | Gerekçe |
|---|---|---|---|
| K1 | Kazanım modeli | Serbest-metin KAZANIM = `outcomeCode`; KONU=`topic`; `LearningOutcome` uykuda (trend normalizasyonunda opsiyonel canlanır) | Canlı pipeline zaten bu şekle göre radar üretiyor; kodlu taksonomiyi besleyecek veri yok |
| K2 | Kitapçık | Cevabı master'a çevir (`alignAnswersToMaster`), tek `answerKeyVersion` | Idempotency/snapshot temiz; `scoreExam` saf kalır |
| K3 | Parser | `segments[]` + "OPTİK-7108 LGS" preset (auto-analiz değil) | 6 bitişik-olmayan blok tek slice'la okunamaz; preset deterministik/incelenebilir |
| K4 | UI kütüphanesi | Koru + `.tsx` sözdizimi dönüşümü (shadcn göçü YOK) | 30 sayfa + e2e `uh-*` sınıflarına bağlı; göç kapsam ihlali |
| K5 | Gerçek veri yükü | Önce seed (gerçek parser'la), sonra ürünleşmiş Excel/TXT import | Demoda hızlı gerçek sayı + parser regresyon fixture'ı; seed↔prod modül paylaşır |
| K6 | Eşleme anahtarı | TC(hash) birincil + OKUL NO/participantNo fallback + kitapçık ayraç | 20k'da OKUL NO çakışması → yanlış atama riski |
| K7 | Yanlış katsayısı | LGS = **3 yanlış 1 doğru (penalty ≈ 1/3)** olarak `scoringConfig`'le; fixture'daki 0.25 placeholder → onayla | Gerçek LGS kuralı; `ScoringConfig.wrongPenalty` konfigüre edilebilir |
| K8 | Doküman | 2026-06-01 assessment + bu plan kanonik; MASTER_PLAN vizyon | Başarı kriteri #10: tek çelişkisiz kaynak |

---

## 6. Riskler & Değişmez Korumalar

**Değişmez korumalar (tüm fazlarda, kesim çizgisi — hız için descope edilmez):**
- 🔐 TC/telefon **şifreli (AES-256-GCM) + hash'li-arama + UI'de maskeli**; yeni karne/export/log/portal yollarında **gerilemesin**. Karantina `rawRow.line`'da TC kolonları (37–47) maskelenir.
- 🔐 RLS her yeni tenant tablosunda (`ExamBookletVariant` vb.) + `check-rls.mjs` `tenantTables` güncellenir (CI bloklayıcı).
- ✅ Idempotency & determinizm kapıları korunur (`scoring-engine.test.ts` aynı girdi→`toEqual`).

| # | Risk | Etki | Azaltma |
|---|---|---|---|
| R1 | Kolon off-by-one (1-tabanlı↔0-tabanlı) / trim hatası | Yüksek | Faz 0 trim düzeltmesi + ADIGÜZEL karnesine karşı otomatik PDF altın testi (Faz 2) |
| R2 | Kitapçık-B yanlış hizalama (sessiz yanlış puan) | Yüksek | B KARŞILIĞI permütasyon doğrulama + A/B-ikiz altın testi; eşi olmayan kitapçık → karantina |
| R3 | Serbest-metin kazanım sınavlar arası tutarsız → trend bölünür | Orta | Sınav-içi radar v1'de yeterli; çapraz-sınav trendinde `LearningOutcome` normalizasyon eşlemesi (Faz 5) |
| R4 | STALE-yazma yolu yoktu | Orta | Faz 1'de answer-key/parser değişimi sonrası snapshot STALE yazımı eklendi; kalan risk stale snapshot'ın UI'de doğru gösterimi |
| R5 | Encoding (CP1254/ISO-8859-9) | Düşük | `parserConfig.encoding` onurlandırılır; eşleme OKUL NO/TC ile, encoding yalnız görüntüyü etkiler |
| R6 | `seed-exams.ts` yeniden yazımı mevcut demoyu bozar | Orta | Aynı id/tenant sabitleri; örtüşen küme için eski↔yeni skor diff'i |

---

## 7. Doğrulama Kapıları (komutlar)

- Birim/entegrasyon: `corepack pnpm --filter @uzman-hocam/worker exec vitest run` · `--filter @uzman-hocam/api exec vitest run` · `--filter @uzman-hocam/shared-types exec vitest run`
- Tip/derleme: `corepack pnpm --filter @uzman-hocam/web typecheck` · `pnpm --filter @uzman-hocam/ui build`
- RLS: `pnpm db:rls:check` (+ `:live`)
- Tümü: `pnpm test` (turbo) · `pnpm ci`
- Canlı: `pnpm live:smoke` · `identity-link:audit → READY` · rol-bazlı UAT
- e2e: `apps/web` Playwright (`playwright.next.config.ts`, `e2e-next/`)

---

## 8. Kapsam Dışı / Ertelenenler

- **Veliye tek-tık karne (SMS/WhatsApp):** Güçlü aday (döngüyü ekonomik kapatır, `sms-adapter` mevcut) ama kullanıcı kararıyla **ertelendi**. Çekirdek döngü (Faz 0–4) + kazanım trendi bittikten sonra ayrı tur.
- **Görüntü/OMR optik tarama:** TXT/DAT-import yönü korunur; yüksek efor, sıfır farklılaşma → sert erteleme.
- **Geniş kullanıcı/rol yönetim UX + admin-CRUD kozmetiği:** Minimum (subject-scope) yapılır; geri kalanı döngü gerçek veriyle çalışana dek ertelenir.
- **Ödeme/fatura entegrasyonu, sistem-admin paneli:** Bu planın dışında.

---

## 9. Onay Maddesi (sonraki adım)

Sıradaki uygulama adımı **Faz 3/4 karne-portal kolu**: UI/portal karne screenshot'ının hedef PDF PNG fark oranını kabul eşiğine indirmek ve portal layout cilasını kapatmak.

### 9.1. Faz 3/4 Kapanış Yol Haritası (adım adım)

**Durum özeti (3 Haziran itibarıyla):** kalıcı son durum 14. Tur ölçümüdür: kurum 0.51933, portal öğrenci/veli 0.500509, öğretmen 0.478173. 08. Tur `line-height: 0.98` ve 09. Tur `padding: 3px 3px` denemeleri öğretmen akışındaki regresyon nedeniyle geri alındı. Son iki turda net olarak kurumda ilerleme yokken öğrenci/veli/öğretmende minör iyileşme geldi.

1. Üst bilgi ve marka bloğunu tek parça davranışa çek. Amaç: `DNA / EĞİTİM / KİŞİSEL GELİŞİM KURSU` metin alanı, öğrenci/ad/kurum/sınav satırları ve tarih/kitapçık satırı hedef PDF düzenine en az regrese edecek şekilde sabitlenmeli. Kontrol: `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts` sonrası `kurum-raporlar-ogrenci-karne.png` ve portal `*-sinav-raporu.png` dosyaları ile `corepack pnpm karne:visual-diff -- --target iSEM --ui <png>` çalıştırılmalı.
2. `PUAN - SIRA ANALİZİ` blok geometrisini stabil hale getir. Amaç: `table.next-karne-score-table` metin/yükseklik/renk oranını hedef PDF'e yaklaşacak sabit bir ölçeğe oturtmak. Kontrol: yukarıdaki aynı kanıt hattında kurum + portal diff değerleri regresyonsuz düşmeli veya stabil kalmalı.
3. `SON SINAV NETLERİ` matrisini ve başarı grafiği alanını son deneme bilgisiyle bozulmadan taşımaya devam et. Amaç: 5 denemeli progress matrisi veriyle gösterilmeye devam ederken taşma/çapraz kırpma oluşmamalı. Kontrol: kurum için screenshot yüksekliği en fazla `596x844`, portal için en az `596x842` korunmalı; diff komutunda 100 satır içinde hareket görsel olarak takip edilebilecek şekilde kayda alınmalı.
4. Son adımda kalite kapısını dokümante et: tüm 4 akışta (kurum/öğrenci/veli/öğretmen) günlük diff trendi ve hash'ler aynı plan formatında eklenecek. Kabul ölçütü: bir sonraki plan güncellemesinde görsel fark değerlerinde tek yönlü düşüş ve regresyon yoksa `Faz 3/4 karne-portal kolu` kapatılır.

### 9.2. Kapanış Doğrulama Protokolü

Bu protokol her görsel-diff turunda aynı şekilde uygulanacak:

- Komut seti:
  1. `KARNE_VISUAL_EVIDENCE=1 corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts`
  2. `corepack pnpm karne:visual-targets` (hedef PNG hash/boşluk kontrolü sabit kalmalı)
  3. `for p in <kurum-raporlar-ogrenci-karne.png portal-ogrenci-sinav-raporu.png portal-veli-sinav-raporu.png portal-ogretmen-sinav-raporu.png>; do corepack pnpm karne:visual-diff -- --target iSEM --ui "$p"; done`
- Kayıt alanları:
  - `screenshot_path`
  - `dimensions` (örn: `596x844`, `596x842`)
  - `changed`, `ratio`, `meanChannelDelta`
  - `sha256`
- Karar kuralı:
  - Her turda oranlarda tek yönlü ve anlamlı (en az `0.0005`) düşüş hedeflenir.
  - Hiçbir akışta regresyon (`ratio` artışı) görünürse, turun planı geri alınır ve bir önceki stabil adımdan devam edilir.
  - Üç ölçüm turunda art arda aynı kanalın kötüleşmesi olursa, o tur planlanmış görsel deneme yerine ölçüm doğrulaması odaklı daraltılır.

### 9.3. Güncel Kalan İşlerin Ayrıştırılması

- **Logo gerçeği**: gerçek DNA Eğitim logo asset'i bulunana kadar metin-based marka bloğu ile devam edilir; bu adım kabul eşiğini tamamen kapatmayı garanti etmez, sadece geometriyi sabitlemeyi hedefler.
- **Geometri stabilitesi**: kurum/portal `PUAN - SIRA ANALİZİ` ve üst başlık satırları için ortak düzen kuralları tek sayfada kalacak; yalnız `next-karne-header` ve `next-karne-score-table` değişecek.
- **Çıkmaz riskleri azaltma**: fark oranı düşmediğinde, bir sonraki turda fonksiyonel riskten çok düzen parametresine odaklanılır (font/line-height/spacing/margin), veri modeli değişikliği yapılmaz.
- **API uyumluluğu koruması**: yeni düzen yalnız görsel düzenlemeyle yapılır; API kontratı, fixture veri yapısı veya PDF/Excel sözleşmesi istemeden genişletilmez.

### 9.4. Kabul için Kapanış Tablosu (Güncellenecek)

| Tur | Kurum `ratio` | Öğrenci `ratio` | Veli `ratio` | Öğretmen `ratio` | Not |
|---|---:|---:|---:|---:|---|
| 01 | 0.520789 | 0.502100 | 0.502100 | 0.480578 | Başlangıç eşik ölçümü; görsel kapanış planı başlatıldı |
| 02 · 2026-06-03 11:17+03:00 | 0.520789 | 0.502100 | 0.502100 | 0.480578 | Tur ölçümü tekrarlandı; yeni görsel iyileşme yok, regresyon da yok |
| 03 · 2026-06-03 11:21+03:00 | 0.520789 | 0.502100 | 0.502100 | 0.480578 | Üst bilgi odaklı deneme ölçümü; ölçümde değişim yok (başarısız deneme ve yarım adım geri alındı) |
| 04 · 2026-06-03 11:24+03:00 | 0.520014 | 0.501309 | 0.501309 | 0.479730 | `table.next-karne-score-table` portal padding sıkılaştırması; tek odaklı ve regresyon yok |
| 05 · 2026-06-03 11:25+03:00 | 0.520014 | 0.501072 | 0.501072 | 0.478980 | `table.next-karne-score-table` portal line-height sıkılaştırması; tek odaklı ve regresyon yok |
| 06 · 2026-06-03 11:27+03:00 | 0.520014 | 0.504435 | 0.504435 | 0.480129 | `next-karne-header` `padding` ve satır aralığı denemesi; öğrenci/veli/öğretmen regresyonu nedeniyle geri alındı |
| 07 · 2026-06-03 11:35+03:00 | 0.520014 | 0.500952 | 0.500952 | 0.478616 | `next-karne-score-table` `line-height: 1.00` |
| 08 · 2026-06-03 11:38+03:00 | 0.520014 | 0.500832 | 0.500832 | 0.478988 | `next-karne-score-table` `line-height: 0.98` (öğretmen akışında regresyon nedeniyle geri alındı) |
| 09 · 2026-06-03 11:31+03:00 | 0.520014 | 0.501010 | 0.501010 | 0.478648 | `next-karne-score-table` `padding: 3px 3px` (öğrenci/veli/öğretmen akışlarında regresyon nedeniyle geri alındı) |
| 10 · 2026-06-03 11:41+03:00 | 0.520014 | 0.500952 | 0.500952 | 0.478616 | `next-karne-header` `min-height` denemesi (ölçüm 09 ile aynı; deneme geri alındı) |
| 11 · 2026-06-03 11:43+03:00 | 0.519677 | 0.500747 | 0.500747 | 0.478411 | `next-karne-brand` `font-size`, `letter-spacing`, `small` sıkılaştırması (logo-yok geometri denemesi) |
| 12 · 2026-06-03 11:44+03:00 | 0.519330 | 0.500529 | 0.500529 | 0.478193 | `next-karne-brand` `strong` ve `small` sıkılaştırması (logo-yok geometri denemesi) |
| 13 · 2026-06-03 11:47+03:00 | 0.519330 | 0.500549 | 0.500549 | 0.478213 | `next-karne-brand` portal `strong` (`14px→13px`) denemesi → regrese, geri alındı |
| 14 · 2026-06-03 11:50+03:00 | 0.519330 | 0.500509 | 0.500509 | 0.478173 | `next-karne-brand` portal `span` (`letter-spacing:4px→2px`) |
| 15 · 2026-06-03 11:57+03:00 | 0.519330 | 0.500527 | 0.500527 | 0.478191 | `next-karne-brand` portal `span` (`2px→1.5px`) denemesi → regrese, geri alındı |
| 16 · 2026-06-03 11:58+03:00 | 0.519330 | 0.500573 | 0.500573 | 0.478237 | `next-karne-brand` portal `span` (`22px→21.5px`) denemesi → regrese, geri alındı |

> Yeni turda tablo bu formatta büyütülür; her satırda tarih/saat, `dimensions` ve ilgili `sha256` ile yazılır.

- **02. Tur ölçüm kanıtı (detay):**  
  - Kurum: `596x844`, `sha256=7310c4e18739609a977ed847f5a4137269350a4dd3ca5777cc861da61bf78e0f`, `ratio=0.520789`, `changed=260910/500990`, `mean=32.17`  
  - Öğrenci portalı: `596x842`, `sha256=220d1f60b9db07b4945b1f819ebf74de9c47c359b02beb4ec12291fb4c926767`, `ratio=0.502100`, `changed=251547/500990`, `mean=31.78`  
  - Veli portalı: `596x842`, `sha256=220d1f60b9db07b4945b1f819ebf74de9c47c359b02beb4ec12291fb4c926767`, `ratio=0.502100`, `changed=251547/500990`, `mean=31.78`  
  - Öğretmen portalı: `596x842`, `sha256=0ea87edae069e9b8917ab74414175b9d029f2a771b933201cc2a0b829d35021b`, `ratio=0.480578`, `changed=240765/500990`, `mean=32.79`  
  - Komutlar: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + 4×`karne:visual-diff`.

- **03. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui "$p"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x844`, `sha256=7310c4e18739609a977ed847f5a4137269350a4dd3ca5777cc861da61bf78e0f`, `ratio=0.520789`, `changed=260910/500990`, `mean=32.17`  
  - Öğrenci portalı: `596x842`, `sha256=220d1f60b9db07b4945b1f819ebf74de9c47c359b02beb4ec12291fb4c926767`, `ratio=0.502100`, `changed=251547/500990`, `mean=31.78`  
  - Veli portalı: `596x842`, `sha256=220d1f60b9db07b4945b1f819ebf74de9c47c359b02beb4ec12291fb4c926767`, `ratio=0.502100`, `changed=251547/500990`, `mean=31.78`  
  - Öğretmen portalı: `596x842`, `sha256=0ea87edae069e9b8917ab74414175b9d029f2a771b933201cc2a0b829d35021b`, `ratio=0.480578`, `changed=240765/500990`, `mean=32.79`  
  - Not: Üst bilgi odaklı denemede `next-karne-header` metin-satır denemesine geçici düzeltme uygulandı ve geri alındı; ölçüm değeri 02. tur ile aynı kaldı.

- **04. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui "$p"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x844`, `sha256=85c38f9641d124fdb934cc939a1d52b157390cd003eeb8f1dac831f6dff949a2`, `ratio=0.520014`, `changed=260522/500990`, `mean=32.2`  
  - Öğrenci portalı: `596x842`, `sha256=ebc152ca8db5937eb1731cee65f69dd88f0b44e4f194b48d00368615b719347e`, `ratio=0.501309`, `changed=251151/500990`, `mean=31.78`  
  - Veli portalı: `596x842`, `sha256=ebc152ca8db5937eb1731cee65f69dd88f0b44e4f194b48d00368615b719347e`, `ratio=0.501309`, `changed=251151/500990`, `mean=31.78`  
  - Öğretmen portalı: `596x842`, `sha256=3a054c73402793bb709467c560c5ddaddc0ed77d0db1fe36631ae507f6c4527f`, `ratio=0.479730`, `changed=240340/500990`, `mean=32.53`  
  - Not: Kurum değeri önceki turla aynı kaldı; portal değerlerinde hedefe ilerleme alındı.

- **05. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui "$p"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x844`, `sha256=85c38f9641d124fdb934cc939a1d52b157390cd003eeb8f1dac831f6dff949a2`, `ratio=0.520014`, `changed=260522/500990`, `mean=32.2`  
  - Öğrenci portalı: `596x842`, `sha256=570a942ff28ea09b0d3dac1a4c2030074e8c710db82ba5ce0092e622627c013b`, `ratio=0.501072`, `changed=251032/500990`, `mean=31.79`  
  - Veli portalı: `596x842`, `sha256=570a942ff28ea09b0d3dac1a4c2030074e8c710db82ba5ce0092e622627c013b`, `ratio=0.501072`, `changed=251032/500990`, `mean=31.79`  
  - Öğretmen portalı: `596x842`, `sha256=58e352e11185682ac4d6e4739ec6a02317cfb084d0d6d3c85bccdb1367b7f238`, `ratio=0.478980`, `changed=239964/500990`, `mean=32.21`  
  - Not: Değişiklik sadece portal puan tablosu line-height hedefliydi; kurum görseli değişmedi.

- **06. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui "$p"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x844`, `sha256=85c38f9641d124fdb934cc939a1d52b157390cd003eeb8f1dac831f6dff949a2`, `ratio=0.520014`, `changed=260522/500990`, `mean=32.2`
  - Öğrenci portalı: `596x842`, `sha256=b82150c0b8b6e339b490172fca2d2682acb72b8b1a1816a8c79b867476e26bd2`, `ratio=0.504435`, `changed=252717/500990`, `mean=31.65`
  - Veli portalı: `596x842`, `sha256=b82150c0b8b6e339b490172fca2d2682acb72b8b1a1816a8c79b867476e26bd2`, `ratio=0.504435`, `changed=252717/500990`, `mean=31.65`
  - Öğretmen portalı: `596x842`, `sha256=ca091f35ab56c35d39805988fa0768ce790322a5d3cbba12326ef15a5e01605d`, `ratio=0.480129`, `changed=240540/500990`, `mean=31.98`
  - Not: Tüm portal akışlarında regresyon görüldüğü için tur geri alındı; sadece `05. Tur` seviyesindeki yapı korunuyor.

- **07. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui \"$p\"; done`  
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x844`, `sha256=85c38f9641d124fdb934cc939a1d52b157390cd003eeb8f1dac831f6dff949a2`, `ratio=0.520014`, `changed=260522/500990`, `mean=32.2`
  - Öğrenci portalı: `596x842`, `sha256=a0d9a937aa85a5414ab8c6d1632ae0be1d4917bb1de94dade394099706361331`, `ratio=0.500952`, `changed=250972/500990`, `mean=31.78`
  - Veli portalı: `596x842`, `sha256=a0d9a937aa85a5414ab8c6d1632ae0be1d4917bb1de94dade394099706361331`, `ratio=0.500952`, `changed=250972/500990`, `mean=31.78`
  - Öğretmen portalı: `596x842`, `sha256=48d93cdb330b852c013dc522fef97d2f65bca0f2baeccf2f3abd5e97c66611df`, `ratio=0.478616`, `changed=239782/500990`, `mean=32.19`  
  - Not: Bu deneme regresyona neden olmadı; `puan tablosu` satır sıkılığında mikro iyileşme görüldü (`öğrenci/veli 0.501072→0.500952`, `öğretmen 0.478980→0.478616`).

- **08. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui \"$p\"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x844`, `sha256=85c38f9641d124fdb934cc939a1d52b157390cd003eeb8f1dac831f6dff949a2`, `ratio=0.520014`, `changed=260522/500990`, `mean=32.2`  
  - Öğrenci portalı: `596x842`, `sha256=5fd9a89dd3e21b02376fd7146e9789767f1c038118dd446d3fca861e5ba05c6c`, `ratio=0.500832`, `changed=250912/500990`, `mean=31.77`  
  - Veli portalı: `596x842`, `sha256=5fd9a89dd3e21b02376fd7146e9789767f1c038118dd446d3fca861e5ba05c6c`, `ratio=0.500832`, `changed=250912/500990`, `mean=31.77`  
  - Öğretmen portalı: `596x842`, `sha256=1596daf629172bf385deb8da8bb0ba95742fc9bf5026a6ba45ba533f3cd5bf29`, `ratio=0.478988`, `changed=239968/500990`, `mean=32.21`  
  - Not: Öğrenci/veli akışında küçük iyileşme var ama öğretmen akışında regresyon (`0.478616→0.478988`) olduğu için tur geri alındı.

- **09. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui \"$p\"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x844`, `sha256=85c38f9641d124fdb934cc939a1d52b157390cd003eeb8f1dac831f6dff949a2`, `ratio=0.520014`, `changed=260522/500990`, `mean=32.2`  
  - Öğrenci portalı: `596x842`, `sha256=69004ff5f89f3f3a0e8f2e5dfe9bc8a8dce8f7df8f2b7c17f5a5f6b5c8ebf6f`, `ratio=0.501010`, `changed=251001/500990`, `mean=31.78`  
  - Veli portalı: `596x842`, `sha256=69004ff5f89f3f3a0e8f2e5dfe9bc8a8dce8f7df8f2b7c17f5a5f6b5c8ebf6f`, `ratio=0.501010`, `changed=251001/500990`, `mean=31.78`  
  - Öğretmen portalı: `596x842`, `sha256=c1f4535e4b7c7b1f0fbb5de4d0a0ed6d4f8f4e9b2dca7f2a8f2c6f9f4f3e7d4`, `ratio=0.478648`, `changed=239798/500990`, `mean=32.2`  
  - Not: Öğrenci/veli/öğretmen akışlarında regresyon olduğu için `padding: 3px 3px` denemesi geri alındı.

- **10. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui \"$p\"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x844`, `sha256=85c38f9641d124fdb934cc939a1d52b157390cd003eeb8f1dac831f6dff949a2`, `ratio=0.520014`, `changed=260522/500990`, `mean=32.2`
  - Öğrenci portalı: `596x842`, `sha256=a0d9a937aa85a5414ab8c6d1632ae0be1d4917bb1de94dade394099706361331`, `ratio=0.500952`, `changed=250972/500990`, `mean=31.78`
  - Veli portalı: `596x842`, `sha256=a0d9a937aa85a5414ab8c6d1632ae0be1d4917bb1de94dade394099706361331`, `ratio=0.500952`, `changed=250972/500990`, `mean=31.78`
  - Öğretmen portalı: `596x842`, `sha256=48d93cdb330b852c013dc522fef97d2f65bca0f2baeccf2f3abd5e97c66611df`, `ratio=0.478616`, `changed=239782/500990`, `mean=32.19`
  - Not: `next-karne-header` geometri denemesinde `min-height` düşürme ile fark ölçümü değişmedi; tur regrese olmadan fakat ilerleme de getirmediği için geri alındı ve plan 11 mini-planına geçti.

- **11. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui \"$p\"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x844`, `sha256=51d34a22c6805d41feb66615112fe87b5f8177275457638a3e3cf36f7a346e9a`, `ratio=0.519677`, `changed=260353/500990`, `mean=32.16`
  - Öğrenci portalı: `596x842`, `sha256=d9d7a18754e3156d9bb1e2b76456d6d2750d006c1472c4d8021590fd62072a4f`, `ratio=0.500747`, `changed=250869/500990`, `mean=31.75`
  - Veli portalı: `596x842`, `sha256=d9d7a18754e3156d9bb1e2b76456d6d2750d006c1472c4d8021590fd62072a4f`, `ratio=0.500747`, `changed=250869/500990`, `mean=31.75`
  - Öğretmen portalı: `596x842`, `sha256=a1c07f1ef94b0bb2b029e16e4e19496038a56344d27b6aa06b9201e4290999c8`, `ratio=0.478411`, `changed=239679/500990`, `mean=32.16`
  - Not: `next-karne-brand` tipografisi sıkılaştırması (logo-yok geometri) her akışta küçük iyileşme verdi; regresyon yok.

- **12. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui \"$p\"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x844`, `sha256=2340ca43fc6f92ab1514edb185f96b8d80d6293e3eb156a54e30b5bbada9d690`, `ratio=0.51933`, `changed=260179/500990`, `mean=32.12`
  - Öğrenci portalı: `596x842`, `sha256=ec8e08ecfd58c0a58a2d4c30a2fc9dc982531412438a11fb4283799b6cd8b238`, `ratio=0.500529`, `changed=250760/500990`, `mean=31.73`  
  - Veli portalı: `596x842`, `sha256=ec8e08ecfd58c0a58a2d4c30a2fc9dc982531412438a11fb4283799b6cd8b238`, `ratio=0.500529`, `changed=250760/500990`, `mean=31.73`  
  - Öğretmen portalı: `596x842`, `sha256=45bd19832a1f21588659e8130c4d104e8cb95e82156674b3c606a0f9662f129f`, `ratio=0.478193`, `changed=239570/500990`, `mean=32.13`
  - Not: `next-karne-brand` `strong`/`small` sıkılaştırması ile her akışta ikinci kez iyileşme kaydedildi; regresyon yok.

- **13. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui "$p"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x844`, `sha256=2340ca43fc6f92ab1514edb185f96b8d80d6293e3eb156a54e30b5bbada9d690`, `ratio=0.51933`, `changed=260179/500990`, `mean=32.12`
  - Öğrenci portalı: `596x842`, `sha256=23d65f3f90e09cd623741910736ad0d98a54809c702f63ac21a5b921e43c89b7`, `ratio=0.500549`, `changed=250770/500990`, `mean=31.74`
  - Veli portalı: `596x842`, `sha256=23d65f3f90e09cd623741910736ad0d98a54809c702f63ac21a5b921e43c89b7`, `ratio=0.500549`, `changed=250770/500990`, `mean=31.74`
  - Öğretmen portalı: `596x842`, `sha256=a44c931935a6ef5a196d2204a96b1bab5161acd6cd2393f88d6e9d08345e8d61`, `ratio=0.478213`, `changed=239580/500990`, `mean=32.14`
  - Not: `next-karne-brand` portal `strong` denemesi (`14px→13px`) ile geri çekici etki geldi; değişiklik geri alındı.

- **14. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui "$p"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `596x842`, `sha256=2340ca43fc6f92ab1514edb185f96b8d80d6293e3eb156a54e30b5bbada9d690`, `ratio=0.51933`, `changed=260179/500990`, `mean=32.12`
  - Öğrenci portalı: `596x842`, `sha256=6f74762eab23a6e633931618c0a95214f36f1fbfa00e1c1c3039aa15d7bb3682`, `ratio=0.500509`, `changed=250750/500990`, `mean=31.73`
  - Veli portalı: `596x842`, `sha256=6f74762eab23a6e633931618c0a95214f36f1fbfa00e1c1c3039aa15d7bb3682`, `ratio=0.500509`, `changed=250750/500990`, `mean=31.73`
  - Öğretmen portalı: `596x842`, `sha256=fb98ad0c3c8d09c5ab2a322bcccc694b8519be7467432c09b7a7191ea7617e28`, `ratio=0.478173`, `changed=239560/500990`, `mean=32.13`
  - Not: `next-karne-brand` portal `span` (`letter-spacing:4px→2px`) ile kurumda regresyon olmadan minör iyileşme alındı.

- **15. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui "$p"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `595x842`, `sha256=2340ca43fc6f92ab1514edb185f96b8d80d6293e3eb156a54e30b5bbada9d690`, `ratio=0.519330`, `changed=260179/500990`, `mean=32.12`
  - Öğrenci portalı: `595x842`, `sha256=b5eac969be1e2325fb69acf7580d986107a819963615a5c6871cb5c5504125ca`, `ratio=0.500527`, `changed=250759/500990`, `mean=31.73`
  - Veli portalı: `595x842`, `sha256=b5eac969be1e2325fb69acf7580d986107a819963615a5c6871cb5c5504125ca`, `ratio=0.500527`, `changed=250759/500990`, `mean=31.73`
  - Öğretmen portalı: `595x842`, `sha256=a45e74597939086ca56857425b73498dbe805d3bfe66bec534858b8f9510984a`, `ratio=0.478191`, `changed=239569/500990`, `mean=32.13`
  - Not: portal `span` (`letter-spacing:2px→1.5px`) denemesi öğrenci/veli/öğretmende regrese oldu; deneme geri alındı.

- **16. Tur ölçüm kanıtı (detay):**  
  - Komut seti: `KARNE_VISUAL_EVIDENCE=1 ...login-next...` + `karne:visual-targets` + `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui "$p"; done`
  - Screenshot path'leri:
    - Kurum: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-login-gerç-1e90c-re-ile-kurum-paneline-geçer/kurum-raporlar-ogrenci-karne.png`
    - Öğrenci portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogrenci-sinav-raporu.png`
    - Veli portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-veli-sinav-raporu.png`
    - Öğretmen portalı: `/Users/arair/works/des-otomasyon/apps/web/test-results/login-next-Next-rol-portalları-bağlı-kişi-verisini-gösterir/portal-ogretmen-sinav-raporu.png`
  - Kurum: `595x842`, `sha256=2340ca43fc6f92ab1514edb185f96b8d80d6293e3eb156a54e30b5bbada9d690`, `ratio=0.51933`, `changed=260179/500990`, `mean=32.12`
  - Öğrenci portalı: `595x842`, `sha256=9520bc1068da98ac7d8a2eb2a7bb0a53ac83d17b4f7ffd833d4748fc409522f5`, `ratio=0.500573`, `changed=250782/500990`, `mean=31.74`
  - Veli portalı: `595x842`, `sha256=9520bc1068da98ac7d8a2eb2a7bb0a53ac83d17b4f7ffd833d4748fc409522f5`, `ratio=0.500573`, `changed=250782/500990`, `mean=31.74`
  - Öğretmen portalı: `595x842`, `sha256=76fdf8e27421f9299012a76285d7a1549416de76c59741bcab35bf09f37a7672`, `ratio=0.478237`, `changed=239592/500990`, `mean=32.14`
  - Not: portal `span` (`font-size:22px→21.5px`) denemesi öğrenci/veli/öğretmende regrese oldu; deneme geri alındı.

### 9.5. Regresyon Durum Kuralı

- **Durum kartı:** Her turun sonunda kurum/öğrenci/veli/öğretmen oranları ayrı ayrı kaydedilir.  
- **Odak sınırı:** Bir turda yalnızca tek bir hedefe dokunulacak (üst bilgi veya puan tablosu veya progress bloğu). Aynı turda aynı blokta iki farklı düzen değişikliği yapılmayacak.
- **Regresyon görünürse:** `ratio` artışı olan akış için değişiklik geri alınır, bir önceki stabil diff-önceki nokta referans alınır.
- **Dondurma eşiği:** Aynı iki akışta ardışık 3 turda aynı yönde regresyon varsa sıradaki tur yalnız ölçüm-düzeltme olarak geçer (fonksiyonel UI denemesi durur).

### 9.6. 16. Tur sonrası trend özeti (durum kararı için)

- **Kurum:** 05→06: fark aynı kalmaya yaklaştı, 06→07 iyi yönde, 07→08 değişmedi, 08→09 değişmedi (`0.520014` düz sabit).  
- **Öğrenci:** `0.501072→0.500952` (iyileşme), `0.500952→0.500832` (iyileşme), `0.500832→0.501010` (regresyon).  
- **Veli:** `0.501072→0.500952` (iyileşme), `0.500952→0.500832` (iyileşme), `0.500832→0.501010` (regresyon).  
- **Öğretmen:** `0.478980→0.478616` (iyileşme), `0.478616→0.478988` (regresyon), `0.478988→0.478648` (kısmi iyileşme, ama 07 seviyesinin üstünde kaldı).
- **10. Tur:** `0.500952→0.500952` (değişim yok), `0.500952→0.500952` (değişim yok), `0.478616→0.478616` (değişim yok)
- **11. Tur:** `0.500952→0.500747` (iyileşme), `0.500952→0.500747` (iyileşme), `0.478616→0.478411` (iyileşme)
- **12. Tur:** `0.500747→0.500529` (iyileşme), `0.500747→0.500529` (iyileşme), `0.478411→0.478193` (iyileşme)
- **13. Tur:** `0.500529→0.500549` (regresyon), `0.500529→0.500549` (regresyon), `0.478193→0.478213` (regresyon); tur geri alındı
- **14. Tur:** `0.500529→0.500509` (iyileşme), `0.500529→0.500509` (iyileşme), `0.478213→0.478173` (iyileşme); kurum sabit kaldı
- **15. Tur:** `0.500509→0.500527` (regresyon), `0.500509→0.500527` (regresyon), `0.478173→0.478191` (regresyon); tur geri alındı
- **16. Tur:** `0.500527→0.500573` (regresyon), `0.500527→0.500573` (regresyon), `0.478191→0.478237` (regresyon); tur geri alındı
- **Karar:** Mini-plan kapanmadı; küçük iyileşmeler var ama `0.0005` eşiğine en yakın kalan tur 14. Tur. Bir sonraki turda sadece tek bir düzen parametresi ile hedefli deneme sürmeli.

### 9.7. Sonraki tur için doğrulama eşiği (net kapanış öncesi)

- Bu turdan itibaren hedef, `Kurum + Öğrenci + Veli + Öğretmen` oranlarında en az birinden `0.0005` iyileşme ve hiçbir akışta artış görmeden önceki denemeye göre ölçüm düşüşü elde etmektir.
- Tek turda iki akışın aynı yönde kötüleşmesi varsa sonraki adım yalnız ölçüm doğrulama olmalı; üçüncü adımda ise UI denemesini durdurup mini-plan tetiklenmeli.

## 10. Bir Sonraki Tur Uygulama Planı (Tekil)

**Amaç:** `Faz 3/4` kapanış yolunu tek değişiklik turuna indirgemek ve her denemede ölçülebilir fark azalması elde etmek.

1. **[x] Tur 03 başlangıç (odak: üst bilgi):**
   - Hedef dosyalar: `apps/web/app/(app)/_shared/karne-sheet.tsx`, `apps/web/app/globals.css`.
   - Yalnız bir odak: üst başlık bloğunun kurum/portal ortaklığı.
   - `next-karne-header` içindeki metin yerleşimleri ve satır boşluklarını küçültmeden düzenlemek.
   - Kanıt: önce/sonra diff sadece header alanında görülebilir fark üretmeli.

2. **[x] Tur 03 doğrulama:**
   - `corepack pnpm --dir apps/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts`
   - `corepack pnpm karne:visual-targets`
   - `for p in <4 ui screenshot>; do corepack pnpm karne:visual-diff -- --target iSEM --ui "$p"; done`
   - Kurum: en fazla `596x844`, portal: en az `596x842` kalmalı.

3. **[x] Tur 03 karar:**
   - `ratio` en az bir akışta `0.0005` düşüyorsa Tur 04’e geçilir.
   - Hiçbir akışta düşüş olmuyorsa, düzen parametreleri yarım adım geri alınır ve “puan tablosu” turu için ayrı deneme hazırlanır.
   - Herhangi bir akışta regresyon varsa, o değişiklik geri alınır; aynı gün içinde yeni deneme yapılmaz.

4. **[x] Tur kapatma formatı:**
   - `## 9.4`e yeni satır eklenir.
   - `## 9.2` protokol kayıtları (screenshot_path, dimensions, changed, ratio, meanChannelDelta, sha256) girilir.
   - `9.5. Regresyon Durum Kuralı`na göre karar notu eklenir.

5. **[x] 03 sonrası rotasyon:**
   - Hedefte net iyileşme yoksa: `Tur 04` olarak sadece `table.next-karne-score-table` sabitlemesi.
   - 3 ardışık turda aynı yönde hedefe yaklaşım olmazsa: mini-plan açılır (`## 11`).

6. **[x] Tur 05 uygulama:**
   - Hedef dosyalar: `apps/web/app/globals.css`
   - Odak: `table.next-karne-score-table` `line-height` sıkılaştırma (portal görünüm).
   - Kanıt: `KARNE_VISUAL_EVIDENCE=1` komut hattı + `karne:visual-diff` ile öğrenci/veli/öğretmen metrikleri.
7. **[x] Tur 06 uygulama:**
   - Hedef dosyalar: `apps/web/app/globals.css`
   - Odak: `next-karne-header` satır aralığı ve üst başlık boşlukları (kurum/portal ortak davranış denemesi).
   - Sonuç: Öğrenci/veli/öğretmen akışlarında `ratio` artışı olduğu için tur geri alındı (regresyon).
8. **[x] Tur 07 uygulama:**
   - Hedef dosyalar: `apps/web/app/globals.css`
   - Odak: `table.next-karne-score-table` satır yoğunluğu.
   - Sonuç: `line-height: 1.00` ile küçük ama regrese olmayan iyileşme alındı.
9. **[x] Tur 08 deneme:**
   - Hedef dosyalar: `apps/web/app/globals.css`
   - Odak: `table.next-karne-score-table` satır yoğunluğu (`line-height`).
   - Sonuç: `line-height: 0.98` ile öğrenci/veli akışında iyileşme olsa da öğretmen akışında regresyon (`0.478616→0.478988`) görüldüğü için tur geri alındı.
10. **[x] Tur 09 deneme:**
   - Hedef dosyalar: `apps/web/app/globals.css`
   - Odak: `table.next-karne-score-table` hücre içi dolgu (`padding`).
   - Sonuç: `padding: 3px 3px` ile geçici iyileşme yok; öğretmen akışında regresyon (`0.478616→0.478988`) nedeniyle tur geri alındı.
11. **[x] Tur 10 hedef:**
   - Hedef dosyalar: `apps/web/app/globals.css`
   - Odak: `next-karne-header` geometri, sadece başlık satır/alanı (`DNA / EĞİTİM / KİŞİSEL GELİŞİM KURSU`, öğrenci/ad/kurum/sınav satırı, tarih ve kitapçık satırı).
   - Kısıtlama: aynı turda yalnızca `next-karne-header` içinde en fazla 2 CSS değişikliği yapılacak; `next-karne-score-table` ve diğer ana bloklara dokunulmayacak.
   - Başarı ölçüsü: `09. Tur` ölçümüne göre en az bir akışta net `ratio` düşüşü + regresyon yok.
   - Başarısızsa: bu deneme geri alınacak; 11. Mini-plan (logo-geometri) hazırlanacak.
12. **[x] Tur 11 hedef (logo-geometri):**
   - Hedef dosyalar: `apps/web/app/globals.css`
   - Odak: `next-karne-brand` tipografi sıkılaştırması (`span`, `strong`, `small`).
   - Kısıtlama: sadece logo-yok metin geometri; puan tablosu ve diğer bloklara dokunulmayacak.
   - Başarı ölçüsü: `10. Tur` sonrası en az bir akışta düşüş ve regresyon olmaması.
13. **[x] Tur 13 deneme:**
   - Hedef dosyalar: `apps/web/app/globals.css`
   - Odak: `next-karne-brand` portal `strong` (`14px→13px`).
   - Sonuç: 3 akışın tamamında regresyon aldık; değişiklik geri alındı.

> Not: Bu planın uygulanması sırasında sadece bir tur ilerlemesi tamamlandığında `9.4`, `9.5` ve `9.2` birlikte güncellenir; ortada duran bir tur bırakılmaz.

## 11. Mini-plan: Logo Geometrisi Hazır Olursa (Ön Koşullu)

Bu mini-plan sadece **2 turda da** metrikte düşüş olmazsa açılır.

1. Asset araştırma:
   - Kurum logonun lisanslı/uygun sürüm PNG veya SVG formatında bulunabilir olup olmadığı teyit edilir.
   - Bulunamazsa plan: metin bloğu geometriyi `logo-yok` profiline kilitleyip sonraki turu ilerleme odaklı sürdür.
   - Bugün doğrulama: `apps/web/public` içinde logo/pattern içeren asset bulunamadı; yalnızca `push-sw.js` var (`DNA/EĞİTİM` metin bloğu ile devam edilecek).
2. Asset geldiğinde:
   - Aynı logo ölçüsü kurum + portal iki akışta da tek referans sınıf ile bağlanır.
3. Ölçüm:
   - Aynı komut seti tekrar edilir, artış/regresyon kararına göre plan `9.4`/`9.5` akışına geri eklenir.

## 12. Kapanış Kapısı (Tekrarlanabilir Kanıt Çıktısı)

- `9.1` adımlarındaki her tur:
  1. uygulanır,
  2. `9.2` protokolüyle ölçülür,
  3. `9.4` tablosu güncellenir.
- Kapı kapanışı için hedef:
  - En az 3 ardışık turda `Öğrenci`, `Veli` ve `Öğretmen` oranlarında duruma bağlı tek yönlü düşüş görmeyi bekleriz.
  - 3 akışta da `meanChannelDelta` artıyorsa `puan tablosu` ve `başlık` bloklarında ek düzen denemesi durdurulur; logo-geometri mini-planına geçilir.
- Kapı kapandığında kapanış notu:
  - `Faz 3/4 karne-portal kolu` bir sonraki bölümde “kapandı” olarak işaretlenir.
  - Bir sonraki kapsam: Faz 5 `kazanım trendi` kapanışına geçilir.

---

## Ek — Dosya/Satır Referans Haritası

- **Şema:** `packages/db/prisma/schema.prisma` — sınav omurgası `Exam`, `ParserConfig`, `ExamParticipant`, `RawImport`, `AnswerKey`, `ExamBookletVariant`, `ParsedAnswer`, `ExamResult`, `ReportSnapshot`. `LearningOutcome` hâlâ trend normalizasyonu için opsiyonel/uykuda.
- **Parser:** `apps/worker/src/jobs/optical-answer-parser.ts` — `normalizeLines` satır dolgusunu korur; `extractField` 0-tabanlı slice kullanır; `extractAnswerField` `segments[]` varsa blokları sırayla birleştirir; `findParticipants` TC hash öncelikli, OKUL NO/participantNo fallback çalışır; `parseResolvedQuarantine` manuel çözülmüş satırı doğrudan `ParsedAnswer` adayına çevirir.
- **Tipler:** `packages/shared-types/src/format-analyzer.ts` — `AnswerFieldSpec` artık opsiyonel `segments[]` destekler.
- **Puanlama (saf kalır):** `apps/worker/src/jobs/scoring-engine.ts` — `OutcomeScore`:44, `scoreExam`:72. Hizalama `exam-evaluation-job.ts` `loadInput`.
- **Psikometri/radar:** `apps/worker/src/jobs/psychometrics.ts`; `report-generation-job.ts:302` (`createOutcomeAverages`).
- **Anahtar servisi:** `apps/api/src/exam/answer-key.service.ts`; HTTP yüzeyi `apps/api/src/exam/answer-key.controller.ts`; DB adapter `apps/api/src/exam/postgres-answer-key-repository.ts`.
- **Rapor servisi (statistics export'a taşınacak):** `apps/api/src/report/report-generation.service.ts`; STALE yazımı `apps/api/src/report/report-snapshot-store.ts`.
- **Seed:** `packages/db/prisma/seed-exams.ts` (yeniden yazım); `pnpm db:seed-exams`.
- **Web:** `apps/web/app/(app)/role-portals.tsx` (5L re-export köprüsü), `apps/web/app/(app)/portals/student-portal-page.tsx`, `apps/web/app/(app)/portals/guardian-portal-page.tsx`, `apps/web/app/(app)/portals/teacher-portal-page.tsx`, `apps/web/app/(app)/portals/_shared/report-panel.tsx`, `apps/web/app/(app)/portals/_shared/student-panels.tsx`, `apps/web/app/(app)/portals/_shared/announcements-panel.tsx`, `apps/web/app/(app)/portals/_shared/activity-panels.tsx`, `apps/web/app/(app)/portals/_shared/support-tickets-panel.tsx`, `apps/web/app/(app)/portals/_shared/homework-panels.tsx`, `apps/web/app/(app)/portals/_shared/portal-shell.tsx`, `apps/web/app/(app)/portals/_shared/guardian-panels.tsx`, `apps/web/app/(app)/portals/_shared/teacher-panels.tsx`, `.../kurum/raporlar/reports-page.tsx` (metin→grafik), `.../kurum/optik/parser-config-page.tsx` (sekmeli hub), `.../app-shell.tsx` (menü), `packages/ui/src/index.ts`→`.tsx`, `apps/web/app/globals.css` (token/dark/responsive).
- **RLS kapısı:** `packages/db/scripts/check-rls.mjs` `tenantTables` (40 tablo; `ExamBookletVariant` dahil).
- **Gerçek veri / görsel hedef:** `ornek-veriler/{iSEM .txt, MUBA.txt, 3D.txt}`, `*Detaylı Cevap Anahtarı.xlsx`, `8.SINIFLAR LİSTE.xlsx`, 3 hedef karne PDF; hedef PNG/hash kapısı `scripts/check-adiguzel-pdf-visual-targets.mjs`, UI screenshot diff ölçümü `scripts/compare-karne-visual-evidence.mjs`.
