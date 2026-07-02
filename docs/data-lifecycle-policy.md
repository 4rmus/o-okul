# Veri Yaşam Döngüsü Politikası (Soft-Delete / Hard-Delete)

Bu doküman, tenant verisinde silme davranışının hangi kurala göre seçildiğini tanımlar.
Yeni tablo eklerken bu kurala uyulur; istisna gerekiyorsa PR açıklamasında gerekçelendirilir.

## Kural

| Kategori | Davranış | Gerekçe |
| --- | --- | --- |
| **Ana varlıklar** (kişi, katalog, finans planı) | Soft-delete (`deletedAt`) | Geri alınabilirlik, referans bütünlüğü ve KVKK purge akışlarının (`purge-pii`) ayrı yönetimi |
| **Bağ/olay tabloları** (ilişki ve zaman-serisi kayıtları) | Hard-delete + zorunlu audit-log kaydı | Bağ kayıtları tekrar kurulabilir; olay kayıtları için silme izi `AuditLog`'da tutulur |
| **Global auth altyapısı** | Hard-delete, tenant RLS dışı | Global `User` kimliğine bağlıdır (sistem kullanıcıları dahil); ayrıntı için `packages/db/scripts/tenant-models.mjs` notuna bakınız |

## Mevcut eşleme

- **Soft-delete (`deletedAt`)**: `Student`, `Teacher`, `Guardian`, `Class`, `Course`, `GradeLevel`, `Alan`, `Campus`, `AcademicYear`, `AcademicTerm`, `PaymentPlan`, `PaymentInstallment`, `Exam` ve türevleri, `Homework`/`HomeworkMaterial`, `Announcement`, `MessageTemplate`, `SupportTicket`.
- **Hard-delete + audit**: `GuardianStudent` (`guardian_student.unlinked`), `TeacherAssignment` (`teacher_assignment.deleted`), `Attendance` (`attendance.deleted`), `TeacherNote` (`teacher_note.deleted`), `StudentEnrollment` (silinmez; terminal durumda `endsAt` ile kapatılır ve `student.enrollment_*` audit kayıtları yazılır).
- **Global auth (RLS dışı)**: `PasswordResetToken`, `ConsumedRefreshToken`; `AuditLog` bilinçli olarak globaldir.

## Uygulama notları

- Soft-delete tablolarında her sorgu `deletedAt IS NULL` filtreler; RLS zorunluluğu `tenantId` kolonundan türetilir (`packages/db/scripts/check-rls.mjs`).
- Hard-delete yolu ekleyen her servis, silmeyi `AuditLogService.record` ile `entityType` + `action` vererek loglar; örnek desen: `apps/api/src/school/school.service.ts` içindeki `deleteTeacherAssignment`.
- KVKK kişisel veri temizliği soft-delete'ten bağımsızdır: `purge-pii` uçları PII kolonlarını maskeleyip kaydın iskeletini korur.
