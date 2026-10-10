# Staging rol UAT'ı — S1 kiti (2026-10-10)

Plan: `docs/ozel-k12-strateji-ve-yol-haritasi-plan.md` §11.3. Onay: ürün sahibi, 2026-10-10 (staging'de test
kurumu, test kullanıcıları ve test verisi oluşturma). Ortam: https://o-okul.com, kurum adresi
`https://uat-s1.o-okul.com`. Staging sürümü UAT başında `/health` veya deploy run'ından not edilir; sürüm
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
| S1-01 | Kartsız deneme (KF-5) | U-SYS, U-OWN | Sistem → Kurumlar'da `uat-s1` kurumunu deneme lisansıyla aç; U-OWN daveti kabul edip MFA kursun | 7 günlük deneme, 100 öğrenci sınırı görünür; OWNER MFA zorunlu | |
| S1-02 | MFA ve destekli sıfırlama (KV-9) | U-OWN, U-ADM, U-SYS | U-ADM MFA kursun; U-SYS U-ADM'nin MFA'sını sıfırlasın; U-ADM yeniden kursun | Akış hatasız, audit kaydı var | |
| S1-03 | Öğrenci içe aktarma (KV-1) | U-ADM | `ogrenciler-8a-30.csv` önizle ve içe aktar; sonra `cakisma-tek-satir.csv` önizle | 30 öğrenci, 29 yasal veli iletişimi (izinler kapalı); ikinci dosyada `CONTACT_COLUMNS_CONFLICT` | |
| S1-04 | Personel ve atama | U-ADM | U-FIN ve U-TCH'yi davet et; U-TCH'yi 8-A sınıf öğretmeni ve Matematik branşına ata | Davetler ulaşır, girişte rol doğru | |
| S1-05 | Veli daveti ve bağlama (KV-3, KV-3b) | U-ADM | 2–3 veli iletişimine e-posta ekle; toplu davet gönder; U-GRD2'yi elle bağla; aynı daveti tekrar gönder | E-postasız veliler atlanır; ikinci davet oluşmaz; elle bağlama yalnız yasal veliye açık | |
| S1-06 | Not girişi, yayın, düzeltme (AK-3/AK-4) | U-TCH, U-ADM | 8-A Matematik yazılısı oluştur; 30 öğrencinin notunu gir (süreyi tut); yayınla; bir notu düzelt | Giriş <5 dk; düzeltme v2 açar; v1 değişmez | Süre: |
| S1-07 | Veli özeti ve PWA (KV-4) | U-GRD1 (gerçek telefon) | Daveti kabul et; uygulamayı ana ekrana ekle; özeti aç | Yalnız yayınlanmış not (v2) görünür; öğretmen notu ve diğer veli bilgisi yok | |
| S1-08 | Push ve büyük duyuru (KV-7, KV-6) | U-GRD1, U-ADM | U-GRD1 bildirim izni versin; U-ADM 8-A velilerine duyuru göndersin | Telefona push gelir; teslim raporunda sahte "sent" yok | |
| S1-09 | Otomatik bildirimler (KV-8) | U-TCH, U-FIN, U-GRD1 | Ada Ak'ı gelmedi işaretle, aynı gün düzelt; Ada için vadesi 3 gün sonra olan taksit oluştur; S1-06 düzeltmesinin bildirimini kontrol et | Devamsızlık için gün başına bir bildirim; vade hatırlatması; not yayını için sürüm başına bir bildirim | |
| S1-10 | Muhasebe (KF-1, KF-2) | U-FIN | İlk girişte parola değiştir; `/kurum/finans` aç; ödeme planı oluştur, vadesi geçmiş taksiti gör | 403 yok; gecikme doğru; aynı istek ikinci plan açmaz | |
| S1-11 | Ödev teslimi (AK-6) | U-TCH, U-STU | Ödev ver; öğrenci teslim etmeden "kontrol edildi" dene; öğrenci teslim etsin; kontrol et | Teslimsiz kontrol 409; teslim sonrası kontrol başarılı | |
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

## Bitiş

- Tüm senaryolar PASS ya da bulgusu karara bağlanmış olunca S1 kapanır; `status.md` kapanış kaydına satır
  eklenir (kanıt sınıfı STAGING).
- UAT sonunda `uat-s1` kurumu askıya alınır. Silme, lisans sonu imhası akışıyla ve ayrı onayla yapılır.
