# Eğitim Yönetim Sistemi Değerlendirmesi ve Tamamlama Planı

> **DURUM:** TARİHSEL BAĞLAM — güncel kapsam `docs/DECISIONS.md` ve `docs/product-journeys-v1.md` üzerinden izlenir.

Tarih: 2026-06-01
Son güncelleme: 2026-06-02

## Varsayımlar ve Kapsam

- Bu değerlendirme mevcut checkout üzerinden yapıldı. Production veya staging ortamı canlı test edilmedi.
- Uygulama eğitim kurumları için çok kiracılı bir SaaS olarak ele alındı.
- Amaç yeni özellik yazmak değil; mevcut ürün hiyerarşisini, kullanıcı gruplarını, yetkileri, kişi ilişkilerini ve ekran yapısını değerlendirip tamamlanma planını çıkarmaktır.
- Bu klasör şu an Git repo kökü gibi görünmüyor; `git status` çalışmadı. Bu yüzden kanıtlar dosya ve komut çıktısı üzerinden tutuldu.
- 2026-06-02 devam çalışması repo kökünden yapıldı; yeni kanıtlar hedef test ve şema doğrulama çıktılarıyla tutuldu.

## Kullanılan Kanıtlar

- Veri modeli: `packages/db/prisma/schema.prisma`
- API yetki modeli: `apps/api/src/rbac/roles.ts`, `apps/api/src/rbac/roles.guard.ts`
- Kişi düzeyi erişim: `apps/api/src/tenant/tenant-access.ts`, `apps/api/src/me/me.controller.ts`
- Kurum ve kişi servisleri: `apps/api/src/school/school.service.ts`, `apps/api/src/student/student.service.ts`
- Web ekranları: `apps/web/app/(app)/**`, `apps/web/e2e-next/login-next.spec.ts`
- Faz dokümanları: `docs/phase-a-checklist.md` ile `docs/phase-e-checklist.md`
- Çalıştırılan kontroller:
  - `corepack pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts src/tenant/tenant-access.test.ts src/rbac/roles.test.ts` -> 3 dosya, 16 test geçti.
  - `corepack pnpm --filter @o-okul/web typecheck` -> geçti.
  - `corepack pnpm web:token-storage:check` -> token storage kontrolü geçti.
  - `corepack pnpm identity-link:audit` -> canlı DB'de `READY`: 20.018 subject kaydının tamamı kullanıcı ve doğru membership ile bağlı.
  - `corepack pnpm prod:readiness:check` -> statik readiness geçti.
  - `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts` -> Prisma şeması geçerli.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/school/school.e2e.test.ts src/program/schedule.e2e.test.ts src/program/study-session.e2e.test.ts` -> 3 dosya, 34 test geçti.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/program/schedule.e2e.test.ts src/program/study-session.e2e.test.ts` -> 2 dosya, 18 test geçti.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/program/schedule-store.test.ts src/program/study-session-store.test.ts` -> 2 dosya, 4 test geçti.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/attendance/attendance.e2e.test.ts src/teacher-note/teacher-note.e2e.test.ts` -> 2 dosya, 8 test geçti; devamsızlık ve öğretmen notu listeleri öğrenci sınıfı üzerinden `classId` filtresiyle daralıyor.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/announcement/announcement.e2e.test.ts src/announcement/announcement-store.test.ts src/audit-log/audit-log.e2e.test.ts` -> 3 dosya, 25 test geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kampüs, akademik takvim, devamsızlık sınıf filtresi, öğretmen notu sınıf filtresi ve duyuru hedefleme kurum akışı doğrulandı.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/me/me-access-matrix.e2e.test.ts src/announcement/announcement.e2e.test.ts` -> 3 dosya, 38 test geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next rol portalları bağlı kişi verisini gösterir"` -> 1 test geçti; öğrenci/veli/öğretmen portalında hedefli duyuru okuma doğrulandı.
  - `corepack pnpm --filter @o-okul/db exec prisma validate --schema prisma/schema.prisma` -> Prisma şeması geçerli.
  - `corepack pnpm --filter @o-okul/db lint` -> Prisma ve DB TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/db run db:rls:check` -> 36 tenant tablosu RLS kontrolünden geçti.
  - `corepack pnpm --filter @o-okul/api typecheck` -> API TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/sms-batch/sms-batch.service.test.ts src/sms-batch/sms-batch.e2e.test.ts` -> 2 dosya, 12 test geçti.
  - `corepack pnpm --filter @o-okul/worker typecheck` -> Worker TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/sms-batch-job.test.ts src/jobs/sms-batch-processor.test.ts src/jobs/postgres-sms-batch-delivery-reporter.test.ts` -> 3 dosya, 9 test geçti.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; SMS şablondan gönderim, duyuru hedefinden alıcı önizleme, duyuru ekranından SMS batch başlatma ve teslim raporu kurum ekranında doğrulandı.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/announcement/announcement-delivery-report-store.test.ts src/announcement/announcement.e2e.test.ts` -> 2 dosya, 14 test geçti; duyuru EMAIL/PUSH teslim raporu API, sağlayıcı sonucu queue girişi ve tenant-aware store doğrulandı.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/announcement/announcement.e2e.test.ts` -> 1 dosya, 15 test geçti; EMAIL duyuru gönderim tetikleyicisi adaptere bağlandı.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts src/announcement/announcement.e2e.test.ts` -> 2 dosya, 21 test geçti; `/me/notification-devices` cihaz token yüzeyi ve duyuru PUSH gönderiminin aktif tokenlardan üretildiği doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next rol portalları bağlı kişi verisini gösterir"` -> 1 test geçti; app shell `Bildirim cihazı` panelinden Web Push aboneliği `/me/notification-devices` yüzeyine kaydedildi.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/queue/job-producer.test.ts src/queue/bullmq-producer.test.ts` -> 2 dosya, 16 test geçti; `announcement-delivery` queue sözleşmesi doğrulandı.
  - `corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/announcement-delivery-job.test.ts src/jobs/announcement-delivery-processor.test.ts src/jobs/postgres-announcement-delivery-reporter.test.ts src/queue/bullmq-worker.test.ts` -> 4 dosya, 17 test geçti; EMAIL/PUSH teslim özetinin worker tarafından `AnnouncementDeliveryReport` kaydına yazılması doğrulandı.
  - `corepack pnpm --filter @o-okul/notification-adapter typecheck` -> notification adapter TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/notification-adapter test` -> 1 dosya, 10 test geçti; EMAIL/PUSH no-op, prod guard ve HTTP sağlayıcı sözleşmesi doğrulandı.
  - `corepack pnpm --filter @o-okul/db run db:rls:check` -> 38 tenant tablosu RLS kontrolünden geçti; `NotificationDeviceToken` dahil.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/support-ticket/support-ticket.e2e.test.ts src/support-ticket/support-ticket-store.test.ts src/support-ticket/support-ticket.service.test.ts` -> 3 dosya, 21 test geçti; destek taleplerinde kampüs/seviye/sınıf/ders/dönem bağlamı ve filtreleri doğrulandı.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum destek ekranında akademik bağlam seçimi ve ders filtresi doğrulandı.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/report/report-generation.service.test.ts src/report/report-generation.controller.e2e.test.ts src/report/report-snapshot-store.test.ts src/queue/job-producer.test.ts` -> 3 dosya, 28 test geçti; rapor snapshot bağlamı, filtreleri ve queue payload'ı doğrulandı.
  - `corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/report-generation-job.test.ts src/jobs/postgres-report-generation-adapter.test.ts` -> 2 dosya, 10 test geçti; worker'ın rapor bağlamını snapshot kaydına yazdığı ve Postgres sonuç yüklemesini kampüs/seviye/sınıf bağlamıyla daralttığı doğrulandı.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum rapor ekranı seçili kampüs/seviye/sınıf/ders/dönem bağlamını `generation-jobs` payload'ına gönderiyor.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/payment/payment.e2e.test.ts src/payment/payment-store.test.ts` -> 2 dosya, 10 test geçti; ödeme planı akademik bağlamı, filtreleri ve Postgres store sözleşmesi doğrulandı.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts src/app.e2e.test.ts` -> 2 dosya, 30 test geçti; veli ödeme görünümü ve kişi düzeyi erişim matrisi korundu.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/payment/payment.e2e.test.ts src/payment/payment-store.test.ts` -> 2 dosya, 13 test geçti; taksit tutar/vade düzenleme, ödendi/gecikmiş işaretleme, öğretmen/öğrenci 403 ve başka tenant reddi doğrulandı.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts` -> 1 dosya, 6 test geçti; `/me` kişi düzeyi erişim matrisi korundu.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts` -> 1 dosya, 24 test geçti; auth, tenant izolasyonu ve öğrenci import/export regresyonu korundu.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum Finans menüsü, ödeme taksit listesi, gecikmiş ödeme özeti, akademik bağlam filtresi ve ödendi işaretleme akışı doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum Operasyon menüsündeki Sistem Sağlığı ekranı, API health/ready, Postgres/Redis ve metrics uptime görünümü doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum Operasyon menüsündeki Yedek / Restore ekranı, backup/restore smoke komutları, off-host/WAL hedefleri, restore drill raporu ve kritik tablo listesi doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum Operasyon menüsündeki Güvenlik Denetimi ekranı, security audit, production env, canlı RLS, HTTPS smoke, header, auth ve veri kontrol kapıları doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum Operasyon menüsündeki Gözlemlenebilirlik ekranı, observability UAT, alert webhook, Sentry smoke, dashboard panelleri ve alert kuralları doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum Operasyon menüsündeki UAT / Rollback ekranı, UAT kanıt sözleşmesi, zorunlu smoke komutları, UAT akışları ve rollback referansları doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum Operasyon menüsündeki Release Kanıtı ekranı, production evidence zinciri, release özet alanları ve dış ortam kanıt gereksinimleri doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum Operasyon menüsündeki Rol Önizleme ekranı, öğretmen/öğrenci/veli portal kapsamı, kişi hesabı şartı, erişim kuralları ve kanıt komutları doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum öğretmen atama ekranında `TeacherAssignment.courseId/termId` seçimi, listede ders/dönem adı ve POST payload doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next rol portalları bağlı kişi verisini gösterir"` -> 1 test geçti; öğretmen portalında ders programından gelen ders/dönem seçimiyle yoklama ve öğretmen notu payload'ı doğrulandı.
  - `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts` -> Prisma şeması geçerli.
  - `corepack pnpm --filter @o-okul/db run db:rls:check` -> 38 tenant tablosu RLS kontrolünden geçti.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/homework/homework-store.test.ts src/homework/homework.e2e.test.ts src/app.e2e.test.ts` -> 3 dosya, 54 test geçti; `HomeworkMaterialAssignment.courseId/termId`, API kaydı ve öğrenci/veli materyal görünümü doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` -> Web TypeScript kontrolü geçti.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next rol portalları bağlı kişi verisini gösterir"` -> 1 test geçti; öğretmen portalında materyal atamanın ders/dönem seçimiyle payload'a yazıldığı doğrulandı.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/student/student-class-history-store.test.ts src/school/school.e2e.test.ts` -> 2 dosya, 26 test geçti; `StudentClassHistory.academicYearId/termId` ve sınıf değişikliği geçmişi doğrulandı.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; öğrenci 360 sınıf geçmişinde akademik yıl/dönem bağlamı göründü.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/school/school.e2e.test.ts src/announcement/announcement.e2e.test.ts src/sms-batch/sms-batch.service.test.ts src/sms-batch/sms-batch.e2e.test.ts` -> 4 dosya, 52 test geçti; `GRADUATED/TRANSFERRED` öğrenci statüleri, mezuniyet sonrası sınıf geçmişi kapanışı ve aktif öğrenci alıcı kuralı doğrulandı.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum öğrenci ekranında mezun statüsü seçimi ve listede görünümü doğrulandı.
  - `corepack pnpm --filter @o-okul/web typecheck` ve aynı Playwright kurum smoke'u geçti; öğrenci 360 öğretmen ilişkisi artık rol, sınıf, ders ve dönem bağlamını okunur adlarla gösteriyor.
  - `corepack pnpm --filter @o-okul/db exec prisma validate --config prisma.config.ts` -> Prisma şeması geçerli; `StudentEnrollment` ilişkileri doğrulandı.
  - `corepack pnpm --filter @o-okul/db run db:rls:check` -> 39 tenant tablosu RLS kontrolünden geçti; `StudentEnrollment` tenant izolasyonu kapsama girdi.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/student/student-enrollment-store.test.ts src/school/school.e2e.test.ts` -> 2 dosya, 26 test geçti; enrollment listeleme, kayıt yenileme ve kurum içi nakil endpointleri doğrulandı.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum öğrenci hızlı 360 ve detay 360 ekranında kayıt geçmişi görünür.
  - `corepack pnpm --filter @o-okul/web typecheck` ve aynı Playwright kurum smoke'u geçti; kurum öğrenci düzenleme modalında kayıt yenileme ve nakil işlem formu gerçek endpointleri çağırıyor, kayıt geçmişi yenileniyor.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/school/school.e2e.test.ts` -> 1 dosya, 25 test geçti; `/students/enrollments/bulk-renew` listelenen/seçili öğrenciler için toplu dönem geçişi enrollment kaydı oluşturuyor.
  - `corepack pnpm --filter @o-okul/web typecheck` ve aynı Playwright kurum smoke'u geçti; kurum öğrenci ekranındaki `Toplu dönem geçişi` formu listelenen öğrencileri hedef sınıfa geçiriyor.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/school/school.e2e.test.ts` -> 1 dosya, 25 test geçti; bulk-renew kaynak sınıf -> hedef sınıf eşleştirmesiyle enrollment açıyor.
  - `corepack pnpm --filter @o-okul/web typecheck` ve aynı Playwright kurum smoke'u geçti; kurum öğrenci ekranında kaynak sınıf bazlı hedef sınıf seçimi çalışıyor.
  - `corepack pnpm --filter @o-okul/api exec vitest run src/school/school.e2e.test.ts` -> 1 dosya, 25 test geçti; bulk-renew `useAutomaticClassMapping` ile aynı kampüs/şubede bir sonraki seviye sınıfına enrollment açıyor.
  - `corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` -> 1 test geçti; kurum öğrenci ekranında `Otomatik seviye yükselt` seçimi 8-A öğrencisini 9-A sınıfına geçiriyor.

## Kısa Sonuç

Uygulamanın backend, güvenlik ve altyapı iskeleti güçlü. Tenant izolasyonu, RLS, audit log, temel sınav/optik akışı, raporlama, materyal, destek, duyuru ve KVKK yüzeyleri ciddi şekilde ilerlemiş.

Ana eksik artık "modül var mı?" sorusu değil; eğitim kurumu gerçekliğinde kişi, rol, yetki ve ekran hiyerarşisinin netleşmesidir. En kritik açıklar:

1. DB-backed auth, kalıcı refresh/session store, şifre reset, öğrenci/veli/öğretmen davet-aktivasyon API'si, kurum kullanıcı/davet web ekranı ve canlı DB kimlik bağı göçü doğrulandı.
2. Canlı DB kimlik bağı audit'i `READY` döndü: 20.014 öğrenci, 1 veli ve 3 öğretmen kaydı `userId` + doğru `TenantMembership` ile bağlı.
3. Öğretmen yetkileri artık ana öğrenci/yoklama/not/ödev yüzeylerinde kapsamla sınırlanıyor; `TeacherAssignment` modeli sınıf/öğrenci ataması ve rol tipini taşımaya başladı. `Course`, `AcademicYear`, `AcademicTerm`, `Campus`, `GradeLevel`, kurum ders/kampüs/seviye/akademik takvim/devamsızlık/öğretmen notu/duyuru/destek/rapor ekranları ve `courseId/termId/campusId/gradeLevelId/section` bağlantıları eklendi; ödeme planı da bu bağlamı taşımaya başladı. Kalan iş kapsamı tüm işlem yüzeylerinde aynı disiplinle kullanmaktır.
4. Web menüsü artık role göre filtreleniyor; kurum admin menüsünde öğrenci, veli ve öğretmen portalları normal menü maddesi olarak görünmüyor.
5. Kurum hiyerarşisi şu an `Tenant > Campus/GradeLevel > AcademicYear/AcademicTerm/Class/Course > Student/Teacher/Guardian` düzeyine çıktı; sınıf öğretmeni ve branş öğretmeni kapsamının tüm modüllere yayılması hâlâ tamamlanmalı.
6. Liste ekranları gerçek arama, filtre, sayfalama ve yetki bazlı görünürlük için hâlâ erken aşamada.

## Durum Notu: Teknik Dilim ve Ürün Tamamlığı Ayrımı

Mevcut faz checklist'lerinde bazı parçalar "tamamlandı" görünüyor. Bu doğru olabilir; fakat bu tamamlanma çoğunlukla teknik dilim anlamında:

- Endpoint var.
- Temel UI var.
- Mock veya dar kapsamlı e2e var.
- Negatif erişim testlerinin bir bölümü var.

Eğitim kurumu için ürün tamamlığı ise daha geniştir:

- Kullanıcı gerçek DB kaydıyla açılır.
- Öğrenci, veli ve öğretmen canlı veriyle hesaba bağlanır.
- Öğretmen sadece kendi sorumluluk alanında işlem yapar.
- Kurum admin gerçek kullanıcı/rol/davet yönetimi yapar.
- Ekranlar günlük kurum iş akışını menü ve filtreleriyle taşıyabilir.

Bu rapor bu yüzden "kod var mı?" ile "kurumda kullanılabilir mi?" sorularını ayrı değerlendirir.

## Mevcut Ürün Hiyerarşisi

### 1. Kurum Katmanı

Mevcut model:

```txt
Tenant
  -> Campus
  -> GradeLevel
  -> Class
  -> Student
  -> StudentClassHistory
  -> Teacher
  -> Guardian
  -> GuardianStudent
  -> Course
  -> AcademicYear / AcademicTerm
  -> TeacherAssignment
  -> ScheduleLesson / StudySession
  -> Homework / HomeworkMaterial
  -> Exam / RawImport / ReportSnapshot
  -> Announcement / MessageTemplate / SupportTicket
  -> AuditLog
```

Güçlü taraf:

- Çok kiracılı yapı baştan düşünülmüş.
- RLS ve tenant-aware sorgu yardımcıları var.
- Audit log ve KVKK aksiyonları birçok kritik işleme bağlanmış.

Eksik taraf:

- Kurumun gerçek organizasyon ağacı kısmi: kampüs çekirdeği `Campus`, seviye çekirdeği `GradeLevel`, sınıf bölümü alanı `Class.section`, sınıf bağlantıları `Class.campusId/gradeLevelId`, yoklama/not bağlantıları `courseId/termId`, duyuru hedef kapsamı, destek talebi bağlamı, ödeme planı bağlamı ve rapor snapshot bağlamı ile başladı. Kalan iş bu kapsamı tüm işlem yüzeylerinde tutarlı kullanmaktır.
- `Class` artık kampüs, seviye ve şube bilgisi taşıyor; `StudentClassHistory` akademik yıl/dönem bağlamı taşıyor; `StudentEnrollment` yıl bazlı kayıt geçmişini, kayıt yenilemeyi ve kurum içi nakli taşımaya başladı; `Student.status` aktif, pasif, mezun ve nakil durumlarını ayırıyor. Kalan iş bu kapsamı tüm operasyon ekranlarında ve rapor filtrelerinde aynı disiplinle kullanmaktır.
- Öğrenci sınıf geçmişi `StudentClassHistory` ile, yıl bazlı kayıt geçmişi `StudentEnrollment` ile kalıcı hale geldi; mezun/nakil gibi terminal statüler aktif sınıf geçmişini ve enrollment kaydını kapatıyor. Kurum öğrenci düzenleme modalı kayıt yenileme ve nakil aksiyonlarını çalıştırıyor; toplu dönem geçişi manuel, kaynak sınıf eşlemeli ve otomatik seviye yükseltmeli çalışıyor. Kalan iş kapsamı diğer operasyon ekranlarına yaymaktır.

Hedef kurum ağacı:

```txt
Tenant
  -> Campus / Branch
  -> AcademicYear
  -> Term
  -> GradeLevel
  -> ClassSection
  -> Course
  -> TeacherAssignment
  -> StudentEnrollment
```

`StudentClassHistory` ile öğrenci-sınıf geçmişi, `StudentEnrollment` ile yıl bazlı kayıt geçmişi kalıcı hale geldi ve aktif `AcademicYear/AcademicTerm` bağlamını taşımaya başladı. `Course`, `AcademicYear`, `AcademicTerm`, `Campus`, `GradeLevel`, `courseId`, `termId`, `campusId`, `gradeLevelId` ve `section` bağlantıları da başladı; yine de bu kapsam tüm işlem yüzeylerine bağlanmadan yoklama, ders programı, sınav raporu ve öğretmen yetkisi zaman içinde tam doğru yorumlanamaz.

### 2. Kullanıcı Grupları

Kodda roller:

```txt
SYSTEM_ADMIN > TENANT_ADMIN > TEACHER > STUDENT > GUARDIAN
```

Değerlendirme:

- `SYSTEM_ADMIN`: Platform yöneticisi olarak düşünülmüş; cross-tenant bypass var. Web'de ayrı sistem admin paneli yok.
- `TENANT_ADMIN`: Kurum yöneticisi. Sınıf, öğretmen, öğrenci, veli, ödeme, rapor, KVKK, denetim gibi tenant genelinde yetkili olmalı. Bu role en çok ihtiyaç duyulan ekranlar başlamış.
- `TEACHER`: Öğretmen. Öğrenci listesi ve öğrenci detayı artık `responsibleTeacherId` yanında `TeacherAssignment` sınıf/öğrenci kapsamını da okuyor. Ders, dönem, kampüs, seviye ve şube bağlantısı `courseId/termId/campusId/gradeLevelId/section` ile başladı; kalan ürün işi bu kuralı tüm işlem yüzeylerine yaymaktır.
- `STUDENT`: Öğrenci. `/me/student/**` yüzeyi var; kendi profil, devamsızlık, not ve raporlarını okuyabiliyor.
- `GUARDIAN`: Veli. `/me/guardian/**` yüzeyi var; bağlı öğrenci üzerinden profil, devamsızlık, not, ödeme ve rapor okuyor.

Önemli not:

- `roleRank >=` yaklaşımı üst rolün alt rol endpointlerinden geçmesini sağlar. Bu bazı kurum işlemlerinde pratik olabilir ama hassas kaynaklarda tehlikelidir. Örneğin ödeme veya kişi bazlı öğrenci verisi için sadece decorator yetmez; servis katmanında subject/kapsam kontrolü şarttır. Mevcut testler bu tuzağın bir kısmını yakalıyor, ama yeni endpointlerde aynı disiplin korunmalıdır.

### 3. Kişi ve İlişki Modeli

Mevcut ilişkiler:

- `Student.userId`, `Teacher.userId`, `Guardian.userId` alanları var.
- `GuardianStudent` veli-öğrenci bağını kuruyor.
- `Student.responsibleTeacherId` alanı var.
- `IdentityResolver`, login sonrası kullanıcıyı öğrenci/veli/öğretmen subject'ine bağlamaya çalışıyor.

Güçlü taraf:

- Öğrenci, veli ve öğretmen portalı için gereken temel subject altyapısı var.
- Veli yalnız bağlı öğrencinin verisine erişsin diye negatif erişim testleri eklenmiş.
- Öğrenci profili için TC maskeleme, şifreleme ve hash yaklaşımı düşünülmüş.

Eksik taraf:

- Gerçek kullanıcı davet/aktivasyon modeli yok.
- Kurum adminin "bu öğrenciye hesap aç", "bu veliye davet gönder", "öğretmen hesabını bağla" akışı yok.
- Veli ilişkisi artık ilişki tipi, birincil kişi ve ödeme/SMS/duyuru/destek izinlerini taşıyor; bu bilgiler ödeme görünümü, SMS hedefleme, duyuru okuma ve destek açma akışlarında kullanılıyor.
- Öğretmen ilişkisi `TeacherAssignment` ile sınıf/öğrenci, ders, dönem ve rol tipini taşımaya başladı. Hangi işlem yetkisiyle çalıştığı hâlâ tam ürünleşmiş değil.

Hedef ilişki modeli:

| İlişki | Neden Gerekli | Minimum Alanlar |
|---|---|---|
| Öğrenci-kullanıcı | Öğrenci portalı ve kişi düzeyi erişim | `studentId`, `userId`, `status`, `activatedAt` |
| Veli-kullanıcı | Veli portalı, bildirim, ödeme görünümü | `guardianId`, `userId`, `status`, `activatedAt` |
| Veli-öğrenci | Hangi öğrencinin hangi velisi olduğu | `guardianId`, `studentId`, `relationshipType`, `isPrimary`, `canViewFinance`, `canReceiveSms` |
| Öğretmen-kullanıcı | Öğretmen portalı ve ders bazlı işlem | `teacherId`, `userId`, `status`, `activatedAt` |
| Öğretmen-öğrenci | Rehber/sorumlu öğretmen kapsamı | `teacherId`, `studentId`, `scope`, `startsAt`, `endsAt` |
| Öğretmen-sınıf/ders | Yoklama, ödev, not ve program yetkisi | `teacherId`, `classId`, `courseId`, `role`, `termId` |

### 4. Web Ekran Hiyerarşisi

Mevcut Next rotaları:

```txt
/login
/kurum
/kurum/kampusler
/kurum/akademik-takvim
/kurum/seviyeler
/kurum/siniflar
/kurum/dersler
/kurum/program
/kurum/etutler
/kurum/devamsizlik
/kurum/notlar
/kurum/ogretmenler
/kurum/veliler
/kurum/ogrenciler
/kurum/duyurular
/kurum/materyaller
/kurum/optik
/kurum/raporlar
/kurum/sablonlar
/kurum/destek
/kurum/denetim
/kurum/kvkk
/ogretmen
/ogrenci
/veli
```

Güçlü taraf:

- Tek ekranlı prototipten menülü yapıya geçiş başlamış.
- Kurum tarafında CRUD kalıbı yerleşmiş.
- Rol portalları ayrı rotalarda var.
- Sol menü rol/subject bilgisine göre filtreleniyor; kurum admin, öğretmen, öğrenci ve veli farklı menü görür.
- Playwright testi login, kurum modülleri, grafikler, destek, optik, rapor ve portal önizleme akışlarını mock API ile geniş şekilde kontrol ediyor.

Eksik taraf:

- Kurum menüsü Kişiler, Akademik, Sınav/Rapor, Finans, İletişim ve Operasyon gruplarına ayrıldı; Akademik altında sınıflar, dersler, ders programı, etütler, devamsızlık, öğretmen notları ve materyaller görünür; Operasyon altında kullanıcı, rol önizleme, denetim, KVKK, güvenlik denetimi, gözlemlenebilirlik, UAT/rollback, release kanıtı, sistem sağlığı ve yedek/restore kanıt ekranları görünür.
- Öğretmen portalı genişlemeye başladı: profil, sınıf bilgili bugünkü dersler, sınıf bilgili ders programı, sınıf bilgili öğrenci seçimleri, ders/dönem seçimli yoklama girişi, ders/dönem seçimli öğretmen notu ekleme, ödev kontrolü, ders/dönem seçimli materyal atama, seçili öğrenci/sınıf/ders/dönem bağlamlı destek talebi, seçili öğrencinin sınıf/kayıt geçmişi, kendi destek taleplerini listeleme, ders/dönem bağlamı görünen seçili öğrenci raporu ve kapsamındaki sınıf raporu var. Kalan günlük iş bu kapsam disiplinini ödev, program ve rapor kararlarında daha tutarlı kullanmak.
- Öğrenci portalı profil/devamsızlık/not, veli ilişkileri, sınıf ve kayıt geçmişi, hedefli duyuru, duyuru okundu bilgisi, ödev-materyal ataması, destek talebi, gelişim grafiği, ders/dönem bağlamlı son sınav raporu ve hata kitapçığı özetini gösteriyor; kurum tarafı duyuru alıcı/okunma raporu da başladı.
- Veli portalı ödeme/profil/devamsızlık/not, hedefli duyuru, duyuru okundu bilgisi, destek talebi, bildirim tercihleri, seçili öğrenci ödev-materyal ataması, gelişim grafiği, ders/dönem bağlamlı son sınav raporu ve hata kitapçığı özetini gösteriyor.
- Kurum içi öğrenci ekranı düzenleme penceresinde bağlı veli, devamsızlık, öğretmen notu, ödev, bekleyen ödeme ve son rapor özetini gösteriyor; ayrıca `/kurum/ogrenciler/[studentId]` detay route'u sınav/rapor seçici, veli ilişki geçmişi ve denetim özetiyle 360 görünümü açıyor.
- Sistem admin paneli yok.

## Yetki Matrisi - Hedef Durum

Bu matris, uygulamanın tamamlanması için hedef alınmalıdır.

| Alan | System Admin | Kurum Admin | Öğretmen | Öğrenci | Veli |
|---|---|---|---|---|---|
| Tenant açma/kapama | Evet | Hayır | Hayır | Hayır | Hayır |
| Kullanıcı/rol yönetimi | Platform ve tenant üstü | Kendi kurumu | Hayır | Hayır | Hayır |
| Sınıf/şube/dönem yönetimi | Destek amaçlı | Evet | Okur | Hayır | Hayır |
| Öğretmen kaydı | Destek amaçlı | Evet | Kendi profilini görür | Hayır | Hayır |
| Öğrenci kaydı | Destek amaçlı | Evet | Kendi kapsamındaki öğrencileri görür | Kendi kaydı | Bağlı öğrenciler |
| Veli kaydı ve bağları | Destek amaçlı | Evet | Gerekli iletişim kadar okur | Hayır | Kendi kaydı |
| Yoklama | Destek amaçlı | Evet | Kendi ders/sınıfı için yazar | Kendi okur | Bağlı öğrenci okur |
| Öğretmen notu | Destek amaçlı | Evet | Kendi kapsamı için yazar | Görünür olanı okur | Görünür olanı okur |
| Ödeme planı | Destek amaçlı | Evet | Hayır | Hayır | Bağlı öğrenci okur |
| Sınav/optik | Destek amaçlı | Yönetir | Kendi kapsamı için okur/katkı verir | Kendi sonucunu okur | Bağlı öğrenci sonucunu okur |
| Materyal/ödev | Destek amaçlı | Yönetir | Atar/kontrol eder | Kendi ödevini okur | Bağlı öğrenci ödevini okur |
| Duyuru/SMS | Destek amaçlı | Yönetir | Hedef kitleye göre okur | Kendine geleni okur | Kendine geleni okur |
| Destek | Platform desteği | Kurum talepleri | Kendi talepleri | Kendi talepleri | Kendi talepleri |
| Audit/KVKK | Platform yetkili | Kendi kurumu | Hayır | Kendi self-servis | Kendi self-servis |

## Yetki Uygulama Kuralları

Bu uygulamada `@Roles(...)` tek başına yeterli kabul edilmemeli. Her hassas endpoint şu üç soruyu cevaplamalı:

1. **Rol doğru mu?** Örneğin ödeme planı için `TENANT_ADMIN` veya bağlı `GUARDIAN`.
2. **Tenant doğru mu?** Kaynak mevcut tenant içinde mi?
3. **Subject kapsamı doğru mu?** Öğrenci kendi kaydı mı, veli bağlı öğrenci mi, öğretmen kendi ders/sınıf/öğrenci kapsamı mı?

Özellikle şu alanlarda subject kapsamı zorunlu olmalı:

- Öğrenci profil ve TC/iletişim bilgileri.
- Veli-öğrenci bağlantıları.
- Öğretmen notları.
- Yoklama.
- Ödev ve materyal atamaları.
- Ödeme planları.
- Sınav sonuçları, hata kitapçığı ve gelişim raporu.
- Destek talepleri ve ekleri.

## Öncelikli Boşluklar

### P0 - Canlıya Çıkmadan Kapanması Gerekenler

1. **DB-backed auth ve kullanıcı yönetimi**
   - Tamamlandı: `AuthService` içine gömülü demo kullanıcı listesi kaldırıldı; login `AuthUserStore` üzerinden çalışıyor.
   - Tamamlandı: `AUTH_USER_STORE=postgres` yolu canlı DB'de gerçek `User + TenantMembership` kayıtlarını okuyor.
   - Tamamlandı: `AUTH_SESSION_STORE=postgres` yolu `AuthSession` ve `ConsumedRefreshToken` tablolarıyla refresh rotate/reuse/revoke davranışını canlı DB'de doğruluyor.
   - Tamamlandı: login şifre doğrulaması scrypt hash ile çalışıyor; şifre reset, davet ve aktivasyon akışı API + kurum web ekranında var.
   - Tamamlandı: reset token hashli saklanır, tek kullanımlıktır ve başarılı reset sonrası aktif oturumlar iptal edilir.
   - Tamamlandı: kurum admin rol atayabilir; system admin rolü tenant admin tarafından verilemez.

2. **Kimlik bağı göçü**
   - Tamamlandı: öğrenci, veli ve öğretmen kayıtları `userId` ile gerçek kullanıcıya bağlandı.
   - Tamamlandı: `TenantMembership` rolü ile subject rolü tutarlı; audit `READY` dönüyor.
   - Kalan: üretim ortamı için onay referanslı kimlik göç kanıt raporu ayrıca saklanmalı.

3. **Öğretmen kapsam modeli**
   - Tamamlandı: öğretmen öğrenci listesinde yalnız `responsibleTeacherId` ile kendisine bağlı öğrencileri görür.
   - Tamamlandı: öğretmen kapsam dışı öğrenci için yoklama ve öğretmen notu yazamaz.
   - Tamamlandı: öğretmen yalnız kendi ders programındaki sınıfın ödevini görür, kontrol durumunu değiştirebilir ve kapsamındaki öğrenciye materyal atayabilir.
   - Tamamlandı: öğretmen program ve etüt API okumasında aynı tenant içindeki başka öğretmenin `ScheduleLesson` ve `StudySession` kayıtlarını göremez.
   - Tamamlandı: `Course` modeli/API'si ve kurum ders ekranı eklendi; `AcademicYear/AcademicTerm` modeli/API'si ve kurum akademik takvim ekranı eklendi; `TeacherAssignment`, `ScheduleLesson`, `StudySession`, `Attendance` ve `TeacherNote` tenant içinde doğrulanan `courseId/termId` taşıyor; kurum öğretmen atama ekranı da ders/dönem seçimini payload'a yazar.
   - Kalan: `ScheduleLesson`, `StudySession`, `Student.responsibleTeacherId` ve `TeacherAssignment` kampüs/seviye/şube kapsam modelini tüm işlem yüzeylerinde ortak kullanmalı.

4. **Rol bazlı menü ve ekran guard'ı**
   - Tamamlandı: kullanıcı sadece kendi rolüne uygun menüleri görür.
   - UI guard yalnız deneyim içindir; asıl yetki API'de kalmalı.
   - Tamamlandı: kurum admin için öğrenci/veli/öğretmen portalları normal menü maddesi değildir.
   - Tamamlandı: kurum admin `/kurum/rol-onizleme` ekranında öğretmen/öğrenci/veli portal kapsamını, kişi hesabı şartını, erişim kurallarını ve kanıt komutlarını görür.

5. **Listeleme altyapısı**
   - Tüm büyük listeler `page`, `limit`, `q`, `sort` ve kaynak özel filtrelerle çalışmalı.
   - Tamamlandı: öğrenci listesi sınıf, seviye, sorumlu öğretmen, aktif/pasif ve veli bağlı mı filtrelerini alıyor.

### P1 - Ürün Tamamlığı İçin Gerekenler

1. **Kurum organizasyon modeli**
   - Tamamlandı: ders çekirdeği `Course`, kampüs çekirdeği `Campus`, seviye çekirdeği `GradeLevel` olarak başladı; kurum ders/kampüs/seviye ekranlarına taşındı ve program/etüt/öğretmen ataması/devamsızlık/öğretmen notuyla ilişkilendi. Akademik yıl/dönem çekirdeği `AcademicYear/AcademicTerm` ile başladı ve kurum akademik takvim ekranına taşındı.
   - Kısmi tamamlandı: `StudentClassHistory` aktif akademik yıl/dönem bağlamını taşıyor; `StudentEnrollment` yıl bazlı kayıt geçmişi, kayıt yenileme ve kurum içi nakil çekirdeğini taşıyor; `Student.status` aktif, pasif, mezun ve nakil durumlarını ayırıyor; mezun/nakil aktif sınıf geçmişini ve enrollment kaydını kapatıyor.
   - Kısmi tamamlandı: kurum öğrenci ekranında listelenen öğrencileri hedef sınıfa taşıyan toplu dönem geçişi formu, kaynak sınıf -> hedef sınıf eşleştirmesi, otomatik seviye yükseltme ve `/students/enrollments/bulk-renew` API yüzeyi var.
   - Kalan: kapsamın tüm operasyon ekranlarına yayılması.

2. **Kişi 360 ekranı**
   - Öğrenci profilinde: sınıf, sorumlu öğretmen, veliler, devamsızlık, notlar, ödevler, ödemeler, raporlar, audit özeti. Kısmi tamamlandı: öğrenci ve veli portalı profilde okunur sınıf, kampüs, seviye, şube ve sorumlu öğretmen ilişkisini gösterir; öğrenci portalı veli ilişkileri panelinde veli adı, ilişki tipi ve izin özetini, öğrenci ve veli portalı sınıf/kayıt geçmişi panelinde sınıf/kayıt durumunu kampüs, seviye ve şube bağlamıyla gösterir.
   - Veli profilinde: bağlı öğrenciler, iletişim izinleri, ödeme sorumluluğu, bildirim tercihleri. Kısmi tamamlandı: veli portalı seçili bağlı öğrenci için ilişki tipini, birincil kişi bilgisini, ödeme görünüm iznini ve SMS/duyuru/destek tercihlerini gösterir; SMS, duyuru ve destek talebi tercihlerini günceller; bağlı öğrencinin sınıf ve kayıt geçmişini gösterir.
   - Öğretmen profilinde: dersleri, sınıfları, sorumlu öğrencileri, programı. Kısmi tamamlandı: öğretmen portalı profil özetinde branş, ders/dönem, okunur sınıf kapsamı, kampüs/seviye/şube kapsamı, sorumlu öğrenci sayısı ve program sayısını gösterir.

3. **Öğretmen portalının günlük işe uygun hale gelmesi**
   - Bugünkü dersler. Tamamlandı: öğretmen portalı günün derslerini sınıf, ders, dönem ve saat bilgisiyle ayrı panelde gösterir ve bugün ders yoksa sonraki dersi belirtir.
   - Yoklama girişi. Kısmi tamamlandı: öğretmen portalı kapsamındaki öğrenciyi sınıf bilgisiyle seçtirir ve programdan gelen ders/dönem seçimiyle yoklama kaydı ekler.
   - Öğrenci notu ekleme. Kısmi tamamlandı: öğretmen portalı programdan gelen ders/dönem seçimiyle iç veya veli/öğrenciye görünür not ekler.
   - Ödev/materyal atama veya kontrol. Kısmi tamamlandı: öğretmen portalı kendi kapsamındaki ödevin kontrol durumunu değiştirir ve seçili öğrencisine programdan gelen ders/dönem seçimiyle materyal atar.
   - Sınıf ve öğrenci raporları. Kısmi tamamlandı: öğretmen portalı seçili öğrencinin sınıf/kayıt geçmişini, en son hazır raporu, hata kitapçığını, gelişimi ve raporun ders/dönem bağlamını; kapsamındaki sınıf için son hazır sınıf özetini ve ders/dönem bağlamını gösterir.
   - Destek talebi. Tamamlandı: öğretmen portalı `/me/teacher/support-tickets` ile kendi destek taleplerini listeler ve yeni talep açar.

4. **Öğrenci ve veli portallarının tamamlanması**
   - Sınav raporu, hata kitapçığı, gelişim grafiği. Kısmi tamamlandı: öğrenci ve veli portalı son hazır raporu, hata kitapçığı özetini, gelişim grafiğini ve raporun ders/dönem bağlamını gösterir.
   - Ödev ve materyaller. Kısmi tamamlandı: öğrenci ve veli portalı materyal atamalarını okunur materyal adı, ders/dönem bağlamı, not ve teslim tarihiyle gösterir; öğretmen portalı seçili öğrenciye ders/dönem bağlamlı materyal atar.
   - Duyurular. Kısmi tamamlandı: kurum duyuruları öğrenci/veli/öğretmen/tüm okul hedef türünü ve kampüs/seviye/sınıf/ders/dönem kapsamını taşır; öğrenci, veli ve öğretmen portalı hedefe göre okur ve okundu bilgisini kalıcı kaydeder; kurum admin alıcı/okunma raporunu görür.
   - Destek talebi açma.
   - Bildirim tercihleri.

5. **Finans ekranı**
   - Ödeme planı oluşturma. Kısmi tamamlandı: backend ödeme planı öğrenci sınıfından kampüs/seviye/sınıf bağlamını miras alır; ders/dönem bağlamı alabilir ve kurum listesi bu alanlarla filtrelenir.
   - Ödeme işaretleme ve taksit düzenleme. Tamamlandı: kurum admin taksit tutarı/vadesini düzenler, taksidi `PAID`, `OVERDUE`, `PENDING` veya `CANCELED` durumuna alır; öğretmen, öğrenci ve başka tenant planı reddedilir.
   - Ayrı kurum finans ekranı. Tamamlandı: `/kurum/finans` menüsü bekleyen, gecikmiş ve ödenen tutar özetini; akademik bağlam filtresini; taksit listesi ve hızlı durum aksiyonlarını gösterir.
   - Kalan: fatura/makbuz entegrasyonu, finansal saklama politikası ve gerçek ödeme sağlayıcı kararları.
   - Veliye gösterilecek finans bilgisinin sınırlı ve anlaşılır olması. Kısmi tamamlandı: veli portalı bağlı öğrenci için ödeme planını toplam tutar, bekleyen tutar ve sıradaki taksit/vade/durum özetiyle gösterir; finans izni kapalıysa ödeme tablosunu gizleyip durumu açıkça belirtir.

6. **Sınav/optik operasyon ekranı**
   - Sınav oluşturma, cevap anahtarı, katılımcı listesi, optik yükleme, karantina çözümü, rapor üretme/yayınlama.
   - Gerçek TXT/DAT örnek dosyalarıyla parser fixture'ları.

### P2 - Ölçek, Operasyon ve Kalite

1. **Staging UAT**
   - Kurum admin, öğretmen, öğrenci ve veli için gerçek tarayıcı smoke.
   - Mock Playwright yanında canlı API/DB smoke.

2. **Observability ve destek operasyonu**
   - Job queue izleme.
   - SMS, optik import, rapor üretimi ve dosya upload hataları için operasyon paneli.

3. **KVKK ve güvenlik kanıtları**
   - Gerçek veri envanteri.
   - Finansal saklama süresi kararı.
   - Upload AV sağlayıcı kararı.
   - Production secret ve TR datacenter kanıtı.

4. **Dokümantasyon drift temizliği**
   - `docs/MASTER_PLAN.md` içinde bazı eski ifadeler artık güncel durumu yansıtmıyor.
   - Faz checklist'leri daha güncel görünüyor; kanonik durum tek dosyada sadeleştirilmeli.

## Önerilen Yeni Bilgi Mimarisi

Sol menü düz liste yerine şu hiyerarşiyle düzenlenmeli:

```txt
Kurum
  - Genel Bakış
  - Şubeler / Kampüsler
  - Akademik Yıl ve Dönem

Kişiler
  - Öğrenciler
  - Veliler
  - Öğretmenler
  - Kullanıcılar ve Roller
  - İlişki Haritası

Akademik
  - Sınıflar ve Şubeler
  - Dersler
  - Ders Programı
  - Etütler
  - Devamsızlık
  - Öğretmen Notları
  - Ödev ve Materyaller

Sınav ve Rapor
  - Sınavlar
  - Optik Yükleme
  - Cevap Anahtarları
  - Karantina / Eşleştirme
  - Raporlar
  - Kazanım Analizi

İletişim
  - Duyurular
  - SMS Şablonları
  - SMS Gönderimleri
  - Destek Talepleri

Finans
  - Ödeme Planları
  - Taksitler
  - Gecikmiş Ödemeler

Güvenlik ve Operasyon
  - Denetim Kayıtları
  - Rol Önizleme (tamamlandı: öğretmen/öğrenci/veli portal kapsamı ve erişim kuralı görünümü)
  - KVKK
  - Güvenlik Denetimi (tamamlandı: audit, env, RLS, HTTPS, header/auth/veri kontrol görünümü)
  - Gözlemlenebilirlik (tamamlandı: observability UAT, alert webhook, Sentry smoke, dashboard/alert görünümü)
  - UAT / Rollback (tamamlandı: UAT kanıt sözleşmesi, smoke komutları, rollback image tag ve restore backup referansı görünümü)
  - Release Kanıtı (tamamlandı: production evidence zinciri, SMS ve e-posta/push sağlayıcı smoke adımları, release özeti ve dış ortam kanıt gereksinimleri görünümü)
  - Sistem Sağlığı (tamamlandı: `/health`, `/health/ready`, `/metrics` görünümü)
  - Yedek / Restore Kanıtları (tamamlandı: smoke komutları ve restore drill kanıt sözleşmesi görünümü)
```

Rol portalları ayrı tutulmalı:

```txt
Öğretmen Portalı
Öğrenci Portalı
Veli Portalı
```

Kurum admin bu portalları sol menüde normal rota gibi görmez; `/kurum/rol-onizleme` ekranında portal kapsamını ve erişim şartlarını izler.

## İlk Uygulanacak Backlog

Bu bölüm, geniş planı küçük ve doğrulanabilir işlere indirger.

| Sıra | İş | Başarı Kanıtı |
|---|---|---|
| 1 | `AuthService` için DB-backed login tasarımı ve dar implementasyon | Tamamlandı: `AuthService` store-backed oldu, demo array servis dışına çıktı, `AUTH_USER_STORE=postgres` canlı DB'de User/TenantMembership okur |
| 2 | Kalıcı session/refresh store tasarımı | Tamamlandı: `AUTH_SESSION_STORE=postgres` canlı DB'de refresh rotate, reuse detection ve revoke davranışını doğrular |
| 3 | Kullanıcı ve rol yönetim API'si | Dar kapsam tamamlandı: kurum admin `/tenant-users` ile kendi tenant kullanıcılarını listeler, kullanıcıyı tenant'a bağlar ve tenant içi rolleri günceller; davet ayrı iş |
| 4 | Öğrenci/veli/öğretmen davet akışı | Tamamlandı: davet oluşturma, kabul, süresi dolma, tekrar gönderme ve subject `userId` bağı testleri geçer |
| 4a | Kurum kullanıcı/davet web ekranı | Tamamlandı: `/kurum/kullanicilar` kullanıcı ekleme, rol kaydetme, davet oluşturma ve resend token gösterimini E2E ile doğrular |
| 5 | `identity-link:audit` canlı/staging veride `READY` | Tamamlandı: audit RLS bypass ile tüm tenantları okur; migration 20.015 eksik subject bağını tamamladı; son audit `READY` |
| 6 | Rol bazlı menü | Tamamlandı: kurum admin, öğretmen, öğrenci, veli farklı menü görür; API yetkisi değişmedi |
| 7 | Öğretmen kapsam modeli | Tamamlandı: öğretmen kendi ders/sınıf/öğrenci kapsamı dışında öğrenci listeleme, veli bağlantısı, yoklama, not ve ödev kontrolü yapamaz |
| 7a | Kişi çekirdeği tip sözleşmesi | Tamamlandı: `Class/Teacher/Guardian/GuardianStudent/Student` API controller imzaları `@o-okul/shared-types` ortak tiplerine bağlandı |
| 7b | Program/ödev/destek tip sözleşmesi | Tamamlandı: `ScheduleLesson/StudySession/Homework*/SupportTicket*` API controller imzaları `@o-okul/shared-types` ortak tiplerine bağlandı |
| 7c | Ders ve dönem çekirdeği | Tamamlandı: `Course`, `AcademicYear`, `AcademicTerm` model/API/store, `/kurum/dersler` ve `/kurum/akademik-takvim` ekranları eklendi; `TeacherAssignment`, `ScheduleLesson`, `StudySession`, `Attendance` ve `TeacherNote` `courseId/termId` ile tenant içinde doğrulanıyor |
| 8 | Öğrenci 360 ekranı | Dar kapsam tamamlandı: öğrenci/veli portalları kimlik bağı üstünden profil, devamsızlık, öğretmen notu, ödev-materyal atamaları, son sınav raporu ve hata kitapçığını gösterir; öğrenci portalı veli ilişkisi ile sınıf/kayıt geçmişini, veli portalı bağlı öğrencinin sınıf/kayıt geçmişini gösterir; veli portalı bekleyen ödeme özetini gösterir; kurum içi öğrenci düzenleme ekranı veli/devamsızlık/not/ödev/ödeme/rapor özetini gösterir; kurum içi ayrı 360 route'u sınav/rapor seçici, veli ilişki tipi/izinleri, ilişki geçmişi, öğretmen ilişki rolü/sınıfı/dersi/dönemi, sınıf geçmişi ve denetim özetiyle açılır |
| 9 | Veli ilişki tipi ve izinleri | Tamamlandı: `relationshipType`, `isPrimary`, `canViewFinance`, `canReceiveSms`, `canReceiveAnnouncements`, `canOpenSupportTickets` alanları model/API/web yüzeyinde var; `canViewFinance=false` veli ödeme planı erişimini 403 yapar; ilişki değişikliği audit diff'i PII içermez |
| 10 | Listeleme sözleşmesi | Tamamlandı: `/students`, `/guardians`, `/teachers`, `/classes`, `/tenant-users`, `/identity-invitations`, `/announcements`, `/message-templates`, `/audit-logs`, `/support-tickets`, `/homework` ve `/homework/materials` listeleri `page/limit/q/sort` parametrelerini uygular; `/students` sınıf, seviye, sorumlu öğretmen, kayıt durumu ve veli bağlı mı filtrelerini alır; API zarfı gerçek `total/page/limit/totalPages` metasını taşır; ilgili kurum ekranlarında arama, filtre, sıralama ve sayfa kontrolleri vardır |
| 11 | Form doğrulama sözleşmesi | Tamamlandı: Zod web katmanında açık bağımlılık oldu; sınıf, öğretmen, veli, öğrenci, kullanıcı/davet, optik, rapor, destek bildirimi, destek ek/yorum, duyuru, SMS şablonu ve materyal formları ortak şemayla zorunlu alan/trim kontrolü yapar |
| 12 | TanStack Query ve Next veri sınırı | Tamamlandı: kurum dashboard dahil korumalı web verileri client component içinde `useQuery` + `apiRequest` ile okunur; `/kurum/page.tsx` RSC kabuk olarak kalır ve access token server component'e taşınmaz |
| 13 | Kurum finans ekranı | Tamamlandı: `/kurum/finans` taksit listesi, bekleyen/gecikmiş/ödenen özetleri, akademik bağlam filtreleri ve taksit durum aksiyonları Playwright kurum smoke'unda doğrulanır |
| 14 | Kurum rol önizleme ekranı | Tamamlandı: `/kurum/rol-onizleme` öğretmen/öğrenci/veli portal kapsamını, kişi hesabı şartını, erişim kurallarını ve kanıt komutlarını gösterir; Playwright kurum smoke'unda doğrulanır |
| 15 | Kurum güvenlik denetimi ekranı | Tamamlandı: `/kurum/guvenlik-denetimi` security audit, production env, canlı RLS, HTTPS smoke, header, auth ve veri kontrol kapılarını gösterir; Playwright kurum smoke'unda doğrulanır |
| 16 | Kurum gözlemlenebilirlik ekranı | Tamamlandı: `/kurum/gozlemlenebilirlik` observability UAT, alert webhook, Sentry smoke, dashboard panelleri ve alert kurallarını gösterir; Playwright kurum smoke'unda doğrulanır |
| 17 | Kurum UAT/rollback kanıt ekranı | Tamamlandı: `/kurum/uat-rollback` staging/prod UAT kanıt sözleşmesi, UAT akışları, zorunlu smoke komutları, rollback image tag ve restore backup referansını gösterir; Playwright kurum smoke'unda doğrulanır |
| 18 | Kurum release kanıtı ekranı | Tamamlandı: `/kurum/canli-yayin` production evidence zinciri, SMS ve e-posta/push sağlayıcı smoke adımları, release özet alanları ve staging/prod dış ortam kanıt gereksinimlerini gösterir; Playwright kurum smoke'unda doğrulanır |
| 19 | Kurum sistem sağlığı ekranı | Tamamlandı: `/kurum/sistem-sagligi` API yaşam, readiness, Postgres/Redis ve metrics uptime sinyallerini gösterir; Playwright kurum smoke'unda doğrulanır |
| 20 | Kurum yedek/restore kanıt ekranı | Tamamlandı: `/kurum/yedek-restore` backup/restore smoke, off-host/WAL hedef smoke, restore drill kanıt sözleşmesi ve kritik restore tablolarını gösterir; Playwright kurum smoke'unda doğrulanır |

## Geliştirme Planı

### Faz 1 - Kimlik, Yetki ve Menü Temizliği

Hedef: Kullanıcı ve rol temeli gerçek kurum kullanımına hazır hale gelsin.

İşler:

1. DB-backed auth'a geç. Tamamlandı: store altyapısı, Postgres kullanıcı okuma yolu, kalıcı session store ve şifre reset akışı canlı smoke ile doğrulandı.
2. Kullanıcı, rol ve tenant membership yönetim API'si ekle. Tamamlandı: API ve kurum web ekranı doğrulandı.
3. Öğrenci/veli/öğretmen için davet ve aktivasyon modeli ekle. Tamamlandı: API, canlı Postgres smoke ve kurum web ekranı var; operasyon metinleri açık.
4. `identity-link:audit` sonucunu staging veride `READY` yap. Tamamlandı: `identity-link:migrate` sonrası canlı DB audit `READY`.
5. Role göre sol menüyü filtrele ve kurum menüsünü ürün hiyerarşisine göre grupla. Tamamlandı; kalan iş yeni modüller geldikçe grupları genişletmek.
6. Yetki modelini route decorator yerine "kaynak + işlem + kapsam" olarak dokümante et.

Doğrulama:

- Yanlış rol, başka tenant, bağlı olmayan öğrenci, öğretmen kapsam dışı öğrenci testleri.
- DB auth ile login smoke.
- Web login, role menu, kullanıcı/davet ekranı ve `/me/profile` smoke.
- `identity-link:audit` staging/canlı DB'de `READY`.

### Faz 2 - Kişi ve İlişki Modülü

Hedef: Öğrenci, veli ve öğretmen ilişkileri ürünün merkezi olsun.

İşler:

1. Veli ilişki tipi: anne, baba, vasi, acil kişi, ödeme sorumlusu, birincil iletişim. Tamamlandı: `GuardianStudent.relationshipType/isPrimary`.
2. Veli izinleri: ödeme görünümü, SMS alma, duyuru alma, destek bildirimi açma. Tamamlandı: `canViewFinance/canReceiveSms/canReceiveAnnouncements/canOpenSupportTickets`; ödeme görünümü ve destek talebi açma API'de davranışa bağlandı, veli portalı ilişki tipini, birincil kişi bilgisini, ödeme görünümünü ve SMS/duyuru/destek tercihlerini bağlı öğrenci kapsamında gösterip güncelliyor.
3. Öğretmen ilişki tipi: sınıf öğretmeni, branş öğretmeni, rehber/sorumlu öğretmen. Tamamlandı: `TeacherAssignment.role` ve sınıf/öğrenci/ders/dönem ataması eklendi; kurum admin öğretmen ekranında atama ekleme/silme var; öğrenci listesi/detayı ve öğrenci 360 detayında okunur ilişki bağlamı görünür.
4. Öğrenci sınıf geçmişi, enrollment ve kayıt durumu. Genişledi: `Student.status` aktif, pasif, mezun ve nakil durumlarını taşır; akademik yıl/dönem bağlamlı `StudentClassHistory` oluşturma/sınıf değiştirme geçmişini güncelliyor; `StudentEnrollment` ilk kayıt, kayıt yenileme, kurum içi nakil ve toplu dönem geçişi geçmişini tutuyor; mezun/nakil aktif sınıf geçmişini ve enrollment kaydını kapatıyor; kurum öğrenci modalında kayıt yenileme/nakil aksiyonları, öğrenci listesinde manuel veya otomatik seviye yükseltmeli toplu dönem geçişi çalışır, web listesi, 360 detayı, öğrenci portalı, veli portalı ve öğretmen portalında seçili öğrenci için görünür.
5. İlişki değişikliklerini ilişki tipi/izin diff'iyle audit'e bağla. Tamamlandı: veli-öğrenci ilişki değişiklikleri PII içermeyen alan adı diff'iyle audit'e yazılıyor.

Doğrulama:

- Veli yalnız bağlı öğrenci görür.
- Öğretmen yalnız kapsamındaki öğrenci görür.
- Öğrenci profilinde tüm ilişkiler doğru görünür.
- Veli ilişki izinleri finans, SMS ve portal görünümünü etkiler.

### Faz 3 - Akademik Operasyon

Hedef: Kurumun günlük eğitim operasyonu ekrandan yönetilebilsin.

İşler:

1. Ders, kampüs, seviye, şube, akademik yıl ve dönem modelleri. Kısmi: `Course`, `Campus`, `GradeLevel`, `AcademicYear`, `AcademicTerm` modeli/API'si, kurum ders/kampüs/seviye/akademik takvim ekranı ve program/etüt/öğretmen ataması/devamsızlık/not/materyal atama bağlantısı eklendi; öğretmen ataması web ekranında ve öğretmen portalı materyal atamasında ders/dönem seçimi payload'a bağlandı.
2. Ders programı ve etüt ekranları. Tamamlandı: kurum `/kurum/program` ve `/kurum/etutler` ekranları CRUD, arama, sıralama ve seçim listeleriyle çalışır.
3. Devamsızlık ekranı: sınıf/ders bazlı giriş. Tamamlandı: kurum `/kurum/devamsizlik` ekranı öğrenci/sınıf/ders/dönem bağlamıyla CRUD yapıyor ve listeyi öğrenci sınıfına göre filtreliyor; öğretmen portalı seçili kapsam öğrencisine ders/dönem seçimiyle yoklama kaydı ekliyor.
4. Öğretmen notları ekranı: iç not ve veli/öğrenciye açık not ayrımı. Tamamlandı: kurum `/kurum/notlar` ekranı öğrenci/sınıf/öğretmen/ders/dönem/görünürlük bağlamıyla CRUD yapıyor ve listeyi öğrenci sınıfına göre filtreliyor; öğretmen portalı ders/dönem ve görünürlük seçimiyle not ekliyor.
5. Ödev, materyal, destek ve rapor ekranlarının öğretmen portalına taşınması. Kısmi: öğretmen ödev kontrolü, seçili öğrenciye ders/dönem bağlamlı materyal atama, kendi destek talepleri, ders/dönem bağlamlı öğrenci raporu ve kapsamındaki sınıf raporu portala taşındı.

Doğrulama:

- Öğretmen kendi dersi için yoklama girer, başka öğretmenin dersi için giremez.
- Veli/öğrenci yalnız görünür notları görür.
- Kurum admin tüm tenant akademik operasyonu görür.
- Ders programı ve etüt çakışma testleri öğretmen ve öğrenci için çalışır.

### Faz 4 - Sınav, Optik ve Rapor Ürünü

Hedef: Kurumun sınav operasyonu uçtan uca tamam olsun.

İşler:

1. Sınav oluşturma ve yayınlama ekranı.
2. Katılımcı listesi ve sınıf/öğrenci seçimi.
3. Cevap anahtarı UI.
4. Optik dosya yükleme, format önerisi, onay, karantina çözümü.
5. Rapor üretme, yayınlama, Excel/PDF indirme.
6. Öğrenci/veli portalında rapor, hata kitapçığı ve gelişim grafiği. Kısmi tamamlandı: portallar son raporu, hata kitapçığı özetini, gelişim grafiğini ve ders/dönem bağlamını gösterir.
7. Gerçek TXT/DAT örnekleriyle parser testleri.

Doğrulama:

- Aynı dosya tekrar yüklenince idempotent davranır.
- Yanlış/eksik optik satırı karantinaya düşer.
- Öğrenci/veli sadece kendi raporunu görür.
- Rapor snapshot yeniden üretilebilir.
- Gerçek TXT/DAT örneği repo fixture'ı olarak saklanır; parser değişince regresyon testi çalışır.

### Faz 5 - Finans, İletişim ve Destek

Hedef: Kurum yönetiminde ödeme, bildirim ve destek akışları tamam olsun.

İşler:

1. Ödeme planı ve taksit yönetim ekranı. Tamamlandı: `/kurum/finans` ekranı ödeme planı taksitlerini, gecikmiş ödeme özetini, akademik bağlam filtresini ve durum aksiyonlarını gösterir.
2. Veli portalında ödeme görünümü.
3. SMS gönderim ekranı: şablon, alıcı filtresi, gönderim önizleme. Kısmi: SMS batch teslim raporu `SmsBatchDeliveryReport` ve `GET /sms-batches/:jobId` ile başladı; worker sonucu bu rapora `completed/failed`, gönderilen/başarısız adet ve segment toplamı olarak yazılıyor; `POST /sms-batches/recipients/preview` duyuru hedefinden veya gerçek öğrenci/sınıf/kampüs/seviye/ders/dönem filtresinden SMS izni olan veli telefonlarını üretir; kurum `/kurum/sablonlar` ekranı bu filtreyle gönderim, önizleme ve teslim raporu gösteriyor; kurum `/kurum/duyurular` ekranı veli/öğrenci/tüm okul duyurusundan seçili SMS şablonuyla batch başlatıyor. E-posta/push için `AnnouncementDeliveryReport` rapor zemini, `POST /announcements/:id/delivery-results` sağlayıcı sonucu queue girişi, `announcement-delivery` worker yazma akışı, `@o-okul/notification-adapter` sağlayıcı sözleşmesi, `POST /announcements/:id/deliveries` gönderim tetikleyicisi, `/me/notification-devices` cihaz token yüzeyi ve Next `Bildirim cihazı` paneli başladı. Kalan iş gerçek credential smoke almaktır. Veli SMS alma tercihi portalda güncellenir.
4. Netgsm staging/canlı smoke.
5. Öğrenci ve veli destek talebi açabilsin. Tamamlandı: öğrenci kendi portalından, veli ise `canOpenSupportTickets=true` bağlı öğrenci için portalından destek talebi açar; destek kaydı `studentId` yanında kampüs/seviye/sınıf/ders/dönem bağlamı taşır.
6. Duyuru hedef kitlesi genişlesin: sınıf, seviye, öğretmen, veli, öğrenci. Kısmi tamamlandı: kurum duyuru kaydı hedef türü ve kampüs/seviye/sınıf/ders/dönem kapsamı taşır; öğrenci/veli/öğretmen portal okuma yüzeyleri hedefe göre çalışır; portal okundu bilgisi kalıcıdır; kurum admin alıcı/okunma raporunu ve EMAIL/PUSH dış bildirim teslim özetini görür; sağlayıcı teslim sonucu API üzerinden `announcement-delivery` kuyruğuna alınır ve worker teslim özetini rapora yazar; EMAIL gönderimi adapter üzerinden gerçek duyuru alıcı e-postalarına, PUSH gönderimi aktif cihaz tokenlarına bağlandı; web istemcisi push aboneliğini cihaz tokenı olarak kaydeder. Kalan iş gerçek sağlayıcı smoke'udur.

Doğrulama:

- Öğretmen ödeme verisini göremez.
- SMS gerçek sağlayıcıda kontrollü smoke ile doğrulanır.
- Destek talebi her rolde doğru kapsama düşer. Tamamlandı: kurum, öğretmen, öğrenci ve izinli veli akışları kampüs/seviye/sınıf/ders/dönem bağlamı ve filtreleriyle test edildi; öğretmen seçili öğrenci/sınıf/ders/dönem bağlamıyla talep açar ve kapsam dışı sınıf bağlamı 403 döner.
- Duyuru hedef kitlesi sınıf/seviye/rol filtreleriyle doğru alıcıya düşer. Kısmi: portal okuma yüzeyi hedefe göre çalışır, okundu bilgisi kalıcıdır, kurum raporu ve EMAIL/PUSH teslim özeti vardır; kalan iş gerçek sağlayıcı smoke'udur.

### Faz 6 - Production Readiness

Hedef: Canlıya çıkış kanıtla yapılabilsin.

İşler:

1. `.env` ve `.env.example` drift temizliği; local defaultlar anlaşılır hale gelsin.
2. In-memory store kullanımı sadece test/demo ile sınırlansın.
3. Staging seed ve UAT verisi oluşturulsun.
4. Canlı DB RLS, backup, restore, observability, KVKK ve security audit kanıtları üretilsin.
5. Büyük liste ve rapor performans testleri tamamlansın.

Doğrulama:

- `pnpm run ci`
- `pnpm live:smoke`
- `pnpm prod:evidence:check`
- Staging role UAT: kurum admin, öğretmen, öğrenci, veli.
- `identity-link:audit` -> `READY`

## Başarı Kriteri

Uygulama "tamamlandı" demek için şu şartlar birlikte sağlanmalı:

1. Her kullanıcı gerçek DB kullanıcısıdır; demo auth production yolunda yoktur.
2. Her kişi kaydı doğru kullanıcı ve rol membership ile bağlıdır.
3. Öğretmen, öğrenci ve veli kişi düzeyi yetki testleri tüm hassas endpointlerde geçer.
4. Kurum admin ekranları ana operasyonları kapsar: kişi, sınıf, program, yoklama, sınav, rapor, ödeme, iletişim, destek, KVKK.
5. Öğretmen portalı günlük öğretmen işlerini yaptırır.
6. Öğrenci ve veli portalları yalnız kendi verilerini gösterir.
7. Büyük listeler sayfalama/arama/filtre ile çalışır.
8. Staging ortamında canlı API/DB/worker smoke ve rol bazlı UAT geçer.
9. Production evidence zinciri gerçek kanıtlarla geçer; sadece örnek JSON ile değil.
10. Ana dokümanlar güncel durumla çelişmez; `MASTER_PLAN`, faz checklist'leri ve bu değerlendirme aynı kalan işleri gösterir.

## Dokümantasyon Temizliği Notu

`docs/MASTER_PLAN.md` içinde bazı eski ifadeler, checklist dosyalarına göre geride kalmış görünüyor. Bu rapor tamamlanma planı için güncel çalışma notu olarak kullanılabilir; ancak kalıcı doğruluk için şu dosyalar bir sonraki dokümantasyon turunda eşitlenmeli:

- `docs/MASTER_PLAN.md`
- `docs/phase-a-checklist.md`
- `docs/phase-d-checklist.md`
- `docs/phase-e-checklist.md`
- `docs/phase-6-production-readiness.md`

Eşitleme hedefi: "teknik dilim tamamlandı", "ürün/ops onayı bekliyor", "canlı/staging kanıtı eksik" ayrımlarının her dosyada aynı görünmesi.
