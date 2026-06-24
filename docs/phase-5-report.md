# Faz 5 Durum Raporu

## Tamamlanan repo içi kapsam

- Faz 5 mesaj/duyuru kapsamı için ilk küçük dilim olarak okul/öğretmen duyuru API'si başlatıldı.
- `GET /announcements` endpoint'i eklendi; `TENANT_ADMIN` ve `TEACHER` rolleri yalnız kendi
  tenant duyurularını okuyabilir.
- `GET /announcements/:id` endpoint'i tenant dışı duyuruları `403` ile reddeder.
- `POST /announcements` endpoint'i eklendi; yalnız `TENANT_ADMIN` rolü tenant içinde duyuru
  oluşturabilir.
- Duyuru oluşturma `title`, `body` ve `audience` doğrulaması yapar; `audience` şimdilik `SCHOOL`
  veya `TEACHERS` olabilir.
- Duyuru için `Announcement` Prisma modeli ve migration eklendi.
- `Announcement` tablosu tenant foreign key, tenant/audience indexleri ve RLS policy ile korunur.
- RLS statik kontrolü tüm migration'ları okuyacak şekilde genişletildi; duyuru tablosu dahil 23
  tenant tablosunu ve app rolü yetkilerini doğrular.
- `ANNOUNCEMENT_STORE=postgres` ile seçilen `PostgresAnnouncementStore` eklendi; listeleme,
  tekil okuma ve oluşturma `withTenantQuery` üzerinden tenant setting'leriyle çalışır.
- Web panelinde duyuru listeleme ve duyuru yayınlama görünümü eklendi; `GET /announcements` ve
  `POST /announcements` akışı mevcut oturum token'ı ile kullanılır.
- Web E2E senaryosu duyuru listesini, hedef kitle seçimini ve yeni duyurunun listede görünmesini
  doğrular.
- Mobil duyuru tablosu dar ekranda hedef kitle ve tarih metinleri taşmayacak şekilde doğrulandı.
- Mesaj şablonları için ilk API dilimi eklendi: `GET /message-templates`,
  `GET /message-templates/:id`, `POST /message-templates`, `PATCH /message-templates/:id` ve
  `DELETE /message-templates/:id`.
- Mesaj şablonları şimdilik yalnız `SMS` kanalını kabul eder; sağlayıcı seçimi ve gerçek gönderim
  bu dilimin kapsamı dışında bırakıldı.
- `MessageTemplate` Prisma modeli ve migration eklendi; tablo tenant foreign key, indexler,
  RLS policy ve app rolü yetkisiyle korunur.
- `MESSAGE_TEMPLATE_STORE=postgres` ile seçilen `PostgresMessageTemplateStore` eklendi; listeleme,
  tekil okuma, oluşturma, güncelleme ve soft-delete `withTenantQuery` üzerinden tenant
  setting'leriyle çalışır.
- SMS batch kuyruğu için ilk API/worker dilimi eklendi: `POST /sms-batches` tenant içindeki SMS
  şablonunu ve alıcı listesini `sms-batch` kuyruğuna bağlar.
- `sms-batch` job payload'ı şablon id, mesaj gövdesi ve alıcıları taşır; job id
  `templateId + contentHash` ile idempotent üretilir.
- Worker `sms-batch` kuyruğunu dinleyecek şekilde genişletildi; işleyici mesajları
  `@o-okul/sms-adapter` arayüzüne verir. Gerçek sağlayıcı entegrasyonu yerine bu dilimde
  no-op adapter kullanılır.
- SMS adapter GSM-7 ve Unicode metinler için tekli/çoklu SMS segment hesabı yapar; Türkçe
  GSM-7 dışı karakterler Unicode limitleriyle hesaplanır.
- No-op adapter gönderim sonucuna segment tahminini ekler; worker batch sonucunda toplam
  `billableSegments` değerini üretir.
- SMS batch teslim raporu için `SmsBatchDeliveryReport` tenant tablosu eklendi; `POST /sms-batches`
  aynı `jobId` ile queued rapor kaydı oluşturur ve kurum admin `GET /sms-batches/:jobId` ile
  raporu okur.
- Worker SMS batch sonucunu aynı rapor kaydına `completed/failed`, gönderilen/başarısız adet,
  toplam segment ve sağlayıcı hata kodu ile yazar.
- `POST /sms-batches/recipients/preview` duyuru hedefinden veya sınıf/kampüs/seviye/ders/dönem/
  öğrenci durumu filtresinden `canReceiveSms=true` ve telefonu olan velileri üretir.
- Kurum `/kurum/sablonlar` ekranı seçili SMS şablonundan duyuru hedefi, alıcı filtresi veya manuel alıcı
  listesiyle batch gönderim başlatır; mesaj önizlemesini ve `GET /sms-batches/:jobId`
  teslim raporunu aynı ekranda gösterir.
- Kurum `/kurum/duyurular` ekranı veli, öğrenci veya tüm okul hedefli duyurudan seçili SMS
  şablonuyla batch gönderim başlatır ve aynı panelde teslim raporunu gösterir.
- E-posta/push gibi SMS dışı duyuru bildirimleri için `AnnouncementDeliveryReport` tenant tablosu
  eklendi; EMAIL/PUSH kanalında alıcı, teslim, başarısız adet, durum ve sağlayıcı hata kodu
  tutulur. Kurum admin `GET /announcements/:id/delivery-reports` ile raporu okur; öğretmen
  erişimi 403 olur.
- `announcement-delivery` queue job sözleşmesi ve worker processor eklendi; worker EMAIL/PUSH
  teslim özetini `AnnouncementDeliveryReport` kaydına upsert eder.
- Kurum admin `POST /announcements/:id/delivery-results` ile EMAIL/PUSH sağlayıcı teslim sonucunu
  doğrulanmış sayılarla `announcement-delivery` kuyruğuna bağlar.
- E-posta/push sağlayıcı sözleşmesi için `@o-okul/notification-adapter` eklendi; lokal no-op,
  üretimde no-op engeli ve Bearer token destekli HTTP sağlayıcı yolu test edildi.
- `pnpm notification:smoke` eklendi; e-posta ve push test alıcılarıyla kontrollü provider smoke
  yapılır, gerçek sağlayıcı için `NOTIFICATION_SMOKE_CONFIRM=send` gerekir.
- Kurum admin `POST /announcements/:id/deliveries` ile EMAIL duyuru gönderimini başlatır; servis
  gerçek duyuru alıcılarını çözer, `User.email` adresleriyle adapter mesajı üretir ve sonucu
  `announcement-delivery` kuyruğuna rapor özeti olarak bağlar.
- Push cihaz tokenları için `NotificationDeviceToken` tenant tablosu, RLS policy'si ve
  `/me/notification-devices` kayıt/listeleme/kapatma yüzeyi eklendi; kurum admin
  `POST /announcements/:id/deliveries` ile PUSH gönderimini duyuru alıcılarının aktif cihaz
  tokenlarından üretip aynı rapor kuyruğuna bağlar.
- Next app shell `Bildirim cihazı` paneli eklendi; tarayıcı Web Push aboneliğini alır,
  `/me/notification-devices` yüzeyine `web-push` cihazı olarak kaydeder ve aktif cihaz
  sayısını gösterir.
- SMS adapter env factory'si eklendi; `NODE_ENV=production` ortamında gerçek sağlayıcı seçilmeden
  no-op adapter ile başlamak `SMS_PROVIDER_REQUIRED` hatasıyla engellenir.
- Worker SMS batch processor, provider seçimini kendi içinde tekrar tanımlamak yerine
  `@o-okul/sms-adapter` paketindeki env factory'sini kullanır; Docker Compose worker env'i
  `SMS_PROVIDER` ve `SMS_ALLOW_NOOP_IN_PRODUCTION` değerlerini açıkça taşır.
- Netgsm REST v2 SMS adapter eklendi; `SMS_PROVIDER=netgsm` seçildiğinde Basic Auth ile
  `https://api.netgsm.com.tr/sms/rest/v2/send` endpoint'ine JSON mesaj listesi gönderir,
  `code: "00"` sonucunu `jobid` ile başarılı kabul eder ve sağlayıcı hata kodlarını batch
  sonuçlarına taşır.
- `pnpm sms:smoke` eklendi; Netgsm test/canlı credential geldiğinde tek alıcıya kontrollü smoke
  gönderimi yapılır, gerçek sağlayıcı için `SMS_SMOKE_CONFIRM=send` gerekir.
- Materyal havuzu için ilk API dilimi eklendi: `GET /homework/materials`,
  `GET /homework/materials/:id`, `POST /homework/materials`, `PATCH /homework/materials/:id` ve
  `DELETE /homework/materials/:id`.
- Materyal havuzu mevcut `HomeworkMaterial` tenant tablosu ve RLS hattını kullanır.
- Materyal CRUD akışı tenant dışı erişimi `403`, silinmiş materyali `404`, başlıksız oluşturmayı
  `400` ile reddeder; `TEACHER` rolü okur, yazma işlemleri `TENANT_ADMIN` rolünde kalır.
- Materyal dosyaları için `HomeworkMaterialFile` modeli, RLS migration'ı,
  `GET /homework/materials/:id/files` ve `POST /homework/materials/:id/files` akışı eklendi;
  dosya adı normalize edilir, içerik tipi izin listesiyle sınırlandırılır ve boyut limiti 64 KiB
  olarak uygulanır.
- Kişiye özel materyal ataması için `HomeworkMaterialAssignment` modeli, RLS migration'ı,
  `GET /homework/materials/:id/assignments` ve `POST /homework/materials/:id/assignments`
  akışı eklendi; materyal ve öğrenci aynı tenant içinde doğrulanır, `TEACHER` okur,
  `TENANT_ADMIN` atama yapar.
- Hata kitapçığı için skor motoru soru bazlı `CORRECT`, `WRONG`, `BLANK` dökümü üretir;
  `ReportSnapshot` öğrenci özetleri bu dökümü taşır ve
  `GET /exams/:examId/reports/snapshots/:snapshotId/students/:studentId/error-booklet`
  yalnız yanlış/boş soruları döner.
- Destek bildirimi için ilk API dilimi eklendi: `GET /support-tickets`,
  `GET /support-tickets/:id`, `POST /support-tickets` ve `PATCH /support-tickets/:id`.
- `SupportTicket` Prisma modeli ve migration eklendi; tablo tenant foreign key, status/priority
  indexleri, RLS policy ve app rolü yetkisiyle korunur.
- Destek bildirimi oluşturma `subject`, `message` ve `priority` doğrulaması yapar; durum
  güncelleme `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED` değerleriyle sınırlıdır.
- Destek bildirimi dosya ekleri için `SupportTicketAttachment` modeli, RLS migration'ı,
  `GET /support-tickets/:id/attachments` ve `POST /support-tickets/:id/attachments` akışı
  eklendi; dosya adı normalize edilir, içerik tipi izin listesiyle sınırlandırılır ve boyut limiti
  64 KiB olarak uygulanır.
- Destek bildirimi dosya ekleri için `GET /support-tickets/:id/attachments/:attachmentId/download`
  akışı eklendi; liste endpoint'i dosya içeriğini döndürmez, indirme ise ticket/tenant eşleşmesini
  doğruladıktan sonra dosyayı base64 olarak verir.
- Destek bildirimi dosya ekleri için geriye uyumlu storage katmanı eklendi; varsayılan inline
  base64 kalır, `SUPPORT_ATTACHMENT_STORAGE=s3` seçildiğinde MinIO/S3 uyumlu obje depolama
  kullanılır; S3 modunda veritabanı dosya içeriğini değil `storageKey` referansını taşır.
- Destek bildirimi yorumları için `SupportTicketComment` modeli, RLS migration'ı,
  `GET /support-tickets/:id/comments` ve `POST /support-tickets/:id/comments` akışı eklendi;
  yorum gövdesi zorunludur, tenant dışı ticket yorumları `403` ile korunur.
- RLS statik kontrolü materyal dosyası, materyal ataması, destek bildirimi, eki ve yorumu
  tabloları dahil 28 tenant tablosunu doğrular.
- Web panelinde materyal havuzu için listeleme, ekleme, düzenleme ve silme görünümü eklendi.
- Web panelinde materyal dosyası seçme, yükleme ve materyal altında dosyaları görme akışı eklendi.
- Web panelinde materyali öğrenciye atama ve materyal altında öğrenci atamalarını görme akışı
  eklendi.
- Web panelinde ilk öğrenci raporu için hata kitapçığı özeti eklendi.
- Web panelinde destek bildirimi için listeleme, yeni bildirim açma, işleme alma ve çözüldü
  işaretleme görünümü eklendi.
- Web panelinde destek bildirimi eki seçme, yükleme ve ticket altında ekleri görme akışı eklendi.
- Web panelinde destek bildirimi ekleri için indirme aksiyonu eklendi.
- Web panelinde destek bildirimi yorumu ekleme ve ticket altında yorumları görme akışı eklendi.
- Ödeme planı akademik bağlamı genişledi: `PaymentPlan` artık `campusId`, `gradeLevelId`,
  `classId`, `courseId` ve `termId` taşır; yeni plan öğrenci sınıfından kampüs/seviye/sınıf
  bağlamını miras alır, kurum listesi bu alanlarla filtrelenebilir ve Postgres store aynı kolonları
  tenant-aware SQL ile yazar/okur.
- Ödeme işaretleme ve taksit düzenleme dilimi eklendi: kurum admin
  `PATCH /payment-plans/:planId/installments/:installmentId` ile taksidi `PAID`, `OVERDUE`,
  `PENDING` veya `CANCELED` durumuna alır; aynı uç nokta taksit tutarı ve vadesini de düzenler.
  `PAID` durumunda `paidAt` yazılır, diğer durumlarda ödeme tarihi temizlenir ve PII içermeyen
  `payment_installment.updated` audit kaydı oluşur.
- Kurum finans ekranı eklendi: sol menüde ayrı Finans grubu ve `/kurum/finans` rotası var; ekran
  bekleyen, gecikmiş ve ödenen tutar özetlerini, akademik bağlam filtrelerini, taksit listesini ve
  ödendi/gecikmiş/beklemede hızlı durum aksiyonlarını gösterir.
- Destek bildirimi bağlamı genişledi: `SupportTicket` artık `campusId`, `gradeLevelId`, `classId`,
  `courseId` ve `termId` taşır; kurum destek API'si ve `/kurum/destek` ekranı bu alanlara göre
  filtreler, destek oluşturma formu da akademik bağlam seçebilir.

## Çalıştırılan doğrulamalar

- `corepack pnpm --filter @o-okul/api test -- announcement`
- `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts`
- `corepack pnpm --filter @o-okul/db run db:rls:check`
- `corepack pnpm --filter @o-okul/shared-types typecheck`
- `corepack pnpm --filter @o-okul/api typecheck`
- `corepack pnpm --filter @o-okul/api exec vitest run src/payment/payment.e2e.test.ts src/payment/payment-store.test.ts`
- `corepack pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts`
- `corepack pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts`
- `corepack pnpm --filter @o-okul/web typecheck`
- `corepack pnpm --filter @o-okul/api typecheck`
- `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"`
- `corepack pnpm --filter @o-okul/api exec vitest run src/announcement/announcement-delivery-report-store.test.ts src/announcement/announcement.e2e.test.ts`
- `corepack pnpm --filter @o-okul/api exec vitest run src/announcement/announcement.e2e.test.ts`
- `corepack pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts src/announcement/announcement.e2e.test.ts`
- `corepack pnpm --filter @o-okul/web typecheck`
- `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next rol portalları bağlı kişi verisini gösterir"`
- `corepack pnpm --filter @o-okul/api exec vitest run src/queue/job-producer.test.ts src/queue/bullmq-producer.test.ts`
- `corepack pnpm --filter @o-okul/worker typecheck`
- `corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/announcement-delivery-job.test.ts src/jobs/announcement-delivery-processor.test.ts src/jobs/postgres-announcement-delivery-reporter.test.ts src/queue/bullmq-worker.test.ts`
- `corepack pnpm --filter @o-okul/notification-adapter typecheck`
- `corepack pnpm --filter @o-okul/notification-adapter test`
- `corepack pnpm --filter @o-okul/api test -- message-template`
- `corepack pnpm --filter @o-okul/api test -- sms-batch`
- `corepack pnpm --filter @o-okul/api exec vitest run src/sms-batch/sms-batch.service.test.ts src/sms-batch/sms-batch.e2e.test.ts`
- `corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/sms-batch-job.test.ts src/jobs/sms-batch-processor.test.ts src/jobs/postgres-sms-batch-delivery-reporter.test.ts`
- `corepack pnpm --filter @o-okul/web typecheck`
- `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"`
- `corepack pnpm --filter @o-okul/api test -- homework`
- `corepack pnpm --filter @o-okul/api test -- report-generation`
- `corepack pnpm --filter @o-okul/api test -- support-ticket`
- `corepack pnpm --filter @o-okul/api exec vitest run src/support-ticket/support-ticket.e2e.test.ts src/support-ticket/support-ticket-store.test.ts`
- `corepack pnpm --filter @o-okul/api exec vitest run src/support-ticket/support-ticket-attachment-storage.test.ts src/support-ticket/support-ticket.service.test.ts src/support-ticket/support-ticket.e2e.test.ts src/support-ticket/support-ticket-store.test.ts`
- `corepack pnpm --filter @o-okul/api exec vitest run src/support-ticket/support-ticket.e2e.test.ts src/support-ticket/support-ticket-store.test.ts src/support-ticket/support-ticket.service.test.ts`
- `corepack pnpm --filter @o-okul/sms-adapter test`
- `corepack pnpm --filter @o-okul/sms-adapter exec vitest run src/index.test.ts`
- `corepack pnpm --filter @o-okul/worker test -- sms-batch`
- `corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/sms-batch-processor.test.ts src/jobs/sms-batch-job.test.ts`
- `corepack pnpm --filter @o-okul/worker test -- scoring-engine report-generation-job exam-evaluation-job`
- `corepack pnpm --filter @o-okul/api typecheck`
- `corepack pnpm --filter @o-okul/db lint`
- `corepack pnpm --filter @o-okul/web typecheck`
- `corepack pnpm --filter @o-okul/web test:e2e`
- `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"`
- `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next rol portalları bağlı kişi verisini gösterir"`
- Playwright mobil görsel kontrolü: `apps/web/test-results/announcement-panel-mobile.png`
- Playwright materyal paneli görsel kontrolü: `apps/web/test-results/material-file-panel.png`
- Playwright hata kitapçığı görsel kontrolü: `apps/web/test-results/error-booklet-panel.png`
- Playwright destek paneli görsel kontrolü: `apps/web/test-results/support-ticket-panel.png`
- Playwright destek yorum paneli görsel kontrolü: `apps/web/test-results/support-comment-panel.png`
- Playwright destek eki indirme görsel kontrolü:
  `apps/web/test-results/support-attachment-download-panel.png`
- `corepack pnpm db:migrate`
- `corepack pnpm db:rls:check`
- `corepack pnpm db:rls:check:live`
- `corepack pnpm run ci`

## Kalan işler

- Netgsm test credential/canlı hesap doğrulaması ve `pnpm sms:smoke` staging sonucu.
