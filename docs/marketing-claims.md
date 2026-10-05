# O-Okul Pazarlama ve Editoryal İddia Sözleşmesi

Bu dosya landing, demo, satış, onboarding, yardım ve boş durum metinleri için kanonik ürün dili
sınırıdır. Ürün kapsamını genişletmez. Karar kaydı `docs/DECISIONS.md`, mevcut davranış ve UAT
durumu `docs/product-journeys-v1.md`, canlılık kanıtı `docs/phase-6-production-readiness.md` ve
`status.md` ile doğrulanır.

## Ana Mesaj

**Üst satır:** Özel okullar ve eğitim kurumları için

**Başlık:** Öğrenci takibini tek platformda toplayın.

**Destek metni:** Deneme sonuçları, okul notu, devamsızlık, ödev ve ödeme planı aynı öğrenci kaydında.
Yönetici, öğretmen ve öğrenci yalnızca yetkili olduğu bilgiyi görür.

Birincil segment tek veya çok kampüslü özel K12 okuldur; dershane ve özel öğretim kurumu ikincil
segmenttir ve optik TXT/DAT → rapor/karne akışı landing'de ikinci bölüm olarak kalır
(DEC-20261004-03). Başlık metni KF-9 PR'ında kilitlenir: `scripts/check-ops-config.mjs`,
`scripts/check-prod-readiness.mjs`, `scripts/check-web-ux-baseline.mjs` ve landing e2e/golden aynı
PR'da güncellenmeden değiştirilmez.

**CTA:** `Demo talep et`, `Fiyatları gör` (`/fiyatlar`) ve mevcut kullanıcılar için `Giriş yap`.
Fiyat sayfasında `Deneme talep et` ve 7001+ için `Teklif talebi hazırla` `/iletisim#teklif`
e-posta taslağına gider; self-servis kayıt, kart bilgisi veya online ödeme yoktur
(DEC-20261004-04). Anında kurulum veya canlıya hazır olma iddiası eklenmez.

Hedef pazarlama personaları kurum sahibi, kurum yöneticisi, operasyon çalışanı, finans çalışanı,
öğretmen ve öğrencidir. `SYSTEM_ADMIN` platform operasyonudur. `GUARDIAN` kurumun açtığı ve öğrenciye
bağladığı veli hesabıdır (DEC-20261003-01); veli cümlesi staging veli UAT kanıtına bağlıdır.
`StudentContact` hesapsız öğrenci iletişim ve rıza kaydıdır.

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
| Veli/guardian | `DEC-20261003-01`; KV-1 veli yazma/bağlama/davet yolları LOCAL_TEST; UAT-GUARDIAN-01/02 staging yeniden koşumu `EXTERNAL_NOT_RUN` | Staging `PASS` sonrası: "Veli, kurumun açtığı hesapla yalnız bağlı öğrencisinin kurumun yetkilendirdiği verilerini görür." | "Veli uygulaması", "veliyle mesajlaşma", "anlık bildirim", "online ödeme", veli self-service eşleştirme |
| Sistem yönetimi | `DEC-20260801-01`; mevcut UAT-SYS-01/02 `PARTIAL`; control-plane geçişi açık | Yalnız iç dokümanda: "Platform operasyonu kurum rollerinden ayrıdır." | `SYSTEM_ADMIN`i müşteri personası veya sınırsız tenant yöneticisi gibi anlatmak |
| Bütüncül öğrenci takibi (landing başlığı) | `DEC-20261004-03`, `DEC-20261004-06`; UAT-STUDENT-01, UAT-KURUM-04, UAT-KURUM-07, UAT-TEACHER-02 `PASS` (repo içi); okul notu LOCAL_TEST | "Deneme sonuçları, okul notu, devamsızlık, ödev ve ödeme planı aynı öğrenci kaydında." | "e-Okul entegrasyonu", "e-Okul'la otomatik aktarım/senkron", "tüm okul yönetimi tek tuşla" |
| Fiyat | `DEC-20261005-01`, `DEC-20261004-04`; `apps/web/app/fiyatlar/pricing.ts` + `marketing-context-next.spec.ts` LOCAL_TEST | "Yıllık, KDV hariç; aktif öğrenci kademesine göre öğrenci başı TL. 1–250: 280 TL (yıllık en az 25.000 TL), 251–500: 250, 501–1000: 220, 1001–3000: 190, 3001–7000: 160, 7001+: teklif. Kurulum ücreti yok, tüm modüller dahil." | Aylık fiyat, indirim/kampanya vaadi, online ödeme veya otomatik fatura |
| Kartsız deneme | `DEC-20261004-02`; deneme lisansı LOCAL_TEST, STAGING `EXTERNAL_NOT_RUN` | "Kart bilgisi olmadan 7 gün, en fazla 100 aktif öğrenci; deneme hesabını ekibimiz açar." | "Hemen kendiniz kaydolun", "anında hesap", "deneme bitince verileriniz silinmez" gibi süre/saklama vaadi |
| Türkiye'de barındırma | `DEC-20261005-02` (K-6; hukukçu teyidi bekliyor, sunucu envanteri STAGING) | "Verileriniz Türkiye'deki sunucularda barındırılır." | "Hiçbir veri yurt dışına çıkmaz", "KVKK uyumlu", "yüzde yüz güvenli" |
| Canlılık ve hazır olma | UAT-SYS-04 `EXTERNAL_NOT_RUN`; production/pilot/go-live evidence zinciri açık | "Demo isteyin" veya kanıtlanan ortam adıyla sınırlı durum cümlesi | "Production-ready", "go-live onaylı" veya health `200` üzerinden tam hazır iddiası |

`PASS` bu tabloda repo içi davranış kanıtıdır; tek başına staging, provider teslimi, production veya
go-live kanıtı değildir. `PARTIAL`, `CONTRACT_READY_EXTERNAL_NOT_RUN` ve `EXTERNAL_NOT_RUN` olan
satırlarda sonuç garantisi verilmez.

## Editoryal Kurallar

- Önce kullanıcı işi ve sonucu anlatılır; route, rol kodu, queue, RLS, SHA veya provider ayrıntısı
  normal pazarlama metnine taşınmaz.
- "Anlık", "otomatik", "hatasız", "tam güvenli", "resmî" ve "uyumlu" gibi mutlak nitelemeler
  ölçülebilir, güncel ve ilgili ortama bağlı kanıt olmadan kullanılmaz.
- Fiyat rakamları yalnız `DEC-20261005-01`'den alınır ve `apps/web/app/fiyatlar/pricing.ts` tek kaynaktır;
  DEC değişirse sayfa, `scripts/check-ops-config.mjs` fiyat kilidi ve bu matris aynı PR'da güncellenir.
- Hukukçu K-6 için farklı görüş verirse "Türkiye'deki sunucularda barındırılır" cümlesi landing'den aynı
  gün kaldırılır (DEC-20261005-02).
- Veli yalnız kurumun açtığı hesap olarak anılır; veli cümlesi staging veli UAT kanıtı gelmeden landing,
  demo ve satış metnine girmez.
- Kurumlar arası veri izolasyonu UI görünürlüğüne değil API guard, subject/scope ve RLS kanıtına
  dayanır; tasarım metni bu güvenlik sınırını genişletemez.
- Ödeme ve iletişim metni mevcut takip/iş akışını anlatır; sağlayıcı teslimi veya mali belge üretimi
  ima etmez.
