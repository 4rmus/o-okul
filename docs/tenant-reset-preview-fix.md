# Temizleme önizlemesinin API yetkileriyle çalışması

Kapsam: yalnız temizleme önizlemesi ve gerçek API rolüyle hata tekrarı testi.
Tek yazıcı ana ajan; ayrı `o-okul-device-existing-restore` çalışma ağacı.
Üretimde veri temizleme, kurum geri yükleme, migration veya yetki artırma yok.

Canlı `clean-reset-preview` isteği503 dönüyordu: genel yedek okuyucusu API'nin
okuyamadığı `_prisma_migrations`, `PlatformAccount` ve `PlatformSession` tablolarına
bağımlıydı. Önizleme artık READ ONLY/REPEATABLE READ işleminde şema metaverisini
ve yalnız hedef kurum kayıtlarını kullanır. Platform hesap sayımı mevcut lisans/
platform işlem FK'larından yapılır; hesap sırları ve platform oturumları okunmaz.

Önizleme hash'i `RESET_PREVIEW_ONLY` ile ayrılır; gerçek yedek veya uygulama kanıtı
değildir. `allowed=false`, kurum talebi, işlerin durdurulması, kuyruk ve dosya
kontrolleri korunur. Gerçek yedekleyici migration ledger'ını doğrulamaya devam eder.
Eski backup/apply yolunun veri özeti ve sorgu davranışı değişmez.

Kabul: gerçek PostgreSQL `app` rolünde üç özel tablo SELECT yetkisi false iken
önizleme sayımları döner; başka kurum karışmaz, yazma reddedilir, temizleme kapalıdır.
`tenant-reset-preview.postgres.test.ts` CI PostgreSQL işine eklendi. Mock testi tek
başına canlı yetki kanıtı sayılmaz. Staging HTTP ve canlı sistem yöneticisi ekranı
ayrı doğrulanır; sonuçlar ana çalışma ağacındaki plan/kanıt kayıtlarına yazılır.

Kontroller: API/DB typecheck, RLS/tenant-db, hedefli snapshot/backup ve preview testleri,
CI PostgreSQL testi; yalnız API imajı ve onu kullanan restore worker için yayın.
