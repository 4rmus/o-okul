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

| Sıra | Senaryo | Rol | Adımlar | Beklenen | Sonuç / kanıt |
|---|---|---|---|---|---|
| S1-01 | Kartsız deneme (KF-5) | U-SYS, U-OWN | Sistem → Kurumlar'da `uat-s1-okulu` kurumunu deneme lisansıyla aç; U-OWN daveti kabul edip MFA kursun | 7 günlük deneme, 100 öğrenci sınırı görünür; OWNER MFA zorunlu | PASS 2026-10-10: TRIAL 10-10→10-17, 100 öğrenci; MFA kurulmadan giriş yok (`auth.totp_enrollment_required`); bkz. F-01 |
| S1-02 | MFA ve destekli sıfırlama (KV-9) | U-OWN, U-ADM, U-SYS | U-OWN, U-ADM'yi Yeni çalışan + hesap daveti ile Kurum yöneticisi olarak eklesin; U-ADM MFA kursun; U-SYS U-ADM'nin MFA'sını sıfırlasın; U-ADM yeniden kursun | Akış hatasız, audit kaydı var | PASS 2026-10-11: U-SYS KV-9b ekranıyla U-ADM'nin MFA'sını sıfırladı, U-ADM yeniden MFA kurdu; bkz. F-04 |
| S1-03 | Öğrenci içe aktarma (KV-1) | U-ADM | `ogrenciler-8a-30.csv` önizle ve içe aktar; sonra `cakisma-tek-satir.csv` önizle | 30 öğrenci, 29 yasal veli iletişimi (izinler kapalı); ikinci dosyada `CONTACT_COLUMNS_CONFLICT` | PASS 2026-10-11: 30 öğrenci, 29 LEGAL_GUARDIAN iletişimi izinler kapalı; çakışma dosyası reddedildi. Ön koşul: seviye ve sınıf önceden açılmalı (bkz. F-05) |
| S1-04 | Personel ve atama | U-ADM | U-FIN'i Çalışanlar → Yeni çalışan + hesap daveti ile davet et; U-TCH için Öğretmenler → öğretmen ekle → ayrıntı → Hesap daveti gönder; U-TCH'yi 8-A sınıf öğretmeni ve Matematik branşına ata. Ön koşul: Ders, sınıfın seviyesine bağlı olmalı (Seviyeler → ders bağla veya Kurulum 4. adım) | Davetler ulaşır; ayrıntıda "Davet bekliyor", kabulden sonra "Portal bağlı"; girişte rol doğru | Bkz. F-07..F-11 |
| S1-05 | Veli daveti ve bağlama (KV-3, KV-3b) | U-ADM | 2–3 veli iletişimine e-posta ekle; toplu davet gönder; U-GRD2'yi elle bağla; aynı daveti tekrar gönder | E-postasız veliler atlanır; ikinci davet oluşmaz; elle bağlama yalnız yasal veliye açık | |
| S1-06 | Not girişi, yayın, düzeltme (AK-3/AK-4, AK-7) | U-TCH | U-TCH Öğretmen → Not defteri'nde 8-A Matematik yazılısı değerlendirmesini oluşturur; 30 öğrencinin notunu girer (süreyi tut); onay penceresiyle yayınlar; bir notu düzeltir ve düzeltmeyi yayınlar | Giriş <5 dk; öğretmen yönetimi beklemez (DEC-20261012-01); düzeltme v2 açar; v1 değişmez; atanmadığı sınıf seçenekte yok, API 403 | Süre: |
| S1-07 | Veli özeti ve PWA (KV-4) | U-GRD1 (gerçek telefon) | Daveti kabul et; uygulamayı ana ekrana ekle; özeti aç | Yalnız yayınlanmış not (v2) görünür; öğretmen notu ve diğer veli bilgisi yok | |
| S1-08 | Push ve büyük duyuru (KV-7, KV-6) | U-GRD1, U-ADM | U-GRD1 bildirim izni versin; U-ADM 8-A velilerine duyuru göndersin | Telefona push gelir; teslim raporunda sahte "sent" yok | |
| S1-09 | Otomatik bildirimler (KV-8) | U-TCH, U-FIN, U-GRD1 | Ada Ak'ı gelmedi işaretle, aynı gün düzelt; Ada için vadesi 3 gün sonra olan taksit oluştur; S1-06 düzeltmesinin bildirimini kontrol et | Devamsızlık için gün başına bir bildirim; vade hatırlatması; not yayını için sürüm başına bir bildirim | |
| S1-10 | Muhasebe (KF-1, KF-2) | U-FIN | İlk girişte parola değiştir; `/kurum/finans` aç; ödeme planı oluştur, vadesi geçmiş taksiti gör | 403 yok; gecikme doğru; aynı istek ikinci plan açmaz | |
| S1-11 | Ödev teslimi (AK-6, AK-7) | U-TCH, U-STU | U-TCH Öğretmen → Ödevler'de 8-A için "Ödev oluştur" ile ödev verir; öğrenci teslim etmeden "kontrol edildi" dene; öğrenci teslim etsin; kontrol et | Teslimsiz kontrol 409; teslim sonrası kontrol başarılı | |
| S1-12 | Fiyat sayfası (KF-9) | Ziyaretçi | https://o-okul.com/fiyatlar'da 250, 251, 500, 501, 1000, 1001 öğrenciyi hesapla | Sınırda toplam fiyat düşmez (kademeli hesap); kartsız deneme düğmesi görünmez | |
| S1-13 | Doğrulama kiti (KF-10) | Operatör | Anonimleştirme betiğini bir örnek optik dosyada çalıştır; sonucu `uat-s1` kurumuna yükle | Kimlik alanları ezilmiş; dosya karneye ulaşır | |
| S1-14 | Lisans sonu (KF-5) | U-SYS | Deneme bitişini bekleme; kurum ayrıntısında lisans durumunun READ_ONLY'ye geçiş kuralını kontrol et | Süre dolunca salt okunur (geçiş tarihi not edilir; gerçek geçiş 7. günde doğrulanır) | |

## Operatör smoke'ları (opsiyonel, mevcut kanıt zinciri)

`docs/phase-6-ops-runbook.md`'deki `live:onboarding:smoke`, `live:ui-worker:smoke`, `queue:smoke`,
`report-generation:smoke`, `raw-import:smoke` ve `live:exam-cycle:check` komutları özel girdi dosyası ve
sistem yöneticisi kimlik bilgisi ister; operatör kendi terminalinde koşar. Bunlar S1 senaryolarının yerine
geçmez, Gate E kanıt zincirini besler.

## Bulgular

| ID | Senaryo | Özet | Önem | Karar |
|---|---|---|---|---|
| F-01 | S1-01 | Kurum sahibi davet e-postası Gmail'de spama düştü. DNS kayıtları (cf-bounce SPF, `cf-bounce._domainkey` DKIM, bounce MX) mevcut; SPF/DKIM/DMARC sonucu henüz okunmadı | Yüksek (satış) | Ürün sahibi: sonra bakılacak |
| F-02 | S1-02 | Yönetici eklemek iki adımlı ve keşfedilmesi zor: önce "Yeni çalışan" profili, sonra satırdaki zarf ikonuyla hesap daveti; tek "yönetici ekle" akışı yok | Orta | Açık |
| F-03 | S1-02 | Gönderilmiş davet iptal edilemiyor (API'de yalnız oluştur/kabul/yeniden gönder); süresi dolmamış davet varken aynı çalışana yeni davet `EMPLOYEE_INVITATION_ALREADY_PENDING`. Yanlış rolle giden davet kabul edilip rol sonradan değiştirildi | Orta | Açık |
| F-04 | S1-02 | Sistem yöneticisi için kurum yöneticisinin MFA'sını sıfırlama ekranı yoktu | - | Kapandı: KV-9b (#159) |
| F-05 | S1-03 | İçe aktarma seviye/sınıf oluşturmaz; eksik sınıf hatası kullanıcıyı seviye/sınıf ekranına yönlendirmez | Düşük | Açık |
| F-06 | S1-03 | Deneme lisansında `seatLimit` hesap sınırı olarak uygulanıyordu | - | Kapandı: #161 |
| F-07 | S1-04 | Öğretmen için hesap daveti ekranı yoktu | - | Kapandı: #162 |
| F-08 | S1-04 | Davet kabulü 500 döndü ve kilitli UNCERTAIN kayıt bıraktı | - | Kapandı: #163 |
| F-09 | S1-04 | Öğretmen listesinde hesap durumu yanlış gösteriliyordu | - | Kapandı: #164 |
| F-10 | S1-04 | Öğretmen atama hatası (`TEACHER_ASSIGNMENT_COURSE_GRADE_LEVEL_MISMATCH` vb.) düzenleme penceresinde görünmüyordu | - | Bu PR: hata kodu başına Türkçe mesaj, seviye uyuşmazlığında Seviyeler bağlantısı |
| F-11 | S1-04 | Ders-seviye bağı yalnız Kurulum sihirbazının 4. adımında kurulabiliyordu; Dersler/Seviyeler ekranından eklenen ders atanamıyordu | - | Bu PR: Seviyeler → "derslerini yönet" ile mevcut dersi seviyeye bağlama. Bağı kaldırma API'de yok (izleyen iş) |

## Bitiş

- Tüm senaryolar PASS ya da bulgusu karara bağlanmış olunca S1 kapanır; `status.md` kapanış kaydına satır
  eklenir (kanıt sınıfı STAGING).
- UAT sonunda `uat-s1-okulu` kurumu askıya alınır. Silme, lisans sonu imhası akışıyla ve ayrı onayla yapılır.
