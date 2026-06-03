# Faz C Uygulama Checklist'i

Bu dosya `MASTER_PLAN.md` §10.4 ve §10.6 Faz C kapsamını küçük, doğrulanabilir parçalara böler.

## Varsayımlar

- Faz A/B kapıları korunur; yeni modüller mevcut auth, tenant context, RLS ve audit log desenini kullanır.
- Faz C önce backend boşluklarını kapatır; frontend ekranları backend sözleşmesi netleştikçe eklenir.
- Öğretmen-sınıf sahipliği ayrı veri modeli gerektirdiği için ilk M1 turunda öğretmen yazma yetkisi tenant içi tutulur; öğrenci/veli okuması kişi düzeyinde sınırlandırılır.

## Kapsam Dışı

- Fatura/ödeme entegrasyonu.
- TC kimlik için zayıf veya deterministik şifreleme.
- Kazanım seed verisi olmadan kapsamlı müfredat ekranı.
- Vite artefakt sökümü; bu Faz E işidir.

## Faz C Durum Denetimi

| Modül | Mevcut durum | Sonraki kanıt |
|---|---|---|
| M1 Devamsızlık | Tamamlandı: `Attendance(studentId,date,status)` backend, kurum/öğretmen yazma akışı, özet endpointleri ve kişi düzeyi `/me` okuma yüzeyi eklendi | `pnpm --filter @uzman-hocam/api exec vitest run src/attendance/attendance.e2e.test.ts`, `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts`, `pnpm --filter @uzman-hocam/db test` |
| M5 Öğretmen notu | Tamamlandı: `TeacherNote(studentId,teacherId,visibility,body,developmentStatus)` backend, kurum/öğretmen yazma akışı ve öğrenci/veli için `GUARDIAN_STUDENT` filtreli `/me` okuma yüzeyi eklendi | `pnpm --filter @uzman-hocam/api exec vitest run src/teacher-note/teacher-note.e2e.test.ts`, `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts`, `pnpm --filter @uzman-hocam/db test` |
| M4 Profil + TC | Tamamlandı: öğrenci profil alanları, TC algoritma doğrulama, non-deterministic AES-256-GCM saklama, HMAC hash benzersizliği, maskeli okuma ve profil görüntüleme audit'i eklendi | `pnpm --filter @uzman-hocam/api exec vitest run src/student/tc-identity.test.ts src/student/student-profile.e2e.test.ts src/app.e2e.test.ts`, `pnpm --filter @uzman-hocam/db test`, `pnpm prod:readiness:check` |
| M2 Ödeme planı | Genişledi: `PaymentPlan + PaymentInstallment` backend, kurum oluşturma/listeme akışı, veli kişi düzeyi `/me` okuma yüzeyi, öğretmen/öğrenci 403 ve Postgres/RLS zemini var; ödeme planı öğrenci sınıfından kampüs/seviye/sınıf bağlamını miras alır, isteğe bağlı ders/dönem bağlamını taşır, kurum listesi bu alanlarla filtrelenir; kurum admin taksit tutarı/vadesini düzenler ve taksidi `PAID/OVERDUE/PENDING/CANCELED` olarak işaretler; `/kurum/finans` ekranı bekleyen/gecikmiş/ödenen özetini ve taksit durum aksiyonlarını gösterir | `pnpm --filter @uzman-hocam/api exec vitest run src/payment/payment.e2e.test.ts src/payment/payment-store.test.ts`, `pnpm --filter @uzman-hocam/api exec vitest run src/me/me-access-matrix.e2e.test.ts`, `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts`, `pnpm --filter @uzman-hocam/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"`, `pnpm --filter @uzman-hocam/db run db:rls:check`, `pnpm prod:readiness:check` |
| M3 Kazanım | Tamamlandı: `LearningOutcome` RLS tablosu ve seed zemini, `AnswerKeyItem.outcomeCode`, ScoringEngine kazanım kırılımı, ReportSnapshot öğrenci/toplam kazanım alanları ve error-booklet `outcomeCode` taşıması eklendi | `pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/scoring-engine.test.ts src/jobs/report-generation-job.test.ts src/jobs/exam-evaluation-job.test.ts src/jobs/postgres-exam-evaluation-adapter.test.ts src/queue/bullmq-worker.test.ts`, `pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts src/report/report-generation.controller.e2e.test.ts`, `pnpm --filter @uzman-hocam/db test` |

## Kalite Kapıları

| Kapı | Beklenen sonuç | Kanıt |
|---|---|---|
| M1 RLS | `Attendance` tenant tablosu RLS enabled/forced ve app rol grant kontrolüne girer | Geçti: `pnpm --filter @uzman-hocam/db test` |
| M1 kişi düzeyi okuma | Öğrenci yalnız kendi devamsızlığını, veli yalnız bağlı öğrencinin devamsızlığını görür | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts` |
| M1 kurum/öğretmen yazma | Kurum/öğretmen tenant içi öğrenci için devamsızlık kaydı oluşturur/günceller; başka tenant reddedilir | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/attendance/attendance.e2e.test.ts` |
| M1 özet | Öğrenci bazlı özet endpoint durum sayılarını döner | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/attendance/attendance.e2e.test.ts`, `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts` |
| M5 RLS | `TeacherNote` tenant tablosu RLS enabled/forced ve app rol grant kontrolüne girer | Geçti: `pnpm --filter @uzman-hocam/db test` |
| M5 INTERNAL sızıntı | Öğrenci ve veli `/me` notlarında `INTERNAL` kayıt görünmez; yalnız `GUARDIAN_STUDENT` döner | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/app.e2e.test.ts` |
| M5 kurum/öğretmen yazma | Kurum/öğretmen tenant içi öğrenci için not oluşturur/günceller/siler; başka tenant öğrenci/öğretmen reddedilir | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/teacher-note/teacher-note.e2e.test.ts` |
| M4 TC algoritma | Geçersiz TC `422`, geçerli TC kabul edilir | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/student/tc-identity.test.ts src/student/student-profile.e2e.test.ts` |
| M4 şifreleme/hash | Aynı TC iki farklı AES-GCM ciphertext üretir; HMAC hash tenant içi benzersizliği korur | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/student/tc-identity.test.ts src/student/student-profile.e2e.test.ts` |
| M4 maskeleme/audit | Öğrenci/veli profil cevapları ham TC içermez; profil görüntüleme audit diff'i ham TC içermez | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/student/student-profile.e2e.test.ts src/app.e2e.test.ts` |
| M2 RLS | `PaymentPlan` ve `PaymentInstallment` tenant tabloları RLS enabled/forced ve app rol grant kontrolüne girer | Geçti: `pnpm --filter @uzman-hocam/db test` |
| M2 kurum oluşturma | Kurum tenant içi öğrenciye ödeme planı/taksit oluşturur; ödeme planı kampüs/seviye/sınıf/ders/dönem bağlamı taşır; başka tenant öğrencisi reddedilir | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/payment/payment.e2e.test.ts src/payment/payment-store.test.ts` |
| M2 taksit düzenleme ve ödeme işaretleme | Kurum tenant içi ödeme taksidinin tutarını/vadesini düzenler, taksidi ödendi/gecikmiş/bekleyen/iptal olarak işaretler; öğretmen, öğrenci ve başka tenant planı reddedilir | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/payment/payment.e2e.test.ts src/payment/payment-store.test.ts` |
| M2 kurum finans ekranı | Kurum menüsünde ayrı Finans grubu vardır; ödeme ekranı akademik bağlamı, gecikmiş taksiti, özet tutarları ve taksit durum güncellemesini gösterir | Geçti: `pnpm --filter @uzman-hocam/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g "Next login gerçek auth store ile kurum paneline geçer"` |
| M2 veli okuma | Veli yalnız bağlı öğrencinin ödeme planını görür; bağlı olmayan öğrenci reddedilir | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/payment/payment.e2e.test.ts src/app.e2e.test.ts` |
| M2 hiyerarşi tuzağı | Öğretmen ve öğrenci hem kurum endpointinden hem veli `/me` yüzeyinden 403 alır | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/payment/payment.e2e.test.ts` |
| M3 RLS | `LearningOutcome` tenant tablosu RLS enabled/forced ve app rol grant kontrolüne girer | Geçti: `pnpm --filter @uzman-hocam/db test` |
| M3 scoring determinizmi | `outcomeCode` aynı girdiyle bit-aynı kazanım kırılımı ve soru satırı üretir | Geçti: `pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/scoring-engine.test.ts` |
| M3 report snapshot | Kazanım kırılımı snapshot geneline ve öğrenci satırına taşınır | Geçti: `pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/report-generation-job.test.ts` |
| M3 error-booklet | Yanlış/boş soru satırı `outcomeCode` bilgisini korur | Geçti: `pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts src/report/report-generation.controller.e2e.test.ts` |

## Sonraki Uygulama Sırası

1. Faz D negatif erişim matrisi.
2. Faz E deploy/temizlik kapıları.
