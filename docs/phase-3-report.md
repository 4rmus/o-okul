# Faz 3 Durum Raporu

## Tamamlanan repo içi kapsam

- Faz 3 sınav/optik hattı için ilk küçük dilim olarak worker tarafında saf `ScoringEngine`
  fonksiyonu eklendi.
- `scoreExam(answers, answerKey, scoringConfig)` doğru, yanlış, boş, net, ham puan ve standart
  puanı deterministik hesaplar.
- Varsayılan puanlama mevcut basit davranışı korur: ham puan ve standart puan toplam nete eşittir.
  `scoringConfig` içindeki `rawScoreMultiplier`, `standardScoreBase` ve
  `standardScoreMultiplier` verilirse ham/standart puan sınav bazlı deterministik ölçeklenir.
- Branş kırılımı `answerKey` sırasını koruyarak döner.
- Eksik cevaplar boş sayılır; cevap anahtarında olmayan fazla cevaplar parser/validasyon katmanı
  gelene kadar puan hesabını etkilemez.
- `_meta` içinde `answerKeyVersion`, `engineVersion` ve `computedAt` dışarıdan gelen config
  değerleriyle döner; fonksiyon kendi içinde zaman üretmez.
- `exam-evaluation` worker job işlemcisi eklendi; job adı ve tenant payload doğrulanıyor, ardından
  tenant job context içinde adapter'dan skor girdisi yüklenip `ScoringEngine` çalıştırılıyor.
- Job payload'ı artık büyük cevap/cevap anahtarı dizilerini taşımaz; `participantId`,
  `rawImportId` ve `answerKeyId` referanslarıyla çalışır.
- Job çıktısı `examId`, `studentId`, `participantId`, `rawImportId`, `answerKeyId`,
  `parserConfigVersion`, `answerKeyVersion`, `engineVersion`, deterministik `resultKey` ve
  hesaplanan skoru taşır.
- Job sonucu `saveResult` adapter sınırına verilir; gerçek DB yazımı ayrı küçük dilimde
  bağlanacak şekilde kapsam dışında bırakıldı.
- Adapter port'u DB I/O için async hale getirildi; `exam-evaluation` producer payload'ı API
  tarafında da `participantId`, `rawImportId` ve `answerKeyId` referanslarını doğrulayarak üretir.
- `resultKey`, master plandaki idempotency kuralına uygun şekilde `participantId`,
  `answerKeyVersion`, `parserConfigVersion` ve `engineVersion` birleşiminden üretilir.
- Faz 3 minimum DB iskeleti eklendi: `RawImport`, `AnswerKey`, `ExamResult`.
- `RawImport`, yüklenen dosya arşivi için `examId`, `fileName`, `s3Key`, `sha256`,
  `parserConfigVersion` ve `metadata` alanlarını taşır.
- `AnswerKey`, sınav bazlı versiyonlu cevap anahtarı ve opsiyonel `scoringConfig` bilgisini taşır.
- `ExamResult`, `studentId`, `participantId`, `rawImportId`, `answerKeyId`, versiyon alanları,
  `resultKey`, `scoreData` ve `computedAt` bilgisini taşır.
- `ExamResult` idempotency zemini DB'de `tenantId + participantId + answerKeyVersion +
  parserConfigVersion + engineVersion` unique constraint'iyle başlatıldı.
- `ExamResult` için `student`, `rawImport` ve `answerKey` ilişkileri tenant'lı composite foreign key
  ile kuruldu; başka tenant'a ait referanslar DB seviyesinde reddedilecek şekilde tasarlandı.
- Faz 3 sınav veri zemini `Exam`, `ParserConfig`, `ExamParticipant`, `ImportQuarantine` ve
  `ReportSnapshot` modelleriyle genişletildi.
- `RawImport`, `AnswerKey`, `ExamParticipant`, `ExamResult`, `ImportQuarantine` ve
  `ReportSnapshot` ilişkileri `Exam` kaydına tenant'lı composite foreign key ile bağlandı.
- Parser + matching sonrası scoring'e girecek kalıcı cevap paketi için `ParsedAnswer` modeli
  eklendi; `RawImport`, `ExamParticipant` ve `parserConfigVersion` kombinasyonu tenant içinde
  tekil tutulur.
- `ParsedAnswer`, aynı tenant içindeki yanlış sınav bağını da engellemek için `RawImport` ve
  `ExamParticipant` kayıtlarına `tenantId + examId + id` composite foreign key ile bağlandı.
- `ExamResult`, `participantId` alanını artık `ExamParticipant` kaydına tenant'lı composite foreign
  key ile bağlar; worker'ın ürettiği katılımcı referansı DB seviyesinde doğrulanabilir hale geldi.
- `packages/db` içinde context'i dışarıdan alan küçük `withTenantDb` helper'ı başlatıldı; worker
  DB adapter'ı geldiğinde tenant setting/transaction davranışı buradan paylaşılabilecek.
- Worker tarafında ilk gerçek DB-backed `PostgresExamEvaluationAdapter` eklendi; `ParsedAnswer`,
  `ExamParticipant`, `RawImport` ve `AnswerKey` kayıtlarını aynı sınav üzerinde join ederek skor
  girdisini yükler.
- Adapter, `ParsedAnswer.answers` ve `AnswerKey.keyData` JSON şekillerini scoring'e göndermeden
  önce doğrular; hatalı girdi `EXAM_EVALUATION_INPUT_INVALID` ile reddedilir.
- Adapter, `ExamResult` yazımında `tenantId + resultKey` üzerinden idempotent `ON CONFLICT DO
  NOTHING` kullanır; kayıt zaten varsa mevcut sonucu okuyup döner.
- Worker composition katmanı `createExamEvaluationProcessor` ile eklendi; `@uzman-hocam/db`
  içindeki `createTenantPgPool` factory'si üzerinden `PostgresExamEvaluationAdapter` job
  processor'a bağlanır.
- BullMQ tabanlı `exam-evaluation` worker daemon iskeleti eklendi; BullMQ job'u mevcut
  `QueueJob` imzasına çevrilip `createExamEvaluationProcessor` üzerinden işlenir.
- Worker daemon `REDIS_URL` ile Redis bağlantısını, `QUEUE_PREFIX` ile BullMQ prefix değerini
  kullanır; Docker worker image CMD'i artık `apps/worker/dist/main.js` çalıştırır.
- API tarafında `createBullTenantQueueProducer` eklendi; `createTenantQueueJob` çıktısını gerçek
  BullMQ `Queue.add(name, payload, options)` çağrısına bağlar ve queue client'larını yeniden kullanır.
- API Redis URL parser'ı worker ile aynı temel sözleşmeye getirildi: `redis/rediss`, kullanıcı,
  parola, DB index'i ve TLS protokolü okunur.
- Root seviyesinde `pnpm queue:smoke` komutu eklendi; build edilmiş API producer ve worker consumer
  export'larını aynı canlı Redis üzerinde çalıştırarak `exam-evaluation` taşıma sözleşmesini DB'ye
  gitmeden doğrular.
- Gerçek TXT/DAT örneği gelmeden önce format riskini azaltmak için saf `FormatAnalyzerService`
  eklendi; TAB/PIPE/COMMA/FIXED ayrımı, header tahmini, öğrenci no/kitapçık/cevap alanı önerisi,
  güven seviyesi ve uyarı üretir.
- `FormatAnalyzerService` DB'ye `ParserConfig` yazmaz ve yeni queue açmaz; öneri yetkili onayıyla
  kalıcı kayda dönecek sonraki akış için hazırlık seviyesinde tutuldu.
- Onaylanmış format önerisini `ParserConfig` tablosuna yazmak için `PostgresParserConfigAdapter`
  eklendi; kayıt yalnızca explicit `saveApproved` çağrısıyla yapılır, status `APPROVED` yazılır ve
  `tenantId + examId + version` conflict'i domain hatasıyla reddedilir.
- Onaylı parser config ve sınav katılımcı listesiyle ham optik satırları ayrıştıran saf
  `OpticalAnswerParser` eklendi; eşleşen satırlar `ParsedAnswer` için `MATCHED` adayına,
  eşleşmeyen/hatalı satırlar `ImportQuarantine` adayına ayrılır.
- Parser `participantId` değerini ham dosyadan almaz; ham satırdaki öğrenci/katılımcı no, dışarıdan
  verilen `ExamParticipant` listesiyle eşleşirse `ExamParticipant.id` kullanılır.
- `OpticalAnswerParser` sonucunu DB'ye yazmak için `PostgresOpticalParseAdapter` eklendi; `MATCHED`
  adayları `ParsedAnswer`, unmatched adayları `ImportQuarantine` olarak tenant transaction içinde
  kaydedilir.
- Quarantine kaydında aynı `tenantId + rawImportId + rowNumber` conflict'i varsa yalnız `OPEN`
  kayıtlar güncellenir; daha önce manuel çözülmüş quarantine kayıtları adapter tarafından ezilmez.
- Raw import parse zincirinin DB okuma tarafı için `PostgresOpticalParseInputAdapter` eklendi;
  `RawImport + APPROVED ParserConfig` ve `REGISTERED/ATTENDED` katılımcıları `Student.studentNo`
  ile birlikte yükler, storage/S3 okuma kapsam dışında kalır.
- `OpticalParseWorkflow` eklendi; `PostgresOpticalParseInputAdapter`, storage içerik okuyucu port'u,
  `OpticalAnswerParser` ve `PostgresOpticalParseAdapter` zincirini tek servis olarak orkestre eder.
- Workflow gerçek S3 client, queue worker, retry/audit ve RawImport status güncellemesi içermez;
  bu sorumluluklar ayrı adapter/job dilimine bırakıldı.
- `S3RawImportContentReader` eklendi; `RawImport.s3Key` içeriğini S3/MinIO `GetObject` çağrısıyla
  okur ve AWS SDK body çıktısını `Buffer` olarak workflow port'una verir.
- Worker docker env sözleşmesi phase-0 S3/MinIO değişkenleriyle hizalandı.
- `excel-import` job processor sınırı async hale getirildi ve `createOpticalParseProcessor`
  eklendi; job payload'ındaki `entityId`, `OpticalParseWorkflow` için `rawImportId` olarak
  kullanılır.
- `createOpticalParseProcessor`, `PostgresOpticalParseInputAdapter`, `S3RawImportContentReader` ve
  `PostgresOpticalParseAdapter` zincirini kurar; `excel-import` BullMQ consumer wiring'i worker
  daemon'a bağlandı.
- `excel-import` BullMQ consumer'ı eklendi; BullMQ `Job.id/name/data` alanları mevcut `QueueJob`
  imzasına çevrilip `createOpticalParseProcessor` üzerinden çalıştırılır.
- Worker daemon artık `exam-evaluation` ve `excel-import` consumer'larını aynı Redis connection ve
  `QUEUE_PREFIX` ayarıyla başlatır; SIGINT/SIGTERM kapanışında iki worker birlikte kapatılır.
- Canlı BullMQ smoke script'i fake processor kullanarak hem `exam-evaluation` hem `excel-import`
  queue üret/consume sözleşmesini doğrulayacak şekilde genişletildi.
- API tarafında `RawImportQueueService` eklendi; var olan `RawImport` kaydının `rawImportId` ve
  `sha256` bilgisini `excel-import` queue payload'ına çevirir.
- `RawImportQueueService` gerçek upload zincirinde `RawImportUploadService` tarafından kullanılır;
  arşiv, DB kayıt ve queue enqueue adımları endpoint akışına bağlandı.
- API tarafında portlu `RawImportUploadService` eklendi; ham dosya byte'larından `sha256` hesaplar,
  deterministik `s3Key` üretir, storage/repository port'larına yazar ve ardından
  `RawImportQueueService` benzeri enqueue port'u ile parse job oluşturur.
- Upload service `POST /exams/:examId/raw-imports` HTTP route'u üzerinden S3/DB adapter ve queue
  producer zincirine bağlandı; bu turda body sözleşmesi `fileBase64` olarak sınırlandı.
- API tarafında `S3RawImportArchiveStore` eklendi; S3/MinIO `PutObject` ile RawImport arşiv
  içeriğini `S3_BUCKET` altına yazar.
- API tarafında `PostgresRawImportRepository` eklendi; `RawImport` kaydını tenant-aware
  `withTenantQuery` içinde insert eder ve `tenantId + examId + sha256 + parserConfigVersion`
  conflict'inde mevcut arşiv kaydını döndürür.
- S3/DB adapter'ları `AppModule` içinde lazy/env-safe provider olarak bağlandı.
- `RawImport` upload HTTP endpoint'i eklendi: `POST /exams/:examId/raw-imports` body içindeki
  `fileBase64` değerini ham byte'a çevirip `RawImportUploadService` zincirine bağlar.
- `AppModule`, upload endpoint'i için S3 archive store, Postgres repository ve queue service
  provider'larını bağlar; S3 env'i test ortamında uygulama boot'unu kırmasın diye archive store env
  okuması `put` çağrısına ertelendi.
- Root seviyesinde `pnpm raw-import:smoke` komutu eklendi; script gerçek API'yi açar, canlı DB'de
  smoke sınavı seed eder, MinIO/S3 bucket'ını hazırlar, upload endpoint'ine istek atar, S3 obje
  varlığını, `RawImport` DB satırını ve `excel-import` queue payload'ını doğrular.
- Raw import canlı smoke öncesi repository insert'i uygulama tarafında `id` üretecek şekilde
  sıkılaştırıldı; mevcut migration'da `RawImport.id` için DB default olmadığı için canlı Postgres'te
  `NULL id` hatasına düşme riski kapatıldı.
- Raw import canlı smoke script'i lokal `.env.example` ile uyumlu MinIO credential defaultlarını
  kullanır; yalnızca tek credential verilmişse açık hata verir.
- `ParserConfig` onay endpoint'i eklendi: `POST /exams/:examId/parser-configs/approvals` yalnız
  `TENANT_ADMIN` rolüyle çalışır, `tenantId` değerini body'den değil request context'ten alır ve
  onaylanan öneriyi `APPROVED` parser config kaydına çevirir.
- Parser config onay akışı queue tetiklemez ve otomatik analiz yapmaz; bu endpoint yalnız yetkili
  kullanıcının onayladığı `FormatAnalyzerService` önerisini kalıcı kayda dönüştürür.
- `FormatAnalyzerService` ortak paket yüzeyine taşındı; worker eski import yolunu re-export ile
  korur, API ise worker paketine bağlanmadan aynı analyzer sözleşmesini kullanır.
- Parser config öneri endpoint'i eklendi: `POST /exams/:examId/parser-configs/suggestions` yalnız
  `TENANT_ADMIN` rolüyle çalışır, `sampleText` veya `fileBase64` girdisinden yan etkisiz
  `ParserConfigSuggestion` üretir ve DB/queue yazımı yapmaz.
- Web paneline küçük optik format akışı eklendi; yönetici örnek metinden veya seçtiği TXT/DAT
  dosyasından parser önerisi alabilir, ayraç/başlık/güven/soru tahmini özetini görebilir ve
  öneriyi sürüm adıyla onay endpoint'ine gönderebilir.
- API ve worker tarafındaki parser config repository/adapter insert'leri uygulama tarafında `id`
  üretecek şekilde hizalandı; mevcut migration'da `ParserConfig.id` için DB default olmadığı için
  canlı Postgres'te `NULL id` hatası riski kapatıldı.
- Yeni Faz 3 tabloları RLS statik kontrol listesine ve canlı RLS fixture'larına eklendi; statik RLS
  kontrolü 21 tenant tablosunu doğruluyor.
- Lokal Colima/Postgres ortamında DB migration ve seed tamamlandı; canlı RLS kontrolü yeni Faz 3
  tablolarında tenant okuma/yazma izolasyonunu doğruluyor.
- Redis üzerinde `exam-evaluation` ve `excel-import` BullMQ hattı canlı smoke ile doğrulandı.
- Raw import canlı smoke geçti; API upload endpoint'i dosyayı MinIO/S3'e arşivledi, `RawImport`
  satırını Postgres'e yazdı ve `excel-import` job payload'ını Redis kuyruğuna aldı.
- API health hata testleri gerçek DB/Redis durumuna bağlı kalmayacak şekilde izole edildi; canlı
  servisler açıkken de test paketi aynı sonucu veriyor.

## Çalıştırılan doğrulamalar

- `pnpm --filter @uzman-hocam/worker test -- scoring-engine`
- `pnpm --filter @uzman-hocam/worker test -- exam-evaluation scoring-engine`
- `pnpm --filter @uzman-hocam/worker typecheck`
- `pnpm --filter @uzman-hocam/api typecheck`
- `pnpm --filter @uzman-hocam/db lint`
- `pnpm --filter @uzman-hocam/db db:rls:check`
- `node --check packages/db/scripts/check-rls-live.mjs`
- `pnpm --filter @uzman-hocam/api test -- queue/job-producer`
- `pnpm --filter @uzman-hocam/db typecheck`
- `pnpm --filter @uzman-hocam/db db:rls:check`
- `pnpm --filter @uzman-hocam/worker test -- postgres-exam-evaluation exam-evaluation`
- `pnpm --filter @uzman-hocam/worker test -- exam-evaluation-processor postgres-exam-evaluation`
- `pnpm --filter @uzman-hocam/worker test -- bullmq-worker`
- `pnpm --filter @uzman-hocam/worker build`
- `pnpm --filter @uzman-hocam/api test -- queue/bullmq-producer config/env health`
- `pnpm --filter @uzman-hocam/api build`
- `pnpm --filter @uzman-hocam/api test -- raw-import-queue job-producer bullmq-producer`
- `pnpm --filter @uzman-hocam/api test -- raw-import-upload raw-import-queue`
- `pnpm --filter @uzman-hocam/api test -- s3-raw-import-archive-store postgres-raw-import-repository raw-import-upload`
- `pnpm --filter @uzman-hocam/api test -- raw-import.controller raw-import-upload`
- `pnpm --filter @uzman-hocam/api test -- postgres-raw-import-repository raw-import.controller raw-import-upload`
- `pnpm --filter @uzman-hocam/api test -- parser-config postgres-parser-config`
- `pnpm --filter @uzman-hocam/shared-types typecheck`
- `pnpm --filter @uzman-hocam/shared-types build`
- `pnpm --filter @uzman-hocam/web typecheck`
- `pnpm --filter @uzman-hocam/web build`
- `pnpm --filter @uzman-hocam/web test:e2e`
- `pnpm --filter @uzman-hocam/worker test`
- `pnpm --filter @uzman-hocam/api test`
- `node --check scripts/smoke-bullmq-live.mjs`
- `node --check scripts/smoke-raw-import-upload-live.mjs`
- `pnpm queue:smoke` Redis çalışırken tekrar çalıştırıldı ve `exam-evaluation` ile `excel-import`
  queue'larının producer/consumer hattı geçti.
- `pnpm raw-import:smoke` Postgres/Redis/MinIO çalışırken tekrar çalıştırıldı; upload endpoint'i,
  S3 archive, `RawImport` insert'i ve `excel-import` enqueue zinciri geçti.
- `pnpm --filter @uzman-hocam/api test -- health api-error raw-import.controller raw-import-upload
  raw-import-queue bullmq-producer` ve `pnpm --filter @uzman-hocam/api typecheck` canlı servisler
  açıkken tekrar çalıştırıldı ve geçti.
- `pnpm --filter @uzman-hocam/worker test -- format-analyzer-service`
- `pnpm --filter @uzman-hocam/worker test -- postgres-parser-config-adapter`
- `pnpm --filter @uzman-hocam/worker test -- optical-answer-parser`
- `pnpm --filter @uzman-hocam/worker test -- postgres-optical-parse-adapter optical-answer-parser`
- `pnpm --filter @uzman-hocam/worker test -- postgres-optical-parse-input-adapter`
- `pnpm --filter @uzman-hocam/worker test -- optical-parse-workflow`
- `pnpm --filter @uzman-hocam/worker test -- s3-raw-import-content-reader`
- `pnpm --filter @uzman-hocam/worker test -- excel-import-job optical-parse-processor`
- `pnpm --filter @uzman-hocam/worker test -- bullmq-worker`
- `pnpm --filter @uzman-hocam/worker test -- postgres-parser-config-adapter`
- `pnpm --filter @uzman-hocam/worker test -- format-analyzer-service optical-answer-parser postgres-parser-config-adapter`
- `pnpm --filter @uzman-hocam/worker typecheck`
- `pnpm --filter @uzman-hocam/worker build`
- `pnpm docker:check`
- `pnpm run ci`
- `pnpm run ci` tekrar çalıştırıldı ve geçti.
- `pnpm run ci` ParserConfig approval diliminden sonra tekrar çalıştırıldı ve geçti.
- `pnpm run ci` ParserConfig suggestion diliminden sonra tekrar çalıştırıldı ve geçti.
- `pnpm run ci` optik format web paneli diliminden sonra tekrar çalıştırıldı ve geçti.
- `pnpm --filter @uzman-hocam/web typecheck`, `pnpm --filter @uzman-hocam/web test:e2e`,
  `pnpm --filter @uzman-hocam/web build` ve `pnpm run ci` optik format dosya seçme diliminden sonra
  tekrar çalıştırıldı ve geçti.
- In-app Browser doğrulaması denenmiş olsa da bu oturumda `iab` tarayıcısı kullanılamadığı için
  görsel kontrol Playwright e2e ve production build kanıtıyla sınırlı kaldı.
- Lokal Postgres/Redis/MinIO servisleri Colima üzerinde healthy duruma getirildi; `pnpm db:migrate`,
  `pnpm db:seed`, `pnpm --filter @uzman-hocam/db exec prisma migrate status --config prisma.config.ts`,
  `pnpm db:rls:check:live`, `pnpm --filter @uzman-hocam/db typecheck` ve
  `pnpm --filter @uzman-hocam/db test` çalıştırıldı ve geçti.

## Subagent notu

Subagent ScoringEngine'in saf fonksiyon olarak kalmasını, `computedAt` değerinin fonksiyon içinde
üretilmemesini ve ilk dilimin worker tarafında tutulmasını önerdi. İlk taslak API altından geri
alındı; motor `apps/worker/src/jobs/scoring-engine.ts` altına taşındı.

Sonraki subagent, `exam-evaluation` job sonucunda `participantId + answerKeyVersion +
parserConfigVersion + engineVersion` birleşiminden deterministik `resultKey` üretilmesini önerdi.
Bu turda job işlemcisi ve testleri eklendi; gerçek DB unique constraint koruması sonraki veri modeli
diliminde kalıyor.

Sonraki subagent, minimum DB iskeleti için `RawImport`, `AnswerKey`, `ExamResult` setini onayladı ve
`ExamResult` ilişkilerinde başka tenant'a ait `RawImport`/`AnswerKey` referansı riskini işaret etti.
Bu turda composite tenant foreign key'ler ve canlı RLS negatif test taslağı eklendi.

Sonraki subagent, `exam-evaluation` job payload'ından `answers`, `answerKey` ve `scoringConfig`
alanlarının çıkarılıp `RawImport`/`AnswerKey` referanslarına inilmesini önerdi. Bu turda worker
içinde DB bağımlılığı eklemeden `loadInput`/`saveResult` adapter sınırı kuruldu.

Sonraki subagent, DB-backed adapter'a geçmeden önce `Exam`, `ExamParticipant`, `ParserConfig`,
`ImportQuarantine` ve `ReportSnapshot` modellerinin eksik olduğunu işaret etti. Bu turda bu iskelet
eklendi; status alanları domain kararı dondurmamak için şimdilik `String` bırakıldı.

Sonraki subagent, gerçek DB-backed adapter'a geçmeden önce adapter port'unun async olması ve
tenant-aware DB helper'ın paket seviyesinde paylaşılması gerektiğini belirtti. Ayrıca normalize
edilmiş parsed answers zemini olmadığı için cevapları sessizce `RawImport.metadata` içine gömmenin
riskli olacağını işaret etti.

Sonraki subagent, parsed optik cevapların kalıcı zemini için en küçük modelin `ParsedAnswer`
olmasını önerdi. Bu turda model, migration, RLS listesi ve canlı fixture taslağı eklendi; soru
başına normalize tablo, gerçek parser ve quarantine çözüm ekranı kapsam dışında bırakıldı.

Sonraki subagent, gerçek DB-backed adapter'da aynı sınav üzerinde join yapılmasını, JSON şeklinin
doğrulanmasını ve `tenantId + resultKey` conflict davranışının bilinçli seçilmesini önerdi. Bu turda
adapter ve odak testleri eklendi; worker'a doğrudan `pg` veya Prisma bağlanmadı.

Sonraki küçük dilimde worker composition eklendi: `pg` pool oluşturma sorumluluğu `packages/db`
factory'sinde kaldı, worker ise `createExamEvaluationProcessor` ile adapter'ı job işlemcisine bağlar.

Sonraki subagent, BullMQ consumer için en küçük doğru sınırın BullMQ `Job.id/name/data` alanlarını
mevcut `QueueJob.id/name/payload` şekline çevirmek olduğunu belirtti. Ayrıca `QUEUE_PREFIX`
sözleşmesini ve Docker worker placeholder'ını işaret etti; bu turda daemon giriş noktası ve Redis'e
bağlanmadan çalışan adapter testleri eklendi.

Sonraki küçük dilimde API producer gerçek BullMQ enqueue sınırına bağlandı. Subagent'in işaret
ettiği risk nedeniyle `ProducedJob` nesnesinin tamamı data olarak verilmedi; sadece `payload`
aktarılıyor, `name` ve `options` BullMQ çağrısının kendi alanlarına gidiyor.

Sonraki subagent, canlı Redis smoke'un paket içi Vitest yerine root script olması gerektiğini ve DB
bağımlılığını fake processor ile dışarıda bırakmanın bu aşama için doğru transport kanıtı olduğunu
belirtti. Bu turda `scripts/smoke-bullmq-live.mjs` eklendi; yerel ortamda Docker/Redis olmadığı için
komut canlı koşamadı.

Sonraki subagent, gerçek TXT/DAT örneği yokken tam parser yerine `ParserConfig` önerisi üreten saf
`FormatAnalyzerService` dilimini önerdi. Bu turda servis worker altında eklendi; semicolon ayracı
master plan enum'unda olmadığı için otomatik desteklenmedi, açık uyarı olarak bırakıldı.

Sonraki subagent, `ParserConfig` persist sınırının otomatik analiz içinde değil explicit onay
adapter'ında kalmasını onayladı. Bu turda `PostgresParserConfigAdapter` eklendi; version üretme,
API/UI approval flow ve eski config update/soft-delete kapsam dışı bırakıldı.

Sonraki subagent, `ParsedAnswer.participantId` zorunlu FK olduğu için saf parser'ın ham dosyadan
participant id üretmemesi gerektiğini belirtti. Bu turda `OpticalAnswerParser` matched/unmatched
ayrımıyla eklendi; DB/S3, queue job, manuel quarantine ekranı ve participant state güncelleme kapsam
dışında kaldı.

Sonraki küçük dilimde `PostgresOpticalParseAdapter` eklendi. Subagent denemesi zamanında dönmediği
için kapsam mevcut şema ve önceki adapter desenlerinden ana hatta doğrulandı; quarantine conflict
davranışı manuel çözümü koruyacak şekilde `status = 'OPEN'` filtresiyle sınırlandı.

Sonraki subagent, raw import parse input yüklemesinin storage/S3 işiyle karıştırılmaması gerektiğini
ve sadece `s3Key` + DB metadata döndürmesini önerdi. Bu turda `PostgresOpticalParseInputAdapter`
eklendi; participant sorgusu `REGISTERED/ATTENDED` ile sınırlandı ve parser field mapping şekli
daha sıkı doğrulandı.

Sonraki subagent, parse workflow'unun input loader, content reader port'u, parser ve saver
zincirinden ibaret kalmasını onayladı. Bu turda `OpticalParseWorkflow` eklendi; parser veya content
okuma hatasında save adapter'ın çağrılmadığı testle doğrulandı.

Sonraki subagent, S3 env sözleşmesinin `.env.example` ve phase-0 checklist'te bulunduğunu,
worker'ın bu env'leri compose içinde alması gerektiğini ve unit testte fake S3 client'ın yeterli
olduğunu doğruladı. Bu turda S3/MinIO storage adapter'ı eklendi; adapter yalnızca `s3Key` içeriğini
okur, bucket/client/env üretimi adapter sınırında kalır. Queue processor wiring'i sonraki dilimde
`createOpticalParseProcessor` ve `excel-import` worker bağlantısıyla tamamlandı.

Sonraki subagent, `processExcelImportJob` sınırının async hale getirilmesini ve workflow composition
katmanının eklenmesini önerdi; BullMQ daemon/main wiring'inin ayrı dilimde kalmasını özellikle
işaret etti. Bu turda `createOpticalParseProcessor` eklendi ve `excel-import` job payload'ı
`OpticalParseWorkflow` girdisine bağlandı.

Sonraki subagent, `excel-import` BullMQ consumer'ının mevcut `bullmq-worker.ts` içinde aynı desenle
eklenmesini, `main.ts` içinde iki worker'ın array olarak tutulmasını ve canlı smoke script'in gerçek
DB/S3 parse çalıştırmadan fake processor ile iki queue'yu doğrulamasını önerdi. Bu turda consumer,
daemon wiring ve smoke genişletmesi eklendi.

Sonraki subagent, gerçek RawImport upload endpoint'inin S3 upload, `RawImport` DB insert,
multipart/body sözleşmesi ve RBAC route kararları istediğini; bu yüzden bu turda sadece DB/S3'süz
API service/producer adapter eklenmesini önerdi. Bu turda `RawImportQueueService` eklendi ve
`rawImportId -> entityId`, `sha256 -> contentHash`, `queueName -> excel-import` eşlemesi testle
pinlendi; sonraki dilimlerde arşiv, DB repository ve HTTP route bağlandı.

Sonraki subagent, gerçek endpoint açmadan önce upload hazırlığının portlu servis olarak kalmasını
ve service girdisinin endpoint'e özgü `fileBase64` yerine ham `bytes` olmasını önerdi. Bu turda
`RawImportUploadService` eklendi; `sha256` ham byte içeriğinden hesaplanıyor, `s3Key`
`raw-imports/{tenantId}/{examId}/{parserConfigVersion}/{sha256}/{fileName}` formatında üretiliyor.

Sonraki subagent, gerçek adapter diliminde S3 `PutObject` ve Postgres `RawImport` repository
dosyalarının ayrı eklenmesini, API package'a `@aws-sdk/client-s3` bağımlılığının eklenmesini ve
AppModule wiring'in endpoint turuna bırakılmasını önerdi. Bu turda `S3RawImportArchiveStore` ve
`PostgresRawImportRepository` eklendi; endpoint turunda `AppModule` provider bağlantısı tamamlandı.

Sonraki küçük dilimde `RawImport` upload endpoint'i eklendi. Endpoint, mevcut API'nin base64 body
stilini izler ama servis sınırına yalnız ham byte aktarır; e2e testte S3/DB/queue provider'ları fake
ile override edilerek controller wiring'i Redis, Postgres ve MinIO olmadan doğrulandı.

Sonraki subagent, canlı smoke script'i servisler açıkken koştuğunda `RawImport.id` DB default'u
olmadığı için repository insert'inin kırılabileceğini işaret etti. Bu turda repository uygulama
tarafında `randomUUID()` ile id yazar hale getirildi; ayrıca RLS seed/doğrulama sorguları tek
transaction içinde tutuldu ve MinIO credential varsayılanları daha açık hale getirildi.

Sonraki subagent, ParserConfig onay endpoint'inin analiz yapmaması gerektiğini; `tenantId` bilgisini
body'den değil request context'ten almasını, `TENANT_ADMIN` ile sınırlanmasını ve version conflict'i
HTTP 409'a çevirmesini önerdi. Bu turda `POST /exams/:examId/parser-configs/approvals` eklendi ve
teacher/auth/eksik öneri/conflict durumları e2e testle doğrulandı.

Sonraki subagent, `FormatAnalyzerService` davranışının API-local kopya veya worker import'u yerine
ortak paket üzerinden paylaşılmasını önerdi. Bu turda analyzer `@uzman-hocam/shared-types`
yüzeyine taşındı, worker re-export ile geriye uyumlu bırakıldı ve
`POST /exams/:examId/parser-configs/suggestions` endpoint'i sample metin/base64 girdisiyle yan
etkisiz öneri üretir hale getirildi.

Sonraki subagent, web tarafında tam sınav yönetimi ekranına büyümeden yalnız örnek metinden öneri
alma ve sürüm adıyla onaylama panelinin yeterli olduğunu belirtti. Bu turda mevcut tek dosyalı web
deseni korunarak `Optik Format` ve `Parser Onayı` panelleri eklendi; Playwright testi öneri ve onay
POST gövdelerini doğrulayacak şekilde genişletildi.

Sonraki subagent denemesi kullanım kotasına takıldığı için ana agent yerel incelemeyle ilerledi.
Backend suggestion endpoint'i zaten `fileBase64` kabul ettiği için web paneline yalnız dosya seçme ve
base64 gönderme desteği eklendi; Playwright testi gerçek `File` girdisiyle `fileBase64` gövdesini
doğruluyor.

Gerçek cihaz çıktısı gelmeden parser sözleşmesini daha somut tutmak için sentetik pilot fixture
eklendi: `optical-pilot-tab.txt`, `optical-pilot-fixed.dat` ve `optical-pilot-answer-key.json`.
`optical-pilot-fixture.test.ts`, bu TXT/DAT örneklerini `FormatAnalyzerService` ile analiz eder,
`OpticalAnswerParser` ile MATCHED/quarantine adaylarına ayırır ve sonuçları `ScoringEngine` ile
puanlar.

## Kalan işler

- Gerçek cihazdan alınmış TXT/DAT örneği ve cevap anahtarı formatı geldiğinde sentetik pilot
  fixture'ın yanında gerçek cihaz fixture'ı eklemek; optik format panelinde dosya yükleme sonucunu
  gerçek çıktı ile doğrulamak, kolon mapping düzenleme ve cevap anahtarı sürümleme akışlarını
  eklemek.
