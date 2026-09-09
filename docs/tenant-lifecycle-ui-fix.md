# Kurum erişim düğmesinin yenileme sırasında sabit kalması

Kapsam: kurum detayının web bileşeni ve hedefli tarayıcı testleri. Tek yazıcı ana
ajan; ayrı çalışma ağacı. API, DB, MFA, kurum verisi veya canlı lifecycle işlemi yok.
Kullanıcının yaptığı DNA askıya alma işlemi korunur; test amacıyla geri alınmaz.

Beş saniyelik arka plan sorgusunda `isFetching` işlem yetkisine katıldığından
Askıya al/Yeniden aç düğmesi kaldırılıp yeniden ekleniyordu. Form bu anda gönderilirse
handler sessizce dönebiliyordu. Düğme son doğrulanmış kayıtla sabit tutulur; ilk
yükleme ve gerçek hata/izin engelleri korunur. Yeni işlemde MFA öncesi hedef,
sürüm, durum ve yetki tekrar okunur. Belirsiz işlemin aynı anahtarla tekrarında
önceki bağlı istek korunur; yeni bir işlem oluşturulmaz.

Kullanıcının onay düğmesinin pasif kalması, kurum koduna `dna` yerine `1` yazmasıydı.
Tam kod eşleşmesi korunur; yanlış kod için alanın yanında beklenen değer gösterilir.
Değişen/okunamayan yetki de formda açıkça belirtilir.

LOCAL_TEST: 7 hedefli Playwright testi; gecikmiş yenilemede düğme/onay, MFA öncesi
izin değişimi, masaüstü/mobil idempotent tekrar ve yanlış kod açıklaması dahil.
11 a11y testi, web typecheck/UX ve güncel kaynak ölçümü kontrol edilir.
Yayın yalnız web imajını değiştirir; API/worker ve canlı kurum durumlarına dokunmaz.
CI, staging paket doğrulaması ve kullanıcının canlı Brave ekranı ayrı kanıtlardır.
