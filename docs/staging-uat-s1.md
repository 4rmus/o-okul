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
Durum (2026-10-21 14:43 UTC): S1-14 gözlemlendi ve PRO dönem açıldı (2027-01-31'e kadar, 100 öğrenci); S1-04..S1-13
yazma adımları artık koşulabilir.

| Sıra | Senaryo | Rol | Adımlar | Beklenen | Sonuç / kanıt |
|---|---|---|---|---|---|
| S1-01 | Kartsız deneme (KF-5) | U-SYS, U-OWN | Sistem → Kurumlar'da `uat-s1-okulu` kurumunu deneme lisansıyla aç; U-OWN daveti kabul edip MFA kursun | 7 günlük deneme, 100 öğrenci sınırı görünür; OWNER MFA zorunlu | PASS 2026-10-10: TRIAL 10-10→10-17, 100 öğrenci; MFA kurulmadan giriş yok (`auth.totp_enrollment_required`); bkz. F-01 |
| S1-02 | MFA ve destekli sıfırlama (KV-9) | U-OWN, U-ADM, U-SYS | U-OWN, U-ADM'yi Yeni çalışan + hesap daveti ile Kurum yöneticisi olarak eklesin; U-ADM MFA kursun; U-SYS U-ADM'nin MFA'sını sıfırlasın; U-ADM yeniden kursun | Akış hatasız, audit kaydı var | PASS 2026-10-11: U-SYS KV-9b ekranıyla U-ADM'nin MFA'sını sıfırladı, U-ADM yeniden MFA kurdu; bkz. F-04. #204 sonrası yeniden koşulacak: sıfırlama kanıtı tek hesaba (`{ tenantId, userId }`) bağlı, başka hesabın kanıtıyla sıfırlama reddedilir (staging'de UNPROVEN) |
| S1-03 | Öğrenci içe aktarma (KV-1) | U-ADM | `ogrenciler-8a-30.csv` önizle ve içe aktar; sonra `cakisma-tek-satir.csv` önizle | 30 öğrenci, 29 yasal veli iletişimi (izinler kapalı); ikinci dosyada `CONTACT_COLUMNS_CONFLICT` | PASS 2026-10-11: 30 öğrenci, 29 LEGAL_GUARDIAN iletişimi izinler kapalı; çakışma dosyası reddedildi. Ön koşul: seviye ve sınıf önceden açılmalı (bkz. F-05). Yeniden koşu PASS 2026-10-22 (#212, set tabanlı import): aynı dosyanın ön izlemesi 30 satırda "okul no tekrar ediyor", çakışma dosyası reddedildi; 3 yeni test öğrencisi (3101–3103, test TC ve telefon) 2 iletişimle yazıldı, telefon ayrıntıda maskeli görünür, aynı TC yeni okul noyla ön izlemede reddedilir |
| S1-04 | Personel ve atama | U-ADM | U-FIN'i Çalışanlar → Yeni çalışan + hesap daveti ile davet et; U-TCH için Öğretmenler → öğretmen ekle → ayrıntı → Hesap daveti gönder; U-TCH'yi 8-A sınıf öğretmeni ve Matematik branşına ata. Ön koşul: Ders, sınıfın seviyesine bağlı olmalı (Seviyeler → ders bağla veya Kurulum 4. adım) | Davetler ulaşır; ayrıntıda "Davet bekliyor", kabulden sonra "Portal bağlı"; girişte rol doğru | Bkz. F-07..F-13, F-16. Yeniden koşuda U-FIN'in süresi dolmuş davetini iptal edip tekrar gönder (F-03) ve doğrulanmamış adrese gönderimi dene (F-14); öğretmen ayrıntısında yalnız o öğretmenin davetleri listelenir (#192) | PASS 2026-10-27 (staging `4de471981`): 8. SINIF–Matematik bağı var; U-TCH portal bağlı, 8-A sınıf öğretmeni ve 8-A Matematik branş öğretmeni (1. dönem); U-FIN aktif Finans çalışanı. F-03 yeniden koşusu U-FIN'de bekleyen davet kalmadığı için hesapsız "UAT F20 Deneme" profilinde: Operasyon çalışanı daveti 201, e-posta ulaştı, iptal 201 ("…davet iptal edildi; satırdan yeni davet gönderebilirsiniz"), eski bağlantı "iptal edildi" mesajı verdi, aynı adrese yeni davet 201, kabulden sonra satır Aktif / Operasyon çalışanı. Bkz. F-21..F-23 |
| S1-05 | Veli daveti ve bağlama (KV-3, KV-3b) | U-ADM | 2–3 veli iletişimine e-posta ekle; toplu davet gönder; U-GRD2'yi elle bağla; aynı daveti tekrar gönder | E-postasız veliler atlanır; ikinci davet oluşmaz; elle bağlama yalnız yasal veliye açık | PASS 2026-10-27 (staging `4de471981`): Ada Ak'a e-postalı yasal temsilci "VELİ2 AK" eklendi (201; U-GRD1, operatör kutusunun `+etiket` adresi). Ada Ak + Begüm Bilge toplu davet: "Davet gönderildi: 1 · Zaten var: 1 · Atlandı: 1 (e-posta yok: 1)" (mevcut VELİ1 AK hesaplı); aynı seçimle tekrar: "Davet gönderildi: 0 · Zaten var: 2 · Atlandı: 1". U-GRD2: Bora Bal'ın e-postasız "VELİ2 BAL" yasal temsilci kaydı Mevcut kullanıcı (personel) seçeneğiyle "UAT F20 Deneme" hesabına bağlandı (PUT …/contacts/:id/guardian 200; "Kullanıcıya veli rolü eklendi", ayrı hesap açılmadı, izinler kapalı). Elle bağlama seçim listesi yalnız yasal temsilci kayıtlarını gösterir; yasal olmayan kayda API reddi (`STUDENT_CONTACT_NOT_LEGAL_GUARDIAN`) staging'de denenmedi (UNPROVEN). U-GRD1 davet kabulü S1-07'de |
| S1-06 | Not girişi, yayın, düzeltme (AK-3/AK-4, AK-7) | U-TCH | U-TCH Öğretmen → Not defteri'nde 8-A Matematik yazılısı değerlendirmesini oluşturur; 30 öğrencinin notunu girer (süreyi tut); onay penceresiyle yayınlar; bir notu düzeltir ve düzeltmeyi yayınlar | Giriş <5 dk; öğretmen yönetimi beklemez (DEC-20261012-01); düzeltme v2 açar; v1 değişmez; atanmadığı sınıf seçenekte yok, API 403 `FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE` | PASS 2026-10-27 (staging `4de471981`, U-TCH oturumu, ekran işlemleri Claude tarayıcı otomasyonuyla): "S1-06 Matematik 1. Yazılı" (8-A, Matematik, 1. DÖNEM, 100 puan) oluşturuldu (201); 33 aktif öğrencinin notu Enter ile satır satır girildi, taslak kaydedildi, onay penceresi ("Yayınlanacak taslak: 33") ile yayınlandı: "33 not yayınlandı (v1)". Süre: oluşturmadan yayına 87 sn, ama otomasyon süresi, insan girişi değil; <5 dk ölçütü insan girişiyle UNPROVEN. Ada Ak 85 → 88 düzeltildi: Düzelt → taslak kaydet → "Düzeltmeyi yayınla" (taslak: 1) → "1 not yayınlandı (v2)", satır "v1 85 · v2 88", v1 korunuyor. Yönetim onayı beklenmedi. Kurumda tek sınıf (8-A) olduğu için "atanmadığı sınıf seçenekte yok" ve API 403 denenemedi (UNPROVEN). Bkz. F-24 |
| S1-07 | Veli özeti ve PWA (KV-4) | U-GRD1 (gerçek telefon) | Daveti kabul et; uygulamayı ana ekrana ekle; özeti aç | Yalnız yayınlanmış not (v2) görünür; öğretmen notu ve diğer veli bilgisi yok | |
| S1-08 | Push ve büyük duyuru (KV-7, KV-6) | U-GRD1, U-ADM | U-GRD1 bildirim izni versin; U-ADM 8-A velilerine duyuru göndersin | Telefona push gelir; teslim raporunda sahte "sent" yok | |
| S1-09 | Otomatik bildirimler (KV-8) | U-TCH, U-FIN, U-GRD1 | Ada Ak'ı gelmedi işaretle, aynı gün düzelt; Ada için vadesi 3 gün sonra olan taksit oluştur; S1-06 düzeltmesinin bildirimini kontrol et | Devamsızlık için gün başına bir bildirim; vade hatırlatması; not yayını için sürüm başına bir bildirim | |
| S1-10 | Muhasebe (KF-1, KF-2) | U-FIN | İlk girişte parola değiştir; `/kurum/finans` aç; ödeme planı oluştur, vadesi geçmiş taksiti gör | 403 yok; gecikme doğru; aynı istek ikinci plan açmaz | |
| S1-11 | Ödev teslimi (AK-6, AK-7) | U-TCH, U-STU | U-TCH Öğretmen → Ödevler'de 8-A için "Ödev oluştur" ile ödev verir; öğrenci teslim etmeden "kontrol edildi" dene; öğrenci teslim etsin; kontrol et | Teslimsiz kontrol 409 `HOMEWORK_SUBMISSION_NOT_SUBMITTED`; teslim sonrası kontrol başarılı | |
| S1-12 | Fiyat sayfası (KF-9) | Ziyaretçi | https://o-okul.com/fiyatlar'da 250, 251, 500, 501, 1000, 1001 öğrenciyi hesapla | Sınırda toplam fiyat düşmez (kademeli hesap); kartsız deneme düğmesi görünmez | |
| S1-13 | Doğrulama kiti (KF-10) | Operatör | Anonimleştirme betiğini bir örnek optik dosyada çalıştır; sonucu `uat-s1` kurumuna yükle | Kimlik alanları ezilmiş; dosya karneye ulaşır | |
| S1-14 | Lisans sonu (KF-5) | U-SYS, U-ADM | Kurum ayrıntısında lisans durumunun salt okunur olduğunu gör; U-ADM ile bir listeyi aç, bir kayıt oluşturmayı dene; ardından U-SYS PRO dönem açar | 2026-10-17 00:00 UTC'den 2026-10-31'e kadar salt okunur: giriş ve okuma çalışır, yazma 403 `TENANT_LICENSE_EXPIRED_READ_ONLY`; sonra dondurulur (giriş kapanır) || PASS 2026-10-21: kurum özeti "Deneme süresi doldu… görüntülenebilir; yeni kayıt girmek için lisansın yenilenmesi gerekir" uyarısını gösterdi, okuma çalıştı (30 aktif öğrenci); U-OWN/U-ADM oturumuyla "S1-14 TEST" sınıfı oluşturma `POST /api/v1/classes` → 403 `TENANT_LICENSE_EXPIRED_READ_ONLY`, kayıt oluşmadı (DB salt okunur: sınıf sayısı 1). Ardından U-SYS oturumuyla PRO dönem açıldı: 2026-10-21 00:00 UTC → 2027-01-31 00:00 UTC, 100 öğrenci (`POST /api/v1/tenants/:id/license-terms` 201, audit `license_term.created`); sistem paneli Plan Pro, 30 / 100, kurum özetindeki salt okunur uyarısı kalktı. Bkz. F-17, F-18 |

## Operatör smoke'ları (opsiyonel, mevcut kanıt zinciri)

`docs/phase-6-ops-runbook.md`'deki `live:onboarding:smoke`, `live:ui-worker:smoke`, `queue:smoke`,
`report-generation:smoke`, `raw-import:smoke` ve `live:exam-cycle:check` komutları özel girdi dosyası ve
sistem yöneticisi kimlik bilgisi ister; operatör kendi terminalinde koşar. Bunlar S1 senaryolarının yerine
geçmez, Gate E kanıt zincirini besler.

## Bulgular

| ID | Senaryo | Özet | Önem | Karar |
|---|---|---|---|---|
| F-01 | S1-01 | Kurum sahibi davet e-postası Gmail'de spama düştü. DNS kayıtları (cf-bounce SPF, `cf-bounce._domainkey` DKIM, bounce MX) mevcut; SPF/DKIM/DMARC sonucu henüz okunmadı | Yüksek (satış) | DMARC Management 2026-10-22'de açıldı (`_dmarc`'a Cloudflare RUA eklendi, `p=none` korundu). İlk rapor 2026-10-24: 2/2 PASS, Cloudflare SPF/DKIM hizalı; politika kararı 2026-11-14 kontrolünde |
| F-02 | S1-02 | Yönetici eklemek iki adımlı ve keşfedilmesi zor: önce "Yeni çalışan" profili, sonra satırdaki zarf ikonuyla hesap daveti; tek "yönetici ekle" akışı yok | Orta | Kapandı: #184 (`52ce7d03e`). "Yeni çalışan" penceresinde "Hesap daveti" rolü seçilirse profil aktif oluşturulur ve aynı adımda iş e-postasına davet gider (iş e-postası zorunlu); davet düşerse profil kalır, satırdan yeniden denenir. Ürün sahibi onayı 2026-10-14 |
| F-03 | S1-02 | Gönderilmiş davet iptal edilemiyor (API'de yalnız oluştur/kabul/yeniden gönder); süresi dolmamış davet varken aynı çalışana yeni davet `EMPLOYEE_INVITATION_ALREADY_PENDING`. Yanlış rolle giden davet kabul edilip rol sonradan değiştirildi | Orta | Kapandı: #180 (staging `adcca4617`, deploy `38481232415`). `POST /identity-invitations/:id/revoke` (user:manage; kurum sahibi daveti owner:manage). Çalışanlar satırında "Davet bekliyor" rozeti ve "Daveti iptal et"; öğretmen ayrıntısında "Daveti iptal et". İptal edilen bağlantı `IDENTITY_INVITATION_REVOKED` alır (F-20'den önce `IDENTITY_INVITATION_NOT_PENDING`), aynı kişiye hemen yeni rol/adresle davet açılır. Öğrenci kodu ve veli davetleri aynı uçla iptal edilir; ekran işlemleri Öğrenci Portal Erişimi satırında ve veli ayrıntısında (#191, `df86002b7`, main ve staging'de). Kabul sırasında iptal yarışı (inceleme bulgusu): konu bağı ve rol geri alınır, activity kaydı UNCERTAIN kalmaz; başka hesaba bağlı konunun e-posta daveti `SUBJECT_ALREADY_LINKED` ile reddedilir (#184). Geri alınan kabulün oluşturduğu kullanılmayan hesap silinir; aynı adrese yeni davet yeni parolayla açılır (#185). Ürün sahibi onayı 2026-10-14; S1-04 yeniden koşusunda U-FIN için süresi dolmuş daveti iptal edip yeniden gönderme bu akışla denenir |
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
| F-14 | - | E-posta yalnız doğrulanmış hedeflere gidebiliyor | Yüksek | Kapandı (2026-10-22, STAGING): Email Routing yapılandırılmamış, doğrulanmış hedef yok; finans daveti iki doğrulanmamış adrese ulaştı |
| F-15 | S1-03 | Öğrenci ayrıntısında öğrenci numarası varken "Öğrenci no yok" görünüyordu | Düşük | Kapandı: #168 (`b71d4997d`). profil yanıtı `studentNo` taşır |
| F-16 | - | Her deploy'daki backfill `APPLY` kampüs kapsamlı personeli kurum geneline genişletiyor (`scopeMode` → `TENANT`) ve `SUSPENDED`/`ENDED` üyeliklerin `staffRole`/persona alanlarını boşaltıyordu; davet kabulü mevcut hesabın üyeliklerini silip yeniden yazıyordu (VELİ hesabı ÖĞRETMEN davetini kabul edince veli üyeliği kayboluyordu) | Yüksek | Kapandı: #168 (`b71d4997d`). backfill yalnız farklı olan `ACTIVE` satırları yazar, ikinci `APPLY` no-op; boşaltılmış askıdaki/biten üyelik alanları legacy rol sütunundan, genişletilmiş kapsam yalnız `tenant_membership.updated` audit'indeki `campusCount` kanıtıyla geri yüklenir (kanıtsız satırlar `TENANT` kalır, elle kontrol). Davet kabulü mevcut hesaba yalnız davet edilen rolü ekler; uyumsuz hesap (öğrenci + başka rol) `IDENTITY_INVITATION_EMAIL_ACCOUNT_INCOMPATIBLE` ile reddedilir |
| F-17 | S1-14 | Salt okunur kurumda yazma reddedilince formda yalnız genel "Sınıf kaydedilemedi." uyarısı çıkıyor; nedenin lisans süresi olduğu ve ne yapılacağı söylenmiyor (API kodu `TENANT_LICENSE_EXPIRED_READ_ONLY`) | Düşük | Kapandı: #210 (`4612a9108`). bu kodla reddedilen her istek uygulama genelinde tek bir uyarı gösterir ("Lisans süresi dolduğu için kurum salt okunur…"); staging doğrulaması lisans süresi dolmuş bir kurum gerektirir |
| F-18 | S1-14 | Sistem panelinde lisans dönemi açma/yenileme ekranı yok: kurum ayrıntısı "Önerilen işlem: Lisansı yenile" diyor ama düğme yok; deneme sonrası PRO dönem yalnız `POST /api/v1/tenants/:id/license-terms` ile açılabildi | Orta (satış sonrası operasyon) | Bu dal: kurum ayrıntısı → Lisans ve kapasite → "Lisans dönemi aç" (plan, tarih, öğrenci sınırı; deneme kuralları ve çakışma mesajı); staging doğrulaması merge sonrası |
| F-19 | - | Sistem giriş sayfası (`sistem.o-okul.com/giris`) "KURUM GİRİŞİ" başlığını gösteriyor | Düşük | Kapandı: #210 (`4612a9108`). sistem girişinde "Sistem girişi" |
| F-20 | S1-04 | Davet başka bir çalışanın hesabındaki e-postaya uyarısız gönderildi (adres U-TCH hesabındaydı); aktivasyon `EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND` ile reddedildi ama ekran genel "yeni davet isteyin" mesajı gösterdi; iptal edilmiş davet bağlantısı "daha önce kullanılmış" dedi; aktivasyon sonrası sayfa tarayıcıdaki başka kullanıcının oturumuna yöneldi | Orta | Bu dal: davet oluşturulurken 409 ile reddedilir ve alan işaretlenir; aktivasyonda nedene göre mesaj (`IDENTITY_INVITATION_REVOKED` dahil); başarılı aktivasyon açık oturumu kapatıp girişe yönlendirir, çıkış başarısızsa uyarır. Kapandı: #212 (`d0fc36883`); STAGING 2026-10-22: "Yeni çalışan" akışında U-TCH adresine davet 409 `EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND`, alan altında mesaj, davet oluşmadı (test profili "UAT F20 Deneme" hesapsız kaldı) |
| F-21 | S1-04 | Hesap daveti penceresi iş e-postasını her açılışta profildeki adresle doldurur; davet farklı adrese gönderilince profil e-postası güncellenmez ve satırda davetin gittiği adres görünmez. Kabulden sonra çalışan satırı profil adresini (`ko••`), Kullanıcı hesapları hesabın adresini gösterir; aynı kişi için iki farklı e-posta. Başka hesaba bağlı adres 409 ile reddedilir (F-20), bağsız yanlış adres reddedilmez | Orta | Karar bekliyor (ürün sahibi) |
| F-22 | S1-04 | Öğretmenler listesindeki "Atama referansı" kartı 0/0/0 gösteriyor; aynı öğretmenin ayrıntısında 2 atama, 1 sınıf, 1 ders var. Öğrenci listesindeki "Sorumlu öğretmen" sütunu 8-A öğrencilerinde "—" gösteriyor; öğrenci ayrıntısı UAT ÖĞRETMEN'i sınıf öğretmeni olarak listeliyor (S1-05) | Düşük | Karar bekliyor |
| F-23 | S1-04 | Öğretmen satırındaki işlem düğmelerinin erişilebilir adı yalnız adı içeriyor ("UAT detay", "UAT sil"); aynı adlı iki öğretmen ekran okuyucuda ayırt edilemez. Çalışanlar ekranı tam adı kullanıyor | Düşük | Karar bekliyor |
| F-24 | S1-06 | Düzeltmede "Düzeltmeyi yayınla" düğmesi, düzeltilen not taslak olarak kaydedilene kadar pasif kalıyor ve neden pasif olduğu söylenmiyor; "Taslağı kaydet" görünür bir onay mesajı vermiyor, ekranda önceki "33 not yayınlandı (v1)." uyarısı kalıyor | Düşük | Karar bekliyor |

## Bitiş

- Tüm senaryolar PASS ya da bulgusu karara bağlanmış olunca S1 kapanır; `status.md` kapanış kaydına satır
  eklenir (kanıt sınıfı STAGING).
- UAT sonunda `uat-s1-okulu` kurumu askıya alınır. Silme, lisans sonu imhası akışıyla ve ayrı onayla yapılır.
