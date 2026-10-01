# O-Okul UI/UX Mimarisi Yeniden Tasarım Planı — "Berrak"

## Context

**Neden:** Uygulama işlevsel olarak olgun (87 route, Gate A–D kapalı) ama UI/UX katmanı dağınık:

- **Menü aşırı yüklü.** Kurum menüsünde 29 görünür + 7 gizli öğe var. Kişiler grubunda 6, Akademik grubunda 10 öğe var ve bunlar birbiriyle çakışıyor (`apps/web/app/(app)/_shared/navigation.ts:86-152`). Almanak planının "günlük işe ≤2 navigasyon kararı" hedefi karşılanmıyor.
- **Sınav zinciri parçalı.** Sınav → optik → rapor akışı 3 ayrı route'a ve 3 dev client sayfaya bölünmüş: `exams-page` 968, `parser-config-page` 1755, `reports-page` 1555 satır. Bu sayfalar arasında bağlamı yalnız `?examId=` taşıyor. Çalışma alanı (`/kurum/sinavlar/[examId]`) salt okunur, flag'i kapalı ve readiness adımları optik girişinde bitiyor (`apps/api/src/exam/exam.service.ts:242-287`).
- **Navigasyon verisi üç yerde.** Runtime nav, test tarafındaki route manifest ve elle tutulan breadcrumb haritası ayrı kaynaklar. Bu yüzden etiketler tutarsız ("Optik Okuma" / "Sonuç hazırlama", "Ödeme planları" / "Finans").
- **Shell ve portallar tek parça.** Shell tek bir 1210 satırlık client component. Portallar tek bir büyük bileşen ve `view` prop'u ile çalışıyor; özet sayfaları tüm panellerin birleşimi, gerçek bir "günlük özet" değil.
- **Bileşen tekrarı var:**
  - `portal-shell` yerel bir `MetricGrid` ile `packages/ui` sürümünü gölgeliyor.
  - `PortalStatePanel`, `EmptyState`/`LoadingState`'in işini tekrar yapıyor.
  - 9 badge sınıf grubu `StatusBadge`'i atlıyor.
  - 4 dosyada ham `<table>` kullanılıyor.
  - `Pagination` hiç kullanılmıyor; Toast yok.
- **CSS borcu büyük.** 11.389 satır global CSS var, bunun 8.018'i tek dosyada. Bu dosyada 7311. satırda başlayan bir "redesign katmanı" önceki kuralları yeniden tanımlıyor ve 134 selector çift tanımlı. 647 padding/gap/margin değeri ve 283 font-size değeri ham px; token kullanılmıyor.

**Kullanıcı kararları (2026-09-30):**
1. **Yeni görsel dil:** "Sakin ürün" yönü seçildi. Nötr yüzeyler, tek sans aile, 6–12 px radius, hafif gölge, indigo vurgu ve koyu tema olacak.
2. **Veli (GUARDIAN) tasarım dışı.** Veli ekranları `TRANSITIONAL_GUARDIAN` olarak olduğu gibi kalır; yalnız token değişimini pasif olarak alırlar.

**Hedef sonuç:**
- Kurum menüsü ~19 hub öğesine iner; her rota grubu tek menü girişi + sekmelerden oluşur.
- Sınav zinciri tek çalışma alanında, server'da hesaplanan 8 adımlı stepper ile ilerler.
- Portallar "bugün → 1–3 aksiyon → detay" günlük özetine geçer.
- Tek bir route manifest nav, breadcrumb, komut paleti ve hub sekmelerini üretir.
- Yeni "Berrak" görsel dili açık ve koyu tema ile gelir.

**Korunacak sabitler:**
- Tenant/RBAC davranışı, API sözleşmeleri (EX dilimi hariç) ve URL'ler (yalnız optik/rapor için yönlendirme eklenir).
- Erişilebilir isimler ve rol yapısı; 36 e2e spec buna dayanıyor.
- Karne'nin verisi ve hesaplanan değerleri. Görseli G10'da Berrak diliyle yeniden tasarlanır (DEC-20260930-04, DEC-20260613-04'ün yerini alır). Karne ve print ekranları tema dışında kalır ve daima açık kâğıt olarak çizilir.
- `Başarı %` birincil metrik (DEC-20260713-02).
- Arayüz yalnız Türkçe (DEC-20260529-06).
- Yeni UI kütüphanesi eklenmez: shadcn, Tailwind, Recharts, TanStack Table yok (UI/UX contract).

---

## 1. Görsel dil: "Berrak" teması

**Yaklaşım: token adları korunur, değerler değişir.** Renk kullanımının büyük kısmı zaten token'a bağlı (761 `var(--color-*)` kullanımı). Bu yüzden görsel değişimin çoğu küçük bir diff ile gelir. `paper/ink/rule/accent` adları kalır; `check-web-design-tokens.mjs` bu adları pinliyor ve toplu yeniden adlandırma gereksiz churn olur.

| Rol | Açık | Koyu |
|---|---|---|
| `--color-paper` (uygulama zemini) | oklch(98.3% 0.003 250) ≈ #F7F8FA | oklch(17% 0.010 265) |
| `--color-paper-raised` (kart/panel) | oklch(100% 0 0) | oklch(21% 0.012 265) |
| `--color-paper-muted` (hover, tablo başlığı) | oklch(96.5% 0.005 250) | oklch(25% 0.012 265) |
| `--color-ink` | oklch(21% 0.020 265) | oklch(96% 0.005 265) |
| `--color-ink-muted` (≥4.5:1 hedefi) | oklch(51% 0.030 260) | oklch(72% 0.015 265) |
| `--color-rule` / `-strong` / `-faint` | oklch(91/83/95% 0.008 255) | oklch(30/38/26% 0.012 265) |
| `--color-accent` (indigo-600) | oklch(51% 0.230 277) | oklch(67% 0.180 277) |
| `--color-accent-soft` | oklch(96% 0.018 272) | oklch(28% 0.060 277) |
| `--color-accent-secondary` (grafik karşılaştırma serisi, teal) | oklch(60% 0.118 185) | oklch(72% 0.110 185) |
| success / warning / danger | green-700 / amber-700 / red-600 eşdeğeri OKLCH + soft zeminler | 400 tonları + koyu soft zeminler |

**Tipografi:**
- Tek aile olarak IBM Plex Sans kullanılır; zaten yüklü, `latin-ext` ile Türkçe glif kapsamı var.
- `Source_Serif_4` importu `apps/web/app/layout.tsx`'ten kaldırılır. `--font-display` sans'a eşlenir.
- Ölçek 12 / 14 / 16 / 18 / 20 / 24 / 30 px.
- Kurum çalışma alanında gövde 14 px (yoğun), portal ve auth ekranlarında 16 px (rahat).
- Ağırlıklar 400 / 500 / 600. Tablolarda `tabular-nums` kuralı devam eder.

**Şekil ve derinlik:**
- Radius: kontrol 6, panel/kart 8, dialog 12 px; pill aynı kalır.
- Yeni gölge token'ları: `--shadow-xs` (kart: 1 px çizgi + çok hafif gölge), `--shadow-sm` (popover), `--shadow-lg` (dialog).

**Değişmeyenler:**
- 4 pt boşluk ölçeği ve motion token'ları.
- Odak halkası: 2 px `--color-focus` + 2 px offset.

**Koyu tema:**
- Seçim `<html data-theme="light|dark">` ile yapılır. `prefers-color-scheme` varsayılandır; kullanıcı tercihi localStorage'da saklanır.
- FOUC olmaması için tema, paint öncesi küçük bir inline script ile uygulanır.
- `.next-karne-sheet` ve print katmanları `color-scheme: light` ile sabitlenir. Bunlar zaten ham renk allowlist'inde olduğu için etkilenmez.
- `packages/ui/src/components/charts.tsx:91` token'ları `getComputedStyle` ile yalnız bir kez okuyor. Tema değişince yeniden okuması gerekir: `data-theme` üzerinde `MutationObserver` + chart `update()`.

**Yoğunluk:**
- `DataTable`'daki mevcut `density` prop'u kullanılır.
- Persona varsayılanları: kurum için `compact`, portallar için `comfortable`.

---

## 2. Bilgi mimarisi: hub modeli

**Kural:** Bir menü öğesi bir görev hub'ıdır. Kardeş kayıt sayfaları hub içinde **sekme** olarak görünür.

**URL değişmez ve klasör taşınmaz.** Sekmeleri shell, route manifest'teki `hub` alanından çizer (§3). Bu sayede route parity, e2e ve deep link'ler etkilenmez.

**Kurum paneli (29+7 öğe → 19 hub):**

| Grup | Menü öğesi (hub) | Hub sekmeleri (mevcut route'lar) |
|---|---|---|
| Bugün | Özet `/kurum` | — |
| Kişiler | Öğrenciler `/kurum/ogrenciler` | Liste · Portal erişimi (`ogrenci-portal-erisimi`) · Veli kayıtları (`veliler`, içerik değişmez) |
| | Personel `/kurum/ogretmenler` | Öğretmenler · Çalışanlar ve yetkiler (`calisanlar`) · Kullanıcı hesapları (`kullanicilar`) |
| Akademik | Sınıf yapısı `/kurum/siniflar` | Sınıflar · Seviyeler · Kampüsler |
| | Ders ve program `/kurum/dersler` | Dersler · Haftalık program (`program`) · Etütler |
| | Yoklama `/kurum/devamsizlik` | — |
| | Takvim `/kurum/akademik-takvim` | — |
| | Ödev ve materyal `/kurum/materyaller` | — |
| | Notlar `/kurum/notlar` | — |
| Sınav | Sınavlar `/kurum/sinavlar` | Çalışma alanına girer (§4) |
| | Raporlar `/kurum/raporlar` | Sınavlar arası rapor dizini; tek sınav raporu çalışma alanına taşınır |
| | Kazanımlar `/kurum/kazanimlar` | — |
| İletişim | Duyurular `/kurum/duyurular` | Duyurular · Mesaj şablonları (`sablonlar`, SMS flag'ine bağlı) |
| | Destek `/kurum/destek` | — |
| Finans | Ödeme planları `/kurum/finans` | — |
| Ayarlar | Kurulum · Lisans dönemleri · Rol önizleme | — |
| | Operasyon ve kanıt | 5 uzman sayfa sekme olur: Yedekleme · KVKK · Denetim · Güvenlik denetimi · Yayın hazırlığı (Sistem sağlığı ve Sistem izleme §10 kararıyla control-plane'e taşınır) |

- "Optik Okuma" menüden çıkar; `/kurum/optik` sınav seçiciye dönüşür (§4).
- Sistem (control-plane) menüsü aynı kalır: 5 öğe.

**Portallar:**
- Öğretmen ve öğrenci menüsü 7'şer öğe olarak kalır.
- `<1024 px` genişlikte alt sekme çubuğu gelir: Özet · Ödevler · Raporlar · Duyurular · Daha fazla. Kalan öğeler "Daha fazla" sayfasında listelenir.
- Veli portalı değişmez.

**Terminoloji:** Her route'un tek bir kanonik etiketi manifest'te tutulur. Nav, breadcrumb, sayfa başlığı ve komut paleti bu etiketi kullanır; smoke spec başlıkları da aynı kaynaktan doğrulanır.

---

## 3. Uygulama iskeleti (Shell v3) ve runtime route manifest (UI-02)

**Runtime manifest:**
- `apps/web/e2e-next/route-architecture-manifest.js` → `apps/web/src/route-manifest.js` (+ `.d.ts`) olarak taşınır ve genişletilir.
- Her kayıtta şu alanlar olur: `href, label, family, boundary, persona, capability, group, hub, iconName, hiddenFromRail, keywords`.
- Düz JS olarak kalır; böylece hem Next hem de node check script'leri (`check-route-manifest.mjs`, `check-web-architecture.mjs`) import edebilir. İkonlar shell'de `iconName → lucide` eşlemesiyle çözülür.
- `navigation.ts`'teki diziler, `staticBreadcrumbLabels`, `dynamicDetailParents` ve komut paletinin elle tutulan listesi manifest'ten türetilir. Elle tutulan kopyalar silinir.
- ADR-0005 güncellenir: kanonik kaynak smoke spec yerine runtime manifest olur. Smoke spec parity kontrolü devam eder.

**Shell bileşenleri:** `app-shell.tsx` (1210 satır) şu dosyalara bölünür:
- `ShellLayout`
- `NavSidebar`: 248 px; 1024–1279 px arasında 64 px ikon rail'e katlanır; grup aç/kapa tercihi mevcut localStorage davranışıyla korunur.
- `TopBar`: 56 px. Solda breadcrumb; ortada ⌘K arama tetikleyicisi; sağda kampüs/dönem bağlam seçiciler ve kullanıcı menüsü (persona değişimi, oturumlar, tema, çıkış).
- `CommandPalette`
- `HubTabs`
- `MobileDrawer`: mevcut focus trap / Escape / focus restore davranışı korunur.
- `PortalBottomNav`

Erişim mantığı (`canAccessPath`, `getHomePath`, `_shared/access.ts`) davranış değiştirmeden taşınır.

**ContextBar (UI-01):**
- Salt okunur `WorkContext` interaktif hale gelir: kampüs ve dönem seçimi URL param'ına yazılır (ADR-0006 URL state).
- Query key'ler bağlamı içerir; bağlam değişince ilgili query'ler invalidate edilir.
- Tenant seçimi login'de kalır.

**Sayfa anatomisi (tüm ekranlarda aynı):** `PageHeader` (başlık, açıklama, tek primary aksiyon, ikincil aksiyonlar) → `HubTabs` (varsa) → içerik.
- Çalışma alanı genişliği en fazla 1440 px.
- Form okuma genişliği 720 px.

---

## 4. Sınav çalışma alanı (EX-01 tamamlama + EX-02)

**Route yapısı:** Almanak §15.4'teki kanonik yapı izlenir; karar zaten alınmış.
- `/kurum/sinavlar/[examId]` — özet, bilgi, katılımcılar, cevap anahtarı
- `/optik/{duzen,yukleme,eslesmeyenler}`
- `/degerlendirme`
- `/rapor/{genel,ogrenciler,karne,ciktilar}`

**Ortak layout:** Mevcut boş `kurum/sinavlar/[examId]/layout.tsx` şunları gösterir:
- Sınav adı, tarih ve bağlam rozetleri
- 8 adımlı `Stepper`
- Son operasyon durumu
- "Sonraki önerilen iş" primary aksiyonu

**Server tarafı readiness:**
- `ExamService.workspace` (`apps/api/src/exam/exam.service.ts:242`) şu an `EXAM, ANSWER_KEY, PARTICIPANTS, PUBLISHED, OPTICAL_ENTRY` adımlarını hesaplıyor.
- Eklenecek adımlar: `OPTICAL_LAYOUT` (onaylı parser config), `IMPORT` (raw import kaydı), `MATCHING` (çözülmemiş karantina = 0), `EVALUATION` (terminal state), `REPORT` (READY snapshot).
- Güncellenecek yerler:
  - `packages/shared-types/src/domain.ts:2698` `ExamWorkspaceReadinessKey`
  - `openapi-contracts.ts`
  - `pnpm openapi:generate`
- Client readiness tahmini yapmaz; `exams-page` içindeki ikinci readiness hesabı silinir.

**Mevcut sayfaların bölünmesi:** Dev sayfalar yeni yazılmaz; mevcut sekme sınırlarından bölünür.
- `parser-config-page.tsx`'in 3 sekmesi → 3 optik route.
- `reports-page.tsx`'in 4 sekmesi → 4 rapor route.
- "Sınav ekle" modalı → `/kurum/sinavlar/yeni` değil, mevcut modal kalır. Kayıt sonrası kullanıcı çalışma alanına yönlenir.

**Uyum:**
- `next.config.mjs` `redirects()` içinde `has: [{type:"query", key:"examId"}]` ile iki yönlendirme:
  - `/kurum/optik?examId=X` → `/kurum/sinavlar/X/optik/duzen`
  - `/kurum/raporlar?examId=X` → `/kurum/sinavlar/X/rapor/genel`
- Param'sız `/kurum/optik` sınav seçici gösterir.
- `web.exam-workspace-v2` flag'i ADR-0008 cutover sürecine göre varsayılan açık olur, sonra kaldırılır.

---

## 5. Ana sayfalar ve portallar (TP-01, SP-01)

**Kurum özeti:**
- Mevcut `GET /me/institution-dashboard` read model'i kullanılır (`apps/api/src/me/me-institution-dashboard.service.ts`).
- Yerleşim: ≤3 dikkat öğesi → ≤4 metrik → son sınav/rapor durumu → duyurular.
- "Diğer kurum işlemleri" link duvarı kaldırılır; bu görevi komut paleti karşılar.

**Öğretmen portalı:**
- `teacher-portal-page.tsx` (1371 satır) `view` switch'inden route başına dosyalara bölünür.
- Özet sayfası: bugünkü dersler (ders başına "Yoklama al / Ödev ver" aksiyonu) → kontrol bekleyen ödevler → son sınav raporu.
- Yazma formları (yoklama/not/materyal) özet sayfasından çıkar, ders bağlamına (Ders akışı) taşınır.

**Öğrenci portalı:**
- Özet sayfası: bugün teslimi olan ödevler → son sınav `Başarı %` (bir önceki ile karşılaştırma) → duyurular.

**Veri:**
- Önce mevcut query'ler birleştirilir.
- Bir özet ekranı 3'ten fazla çağrı gerektirirse ADR-0007'ye göre persona read model endpoint'i eklenir (`/me/teacher-today`, `/me/student-today`).

---

## 6. Bileşen katmanı (`packages/ui`)

**Yeni veya taşınan bileşenler (yalnız ihtiyaç kadar):**
- `PageHeader`: `kurum/_shared/page-frame.tsx`'ten taşınır; ADR-0003'teki allowlist borcu kapanır.
- `HubTabs` (route tabanlı sekmeler)
- `Stepper`: setup wizard'daki satır içi stepper'ın yerine geçer.
- `ContextBar`
- `Toast`: tek bir `aria-live` bölgesi; dağınık 19 `role="status"` kullanımı buna geçer.

Genel amaçlı Drawer eklenmez; mobil drawer shell'e özel kalır.

**Konsolidasyon:**
- `portal-shell.tsx`'teki yerel `MetricGrid` ve `PortalStatePanel` silinir; yerine `MetricGrid`, `EmptyState` ve `LoadingState` kullanılır.
- `list-controls.tsx` pager'ı `Pagination` bileşenini kullanır.
- 9 badge sınıf grubu `StatusBadge`'e geçer.
- Karne dışındaki ham `<table>` kullanımları `DataTable`'a geçer; `karne-sheet` ve `outcome-net-table` donmuş kalır.
- 17 ham `<button>` `Button`'a geçer.

**Stil sahipliği:** `uh-*` primitive CSS'i `_styles/30-primitives.css`'e toplanır. Paket CSS taşımaz; bu mevcut karardır ve korunur.

---

## 7. CSS mimarisi ve kontrol ratchet'i

- `20-application-base.css` (8.018 satır):
  - 7311. satırdan sonraki "Professional redesign layer" önceki tanımlarla birleştirilir; 134 çift selector temizlenir.
  - Kalan kurallar route ailesine göre dosyalara bölünür: shell, registry, workflow/exam, report, portal, control-plane.
- Spacing, type ve radius token'larına geçiş toplu değil **ratchet** ile yapılır:
  - `check-web-design-tokens.mjs` ham px sayılarını kaydeder: padding/gap/margin 647, font-size 283, radius 41.
  - Sayı yalnız azalabilir.
  - Her dilim dokunduğu dosyada ham değerleri token'a çevirir.
- `10-marketing-base.css` (349 ham px, token kullanımı 0) landing ile birlikte Berrak token'larına geçer.
- `00-foundation.css`'teki `--space-2`/`--space-3` çakışması düzeltilir. `20-application-base.css:7317`'deki 1440 px sabiti `--workspace-max-width` token'ına bağlanır.
- **`check-web-ux-baseline.mjs` (5.279 satır) kaynak metni ve CSS selector'larını pinliyor, yani her görsel değişimde kırılır:**
  - Davranış güvencesi veren assert'ler korunur: a11y, metin, rol, güvenlik.
  - Yalnız CSS sınıf adı pinleyen `requireTokens("apps/web/app/globals.css", [...])` blokları, eşdeğer davranış kanıtıyla (golden, `ui-primitives-state-next.spec.ts`, token ratchet) değiştirilerek emekliye ayrılır.
  - Bu karar yeni bir `DEC` kaydı ile belgelenir. Doğrulama atlanmaz, yeri değişir.

---

## 8. Uygulama gate'leri (AGENTS.md formatı)

Her gate ayrı bir **stacked** feature branch'te yürür (`berrak/gN-<ad>`, bir önceki gate branch'inden açılır). Her gate'te tek yazıcı olur. Otomatik yürütme kuralları `docs/ui-ux-berrak-progress.md` dosyasında izlenir.

| Gate | Hedef | Sahip olunan yollar | Yasak yollar | Kabul |
|---|---|---|---|---|
| **G0** Plan ve karar kayıtları | Planı `docs/ui-ux-berrak-redesign-plan.md` olarak repoya koy. `docs/DECISIONS.md` içine DEC-20260930-01 (Berrak görsel dili), -02 (platform sağlık yüzeyleri), -03 (ux-baseline CSS pin'lerinin davranış kanıtına taşınması) yaz. ADR-0005'e "runtime manifest kanonik" notu ekle. `ui-ux-professionalization-contract.md` içine "Berrak ile değişti" bölümü ekle. | `docs/**` | kod | `pnpm agents:check`, `pnpm ui-ux-professionalization:completion:contract` |
| **G1** Platform sağlık yüzeyleri (§10) | Tenant düzleminden kaldır, control-plane'e taşı, regresyon assert'i ekle | `kurum/sistem-sagligi`, `kurum/gozlemlenebilirlik`, `sistem/sistem-sagligi`, `sistem/gozlemlenebilirlik`, `(app)/_shared/navigation.ts`, `next.config.mjs`, route manifest + smoke spec, `scripts/check-route-manifest.mjs`, ilgili e2e spec'ler (`governance-evidence-contract`, `system-tenant-contract`, `login-next`), `check-web-ux-baseline.mjs` pin'leri, güvenlik check script'i, `apps/api/src/metrics/*` (token guard), `docker/alloy/*` scrape config, `.env.example` | diğer API modülleri; secret değerlerinin commit'lenmesi | `route-manifest:check`, `web:architecture:check`, `security:audit:check`, ilgili e2e spec'ler; tenant admin olarak eski URL → yönlendirme; `SYSTEM_ADMIN` olarak canlı kartlar |
| **G2** Berrak token'ları | Açık/koyu token değerleri, font sadeleştirme, radius/gölge, `design.md` yeniden yazımı ("Theme — Berrak"), charts tema yeniden okuma | `tokens.css`, `design.md`, `apps/web/app/layout.tsx`, `_styles/00-foundation.css`, `scripts/check-web-design-tokens.mjs`, `packages/ui/src/components/charts.tsx`, goldens | API, DB, route dosyaları | `web:design-tokens:check`, `web:a11y:check`; goldens bilinçli yenilenir; karne golden **değişmez** |
| **G3** Runtime manifest (UI-02) | Nav, breadcrumb, palette ve hub için tek kaynak | `apps/web/src/route-manifest.js`, `(app)/_shared/navigation.ts`, `e2e-next/route-architecture-manifest.js`, `scripts/check-route-manifest.mjs`, `check-web-architecture.mjs` | görsel CSS | `route-manifest:check`, `web:architecture:check`; görsel fark yok |
| **G4** Primitive konsolidasyonu | §6 | `packages/ui/src/components/*`, `portals/_shared/portal-shell.tsx`, `src/list-controls.tsx`, dokunulan sayfalar | API, DB | `ui-primitives-state-next`, `data-table-mobile-contract-next`, `list-url-state-next` |
| **G5** Shell v3 + hub IA + ContextBar | §2–3 | `(app)/app-shell.tsx` → `(app)/_shell/*`, `packages/ui` (PageHeader, HubTabs, ContextBar), `_styles` shell dosyası | portal içerikleri, API | Kurum rail 1440 ve 414 drawer golden'ları; `persona-switch`, `app-context`, `a11y` spec'leri |
| **G6** Sınav çalışma alanı | §4 | `apps/api/src/exam/*`, `packages/shared-types`, OpenAPI, `kurum/sinavlar/[examId]/**`, `kurum/optik`, `kurum/raporlar`, `next.config.mjs` | karne, parser/scoring mantığı | API test + `openapi:generate`; `optik-workspace-contract`, `report-workspace-contract`, `gate-c-exam-workspace`; `karne:visual-contract:check`; UAT-KURUM-05/06 STAGING = `EXTERNAL_NOT_RUN` |
| **G7** Günlük özetler | §5 | `kurum/kurum-dashboard.tsx`, `portals/teacher-*`, `portals/student-*`, gerekirse `apps/api/src/me/*` | veli portalı | `teacher-portal-contract`, `student-guardian-portal-contract` (veli kısmı değişmeden geçer), 414 öğrenci aksiyon şeridi golden'ı |
| **G8** CSS temizliği + ratchet + koyu tema anahtarı | §1 koyu tema, §7 | `apps/web/app/_styles/*`, `globals.css`, `check-web-design-tokens.mjs`, `check-web-ux-baseline.mjs` (DEC-03 kapsamında) | davranış kodu | Ratchet sayıları düşer; koyu tema axe taraması 320–1440 px; karne/print açık kalır |
| **G9** Landing + auth reskin | Marketing CSS'i token'a geçer; auth ekranlarının yapısı aynı kalır | `app/page.tsx`, `iletisim`, `(auth)/*` stilleri, `10-marketing-base.css` | login/MFA/tenant akış mantığı | `login-next`, `marketing-context-next`, 1280×800 landing fold golden'ı |
| **G10** Karne yeniden tasarımı | Web karne sheet + worker PDF şablonu birlikte Berrak diliyle; A4, aynı snapshot → aynı sayılar, `Başarı %` birincil | `(app)/_shared/karne-sheet.tsx`, `outcome-net-table.tsx`, `apps/worker/src/jobs/report-pdf-render-job.ts`, karne script'leri, karne golden'ları, `docs/DECISIONS.md` | skorlama/snapshot mantığı | `--filter @o-okul/worker test`, `report-generation:smoke`, `karne:visual-contract:check` (yeni golden), `portal-report-panel-next`, `report-workspace-contract-next` |

**Bağımlılıklar:** G0 → G1 → … → G9 → G10 sırayla, stacked branch'lerle yürür. Tek-yazıcı kuralı ve golden çakışmalarından kaçınmak için paralel yazım yapılmaz. Read-only review ajanları (`tenant_security_reviewer`, `pr_gate_reviewer`) paralel çalışabilir.

**Kanıt sınıfları:** Her gate raporu `LOCAL_STATIC` / `LOCAL_TEST` / `CI` / `STAGING` sınıflarını ayrı raporlar. Staging ve prod kanıtı olmayan maddeler `EXTERNAL_NOT_RUN` veya `UNPROVEN` olarak kalır.

---

## 9. Doğrulama

- **Her gate:** `pnpm --filter @o-okul/web typecheck`, `pnpm web:architecture:check`, `pnpm route-manifest:check`, `pnpm web:design-tokens:check`, `pnpm web:ux-baseline:check`, `pnpm web:a11y:check`.
- **G6 ek olarak:** `pnpm --filter @o-okul/api typecheck && pnpm --filter @o-okul/api test`, `pnpm openapi:generate`, `pnpm karne:visual-contract:check`, `pnpm report-generation:smoke`.
- **Görsel:**
  - `ui-visual-qa-next.spec.ts` golden'ları yalnız ilgili gate'te ve diff incelemesiyle güncellenir.
  - Dev server preview'da 375 ve 1440 px ekran görüntüsü alınır; açık ve koyu tema ayrı kontrol edilir.
  - Route envanteri 320 / 375 / 414 / 768 / 1024 / 1440 px'te taşma kontrolünden geçer (`helpers/horizontal-overflow.ts`).
- **Uçtan uca yolculuk:** Kurum admin olarak sınav oluştur → çalışma alanında stepper ile optik yükle → eşleşmeyenleri çöz → rapor/karne. Bu akışta bağlam hiç kaybolmamalı ve her adım blocker ile sonraki aksiyonu göstermeli. Öğretmen olarak 375 px'te özet → ders → yoklama al.
- **Tam aday:** `pnpm run ci`.

---

## 10. Güvenlik kararı: platform sağlık ve izleme yüzeyleri (DEC-20260930-02)

**Bulgular:**
- `/kurum/sistem-sagligi` ve `/kurum/gozlemlenebilirlik` sayfaları `TENANT_OWNER` ve `TENANT_ADMIN` rollerine açık (`operation:*`, `observability:*`; `packages/shared-types/src/role-capabilities.ts:22-50`).
- Bu sayfalar tarayıcıdan kimlik doğrulamasız olarak `/health`, `/health/ready` ve `/metrics` çağırıyor (`system-health-page.tsx:342-347`, `observability-page.tsx:478-483`).
- `/metrics` API tarafında guard'sız (`apps/api/src/metrics/metrics.controller.ts`). İçeriği **tüm tenant'ların** toplam HTTP trafiği ve BullMQ kuyruk sayıları, yani platform verisi. ID'ler normalize edildiği için PII içermiyor.
- Prod'da Traefik API router'ı yalnız `/api` ve `/health` yollarını API'ye yönlendiriyor (`docker-compose.traefik.yml:72`). `/metrics` web router'ına düşüyor ve Next rewrite'ları yalnız development'ta tanımlı (`next.config.mjs:7-15`).
- Sonuç olarak **bugün aktif bir sızıntı yok**, ama üç sorun var:
  1. Metrik kartı prod'da her zaman hata gösteriyor.
  2. Koruma tek bir proxy kuralına bağlı; derinlemesine savunma yok.
  3. ADR-0010'daki control-plane mantıksal ayrımı ihlal ediliyor.
- Platform operatörleri zaten Grafana/Prometheus kullanıyor (`docker/grafana/dashboards/api-overview.json`).

**Karar (P2, sınır ve bozuk yüzey):**
1. `/kurum/sistem-sagligi` ve `/kurum/gozlemlenebilirlik` tenant düzleminden **emekliye ayrılır**:
   - page, bileşen, nav öğesi, manifest ve smoke kayıtları silinir;
   - `check-route-manifest.mjs` emekli route listesine eklenir;
   - eski URL'ler `next.config.mjs` `redirects()` ile `/kurum/operasyon-ve-kanit` adresine yönlenir.
2. `/sistem/sistem-sagligi` statik kontrol listesi yerine canlı `/health` ve `/health/ready` kartlarını gösterir. Bu kod kurum sayfasından **taşınır**; metrik kartı taşınmaz. Yalnız `SYSTEM_ADMIN` erişir.
   - `/sistem/gozlemlenebilirlik` kurum sayfasındaki izleme kabul maddelerini (uyarı ve hata izleme denemeleri) alır.
   - Metrikler için Grafana esas kaynaktır. Yeni metrik endpoint'i **eklenmez**.
3. Kullanılmayan dev rewrite `/metrics` → API silinir.
4. `pnpm security:audit:check` veya `ops:check` içine regresyon assert'i eklenir: Traefik API router kuralı ve Next rewrite'ları `/metrics` yolunu dışarı açmamalı.
5. **Derinlemesine savunma (kullanıcı onayladı, G1'de yapılır):** API'de `/metrics` için `METRICS_SCRAPE_TOKEN` bearer guard'ı eklenir. Prometheus/Alloy scrape config'i güncellenir ve secret staging'e yazılır.

## 11. Notlar

- **Linux golden'ları.** Linux golden'larının üretimi CI veya docker ortamı gerektirir; darwin ile birlikte güncellenmeli.
- **Veli portalı.** Değişmeyecek, ama G2 token değişimini pasif olarak alır. `student-guardian-portal-contract` bu nedenle G2'de de koşulur.
