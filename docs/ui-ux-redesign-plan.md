# O-Okul UI/UX Yeniden Tasarım Planı

## Özet

Bu planın çıktı hedefi `docs/ui-ux-redesign-plan.md` dosyasıdır.

Mevcut uygulama gerçek kaynak kabul edilir. Güncel v1 ürün omurgası:
`TXT/DAT optik -> rapor/karne -> öğrenci/veli portalı -> ödeme ve iletişim takibi`.
Landing/hero odaklı tasarım hedef dışıdır. Ekranlar operasyonel, yoğun ama okunaklı eğitim SaaS arayüzü olarak yenilenecektir.

Keşif notları:

- Web `3001` çalışırken API `3100` kapalıysa yalnız login ve shell gözlemi yapılabilir; login sonrası ekranlar canlı doğrulanmış sayılmaz.
- `/login` 375, 768, 1024 ve 1440 genişliklerinde yatay taşma üretmemelidir.
- Dış design-system araştırmalarından yalnız data-dense dashboard, trust blue + accent, görünür focus, keyboard navigation, skip link, 150-300ms mikro-etkileşim ve grafiklerde veri tablosu desteği gibi uygulanabilir parçalar alınmalıdır.
- Event/landing/hero odaklı öneriler ürün hedefiyle uyumsuz kabul edilir.

## Mevcut Uygulama Haritası

Roller:

- `SYSTEM_ADMIN`: sistem paneli, kurumlar, sağlık, gözlem, denetim.
- `TENANT_ADMIN`: kurum yönetimi, kurulum, kişiler, eğitim, sınav/optik/rapor, finans, destek, kullanıcı/rol, yedekleme.
- `ASSISTANT_ADMIN`: öğrenci/personel/eğitim/akademik/destek ağırlıklı kurum akışları; finans ve operasyon farkları plan içinde görünür işaretlenir.
- `TEACHER`: ders akışı, öğrenci takibi, ödev, rapor, duyuru, destek.
- `STUDENT`: rapor, ödev, duyuru, devamsızlık, profil, destek.
- `GUARDIAN`: öğrenci, rapor, ödeme, ödev, duyuru, bildirim, destek.

Ana sayfa alanları:

- Kurum: 27 görünür nav maddesi; en yoğun yüzey.
- Gizli kurum operasyon sayfaları: KVKK, denetim, sistem sağlığı, UAT/rollback, güvenlik denetimi, gözlemlenebilirlik gibi sayfalar access map'te var ama nav keşfi zayıf.
- Portallar: öğretmen, öğrenci, veli route'ları alt görünüm alıyor; ancak sayfa başlıkları sabit kaldığı için alt görev kimliği zayıf.
- Ortak UI: `PageFrame`, `CrudPage`, `DataTable`, `Panel`, `MetricCard`, `Tabs`, `Toolbar`, `EmptyState`, `LoadingState`, Chart.js tabanlı rapor bileşenleri.

## Ana UX Problemleri

### P0

Doğrudan P0 UI bulgusu yok. Mevcut shell yetkisiz path yönlendirmesi ve role göre nav filtreleme yapıyor.

### P1

- Gizli ama yetkili operasyon ekranları keşfedilebilir değil. Çözüm: tek route registry mantığıyla access map ve nav/command palette aynı kaynaktan beslenecek.
- Mobil tablo davranışı parçalı. `DataTable` mobile priority sağlıyor, ama bazı tablo shell'leri geniş `min-width` ile yatay kaydırmaya dayanıyor.
- Portal alt sayfaları route olarak ayrı ama başlık/bağlam sabit. Çözüm: portal alt görünüm başlığı, kısa bağlam şeridi ve aktif görev dili eklenecek.
- Rapor/karne export yüzeyi `academic:manage` ile geniş görünüyor. UI redesign bu yüzeyi daha görünür yapmayacak; capability ayrımı ayrı güvenlik kararı olarak açılacak.
- SMS recipient preview ham PII taşıyor. Bu veri dashboard, evidence, export veya log yüzeylerine taşınmayacak.

### P2

- Kurum nav günlük iş, kurulum, yönetim ve kanıt ekranlarını aynı ağırlıkta gösteriyor.
- Liste kontrolleri yoğun sayfalarda yeterince görev odaklı değil.
- Rapor ve optik ekranları güçlü ama ağır; "iş adımı + durum + çıktı" hiyerarşisi daha açık olmalı.
- `globals.css` çok büyümüş; redesign mevcut token/sınıf sözleşmesini koruyarak sayfa bazlı özel CSS'i azaltmalı.

## Tasarım Sistemi

Görsel yön:

- Stil: data-dense, minimal, profesyonel, operasyonel SaaS.
- Renk: mevcut trust blue çizgisi korunacak; ana renk `#155EEF` veya yakın token, durum renkleri mevcut success/warning/danger ile uyumlu kalacak.
- Tipografi: mevcut Inter korunabilir. Plus Jakarta Sans yalnız Faz 0'da POC olarak ölçülür. Varsayılan karar: font değişikliği yapılmaz.
- Layout: 8px tabanlı spacing, 7-8px radius, kompakt kart/panel, sticky tablo başlıkları, sabit shell ölçüleri.
- Hareket: yalnız hover/focus/loading/status geçişleri; 150-300ms; `prefers-reduced-motion` korunur.
- İkon: `lucide-react`; emoji ikon yok.
- Erişilebilirlik: görünür focus, mantıklı tab sırası, skip link, tablo caption/description, grafik altında veri tablosu.

## Bilgi Mimarisi ve Navigasyon

Yeni kurum IA:

- Başlangıç: Özet, Kurulum.
- Günlük Operasyon: Öğrenciler, Veliler, Öğretmenler, Sınıflar, Devamsızlık, Program, Etütler.
- Sınav ve Rapor: Sınavlar, Kazanımlar, Optik Okuma, Raporlar.
- İletişim ve İçerik: Duyurular, Şablonlar, Materyaller, Notlar, Destek.
- Finans: Ödemeler.
- Yönetim ve Kanıt: Kullanıcılar, Rol Önizleme, Yedekleme, KVKK, Denetim, Sistem Sağlığı. Bu grup yalnız capability geçerse görünür.

Command palette:

- Görünür nav maddeleri ve erişilebilir gizli operasyon sayfaları aynı yetki kontrolünden beslenecek.
- Varlık araması PII-safe kalacak; telefon, e-posta ve ham öğrenci cevabı global sonuçlara taşınmayacak.

Top-level route kuralı:

- Yeni `/raporlar`, `/ayarlar`, `/dashboard` gibi kök route açılmayacak.
- Tüm app route'ları `/kurum`, `/sistem`, `/ogretmen`, `/ogrenci`, `/veli` altında kalacak veya önce route access matrix güncellenecek.

## Rol Bazlı Ekran Yenileme

Kurum yöneticisi:

- Dashboard günlük karar sinyalleriyle başlar: optik karantina, rapor durumu, ödeme riski, devamsızlık, destek.
- Kurulum ve kişi yönetimi daha net ilk kullanım akışı alır.
- Rapor/optik akışı "hazırlık, yükleme, eşleşme, değerlendirme, çıktı" adımlarıyla görünürleşir.

Yardımcı yönetici:

- Admin ile farklar UI'da sessizce gizlenmek yerine yetki dışı aksiyonlarda anlaşılır "yetki gerekiyor" diliyle gösterilir.
- Varsayılan: mevcut RBAC değiştirilmez; rapor export/soru detayı genişliği ayrı karar maddesi olur.

Öğretmen:

- "Bugün" odaklı panel: ders, yoklama, ödev kontrolü, öğrenci notu, destek.
- Öğrenci seçimi ve rapor bağlamı sticky veya kalıcı üst bağlam olarak korunur.
- Role-preview modunda tüm yazma aksiyonları kapalı kalır.

Öğrenci:

- Günlük durum, ödev, devamsızlık, duyuru ve son sınav özetleri sadeleşir.
- Başarı % ana metrik; Net/Soru bağlam olarak kalır.

Veli:

- Çok çocuklu veli için öğrenci seçici tüm alt görünümlerde görünür bağlam olarak kalır.
- Finans yalnız `canViewFinance=true` ise görünür; kapalıysa tutar/plan bilgisi sızmaz.
- Bildirim ve destek izinleri açık/kapalı durumuyla anlaşılır.

Sistem admin:

- Kurum, lisans/status, sağlık, audit/observability ve evidence ekranları ürün pazarlama gibi değil operasyon konsolu gibi tasarlanır.

## Kritik Akışlar

Kurum yönetimi:

- Kurulum sihirbazı, kişi yönetimi ve sınıf/kampüs/seviye ekranları aynı liste/form/boş durum diliyle standardize edilir.

Optik/TXT-DAT import:

- Format seçimi, dosya yükleme, karantina çözümü, evaluation durumu ve rapor üretimi tek progress modelinde gösterilir.
- Kuyruğa alındı ile tamamlandı ayrımı net kalır.

Sınav/rapor/karne:

- Rapor workspace tabları korunur ama ilk giriş "sorgu/üretim durumu" ve "hazır çıktı" odaklı olur.
- Karşılaştırmada ana metrik Başarı %. Net ve Soru yalnız bağlam olarak gösterilir.
- PDF/Excel export için yetki görünürlüğü değiştirilmeyecek; capability ayrımı ayrı güvenlik işi.

Portallar:

- Öğretmen, öğrenci, veli ortak portal shell'i korunur; alt görünüm başlığı ve aktif görev kimliği eklenir.
- Role-preview read-only zinciri merkezi testle korunur.

Ödeme ve iletişim:

- Ödeme sağlayıcı/fatura/makbuz vaadi yok. Yalnız taksit/alacak takibi.
- SMS recipient preview ham PII içerdiği için dashboard/evidence/export yüzeylerine taşınmaz; gerekirse maskeli özet kullanılır.

Yönetici ayarları:

- Kullanıcı, rol önizleme, KVKK, denetim, yedekleme, sistem sağlığı "Yönetim ve Kanıt" çatısı altında capability ile gösterilir.

## Komponent Sistemi

Tablo/listeler:

- `DataTable` mobile priority gerçek kart/table hybrid davranışına bağlanır.
- 375px'te kritik kolonlar görünür, ikincil kolonlar satır detayı olarak akar.
- Sticky aksiyon/başlık yalnız gerekli tablolarda kullanılır.

Filtreler:

- `FilterBar` yoğun ekranlarda arama, hızlı filtre, sıralama, sayfa boyutu ve temizle aksiyonunu tek standarda çeker.
- URL state korunur.

Form ve validasyon:

- `Field`, `Input`, `Select`, `Textarea`, `FormModal` mevcut kalır.
- Hata metinleri kısa, Türkçe, işlem odaklı olur.
- Zorunlu alan, açıklama ve örnek format düzeni standardize edilir.

Kart/panel:

- Nested card yok.
- `Panel` operasyon bölümü, `MetricCard` kısa metrik, `ActionCard` yönlendirme/aksiyon için kullanılır.
- StatusBadge anlamı her yerde aynı kalır.

Rapor grafikleri:

- Chart.js devam eder.
- Her grafik veri tablosu veya tablo caption ile desteklenir.
- Radar grafik 5-8 ekseni aşarsa bar/tablolu alternatif tercih edilir.

Boş/yükleniyor/hata:

- Her yoğun ekran `LoadingState`, `EmptyState`, inline error ve retry davranışıyla standardize edilir.
- Hata durumunda ham PII veya teknik stack gösterilmez.

Modal/drawer/toast:

- Kritik onaylar `ConfirmDialog`.
- Büyük formlar modal yerine sayfa içi panel veya drawer adayı olarak tasarlanır.
- Toast yalnız sonuç bildirimi için kullanılır; kalıcı durum kart/panelde kalır.

## Fazlı Uygulama Planı

### Faz 0 - Tasarım sistemi ve güvenlik baseline

- Amaç: token, layout, route/RBAC guardrail ve görsel baseline'ı kilitlemek.
- Dosya alanları: `apps/web/app/globals.css`, `packages/ui/src/**`, `apps/web/app/(app)/_shared/**`.
- Sorumlu ajan: `frontend_ux_engineer`; review: `tenant_security_reviewer`, `qa_verification_engineer`.
- Başarı kriteri: mevcut UI bozulmadan token/radius/spacing/focus standardı ve route registry kararı net.
- Doğrulama: `pnpm --filter @o-okul/web typecheck`, `pnpm web:a11y:check`, `pnpm web:ux-baseline:check`.
- Risk: kullanıcı değişikliği taşıyan `globals.css`.
- Rollback: yalnız token/CSS değişiklikleri geri alınabilir küçük patch'ler.

### Faz 1 - Shell, navigasyon ve rol bazlı çatı

- Amaç: kurum nav kalabalığını azaltmak, gizli operasyon ekranlarını yetkiyle keşfedilebilir yapmak, portal alt görünüm başlıklarını düzeltmek.
- Dosya alanları: app shell, navigation/access, portal shell.
- Başarı kriteri: tüm roller doğru ana sayfa, sidebar, command palette ve portal görünümüne gider.
- Doğrulama: `pnpm web:ux-contract:check`, role-preview, teacher, student/guardian portal specs.
- Risk: hidden path capability drift.
- Rollback: eski nav grupları korunarak feature slice geri alınır.

### Faz 2 - Yoğun kurum operasyon ekranları

- Amaç: kişiler, sınıf, program, devamsızlık, finans, destek ve liste ekranlarını standart `CrudPage`/`DataTable`/`FilterBar` düzenine almak.
- Dosya alanları: kurum liste/detail sayfaları, list controls, UI table.
- Başarı kriteri: 375, 768, 1024 ve 1440 genişlikte yatay taşma yok; boş/hata/yükleniyor dili tutarlı.
- Doğrulama: web typecheck, data-table mobile contract, UI visual QA, targeted Playwright.
- Risk: tablo davranışı geniş veriyle bozulabilir.
- Rollback: sayfa bazlı geri dönüş.

### Faz 3 - Optik, rapor, karne ve analitik

- Amaç: optik ve rapor workspace'lerini adım/durum/çıktı hiyerarşisine almak.
- Dosya alanları: optik page, reports page, report shared components, chart components.
- Başarı kriteri: Başarı % ana metrik; Net/Soru bağlam; export/karne üretim durumu net.
- Doğrulama: `pnpm karne:visual-contract:check`, report workspace contract, portal report panel, live UI worker evidence contract.
- Risk: assistant admin export ve soru detayı yetki sınırı.
- Rollback: rapor/optik workspace patch'i ayrı tutulur.

### Faz 4 - Portal ve mobil/tablet iyileştirme

- Amaç: öğretmen, öğrenci, veli portallarında günlük görev, bağlı öğrenci, rapor ve destek akışlarını sadeleştirmek.
- Dosya alanları: `portals/_shared/**`, teacher/student/guardian portal pages.
- Başarı kriteri: role-preview salt-okuma, veli finance visibility, subjectType sınırları bozulmaz.
- Doğrulama: portal contract specs, guardian privacy, role-preview, 375/768/1024/1440 screenshot.
- Risk: `readOnly` prop düşerse yazma aksiyonları görünür olabilir.
- Rollback: portal shared component değişiklikleri küçük parçalar halinde yapılır.

### Faz 5 - A11y, performans, görsel kalite ve release kanıtı

- Amaç: redesign'ı release kanıt zincirine bağlamak.
- Dosya alanları: e2e specs, ux baseline checker, evidence docs/templates gerektiği kadar.
- Başarı kriteri: local/static PASS ile staging/prod kanıtı ayrılır; kalıcı screenshot/evidence artifact üretilir.
- Doğrulama: `pnpm run ci`, `pnpm web:a11y:check`, `pnpm web:ux-baseline:check`, `pnpm prod:evidence:templates:check`, staging'de `pnpm live:onboarding:smoke`, `pnpm live:ui-worker:smoke`, `pnpm uat:check`.
- Risk: evidence artifact'lerinde PII.
- Rollback: evidence checker ve UI değişiklikleri ayrı commit/PR olarak tutulur.

## Public API, Interface ve Type Etkisi

Varsayılan plan UI-only ilerler:

- DB, API, worker, migration ve shared contract değişikliği yapılmaz.
- Mevcut `@o-okul/ui` komponent public prop'ları kırılmaz.
- `packages/shared-types` değiştirilmez.

Ayrı karar gerektiren olası işler:

- `report:read`, `report:export`, `report:question-detail` capability ayrımı.
- Hidden route registry için shared type gerekiyorsa önce küçük RFC/DEC açılır.
- SMS preview maskeleme contract'ı gerekirse API/shared-types/OpenAPI birlikte planlanır.

## Test Planı

Minimum lokal:

- `pnpm --filter @o-okul/web typecheck`
- `pnpm web:a11y:check`
- `pnpm web:ux-baseline:check`
- `pnpm web:ux-contract:check`
- `pnpm karne:visual-contract:check`

Hedefli Playwright:

- `role-preview-contract-next.spec.ts`
- `teacher-portal-contract-next.spec.ts`
- `student-guardian-portal-contract-next.spec.ts`
- `portal-report-panel-next.spec.ts`
- `report-workspace-contract-next.spec.ts`
- `optik-workspace-contract-next.spec.ts`
- `data-table-mobile-contract-next.spec.ts`
- `ui-visual-qa-next.spec.ts`

Viewport kanıtı:

- 375, 768, 1024 ve 1440 genişliklerinde kurum dashboard, kişi listeleri, optik, rapor, karne, öğretmen/öğrenci/veli portalı.
- Artifact varsayılanı: `artifacts/ui-ux-redesign/<phase>/`.

Security/evidence:

- Route access matrix: unknown top-level app route denied.
- Hidden path matrix: tenant/admin/system/portal rolleri.
- PII negative: SMS preview, telefon, veli finans, report question detail, evidence/log/export.
- Staging final: local mock PASS final kanıt sayılmaz; staging/prod artifact gerekir.

## Uygulama Kanıtı - 2026-06-25

Bu bölüm local/static kanıtı ve release evidence sözleşmesi kanıtını kaydeder.
Staging/prod kabulü için canlı artifact üretilmeden redesign release-ready sayılmaz.

| Kapsam | Kanıt | Durum | Sınır |
| --- | --- | --- | --- |
| Faz 0/1 shell ve portal bağlamı | `corepack pnpm --filter @o-okul/web typecheck`, `NEXT_E2E_PORT=3316 corepack pnpm web:a11y:check`, `corepack pnpm web:ux-baseline:check` | PASS | Local/static; canlı kullanıcı akışı değildir. |
| Faz 1 nav/access registry | `corepack pnpm ops:check`, `NEXT_E2E_PORT=3322 corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts --workers=1 e2e-next/governance-evidence-contract-next.spec.ts -g "route erişimi"`, `NEXT_E2E_PORT=3323 corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts --workers=1 e2e-next/backup-restore-next.spec.ts`, `NEXT_E2E_PORT=3324 corepack pnpm web:ux-contract:check` | PASS, UX 80/80 | Local/static; KVKK/Denetim capability keşfi ve system operasyon kapalı kalma sözleşmesi. |
| Faz 1 top-level route guard | `corepack pnpm --filter @o-okul/web typecheck`, `corepack pnpm web:ux-baseline:check`, `NEXT_E2E_PORT=3336 corepack pnpm web:ux-contract:check` | PASS, UX 80/80 | Bilinmeyen app-shell route varsayılan izin almaz; local/static guardrail, staging/prod UAT yerine geçmez. |
| Faz 2 mobil DataTable ve FilterBar | `corepack pnpm --filter @o-okul/ui build`, `NEXT_E2E_PORT=3306 corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts --workers=1 e2e-next/data-table-mobile-contract-next.spec.ts`, `NEXT_E2E_PORT=3325 corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts --workers=1 e2e-next/data-table-mobile-contract-next.spec.ts -g "finans ödeme"`, `NEXT_E2E_PORT=3326 corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts --workers=1 e2e-next/list-url-state-next.spec.ts -g "finans listesi\|destek listesi"` | PASS | Mock API ve Playwright sözleşmesi; finans/destek filtreleri shared `FilterBar` kullanır. |
| Faz 2 akademik yapı liste kontrolleri | `corepack pnpm --filter @o-okul/web typecheck`, `NEXT_E2E_PORT=3330 corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts --workers=1 e2e-next/data-table-mobile-contract-next.spec.ts -g "devamsızlık günlük\|program, etüt"`, `NEXT_E2E_PORT=3330 corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts --workers=1 e2e-next/list-url-state-next.spec.ts -g "akademik yapı referans"`, `corepack pnpm web:ux-baseline:check` | PASS | Sınıf, program ve devamsızlık kontrolleri shared `ListControls`/`FilterBar` bandında; local/mock sözleşme. |
| Faz 2 ortak liste kontrol regresyonu | `NEXT_E2E_PORT=3332 corepack pnpm web:ux-contract:check` | PASS, 80/80 | Shared `ListControls` değişikliği tüm UX sözleşme yüzeyinden geçti; staging/prod UAT yerine geçmez. |
| Faz 3 optik/rapor hiyerarşisi | `NEXT_E2E_PORT=3312 corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts --workers=1 e2e-next/optik-workspace-contract-next.spec.ts`, `NEXT_E2E_PORT=3309 corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts --workers=1 e2e-next/report-workspace-contract-next.spec.ts`, `corepack pnpm karne:visual-contract:check` | PASS | Local snapshot/queue fixture; worker/live evidence yerine geçmez. |
| Faz 3 gerçek örnek optik fixture regresyonu | `corepack pnpm --filter @o-okul/api exec vitest run src/exam/answer-key-excel-import.service.test.ts`, `corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/optik-7108-real-pipeline.test.ts` | PASS, API 4/4, worker 3/3 | `ornek-veriler/` iSEM/3D/MUBA TXT + cevap anahtarı dosyalarıyla parse, A/B hizalama ve scoring beklentileri güncel tutulur; staging live exam-cycle yerine geçmez. |
| Faz 4 portal mobil/tablet | `NEXT_E2E_PORT=3315 corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts --workers=1 e2e-next/teacher-portal-contract-next.spec.ts e2e-next/student-guardian-portal-contract-next.spec.ts` | PASS | Role-preview, guardian finance ve subjectType UI sözleşmesi; canlı hesap/UAT değildir. |
| Toplu UX sözleşmesi | `NEXT_E2E_PORT=3317 corepack pnpm web:ux-contract:check` | PASS, 80/80 | Local/static; staging/prod artifact gerekir. |
| Toplu lokal UI/UX redesign gate | `corepack pnpm ui-ux-redesign:local-gates` | PASS; a11y 6/6, UX 80/80, API fixture 4/4, worker fixture 3/3, görsel QA 21/21 | Tek komut shared-types/UI build, web typecheck, a11y, UX contract, karne, `ornek-veriler/`, evidence generator ve screenshot artifact zincirini doğrular; local/static ve mock kanıttır. |
| Faz 5 local görsel artifact | `NEXT_E2E_PORT=3329 corepack pnpm ui-ux-redesign:visual-qa` | PASS, 21/21; 48 screenshot `artifacts/ui-ux-redesign/local` | Local/mock görsel kanıt; staging/prod artifact ve UAT yerine geçmez. |
| Faz 5 örnek içerik fixture guardrail'i | `corepack pnpm ui-ux-redesign:example-fixtures`, `corepack pnpm ops:check` | PASS | `ornek-veriler/` altındaki iSEM/3D/MUBA TXT + cevap anahtarı ve öğrenci/öğretmen aktarım şablonları metadata/biçim düzeyinde doğrulanır; raw içerik terminale veya release artifact'e yazılmaz. |
| Faz 5 release evidence sözleşmesi | `node --check scripts/generate-ui-ux-redesign-evidence.mjs`, `corepack pnpm staging:evidence-env:secret:contract`, `corepack pnpm staging:evidence-env:check`, `corepack pnpm prod:evidence:templates:check`, `corepack pnpm prod:readiness:check`, `corepack pnpm ops:check` | PASS | UI/UX redesign kanıtı staging workflow'da üretilir, production summary ve go-live summary içinde zorunlu olur; canlı artifact/UAT yerine geçmez. |
| Faz 5 UI/UX evidence generator kontratı | `corepack pnpm ui-ux-redesign:evidence-generate:contract`, `corepack pnpm prod:readiness:check`, `corepack pnpm ops:check` | PASS | Generator geçerli staging env ile kendi checker'ından geçen JSON üretir; eksik referans, placeholder release candidate, query/userinfo/fragment taşıyan referans, temp output ve `artifacts/local` output negatifleri korunur. |
| Faz 5 gerçek staging readiness audit | `gh variable set STAGING_DEPLOY_DIR --repo 4rmus/o-okul --env staging --body /root/o-okul`, `corepack pnpm staging:github-env:gaps:summary -- --repo 4rmus/o-okul --environment staging --gap-report-file artifacts/local/staging-github-env-gap-report.json`, `ssh -o BatchMode=yes uzman-hocam-server 'cd /root/o-okul && git rev-parse --short HEAD'` | GAP | GitHub staging var `STAGING_DEPLOY_DIR=/root/o-okul` olarak hizalandı; remote stack `/root/o-okul` altında güncel main checkout'u ile çalışıyor. Kalan GitHub environment blokajı yalnız `GHCR_READ_TOKEN` ve `STAGING_EVIDENCE_ENV_B64` secret eksikleri. |
| Faz 5 GitHub staging env gap özeti | `corepack pnpm staging:github-env:gaps:contract`, `corepack pnpm staging:github-env:gaps:summary -- --repo 4rmus/o-okul --environment staging --gap-report-file artifacts/local/staging-github-env-gap-report.json`, `corepack pnpm ops:check` | GAP/PASS ayrımı | Eksik staging secret/var listesi makine-okunur `artifacts/local/**` raporuna yazılır; secret değerleri yazdırılmaz ve bu rapor canlı release kanıtı sayılmaz. |
| Faz 5 birleşik full release readiness özeti | `corepack pnpm ui-ux-redesign:release-readiness:contract`, `corepack pnpm ui-ux-redesign:release-readiness:check:contract`, `corepack pnpm ui-ux-redesign:release-readiness:summary -- --repo 4rmus/o-okul --environment staging --host uzman-hocam-server --remote-root /root/o-okul --summary-file artifacts/local/ui-ux-redesign-release-readiness-summary.json --github-gap-report-file artifacts/local/staging-github-env-gap-report.json --remote-snapshot-dir artifacts/local/remote-staging-snapshot --remote-gap-report-file artifacts/local/remote-staging-gap-report.json`, `corepack pnpm ui-ux-redesign:release-readiness:check -- --target artifacts/local/ui-ux-redesign-release-readiness-summary.json --max-age-minutes 30`, `corepack pnpm ops:check` | GAP/BLOCKED | Bu kapı UI/UX tek başına için değil, tam staging/prod release handoff'u içindir. Tek raporda `GHCR_READ_TOKEN`, `STAGING_EVIDENCE_ENV_B64`, local ve remote main checkout hizası, remote `ui-ux-redesign:evidence-generate=present`, 11 zorunlu dosya ve 14 kapanış kalemi görünür. `remote_code_deploy` artık blokaj değildir. `check` GAP handoff'unu doğrular; `--require-ready` bu durumda kırılır. `releaseEvidence=false`; PASS kanıtı değildir. |
| Faz 5 gh deploy preflight | `corepack pnpm ui-ux-redesign:release-preflight:contract`, `corepack pnpm ui-ux-redesign:release-preflight -- --repo 4rmus/o-okul --environment staging --host uzman-hocam-server --remote-root /root/o-okul --summary-file artifacts/local/ui-ux-redesign-release-readiness-summary.json --github-gap-report-file artifacts/local/staging-github-env-gap-report.json --remote-snapshot-dir artifacts/local/remote-staging-snapshot --remote-gap-report-file artifacts/local/remote-staging-gap-report.json --max-age-minutes 30`, `corepack pnpm ops:check` | GAP/BLOCKED | Tek komut taze readiness özeti üretir ve `--require-ready` ile durur. Güncel blokajlar: iki eksik GitHub secret, 11 eksik remote release artifact ve 14 açık kapanış kalemi. |
| Faz 5 UI/UX canlı yüzey kapısı | `corepack pnpm ui-ux-redesign:live-surface:check -- --base-url https://o-okul.com` | PASS/GAP ayrımı | UI/UX için provider bağımsız canlı kontrol: `/login`, `/health`, `/health/ready`, HTTPS güvenlik başlıkları, web CSP ve `X-Powered-By` kapanışı. Netgsm, S3, Sentry bu kapının girdisi değildir; onlar full production/go-live kapısında kalır. |
| Faz 5 staging evidence env audit | `ssh -o BatchMode=yes uzman-hocam-server 'cd /root/o-okul && set -a && . ./.env.local >/dev/null 2>&1 && set +a && pnpm prod:env:check'` | GAP/BLOCKED | Remote `.env.local` canlı runtime dosyasıdır, release evidence env yerine geçmez. `prod:env:check` Netgsm, notification HTTP, Sentry, alert webhook, admin MFA secretları, prod evidence target'ları, rollback tag ve kalıcı kanıt hedefleri eksik olduğu için kırılır. Bu kalemler UI/UX canlı yüzey kapısı için gerekli değildir; tam production/go-live kanıtı için ayrı izlenir. |
| Faz 5 staging env repo slug guardrail'i | `corepack pnpm staging:evidence-env:check`, `corepack pnpm staging:evidence-env:secret:contract`, `corepack pnpm ops:check` | PASS | `UI_UX_REDESIGN_RELEASE_CANDIDATE` ve GitHub run referansı workflow'un `GITHUB_REPOSITORY` slug'ını kullanır; eski `owner/o-okul` run URL kalıbı staging secret hazırlığında sessizce taşınmaz. |
| Faz 5 UI/UX evidence template repo slug guardrail'i | `UI_UX_REDESIGN_ALLOW_EXAMPLE_EVIDENCE=1 UI_UX_REDESIGN_EVIDENCE_TARGET=docs/evidence-templates/ui-ux-redesign.example.json node scripts/check-ui-ux-redesign-evidence.mjs`, `corepack pnpm prod:evidence:templates:check`, `corepack pnpm prod:readiness:check`, `corepack pnpm ops:check` | PASS | `docs/evidence-templates/ui-ux-redesign.example.json` içindeki GitHub run referansı güncel `4rmus/o-okul` slug'ıyla sabitlendi; eski `o-okul/o-okul` örnek referansı geri dönemez. |
| Faz 5 GHCR read token secret guardrail'i | `corepack pnpm staging:ghcr-read-token:secret:contract`, `corepack pnpm prod:readiness:check`, `corepack pnpm ops:check` | PASS | Eksik `GHCR_READ_TOKEN` için güvenli yazma helperı eklendi; repo/temp/symlink dosyalarını reddeder, `chmod 600` ister ve token'ı yalnız stdin ile `gh secret set` komutuna verir. |
| Faz 5 remote gap komut guardrail'i | `node --check scripts/print-remote-staging-release-gap-summary.mjs`, `corepack pnpm prod:plan:check`, `corepack pnpm prod:readiness:check`, `corepack pnpm ops:check` | PASS | Remote artifact gap'i artık tek komutla snapshot alınarak okunur; snapshot/gap çıktısı yalnız `artifacts/local/**` altında kalır ve PASS kanıtı sayılmaz. |
| Faz 5 remote gap kontratı | `corepack pnpm staging:remote-release-gaps:contract`, `corepack pnpm prod:readiness:check`, `corepack pnpm ops:check` | PASS | Sahte SSH ile remote snapshot/gap akışı doğrulanır; eksik bundle non-zero kalır, `reports/ui-ux-redesign.json` ve `release-summary-*.json` handoff'u makine-okunur gap raporunda görünür. |
| Faz 5 remote host alias guardrail'i | `ssh -o BatchMode=yes -o ConnectTimeout=5 o-okul-server 'printf ok'`, `ssh -o BatchMode=yes -o ConnectTimeout=5 uzman-hocam-server 'printf ok'`, `corepack pnpm prod:plan:check`, `corepack pnpm ops:check` | PASS/GAP ayrımı | Eski `o-okul-server` alias'ı çözülmüyor, `uzman-hocam-server` çalışıyor. Remote final/gap script default'ları `/root/o-okul` remote root'una çekildi; kalan kırmızı durum host çözümleme değil, eksik final artifact. |
| Faz 5 remote final artifact preflight | `PRODUCTION_EVIDENCE_SUMMARY_TARGET=file:///root/o-okul/artifacts/staging/release-summary.json LIVE_STATUS_EVIDENCE_TARGET=file:///root/o-okul/artifacts/staging/live-status.json PILOT_EVIDENCE_TARGET=file:///root/o-okul/artifacts/staging/pilot.json GO_LIVE_EVIDENCE_TARGET=file:///root/o-okul/artifacts/staging/go-live.json corepack pnpm prod:remote-evidence:check`, `corepack pnpm prod:evidence:templates:check`, `corepack pnpm prod:plan:check`, `corepack pnpm ops:check` | GAP/PASS ayrımı | Remote final checker artık `file://` hedefleri önce remote hostta `test -f` ile doğrular. Mevcut staging'de dört final artifact eksik: `release-summary.json`, `live-status.json`, `pilot.json`, `go-live.json`; statik/template guardrail'ler PASS. |
| Faz 5 remote release bundle gap audit | `corepack pnpm staging:remote-release-gaps:summary -- --host uzman-hocam-server --remote-root /root/o-okul --snapshot-dir artifacts/local/remote-staging-snapshot --gap-report-file artifacts/local/remote-staging-gap-report.json` | GAP, `NOT_RELEASE_EVIDENCE` | Remote API `/health` OK, remote repo güncel main checkout'u ve `ui-ux-redesign:evidence-generate` script'i mevcut. Snapshot'ta beklenmeyen dosya yok; 11 zorunlu dosya, 14 açık kapanış kalemi ve `release-summary-*.json` eksik. Eksikler içinde `reports/ui-ux-redesign.json`, UAT, first-gates, security-audit, deployment-region/rollback, identity/financial/admin MFA ve observability kanıtları var. |

UI/UX canlı yüzey kanıtı:

- `https://o-okul.com/login`, `/health` ve `/health/ready` canlı domain üzerinden 2xx dönmelidir.
- Web yüzeyi `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` ve `Content-Security-Policy` başlıklarını taşımalıdır.
- Web response içinde `X-Powered-By` görünmemelidir.
- `corepack pnpm ui-ux-redesign:live-surface:check -- --base-url https://o-okul.com` PASS dönmelidir; üretilen rapor `releaseEvidence=false` kalır ve provider kanıtı sayılmaz.
- Netgsm, S3 ve Sentry UI/UX canlı yüzey kapısının girdisi değildir.

Full production/go-live öncesi zorunlu canlı kanıt:

- GitHub `staging` environment içinde `GHCR_READ_TOKEN` ve `STAGING_EVIDENCE_ENV_B64` secret'ları gerçek değerlerle tanımlanır.
- Path/slug patch'i main'e push edilir ve remote checkout `/root/o-okul` altında fast-forward edilir; deploy dispatch öncesi aynı preflight yine çalıştırılır.
- `STAGING_EVIDENCE_ENV_B64`, remote `.env.local` içeriğinden türetilmez; `docs/evidence-templates/staging-evidence.env.example` özel bir kopyaya gerçek Netgsm, notification, Sentry, alert webhook, admin MFA, evidence target ve onay değerleriyle doldurulur, sonra `pnpm staging:evidence-env:check -- --env-file <private-file>` ile doğrulanıp helper üzerinden secret'a yazılır.
- GitHub staging environment eksikleri `corepack pnpm staging:github-env:gaps:summary -- --repo 4rmus/o-okul --environment staging --gap-report-file artifacts/local/staging-github-env-gap-report.json` ile izlenir; bu çıktı secret değerlerini yazdırmaz ve PASS kanıtı değildir.
- Remote bundle gap kapanışı `corepack pnpm staging:remote-release-gaps:summary -- --host uzman-hocam-server --remote-root /root/o-okul --snapshot-dir artifacts/local/remote-staging-snapshot --gap-report-file artifacts/local/remote-staging-gap-report.json` ile izlenir; bu komut PASS yerine geçmez, sadece eksik kanıt handoff'u üretir.
- Birleşik UI/UX readiness handoff'u `corepack pnpm ui-ux-redesign:release-readiness:summary -- --repo 4rmus/o-okul --environment staging --host uzman-hocam-server --remote-root /root/o-okul --summary-file artifacts/local/ui-ux-redesign-release-readiness-summary.json --github-gap-report-file artifacts/local/staging-github-env-gap-report.json --remote-snapshot-dir artifacts/local/remote-staging-snapshot --remote-gap-report-file artifacts/local/remote-staging-gap-report.json` ile üretilir; `releaseEvidence=false` kalır, PASS yerine geçmez.
- Birleşik readiness dosyası `corepack pnpm ui-ux-redesign:release-readiness:check -- --target artifacts/local/ui-ux-redesign-release-readiness-summary.json --max-age-minutes 30` ile şema/sıra/tazelik ve bağlı GitHub/remote gap raporları açısından doğrulanır; gerçek deploy/release öncesi aynı komut `--require-ready` ile çalışmalı ve blokaj kalırsa kırmızı dönmelidir.
- `gh workflow run staging-deploy.yml` öncesinde `corepack pnpm ui-ux-redesign:release-preflight -- --repo 4rmus/o-okul --environment staging --host uzman-hocam-server --remote-root /root/o-okul --summary-file artifacts/local/ui-ux-redesign-release-readiness-summary.json --github-gap-report-file artifacts/local/staging-github-env-gap-report.json --remote-snapshot-dir artifacts/local/remote-staging-snapshot --remote-gap-report-file artifacts/local/remote-staging-gap-report.json --max-age-minutes 30` çalıştırılır; bu komut taze summary üretmeden stale PASS kabul etmez.
- `pnpm prod:evidence:templates:check`
- `pnpm ui-ux-redesign:local-gates`
- `pnpm ui-ux-redesign:release-readiness:contract`
- `pnpm ui-ux-redesign:release-readiness:check:contract`
- `pnpm ui-ux-redesign:release-preflight:contract`
- `pnpm ui-ux-redesign:example-fixtures`
- `pnpm ui-ux-redesign:evidence-generate:contract`
- `pnpm staging:github-env:gaps:contract`
- `pnpm staging:remote-release-gaps:contract`
- `pnpm staging:evidence-env:secret:contract`
- `pnpm staging:ghcr-read-token:secret:contract`
- `UI_UX_REDESIGN_EVIDENCE_TARGET=<staging/prod artifact> pnpm ui-ux-redesign:evidence-check`
- `UI_UX_REDESIGN_EVIDENCE_OUTPUT=artifacts/staging/reports/ui-ux-redesign.json pnpm ui-ux-redesign:evidence-generate -- --env-file .staging-evidence.env`
- `UI_UX_REDESIGN_EVIDENCE_TARGET=file://$PWD/artifacts/staging/reports/ui-ux-redesign.json pnpm ui-ux-redesign:evidence-check`
- `pnpm prod:plan:check`
- Staging ortamında `pnpm live:onboarding:smoke`
- Staging ortamında `pnpm live:ui-worker:smoke`
- Staging/prod UAT için `pnpm uat:check`
- Görsel/screenshot paketi: `artifacts/ui-ux-redesign/<phase>/` altında PII içermeyen ekran kanıtı.

## Uygulama Dışı

- Landing page veya pazarlama redesign'ı.
- Online deneme, salon/oturma planı, OMR/foto optik okuma.
- Ödeme sağlayıcı, fatura, makbuz entegrasyonu.
