# Cihaz yedeği önizleme yayın adayı

Taban:8593c890218e79bede2dfd6f42dcef0f7e7eb89a. Bu paket canlıya uygulanmış değildir.

Dahil: salt okunur etki/FK/domain değerlendirmesi, güncel lisans ve kontrol
metadatası, beş dakikalık süreç-bağımlı önizleme bileti, mevcut panel/sözleşme
ve HTTP testlerinin açık loopback dinleyicisi. PG testi yalnız indirme/önizleme,
aktör iptali ve planın kaynak değişiminde geçersizliğiyle sınırlıdır.

Hariç: yeni offline tablo yazıcıları, SIGKILL/MinIO birleşik prova araçları,
prova receipt şemaları ve bunların çalıştırıcı değişiklikleri. Bunlar
/Users/arair/works/o-okul-device-backup-rehearsal çalışma ağacında korunur.
Mevcut tabandaki eski reset araçları değiştirilmez.

Üç uygulama izni de kapalıdır: canApply=false, canRestore=false,
restoreVerified=false. Bilet DATABASE_PREVIEW_ONLY kapsamındadır; süreç yeniden
başlayınca geçersizleşir, birden fazla API replica için ortak saklama yoktur.
Yeni migration/kalıcı secret/sağlayıcı ayarı veya veri uygulama yolu yoktur.

Kabul: tam pnpm run ci; aynı commit için GitHub CI; dar kapsamın manifest
karşılaştırması. Staging/production/gerçek kurum UAT ayrı kanıttır. Bu belge
canlı yayın, PR merge, pilot veya reset onayı yerine geçmez. dna/demoo/system
korunur;25 kurum temizliği tekrarlanmaz. Engeller kaldırılarak test geçirilmez.
