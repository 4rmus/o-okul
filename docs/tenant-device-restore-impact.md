# Dolu kurum geri yükleme etki önizlemesi

## Gate6T-G — dolu kurum için salt okunur geri yükleme etkisi

**LOCAL_TEST / LOCAL_RUNTIME PostgreSQL16 / yerel tarayıcı PASS. CI/STAGING/PRODUCTION çalıştırılmadı.**
Mevcut imzalı dosya yükleme önizlemesine isteğe bağlı `impact` alanı eklendi. Aynı
aktör/kurum kontrolü ve REPEATABLE READ READ ONLY transaction içinde güncel kurum
projeksiyonu ile arşiv karşılaştırılır. Şema uyumsuzsa etki hesaplanmaz.

- Operasyon kayıtlarının eklenecek/değişecek/kaldırılacak sayıları ayrı hesaplanır.
  Finans, iletişim rızası, destek ve gönderim geçmişi, kurum/kullanıcı profili korunur;
  bunların farkları uygulama toplamına girmez. Lisans/audit/oturum/erişim kayıtları
  arşivden geri alınmaz. Yeni sınıflandırılmamış model otomatik REPLACE sayılmaz.
- Korunan finans/rıza/destek/gönderim farkları, kullanıcı ve hesap bağlantısı değişimi
  ayrı engel kodları üretir. Korunan geçmiş varken operasyon değişikliği, bağlı
  kayıtlar açıkça doğrulanana kadar inceleme gerektirir.
- Aktif öğrenci öngörüsü gerçek kota tanımıyla hesaplanır: silinmemiş ACTIVE öğrenci
  ve tam bir açık ACTIVE kayıt. Çift kayıt engellenir. Mevcut etkin lisans ve Tenant
  aynası eşleşmezse limit doğrulanmamış sayılır; yedek lisansı kullanılmaz.
- Yanıt yalnız sayılar/politikalar içerir; kişi kimliği, iletişim bilgisi, finans
  tutarı veya satır içeriği dönmez. Dosya etkisi ve çalışan işler henüz doğrulanmış
  sayılmaz. `impact.canApply=false`, `canRestore=false`, `restoreVerified=false`.
- Panel sayıları ve engellerin sade açıklamalarını gösterir; uygulama onayı değildir.

Doğrulama:4 yeni planlayıcı testi; hedefli13 test ve normal API1.252 PASS/20 skip.
Gerçek PG'de önizleme öncesi/sonrası projeksiyon eşitliği, etkin lisans limiti100,
ayna uyuşmazlığında güvenli engel ve iptal edilmiş aktör reddi PASS.7'li cihaz PG
kümesinin6 testi çalıştı; birleşik nesne deposu testi bu gate'te tekrarlanmadı.
Web typecheck,11 erişilebilirlik testi, UX sözleşmesi ve etki metinlerini kontrol
eden tarayıcı akışı PASS. OpenAPI250 path ve yeni `impact.canApply=false` sözleşmesi PASS.
55 mevcut export tablosunun tamamı politika kapsamına alındı.

Kanıt: `artifacts/tenant-device-restore-impact/candidate.json` ve aynı dizindeki
PG/API/tarayıcı günlükleri. Kaynak çalışma ağacı ayrı; ilgisiz kullanıcı değişiklikleri
korundu. Yeni migration, canlı yayın/veri işlemi veya dna/demoo/system testi yapılmadı.

**Sınır:** bu önizleme, o anki sayımlardır; kalıcı uygulama izni veya kilit değildir.
Korunan geçmişin FK ve domain bağları henüz tek tek çözümlenmediği için muhafazakâr
inceleme engeli sürer. Dosya/kuyruk duruşu, MFA, gerçek dolu kuruma uygulama ve pilot yok.
**Sıradaki gate:** korunan kayıtların referanslarını gerçek FK/domain bağımlılıklarıyla
kontrol ederek etki planını tamamlamak; ardından onaylı iş kaydı ve MFA akışına bağlamak.

Politika hesabı, izin veren bir karar mekanizması değildir. PRESERVE satırları mevcut
kaynakta kalacak şekilde değerlendirilir; REPLACE farkları yalnız operasyon toplamıdır.
JSON satırları PostgreSQL'in kayıpsız metni üzerinden karşılaştırılır. Farklı ama
anlamsal olarak eşdeğer metinler muhafazakâr biçimde fark sayılabilir; bu bir yazma
veya silme yetkisi doğurmaz. Eski UI istemcileri için `impact` isteğe bağlıdır.
