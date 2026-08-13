# O-Okul Pazarlama ve Editoryal İddia Sözleşmesi

Bu dosya landing, demo, satış, onboarding, yardım ve boş durum metinleri için kanonik ürün dili
sınırıdır. Ürün kapsamını genişletmez. Karar kaydı `docs/DECISIONS.md`, mevcut davranış ve UAT
durumu `docs/product-journeys-v1.md`, canlılık kanıtı `docs/phase-6-production-readiness.md` ve
`status.md` ile doğrulanır.

## Ana Mesaj

**Başlık:** Optik veriyi kontrol edin, rapora dönüştürün.

**Destek metni:** Dershane ve özel öğretim kurumları için TXT/DAT yükleme, hatalı kayıtları ayırma,
Başarı % odaklı rapor ve öğrenci takibi.

**CTA:** `Demo talep et`, `Optikten rapora akışı gör` ve mevcut kullanıcılar için `Giriş yap`.
Ücretsiz deneme, anında kurulum veya canlıya hazır olma iddiası ancak bunları doğrulayan güncel ürün
ve ortam kanıtı varsa eklenir.

Hedef pazarlama personaları kurum sahibi, kurum yöneticisi, operasyon çalışanı, finans çalışanı,
öğretmen ve öğrencidir. `SYSTEM_ADMIN` platform operasyonudur. `GUARDIAN` mevcut runtime'da geçiş
desteklidir; yeni müşteri/persona vaadi değildir. `StudentContact` hesapsız öğrenci iletişim kaydıdır.

## Kullanıcı Terminolojisi

| Teknik kaynak terimi | Kullanıcıya gösterilen terim | Kullanım sınırı |
|---|---|---|
| tenant | kurum | "Müşteri tenantı" veya "kiracı" kullanıcı metnine girmez |
| `tenantSlug`, subdomain | kurumun O-Okul adresi | Örnek: `{kurum}.o-okul.com`; kampüs adresi veya özel domain vaadi yok |
| `loginName` | kurum içi kullanıcı adı | Öğrenci/personel numarası veya doğrulanmış e-posta; T.C. ve telefon değil |
| `Campus` | kampüs | Fiziksel yerleşkeyi anlatır; A/B gibi sınıf şubesiyle karıştırılmaz ve ayrı kurum gibi sunulmaz |
| capability, scope | yetki, görev alanı | Link gizlemeyi güvenlik garantisi gibi anlatma |
| `RawImport`, parser | optik dosya yükleme ve kontrol | OCR veya yapay zekâ okuma iddiası yok |
| `ReportSnapshot`, `READY` | hazır rapor | Queue/worker/snapshot terimleri normal kullanıcıya gösterilmez |
| payment module | ödeme planı ve taksit takibi | Online ödeme, sağlayıcı, fatura veya makbuz değildir |
| `StudentContact` | öğrenci iletişim kişisi | Veli hesabı, giriş veya portal değildir |
| control plane | platform operasyonu | Müşteri özelliği veya kurum admin alanı olarak pazarlanmaz |

## İddia, Kanıt ve Güvenli İfade Matrisi

| İddia alanı | DEC / UAT / evidence bağı | Güvenli ifade | Söylenmemesi gereken |
|---|---|---|---|
| Ana ürün akışı | `DEC-20260613-01`; UAT-KURUM-05/06 `CONTRACT_READY_EXTERNAL_NOT_RUN` | "Optik TXT/DAT dosyasından rapor ve karne sürecini tek akışta yönetin." | "Her optik formatı hatasız ve anında okur." |
| Kurum operasyonu | UAT-KURUM-01 `PARTIAL`; UAT-KURUM-02/04 `PASS` | "Kayıt, akademik yapı, program ve devamsızlık işlerini tek yerden takip edin." | "Tüm kurum süreçleri tamamen otomatiktir." |
| Öğretmen ve öğrenci | UAT-TEACHER-01/02/03 ve UAT-STUDENT-01/02/03 `PASS` | "Öğretmen atanmış kapsamını, öğrenci kendi bilgilerini görür." | "Herkes tüm öğrenci verilerine erişir." |
| Finans | `DEC-20260613-01`; UAT-KURUM-07 `PASS`; sağlayıcı/fatura/makbuz `V1_OUT` | "Ödeme planı, alacak ve taksitleri takip edin." | "Online ödeme alın, otomatik fatura veya makbuz kesin." |
| İletişim | UAT-KURUM-08 repo davranışı `PASS`; provider ve WhatsApp dış kanıtı bekliyor | "Duyuru, destek ve materyal işlerini yönetin." | "SMS, e-posta veya WhatsApp iletileriniz kesin teslim edilir." |
| Kurum girişi | `DEC-20260804-01`; tenant-host/auth izolasyon testleri; full go-live kanıtı ayrı | "Her kurum kendi O-Okul adresinden kurum içi kullanıcı adıyla giriş yapar." | "Tek global hesapla her kuruma girin" veya "özel domain hazır." |
| Rol ve veri sınırı | `DEC-20260529-01`; UAT-TEACHER-03, UAT-STUDENT-03 ve UAT-GUARDIAN-03 `PASS`; RLS/security kapıları | "Kullanıcılar rol ve görev alanlarına göre yetkili verileri görür." | "Yüzde yüz güvenli", "ihlal edilemez" veya hukuk onaysız "KVKK uyumlu." |
| Rapor karşılaştırması | `DEC-20260713-02`, `DEC-20260727-01`; UAT-KURUM-05/06 `CONTRACT_READY_EXTERNAL_NOT_RUN` | "Başarı %, Net/Soru ve standart sapmasız deneme puanıyla gelişimi inceleyin." | "Resmî MEB/ÖSYM puanı" veya farklı soru sayılarında yalnız ham net karşılaştırması |
| Veli/guardian | `DEC-20260801-01`; mevcut UAT-GUARDIAN-01/02/03 `PASS`; emeklilik kapıları açık | Yalnız destek/release dilinde: "Mevcut veli portalı geçiş süresince desteklenir." | Yeni veli hesabı, portalı veya edinim özelliği vaadi |
| Sistem yönetimi | `DEC-20260801-01`; mevcut UAT-SYS-01/02 `PARTIAL`; control-plane geçişi açık | Yalnız iç dokümanda: "Platform operasyonu kurum rollerinden ayrıdır." | `SYSTEM_ADMIN`i müşteri personası veya sınırsız tenant yöneticisi gibi anlatmak |
| Canlılık ve hazır olma | UAT-SYS-04 `EXTERNAL_NOT_RUN`; production/pilot/go-live evidence zinciri açık | "Demo isteyin" veya kanıtlanan ortam adıyla sınırlı durum cümlesi | "Production-ready", "go-live onaylı" veya health `200` üzerinden tam hazır iddiası |

`PASS` bu tabloda repo içi davranış kanıtıdır; tek başına staging, provider teslimi, production veya
go-live kanıtı değildir. `PARTIAL`, `CONTRACT_READY_EXTERNAL_NOT_RUN` ve `EXTERNAL_NOT_RUN` olan
satırlarda sonuç garantisi verilmez.

## Editoryal Kurallar

- Önce kullanıcı işi ve sonucu anlatılır; route, rol kodu, queue, RLS, SHA veya provider ayrıntısı
  normal pazarlama metnine taşınmaz.
- "Anlık", "otomatik", "hatasız", "tam güvenli", "resmî" ve "uyumlu" gibi mutlak nitelemeler
  ölçülebilir, güncel ve ilgili ortama bağlı kanıt olmadan kullanılmaz.
- Guardian yalnız mevcut kullanıcı yardımı, migration ve emeklilik iletişiminde anılır. Yeni landing,
  demo ve satış metni hedef personaları kullanır.
- Kurumlar arası veri izolasyonu UI görünürlüğüne değil API guard, subject/scope ve RLS kanıtına
  dayanır; tasarım metni bu güvenlik sınırını genişletemez.
- Ödeme ve iletişim metni mevcut takip/iş akışını anlatır; sağlayıcı teslimi veya mali belge üretimi
  ima etmez.
