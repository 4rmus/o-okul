# Geri yükleme planında kimlik ve gönderim bağları

## Gate6T-I — FK dışı kimlik ve gönderim bağları

**LOCAL_TEST / LOCAL_RUNTIME PostgreSQL16 / yerel tarayıcı PASS. CI/STAGING/PRODUCTION çalıştırılmadı.**
Aynı READ ONLY snapshot içinde aktif/süresi geçmemiş oturumlar, davetler, parola
sıfırlama kaydı kimlikleri ve kurum kapsamındaki outbox kaynak bağları okunur.
Ek metadata sorgularında yalnız bağlantı/durum alanları alınır; token/hash, parola, e-posta/telefon ve
şifreli gönderim içeriği seçilmez. Her metadata sorgusu2001 satırla sınırlı;2000 üzeri
kapsam UNVERIFIED kalır. Sınırlı listede bulunamayan kaynak kesin kayıp sayılmaz.

- Oturumun User ve Student/Teacher/Guardian/Employee bağları; bekleyen davetin profil
  bağı kontrol edilir. Profil silinmesi/hesap değişimi ve silinmiş profil geri
  getirildiğinde eski erişimin yeniden açılma riski ayrı çatışmadır.
- Oturum ve davet uygunluğu aynı varsayılmaz: mevcut auth bağında öğrenci durumu tek
  başına profil yokluğu değildir; öğrenci/personel davetinde ACTIVE profil kuralı korunur.
- Duyuru okuma kaydının kullanıcı/profil bağı, duyuru kapsamının kurum/sınıf/ders/dönem
  bağları, SMS raporunun şablon bağı ve geçmişi etkileyen body/channel/deletedAt farkı
  kontrol edilir. Eski gönderimler arşivden geri alınmaz veya tekrarlanmaz.
- Outbox purpose/sourceId/scope/epoch denetlenir. PENDING/PROCESSING/UNCERTAIN ve
  denemesi olan FAILED kayıtlar sonuçlandırılmamış sayılır. Raporlarda failed,
  eksik/tutarsız sayımlar veya hata bilgisi de otomatik tamamlanmış kabul edilmez.
- Yanıt `impact.domainLinks` altında yalnız kontrol/çatışma/gönderim sayıları ve
  doğrulanamayan grupları döndürür. Metadata ya da kişi/işlem kimlikleri dışarı çıkmaz.
  Panel gözlenen sonuçlandırılmamış gönderimleri ve sade engel açıklamalarını gösterir.

Doğrulama:7 yeni domain testi, hedefli20 test; normal API1.264 PASS/22 skip.
Gerçek PG'de bekleyen davetin kaybolan öğrencisi, UNCERTAIN outbox ve değişen SMS
şablon içeriği yakalandı; metadata/projeksiyon önce-sonra aynı kaldı.8 cihaz PG testi
çalıştı; birleşik nesne provası tekrarlanmadı. Token/özel payload seçilmediği ayrıca
kontrol edildi. Web typecheck,11 erişilebilirlik testi, UX, tarayıcı özeti ve
OpenAPI250 path PASS. Erişim canlandırma riskinin önceki başarısız regresyonu saklanır.

Kanıt: `artifacts/tenant-device-domain-links/candidate.json`, `postgres-runtime.json`
ve günlükler. Prova container'ı kaldırıldı, VM kapatıldı. Canlı işlem, gönderim,
yeni anahtar/rol/migration veya dna/demoo/system üzerinde işlem yapılmadı.

**Sınır:** bu bağlantı denetimi tam yetkilendirme veya sağlayıcı teslim kanıtı değildir.
Global kapsamlar/Redis işleri, tüm domain varyantları ve sayısal FK doğrulaması hâlâ
ayrı kanıt ister. Genel iş/dosya/korunan geçmiş engelleri otomatik kaldırılmaz.
`canApply=false`, `canRestore=false`, `restoreVerified=false` sürer; MFA/iş akışı,
CI/staging ve pilot tamamlanmadı.
**Sıradaki gate:** mevcut önizlemeyi kaynak sürümü ve içerik özetiyle bağlanmış,
zaman aşımında veya veri değiştiğinde geçersizleşen işlem planına dönüştürmek;
uygulama engelleri kapanmadan MFA onayı veya veri yazma yolu açılmamalıdır.

`domainLinks` isteğe bağlıdır. `pendingDeliveries` gözlenen kayıt sayısıdır;
limit durumunda toplam değildir. `conflicts` alanındaki source/target/links kişi
kimliği içermez. Eksik global kaynak, bilinmeyen subject/purpose, eski kapsam veya
sınırlı envanterden güvenli teslim/aktivasyon sonucu türetilmez. Kayıt statüsü,
sağlayıcıdan alınmış canlı teslim kanıtı yerine kullanılamaz.
