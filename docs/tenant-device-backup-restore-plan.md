# Kurum kullanıcısının cihazına yedek ve kontrollü geri yükleme

Durum: ürün yönü ve kabul ölçütleri; uygulama henüz tamamlanmadı.
Kullanıcı talebi: kurum yetkilisi yedeği kendi cihazına indirebilsin, daha sonra
ayrı bir bulut hesabı gerekmeksizin aynı kuruma yükleyebilsin.

## Güncel koddan fark

`/kurum/yedek-restore` ekranında JSON veri indirme var. Ancak mevcut export seçili
tabloları içeriyor; bazı öğrenci alanları ve eklerin dosya içerikleri/storage
referansları çıkarılıyor. Bu JSON, eksiksiz ve doğrulanmış geri yükleme paketi değil.
Mevcut RESTORE_DRILL işi kullanıcının dosyasını yükleyip kurum verisini geri yüklemiyor;
önceden üretilmiş kanıt dosyasını kontrol ediyor. Bu iki davranış tam restore sayılmaz.

## Önerilen ilk sürüm

1. Yetkili kurum sahibi/yedekleme yetkili yönetici “Yedeği indir” der. Aynı tutarlı
   veri anına ait kurum kayıtları ve bağlı gerçek dosyalar tek sürümlü, şifreli ve
   sunucu tarafından imzalanmış `.ookulbackup` paketi olarak hazırlanır.
2. Paket standart tarayıcı indirmesiyle kullanıcının seçtiği cihaz konumuna kaydedilir.
   Arka planda kapalı tarayıcıya otomatik dosya yazma sözü verilmez. Kullanıcı dosyayı
   harici diske de kopyalayabilir; kalıcı bulut depolaması zorunlu değildir.
3. Yedek parolası kayıtlardan ayrı tutulur. Sunucu kaybından sonra da açılabilecek
   anahtar kurtarma modeli seçilmeden paket formatı final olmaz; yalnız sunucudaki
   mevcut master key'e bağımlı şifreleme cihaz yedeği için yeterli değildir.
4. “Yedeği yükle” dosyayı geçici karantinaya alır. Parola, imza/hash, kurum kimliği,
   format/sürüm, dosya güvenliği ve boyut/açılma sınırları doğrulanır. Başka kuruma
   ait, değiştirilmiş, eksik veya desteklenmeyen paket hiçbir veri yazmadan reddedilir.
5. Önce izole geri yükleme provası yapılır. Kullanıcıya kurum, yedek tarihi, veri/dosya
   kapsamı ve uygulanacak değişiklik özeti gösterilir. Dosya yüklemek veri değiştirmez.
6. İlk sürümün anlamı: aynı kurumun operasyon verilerini seçilen yedek noktasına geri
   alma. Lisans, sistem denetim geçmişi ve güvenlik durumu geriye alınmaz; eski oturum,
   iptal edilmiş erişim ve kapatılmış hesaplar yeniden etkinleştirilmez. Gerekli eski
   kimlik referansları etkisiz/arşiv ilişkileriyle korunur; credential pakete girmez.
7. MFA ve açık onay ardından mevcut durumun kurtarma yedeği alınır, kurumun yazıları
   durdurulur; DB+nesneler aynı dayanıklı işlem kimliğiyle uygulanır. Kesinti sonrası
   durum uzlaştırılır, kör tekrar yapılmaz. Tamamlanmadan kurum yazmaya açılmaz.

## Sınırlar ve doğrulama

- Mevcut indirme ekranı genişletilir; kullanıcıya S3 adresi veya sunucu yolu yazdırılmaz.
- Yedekleme/geri yükleme bütün kurum kullanıcılarına otomatik yetki olarak verilmez.
- İndirme düğmesine basılması dosyanın güvenle saklandığını veya restore'un geçtiğini
  kanıtlamaz. Tam reset koruması salt indirme olayıyla açılmaz.
- Geçici sunucu dosyaları yalnız işlem süresince tutulur; temizlik ve başarısız işlem
  saklama politikası uygulanır. İşlem kayıtları hassas veri/parola içermez.
- İki sentetik kurumla tenant sınırı, kayıt+dosya roundtrip, değiştirilen imza/hash,
  yanlış parola, bozuk/arşiv bombası, sürüm uyumsuzluğu, iptal edilmiş erişim, eşzamanlı
  yazma, bağlantı kopması ve yarım DB/S3 uygulamasından kurtarma doğrulanır.
- İlk uygulama dilimi: paket sözleşmesi ve güvenli indirme + yükleme/önizleme; canlı
  geri yükleme ikinci, kanıtlı dilimdir. Mevcut korumalar test geçsin diye kaldırılmaz.
- dna/demoo/system geliştirme veya pilot reset hedefi değildir. Bu plan gerçek kurum
  verisi indirme/geri yükleme, provider satın alma veya destek mesajı gönderimi yapmaz.

## İlk dilim uygulama kaydı

Ayrı çalışma ağacı: `/Users/arair/works/o-okul-device-backup`; dal
`feat/tenant-device-backup`, taban4eadb5e9. Canlıya yayın yapılmadı.

Uygulananlar: şifreli/imzalı `.ookulbackup` indirme, multipart dosya yükleme, aynı
kurum/imza/parola/içerik/sürüm doğrulaması ve salt okunur özet. Eski JSON düğmesi
açıkça veri dışa aktarımı olarak adlandırıldı; sunucu yolu isteyen eski araçlar
teknik operasyonlar bölümüne taşındı.

Arşiv operasyon kayıtlarını ve bağlı saklanan dosyaları taşır. Kullanıcı kimlik
referansları için yalnız profil alanları alınır; parola/MFA/oturum/izin kayıtları,
lisans ve sistem audit verileri paket dışında. Sunucu anahtarına bağlı kimlik
numarası şifreleri dosyanın parola şifrelemesi içinde taşınabilir kimlik numarasına
dönüştürülür. JSONB büyük sayıları PostgreSQL'in metin çıktısıyla aynen korunur.
Finans ve izin/consent geçmişi arşivde bulunabilir; bunları geri sarma yetkisi verilmez.

İlk sürüm sınırı32MiB paket/2000 bağlı nesne; kayıt ve nesne toplamada daha erken
bellek limitleri var. Sınır aşılırsa eksik paket yerine hata döner. Sıkıştırılmış
ZIP veya disk yolu çıkarımı yapılmaz. Yüklenen dosya bellekte sınırlı tutulur;
kalıcı sunucu kopyası veya yükleme ile DB değişikliği oluşturulmaz.

`restoreVerified=false` ve `canRestore=false`: mevcut önizleme yalnız paket
bütünlüğü ve şema uyumluluğudur. İzole gerçek geri yükleme provası, değişiklik
karşılaştırması, MFA, kurtarma kopyası ve dayanıklı DB+dosya uygulama ikinci dilimde
kalmaktadır. Bu sınır hem API sözleşmesinde hem ekranda açıkça gösterilir.

Doğrulama:35 hedefli API testi,31 DB/backup kilit testi ve tarayıcı indirme/yükleme
akışı geçti. Gerçek PG16'da kurum kapsamı, kayıpsız JSON, boyut/READ ONLY ve
imzalı yükleme sonrası oturum iptali kontrolleri geçti. Son kaynak tam CI/PG
kapanışı ayrıca kanıt dosyalarına bağlanıyor; henüz production başarısı değildir.

Etkinleştirme ve anahtar saklama: [cihaz yedeği runbook](tenant-device-backup-runbook.md).
