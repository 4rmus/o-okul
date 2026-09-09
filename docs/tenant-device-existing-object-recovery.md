# Dolu kurum dosya kurtarması

## Gate6AH — dolu kurumda DB + dosya kesinti kurtarması (2026-09-09)

LOCAL_STATIC / LOCAL_RUNTIME_POSTGRES_MINIO PASS: mevcut dar işlem motoru dosyaları
kalıcı işlem/dosya hedefi bağıyla hazırlıyor. Eski dosyalar yerinde korunuyor;
fotoğrafta tekrar kullanılan ad yerine içerik ve kurumla bağlı yeni anahtar kullanılıyor.
Dosya hazırlığı kaydı commit edilmeden PUT yok. DB ve dosya makbuzu birlikte commit;
öncesinde hata/kesintide eski DB kullanılabilir, yalnız işlem sahipliği ve hash'i
kanıtlanan yeni dosyalar temizlenir. Başka unfinished işlem yeni uygulamayı engeller.

Gerçek PG16/116 migration + MinIO: 3 dosyada 7 test PASS. İlk PUT, commit öncesi,
commit sonrası ve temizlikte SIGKILL; aynı işlemle temizliğe devam, yanlış hedef,
commit sonrası no-op tekrar ve dosya bozulmasında fail-closed kontrolü geçti.
İkinci kurum ve mevcut dosyalar korundu, büyük JSON sayıları hassasiyet kaybetmedi.
API build/typecheck ve tenant-db kontrolü PASS. Yalnız owned PG/MinIO konteynerleri
kaldırıldı. Önizleme testleri tekrarlanmadı.

Kaynak: /Users/arair/works/o-okul-device-existing-restore. Kanıt:
artifacts/tenant-device-existing-object-recovery/{source.json,result.json,tests.log}.
Bu hâlâ disposable hedefle sınırlı motor kanıtıdır; kalıcı ürün worker/migration,
aktif kimlik/domain, staging/pilot ve production uygulaması tamamlanmadı.
canRestore/restoreVerified=false; mevcut production önizleme yayını değiştirilmedi.
Kullanıcının kesintisiz tamamlama/yayın yetkisiyle worker bağlantısı devam ediyor;
yeni hazırlık/onay kapısı açılmadı.

