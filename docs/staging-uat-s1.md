# Staging rol UAT'ı — S1 kiti (2026-10-10)

Plan: `docs/ozel-k12-strateji-ve-yol-haritasi-plan.md` §11.3. Onay: ürün sahibi, 2026-10-10 (staging'de test
kurumu, test kullanıcıları ve test verisi oluşturma). Ortam: https://o-okul.com, kurum adresi
`https://uat-s1-okulu.o-okul.com` (kurum kodu `uat-s1-okulu`). Staging sürümü UAT başında `/health` veya deploy run'ından not edilir; sürüm
değişirse etkilenen senaryo yeniden koşulur.

Senaryoları bir insan koşar. Claude staging'e parolayla giriş yapmaz; sonuçları bu dokümandaki tabloya
işler ve `status.md` kapanış kaydına yazar.

## Test verisi kuralları

- Gerçek kişi verisi girilmez. TC kimlik alanları boş bırakılır ya da `1000000xxxx` biçimi kullanılır;
  telefonlar `0555…` / `0500…`.
- E-postalar operatörün UAT posta kutusunun `+etiket` adresleridir (`<uat-posta>+owner@…` gibi). Adres
  bu dosyaya yazılmaz.
- İçe aktarma dosyaları: `docs/examples/staging-uat-s1/ogrenciler-8a-30.csv` (30 öğrenci, 8-A; son
  satırda veli yok) ve `docs/examples/staging-uat-s1/cakisma-tek-satir.csv` (veli ve iletişim sütunları
  birlikte dolu).

## Test kullanıcıları

| Kod | Rol | Nasıl açılır | Not |
|---|---|---|---|
| U-SYS | SYSTEM_ADMIN | Mevcut staging sistem yöneticisi | MFA açık |
| U-OWN | TENANT_OWNER | Kurum oluşturulurken ilk sahip | S1-01'de MFA kurar |
| U-ADM | TENANT_ADMIN | U-OWN davet eder | MFA kurar |
| U-FIN | FINANCE_STAFF | U-ADM davet eder | |
| U-TCH | TEACHER (8-A sınıf öğretmeni + Matematik branş) | U-ADM davet eder, atama yapılır | |
| U-GRD1 | GUARDIAN (Ada Ak'ın velisi) | Toplu veli davetiyle | Gerçek telefonda PWA ve push |
| U-GRD2 | GUARDIAN (Bora Bal'ın velisi) | Elle bağlama akışıyla | |
| U-STU | STUDENT (Ada Ak) | Öğrenci hesabı | Ödev teslimi için |

## Senaryo sırası

Her senaryonun sonucu PASS, FAIL veya BLOCKED olarak yazılır. Ekran görüntüsü ya da süre ölçümü kanıttır.
FAIL olan her senaryo için bulgu satırı açılır.

Ön koşul (2026-10-21): deneme lisansı 2026-10-17 00:00 UTC'de bitti; kurum 2026-10-31 00:00 UTC'ye kadar
salt okunur, sonra dondurulur (`packages/shared-types/src/license-state.ts`). S1-14 gözlemi biter bitmez U-SYS PRO
dönem açar. PRO açılmadan S1-04..S1-11'deki yazma adımları, davet kabulü ve parola değiştirme 403
`TENANT_LICENSE_EXPIRED_READ_ONLY` alır ve otomatik bildirim gitmez; bu ürün hatası değildir.

| Sıra | Senaryo | Rol | Adımlar | Beklenen | Sonuç / kanıt |
|---|---|---|---|---|---|
| S1-01 | Kartsız deneme (KF-5) | U-SYS, U-OWN | Sistem → Kurumlar'da `uat-s1-okulu` kurumunu deneme lisansıyla aç; U-OWN daveti kabul edip MFA kursun | 7 günlük deneme, 100 öğrenci sınırı görünür; OWNER MFA zorunlu | PASS 2026-10-10: TRIAL 10-10→10-17, 100 öğrenci; MFA kurulmadan giriş yok (`auth.totp_enrollment_required`); bkz. F-01 |
| S1-02 | MFA ve destekli sıfırlama (KV-9) | U-OWN, U-ADM, U-SYS | U-OWN, U-ADM'yi Yeni çalışan + hesap daveti ile Kurum yöneticisi olarak eklesin; U-ADM MFA kursun; U-SYS U-ADM'nin MFA'sını sıfırlasın; U-ADM yeniden kursun | Akış hatasız, audit kaydı var | PASS 2026-10-11: U-SYS KV-9b ekranıyla U-ADM'nin MFA'sını sıfırladı, U-ADM yeniden MFA kurdu; bkz. F-04. #204 sonrası yeniden koşulacak: sıfırlama kanıtı tek hesaba (`{ tenantId, userId }`) bağlı, başka hesabın kanıtıyla sıfırlama reddedilir (staging'de UNPROVEN) |
| S1-03 | Öğrenci içe aktarma (KV-1) | U-ADM | `ogrenciler-8a-30.csv` önizle ve içe aktar; sonra `cakisma-tek-satir.csv` önizle | 30 öğrenci, 29 yasal veli iletişimi (izinler kapalı); ikinci dosyada `CONTACT_COLUMNS_CONFLICT` | PASS 2026-10-11: 30 öğrenci, 29 LEGAL_GUARDIAN iletişimi izinler kapalı; çakışma dosyası reddedildi. Ön koşul: seviye ve sınıf önceden açılmalı (bkz. F-05) |
| S1-04 | Personel ve atama | U-ADM | U-FIN'i Çalışanlar → Yeni çalışan + hesap daveti ile davet et; U-TCH için Öğretmenler → öğretmen ekle → ayrıntı → Hesap daveti gönder; U-TCH'yi 8-A sınıf öğretmeni ve Matematik branşına ata. Ön koşul: Ders, sınıfın seviyesine bağlı olmalı (Seviyeler → ders bağla veya Kurulum 4. adım) | Davetler ulaşır; ayrıntıda "Davet bekliyor", kabulden sonra "Portal bağlı"; girişte rol doğru | Bkz. F-07..F-13, F-16. Yeniden koşuda U-FIN'in süresi dolmuş davetini iptal edip tekrar gönder (F-03) ve doğrulanmamış adrese gönderimi dene (F-14); öğretmen ayrıntısında yalnız o öğretmenin davetleri listelenir (#192) |
| S1-05 | Veli daveti ve bağlama (KV-3, KV-3b) | U-ADM | 2–3 veli iletişimine e-posta ekle; toplu davet gönder; U-GRD2'yi elle bağla; aynı daveti tekrar gönder | E-postasız veliler atlanır; ikinci davet oluşmaz; elle bağlama yalnız yasal veliye açık | |
| S1-06 | Not girişi, yayın, düzeltme (AK-3/AK-4, AK-7) | U-TCH | U-TCH Öğretmen → Not defteri'nde 8-A Matematik yazılısı değerlendirmesini oluşturur; 30 öğrencinin notunu girer (süreyi tut); onay penceresiyle yayınlar; bir notu düzeltir ve düzeltmeyi yayınlar | Giriş <5 dk; öğretmen yönetimi beklemez (DEC-20261012-01); düzeltme v2 açar; v1 değişmez; atanmadığı sınıf seçenekte yok, API 403 `FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE` | Süre: |
| S1-07 | Veli özeti ve PWA (KV-4) | U-GRD1 (gerçek telefon) | Daveti kabul et; uygulamayı ana ekrana ekle; özeti aç | Yalnız yayınlanmış not (v2) görünür; öğretmen notu ve diğer veli bilgisi yok | |
| S1-08 | Push ve büyük duyuru (KV-7, KV-6) | U-GRD1, U-ADM | U-GRD1 bildirim izni versin; U-ADM 8-A velilerine duyuru göndersin | Telefona push gelir; teslim raporunda sahte "sent" yok | |
| S1-09 | Otomatik bildirimler (KV-8) | U-TCH, U-FIN, U-GRD1 | Ada Ak'ı gelmedi işaretle, aynı gün düzelt; Ada için vadesi 3 gün sonra olan taksit oluştur; S1-06 düzeltmesinin bildirimini kontrol et | Devamsızlık için gün başına bir bildirim; vade hatırlatması; not yayını için sürüm başına bir bildirim | |
| S1-10 | Muhasebe (KF-1, KF-2) | U-FIN | İlk girişte parola değiştir; `/kurum/finans` aç; ödeme planı oluştur, vadesi geçmiş taksiti gör | 403 yok; gecikme doğru; aynı istek ikinci plan açmaz | |
| S1-11 | Ödev teslimi (AK-6, AK-7) | U-TCH, U-STU | U-TCH Öğretmen → Ödevler'de 8-A için "Ödev oluştur" ile ödev verir; öğrenci teslim etmeden "kontrol edildi" dene; öğrenci teslim etsin; kontrol et | Teslimsiz kontrol 409 `HOMEWORK_SUBMISSION_NOT_SUBMITTED`; teslim sonrası kontrol başarılı | |
| S1-12 | Fiyat sayfası (KF-9) | Ziyaretçi | https://o-okul.com/fiyatlar'da 250, 251, 500, 501, 1000, 1001 öğrenciyi hesapla | Sınırda toplam fiyat düşmez (kademeli hesap); kartsız deneme düğmesi görünmez | |
| S1-13 | Doğrulama kiti (KF-10) | Operatör | Anonimleştirme betiğini bir örnek optik dosyada çalıştır; sonucu `uat-s1` kurumuna yükle | Kimlik alanları ezilmiş; dosya karneye ulaşır | |
| S1-14 | Lisans sonu (KF-5) | U-SYS, U-ADM | Kurum ayrıntısında lisans durumunun salt okunur olduğunu gör; U-ADM ile bir listeyi aç, bir kayıt oluşturmayı dene; ardından U-SYS PRO dönem açar | 2026-10-17 00:00 UTC'den 2026-10-31'e kadar salt okunur: giriş ve okuma çalışır, yazma 403 `TENANT_LICENSE_EXPIRED_READ_ONLY`; sonra dondurulur (giriş kapanır) | |

## Operatör smoke'ları (opsiyonel, mevcut kanıt zinciri)

`docs/phase-6-ops-runbook.md`'deki `live:onboarding:smoke`, `live:ui-worker:smoke`, `queue:smoke`,
`report-generation:smoke`, `raw-import:smoke` ve `live:exam-cycle:check` komutları özel girdi dosyası ve
sistem yöneticisi kimlik bilgisi ister; operatör kendi terminalinde koşar. Bunlar S1 senaryolarının yerine
geçmez, Gate E kanıt zincirini besler.

## Bulgular

| ID | Senaryo | Özet | Önem | Karar |
|---|---|---|---|---|
| F-01 | S1-01 | Kurum sahibi davet e-postası Gmail'de spama düştü. DNS kayıtları (cf-bounce SPF, `cf-bounce._domainkey` DKIM, bounce MX) mevcut; SPF/DKIM/DMARC sonucu henüz okunmadı | Yüksek (satış) | Ürün sahibi: sonra bakılacak |
| F-02 | S1-02 | Yönetici eklemek iki adımlı ve keşfedilmesi zor: önce "Yeni çalışan" profili, sonra satırdaki zarf ikonuyla hesap daveti; tek "yönetici ekle" akışı yok | Orta | Kapandı: #184 (`52ce7d03e`). "Yeni çalışan" penceresinde "Hesap daveti" rolü seçilirse profil aktif oluşturulur ve aynı adımda iş e-postasına davet gider (iş e-postası zorunlu); davet düşerse profil kalır, satırdan yeniden denenir. Ürün sahibi onayı 2026-10-14 |
| F-03 | S1-02 | Gönderilmiş davet iptal edilemiyor (API'de yalnız oluştur/kabul/yeniden gönder); süresi dolmamış davet varken aynı çalışana yeni davet `EMPLOYEE_INVITATION_ALREADY_PENDING`. Yanlış rolle giden davet kabul edilip rol sonradan değiştirildi | Orta | Kapandı: #180 (staging `adcca4617`, deploy `38481232415`). `POST /identity-invitations/:id/revoke` (user:manage; kurum sahibi daveti owner:manage). Çalışanlar satırında "Davet bekliyor" rozeti ve "Daveti iptal et"; öğretmen ayrıntısında "Daveti iptal et". İptal edilen bağlantı `IDENTITY_INVITATION_NOT_PENDING` alır, aynı kişiye hemen yeni rol/adresle davet açılır. Öğrenci kodu ve veli davetleri aynı uçla iptal edilir; ekran işlemleri Öğrenci Portal Erişimi satırında ve veli ayrıntısında (#191, `df86002b7`, main ve staging'de). Kabul sırasında iptal yarışı (inceleme bulgusu): konu bağı ve rol geri alınır, activity kaydı UNCERTAIN kalmaz; başka hesaba bağlı konunun e-posta daveti `SUBJECT_ALREADY_LINKED` ile reddedilir (#184). Geri alınan kabulün oluşturduğu kullanılmayan hesap silinir; aynı adrese yeni davet yeni parolayla açılır (#185). Ürün sahibi onayı 2026-10-14; S1-04 yeniden koşusunda U-FIN için süresi dolmuş daveti iptal edip yeniden gönderme bu akışla denenir |
| F-04 | S1-02 | Sistem yöneticisi için kurum yöneticisinin MFA'sını sıfırlama ekranı yoktu | - | Kapandı: KV-9b (#159) |
| F-05 | S1-03 | İçe aktarma seviye/sınıf oluşturmaz; eksik sınıf hatası kullanıcıyı seviye/sınıf ekranına yönlendirmez | Düşük | Kapandı: #184 (`52ce7d03e`). içe aktarma penceresinde eksik sınıf/seviye hatasında Seviyeler ve Sınıflar bağlantıları; kurulum sihirbazı mesajı sınıf adımına yönlendirir. İçe aktarmanın seviye/sınıf oluşturması kapsam dışı (ayrı karar). Ürün sahibi onayı 2026-10-14 |
| F-06 | S1-03 | Deneme lisansında `seatLimit` hesap sınırı olarak uygulanıyordu | - | Kapandı: #161 |
| F-07 | S1-04 | Öğretmen için hesap daveti ekranı yoktu | - | Kapandı: #162 |
| F-08 | S1-04 | Davet kabulü 500 döndü ve kilitli UNCERTAIN kayıt bıraktı | - | Kapandı: #163 |
| F-09 | S1-04 | Öğretmen listesinde hesap durumu yanlış gösteriliyordu | - | Kapandı: #164 |
| F-10 | S1-04 | Öğretmen atama hatası (`TEACHER_ASSIGNMENT_COURSE_GRADE_LEVEL_MISMATCH` vb.) düzenleme penceresinde görünmüyordu | - | Kapandı: #165. Hata kodu başına Türkçe mesaj, seviye uyuşmazlığında Seviyeler bağlantısı |
| F-11 | S1-04 | Ders-seviye bağı yalnız Kurulum sihirbazının 4. adımında kurulabiliyordu; Dersler/Seviyeler ekranından eklenen ders atanamıyordu | - | Kapandı: #165 Seviyeler → "derslerini yönet" ile mevcut dersi seviyeye bağlama. İzleyen iş kapandı: #182 (staging `6b97e107c`, deploy `38561474048`). `DELETE /grade-levels/:id/courses/:courseId` ve aynı pencerede "Bağı kaldır"; seviyenin sınıflarında aktif öğretmen ataması olan ders `GRADE_LEVEL_COURSE_IN_USE` ile korunur |
| F-12 | S1-02, S1-04 | Reddedilen istek (`EMPLOYEE_INVITATION_ALREADY_PENDING`, `TEACHER_ASSIGNMENT_COURSE_GRADE_LEVEL_MISMATCH`) kilitli kayıt bıraktı | - | Kapandı: #166 |
| F-13 | S1-04 | Öğretmenin çalışan kaydı hesaba bağlı değildi: davet kabulü `Teacher.userId`'yi yazdı, deploy backfill'inin önceden açtığı `Employee` satırı hesapsız kaldı; Çalışanlar ve Yetkiler aynı kişiye ikinci hesap daveti önerdi | Yüksek | Kapandı: #168 (`b71d4997d`). kabulde bağlı çalışan kaydı aynı hesaba bağlanır, ikinci hesap daveti `EMPLOYEE_ALREADY_LINKED_VIA_TEACHER` ile reddedilir, backfill mevcut kayıtları düzeltir |
| F-14 | - | E-posta yalnız doğrulanmış hedeflere gidebiliyor | Yüksek | Açık (UNPROVEN): 2026-10-15 panelinde Email Sending Enabled ve DNS Configured; S1-04'te doğrulanmamış adrese finans daveti gönderilerek doğrulanacak |
| F-15 | S1-03 | Öğrenci ayrıntısında öğrenci numarası varken "Öğrenci no yok" görünüyordu | Düşük | Kapandı: #168 (`b71d4997d`). profil yanıtı `studentNo` taşır |
| F-16 | - | Her deploy'daki backfill `APPLY` kampüs kapsamlı personeli kurum geneline genişletiyor (`scopeMode` → `TENANT`) ve `SUSPENDED`/`ENDED` üyeliklerin `staffRole`/persona alanlarını boşaltıyordu; davet kabulü mevcut hesabın üyeliklerini silip yeniden yazıyordu (VELİ hesabı ÖĞRETMEN davetini kabul edince veli üyeliği kayboluyordu) | Yüksek | Kapandı: #168 (`b71d4997d`). backfill yalnız farklı olan `ACTIVE` satırları yazar, ikinci `APPLY` no-op; boşaltılmış askıdaki/biten üyelik alanları legacy rol sütunundan, genişletilmiş kapsam yalnız `tenant_membership.updated` audit'indeki `campusCount` kanıtıyla geri yüklenir (kanıtsız satırlar `TENANT` kalır, elle kontrol). Davet kabulü mevcut hesaba yalnız davet edilen rolü ekler; uyumsuz hesap (öğrenci + başka rol) `IDENTITY_INVITATION_EMAIL_ACCOUNT_INCOMPATIBLE` ile reddedilir |

## Bitiş

- Tüm senaryolar PASS ya da bulgusu karara bağlanmış olunca S1 kapanır; `status.md` kapanış kaydına satır
  eklenir (kanıt sınıfı STAGING).
- UAT sonunda `uat-s1-okulu` kurumu askıya alınır. Silme, lisans sonu imhası akışıyla ve ayrı onayla yapılır.
