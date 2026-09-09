# Cihaz yedeği — ilk dilim işletim notu

> Tarihsel kayıt: geçmiş durum ve iş listeleri yazıldıkları aşamaya aittir.
> Cihaz yedeği/geri yüklemenin güncel kapsamı ve sonuçları
> [tek yayın ve işletim özetinde](tenant-device-restore-release.md) tutulur.

Bu sürüm indirme ve yükleme doğrulamasıdır; gerçek geri yükleme API'si yoktur.
SaaS'ın mevcut sunucusu ve kaynak depolaması kullanılır. AWS veya ücretli yedek
hizmeti zorunlu değildir. Çıktı standart tarayıcı indirmesiyle kullanıcı cihazına gider.

## Etkinleştirme

İki yeni isteğe bağlı ayar yalnız API'ye verilir:

- `TENANT_DEVICE_BACKUP_SIGNING_PRIVATE_KEY`: bu amaç için üretilmiş Ed25519 PKCS8 PEM.
  JWT/MFA/provider anahtarı yeniden kullanılmaz. Varsayılan/test anahtarı yoktur.
- `TENANT_DEVICE_BACKUP_TRUSTED_PUBLIC_KEYS`: geçmiş SPKI PEM açık anahtarlarından
  oluşan JSON dizi. En fazla16 geçmiş anahtar desteklenir; eski dosyalar için gerekli
  açık anahtarlar veya bağımsız güvenilir parmak izleri kaybedilmemelidir.

Anahtar yoksa veya yapılandırma geçersizse özellik kullanılamaz; JSON dışa aktarımı
cihaz yedeği olarak sunulmaz. Yeni signing secret kurulumu ve yayın bu kaynak
değişikliğiyle otomatik yapılmaz; exact kaynak/test paketiyle ayrı canlı kapsam gerekir.
Özel anahtar private0600 dosyada/güvenli secret kanalında tutulmalı; repo, CI artifact,
log veya müşteri dosyasına konmamalıdır. Yalnız açık anahtar ve SHA256 parmak izi
ayrı güvenli kurtarma kaydında saklanır. Bu kayıt şifreli müşteri içeriği taşımaz.

## Dosya sözleşmesi

`OOKULB01` magic, bounded JSON header,16 bayt salt,12 bayt IV, AES-256-GCM ciphertext
ve16 bayt tag,64 bayt Ed25519 imza. Header/payload sınırları kontrol edilir; imza
ve kurum kimliği KDF'den önce doğrulanır. KDF parametreleri dosyadan alınmaz:
scrypt N32768/r8/p1;32 bayt anahtar,64MiB KDF bellek tavanı.

Parola12–128 karakter/en çok256 UTF8 bayt olmalı; yalnız boşluk kabul edilmez.
Arşiv çözümü sunucu master key'ine bağlı değildir. Header'daki açık anahtar
kurtarmaya yardımcı olur, ancak kendi başına güvenilir anahtar listesine eklenmez.
Eski signer parmak izi bağımsız doğrulanmadan yabancı imza kabul edilmez.
Parola kaybedilirse arşiv için parola sıfırlama imkânı yoktur.

Paket32MiB sınırını geçmez; veri toplama32MiB'den önce durabilir. Her tablo/kayıt
ve bağlı S3/inline dosya sınıflandırılır; eksik veya değişen veri hata üretir.
Yeni tenant modeli export/haric tutma sınıflandırması yapılmadan derlenmez.
PostgreSQL JSON satırları string olarak taşındığından sayısal hassasiyet korunur.
Uygulama hesabı tenant RLS açık, REPEATABLE READ READ ONLY transaction kullanır.
`_prisma_migrations` için yeni okuma veya yazma yetkisi verilmez; kolon/tip/default/
constraint metadatası şema parmak izini oluşturur.

Her işlem başında mevcut kurum yöneticisi kimliği doğrulanır. Kaynak okumalarında
aktif oturum/kullanıcı/üyelik, STAFF persona, tenant kapsamı ve kurum ACTIVE durumu
tekrar kontrol edilir. Role-preview, campus-sınırlı, legacy persona'sız ve mevcut
politikanın salt okunur erişim modu bu ilk sürümde kabul edilmez.

S3 çağrıları yalnız kayıtların işaret ettiği aynı kuruma ait anahtarlara gider;
tüm diğer kurumların bucket içeriği taranmaz. Kaynak veriler ve dosya hash'leri
ikinci okumada karşılaştırılır. Download/preview POST'ları sunucu tarafında
read-only işaretlidir; başarısız dosya kontrolü kalıcı UNCERTAIN mutation satırı
bırakmaz. Kapanışta devam eden okuma yine beklenir.

## Arayüz ve doğrulama

Dosya/parola tarayıcı kalıcı depolamasına yazılmaz. İstek bitince parola alanları
temizlenir; oturum/kurum değişiminde bileşen kapanır ve istemci isteği iptal edilir.
POST otomatik başka oturumla tekrarlanmaz. İndirme başlaması cihazdaki kalıcı kopyayı
kanıtlamaz; kullanıcı kaydı kontrol etmelidir. İki alan ve dosya sayısı sunucuda
sınırlıdır; dosya adı disk yolu olarak kullanılmaz.

`POST /api/v1/device-backups/download`: JSON password → no-store binary attachment.
`POST /api/v1/device-backups/preview`: multipart password+file → yalnız özet ve bloklar.
`GET /api/v1/device-backups/status`: yapılandırma kullanılabilirliği ve dosya sınırı.

HTTP kayıtları mevcut hassas alan redaksiyonunu kullanır; parola ve signing private
key filtrelenir. Domain restore işlem kaydı, MFA ve rollback henüz uygulanmış değildir.
Dosya doğrulandı etiketi restore provası başarı etiketi yerine kullanılmaz.

Testler: device-backup-archive/service/controller/PG testleri, tenant reset objects
ve lock testleri, backup-restore-next tarayıcı testi; ardından tam CI. Yeni signing
ayarları production'a uygulanmadan, iki sentetik kurumla gerçek uçtan uca indirme/
yükleme provası yapılmalı. dna/demoo/system test veya pilot reset hedefi değildir.
