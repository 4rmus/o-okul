# O-Okul İş Modeli, Pazar ve Rekabet Analizi

Tarih: 2026-10-02
Başlangıç sürümü: `main` / `208369ab`
Kapsam: iş modeli, Türkiye özel öğretim pazarı, yerli ve küresel rakiplerin modülleri, O-Okul'un
eksik modül ve yetenekleri, öncelikli öneriler
Durum: Analiz ve öneridir. Ürün kapsamını değiştirmez; buradaki her kapsam genişlemesi
`docs/DECISIONS.md` içinde yeni bir DEC kaydı gerektirir.

## Kanıt Sınıfları

| Bulgu türü | Kanıt sınıfı | Not |
|---|---|---|
| O-Okul modül envanteri, iş modeli sinyalleri | `LOCAL_STATIC` | Kod, Prisma şeması ve aktif dokümanlar bu çalışmada okundu. "Çalışıyor" ifadesi repo davranışıdır; canlı müşteri kanıtı değildir. |
| Rakip modülleri, fiyatları, müşteri sayıları | `EXTERNAL` (web, 2026-10-02 erişimi) | Büyük çoğunluğu firma beyanıdır. Bir özelliğin rakip sitesinde görülmemesi, üründe olmadığını kanıtlamaz. |
| Pazar ve mevzuat verisi | `EXTERNAL` | MEB özel öğretim kursu sayıları birincil PDF'ten teyit edildi. Diğer rakamlar kaynaklarıyla verilmiştir. |
| Müşteri görüşmesi, pilot, kazanma/kaybetme verisi | `UNPROVEN` | Bu analizde müşteri görüşmesi yapılmadı. Öncelikler pilotta doğrulanmalıdır. |
| Staging/production durumu | Yeniden doğrulanmadı | Güncel durum için `status.md` esastır. Pilot ve go-live `EXTERNAL_NOT_RUN`. |

Köşeli parantez içindeki kodlar (ör. `[T4]`, `[G10]`, `[M1]`) belgenin sonundaki kaynak listesine
karşılık gelir.

---

## 1. Yönetici Özeti

1. **O-Okul, Türkiye'deki rakiplerinden farklı bir yerde konumlanmış.** Ürün dar ama derin bir
   çekirdeğe sahip: optik TXT/DAT verisini doğrulama, sürümlü cevap anahtarı, karantina, tekrar
   üretilebilir rapor ve karne. Buna kurum operasyonu ekleniyor. Güvenlik ve veri doğruluğu
   (RLS, denetim kaydı, şifreli kişisel veri, snapshot) pazarın çok üzerinde. Ancak alıcının
   satın alma kriterleri modül genişliği ve veli deneyimi. Bu alanlarda ürün pazar normunun
   gerisinde.
2. **İş modeli pazarla uyumlu, gelir tabanı dar.** Aktif öğrenci kotasına dayalı yıllık lisans ve
   ücretsiz personel hesabı Türkiye'de de kullanılan bir model (OkulumNET, Delta Kurs) [T35][T15]. Gelir tek
   kalemden oluşuyor. Rakiplerin ek gelir kalemleri (SMS paketi, online tahsilat, optik form, ek
   kullanıcı, mobil uygulama) O-Okul'da ya kapalı ya kapsam dışı.
3. **Pazar küçük ve parçalı.** MEB 2024/'25 verisine göre 4.175 özel öğretim kursu ve 278.891
   kursiyer var; kurs başına ortalama yaklaşık 67 kursiyer düşüyor [M1]. Kurs segmentinin yazılım
   harcaması kaba tahminle yılda ₺40–250 milyon. Komşu segment olan özel okulların hacmi yaklaşık
   2–5 kat daha büyük (14.700 okul, 1,54 milyon öğrenci) [M2]. Yüksek temaslı kurulum ve sözleşme
   modeli, ortalama 67 öğrencili bir müşteride birim ekonomiyi zorluyor.
4. **Ücretsiz ikameler fiyat baskısı yaratıyor.** Yayınevi deneme paketleriyle gelen optik
   okuma ve karne, MEB Konya ÖDM'nin ücretsiz optik yazılımı ve MEBİ (5,7 milyon kullanıcı) temel
   analizi ücretsiz veriyor [T28][T29][T33]. "Sadece karne" ürünü ödeme isteği düşük bir iş. Değer,
   birden çok yayınevinin denemesini tek yerde birleştirmekte, öğrencinin gelişimini zaman içinde
   izlemekte ve analizi aksiyona bağlamakta.
5. **En kritik açık veli kanalı.** Türkiye'deki rakiplerin neredeyse tamamı ürününü "veli
   bilgilendirme sistemi" olarak konumluyor. O-Okul'da veli portalı emekliye ayrılıyor, SMS ve
   WhatsApp varsayılan kapalı, push bildirimi yapılandırılmamış. Go-live'da veliye otomatik ulaşan
   fiilen hiçbir kanal kalmıyor. Devamsızlık eşiği uyarısı da yalnızca veli (`GUARDIANS`)
   kitlesine gidiyor; veli emekliliğiyle bu uyarı alıcısız kalacak.
6. **Kullanıcının iptal ettiği dört kapsamın dördünü de rakipler pazarlıyor.** Bu kapsamlar:
   sınav salonu ve oturma planı, online deneme, fotoğraftan veya kameradan optik okuma, AI karne
   yorumu. Odak açısından iptal kararı savunulabilir. Yine de pilottan sonra yeniden
   değerlendirilmeleri önerilir.
7. **Önerilen konum: "deneme analitiği ve öğrenci gelişimi uzmanı, tamamlanmış kurs
   çekirdeğiyle".** 40 modüllük rakiplerle modül sayısında yarışmak yerine önce satış engeli olan
   temel modüller kapatılmalı: veli bildirimi, taksit hatırlatma, ön kayıt ve mobil erişim. Sonra
   ölçme alanında en iyi olunmalı: madde analizi, çoklu yayınevi konsolidasyonu ve
   deneme → kazanım → etüt/koçluk → veli döngüsü. Güvenlik ve doğruluk bu yapının güven
   katmanı olarak satılmalı.

### En önemli 10 eksik (özet)

| # | Eksik | Öncelik | Neden |
|---|---|---|---|
| 1 | Veli bildirim döngüsü: hesapsız, `StudentContact` üzerinden SMS, WhatsApp veya e-posta ile devamsızlık, sonuç ve taksit bildirimi | P0 | Türkiye'deki rakiplerin neredeyse tamamında var. Kursa ödeme yapan kişi veli. |
| 2 | Otomatik hatırlatma motoru: taksit vadesi, devamsızlık, sonuç yayını | P0 | Taksit takibi var ama hatırlatma yok. Rakiplerde otomatik SMS standart. |
| 3 | Mobil erişim: önce çalışan push'lu PWA, sonra native uygulama | P0 | Segmentteki bütün büyük rakiplerde mobil uygulama var. |
| 4 | Optik format kapsamı ve yayınevi sonuçlarını içe aktarma | P0 | 4 hazır şablon var, gerçek dosyayla doğrulanan yalnızca 1. Kurs birden çok yayınevi kullanıyor. |
| 5 | Ön kayıt / aday CRM ve bursluluk (tanıtım) sınavı | P1 | Kursun öğrenci kazanma kanalı. Eyotek, K12NET, Delta, Kurspro, DersDers ve Bilsa'da var. |
| 6 | Madde analizi (zorluk, ayırt edicilik, çeldirici, KR-20) ve kampüs karşılaştırması | P1 | Ölçme araçlarında yıllık 7 dolarlık üründe bile var. Veri O-Okul'da zaten mevcut. |
| 7 | Deneme sonucuna göre otomatik etüt ataması, rehberlik ve koçluk | P1 | Eyotek ve K12NET'in öne çıkardığı döngü. O-Okul'da parçaları var, bağlantı yok. |
| 8 | Online tahsilat (lisanslı ödeme kuruluşu üzerinden) ve e-Arşiv/e-Fatura entegrasyonu | P1 | Eyotek, K12NET, Kurspro ve Delta'da var. Aynı zamanda ek gelir kalemi. |
| 9 | Tekrarlayan haftalık ders programı şablonu | P1 | Şu an her ders tek tek tarih-saatle giriliyor. Kurs operasyonunda günlük sürtünme yaratıyor. |
| 10 | Kamerayla mobil optik okuma ve AI karne yorumu (iptal edilen kapsamlar) | P2 | Optik okuyucusu olmayan küçük kursa kapı açar. AI rakiplerde hızla standartlaşıyor. |

---

## 2. O-Okul İş Modeli Analizi

### 2.1 Ürün tanımı ve değer önerisi

Kanonik ana mesaj "Optik veriyi kontrol edin, rapora dönüştürün"dür (`docs/marketing-claims.md`).
V1 değer döngüsü şudur: TXT/DAT optik → güvenilir rapor ve karne → kurum, öğretmen ve öğrenci
için yetkili görünüm → ödeme ve iletişim takibi (`docs/product-journeys-v1.md`).

Değer önerisinin bileşenleri:

| Bileşen | Kanıt | Alıcı için anlamı |
|---|---|---|
| Optik veri doğruluğu: format analizörü, şablon, A/B kitapçık, karantina, eşleşmeyen satır çözümü | `apps/worker/src/jobs/optical-answer-parser.ts`, `booklet-alignment.ts`, `apps/api/src/exam/raw-import.controller.ts` | Hatalı veya eşleşmeyen satırlar rapora sızmıyor. |
| Sürümlü cevap anahtarı, iptal soru, append-only düzeltme | DEC-20260727-01, `apps/api/src/exam/*` | Düzeltme sonrası eski ve yeni sonuç izlenebilir kalıyor. |
| Başarı % ile farklı soru sayılı sınavları karşılaştırma; Net/Soru ve deneme puanı bağlam olarak | DEC-20260713-02, `apps/worker/src/jobs/scoring-engine.ts` | Farklı uzunluktaki denemeler adil biçimde kıyaslanıyor. |
| Standart sapmasız, sürümlü LGS/YKS deneme puanı; "resmî değildir" uyarısı | DEC-20260727-01 | Yanıltıcı "resmî puan" iddiası yok. |
| Değişmez rapor sürümü, PDF ve Excel, karne, hata kitapçığı, kazanım radarı, gelişim trendi | `apps/api/src/report`, `apps/worker/src/jobs/report-pdf-render-job.ts`, `apps/web/app/(app)/kurum/raporlar/reports-page.tsx` | Aynı veri web, PDF ve Excel'de aynı sonucu veriyor. |
| Kurum operasyonu: kurulum sihirbazı, kayıt, yoklama, program, etüt, ödev, duyuru, finans takibi | `apps/api/src/*`, `apps/web/app/(app)/kurum/*` | Tek yerden günlük iş. |
| Güvenlik ve KVKK odaklı mimari: RLS, şifreli TC/iletişim verisi, denetim kaydı, rol önizleme, yedek/geri yükleme | ADR-0001, `apps/api/src/privacy`, `apps/api/src/audit-log`, `apps/api/src/operations` | Kurumlar arası veri sızıntısı riski düşük. Hukuk onayı ayrıca gerekli. |

### 2.2 Müşteri segmenti ve personalar

- **Hedef müşteri:** Tek veya çok şubeli dershane / özel öğretim kurumu (DEC-20260613-01).
  Yük hedefi kurum başına 10 bin öğrenci, 1.000 çalışan ve 20 kampüs.
- **Hedef personalar:** Kurum sahibi, kurum yöneticisi, operasyon çalışanı, finans çalışanı,
  öğretmen, öğrenci.
- **Bilinçli dışlama:** Veli personası (DEC-20260801-01, DEC-20260930-01). Veli, giriş yetkisi
  olmayan `StudentContact` kaydına dönüşüyor.
- **Gözlem:** Kursun ödeme yapan müşterisi veli. Kurum yazılımı büyük ölçüde veliye hizmet
  kalitesini göstermek için satın alıyor. Rakiplerin satış dili de bu yönde ("veli bilgilendirme
  sistemi"). Veliyi ürünün tamamen dışında bırakmak, değer önerisinin satış tarafını zayıflatıyor
  (bkz. §6.1).

### 2.3 Gelir modeli

| Unsur | O-Okul'daki durum | Kanıt |
|---|---|---|
| Fiyat birimi | Aktif öğrenci kotası (açık ACTIVE kayıt). pasif öğrenci ve çalışan hesabı kotayı tüketmez. | DEC-20260801-01, DEC-20260831-01 |
| Sözleşme | Yıllık veya çok yıllık `LicenseTerm` segmentleri. Geriye dönük değiştirilmez, yalnızca eklenir. | `packages/db/prisma/schema.prisma` (`LicenseTerm`, `LicenseUsage`) |
| Plan kodları | `TRIAL`, `PRO`; `ENTERPRISE` yalnızca etiket. Kodda ve landing sayfasında fiyat yok. | `apps/api/src/license/license-term-store.ts`, `apps/api/src/tenant/tenant-store.ts` |
| Kota aşımı | Hard-block: işlem tamamen reddedilir. Lisans dönemi yoksa varsayılan kota 200. | `apps/api/src/student/student.service.ts` |
| Lisans bitişi | 14 gün salt-okunur, 15–90. günler dondurulmuş saklama, 91. gün legal hold ve saklama kontrolüne bağlı imha süreci. | `apps/api/src/license/license-state.ts` |
| Satış | İmzalı sözleşmeden sonra kurumu platform yöneticisi açar. Self-service satın alma ve deneme yok. | `docs/account-management-architecture-plan.md` §1 |
| Ek gelir kalemleri | Yok. SMS (`SMS_ENABLED=false`) ve WhatsApp (`WHATSAPP_ENABLED=false`) kapalı; ödeme, fatura ve makbuz V1_OUT. | DEC-20260613-01, DEC-20260808-01 |

### 2.4 Dağıtım ve maliyet yapısı

- **Dağıtım:** Türkiye'de VPS üzerinde self-hosted Docker Compose (DEC-20260529-02). Bileşenler:
  PostgreSQL+RLS, Redis/BullMQ, MinIO, ClamAV, Traefik, Prometheus/Grafana/Loki/Sentry. E-posta
  Cloudflare Worker gateway'i (`notify.o-okul.com`) üzerinden gidiyor.
- **Sabit maliyetler:** Altyapı ve gözlemlenebilirlik yığını; güçlü kanıt ve evidence disiplini
  (Gate A–F, UAT ve release kanıtları). Bu disiplin güven yaratıyor ama yetenek geliştirme hızını
  düşürüyor.
- **Değişken maliyetler:** Kurum başına kurulum ve optik format uyarlaması; açılırsa SMS ve
  WhatsApp mesaj maliyeti; destek.
- **KVKK notu:** E-posta gateway'i yurt dışı merkezli bir sağlayıcıda çalışıyor. Meta (WhatsApp)
  ve olası AI sağlayıcıları da yurt dışı aktarım kapsamına girebilir. 7499 sayılı Kanun sonrası
  standart sözleşme ve Kurula 5 iş günü içinde bildirim yükümlülüğü var [M15]. Bu konu hukuk
  değerlendirmesi gerektiriyor.

### 2.5 İş modeli kanvası

| Blok | O-Okul |
|---|---|
| Müşteri segmenti | Tek veya çok şubeli özel öğretim kursları (LGS, TYT, AYT hazırlık). Teknik altyapı okul (`SCHOOL`) ve karma (`MIXED`) kampüs tipini de destekliyor. |
| Değer önerisi | Güvenilir optikten karneye akış, Başarı % odaklı adil kıyas, tek yerde kurum operasyonu, kurumlar arası güçlü veri izolasyonu. |
| Kanallar | Doğrudan satış, "Demo talep et" çağrısı, kurum alt alan adı (`{kurum}.o-okul.com`). |
| Müşteri ilişkisi | Yüksek temaslı: sözleşme, platform yöneticisinin kurulumu, 5 adımlı kurulum sihirbazı, lisans yenileme talebi. |
| Gelir akışları | Aktif öğrenci kotasına dayalı yıllık lisans. Başka kalem yok. |
| Temel kaynaklar | Çok kiracılı platform, puanlama motoru ve sürümlü puan profilleri, optik şablonlar, kanıt zinciri. |
| Temel faaliyetler | Ürün geliştirme, optik format uyarlama, kurulum, operasyon ve yedekleme. |
| Temel ortaklar | Fiilen yok. Potansiyel: yayınevleri, optik okuyucu satıcıları, SMS sağlayıcısı (Netgsm), Meta, lisanslı ödeme kuruluşu, e-fatura entegratörü. |
| Maliyet yapısı | VPS ve altyapı, mühendislik ve kanıt disiplini, kurulum ve destek. |

### 2.6 İş modeli açısından kritik gözlemler

1. **Ortalama müşteri ile mimari hedef arasında ölçek farkı var.** Mimari 10 bin öğrenci ve 20
   kampüs için tasarlanmış. Pazardaki ortalama kurs ise yaklaşık 67 kursiyerli [M1]. Öğrenci başı
   ₺150–350 aralığında bir fiyatla (Eyotek'in ilan ettiği aralık ₺133–363 [T4]) ortalama kurs
   yılda yaklaşık ₺10–25 bin gelir bırakır. Sözleşmeli satış, platform yöneticisinin kurulumu ve
   kurum başına optik uyarlama bu gelirle karşılanamaz. İki yol var:
   - büyük ve çok şubeli zincirlere odaklanmak (mimarinin güçlü olduğu yer),
   - küçük kurs için self-service deneme ve kurulum.
2. **Gelir tek kalemden oluşuyor.** Rakiplerin ek gelir kalemleri:
   - SMS paketleri (Eyotek, TestOkur),
   - optik form satışı (Eyotek, 1000'lik paketler [T4]),
   - ek kullanıcı ücreti (Kurspro, ₺7.200/yıl [T17]),
   - online tahsilat entegrasyonu (Eyotek iyzico, K12NET Param),
   - mobil uygulama.

   Küresel örnekte Blackbaud gelirinin yaklaşık %34'ü işlem bazlı [G18]. a16z, gömülü finansın
   müşteri başı geliri 2–5 kat artırabileceğini savunuyor [G28].
3. **Kotadaki hard-block, kayıt sezonunda sürtünme yaratıyor.** Kurs kayıtları Haziran–Eylül
   arasında, LGS ve YKS sonrasında yoğunlaşıyor. Aşımda kayıt işlemi tamamen reddediliyor, yükseltme
   ise manuel bir lisans talebi. Bu, hem müşteriyi kızdırıyor hem de yükseltme gelirini
   geciktiriyor.
4. **TL enflasyonu ve mevzuat tavanı birlikte etkiliyor.** 2025 yönetmelik değişikliğiyle kurs
   ücret artışı TÜFE ve Yİ-ÜFE ortalamasıyla sınırlandı [M4]. Kurslar yazılım zammını bu tavanla
   kıyaslayacak. Geriye dönük değiştirilemeyen çok yıllık lisanslarda bir endeksleme maddesi
   gerekiyor.
5. **Fiyat şeffaflığı bir rekabet aracı.** K12NET, Bilsa, OktaSis, OkulTek ve Derssis fiyat
   yayımlamıyor. Eyotek, Kurspro, Delta, DersDers ve AkademiBulut yayımlıyor. Küresel tarafta
   "gizli ücret" en sık kayıp ve şikâyet nedenlerinden biri [G31]. O-Okul'un fiyatı da yayımlanmış
   değil.
6. **Go-to-market riski özellik riskinden büyük.** Pilot ve go-live henüz yapılmadı (Gate F
   `EXTERNAL_NOT_RUN`). Yatırımın büyük kısmı kanıt zincirine gitti. Bu belgedeki önceliklerin
   hiçbiri pilot kurumla yapılacak görüşmenin yerini tutmaz.

### 2.7 SWOT

| Güçlü yönler | Zayıf yönler |
|---|---|
| Kiracı izolasyonu (RLS, ikinci savunma katmanı), şifreli kişisel veri, denetim, yedek ve geri yükleme | Veli kanalı yok; SMS, WhatsApp ve push kapalı |
| Sürümlü, tekrar üretilebilir rapor; karantina; Başarı % ile adil kıyas | Mobil uygulama yok, PWA kısmi |
| Ücretsiz personel hesabı, aktif öğrenci bazlı fiyat | Ön kayıt CRM, online tahsilat, e-fatura, kasa ve maaş modülleri yok |
| Modern ve erişilebilir web arayüzü (Berrak), rol önizleme, öğrenci 360 görünümü | Optik format kapsamı dar (4 şablon, 1'i gerçek dosyayla doğrulanmış) |
| Türkiye'de barındırma, KVKK odaklı tasarım | Madde analizi, kampüs karşılaştırması, Türkiye geneli kıyas yok |
| Hata kitapçığı, kazanım radarı, gelişim trendi | Self-service deneme yok; fiyat yayımlanmamış; pilot yapılmadı |

| Fırsatlar | Tehditler |
|---|---|
| Yayınevinden bağımsız, birden çok yayınevini birleştiren analiz (yayınevi kilidinin tersi) | Ücretsiz ikameler: yayınevi panelleri, MEB Konya ÖDM, MEBİ |
| 2025 yönetmeliği: e-Özel kaydı, %3 ücretsiz öğrenci, ücret ilanı. Rakiplerde uyum raporu görülmedi. | 40+ modüllü yerleşik oyuncular (Eyotek, K12NET, Bilsa) ve hızlı yeni gelenler (Kurspro, DersDers) |
| Maarif Modeli: 2028'de beceri temelli yeni soru modeli. Analiz motoruna beceri boyutu eklenmesi gerekecek. [M7] | 7590 sayılı Kanunla ağırlaşan yaptırım rejimi; kurumların risk iştahı düşüyor |
| WhatsApp'ın %88,6 yaygınlığı; Türkiye'de utility şablon fiyatlarının düşmesi [M13][M14] | Rakiplerin AI'yı agresif pazarlaması (sesli asistan, çalışma planı) |
| Rakip mobil uygulamalarında düşük kalite (K12NET iOS 1,9★) [T10] | Pazarın küçüklüğü: kurs segmenti tek başına sınırlı bir gelir tavanı veriyor |

---

## 3. Pazar: Türkiye Özel Öğretim Ekosistemi

### 3.1 Büyüklük

| Gösterge | Değer | Kaynak |
|---|---|---|
| Özel öğretim kursu (2024/'25) | 4.175 kurum, 278.891 kursiyer, 19.170 öğretmen, 28.249 derslik | [M1] MEB Millî Eğitim İstatistikleri. Birincil PDF'ten teyit edildi. |
| Kurs başına ortalama kursiyer | ≈ 67 | Hesaplama: 278.891 / 4.175 |
| Muhtelif kurslar | 6.353 kurum, 482.635 kursiyer | [M1] |
| Toplam özel yaygın eğitim | 18.217 kurum | [M1] |
| Özel okullar (örgün) | 14.700 okul, 1.539.579 öğrenci | [M2] |
| YKS 2026 başvurusu | 2.425.560 | [M8] |
| LGS 2026 merkezî sınav | 1.022.658 başvuru, 994.358 katılım | [M9] |
| MEBİ (ücretsiz kamu platformu) | 2025-26'da 5,676 milyon kullanıcı; 683 bin öğrenci yaklaşık 3,7 milyon deneme çözdü | [T33] |
| Öğrenci başına kurs ücreti | ₺40.000–90.000; İstanbul'da ₺75.000–125.000 (Ocak 2026 içeriği) | [M10]. Kaynaklar arasında büyük fark var. |

**Kaba yazılım pazarı tahmini** (doğrulanmadı, sıralama amaçlı):

- Kurs segmenti, kurum bazında: 4.175 × ₺20–60 bin/yıl ≈ **₺85–250 milyon/yıl**
- Kurs segmenti, öğrenci bazında: 278.891 × ₺150–350/yıl ≈ **₺42–98 milyon/yıl**
- Özel okul segmenti, öğrenci bazında: 1.539.579 × ₺150–350/yıl ≈ **₺230–540 milyon/yıl**

Yazılımın öğrenci başı maliyeti kurs ücretinin %1'inden az. Fiyat tek başına engel değil;
belirleyici olan değer anlatımı ve geçiş maliyeti.

### 3.2 Mevzuat ve dinamikler

- **2014–2018 dönüşümü:** 6528 sayılı Kanunla dershaneler kapatma sürecine girdi; yaklaşık 1.221
  temel lise açıldı, yaklaşık 700 dershane kapandı [M11]. Ardından "özel öğretim kursu" türü önce
  676 sayılı KHK ile, sonra 7070 sayılı Kanunla (2018) kanunlaştı [M3].
- **Etüt merkezleri:** 687 sayılı KHK ile ayrı bir kategori olmaktan çıktı [M3]. Pazarlamada
  "etüt merkezi" diye hedeflenen kitle yasal olarak farklı ruhsat türlerinde faaliyet gösteriyor.
- **Deneme düzenleme yetkisi:** 5580 sayılı Kanun Ek Madde 2'ye göre okullar ve özel öğretim
  kursları dışındaki yerler toplu deneme organizasyonu yapamaz [M3]. O-Okul'un hedef müşterisi
  bu yetkiye sahip.
- **Özel Öğretim Kurumları Yönetmeliği değişikliği (03.01.2025, ikincil kaynak, resmî metinle
  teyit edilmeli)** [M4]:
  - en az %3 ücretsiz öğrenci,
  - ücretlerin her yıl 31 Mayıs'a kadar ilanı,
  - artış tavanı TÜFE ve Yİ-ÜFE ortalaması,
  - kayıtların e-Özel üzerinden yapılması.
- **7590 sayılı Kanun (RG 31.07.2026)** [M5][M6]:
  - kurum türüne uygun olmayan program uygulanması yaptırım kapsamına alındı,
  - bazı ihlallerin tekrarında idari para cezası beş katına çıkıyor,
  - üçüncü ihlalde ruhsat iptal ediliyor.

  Reklam ve ilanlarda öğrenci bilgisinin kullanılmasına ilişkin ayrıntı bu çalışmada teyit
  edilemedi; hukuk incelemesi gerekiyor. Bu, rakiplerin "başarı belgesi / başarı ilanı"
  özellikleri için potansiyel bir uyum riski.
- **Maarif Modeli:** 2028'den itibaren LGS ve YKS'de beceri ve bağlam temelli yeni soru modeli
  uygulanacak [M7]. Kazanım analizinin yanına beceri boyutu eklenmesi gerekecek.
- **Kanal tercihi:** Türkiye'de WhatsApp kullanımı %88,6 [M13]. Meta, 1 Temmuz 2025'te mesaj
  başı fiyatlamaya geçti. Müşteri hizmet penceresindeki utility şablonları ücretsiz ve
  Türkiye'nin utility fiyatları düşürüldü [M14].

### 3.3 Kurslar yazılımı bugün nasıl edinir

Bu bölüm gözleme dayanıyor; kısmen doğrulandı.

1. **Yayınevi paketleri:** Kurumsal deneme paketiyle optik okuma ve karne "ücretsiz" geliyor.
   Okumayı çoğunlukla bayi yapıyor. Her yayınevi yalnızca kendi denemesini raporluyor
   [T29][T30][T31].
2. **Ücretsiz kamu araçları:** MEB Konya ÖDM optik yazılımı ve MEBİ [T28][T33].
3. **Masaüstü yazılımlar:** TestOkur, Bilsa Windows, Akınsoft [T25][T36][T12].
4. **Hepsi bir arada bulut abonelikleri:** Eyotek, K12NET, Kurspro, Delta, DersDers.

---

## 4. Rakip Haritası

### 4.1 Segmentler

| Segment | Oyuncular | O-Okul ile ilişki |
|---|---|---|
| 1. Kurs / dershane / etüt yönetim yazılımı | Eyotek, Bilsa Kurssis, Delta Kurs (OnlineKurum), Kurspro, DersDers, Derssis, AkademiBulut, OktaSis, OkulTek, HeryerOnline, EduDiamond, Akınsoft (eski masaüstü) | Doğrudan rakip |
| 2. Okul yönetimi (özel okul, K12) | K12NET, Okulsis (Bilsa), OkulumNET, K12Nova, Eyotek | Komşu segment; kursa da satıyorlar |
| 3. Sınav, optik değerlendirme, karne | TestOkur, YZ Takip, YES.Tools, MEB Konya ÖDM (ücretsiz) | O-Okul çekirdeğinin doğrudan ikamesi |
| 4. Yayınevi ve içerik platformlarının kurumsal ürünleri | Hız (hizlideneme), Limit/Teknosınav, Özdebir, Anında Sonuç, Fernus, MEBİ, Okulistik, Morpa Kampüs | Ücretsiz ikame; aynı zamanda potansiyel ortak |
| 5. Mobil optik ve AI | Test Plus, ABC Optik, Exam Reader, K12NET mobil optik | İptal edilen kamera okuma kapsamının pazarı |
| Küresel referans | Teachmint, Classplus, Proctur, Addmen, Fedena, Classter, Teachworks, Wise, Toddle, PowerSchool; ölçme tarafında ZipGrade, Gradient, Akindi, Remark | Trend ve fiyat benchmark'ı |

### 4.2 Türkiye: öne çıkan rakip profilleri

**Eyotek: en olgun bulut oyuncularından biri** [T1–T5]
- Hedef: özel okul, kurs, kolej, çok şubeli zincirler. Bir müşteri referansı 24 şube ve
  7.000'den fazla öğrenciden söz ediyor.
- 41 modül [T2]:
  - kayıt ve operasyon: ön kayıt (CRM), ders ve nöbet programı, devamsızlık, ödev, etüt ve özel
    ders, müfredat takibi;
  - sınav: sınav sınıfı (salon) düzenleme, sınav değerlendirme, hedef soru takibi, online sınav,
    bursluluk sınavı, soru havuzu;
  - rehberlik: notlar, "Sorum Var", rehberlik anketi;
  - yönetim: İK, personel, ön muhasebe, avukat, kütüphane, revir, yemek;
  - iletişim: veli-öğrenci bilgilendirme, otomatik SMS ve bildirim, sistem içi mesaj.
- Sınav: kâğıt ve dijital optik. Yayınevi analizleri toplu yükleniyor ve AI ile eşleniyor.
  İl, ilçe ve Türkiye geneli sıralama var. Barajın altında kalan öğrenci otomatik olarak etüde
  atanıyor [T3].
- iyzico entegrasyonu Ağustos 2026'da duyuruldu [T1]. Mobil uygulaması App Store'da 4,7★ [T5].
- Fiyat (özel okul tarifesi, KDV hariç, yıllık): 100 öğrenci ₺36.342; 300 öğrenci ₺61.807;
  1.000 öğrenci ₺133.337 [T4].

**K12NET (Atlas Yazılım): okul ağırlıklı, kursa da satıyor** [T6–T11]
- 15.09.2025 itibarıyla "4.426 kurum" beyanı [T6].
- 44 modül [T7]:
  - TÜBİTAK ödüllü ölçme-değerlendirme (28 rapor türü, kazanım bazlı),
  - telefonla optik okuma, soru editörü, online sınav, bursluluk sınavı,
  - sınav açığına göre otomatik etüt, rehberlik,
  - online ön kayıt, ders programı optimizasyonu, servis, öğretmen-veli randevusu,
  - ön muhasebe, Parampos (23 banka),
  - LGS tercih robotu.
- 50'den fazla içerik platformuyla SSO [T8]; 50'den fazla yayınevi listeleniyor [T9].
- Zayıf noktalar: iOS uygulaması 1,9★ [T10]; büyük veride yavaşlık eleştirisi [T11].
- Fiyat yayımlanmıyor.

**Kurspro: çekirdek akışı O-Okul'a en çok benzeyen rakip** [T16][T17]
- Optik: TXT/DAT yükleme, A/B kitapçık cevap anahtarı, soru-kazanım eşleme; TYT, AYT ve LGS.
- Diğer modüller: taksit, kasa, fatura ve makbuz, bordro ve avans, rehberlik, randevulu etüt,
  online sınav, çok şube.
- Entegrasyonlar: iyzico, PayTR, Paraşüt, WhatsApp Business, Google Takvim.
- AI: sesli asistan (adayları arama, görüşme puanlama), zayıf konudan mini test, haftalık
  çalışma planı. Öğrenci/veli, öğretmen ve yönetici için mobil uygulama.
- Fiyat (KDV dahil, yıllık): ₺18.000 (50 öğrenci) – ₺33.000 (sınırsız öğrenci, 4 kullanıcı);
  ek kullanıcı ₺7.200; 7 gün ücretsiz deneme [T17]. Fiyatlar bu çalışmada siteden teyit edildi.
- Uyarı: Sitedeki "4.426+ kurum" iddiası K12NET'in rakamıyla birebir aynı; doğrulanamadı.

**Delta Kurs Otomasyonu (OnlineKurum)** [T15]
- 2013'ten beri faaliyette, "600'den fazla kurum" beyanı.
- 40 modül:
  - ön kayıt (CRM), görüşme notları, yoklama, ödev;
  - program robotu, özel ders, online eğitim;
  - optik okuma, kazanım ve sınav analizi;
  - öğrenci tahsilatı, kurum muhasebesi, kasa ve bütçe, e-fatura, stok;
  - öğretmen gelir ve prim;
  - toplu SMS ve e-posta;
  - mobil uygulama; veli, öğrenci ve öğretmen panelleri;
  - kurum web sitesi, API.
- Satış kozu: K12, Akbim ve Teknosınav'dan Excel ile veri taşıma.
- Fiyat: aktif öğrenci bazlı paket ₺12.475+KDV/yıl'dan; sınırsız öğrenci paketi
  ₺29.158+KDV/yıl'dan. Siteden teyit edildi.

**DersDers** [T18]
- QR yoklama ve giriş-çıkış bildirimi, OMR, ÖSYM tarzı puan, MEB kazanım raporu, hazır test
  havuzu, ödeme planı, öğretmen maaşı, ön kayıt.
- Veli ve öğrenci uygulaması (SMS ile şifresiz giriş), otomatik WhatsApp, FET ders programı
  entegrasyonu.
- KVKK beyanı: kurum başına ayrı veritabanı, şifreli TC.
- Fiyat: ₺20.000+KDV/yıl veya ₺2.000+KDV/ay (lansman fiyatı); öğrenci sınırı yok.

**Bilsa (Kurssis / Okulsis)** [T12–T14][T37]
- 1986'dan beri faaliyette, "35.000'den fazla kurum" beyanı (masaüstü dahil).
- Kurssis: yapay zekâ modülü, mobil e-yoklama, muhasebe, sınav ve ölçme, rehberlik, etüt, aday
  takibi, şube panoları.
- Fiyat teklif usulü.

**Diğerleri**
- **Derssis** [T19]: randevulu etüt, sanal sınıf, bursluluk sınavı, bayi değerlendirme, koçluk
  paketi, AI soru bankası. Sözleşme bitiminden sonra veriyi 2 yıl sakladığını yazıyor; KVKK
  açısından zayıf bir nokta.
- **AkademiBulut** [T20]: etüt odaklı; QR yoklama, canlı sınıf. ₺499–1.499/ay.
- **OktaSis** [T21]: paket bazlı; optik yalnızca Profesyonel pakette; Kurumsal pakette yüz
  tanımalı yoklama.
- **OkulTek** [T22]: 35'ten fazla modül ve ayrı "ÇalışmaSalonu" ürünü (QR, masa haritası,
  parmak izi).
- **HeryerOnline** [T23]: etüt merkezlerine dijital yoklama, veli bildirimi ve AI destekli optik
  analiz; "500'den fazla kurum" beyanı doğrulanamadı.
- **EduDiamond** [T24]: ücretsiz; AI çağrı merkezi, doğal dille kurum verisi sorgulama.
- **TestOkur** [T25]: herhangi bir tarayıcıyı optik okuyucuya çeviriyor; ₺5.950–8.950/yıl.
- **YZ Takip** [T26]: yayınevi sonuç PDF'ini AI ile okuyor; 16 bölümlük rapor.
- **YES.Tools** [T27]: deneme serilerini analiz edip kişiye özel çalışma programı üretiyor.
- **Test Plus** [T34]: mobil optik okuyucu uygulaması, App Store'da 4,9★; abonelik ₺379.
- **MEB Konya ÖDM** [T28]: ücretsiz Windows yazılımı; tarayıcı, kamera ve PDF'den okuma.
- **Fernus** [T32]: yayınevlerine mobil optik altyapısı (43 yayınevi beyanı).

### 4.3 Küresel referanslar (özet)

| Platform | Segment | Öne çıkan | Fiyat |
|---|---|---|---|
| Classplus (Hindistan) [G3][G4] | Koçluk, eğitmen | Markalı uygulama, online tahsilat, soru bankası, içerik mağazası. Gelirin %96,6'sı SaaS. | ₹19.999–31.999/yıl |
| Teachmint [G1][G2] | Okul, koçluk | EduAI ile quiz ve ödev üretimi; TeachPay (veliye taksit, okula peşin) | "$5/kullanıcı/yıl'dan" |
| Proctur [G5] | Koçluk | Aday CRM, ücret ve vergi, biyometrik yoklama, CBT, markalı uygulama, WhatsApp | Teklif |
| Addmen [G6] | OMR/OCR, CBT, ERP | O-Okul'a en yakın çekirdek: tarayıcı (TWAIN/ADF), QR/barkod, çevrimdışı CBT | Teklif |
| Fedena [G8] | Okul | 40.000+ kurum beyanı; İK ve bordro | $999–2.299/yıl |
| Classter [G10] | K-12, akademi | Öğrenci başı modüler fiyat | ≈ €21,5/öğrenci/yıl |
| Teachworks [G11] | Özel ders merkezi | Fatura, ödeme, bordro; şube başı ücret | $16,49/ay + kullanım; ek şube $35/ay |
| Wise [G13] | Özel ders, sınav hazırlık | %0 işlem ücreti, beyaz etiket uygulama dahil, ücretsiz veri taşıma | Birim bazlı |
| Toddle [G15] | Okul | AI ilerleme raporu, AI destekli puanlama | Plan bazlı |
| Gradelink [G17] | Okul | Veli ve öğretmen hesabı ücretsiz | $117/ay (≤50 öğrenci) |
| MyClassboard [G7] | K-12 | Aday CRM, ücret, SMS ve WhatsApp, AI soru kâğıdı | Demo üzerinden |
| OpenEduCat [G9] | Açık kaynak ERP | Modüler; markalı mobil uygulama ayrı ücretli | Çekirdek $489/yıl; iOS uygulaması $1.179/yıl |
| TutorBird [G12] | Küçük özel ders işletmesi | Stripe/PayPal tahsilat, faturalama | $16,95/ay + eğitmen başı $4,95/ay |
| Testpress [G14] | Beyaz etiket online sınav | Konu ve alt konu ısı haritası, şube içi sıralama | Teklif |
| PowerSchool [G19][G20] | K-12 SIS | PowerBuddy AI; Aralık 2024'te 62 milyon+ kişiyi etkileyen veri ihlali | — |

**Ölçme ve değerlendirme analitiği** [G21–G26]

| Araç | Öne çıkan |
|---|---|
| ZipGrade | Telefonla okuma, madde analizi; $6,99/yıl |
| Gradient (eski adı GradeCam) | Boylamsal izleme; standart ustalığı; $3,5/öğrenci |
| Akindi | Point-biserial, KR-20 |
| Remark Office OMR | Çeldirici analizi, Cronbach alfa, öğrenme hedefi raporu |
| Pear Assessment | Standart ustalık profili |
| Gradescope | AI destekli puanlama |

Bu araçlarda madde analizi, çeldirici analizi, güvenirlik (KR-20) ve kazanım ustalığı standart.

### 4.4 Küresel trendler (2024–2026)

- **Yapay zekâ paket özelliği oldu.** Gallup ve Walton Vakfı araştırmasına göre 2024–25'te ABD'de
  öğretmenlerin %60'ı AI aracı kullandı; haftalık kullanıcılar haftada ortalama 5,9 saat kazanıyor
  [G27]. Toddle (AI ilerleme raporu), PowerSchool (PowerBuddy), Teachmint (EduAI) ve Alma (BeaconAI
  ile devamsızlık ve not örüntülerinden erken uyarı [G16]) AI'yı ana pakete taşıdı. AI'nın
  "ölçülebilir zaman tasarrufu" ile satılması gerekiyor.
- **Veli iletişimi mobil ve çok kanallı.** McCrindle 2026 araştırmasında velilerin %55'i not ve
  sınav sonucu bilgisini en önemli içerik sayıyor; genel duyurular için uygulama, acil uyarılar
  için SMS tercih ediliyor. Velilerin %26'sı "çok fazla uygulama" olmasından şikâyetçi [G29]. Bu,
  portalsız ve bildirim öncelikli bir veli döngüsünü destekliyor.
- **Gömülü ödeme dikey SaaS'ın gelir kaldıracı.** Blackbaud gelirinin yaklaşık %34'ü işlem bazlı
  [G18]; a16z müşteri başı gelirde 2–5 kat artış öngörüyor [G28]. Karşı strateji olarak Wise
  "%0 işlem ücreti"ni pazarlıyor [G13].
- **Konsolidasyon sürüyor.** PowerSchool 5,6 milyar dolara Bain Capital'e satıldı [G19]. HolonIQ
  2025'te edtech'e 2,6 milyar dolar risk sermayesi ve yaklaşık 410 birleşme-satın alma sayıyor
  [G30].
- **Alıcı pişmanlığı ve şeffaflık.** Capterra 2025'e göre şirketlerin %59'u son 18 ayda en az bir
  yazılım alımından pişman [G32]. Gizli ücret, modül ekledikçe artan fiyat ve uzun kurulum en sık
  şikâyetler arasında [G16][G31].
- **Veri güvenliği satın alma kriteri.** PowerSchool'un Aralık 2024 ihlali 62 milyon+ kişiyi
  etkiledi [G20]. Kiracılar arası erişim ve yüklenici kimlik bilgileri ürün için var-yok riski.

---

## 5. Modül Karşılaştırma Matrisi

İşaretler: ✓ var · K kısmi · – yok veya sitede görülmedi · ? doğrulanamadı.
O-Okul sütunu `LOCAL_STATIC` repo kanıtıdır; rakip sütunları firma beyanıdır (`EXTERNAL`).

| Modül | O-Okul | Eyotek | K12NET | Kurspro | Delta | DersDers | Bilsa Kurssis |
|---|---|---|---|---|---|---|---|
| Öğrenci kaydı, seviye/sınıf/şube, Excel import | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ön kayıt / aday CRM | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Bursluluk / tanıtım sınavı | – | ✓ | ✓ | ? | ? | ? | ? |
| Optik TXT/DAT değerlendirme, A/B kitapçık | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Kamerayla mobil optik okuma | – (iptal) | ? | ✓ | ? | ? | ? | ? |
| Yayınevi sonuçlarını içe aktarma | – | ✓ (AI eşleme) | K (yayınevi listesi) | ? | ? | ? | ? |
| Kazanım bazlı analiz | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Gelişim trendi, hata kitapçığı | ✓ | ? | ? | ? | ? | ? | ? |
| Madde analizi (zorluk, ayırt edicilik, çeldirici) | – | ? | ? | ? | ? | ? | ? |
| İl / ilçe / Türkiye geneli kıyas | – | ✓ | – | – | – | – | – |
| Online sınav, soru bankası | – (iptal) | ✓ | ✓ | ✓ | ? | ✓ | ? |
| Sınav salonu / oturma planı | – (iptal) | ✓ | ? | ? | ? | ? | ? |
| Deneme sonucuna göre otomatik etüt | – | ✓ | ✓ | ? | ? | ? | ? |
| Etüt / özel ders planlama | ✓ (randevu yok) | ✓ | ✓ | ✓ (randevulu) | ✓ | ? | ✓ |
| Ders programı: tekrarlayan şablon / robot | – (tekil kayıt) | ✓ | ✓ (optimizasyon) | ? | ✓ (robot) | ✓ (FET) | ? |
| Yoklama | ✓ (günlük, manuel) | ✓ | ? | ? | ✓ | ✓ (QR) | ✓ (mobil) |
| Rehberlik / PDR, koçluk | – | ✓ | ✓ | ✓ | K (görüşme notu) | ✓ | ✓ |
| Veli portalı / bilgilendirme | Emekliye ayrılıyor | ✓ | ✓ | ✓ | ✓ | ✓ | ? |
| Native mobil uygulama | – | ✓ | ✓ | ✓ | ✓ | ✓ | K (mobil e-yoklama) |
| Toplu ve otomatik SMS | Varsayılan kapalı | ✓ | ? | ? | ✓ | ? | ? |
| WhatsApp | Varsayılan kapalı | – | – | ✓ | ? | ✓ | – |
| Online tahsilat (sanal POS) | – | ✓ (iyzico) | ✓ (Param) | ✓ (iyzico, PayTR) | ? | – | – |
| e-Fatura / e-Arşiv | – | – | – | ✓ (Paraşüt) | ✓ | – | ? |
| Kasa / ön muhasebe | – (yalnızca taksit takibi) | ✓ | ✓ | ✓ | ✓ | ? | ✓ |
| Personel maaşı / ders primi | – | ✓ (İK) | ? | ✓ | ✓ | ✓ | ? |
| Yapay zekâ | – (iptal) | ✓ (yayınevi eşleme) | – | ✓ | – | – | ✓ |
| Çok şube | K (kampüs var, konsolide rapor yok) | ✓ | ✓ | ✓ | ✓ | ? | ✓ |
| Rakipten veri taşıma aracı | K (Excel import) | ? | ? | ? | ✓ | ? | ? |
| Kurumlar arası veri izolasyonu kanıtı (RLS, denetim) | ✓ | ? | ? | ? | ? | K (ayrı veritabanı beyanı) | ? |
| Rol önizleme, öğrenci 360 | ✓ | ? | ? | ? | ? | ? | ? |
| Yayımlanmış fiyat | – | ✓ | – | ✓ | ✓ | ✓ | – |

---

## 6. Rakiplerin Öne Çıktığı Noktalar

1. **Modül genişliği bir pazarlama silahı.** Eyotek 41, K12NET 44, Bilsa 42, Delta 40 modülle
   öne çıkıyor. Alıcının karşılaştırma tablosunda "her şey tek yerde" algısı belirleyici.
2. **Veli bilgilendirmesi bir kategori tanımı.** Rakiplerin çoğu ürünü "veli bilgilendirme
   sistemi" olarak sunuyor: devamsızlık SMS'i, sonuç bildirimi, mobil uygulama.
3. **Deneme ve aksiyon döngüsü.** Eyotek ve K12NET'te sınav açığından otomatik etüt ataması,
   hedef soru takibi ve rehberlik aynı akışta.
4. **Türkiye geneli kıyas.** Eyotek ve yayınevi panelleri il, ilçe ve Türkiye sıralaması
   veriyor. Kurs, öğrenciyi ve veliyi bu rakamla motive ediyor.
5. **Yayınevi entegrasyonu.** Eyotek yayınevi analizlerini toplu yükleyip AI ile eşliyor; K12NET
   50'den fazla yayınevini listeliyor.
6. **Kayıt gelirini besleyen modüller.** Ön kayıt CRM, bursluluk sınavı, görüşme notları ve
   kurum web sitesi kursun büyüme kanalını yönetiyor.
7. **Finansın tam döngüsü.** Online tahsilat, e-fatura, kasa, öğretmen prim ve maaşı.
8. **Mobil.** Native uygulama ve push bildirimi; veliye SMS ile şifresiz giriş (DersDers).
9. **Yapay zekâ.** Sesli asistan ve aday arama (Kurspro), AI çağrı merkezi (EduDiamond),
   çalışma planı ve mini test (Kurspro, YES.Tools), PDF sonucu okuma (YZ Takip).
10. **Geçiş kolaylığı ve fiyat.** Rakipten veri taşıma (Delta), sınırsız kullanıcı (Eyotek,
    DersDers), yayımlanmış fiyat ve ücretsiz deneme (Kurspro 7 gün).

**Rakiplerin zayıf noktaları (O-Okul'un fırsatları):**
- mobil kalite (K12NET iOS 1,9★) ve büyük veride yavaşlık [T10][T11];
- yüzeysel KVKK beyanları: yayımlanmış DPA, alt işleyen listesi, saklama ve imha politikası
  görülmedi;
- yayınevi kilidi: her yayınevi yalnızca kendi denemesini raporluyor;
- eski masaüstü ürünler: Windows ve tarayıcı donanımına bağımlılık;
- güvenilirlik sinyallerinde tutarsızlık (kopyalanmış müşteri sayıları, yer tutucu referanslar).

---

## 7. O-Okul'da Eksik Olan Modüller ve Noktalar

Öncelik tanımları:
- **P0:** Satış veya pilot engeli; pazardaki her alıcı bekliyor.
- **P1:** Güçlü farklılaştırıcı veya rakiplerin çoğunda var.
- **P2:** Seçimlik, niş veya uzun vadeli.

Büyüklük (S/M/L) mevcut altyapıya göre kaba tahmindir. "DEC" sütunu, kapsam değişikliği için yeni
karar gerekip gerekmediğini gösterir.

### 7.1 P0: Satış engelleri

| # | Eksik | Bugünkü durum | Öneri | Mevcut temel | Büyüklük | DEC |
|---|---|---|---|---|---|---|
| 1 | **Veli bildirim döngüsü** (portalsız) | Veli portalı emekliye ayrılıyor. `StudentContact` hesapsız. SMS, WhatsApp ve push kapalı. Devamsızlık eşiği uyarısı `GUARDIANS` duyurusuna gidiyor. | `StudentContact`'a izinli kanal (SMS, WhatsApp utility, e-posta) üzerinden devamsızlık, deneme sonucu ve taksit bildirimi gönderilsin. Sonuç için girişsiz, süreli, salt-okunur bağlantı kullanılsın. Devamsızlık uyarısı yeni alıcıya yönlendirilsin. | `packages/notification-adapter`, `packages/sms-adapter`, `WhatsAppConsent` temeli, `apps/api/src/attendance/attendance.service.ts` | M | Evet: DEC-20260801-01, DEC-20260808-01 ve SMS varsayılanı yeniden değerlendirilmeli |
| 2 | **Otomatik hatırlatma motoru** | Taksitler bekliyor/ödendi/gecikmiş olarak izleniyor; hatırlatma yok. | Vade öncesi ve gecikme hatırlatması; devamsızlık ve sonuç yayını tetikleyicileri; kurum bazında açma/kapama ve şablon. | `apps/api/src/payment`, `apps/api/src/message-template`, BullMQ worker | S–M | Kanal açılımına bağlı |
| 3 | **Mobil erişim** | `manifest.ts` "standalone"; `push-sw.js` var ama gateway `NOTIFICATION_PUSH_NOT_CONFIGURED`. Native uygulama yok. | Önce öğrenci ve öğretmen için çalışan push'lu PWA. Pilot sonrası native (veya sarmalanmış) uygulama. | `apps/web/public/push-sw.js`, `apps/api/src/notification-device` | M (PWA) / L (native) | Push sağlayıcı kararı |
| 4 | **Optik format kapsamı ve yayınevi sonuç içe aktarma** | 4 hazır şablon (`OPTIK_7108_LGS`, `OPTIK_129`, `YANIT`, `OPTIK_840_LGS`), gerçek dosyayla doğrulanan yalnızca 1. LGS/TYT/AYT'de soru sayısı katı (90/120/160). Yayınevi sonuç dosyası veya PDF içe aktarma yok. | Pilot kurumun kullandığı yayınevlerinin formlarıyla şablon kütüphanesi genişletilsin. Branş ve mini denemeler (farklı soru sayısı) `SCHOOL` türüyle uçtan uca doğrulansın. Yayınevi sonuç dosyası (Excel veya TXT) içe aktarımı eklensin. | `packages/shared-types/src/format-analyzer.ts`, kayıtlı optik şablonlar | M | DEC-20260529-04 kapsamında yeni şablon kararı |

### 7.2 P1: Rekabet farkı

| # | Eksik | Bugünkü durum | Öneri | Mevcut temel | Büyüklük | DEC |
|---|---|---|---|---|---|---|
| 5 | **Ön kayıt / aday CRM ve bursluluk sınavı** | Yok. Kapsam dışı olan şey O-Okul'un kendi satış CRM'i; kurumun aday CRM'i ayrıca dışlanmamış. | Aday kaydı, görüşme notu, durum hunisi, bursluluk sınavı sonucu → indirim → kesin kayıt dönüşümü. Aday verisi için ayrı açık rıza ve saklama süresi. | Öğrenci import, optik akış | M–L | Evet |
| 6 | **Analitik derinliği** | Kazanım ortalaması, radar, hata kitapçığı, trend, kurum ve sınıf sırası var. `psychometrics.ts` yalnızca ortalama ve sıralama üretiyor. Madde analizi ve kampüs karşılaştırması yok. | Madde güçlüğü, ayırt edicilik (point-biserial), çeldirici dağılımı, KR-20; kampüs, sınıf ve öğretmen kırılımı; hedef net ve Başarı % takibi; deneme serisi trendi (Başarı % birincil). | `apps/worker/src/jobs/psychometrics.ts`, rapor snapshot'ı, soru-kazanım bağı | S–M | Hayır (rapor kapsamı içinde) |
| 7 | **Deneme → aksiyon döngüsü**: otomatik etüt, rehberlik, koçluk | Etüt, ödev ve kazanım verisi ayrı ayrı var; bağlantı yok. Rehberlik modülü yok. Gelişim değerlendirmesinin oluşturma arayüzü yok (yalnızca API). | Zayıf kazanıma göre etüt ve ödev önerisi veya otomatik ataması; rehberlik görüşme notu; hedef ve çalışma planı; gelişim değerlendirmesi arayüzü. | `apps/api/src/program/study-session.*`, `apps/api/src/homework`, `apps/api/src/development`, `apps/api/src/teacher-note` | M | Evet (rehberlik kişisel verisi) |
| 8 | **Online tahsilat ve e-Arşiv/e-Fatura** | V1_OUT. Tahsilat kaydı (nakit, havale, POS) ve iç makbuz numarası var. | Lisanslı ödeme kuruluşuyla alt üye işyeri modeli; fon tutulmamalı (6493 [M16]). e-Arşiv/e-Fatura için entegratör bağlantısı. Gelir paylaşımı ek gelir kalemi olur. | `apps/api/src/payment`, `PaymentTransaction` | L | Evet: DEC-20260613-01 |
| 9 | **Tekrarlayan haftalık program** | Ders programı tarih-saatli tekil kayıt; öğretmen çakışma kontrolü var. | Haftalık şablon, dönem boyunca üretme, tatil istisnası. Robot (otomatik program) P2. | `apps/api/src/program/schedule.*` | S–M | Hayır |
| 10 | **Kasa, gelir-gider, öğretmen ders saati ve hakediş** | Yok. | Kurs öğretmenleri çoğunlukla ders saati ücretli. Programdan ders saati → hakediş raporu; basit kasa ve gider. | Program, çalışanlar | M | Evet |
| 11 | **Rakipten veri taşıma** | Öğrenci ve öğretmen Excel import var. | K12NET, Eyotek ve yayınevi dışa aktarım biçimleri için hazır eşleme şablonları; ücretsiz taşıma hizmeti. | `apps/api/src/student/student-import.service.ts` | S–M | Hayır |
| 12 | **Kampüsler arası konsolide yönetim panosu** | Rapor ve finansta kampüs filtresi var; karşılaştırma yok. | Zincir yönetimi için kampüs bazında Başarı %, devamsızlık, tahsilat ve doluluk karşılaştırması. | Kampüs kapsamı, rapor snapshot'ı | S–M | Hayır |

### 7.3 P2: Seçimlik ve uzun vadeli

| # | Eksik | Not | Büyüklük | DEC |
|---|---|---|---|---|
| 13 | Kamerayla mobil optik okuma | İptal edilen kapsam. Optik okuyucusu olmayan küçük kurslara (ortalama 67 kursiyer) kapı açar. Rakipler: K12NET, Fernus, Test Plus, ZipGrade. | L | Evet |
| 14 | AI karne yorumu, kişisel çalışma planı, risk uyarısı | İptal edilen kapsam. Toddle, Kurspro ve YES.Tools pazarlıyor. Yurt dışı LLM kullanılırsa KVKK aktarım değerlendirmesi gerekir; öğretmen onaylı taslak modeli önerilir. | M | Evet |
| 15 | Online deneme ve soru bankası | İptal edilen kapsam. Eyotek, K12NET, Kurspro ve Derssis'te var. Türk kurslarında denemelerin çoğunun kâğıt üzerinde olduğu varsayımı pilotta doğrulanmalı. | L | Evet |
| 16 | Sınav salonu ve oturma planı | İptal edilen kapsam. Eyotek'te var; büyük zincirlerde değerli. | M | Evet |
| 17 | Kurumlar arası anonim kıyas (yüzdelik dilim) | Türkiye geneli sıralamanın yayınevinden bağımsız karşılığı; ağ etkisi yaratır. Kiracı izolasyonu ilkesiyle uyum için yalnızca toplulaştırılmış, açık katılımlı ve en az n eşikli olmalı. | M–L | Evet: ADR-0001 etkisi |
| 18 | QR, kart veya biyometrik yoklama ve giriş-çıkış bildirimi | Etüt ve çalışma salonu segmentinde ayırt edici (DersDers, OkulTek, AkademiBulut). Biyometrik veri özel nitelikli kişisel veridir; QR önerilir. | M | Evet |
| 19 | Öğrenci ödev teslimi ve notlandırma | Şu an yalnızca öğretmenin "kontrol edildi" işareti var. | S–M | Hayır |
| 20 | Randevu ve veli-öğretmen görüşmesi, kurum içi mesajlaşma | K12NET'te randevu; Eyotek'te sistem içi mesaj. | M | Veli kararına bağlı |
| 21 | Mevzuat uyum paketi: %3 ücretsiz öğrenci takibi, ücret ilanı ve artış tavanı hesabı, e-Özel'e uygun dışa aktarım | Rakiplerde görülmedi; farklılaşma fırsatı. Önce resmî metinle teyit gerekiyor. | S–M | Evet |
| 22 | Maarif Modeli (2028) beceri etiketleri | Kazanımın yanına beceri boyutu; 2027 sonuna kadar hazır olmalı. | M | Evet |
| 23 | Puan hesaplama ve tercih robotu (LGS/YKS) | K12NET ve Teknosınav'da var. Resmî puan iddiası olmadan tasarlanmalı. | M | Evet (DEC-20260727-01 sınırı) |
| 24 | Kurum web sitesi, online kayıt formu, public API ve webhook, içerik platformu SSO | Delta ve K12NET'te var. | M–L | Evet |
| 25 | Canlı ders, LMS ve video içerik, oyunlaştırma | Pandemi sonrası ikincil; MEBİ ve yayınevleri ücretsiz içerik veriyor. Önerilmez. | L | — |
| 26 | Servis, yemekhane, kütüphane, envanter, revir | Özel okul segmenti için gerekli; kurs odağında gereksiz. | L | — |

### 7.4 İptal edilen dört kapsam ve pazar karşılığı

Kaynak: commit `ea655fe` ("retire unsupported exam scopes"), PR #32, 2026-07-13.

| İptal edilen kapsam | Pazarda kimde var | Öneri |
|---|---|---|
| Salon/oturma planı ve sınav salonu operasyonu | Eyotek ("Sınav Sınıfı Düzenleme") | P2: büyük zincir talebi gelirse yeniden aç |
| Online deneme ve canlı sınav izleme | Eyotek, K12NET, Kurspro, Derssis | P2: pilot verisine göre karar ver |
| OMR görüntü tarama / fotoğraftan optik okuma | K12NET, Fernus, Test Plus, ZipGrade, MEB Konya ÖDM | P2: küçük kurs pazarına açılırken yeniden değerlendir |
| AI karne / veli özeti | Kurspro, Toddle, Wise, YES.Tools | P2: öğretmen onaylı taslak ve KVKK değerlendirmesiyle |

---

## 8. O-Okul'un Farklılaştırıcı Avantajları

Bunlar alıcının ilk sorduğu konular değil, ama doğru anlatılırsa güven ve geçiş argümanı olur:

1. **Doğrulanabilir veri izolasyonu ve denetim.** RLS ve ikinci savunma katmanı, şifreli
   TC/iletişim verisi, denetim kaydı, KVKK envanteri, yedek ve geri yükleme tatbikatı. Rakiplerin
   çoğu "KVKK uyumlu" ifadesinin ötesine geçmiyor. PowerSchool ihlali [G20] sonrası zincir ve
   kurumsal alıcıda bu bir satın alma kriteri. Pazarlamada `docs/marketing-claims.md` sınırları
   geçerli: hukuk onayı olmadan "KVKK uyumlu" denmez.
2. **Rapor doğruluğu ve tekrar üretilebilirlik.** Sürümlü cevap anahtarı, append-only düzeltme,
   karantina, değişmez snapshot; web, PDF ve Excel'de aynı sonuç. Rakipler bu konuyu
   pazarlamıyor.
3. **Başarı % ile adil kıyas.** Soru sayısı farklı denemeler karşılaştırılabiliyor; "resmî puan
   değildir" uyarısı dürüst ve mevzuat riskini azaltıyor.
4. **Yayınevinden bağımsızlık potansiyeli.** Yayınevi panelleri yalnızca kendi denemelerini
   raporluyor. O-Okul birden çok yayınevinin TXT/DAT verisini tek öğrenci gelişim çizgisinde
   birleştirebilir. Bu kapasite P0 #4 ile tamamlanmalı.
5. **Ücretsiz personel hesabı ve aktif öğrenci bazlı fiyat.** Kurspro ek kullanıcıyı
   ₺7.200/yıl'a satıyor; O-Okul'un modeli daha öngörülebilir.
6. **Modern, erişilebilir web arayüzü.** Berrak tasarım dili, rol önizleme, öğrenci 360,
   responsive ve a11y kapıları. Eski masaüstü ve yavaş mobil rakiplere karşı fark.

---

## 9. Stratejik Öneriler

### 9.1 Konumlandırma seçenekleri

| Seçenek | Tanım | Artı | Eksi | Öneri |
|---|---|---|---|---|
| A. Deneme analitiği ve öğrenci gelişimi uzmanı | Çoklu yayınevi optik konsolidasyonu → madde ve kazanım analizi → etüt/koçluk aksiyonu → veli bildirimi | Mevcut çekirdeğe en yakın; rakipler bu döngüde sığ; ücretsiz ikamelerden ayrışır | Tek başına "karne" satmak zor; P0 temel modüller şart | **Ana konum** |
| B. Kursun işletim sistemi (hepsi bir arada) | CRM, tahsilat, e-fatura, kasa, maaş, mobil | Pazarın beklentisi; ek gelir kalemleri | 40 modüllük oyuncularla doğrudan yarış; uzun yol haritası | A'nın üzerine aşamalı |
| C. Zincir kurumlar için güvenli platform | Çok şubeli, KVKK odaklı, denetimli, konsolide raporlu | Mimarinin en güçlü olduğu yer; yüksek ARPA | Az sayıda müşteri, uzun satış döngüsü | A ile birlikte hedef segment |
| D. Küçük kurs için self-service | Ücretsiz veya düşük taban fiyat, kendi kendine kurulum | Uzun kuyruğu yakalar | Birim ekonomi; ücretsiz ikamelerle fiyat savaşı | Pilot sonrası test |

Önerilen birleşim **A + C**, B'den yalnızca satış engeli olan parçalar. "Sorunun cevabı" olarak
şu mesaj kurgulanmalı: "Hangi öğrencim hangi kazanımda geride, ona ne yapıyorum ve veliye nasıl
gösteriyorum?" O-Okul'da bu döngünün parçaları (deneme, kazanım, etüt, ödev) var; eksik olan
bunları birbirine bağlayan katman (otomatik etüt, çalışma planı, veli bildirimi).

### 9.2 Fiyat ve paketleme önerileri

Aşağıdakiler pilotta doğrulanacak hipotezlerdir.

1. **Aktif öğrenci bazlı fiyat ve ücretsiz personel korunmalı.** Kademeler yayımlanmalı, örneğin
   ≤100, 101–300, 301–1.000 ve 1.000+ öğrenci. Pazar referansı: tek şube 100–300 öğrenci için
   yılda ₺12–60 bin; öğrenci başı ₺133–363 [T4][T15][T17].
2. **Küçük kurs için taban paket.** Ortalama kurs 67 kursiyerli olduğundan ≤100 öğrenci için sabit
   fiyat sunulmalı.
3. **Zincirler için kampüs ek ücreti veya kampüs kademesi** (Teachworks'te şube başı $35/ay
   [G11]).
4. **Ek gelir kalemleri:**
   - iletişim kredisi (SMS ve WhatsApp, maliyet + marj),
   - ödeme gelir paylaşımı (lisanslı kuruluş üzerinden),
   - AI paketi,
   - zincirler için ücretli kurulum ve eğitim,
   - optik form tedariki ortaklığı.
5. **Kota esnekliği.** Kayıt sezonunda hard-block yerine sınırlı tolerans (ör. %10) ve uygulama
   içinden yükseltme talebi. Lisans modeli zaten segment eklemeye uygun.
6. **Endeksleme.** Çok yıllık sözleşmelerde TÜFE bazlı yıllık güncelleme maddesi.
7. **Self-service deneme.** `TRIAL` planı modelde var ama kurum açılışı manuel. 7–14 günlük
   kontrollü deneme satış maliyetini düşürür (Kurspro 7 gün [T17]).
8. **Ücretsiz veri taşıma.** Wise ve Delta bunu kazanım aracı olarak kullanıyor [G13][T15].

### 9.3 Yol haritası önerisi

Her madde ayrı bir DEC, kapsam ve kanıt kapısıyla açılmalıdır.

**0–3 ay (pilot öncesi ve pilot sırası)**
- Pilot kurumla müşteri doğrulaması: kullanılan yayınevleri ve optik formlar, veli iletişim
  beklentisi, ödeme süreçleri.
- Veli bildirim döngüsü için karar (DEC): `StudentContact` + e-posta/SMS; devamsızlık uyarısının
  yeni alıcıya yönlendirilmesi.
- Taksit ve devamsızlık hatırlatmaları.
- Pilot kurumun optik formlarıyla şablon genişletme.
- Madde analizi (zorluk, ayırt edicilik, çeldirici) ve kampüs karşılaştırması.
- Tekrarlayan haftalık ders programı.
- Push'lu PWA.

**3–6 ay**
- Ön kayıt / aday CRM ve bursluluk sınavı.
- Deneme → etüt/ödev önerisi; rehberlik ve koçluk notları; gelişim değerlendirmesi arayüzü.
- Lisanslı ödeme kuruluşuyla online tahsilat ve e-Arşiv entegrasyonu.
- Rakipten veri taşıma şablonları; yayımlanmış fiyat; self-service deneme.
- WhatsApp utility bildirimleri (DEC-20260808-01 aktivasyon şartları tamamlandıktan sonra).

**6–12 ay**
- Kamerayla mobil optik okuma.
- AI karne yorumu ve çalışma planı (öğretmen onaylı taslak, KVKK değerlendirmesiyle).
- Native mobil uygulama.
- Kurumlar arası anonim kıyas.
- Maarif 2028 beceri etiketleri.
- Online deneme ve soru bankası (pilot verisi destekliyorsa).

---

## 10. Sınırlar ve Açık Sorular

- Rakip özellikleri, müşteri sayıları ve fiyatları firma beyanıdır. Kurspro ve Delta fiyatları
  bu çalışmada siteden teyit edildi; diğerleri araştırma sırasında okunan sayfalardan alındı.
- Doğrulanamayanlar:
  - Kurspro'nun "4.426+ kurum" ve HeryerOnline'ın "500+ kurum" iddiaları,
  - Özdebir'in kurumsal yapısı,
  - Akınsoft'un güncel bulut ürünü,
  - Vitamin, Raunt, Tonguç Kampüs ve Kunduz'un kurumsal kurs ürünleri,
  - 7590 sayılı Kanunun reklam ve ilan maddesi,
  - 2025 yönetmelik maddelerinin resmî metni (ikincil kaynaktan alındı).
- Pazar büyüklüğü tahmini kabadır; kurs sayılarında basında çelişkili rakamlar var [M12].
- Müşteri görüşmesi yapılmadığı için önceliklendirme `UNPROVEN`dır. Pilot kurumla yapılacak
  görüşme ve kullanım verisi bu sıralamayı değiştirebilir.
- Hukuk değerlendirmesi gerektiren konular:
  - yurt dışı aktarım (e-posta gateway'i, Meta, AI sağlayıcısı),
  - ödeme hizmeti modeli (6493),
  - aday verisi ve rehberlik verisi için rıza ve saklama süresi,
  - biyometrik yoklama,
  - başarı ilanı ve reklam kısıtları.

---

## Kaynaklar

Erişim tarihi: 2026-10-02.

### Türkiye rakipleri (T)

- [T1] Eyotek: https://www.eyotek.com.tr/
- [T2] Eyotek modüller: https://www.eyotek.com.tr/moduller
- [T3] Eyotek sınav değerlendirme: https://eyotek.com.tr/moduller/sinav-degerlendirme
- [T4] Eyotek ücretler (hesaplama robotu 100/300/1000 öğrenciyle sorgulandı): https://www.eyotek.com.tr/ucretler
- [T5] Eyotek App Store: https://apps.apple.com/tr/app/eyotek/id1571118477
- [T6] K12NET: https://www.k12net.com/tr/
- [T7] K12NET modüller: https://k12net.com/okul-yonetim-yazilimi/k12net-moduller/
- [T8] K12NET entegrasyonlar: https://k12net.com/entegrasyonlarimiz/
- [T9] K12NET yayınevleri: https://k12net.com/yayinevleri/
- [T10] K12NET Mobil App Store: https://apps.apple.com/tr/app/k12net-mobil/id1155767502?l=tr
- [T11] K12NET Capterra yorumları: https://www.capterra.com/p/203803/K12NET/reviews/
- [T12] Bilsa Kurssis fiyatlandırma: https://bilsa.com.tr/fiyatlandirma/kurssis/
- [T13] Bilsa 35.000 kurum: https://bilsa.com.tr/en/haberler/35000-egitim-kurumu/
- [T14] Bilsa Okulsis: https://bilsa.com.tr/en/urunlerimiz/okulsis/
- [T15] Delta Kurs Otomasyonu: https://www.onlinekurum.com/delta-kurs-otomasyonu
- [T16] Kurspro: https://kurspro.net/
- [T17] Kurspro fiyatlandırma: https://kurspro.net/fiyatlandirma
- [T18] DersDers: https://dersders.tr/
- [T19] Derssis: https://derssis.com/
- [T20] AkademiBulut: https://akademibulut.com/
- [T21] OktaSis paketler: https://oktasis.com/paketler/
- [T22] OkulTek: https://okultek.com/
- [T23] HeryerOnline: https://heryeronline.com/etut-merkezleri/
- [T24] EduDiamond: https://hedefdeneme.edudiamond.com/
- [T25] TestOkur: https://www.testokur.com/testokur-yazilimi/
- [T26] YZ Takip: https://yztakip.com/
- [T27] YES.Tools: https://yes.tools/deneme-sinavi-analiz-programi
- [T28] MEB Konya ÖDM optik yazılımı: https://konyaodm.meb.gov.tr/www/optik-olusturma-okuma-ve-degerlendirme-yazilimi/icerik/45
- [T29] Hız Yayınları kurumsal denemeler: https://hizyayinlari.com/hizmetler/kurumsal-denemeler/
- [T30] Teknodeneme (Limit/Teknosınav): https://teknodeneme.com/
- [T31] Anında Sonuç: https://anindasonuc.com/
- [T32] Fernus Mobil Optik: https://www.fernus.com.tr/mobil-optik-degerlendirme-sistemi/
- [T33] MEBİ 2025-2026: https://www.meb.gov.tr/mebi-2025-2026-egitim-ogretim-yilinda-6-milyona-yakin-kullaniciya-ulasti/haber/41439/tr
- [T34] Test Plus App Store: https://apps.apple.com/tr/app/test-plus-optik-okuyucu/id1597759456?l=tr
- [T35] OkulumNET fiyatlar: https://okulumnet.com/fiyatlar
- [T36] Akınsoft Dersane Otomasyonu: https://www.tamindir.com/indir/akinsoft-dersane-otomasyonu-s11101/amp/
- [T37] Bilsa Kurssis blog: https://bilsa.com.tr/blog/dershane-kurs-yonetim-yazilimi-kurssis/

### Pazar ve mevzuat (M)

- [M1] MEB Millî Eğitim İstatistikleri 2024/'25 (özel yaygın eğitim tablosu): https://sgb.meb.gov.tr/istatistik_k/51.pdf
- [M2] MEB 2024-2025 örgün eğitim istatistikleri: https://www.meb.gov.tr/2024-2025-orgun-egitim-istatistikleri-aciklandi/haber/38473/tr
- [M3] 5580 sayılı Özel Öğretim Kurumları Kanunu (güncel metin): https://www.mevzuat.gov.tr/mevzuatmetin/1.5.5580.pdf
- [M4] Özel Öğretim Kurumları Yönetmeliği değişikliği 03.01.2025 (ikincil kaynak): https://www.alomaliye.com/2025/01/03/meb-ozel-ogretim-kurumlari-yonetmeliginde-degisiklik-03-01-2025/
- [M5] 7590 sayılı Kanun, Resmî Gazete 31.07.2026: https://www.resmigazete.gov.tr/eskiler/2026/07/20260731-2.htm
- [M6] 7590 sayılı Kanun özeti: https://www.alomaliye.com/2026/07/31/7590-sayili-kanun-yayimlandi-ozet-ve-sss/
- [M7] YKS ve LGS'de 2028 soru modeli: https://www.meb.gov.tr/yks-ve-lgsde-yeni-mufredata-uyumlu-soru-modeli-2028de-hayata-gececek/haber/39265/tr
- [M8] YKS 2026 başvuru sayısı: https://www.haberturk.com/ankara-haberleri/40929536-yksye-2-milyon-425-bin-560-aday-basvurdu
- [M9] 2026 LGS merkezî sınav raporu: https://www.meb.gov.tr/2026-lgs-kapsaminda-merkezi-sinav-raporu-yayimlandi/haber/41333/tr
- [M10] Dershane ücretleri: https://www.eleman.net/is-rehberi/guncel/dershane-ucretleri-h7344
- [M11] Temel lise ve dershane kapanışları: https://www.hurriyet.com.tr/egitim/1221-temel-lise-acildi-700-dershane-kapandi-29968324
- [M12] Kayıt dışı kurslar haberi (tarih doğrulanamadı): https://www.milliyet.com.tr/egitim/kurstan-vazgecemiyoruz-meb-ozel-kurslardan-daha-fazla-ucretsiz-yardimci-kaynak-saglasa-da-7277343
- [M13] TÜİK internet ve WhatsApp kullanımı 2025: https://turkishminute.com/2025/08/27/turkeys-internet-use-hits-90-9-percent-whatsapp-most-popular-app-turkstat/
- [M14] Meta WhatsApp Business fiyatlandırma: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- [M15] KVKK standart sözleşme bildirimi: https://www.alomaliye.com/2024/10/30/kvkk-standart-sozlesme-bildirim-modulu/
- [M16] 6493 sayılı Kanun ve ödeme hizmetleri: https://openaccess.bilgi.edu.tr/items/65c54399-67c4-42ba-a934-4a5d8909ce44/full

### Küresel (G)

- [G1] Teachmint: https://www.teachmint.com/
- [G2] Teachmint TeachPay: https://cxotoday.com/media-coverage/teachmint-launches-teachpay-a-verticalized-fintech-solution-for-education/
- [G3] Classplus (Techjockey): https://www.techjockey.com/detail/classplus
- [G4] Classplus FY24 geliri: https://entrackr.com/2024/10/classplus-revenue-spikes-2x-to-rs-260-cr-in-fy24-cuts-losses-by-57/
- [G5] Proctur: https://proctur.com/
- [G6] Addmen: https://www.addmengroup.com/
- [G7] MyClassboard: https://www.myclassboard.com/
- [G8] Fedena: https://fedena.com/
- [G9] OpenEduCat fiyatlandırma: https://www.openeducat.org/pricing
- [G10] Classter fiyatlandırma: https://www.classter.com/pricing/
- [G11] Teachworks fiyatlandırma: https://www.teachworks.com/pricing
- [G12] TutorBird fiyatlandırma: https://tutorbird.com/pricing/
- [G13] Wise fiyatlandırma: https://www.wise.live/pricing
- [G14] Testpress: https://blog.testpress.in/best-white-label-online-test-platform/
- [G15] Toddle fiyatlandırma: https://www.toddleapp.com/pricing
- [G16] Alma ve Veracross (rakip karşılaştırması): https://www.getalma.com/alma-vs-veracross/
- [G17] Gradelink: https://gradelink.com/gradelink-vs-teacherease/
- [G18] Blackbaud 2025 10-K: https://www.sec.gov/Archives/edgar/data/1280058/000128005826000006/blkb-20251231.htm
- [G19] PowerSchool – Bain Capital: https://www.businesswire.com/news/home/20240607770171/en/PowerSchool-to-be-Acquired-by-Bain-Capital-in-5.6-Billion-Transaction
- [G20] PowerSchool veri ihlali: https://www.techtarget.com/whatis/feature/PowerSchool-data-breach-Explaining-how-it-happened
- [G21] ZipGrade: https://www.zipgrade.com/
- [G22] Gradient fiyatlandırma: https://gradientk12.com/pricing/
- [G23] Akindi ölçme analizi: https://www.akindi.com/understand-assessment
- [G24] Remark Office OMR raporları: https://remarksoftware.com/reports/
- [G25] Gradescope fiyatlandırma: https://turnitin.gradescope.com/pricing
- [G26] Pear Assessment standart performansı: https://docs.goguardian.com/products/pear-assessment/view-standards-performance-summary
- [G27] Walton Vakfı ve Gallup, öğretmenlerin AI kullanımı: https://www.waltonfamilyfoundation.org/learning/six-weeks-a-year-how-ai-gives-teachers-time-back
- [G28] a16z, gömülü finans ve dikey SaaS: https://a16z.com/fintech-scales-vertical-saas/
- [G29] McCrindle, veli iletişimi 2026: https://mccrindle.com.au/app/uploads/reports/Communicating-with-parents-McCrindle-Education-Insights-2026.pdf
- [G30] HolonIQ edtech yatırımları 2025: https://www.holoniq.com/notes/edtech-hits-2-6b-in-investment-as-the-market-stabilizes-bigger-bets-in-ai-and-workforce-training
- [G31] Classplus alternatifleri (rakip blogu): https://edmingle.com/blog/classplus-alternatives
- [G32] Capterra alıcı yolculuğu 2025: https://capterra.com/resources/tech-trends-successful-buyer-purchase-journey/

### Repo kaynakları

`docs/DECISIONS.md`, `docs/product-journeys-v1.md`, `docs/marketing-claims.md`, `status.md`,
`docs/account-management-architecture-plan.md`, `packages/db/prisma/schema.prisma`,
`apps/api/src/**`, `apps/web/app/(app)/**`, `apps/worker/src/jobs/**`,
`packages/shared-types/src/**`, `infra/notification-gateway/**`.
