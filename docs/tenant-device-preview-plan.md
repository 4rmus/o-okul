# Süreli veritabanı önizleme planı

## Gate6T-J — süreli ve kaynakla bağlı önizleme bileti

**LOCAL_TEST / LOCAL_RUNTIME PostgreSQL16 / yerel tarayıcı PASS. CI/STAGING/PRODUCTION çalıştırılmadı.**
Önizleme artık isteğe bağlı5 dakikalık `plan` döndürür. Aynı dosya/parola ile
`planToken` gönderilirse bilet doğrulanır ve kaynak yeniden okunur; süre uzatılmaz.
Yeni önizleme yeni bilet üretir. Arşiv/aktör uyuşmazlığı ve değiştirilmiş bilet,
parola çözümünden önce reddedilir. Süre dolumu uzun kaynak okumasından sonra da kontrol edilir.

- Bilet kullanıcı, kurum, oturum, üyelik/sürüm, persona/roller ve arşiv baytlarına bağlıdır.
  Veritabanı projeksiyonu, FK/domain değerlendirmesi ve güvenli kontrol metadatası
  sunucu anahtarlı özetle bağlanır. Kimlik/kişisel veri veya tahmin edilebilir çıplak
  veri hash'i bilete konmaz. Snapshot güncel karşılaştırmada farklıysa409 STALE döner.
- Tenant yaşam döngüsü/lisans aynası, kullanıcı hesap/üyelik durumu, üyelik/kampüs
  kapsamı, tüm lisans dönemleri ve aktif oturum bağları kontrol özetine katılır.
  Secret/hash/token içerikleri seçilmez. Metadata2000 satırı aşarsa veya domain
  listesi sınırlıysa bilet üretilmez; eski biletle devam reddedilir.
- İmza anahtarı süreç belleğinde rastgele üretilir; yeni config/secret kurulumu yoktur.
  API yeniden başlayınca biletler geçersizleşir. Çoklu replica için ortak güvenli
  anahtar/saklama henüz kurulmadı; yanlış instance'a giden bilet fail-closed reddedilir.
- Panel son geçerlilik zamanını gösterir, parolayı tekrar alarak aynı bileti yeniden
  doğrular. Dosya/oturum değişiminde eski önizleme kullanılmaz. Biletler loglarda filtrelenir.

Doğrulama:4 bilet testi, HTTP ek alan sınırı ve log filtreleme testi; normal API
1.270 PASS/22 skip. Gerçek PG'de aynı kaynakla süre uzatmadan doğrulama, Exam kaydı
ve gelecekteki lisans dönemi değişince STALE, oturum iptalinde403 PASS. Önizleme
veri yazmadı. Web typecheck/erişilebilirlik/UX, tarayıcıda planToken tekrar gönderimi
ve OpenAPI250 path kontrolü PASS. Önceki restore provaları yeniden çalıştırılmış sayılmaz.

Kanıt: `artifacts/tenant-device-preview-plan/candidate.json`, `postgres-runtime.json`
ve günlükler. Prova container'ı kaldırıldı; yerel VM kapatıldı. Canlıya, sağlayıcıya
ve dna/demoo/system'a işlem yapılmadı.

**Sınır:** scope `DATABASE_PREVIEW_ONLY`; bu bilet kalıcı iş, kilit, MFA veya uygulama
onayı değildir. Mevcut nesne gövdeleri/Redis/global kaynaklar bu bilete doğrulanmış
sayılmaz. `plan.canApply=false`, `canRestore=false`, `restoreVerified=false` korunur.
Kaynak değişimi yeniden gönderimde tespit edilir; arka planda izleme yapılmaz.
**Sıradaki gate:** biriken salt okunur ürün değişiklikleri ile offline prova araçlarını
somut yayın kapsamına ayırıp tam CI adayını hazırlamak. Mevcut uygulama engelleri
kapanmadan canlı geri yükleme veya MFA onayını veri yazmaya bağlama yapılmamalıdır.

HTTP sözleşmesi geriye uyumlu geçerli preview isteklerini korur: password/file
zorunlu, planToken isteğe bağlıdır. Yanıttaki plan da isteğe bağlıdır. Geçersiz/süresi
geçmiş/stale bilet409 döndürür; istemci yeni önizleme oluşturmalıdır. Yeniden doğrulama
aynı token ve expiresAt değerini döndürür. Her istek yine rol ve canlı aktör kontrolünden
geçer. Bileti doğrulamak, listedeki diğer blocker'ları kaldırmaz.
