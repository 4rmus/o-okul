# Doğrulama Kiti: "Kendi Dosyanı Getir" (KF-10)

Bu doküman özel K12 planının 30/60/90 gün doğrulama adımlarını (`docs/ozel-k12-strateji-ve-yol-haritasi-plan.md`
§3.4, P-03 kuralı) sahada yürütmek içindir. Eşikler ölçümden önce yazılmış karar kurallarıdır; sonuçlar ölçülene
kadar UNPROVEN'dır. Bu dokümana ve kayıt tablolarına kişi, okul veya öğrenci adı yazılmaz; yalnız kod kullanılır.

## 1. Karar kuralı (P-03)

| Gün | Ölçülen | Geçme eşiği | Geçemezse |
|---|---|---|---|
| 0–7 | Dosya talebi gönderildi | Talep en az 6 kuruma yazılı gitti | Talep listesi tamamlanır |
| 7–21 | Masa başı dosya testi | Gelen dosyaların en az 2/3'ü kod değişikliği olmadan, yalnız config ile karneye ulaşır | Yarıdan fazlası parser kodu isterse "kendi dosyan" demo vaadi askıya alınır |
| 31–60 | Dosya getirme | En az 6 tekliften 7 gün içinde en az 3 dosya, en az 1'i ağ dışından; söz sayılmaz | ≤1 dosya veya ağ dışından 0: başarısız. Tam 2: ağ dışından 3 teklif daha (tek uzatma) |
| 31–60 | Ödeme isteği | En az 1 kurucu ücretsiz pilot + dönem sonu ücreti kabul eder | Deneme yalnız onboarding aracı olarak kalır |
| 61–90 | Pilot taahhüdü | 1 yazılı pilot niyeti | Mayıs satış başlangıcı referanssız kalır |

30 dakika ve en fazla 2 elle müdahale ölçütü ayrıca kaydedilir; geçme şartı değildir.

## 2. Dosya talebi (yazılı, herkese aynı metin)

> Merhaba, öğrenci takibini tek platformda toplayan O-Okul'u geliştiriyoruz. Son denemenizin optik
> okuyucu dosyasını (TXT/DAT) kimlik bilgileri çıkarılmış hâlde bizimle paylaşabilir misiniz? Dosyayı
> kimliksiz paylaşmanız mümkün değilse yalnızca şunlar da yeterli: kullandığınız optik form tipi,
> okuyucu yazılımının adı ve dosyanın ilk 3 satırı (adlar ve numaralar X ile kapatılmış). Dosyanızı
> yalnızca karne üretimini denemek için kullanır, işlem bitince sileriz.

Cevap kayıt tablosuna GÖNDERDİ / SÖZ / RET olarak, itiraz türüyle yazılır.

## 3. KVKK kuralları ve anonimleştirme

- Gerçek kişisel veri repoya, demo tenant'a, e-postaya eke veya paylaşımlı klasöre girmez. CI'daki
  `pnpm privacy:sample-pii:check` repoda gerçek T.C. kimlik veya cep telefonu bulursa kırmızıya döner.
- Kimlik içeren dosya ancak veri işleme sözleşmesi (bölüm 6) imzalandıktan sonra alınır; hukuk görüşü
  (OPEN-20261003-01) gelene kadar tercih edilen yol kurumun dosyayı kendisinin anonimleştirmesidir.
- Kimlikli dosya geldiyse yalnız yerel diskte tutulur, aşağıdaki komutla anonimleştirilir ve orijinal
  aynı gün silinir. Demo tenant'a yalnız anonim dosya yüklenir.

```sh
# Ad alanı 13-37. sütunlarda; cevaplar rakamla kodlanmışsa 80-179 sütunları korunur.
node scripts/anonymize-sample-file.mjs okul-a.txt --mask 13-37 --keep 80-179
# Çıktı: okul-a.anon.txt (girdi değişmez, sütun genişlikleri korunur)
node scripts/anonymize-sample-file.mjs --self-test
```

Betik ağ erişimi kullanmaz. 10 ve daha uzun rakam dizilerini (T.C. kimlik, telefon) satıra özgü,
9 ile başlayan sahte numaralarla değiştirir; e-postaları ve `--mask` sütunlarını aynı genişlikte ezer.
Ad alanının sütun aralığı form tipinin parser ayarından (ör. OPTIK_129) okunur. Anonim dosya demo
tenant'a yüklenmeden önce gözle kontrol edilir: ad, kimlik ve telefon görünmemelidir.

## 4. Masa başı dosya testi kaydı

Her gelen dosya için bir satır. "Sonuç": OLDUĞU_GİBİ (ön ayar yeterli), CONFIG (parser ayarı
değişti), KOD (parser kodu değişmesi gerekti).

| Kod | Kaynak (AĞ_İÇİ/AĞ_DIŞI) | Talep tarihi | Cevap (GÖNDERDİ/SÖZ/RET) | Geliş tarihi | Gün | Sonuç | Süre (dk) | Elle müdahale | İtiraz türü |
|---|---|---|---|---|---|---|---|---|---|
| D-01 | | | | | | | | | |

Toplamlar (her güncellemede yeniden sayılır):

| Ölçü | Değer |
|---|---|
| Teklif sayısı | |
| 7 gün içinde gelen dosya (söz hariç) | |
| Ağ dışından gelen dosya | |
| OLDUĞU_GİBİ + CONFIG / gelen dosya | |
| 30 dk içinde karne / gelen dosya | |
| Ortalama elle müdahale | |
| İtiraz türlerine göre RET sayısı | |

## 5. Görüşme ve ödeme isteği soruları

Görüşme (müdür veya ölçme-değerlendirme sorumlusu, 30 dk):

1. Bir deneme sonrası karneler öğrenciye ve veliye kaç günde ulaşıyor? En çok nerede vakit kaybediyorsunuz?
2. Optik okuyucu dosyasını bugün hangi yazılımda işliyorsunuz? Yılda ne ödüyorsunuz?
3. Yazılı, performans ve proje notlarını nerede tutuyorsunuz? e-Okul'a girmeden önce kim kontrol ediyor?
4. Bir notu yayınladıktan sonra düzeltmeniz gerektiğinde ne oluyor? Veli bunu nasıl öğreniyor?
5. Veli iletişimi (duyuru, devamsızlık, ödeme) hangi kanallardan gidiyor?
6. Yeni bir sistemi denemek için kimin onayı gerekiyor? Satın alma kararı kimde?

Ödeme isteği (kurucuya; rakam yazılmaz, aralık kaydedilir):

1. Dönem başına ücretsiz bir pilot ve dönem sonunda öğrenci başı ücret teklif etsek kabul eder misiniz?
2. Bugün öğrenci başı yıllık bütçeniz hangi aralıkta: düşük / orta / yüksek?
3. Hangi modülü ayrı ücretle alırdınız: not defteri, veli uygulaması, finans, optik karne?

Görüşme kaydı:

| Kod | Kaynak | Rol | Karar verici mi | 1. öncelik | Ödeme isteği (EVET/HAYIR/BELKİ) | Fiyat aralığı | Pilot niyeti (YAZILI/SÖZLÜ/YOK) |
|---|---|---|---|---|---|---|---|
| G-01 | | | | | | | |

## 6. Veri işleme sözleşmesi (VİS) taslağı

Hukuk görüşü (OPEN-20261003-01) gelene kadar taslaktır; imzaya açılmaz.

- Taraflar: veri sorumlusu kurum, veri işleyen O-Okul.
- Amaç: yalnız örnek dosyadan karne üretiminin denenmesi; başka amaçla kullanılmaz.
- Veri: optik okuyucu dosyası; ad, öğrenci numarası, T.C. kimlik ve cevaplar.
- Süre: dosya test bitiminde, en geç 7 gün içinde silinir; silme kurumun talebiyle yazılı teyit edilir.
- Konum ve aktarım: Türkiye'de, yalnız deneme yapan çalışanın cihazında; üçüncü kişiye aktarılmaz.
- Güvenlik: anonimleştirme betiği, şifreli disk, paylaşımlı klasör ve e-posta eki yok.
- İhlal bildirimi: öğrenildiği gün kuruma bildirilir.

## 7. İlerleme

| Tarih | Gün | Teklif | Dosya | Ağ dışı | Config ile karne | Görüşme | Pilot niyeti | Not |
|---|---|---|---|---|---|---|---|---|
| 2026-10-03 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Plan başladı |
