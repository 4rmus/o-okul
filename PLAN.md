# Uzman Hocam Panel, UI/UX ve DB Modernizasyon Planı

## Özet
- Dört ajanla salt-okunur paralel analiz yapıldı: `product_scope_planner`, `frontend_ux_engineer`, `data_platform_engineer`, `tenant_security_reviewer`.
- Hedef yeni ürün açmak değil; mevcut v1 döngüsünü profesyonelleştirmek: `TXT/DAT optik -> rapor/karne -> öğrenci/veli/öğretmen portalları -> ödeme/taksit -> duyuru/SMS/destek -> kanıt zinciri`.
- UI tarafında temel iyi: rol bazlı paneller, ortak `CrudPage`, `DataTable`, `ListControls`, portal kabuğu ve mobil/e2e sözleşmeleri var.
- DB tarafında RLS temeli güçlü; ancak modernizasyon başlamadan önce P1 guardrail’ler kapatılmalı: tenant FK bütünlüğü, audit diff PII redaksiyonu, `bypass_rls` sınırı ve RBAC parity.

## Ana Fazlar

1. **Gerçeklik ve Kapsam Kilidi**
   - Güncel kaynak olarak `docs/product-journeys-v1.md` ve `docs/DECISIONS.md` esas alınacak.
   - Eski/stale plan bölümleri ayrıştırılacak; özellikle tamamlanmış portal/UI alanları “eksik” gibi görünmeyecek.
   - Kapsam dışı kalacaklar: online sınav, ödeme sağlayıcı/fatura, OMR/foto optik okuma, salon/oturma planı.
   - Çıktı: persona-panel-UAT matrisi, modül sahipliği ve kabul kriterleri tek güncel dokümanda netleşmiş olacak.

2. **Güvenlik ve DB Guardrail Fazı**
   - `tenantScopedTables` için tek kaynak kullanılacak; elle tutulan 32 tablo listesi ile şemadan türeyen 54 tablo drift’i giderilecek.
   - Tenant’lı modelden tenant’lı modele ilişkiler için statik gate eklenecek: ilişki ya `tenantId + id` kompozit FK ile korunacak ya da testli istisna olacak.
   - `bypass_rls` normal tenant endpointlerinde header ile açılamayacak; sadece açık break-glass route metadata’sı olan sistem/admin akışlarında çalışacak.
   - Audit log `diff` yazımı allowlist/redaction kuralına bağlanacak; API raw PII içeren diff döndürmeyecek.
   - `tenant-db:check` dosya seviyesinden query/method seviyesine yaklaştırılacak.

3. **UI/UX Tutarlılık Fazı**
   - Liste ekranları için ortak yoğun toolbar standardı uygulanacak: arama, sıralama, sayfa boyutu, sayfalama mobilde taşmadan çalışacak.
   - Kritik tablolarda `mobilePriority` ve `mobileLabel` audit’i yapılacak: finans, kullanıcılar, destek, rapor, optik.
   - Rol portalları görünümü değiştirilmeden sadeleştirilecek; büyük dosyalar yerel `DailyBrief`, `ActionStrip`, `SummaryMetrics`, `Workspace` parçalarına ayrılacak.
   - Demo giriş CTA’sı production yüzeyinde görünmeyecek ya da açık demo etiketiyle korunacak.
   - Sistem/evidence ekranlarında `Reference`, `Live`, `Evidence` durum ayrımı tutarlı rozetlerle gösterilecek.

4. **Panel ve Veri Akışı Kapanışı**
   - Sistem admin: kurum açma, ilk admin, lisans/status ve evidence ekranları staging kanıtına bağlanacak.
   - Kurum admin: kurulum sihirbazı, kişi yönetimi, optik import, rapor/karne, finans, duyuru/destek akışları UAT ile kapatılacak.
   - Öğretmen/öğrenci/veli portalları: kişi-düzeyi erişim, bağlı öğrenci kuralı, finans izni, destek, duyuru ve rapor görünümü negatif testlerle doğrulanacak.
   - Rapor karşılaştırmalarında `Başarı %` birincil metrik kalacak; `Net` ve `Soru` bağlam olarak korunacak.

5. **Canlı Kanıt ve Release Fazı**
   - Optik -> rapor/karne akışı mock’suz staging kanıtı üretecek.
   - SMS/e-posta/push gerçek sağlayıcı smoke’ları repo PASS’inden ayrı değerlendirilecek.
   - KVKK, upload AV, financial retention, observability, backup/restore, rollback ve go-live evidence zinciri final gate’e bağlanacak.

## API / Tip / DB Sözleşmeleri
- API response shape değişirse `packages/shared-types` ve OpenAPI çıktısı aynı değişiklikte güncellenecek.
- DB schema değişirse migration, RLS check, seed etkisi, canlı negatif FK kanıtı ve backfill/preflight birlikte planlanacak.
- Web route, navigation, shared capability ve API guard arasında parity testi eklenecek.
- Token saklama davranışı değişmeyecek: access token memory, refresh cookie HttpOnly; yeni panel `localStorage/sessionStorage` token yazmayacak.

## Test Planı
- Başlangıç gate’leri: `pnpm --filter @uzman-hocam/web typecheck`, `pnpm --filter @uzman-hocam/api test`, `pnpm --filter @uzman-hocam/db test`.
- UI gate’leri: `pnpm web:a11y:check`, `pnpm web:ux-baseline:check`, `pnpm web:ux-contract:check`, `pnpm karne:visual-contract:check`.
- DB/security gate’leri: `pnpm db:rls:check`, `pnpm tenant-db:check`, `pnpm db:rls:check:live`, `pnpm security:audit:check`, `pnpm web:token-storage:check`.
- Ürün akışları: `pnpm live:onboarding:smoke`, `pnpm live:exam-cycle:check`, `pnpm live:ui-worker:smoke`, `pnpm report-generation:smoke`.
- Release gate’leri: `pnpm sms:smoke`, `pnpm notification:smoke`, `pnpm upload-av:check`, `pnpm prod:evidence:templates:check`, `pnpm pilot:check`, `pnpm go-live:check`.

## Varsayımlar
- Önce güvenlik/DB guardrail, sonra geniş UI modernizasyonu yapılacak.
- Büyük migration tek seferde değil, öğrenci-sınıf-öğretmen-veli ilişkilerinden başlayarak parça parça yapılacak.
- Gerçek TXT/DAT cihaz örneği, Netgsm/e-posta/push credential’ları, AV sağlayıcı seçimi ve gerçek kurum logo/karne marka onayı dış bağımlılık olarak kalıyor.
- İlk analiz salt-okunur yürütüldü; devamında repo-içi guardrail ve evidence sözleşmeleri küçük fazlar halinde uygulandı.

## Güncel Uygulama Durumu
- Faz 1 repo-içi kapandı: `docs/product-journeys-v1.md` persona-panel-UAT matrisi, modül sahipliği ve status drift kontrolü `scripts/check-product-journeys.mjs` ile korunuyor.
- Faz 2 repo-içi kapandı: tenant tablo kaynağı parity gate’e bağlandı, tenant ilişki FK istisnaları sentinel test istiyor, normal endpointlerde `bypass_rls` header’ı guard ile sınırlı, audit diff allowlist/redaction merkezi katmanda uygulanıyor.
- Faz 3 ve 4 için repo sözleşmeleri ve statik/UX kanıt kapıları güncellendi; gerçek kullanıcı kabulü ve canlı panel kanıtı staging’e bağlı.
- Faz 5 repo sözleşmeleri geçiyor; gerçek staging/live kanıt üretimi GitHub `staging` environment secret’ları ve sağlayıcı credential’ları gelmeden tamamlanmış sayılmıyor.
