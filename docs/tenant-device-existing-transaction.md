# Dolu sentetik kurumda geri yükleme işlemi

Gate6AE: LOCAL_STATIC / LOCAL_TEST / LOCAL_RUNTIME_POSTGRES PASS.
Taban:1df624179485751148e871c06c2f5bd246cdb0d8. API endpoint veya worker bağlantısı yok;
staging/production çalıştırılmadı. Bu bir canlı geri yükleme yetkisi değildir.

Yeni restoreExistingDeviceBackupDrill, önceden yalnız boş hedefte yapılan provaya
ek olarak dolu ve askıda sentetik kurumda gerçek PostgreSQL işlemi yürütür.
İmzalı/parolalı arşiv ve mevcut şema doğrulanır. Yalnız REPLACE tablolarının farklı
satırları eklenir/güncellenir/silinir; aynı satırlar silinip yeniden yaratılmaz.
Önizleme ve yazıcı aynı tablo politikasını kullanır. Sahiplik sorguları mevcut
reset snapshot kodundan ortaklaştırıldı; parola sıfırlama gibi dolaylı sahiplikler korunur.

SERIALIZABLE işlem, withTenantDb kapsamı, RLS ve kurum advisory kilidi kullanılır.
Korunan kurum tablolarının tam satır özetleri işlem öncesi/sonrası eşleşmek zorundadır;
bir tetikleyici bunları değiştirirse tüm işlem geri alınır. Korunan arşiv verisi ile
mevcut veri farklıysa yazma başlamaz. Son veri projeksiyonu arşivle eşleşmeden commit yoktur.
Aynı arşiv ikinci kez uygulandığında değişiklik sayısı0 olur; kalıcı iş makbuzu değildir.

Dar sınırlar: yalnız localhost üzerindeki adlandırılmış disposable DB ve
`device-backup-...-a` fixture hedefi; askıda kurum, devre dışı kullanıcılar, sıfır
oturum/davet/parola sıfırlama/outbox/aktif işlem kaydı; en fazla2000 satır.
Dosyalı paketler ve hesaplara bağlı profiller reddedilir. Değişen tablolara gelen
FK'lerde kurum sahipliği doğrulanır; tetikleyiciler kapatılmaz. Platform yazma yetkisi
olan rol reddedilir. Yerel harness, yalnız kendi app rolünün platform yazma yetkilerini
kaldırır; bu daraltma production rolünde yapılmadı. Global platform verisinin tam
korunma kanıtı henüz yok: globalStateVerified=false. restoreVerified/canRestore=false.

Doğrulama:
- `pnpm --filter @o-okul/api typecheck` ve `pnpm tenant-db:check`: PASS, istisna eklenmedi.
- `node scripts/tenant-device-existing-drill.mjs --execute`: gerçek PG16,116 migration,
  6 test PASS; insert/update/delete, sıfır değişiklikli tekrar, korunan kimlik farkı reddi,
  commit öncesi hata rollback'i, tetikleyici yan etkisi rollback'i, başka tenant ID
  çakışmasının rollback'i ve aktif hesap reddi. Yalnız owned tmpfs container kaldırıldı.
- `pnpm --filter @o-okul/db exec vitest run src/tenant-reset-backup.test.ts src/tenant-reset-catalog.test.ts`:19 PASS.

Kalan: kalıcı geri yükleme işi/başvuru makbuzu, gerçek dosya deposuyla birlikte
uygulama-kurtarma, aktif kimlik/domain uzlaştırması, özel worker rolü ve çalışmaları
sakinleştirme kanıtı. Bu katman bunları atlayarak ürün UI'ına bağlanmaz.
