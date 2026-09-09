# Cihaz yedeğini uygulama ve worker yayın kapsamı

Tek yazıcı ana ajan; çalışma ağacı `/Users/arair/works/o-okul-device-existing-restore`.
Amaç: kurum talebi ve MFA onayından, DB + dosya uygulamasına ve güvenli yeniden
açılmaya kadar aynı kalıcı işlemi tamamlamak. Asıl kirli çalışma ağacı ve üretimdeki
dna/demoo/system veri değişikliği kapsam dışıdır. Tam fresh-reset koruması değişmez.

## Kaynak kapsamı ve kabul

Sahip olunan alanlar: API `operations`, ilgili MFA sözleşmesi, dosya tarama yüzeyi,
iki mevcut kurum/sistem ekranı, shared-types, özel işlem şeması migration'ı, dar rol
bootstrap'ı, Compose bağlantısı ve bunların test/kanıt betikleri. İlgisiz kullanıcı
dosyaları, farklı projeler, sağlayıcı gönderimleri ve genel üretim veri işlemleri yasaktır.

- Kurum kendi oturumu, aynı dosya ve geçerli önizleme biletiyle talep verir.
  Talep tek başına kurum verisini değiştirmez; tekrar aynı işlem kaydını döndürür.
- Sistem yöneticisinin ayrı MFA onayı; kurum, işlem, arşiv ve sürüme bağlıdır.
  Talep sahibinin oturumu ve kaynak durumu yeniden doğrulanır. Kuyruk/belirsiz
  gönderim/çalışan iş varsa uygulama kabul edilmez.
- Onayla kurum kapanır ve eski oturumlar iptal edilir. Worker, şifreli kalıcı
  girdiyi ve mevcut durumun ayrı kurtarma kopyasını kullanır. API'ye özel worker
  DB parolası verilmez; worker'a da imza private key'i gerekmez.
- Finans, izin, destek, gönderim ve kimlik/güvenlik geçmişi mevcut haliyle kalır.
  Hesap bağlantısı değiştiren veya silinmiş profili geri açan paketler reddedilir.
  Lisans geçmişi geri sarılmaz; bugünün gerçek kullanım sayacı DB tetikleyicisiyle
  uzlaştırılır ve geçmiş tepe değerleri korunur.
- Eski dosyalar üzerine yazılmaz. Yeni dosyalar kalıcı niyet kaydından sonra
  hazırlanır. DB, makbuz ve dosya tamamlanma kararı aynı transaction'da commit olur.
  Kesinti halinde commit makbuzu okunur; yalnız o işlemin hash/sahipliği doğrulanmış
  dosyaları temizlenir. Geri dönüş kanıtlanamazsa kurum kapalı kalır.
- Tamamlanma/kanıtlı geri dönüş sonrası yeniden açılma ve kalıcı sonuç birlikte
  commit edilir. Eski oturumlar yeniden etkinleştirilmez.
- ClamAV üretim yolunda korunur. Paket sınırı 32 MiB, uygulama sınırı 2000 satır ve
  2000 bağlı dosyadır. Ürün başka kurumun arşivini kabul etmez.

## Kalıcı kayıt ve saklama

`20260909010000_device_restore_operation`, özel `device_existing_restore` şemasında
RLS zorunlu iş, dosya niyeti ve makbuz tablolarını kurar. Bunlar portable kurum
arşivine dahil edilmez; işlem kuyruğu eski yedekten yeniden çalıştırılamaz.
Yeni rol `o_okul_device_restore_worker`, CREATEROLE/BYPASSRLS/rol üyeliği olmadan
ve korunan kurumları ayrıca dışlayan dar politikalarla çalışır. Bootstrap yeni rolü
NOLOGIN oluşturur ve yalnız özel şemayı migration hesabına ait olarak hazırlar;
önceden güvenle sağlanmış login/parolayı değiştirmez. Migration hesabına genel
veritabanı CREATE yetkisi verilmez.

Arşiv, parola ve kurtarma içeriği AES-GCM altında kalır. Bitmiş/iptal edilmiş işlerin
şifreli içeriği yedi gün sonra temizlenir; işlem kimliği, hash ve sonuç makbuzu kalır.
Belirsiz/engellenmiş işler otomatik temizlenmez. Bu, PostgreSQL/WAL yedeklerinin
ayrı saklama politikasını değiştirmez ve disk üzerinden güvenli silme iddiası değildir.

## Çalıştırma

Normal API imajı içindeki ortak kod, ayrı `device-restore-worker` sürecinde kullanılır;
HTTP sunucusu başlatılmaz. `docker-compose.device-restore.yml` yalnız açıkça seçilen
`device-restore` profilini ekler. Normal worker/önizleme bu işlemciyi kendiliğinden açmaz.

API için `TENANT_DEVICE_RESTORE_ENABLED=1`, exact `TENANT_DEVICE_RESTORE_TENANT_ID`
ve ayrı 32-byte base64 `TENANT_DEVICE_RESTORE_CUSTODY_KEY` gerekir. Özel işlemciye
ayrıca `TENANT_DEVICE_RESTORE_DATABASE_URL`, mevcut kurum PII anahtarları, kaynak S3,
Redis/queue prefix ve güvenilir açık imza anahtarları verilir. Gizli değerler
artifact/public kanıta yazılmaz. Mevcut şifreleme/imza anahtarları döndürülmez.

Kontroller:

```sh
pnpm --filter @o-okul/api build
node scripts/tenant-device-existing-drill.mjs --execute --with-objects
pnpm tenant-db:check
pnpm db:rls:check
pnpm openapi:generate
pnpm idempotency:inventory:check
pnpm run ci
```

Yerel çalıştırıcı yalnız açıkça tanımlı Colima socket'i, geçici PG16/MinIO/Redis,
loopback portları ve nonce ile sahip olunan tmpfs konteynerlerini kullanır. Kaynak
hash'i test başında/sonunda aynı olmalıdır. Kesinti, yanlış hedef, kaynak değişimi,
yanlış MFA, kuyruk engeli, aynı işlemle devam ve ikinci kurum korunması denetlenir.
Yerel API/worker bağlantı testindeki MFA kriptografik bağ testi ve dev AV seçimi,
gerçek staging MFA/ClamAV/tarayıcı kabulünün yerine geçmez.

## Kanıt sınırı

LOCAL_STATIC ve LOCAL_RUNTIME_POSTGRES_MINIO_REDIS sonuçları ayrı kaydedilir.
Yeni kaynağın tam CI, bağımsız staging HTTP/tarayıcı/ClamAV uygulaması, kontrollü
restore pilotu ve production image/health zinciri kapanmadan canlı restore PASS
denmez. Tarihsel önizleme yayını veya eski fresh-reset pilotu bu kabulün yerine
geçmez. Güncel sonuçlar asıl çalışma ağacındaki üç kullanıcı planına işlenir.
