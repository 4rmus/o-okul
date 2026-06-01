# Eğitim Yönetim Sistemi Değerlendirmesi ve Tamamlama Planı

Tarih: 2026-06-01

## Varsayımlar ve Kapsam

- Bu değerlendirme mevcut checkout üzerinden yapıldı. Production veya staging ortamı canlı test edilmedi.
- Uygulama eğitim kurumları için çok kiracılı bir SaaS olarak ele alındı.
- Amaç yeni özellik yazmak değil; mevcut ürün hiyerarşisini, kullanıcı gruplarını, yetkileri, kişi ilişkilerini ve ekran yapısını değerlendirip tamamlanma planını çıkarmaktır.
- Bu klasör şu an Git repo kökü gibi görünmüyor; `git status` çalışmadı. Bu yüzden kanıtlar dosya ve komut çıktısı üzerinden tutuldu.

## Kullanılan Kanıtlar

- Veri modeli: `packages/db/prisma/schema.prisma`
- API yetki modeli: `apps/api/src/rbac/roles.ts`, `apps/api/src/rbac/roles.guard.ts`
- Kişi düzeyi erişim: `apps/api/src/tenant/tenant-access.ts`, `apps/api/src/me/me.controller.ts`
- Kurum ve kişi servisleri: `apps/api/src/school/school.service.ts`, `apps/api/src/student/student.service.ts`
- Web ekranları: `apps/web/app/(app)/**`, `apps/web/e2e-next/login-next.spec.ts`
- Faz dokümanları: `docs/phase-a-checklist.md` ile `docs/phase-e-checklist.md`
- Çalıştırılan kontroller:
  - `corepack pnpm --filter @uzman-hocam/api exec vitest run src/me/me-access-matrix.e2e.test.ts src/tenant/tenant-access.test.ts src/rbac/roles.test.ts` -> 3 dosya, 16 test geçti.
  - `corepack pnpm --filter @uzman-hocam/web typecheck` -> geçti.
  - `corepack pnpm web:token-storage:check` -> token storage kontrolü geçti.
  - `corepack pnpm identity-link:audit` -> canlı DB'de `READY`: 20.018 subject kaydının tamamı kullanıcı ve doğru membership ile bağlı.
  - `corepack pnpm prod:readiness:check` -> statik readiness geçti.
  - `corepack pnpm --filter @uzman-hocam/db exec prisma validate --config prisma.config.ts` -> Prisma şeması geçerli.

## Kısa Sonuç

Uygulamanın backend, güvenlik ve altyapı iskeleti güçlü. Tenant izolasyonu, RLS, audit log, temel sınav/optik akışı, raporlama, materyal, destek, duyuru ve KVKK yüzeyleri ciddi şekilde ilerlemiş.

Ana eksik artık "modül var mı?" sorusu değil; eğitim kurumu gerçekliğinde kişi, rol, yetki ve ekran hiyerarşisinin netleşmesidir. En kritik açıklar:

1. DB-backed auth, kalıcı refresh/session store, şifre reset, öğrenci/veli/öğretmen davet-aktivasyon API'si, kurum kullanıcı/davet web ekranı ve canlı DB kimlik bağı göçü doğrulandı.
2. Canlı DB kimlik bağı audit'i `READY` döndü: 20.014 öğrenci, 1 veli ve 3 öğretmen kaydı `userId` + doğru `TenantMembership` ile bağlı.
3. Öğretmen yetkileri artık ana öğrenci/yoklama/not/ödev yüzeylerinde kapsamla sınırlanıyor; `TeacherAssignment` modeli sınıf/öğrenci ataması ve rol tipini taşımaya başladı. Dönem/ders bazlı kapsam ve yönetim web formu hâlâ geliştirme işi.
4. Web menüsü artık role göre filtreleniyor; kurum admin menüsünde öğrenci, veli ve öğretmen portalları normal menü maddesi olarak görünmüyor.
5. Kurum hiyerarşisi şu an `Tenant > Class > Student/Teacher/Guardian` düzeyinde; kampüs, dönem, seviye, ders, şube, sınıf öğretmeni, branş öğretmeni gibi eğitim yönetimi kavramları eksik.
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
  -> Class
  -> Student
  -> StudentClassHistory
  -> Teacher
  -> Guardian
  -> GuardianStudent
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

- Kurumun gerçek organizasyon ağacı eksik: kampüs, şube, akademik yıl, dönem, seviye, ders ve kayıt dönemi yok. Sınıf/branş/rehber/sorumlu öğretmen rolü `TeacherAssignment` ile başladı ama dönem/ders modeline tam bağlanmadı.
- `Class` düz model. Eğitim kurumlarında "8-A" sadece sınıf değildir; yıl, seviye, şube, program ve ders atamalarıyla bağlanmalıdır.
- Öğrenci sınıf geçmişi yok; öğrenci sınıf değiştirirse geçmiş raporlama ve yoklama bağlamı zayıflar.

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

`StudentClassHistory` ile öğrenci-sınıf geçmişi ilk kez kalıcı hale geldi; yine de akademik yıl/dönem ve ders modeli tamamlanmadan yoklama, ders programı, sınav raporu ve öğretmen yetkisi zaman içinde tam doğru yorumlanamaz.

### 2. Kullanıcı Grupları

Kodda roller:

```txt
SYSTEM_ADMIN > TENANT_ADMIN > TEACHER > STUDENT > GUARDIAN
```

Değerlendirme:

- `SYSTEM_ADMIN`: Platform yöneticisi olarak düşünülmüş; cross-tenant bypass var. Web'de ayrı sistem admin paneli yok.
- `TENANT_ADMIN`: Kurum yöneticisi. Sınıf, öğretmen, öğrenci, veli, ödeme, rapor, KVKK, denetim gibi tenant genelinde yetkili olmalı. Bu role en çok ihtiyaç duyulan ekranlar başlamış.
- `TEACHER`: Öğretmen. Öğrenci listesi ve öğrenci detayı artık `responsibleTeacherId` yanında `TeacherAssignment` sınıf/öğrenci kapsamını da okuyor. Kalan ürün işi bu kuralı ders/şube/dönem düzeyine ve tüm işlem yüzeylerine yaymaktır.
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
- Veli ilişkisi artık ilişki tipi, birincil kişi ve ödeme/SMS/duyuru/destek izinlerini taşıyor; kalan iş bu bilgiyi tüm bildirim ve destek iş akışlarına yaymak.
- Öğretmen ilişkisi `TeacherAssignment` ile sınıf/öğrenci ve rol tipini taşımaya başladı. Hangi derste, hangi dönemde, hangi işlem yetkisiyle çalıştığı hâlâ tam ürünleşmiş değil.

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
/kurum/siniflar
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

- Kurum menüsü Kişiler, Akademik, Sınav/Rapor, İletişim ve Operasyon gruplarına ayrıldı. Kalan ürün işi: eksik modüller eklendikçe Güvenlik/Finans/Sistem Sağlığı gibi başlıkları tamamlamak.
- Öğretmen portalı çok dar: profil ve ders programı var; yoklama girişi, not ekleme, ödev kontrolü, sınıf/öğrenci listesi, rapor okuma gibi ana günlük işler eksik.
- Öğrenci portalı profil/devamsızlık/not, ödev-materyal ataması, son sınav raporu ve hata kitapçığı özetini gösteriyor; duyuru görünümü hâlâ tamamlanmalı.
- Veli portalı ödeme/profil/devamsızlık/not, seçili öğrenci ödev-materyal ataması, son sınav raporu ve hata kitapçığı özetini gösteriyor; duyuru, destek ve bildirim tercihleri eksik.
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
   - Tamamlandı: öğretmen yalnız kendi ders programındaki sınıfın ödevini görür ve kontrol durumunu değiştirebilir.
   - Kalan: `ScheduleLesson`, `StudySession`, `Student.responsibleTeacherId` ve `TeacherAssignment` tek dönem/ders kapsam modeli altında birleştirilmeli.

4. **Rol bazlı menü ve ekran guard'ı**
   - Tamamlandı: kullanıcı sadece kendi rolüne uygun menüleri görür.
   - UI guard yalnız deneyim içindir; asıl yetki API'de kalmalı.
   - Tamamlandı: kurum admin için öğrenci/veli/öğretmen portalları normal menü maddesi değildir.
   - Kalan: kurum admin için rol önizleme veya "kullanıcı olarak incele" akışı ayrıca tasarlanmalı.

5. **Listeleme altyapısı**
   - Tüm büyük listeler `page`, `limit`, `q`, `sort` ve kaynak özel filtrelerle çalışmalı.
   - Tamamlandı: öğrenci listesi sınıf, seviye, sorumlu öğretmen, aktif/pasif ve veli bağlı mı filtrelerini alıyor.

### P1 - Ürün Tamamlığı İçin Gerekenler

1. **Kurum organizasyon modeli**
   - Akademik yıl, dönem, seviye, şube, ders, kampüs/şube desteği.
   - Sınıf geçmişi ve öğrenci kayıt durumu.

2. **Kişi 360 ekranı**
   - Öğrenci profilinde: sınıf, sorumlu öğretmen, veliler, devamsızlık, notlar, ödevler, ödemeler, raporlar, audit özeti.
   - Veli profilinde: bağlı öğrenciler, iletişim izinleri, ödeme sorumluluğu, bildirim tercihleri.
   - Öğretmen profilinde: dersleri, sınıfları, sorumlu öğrencileri, programı.

3. **Öğretmen portalının günlük işe uygun hale gelmesi**
   - Bugünkü dersler.
   - Yoklama girişi.
   - Öğrenci notu ekleme.
   - Ödev/materyal atama veya kontrol.
   - Sınıf ve öğrenci raporları.

4. **Öğrenci ve veli portallarının tamamlanması**
   - Sınav raporu, hata kitapçığı, gelişim grafiği.
   - Ödev ve materyaller.
   - Duyurular.
   - Destek talebi açma.
   - Bildirim tercihleri.

5. **Finans ekranı**
   - Ödeme planı oluşturma, taksit düzenleme, ödeme işaretleme, gecikmiş ödeme görünümü.
   - Veliye gösterilecek finans bilgisinin sınırlı ve anlaşılır olması.

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
  - KVKK
  - Sistem Sağlığı
  - Yedek / Restore Kanıtları
```

Rol portalları ayrı tutulmalı:

```txt
Öğretmen Portalı
Öğrenci Portalı
Veli Portalı
```

Kurum admin bu portalları sol menüde normal rota gibi değil, "demo/rol önizleme" veya "kullanıcı olarak incele" şeklinde görmeli.

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
| 7a | Kişi çekirdeği tip sözleşmesi | Tamamlandı: `Class/Teacher/Guardian/GuardianStudent/Student` API controller imzaları `@uzman-hocam/shared-types` ortak tiplerine bağlandı |
| 7b | Program/ödev/destek tip sözleşmesi | Tamamlandı: `ScheduleLesson/StudySession/Homework*/SupportTicket*` API controller imzaları `@uzman-hocam/shared-types` ortak tiplerine bağlandı |
| 8 | Öğrenci 360 ekranı | Dar kapsam tamamlandı: öğrenci/veli portalları kimlik bağı üstünden profil, devamsızlık, öğretmen notu, ödev-materyal atamaları, son sınav raporu ve hata kitapçığını gösterir; veli portalı bekleyen ödeme özetini gösterir; kurum içi öğrenci düzenleme ekranı veli/devamsızlık/not/ödev/ödeme/rapor özetini gösterir; kurum içi ayrı 360 route'u sınav/rapor seçici, veli ilişki tipi/izinleri, ilişki geçmişi ve denetim özetiyle açılır; kalan öğretmen ilişki tipi ve sınıf geçmişi |
| 9 | Veli ilişki tipi ve izinleri | Tamamlandı: `relationshipType`, `isPrimary`, `canViewFinance`, `canReceiveSms`, `canReceiveAnnouncements`, `canOpenSupportTickets` alanları model/API/web yüzeyinde var; `canViewFinance=false` veli ödeme planı erişimini 403 yapar; ilişki değişikliği audit diff'i PII içermez |
| 10 | Listeleme sözleşmesi | Tamamlandı: `/students`, `/guardians`, `/teachers`, `/classes`, `/tenant-users`, `/identity-invitations`, `/announcements`, `/message-templates`, `/audit-logs`, `/support-tickets`, `/homework` ve `/homework/materials` listeleri `page/limit/q/sort` parametrelerini uygular; `/students` sınıf, seviye, sorumlu öğretmen, aktif/pasif ve veli bağlı mı filtrelerini alır; API zarfı gerçek `total/page/limit/totalPages` metasını taşır; ilgili kurum ekranlarında arama, filtre, sıralama ve sayfa kontrolleri vardır |
| 11 | Form doğrulama sözleşmesi | Tamamlandı: Zod web katmanında açık bağımlılık oldu; sınıf, öğretmen, veli, öğrenci, kullanıcı/davet, optik, rapor, destek bildirimi, destek ek/yorum, duyuru, SMS şablonu ve materyal formları ortak şemayla zorunlu alan/trim kontrolü yapar |
| 12 | TanStack Query ve Next veri sınırı | Tamamlandı: kurum dashboard dahil korumalı web verileri client component içinde `useQuery` + `apiRequest` ile okunur; `/kurum/page.tsx` RSC kabuk olarak kalır ve access token server component'e taşınmaz |

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
2. Veli izinleri: ödeme görünümü, SMS alma, duyuru alma, destek bildirimi açma. Tamamlandı: `canViewFinance/canReceiveSms/canReceiveAnnouncements/canOpenSupportTickets`; ödeme görünümü API'de davranışa bağlandı.
3. Öğretmen ilişki tipi: sınıf öğretmeni, branş öğretmeni, rehber/sorumlu öğretmen. Tamamlandı: `TeacherAssignment.role` ve sınıf/öğrenci ataması eklendi; kurum admin öğretmen ekranında atama ekleme/silme var; öğrenci listesi/detayı ve öğrenci 360 detayında davranışa bağlandı.
4. Öğrenci sınıf geçmişi ve aktif/pasif kayıt durumu. Tamamlandı: `Student.status` ve `StudentClassHistory` eklendi; oluşturma/sınıf değiştirme geçmişi güncelliyor; web listesi ve 360 detayında görünür.
5. İlişki değişikliklerini ilişki tipi/izin diff'iyle audit'e bağla. Tamamlandı: veli-öğrenci ilişki değişiklikleri PII içermeyen alan adı diff'iyle audit'e yazılıyor.

Doğrulama:

- Veli yalnız bağlı öğrenci görür.
- Öğretmen yalnız kapsamındaki öğrenci görür.
- Öğrenci profilinde tüm ilişkiler doğru görünür.
- Veli ilişki izinleri finans, SMS ve portal görünümünü etkiler.

### Faz 3 - Akademik Operasyon

Hedef: Kurumun günlük eğitim operasyonu ekrandan yönetilebilsin.

İşler:

1. Ders, seviye, şube, akademik yıl ve dönem modelleri.
2. Ders programı ve etüt ekranları.
3. Devamsızlık ekranı: sınıf/ders bazlı giriş.
4. Öğretmen notları ekranı: iç not ve veli/öğrenciye açık not ayrımı.
5. Ödev ve materyal ekranlarının öğretmen portalına taşınması.

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
6. Öğrenci/veli portalında rapor, hata kitapçığı ve gelişim grafiği.
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

1. Ödeme planı ve taksit yönetim ekranı.
2. Veli portalında ödeme görünümü.
3. SMS gönderim ekranı: şablon, alıcı filtresi, gönderim önizleme.
4. Netgsm staging/canlı smoke.
5. Öğrenci ve veli destek talebi açabilsin.
6. Duyuru hedef kitlesi genişlesin: sınıf, seviye, öğretmen, veli, öğrenci.

Doğrulama:

- Öğretmen ödeme verisini göremez.
- SMS gerçek sağlayıcıda kontrollü smoke ile doğrulanır.
- Destek talebi her rolde doğru kapsama düşer.
- Duyuru hedef kitlesi sınıf/seviye/rol filtreleriyle doğru alıcıya düşer.

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
