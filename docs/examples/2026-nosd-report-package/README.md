# 2026 standart sapmasız örnek rapor paketi

Bu klasördeki veriler ve çıktılar tamamen sentetiktir. Gerçek öğrenci, iletişim veya kimlik verisi içermez.

Tüm JSON, PDF ve Excel çıktıları şu işareti taşır:

> ÖRNEK — RESMÎ PUAN DEĞİLDİR

Paket; 12 sentetik öğrenci, iki sınıf, 90 soruluk LGS, 120 soruluk TYT ve TYT’ye bağlı 160 soruluk AYT örneklerini içerir. Puanlar uygulamanın `TR-LGS-2026-NOSD-V1` ve `TR-YKS-2026-NOSD-V1` profilleriyle hesaplanır. Standart sapma, OBP, yerleştirme puanı ve ulusal sıralama kullanılmaz.

Örnekler tam puan, düşük başarı, eşit puan, TYT hesaplama koşulunun sağlanmaması, AYT alan koşulunun sağlanmaması ve bağlı TYT sonucunun eksik olması senaryolarını kapsar. AYT cevap anahtarında Matematik 23 için düzeltilmiş cevap ve TDE-SB1 20 için iptal kararı örneklenmiştir.

Paketi yeniden üretmek için:

```sh
pnpm reports:2026-nosd:examples
```

Her sınav için golden snapshot JSON, kurum özeti PDF, kurum Excel’i ve seçili öğrencinin iki sayfalık karne PDF’i üretilir. Bunlar yerel/sentetik doğrulama çıktılarıdır; staging, production veya resmî sınav puanı kanıtı değildir.

Karne PDF'inin ilk sayfası `Başarı %` birincil kartı, D/Y/B şeridi, puan türü kartları, ders başına öğrenci, sınıf ve kurum başarı karşılaştırması ile güçlü/öncelikli dersleri gösterir. İkinci sayfa en zayıf kazanımları ad ve kodla, bütün soruları cevap haritasında, yanlış ve boş soruları öğrencinin cevabı ve doğru cevapla listeler. Kurum özeti yatay A4’tür; puan türü kartları, ders başarı grafiği, başarı dağılımı, branş ve sınıf tablolarından sonra yeni sayfada her puan türü için ayrı öğrenci sıralaması verir. Sıralama o türün deneme puanına göre dizilir ve her ders için D/Y/N sütunu taşır; puanı hesaplanamayan öğrenciler durumuyla en altta listelenir. Tarihler Europe/Istanbul saatiyle yazılır, IBM Plex Sans PDF'e gömülür ve sayfa altbilgisi öğrenci adı taşımaz.

Karnedeki puan tablosunda ders netleri ilgili LGS, TYT, Sayısal, EA ve Sözel puanının altında kısaltılmış adlarla gösterilir; kurum sıralamasında aynı kısaltmalar ders sütun başlığıdır. Sıralar yalnız kurum ve sınıf kapsamındaki başarı sırası olarak sunulur.
