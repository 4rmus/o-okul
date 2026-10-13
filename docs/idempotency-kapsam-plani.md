# Idempotency Kapsam Planı

Tarih: 2026-10-13
Başlangıç sürümü: `main` / `26b3bb8da`
Durum: Plan. Uygulama ürün sahibi onayı bekler. Yeni özellik değildir; mevcut değiştiren
endpoint'lerin tekrar dayanıklılığını düzeltir. DEC-20261010-01 kapsamında güvenilirlik işi olarak
önerilir.
Kanıt sınıfı: Aksi yazılmadıkça LOCAL_STATIC (kod ve şema okuması). Hiçbir test çalıştırılmadı.

## 1. Bağlam

`scripts/check-idempotency-inventory.mjs` (#170) API'deki 180 değiştiren endpoint'i tarar. 55'i
Idempotency-Key kullanır; kalan 125'i `knownNonIdempotentMutations` istisna listesindedir. Liste
2026-10-13 main durumundan otomatik üretildi ve tek tek incelenmedi. Bu plan o 125 endpoint'i
inceler ve her birine bir sınıf atar.

Tekrar riski kullanıcı ve ağ kaynaklıdır: çift tıklama, zaman aşımından sonra yeniden gönderme,
kopan mobil/PWA bağlantısı. Web istemcisi değiştiren istekleri otomatik tekrar denemez.

## 2. Sınıflar ve sonuç

| Sınıf | Anlamı | Karar | Sayı |
|---|---|---|---|
| A | Tekrar ikinci bir kayıt açar ya da dış yan etkiyi (e-posta) tekrarlar; doğal tekillik yok | Düzeltilir (Idempotency-Key veya kök düzeltme) | 19 |
| B | Veritabanı tekilliği, upsert veya kilitli varlık kontrolü ikinci kaydı engeller | Listede kalır, gerekçe yazılır | 9 |
| C | Doğal olarak tekrara dayanıklı: değere set eden güncelleme, silme, okundu işareti | Listede kalır, gerekçe yazılır | 63 |
| D | Idempotency-Key kapsamı dışında: giriş/oturum akışı, yazmayan önizleme, kendi tekrar koruması olan tek kullanımlık işlem | Listede kalır, gerekçe yazılır | 34 |

Önceki sohbet notlarındaki iki varsayım kod okumasıyla düzeltildi:
- `POST /tenants/:id/license-terms` korunuyor: `LicenseTerm_no_active_overlap` EXCLUDE kısıtı aynı
  aralıktaki ikinci dönemi engelliyor ve istek 400 `LICENSE_TERM_OVERLAP` alıyor (migration
  `20260801190000`, `tenant.service.ts:230`). Sınıf B.
- Ödev oluşturma veliye bildirim göndermiyor (`homework.service.ts:442-501` yalnızca satır ve audit
  yazar). Çift ödev yine de öğrenci ve veliye görünür; sınıf A kalır.

## 3. Uygulama dilimleri

Dilimler tek branch'te ayrı commit'lerdir ve tek PR'da birleşir.

### Dilim 1. Ortak kök düzeltmeler

1. **Bekleyen davet tekilliği.** `IdentityInvitation` için bekleyen davet tekil indeksi bugün yalnız
   `EMPLOYEE` (migration `20260810114500:36`) ve öğrenci kodu (`20260801240000:19`) için var.
   Öğretmen, öğrenci e-posta bağlantısı ve veli davetleri için yok. Aynı kalıpla `subjectType` başına
   kısmi tekil indeks eklenir; servis `23505`'i mevcut `ALREADY_PENDING` hatasına çevirir.
   Kapattığı A endpoint'leri:
   - `identity-invitation @Post()`: tekrar ikinci davet ve ikinci aktivasyon e-postası açıyor.
   - `teachers @Patch(":id")`: hesabı olmayan öğretmende gövdede `email` varsa her PATCH yeni davet
     ve e-posta oluşturuyor (`teacher.service.ts:178` → `identity-invitation-store.ts:165-188`).
   Ön koşul: staging verisinde aynı kişiye ait birden fazla `PENDING` davet varsa migration düşer.
   Migration'dan önce sayım yapılır; temizlik gerekiyorsa ayrı onay alınır.
2. **Tekillik ihlali 500 yerine 409.** B sınıfı okul oluşturma uçları tekrar edildiğinde tekil
   indekse çarpıyor ve istemci 500 alıyor (`http/api-error.filter.ts` yalnız `P0001`'i eşliyor).
   Veri doğru kalıyor ama kullanıcı başarılı bir işlemden sonra hata görüyor. `23505` filtrede
   409 `CONFLICT` olarak eşlenir. Tek merkezi değişiklik; mevcut özel `23505` yakalamaları
   (`class-store.ts`, `school.service.ts:877`) korunur.

### Dilim 2. Idempotency-Key eklenecek 17 endpoint

Mevcut kalıp kullanılır (`IdempotencyService.run`, `@Headers("idempotency-key")`, OpenAPI
`idempotent: true`, web istemcisinde anahtar üretimi, bir e2e tekrar testi). Her endpoint envantere
taşınır ve istisna listesinden çıkar.

| # | Endpoint | Tekrarda ne olur | Not |
|---|---|---|---|
| 1 | `identity-invitation @Post(":id/resend")` | Token yeniden döner, ikinci e-posta gider; ilk bağlantı bozulur | `identity-invitation-store.ts:232,315` |
| 2 | `support-ticket @Post()` | Çift destek talebi | Düz INSERT, `support-ticket-store.ts:213` |
| 3 | `me @Post("student/support-tickets")` | Çift destek talebi | Aynı store |
| 4 | `me @Post("guardian/students/:studentId/support-tickets")` | Çift destek talebi | Aynı store |
| 5 | `me @Post("teacher/support-tickets")` | Çift destek talebi | Aynı store |
| 6 | `user-management @Post()` | `employeeNo` boşsa çift çalışan kaydı | Tekil indeks yalnız `employeeNo` doluysa çalışır |
| 7 | `message-template @Post()` | Çift şablon | Tekillik yok |
| 8 | `teacher-note @Post()` | Çift öğretmen notu; veli ve öğrenciye görünebilir | Tekillik yok |
| 9 | `gradebook @Post()` | Çift değerlendirme sütunu | Yayın zaten anahtarlı (`gradebook.service.ts:145`) |
| 10 | `homework @Post()` | Çift ödev; sınıfa görünür | Tekillik yok |
| 11 | `homework @Post("from-material")` | Çift ödev | `sourceMaterialId` yalnız indeks |
| 12 | `homework @Post("materials")` | Çift materyal | Tekillik yok |
| 13 | `development @Post("criteria")` | Çift kriter; tüm formlarda görünür | Tekillik yok |
| 14 | `development @Post("assessments")` | Çift değerlendirme ve puan seti; veli trendinde görünür | Ayrıca bkz. 5.1 |
| 15 | `alanlar @Post()` | `code` boşsa çift alan | Tekil indeks NULL kodda çalışmaz |
| 16 | `campuses @Post()` | `code` boşsa çift kampüs | Aynı |
| 17 | `grade-levels @Post()` | `code` boşsa çift seviye | Aynı |

15–17 için alternatif: `code` zorunlu yapılır ve endpoint B'ye geçer. Bu, mevcut formları ve
içe aktarmayı etkiler; ürün kararı gerekir (açık soru 6.3).

### Dilim 3. İstisna listesine gerekçe

`knownNonIdempotentMutations` dizi yerine `{ token: "B|C|D: gerekçe" }` haritasına çevrilir. Kontrol
gerekçesiz kaydı reddeder. Gerekçeler bu plandaki 4. bölümden alınır.

### Dilim 4. `IdempotencyKey` saklama süresi

`IdempotencyKey.expiresAt` hiç doldurulmuyor ve tamamlanmış kayıtları silen bir iş yok
(`apps/api/src/http/idempotency.ts`; tek `DELETE` başarısız isteği bırakmak için). Tamamlanmış
kayıtlar `responseBody` ile birlikte kurum lisans sonu imhasına kadar kalıyor (DEC-20261005-03,
`docs/DECISIONS.md:1129`). `responseBody` kişisel veri içerebilir ve öğrenci/öğretmen/veli
`purge-pii` işlemleri bu kopyalara dokunmuyor.

Öneri: `expiresAt` başlangıçta yazılır ve worker süresi geçmiş kayıtları siler. Süre ürün ve KVKK
kararıdır (açık soru 6.1). Dilim 2 kapsamı genişlettiği için bu dilim onunla birlikte gelmelidir.

İki endpoint bilerek anahtarsız kalır, çünkü yanıtı saklamak zararlı olur:
- `student @Post(":id/portal-invitations")` düz metin aktivasyon kodu döndürür.
- `tenant @Post(":id/purge-exports")` kurumun tüm verisini döndürür; controller yorumu verinin
  önbelleğe alınmadığını söyler (`tenant.controller.ts:57`).

## 4. Endpoint listesi

Yol `apps/api/src` göreli. Dosya:satır kanıtları alt ajan incelemesinden; LOCAL_STATIC.

### 4.1 Giriş, oturum ve hesap (`auth`, `me`, `privacy`, `role-preview`)

| Endpoint | Sınıf | Gerekçe |
|---|---|---|
| `auth @Post("login")` | D | Giriş akışı; tenant bağlamı yok (`idempotency.ts:49`), fazladan oturum `/me/sessions`'da görünür |
| `auth @Post("login/select")` | D | İmzalı seçim token'lı giriş akışı |
| `auth @Post("totp/verify")` | D | TOTP sayacı tekrarı reddeder (`auth-user-store.ts:905`) |
| `auth @Post("totp/enrollment/confirm")` | D | Tek kullanımlık kurulum token'ı + CAS güncelleme (`auth-user-store.ts:699`) |
| `auth @Post("refresh")` | D | Token rotasyonu kendi tekrar tespitini yapar (`token-service.ts:91`); bkz. 5.2 |
| `auth @Post("persona/switch")` | D | Eski oturum değişir; tekrar `PERSONA_ALREADY_ACTIVE` |
| `auth @Post("logout")` | D | İkinci çağrı iptal edecek oturum bulmaz |
| `auth @Post("password-reset/request")` | D | Yeniden gönderme penceresi ikinci e-postayı engeller (`password-reset-store.ts:172`) |
| `auth @Post("password-reset/confirm")` | D | Tek kullanımlık token; tekrar 400 |
| `auth @Post("totp/setup")` | D | Yalnız audit; taslak sır imzalı token'da |
| `auth @Post("totp/confirm")` | D | Tek kullanımlık token + CAS |
| `auth @Post("totp/disable")` | D | Tekrar edilemeyen ikinci faktör gerekir |
| `auth @Post("totp/admin-reset")` | D | Step-up + durum kontrolü; tekrar 400/409 |
| `auth @Post("step-up")` | D | Yalnız imzalı kanıt üretir, satır yazmaz |
| `me @Post("password")` | D | Kimlik bilgisi akışı; tekrar 401 |
| `me @Delete("sessions/:id")` | C | Silme; tekrar 404 |
| `me @Delete("sessions")` | C | Tümünü iptal; tekrar etkisiz |
| `me @Patch("tenant")` | C | Değere set eder |
| `me @Post("notification-devices")` | B | `ON CONFLICT DO UPDATE` (`notification-device-store.ts:126`) |
| `me @Delete("notification-devices/:id")` | C | `disabledAt` set eder |
| `me @Post("student/announcements/:id/read")` | C | Okundu upsert'i |
| `me @Post("guardian/students/:studentId/announcements/:id/read")` | C | Okundu upsert'i |
| `me @Post("teacher/announcements/:id/read")` | C | Okundu upsert'i |
| `me @Patch("guardian/students/:studentId/notification-preferences")` | C | Değere set eder |
| `me @Post("student/support-tickets")` | A | Dilim 2 #3 |
| `me @Post("guardian/students/:studentId/support-tickets")` | A | Dilim 2 #4 |
| `me @Post("teacher/support-tickets")` | A | Dilim 2 #5 |
| `privacy @Post("me/purge-pii")` | C | Sabit değerle üzerine yazar; tekrar yalnız bir audit satırı ekler |
| `role-preview @Post()` | D | Yalnız 15 dakikalık imzalı token üretir |

### 4.2 Davet, kullanıcı yönetimi, bildirim, destek

| Endpoint | Sınıf | Gerekçe |
|---|---|---|
| `identity-invitation @Post()` | A | Dilim 1.1 (bekleyen davet tekilliği) |
| `identity-invitation @Post("accept")` | D | Tek kullanımlık token; `status='PENDING'` CAS |
| `identity-invitation @Post(":id/resend")` | A | Dilim 2 #1 |
| `student-portal-activation @Post("activate")` | D | Satır kilidi altında aktivasyon kodu; tekrar 409 |
| `user-management @Patch(":userId/roles")` | D | Emekli; her zaman 410 |
| `user-management @Post()` | A | Dilim 2 #6 |
| `user-management @Post(":id/account-invitations")` | B | Çalışan başına tek bekleyen davet indeksi |
| `user-management @Patch(":id")` | C | Değere set + iyimser sürüm kontrolü |
| `guardian-notification-settings @Patch()` | C | Sabit değerlere set eder |
| `sms-batch @Post("recipients/preview")` | D | Yalnız okur |
| `support-ticket @Post()` | A | Dilim 2 #2 |
| `support-ticket @Patch(":id")` | C | Öncelik/durum set eder; bildirim yok |

### 4.3 Öğrenci, veli, öğretmen, not, şablon

| Endpoint | Sınıf | Gerekçe |
|---|---|---|
| `guardians @Patch(":id")` | C | Değere set eder |
| `guardians @Post(":id/purge-pii")` | C | Sabitle üzerine yazar |
| `guardians @Patch(":id/students/:studentId")` | C | Değere set eder |
| `guardians @Delete(":id/students/:studentId")` | C | Silme; tekrar 404 |
| `guardians @Delete(":id")` | C | Durum korumalı soft delete |
| `student-contact @Patch(":id")` | C | Değere set eder |
| `student-contact @Delete(":id")` | C | Soft delete; tekrar 404 |
| `student @Post("imports/dry-run")` | D | Yazmaz |
| `student @Patch(":id")` | C | Mevcut durumla fark alır; bkz. 5.3 |
| `student @Patch(":id/profile")` | C | Değere set eder |
| `student @Patch(":id/portal-access")` | C | Hedef durum + sürüm kontrolü |
| `student @Post(":id/portal-invitations")` | D | Kod döndürür, tek kod geçerli; yanıt saklanmamalı (Dilim 4) |
| `student @Post(":id/purge-pii")` | C | Sabitle üzerine yazar |
| `student @Delete(":id")` | C | Durum korumalı soft delete |
| `student @Patch(":id/tenant")` | C | Yazmaz; her zaman 409 |
| `teachers @Post("imports/dry-run")` | D | Yazmaz |
| `teachers @Patch(":id")` | A | Dilim 1.1 (bekleyen davet tekilliği) |
| `teachers @Patch(":id/assignments/:assignmentId")` | C | Değere set eder |
| `teachers @Post(":id/purge-pii")` | C | Sabitle üzerine yazar |
| `teachers @Delete(":id")` | C | Durum korumalı soft delete |
| `teachers @Delete(":id/assignments/:assignmentId")` | C | Silme; tekrar 404 |
| `teacher-note @Post()` | A | Dilim 2 #8 |
| `teacher-note @Patch(":id")` | C | Değere set eder |
| `teacher-note @Delete(":id")` | C | Soft delete |
| `message-template @Post()` | A | Dilim 2 #7 |
| `message-template @Patch(":id")` | C | Değere set eder |
| `message-template @Delete(":id")` | C | Soft delete |

### 4.4 Kurum, yedek ve geri yükleme

| Endpoint | Sınıf | Gerekçe |
|---|---|---|
| `tenant @Post()` | D | Kendi platform düzeyi idempotency'si var (`PlatformIdempotencyKey`, `tenant.service.ts:355`) |
| `tenant @Patch(":id")` | C | Değere set eder |
| `tenant @Delete(":id")` | C | Emekli; her zaman 410 |
| `tenant @Post(":id/license-terms")` | B | EXCLUDE kısıtı çakışan dönemi engeller |
| `tenant @Post("current/reset-request")` | D | `FOR UPDATE` altında CAS; tekrar mevcut talebi döndürür |
| `tenant @Post("current/reset-request/revoke")` | D | Aynı CAS; tekrar REVOKED döndürür |
| `tenant @Post(":id/purge-exports")` | D | Step-up korumalı indirme; yanıt saklanmamalı (Dilim 4) |
| `tenant @Post(":id/purge-exports/:exportId/delivery")` | B | Satır kilidi altında varlık kontrolü; tekrar 409 |
| `device-backup @Post("download")` | D | Salt okunur işlem |
| `device-backup @Post("preview")` | D | Salt okunur işlem |
| `device-restore @Post(":operationId/cancel")` | D | Durum korumalı tek seferlik geçiş |
| `device-restore @Post("tenants/:tenantId/:operationId/approve")` | D | Kilit + durum makinesi + step-up; tekrar mevcut durumu döndürür |

### 4.5 Okul yapısı, program, sınav, ödev, not defteri, gelişim, yoklama

| Endpoint | Sınıf | Gerekçe |
|---|---|---|
| `attendance @Put("daily")` | B | Doğal anahtarla upsert; worker `notifiedAt` ile tek bildirim gönderir |
| `development @Post("criteria")` | A | Dilim 2 #13 |
| `development @Post("assessments")` | A | Dilim 2 #14 |
| `answer-key @Post("imports/dry-run")` | D | Yazmadan döner |
| `exam @Patch(":examId")` | C | Değere set eder |
| `exam @Delete(":examId")` | C | Silme; tekrar 404 |
| `parser-config @Post("suggestions")` | D | Yazmaz |
| `gradebook @Post()` | A | Dilim 2 #9 |
| `gradebook @Put(":id/entries")` | C | Öğrenci başına değere set; kilit altında taslak günceller |
| `homework @Post("materials")` | A | Dilim 2 #12 |
| `homework @Patch("materials/:id")` | C | Değere set eder |
| `homework @Delete("materials/:id")` | C | Soft delete |
| `homework @Post()` | A | Dilim 2 #10 |
| `homework @Post("from-material")` | A | Dilim 2 #11 |
| `homework @Patch(":id")` | C | Değere set eder |
| `homework @Patch(":id/check-status")` | C | Açık durum seçimi; bildirim yok |
| `homework @Delete(":id")` | C | Soft delete |
| `schedule @Patch(":id")` | C | Değere set eder |
| `schedule @Delete(":id")` | C | Soft delete |
| `study-session @Patch(":id")` | C | Değere set ve öğrenci setini değiştirir |
| `study-session @Delete(":id")` | C | Soft delete |
| `academic-calendar @Post("academic-years")` | B | `@@unique([tenantId, name])`; tekrar bugün 500, Dilim 1.2 sonrası 409 |
| `academic-calendar @Patch("academic-years/:id")` | C | Değere set eder |
| `academic-calendar @Delete("academic-years/:id")` | C | Soft delete |
| `academic-calendar @Post("academic-terms")` | B | `@@unique([tenantId, academicYearId, name])`; Dilim 1.2 |
| `academic-calendar @Patch("academic-terms/:id")` | C | Değere set eder |
| `academic-calendar @Delete("academic-terms/:id")` | C | Soft delete |
| `alanlar @Post()` | A | Dilim 2 #15 |
| `alanlar @Patch(":id")` | C | Değere set eder |
| `alanlar @Delete(":id")` | C | Soft delete |
| `campuses @Post()` | A | Dilim 2 #16 |
| `campuses @Patch(":id")` | C | Değere set eder |
| `campuses @Delete(":id")` | C | Soft delete |
| `classes @Patch(":id")` | C | Değere set eder |
| `classes @Delete(":id")` | C | Soft delete |
| `courses @Patch(":id")` | C | Değere set eder |
| `courses @Delete(":id")` | C | Soft delete |
| `grade-levels @Put(":id/courses/:courseId")` | B | `ON CONFLICT DO NOTHING` ile bağ oluşturur |
| `grade-levels @Post()` | A | Dilim 2 #17 |
| `grade-levels @Patch(":id")` | C | Değere set eder |
| `grade-levels @Delete(":id")` | C | Soft delete |
| `learning-outcomes @Post()` | B | `@@unique([tenantId, code])`, kod zorunlu; Dilim 1.2 |
| `learning-outcomes @Post("imports/dry-run")` | D | Yazmaz |
| `learning-outcomes @Patch(":id")` | C | Değere set eder |
| `learning-outcomes @Delete(":id")` | C | Soft delete |

## 5. İnceleme sırasında bulunan, idempotency dışı bulgular

Bu plana dahil değildir; her biri ayrı kayıt ister.

1. **Gelişim değerlendirmesi tek işlemde değil.** `development.service.ts:149` değerlendirmeyi
   yazar, puan aralığı kontrolü `:161-163`'te gelir ve her store çağrısı ayrı bağlantı açar. Aralık
   dışı puan 400 döner ama puansız bir değerlendirme kalır. Dilim 2 #14 ile aynı değişiklikte tek
   işleme alınması önerilir.
2. **Kayıp refresh yanıtı oturumu kapatır.** Refresh başarılı olup yanıt kaybolursa istemci tüketilmiş
   token'la tekrar dener; tekrar tespiti token ailesini iptal eder (`token-service.ts:91-94`) ve
   kullanıcı çıkış yapmış olur. Kısa bir tolerans penceresi çözüm olabilir. Test edilmedi (UNPROVEN).
3. **Öğrenci güncellemesinde eşzamanlı çift istek.** `student @Patch(":id")` aynı anda iki kez
   çalışırsa fazladan kapalı bir kayıt geçmişi satırı kalabilir. Test edilmedi (UNPROVEN).
4. **Kurum dışa aktarma step-up kanıtı tek kullanımlık değil.** `purge-exports` geçerlilik süresi
   boyunca tekrar edilebilir; süre kontrol edilmedi (`auth/totp-mfa.ts:107`, UNPROVEN).

## 6. Açık sorular

1. `IdempotencyKey` saklama süresi kaç olmalı? Tekrar penceresi için 24 saat yeterli görünür;
   KVKK açısından kısa süre tercih edilir. Ürün sahibi ve gizlilik kararı.
2. Bekleyen davet tekil indeksi öncesinde staging'de çift `PENDING` davet var mı? Sayım gerekir;
   veri temizliği ayrı onay ister.
3. Alan, kampüs ve seviye oluştururken `code` zorunlu olsun mu? Olursa bu üç endpoint anahtar
   yerine veritabanı tekilliğiyle korunur.
4. `teachers @Patch(":id")` web istemcisinden gerçekten `email` alıyor mu? Kontrol edilmedi; API
   şeması kabul ettiği için sınıf A kalır.

## 7. Doğrulama

- `pnpm --filter @o-okul/api typecheck`, `pnpm --filter @o-okul/api test`, `pnpm openapi:generate`
- `node scripts/check-idempotency-inventory.mjs` (envanter 55 → 72; istisna 125 → 108, çünkü Dilim 1.1'in iki endpoint'i B olarak listede kalır)
- Dilim 1.1 migration'ı için `pnpm --filter @o-okul/db test`, `pnpm db:rls:check`,
  `pnpm tenant-db:check`
- Web istemcisinde anahtar üretimi için `pnpm --filter @o-okul/web typecheck`
- Her A endpoint'i için aynı anahtarla iki istek gönderen e2e testi: tek satır ve aynı yanıt
