# Demo kurum kabul senaryosu

Bu belge, eski demo kurulum planından korunan tekrar kullanılabilir test tarifidir.
Demo kurumun bugünkü durumunu veya senaryonun tamamlandığını bildirmez. Önceki
oturumun canlı yazım onayını, sınav tarihlerini veya eski engel kayıtlarını taşımaz.

## Veri paketi

- İki 8. sınıf: `8-A` için 11, `8-B` için 10 sentetik öğrenci; toplam 21.
- Okul numaraları `4001–4021`; 16 veli bağlantısı, 5 velisiz öğrenci.
- Öğrencilerde kimlik/telefon dağılımı: 6'sında ikisi, 5'inde yalnız kimlik,
  5'inde yalnız telefon, 5'inde ikisi de yok. Veli bağlantılarında dağılım 6/5/5.
- Altı branş öğretmeni, iki sınıfa toplam 12 atama; öğretmen kimlik/iletişim ve
  öğrenci/veli e-posta alanları boş. Portal hesabı/davet/gönderim başlangıç
  senaryosunun parçası değildir.
- Yerel paketler `ornek-veriler/demo-kurum-v1/ogrenciler.xlsx` ve `ogretmenler.xlsx`;
  sınav girdileri ile beklenen sonuçlar `ornek-veriler/sentetik-v1/` altındadır.

## Uygulama ve kabul

1. Seçilen test kurumunun mevcut kampüs, sınıf, ders ve kayıtları okunur; var olan
   kayıtlar körlemesine yeniden oluşturulmaz. Hedef ve veri işlemi kapsamı koşudan
   önce belirlenir. Gerçek kişisel veri kullanılmaz.
2. Kurulum ve aktarım mevcut UI/Excel yollarıyla yapılır; doğrudan DB seed'i yerine
   uygulama davranışı sınanır. Beklenen 21 öğrenci, 16 veli bağlantısı, 6 öğretmen ve
   12 branş ataması doğrulanır.
3. İlk LGS sınavında iki sınıftan 21 katılımcı ve 90 soruluk cevap anahtarı kullanılır.
   Sınav yılı, tarihi ve puanlama profili güncel uygulama sözleşmesine göre seçilir.
   `OPTIK_7108_LGS` / `optik-form-7108-v1` girdisinin o koşudaki karşılığı doğrulanır.
4. Optik sonuç: 21 eşleşme, 0 karantina, 21 tamamlanan değerlendirme. Doğru/yanlış/
   boş/net değerleri okul numarasıyla `beklenen-sonuclar.json` üzerinden karşılaştırılır.
   Web, PDF ve Excel'de Başarı %, Net/Soru ve deneme puanı tutarlı olmalı; resmî
   olmayan deneme puanı uyarısı görünmelidir.
5. İlk sınav tamamen geçtikten sonra ikinci ve üçüncü sentetik sınav kendi cevap
   anahtarı, optik dosyası ve beklenen sonuçlarıyla ayrı doğrulanır. Belirsiz işlem
   sonucu yeniden göndermeden önce mevcut kayıt okunarak uzlaştırılır.

Gerçek bir koşunun sonucu ayrıca tarih, kaynak sürümü ve kanıtıyla kaydedilir.
Cihaz yedeği/geri yüklemenin güncel kapsamı
[yayın ve işletim özetindedir](tenant-device-restore-release.md).
