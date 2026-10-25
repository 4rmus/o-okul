# 2026 standart sapmasız örnek rapor paketi

Bu klasördeki veriler ve çıktılar tamamen sentetiktir. Gerçek öğrenci, iletişim veya kimlik verisi içermez.

Çıktılar uyarı veya örnek işareti taşımaz (DEC-20261025-01); sentetik oldukları bu dosyada ve `manifest.json` içindeki `containsRealPersonalData: false` alanında yazar. Öğrenci adları "Örnek Öğrenci NN", kurum "Örnek Eğitim Kurumu"dur.

Paket; 12 sentetik öğrenci, iki sınıf, 90 soruluk LGS, 120 soruluk TYT ve TYT’ye bağlı 160 soruluk AYT örneklerini içerir. Puanlar uygulamanın `TR-LGS-2026-NOSD-V1` ve `TR-YKS-2026-NOSD-V1` profilleriyle hesaplanır. Standart sapma, OBP, yerleştirme puanı ve ulusal sıralama kullanılmaz.

Örnekler tam puan, düşük başarı, eşit puan, TYT hesaplama koşulunun sağlanmaması, AYT alan koşulunun sağlanmaması ve bağlı TYT sonucunun eksik olması senaryolarını kapsar. AYT cevap anahtarında Matematik 23 için düzeltilmiş cevap ve TDE-SB1 20 için iptal kararı örneklenmiştir.

Paketi yeniden üretmek için:

```sh
pnpm reports:2026-nosd:examples
```

Her sınav için golden snapshot JSON, kurum özeti PDF, kurum Excel’i ve seçili öğrencinin iki sayfalık karne PDF’i üretilir. Bunlar yerel/sentetik doğrulama çıktılarıdır; staging, production veya resmî sınav puanı kanıtı değildir.

Karne PDF'inin ilk sayfası `Başarı %` birincil kartı, D/Y/B şeridi, puan türü kartları, ders başına öğrenci, sınıf ve kurum başarı karşılaştırması ile güçlü/öncelikli dersleri gösterir. İkinci sayfa en zayıf kazanımları ad ve kodla listeler; cevap haritası bütün soruları öğrencinin cevabıyla, yanlışlarda doğru cevapla gösterir. Kurum özeti yatay A4’tür; puan türü kartları, ders başarı grafiği, başarı dağılımı, branş ve sınıf tablolarından sonra yeni sayfada her puan türü için ayrı öğrenci sıralaması verir. Sıralama o türün deneme puanına göre dizilir ve her ders için D/Y/N sütunu taşır; puanı hesaplanamayan öğrenciler durumuyla en altta listelenir. Tarihler Europe/Istanbul saatiyle yazılır, IBM Plex Sans PDF'e gömülür ve sayfa altbilgisi öğrenci adı taşımaz.

Karnedeki Deneme Puanları tablosu solda deneme puanı ile kurum ve sınıf başarı sırasını, sağda tam adlı dersleri ve toplamı D/Y/N sütunlarıyla gösterir; AYT’nin Sayısal, EA ve Sözel puanları kendi dersleriyle ayrı satır gruplarıdır. Kurum sıralaması aynı D/Y/N düzenini kısaltılmış ders adlarıyla kullanır. Öncelikli çalışma kutusu tam başarılı dersleri listelemez. Sıralar yalnız kurum ve sınıf kapsamındaki başarı sırası olarak sunulur.
