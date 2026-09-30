# Berrak UI/UX Yeniden Tasarım — İlerleme Kaydı

Plan: `docs/ui-ux-berrak-redesign-plan.md`. Her gate stacked branch'te yürür
(`berrak/gN-<ad>`), tek yazıcı kuralı geçerlidir. Kanıt sınıfları ayrı raporlanır:
`LOCAL_STATIC`, `LOCAL_TEST`, `CI`, `STAGING`, `PRODUCTION`, `EXTERNAL_NOT_RUN`, `UNPROVEN`.
Local PASS staging kanıtı değildir. Secret değerleri bu dosyaya yazılmaz; yalnız ad ve saklama yeri.

## Ortam notları

- `.codex/config.toml` kullanıcıya ait commit'lenmemiş değişiklik taşır (`network_access = true`).
  Bu nedenle çalışma ağacında `pnpm agents:check` kırmızıdır; committed config ile temiz worktree'de
  koşulur ve PASS verir. Dosya hiçbir gate'te commit'lenmez.
- Docker bu makinede yok: Linux golden'ları `EXTERNAL_NOT_RUN`.

## Gate durumu

| Gate | Branch | Durum | PR |
|---|---|---|---|
| G0 Plan ve karar kayıtları | `berrak/g0-plan-kararlar` | Tamam | 4rmus/o-okul#109 |
| G1 Platform sağlık yüzeyleri | `berrak/g1-platform-saglik` | Tamam | 4rmus/o-okul#110 |
| G2 Berrak token'ları | `berrak/g2-tokenlar` | Tamam | 4rmus/o-okul#111 |
| G3 Runtime route manifest | `berrak/g3-route-manifest` | Tamam | 4rmus/o-okul#112 |
| G4 Primitive konsolidasyonu | `berrak/g4-primitive` | Tamam | 4rmus/o-okul#113 |
| G5 Shell v3 + hub IA + ContextBar | `berrak/g5-shell` | Tamam | draft PR |

## G0 — Plan ve karar kayıtları

- Hedef: Planı `docs/ui-ux-berrak-redesign-plan.md` olarak repoya koy; DEC-20260930-01/-02/-03
  yaz; ADR-0005'e runtime manifest notu ekle; UI/UX sözleşmesine "Berrak ile değişti" bölümü ekle.
- Sahip olunan yollar: `docs/**`.
- Yasak yollar: kod (`apps/**`, `packages/**`, `scripts/**`).
- Kabul: `pnpm agents:check`, `pnpm ui-ux-professionalization:completion:contract`.
- Doğrulama: yukarıdakiler + `pnpm ui-ux-redesign:local-gates`, `pnpm route-manifest:check`.

### G0 kanıt

| Sınıf | Sonuç |
|---|---|
| `LOCAL_STATIC` | PASS: `pnpm agents:check` (committed config, temiz worktree), `pnpm ui-ux-professionalization:completion:contract`, `pnpm route-manifest:check` (87 route) |
| `LOCAL_TEST` | PASS: `pnpm ui-ux-redesign:local-gates` (visual QA 31/31) |
| `CI` | PR CI'da izlenir |
| `STAGING` / `PRODUCTION` | `EXTERNAL_NOT_RUN` (yalnız doküman) |

Review (`o-okul-pr-review`, read-only): yalnız doküman değişikliği; P0/P1 bulgu yok.
Görsel kanıt: ekran değişmedi, gerekmez.

## G1 — Platform sağlık yüzeyleri (§10, DEC-20260930-02)

- Hedef: `/kurum/sistem-sagligi` ve `/kurum/gozlemlenebilirlik` tenant düzleminden emekli ve
  `/kurum/operasyon-ve-kanit`'e yönlenir; `/sistem/sistem-sagligi` canlı `/health` + `/health/ready`
  kartlarını alır (metrik kartı yok); `/sistem/gozlemlenebilirlik` izleme kabul maddelerini alır;
  `/metrics` dev rewrite'ı silinir; `/metrics` için `METRICS_SCRAPE_TOKEN` bearer guard'ı ve
  Prometheus bearer scrape; regresyon assert'i.
- Sahip olunan yollar: `kurum/sistem-sagligi`, `kurum/gozlemlenebilirlik`, `sistem/sistem-sagligi`,
  `sistem/gozlemlenebilirlik`, `_shared/navigation.ts`, `next.config.mjs`, route manifest + smoke
  spec, `scripts/check-route-manifest.mjs`, ilgili e2e spec'ler, `check-web-ux-baseline.mjs` pin'leri,
  `scripts/check-docker-config.mjs` (statik güvenlik assert'i), `apps/api/src/metrics/*`,
  `apps/api/src/app.module.ts` (middleware istisnası), Traefik/observability compose,
  `docker/prometheus/prometheus.yml`, `.env.example`, `staging-deploy.yml` ve bağlı staging/prod env
  sözleşme script'leri.
- Yasak yollar: diğer API modülleri; secret değerleri.
- Kabul: `route-manifest:check`, `web:architecture:check`, `docker:check` (Traefik/Next `/metrics`
  assert'i), `security:audit:check`, ilgili e2e spec'ler.

### G1 notları

- Plan §10 düzeltmesi: metrikler prod'da `/api/v1/metrics` altındaydı ve Traefik `/api` kuralıyla
  dışarı açıktı. Guard + Traefik `!PathPrefix(`/api/v1/metrics`)` ile kapatıldı (DEC-20260930-02'ye
  işlendi). Statik assert `scripts/check-docker-config.mjs` içinde (`pnpm run ci` → `docker:check`);
  `security:audit:check` bir kanıt-dosyası doğrulayıcısı olduğu için statik assert oraya konmadı.
- `RequestContextMiddleware` yalnız `GET metrics` için hariç tutuldu; scrape bearer'ı kullanıcı
  JWT'si olarak doğrulanmıyor. Production'da token yoksa guard fail-closed.
- Secret: `STAGING_METRICS_SCRAPE_TOKEN` — GitHub `staging` environment secret'ı (`openssl rand -hex 32`
  ile üretildi, `gh secret set` ile yazıldı). Deploy bunu alertmanager secret arşiviyle taşır,
  Prometheus için `prometheus_secrets` volume'üne ve API için uzak `.env.release`
  (`METRICS_SCRAPE_TOKEN`, mod 600) içine yazar.
- Config: `METRICS_SCRAPE_TOKEN` (`.env.example`, `docker-compose.yml` api env, prod env sözleşmesi).
- Route sayısı 87 → 85 (iki emekli route); smoke spec ve UX baseline sayıları buna göre güncellendi.
- Önceden var olan kırmızı: `login-next` içinde "kurum paneline geçer" (komut paleti "denetim"
  araması) ve "rol portalları bağlı kişi verisini gösterir" (çıkışta `/giris`) `main`'de de yerelde
  kırmızı; G1 değişikliğinden bağımsız. G1'in değiştirdiği adımlar geçiyor.

### G1 kanıt

| Sınıf | Sonuç |
|---|---|
| `LOCAL_STATIC` | PASS: `route-manifest:check` (85 route), `web:architecture:check`, `web:ux-baseline:check`, `docker:check` (+ negatif senaryo: Traefik kuralı geri alınınca kırmızı), `ops:check`, `prod:evidence:templates:check`, `check-prod-env --contract .env.example`, `security:audit:check` (örnek kanıt), `openapi:generate`, web/api typecheck |
| `LOCAL_TEST` | PASS: `@o-okul/api test` (1275), governance + system-tenant + route-family smoke + app-context e2e, `ui-ux-redesign:local-gates` (visual QA 31/31) |
| `CI` | PR CI'da izlenir |
| `STAGING` | `EXTERNAL_NOT_RUN` (secret yazıldı; deploy son gate sonunda) |
| `PRODUCTION` | kapsam dışı |

Görsel kanıt: `artifacts/ui-ux-redesign/berrak/g1/{before,after}/` (375/1440, açık tema).

Review (`o-okul-pr-review` + `tenant_security_reviewer`, read-only): P0/P1 yok. İki P2 gate içinde
düzeltildi (release env dosyası `umask 077` ile oluşturulur; token karakter kümesi
`[A-Za-z0-9._~-]{32,}`). Açık kalan düşük önemli bulgular:
- P2: bu değişiklikten önceki bir API image'ına rollback edilirse eski image scrape bearer'ını JWT
  sanıp 401 döner; rollback süresince metrikler kör kalır.
- P3: Traefik `PathPrefix` büyük/küçük harf duyarlı; `/api/v1/Metrics` API'ye ulaşır (guard 401
  döner, yalnız bir savunma katmanı eksik).
- P3: `NODE_ENV` production dışı ve token yoksa guard açık kalır (Traefik hariç tutması geçerli).
- Test boşlukları: redirect status'ü (`permanent: false`) için test yok; controller seviyesinde
  prod+token-yok testi yok (fonksiyon testi var).

## Ortak CI notları

- Gate B measurement baseline (`docs/measurement-baselines/gate-b-local-synthetic.json`) web kaynak
  ağacının özetini taşır; her gate'te `pnpm web:measurement-baseline:collect` ile yenilenir. G1 CI ilk
  denemede yalnız bu nedenle kırmızıydı (düzeltildi).
- Karne golden'ı (`student-report-card-1024-*`) G10'a kadar değişmez. G2'den itibaren sayfa başlık
  fontu değiştiği için karnenin sayfadaki y konumu alt-piksel kaydı (71.5625 → 72.078); karne alt
  ağacının hesaplanmış stilleri G1 ile birebir aynıdır (369 öğe, fark yalnız html/body). Darwin farkı
  %0.5 eşiğin altında (2276 px) kalırken Linux CI'da eşiği aşar (4669 px). Bu nedenle G2–G9 PR'larında
  CI `karne:visual-contract:check` adımında kırmızıdır ve sonraki CI adımları koşmaz; bu gate'lerin
  kanıtı `LOCAL_*` sınıfındadır. Karne ve Linux golden'ları G10'da yeniden üretilir (CI Linux çıktısı).
- Linux golden'ları: docker yok. Final branch'te CI Linux Playwright çıktısından üretilecek.

## G2 — Berrak token'ları (§1)

- Hedef: açık/koyu token değerleri, font sadeleştirme (`Source_Serif_4` kaldırıldı), radius/gölge,
  `design.md` "Theme — Berrak", chart'ların tema değişiminde token'ları yeniden okuması.
- Sahip olunan yollar: `tokens.css`, `design.md`, `.hallmark/log.json`, `apps/web/app/layout.tsx`,
  `apps/web/app/next-font.d.ts`, `_styles/00-foundation.css`, yeni `_styles/01-theme-dark.css`,
  `_styles/70-almanac-foundation.css` (alias/gölge), `_styles/73-almanac-report.css` (karne geometrisi
  sabitleme), `globals.css` (import), `scripts/check-web-design-tokens.mjs`,
  `scripts/check-web-token-storage.mjs` (tema anahtarı), `packages/ui/src/components/charts.tsx`,
  darwin golden'ları.
- Yasak yollar: API, DB, route dosyaları; karne golden'ı.
- Kabul: `web:design-tokens:check`, `web:a11y:check`, golden'lar bilinçli yenilenir, karne golden
  değişmez.

### G2 notları

- Token adları korundu, yalnız değerler değişti. `--color-paper-raised` plandaki `oklch(100% 0 0)`
  yerine `oklch(99.9% 0.001 250)`: tasarım check'i saf beyaz/siyahı yasaklıyor, check gevşetilmedi.
- Semantik renkler AA için planın 700/600 tonlarından biraz koyu: danger `oklch(52% 0.215 27)`,
  success `oklch(50% 0.130 150)`, warning `oklch(52% 0.140 49)`. İlk değerle danger metni soft zeminde
  4.36:1 kalıyordu (axe, `system-tenant-contract` 390 px). Tüm semantik çiftler açık ve koyuda ≥ 4.5:1.
- `--text-display` landing'e özel olduğu için G9'a kadar eski değerinde.
- Koyu tema: `:root[data-theme="dark"]`; tercih `o-okul-theme` anahtarında, paint öncesi inline
  script. Karne ve `@media print` için `BERRAK-LIGHT-RESET` bloğu tokens.css değerleriyle birebir
  aynı olmak zorunda (check'e negatif senaryosuyla eklendi). Alias token'lar `:root, .next-karne-sheet`
  üzerinde çözülür, böylece karne koyu temada da açık kâğıttır.
- Karne geometrisi (radius/gölge) G10'a kadar karne kapsamında eski değerlere sabitlendi; karne
  golden'ı değişmedi (`karne:visual-contract:check` PASS, png dokunulmadı).
- G8'e not: koyu temada üst çubukta sıcak ton kalıntısı; koyu tema axe taraması G8 kapsamı.

### G2 kanıt

| Sınıf | Sonuç |
|---|---|
| `LOCAL_STATIC` | PASS: `web:design-tokens:check` (+ negatif: sıfırlama sapması yakalanır), `web:token-storage:check`, `web:ux-baseline:check`, `web:architecture:check`, `route-manifest:check`, web typecheck, ui build |
| `LOCAL_TEST` | PASS: `web:a11y:check`, `ui-ux-redesign:local-gates` (student-guardian-portal dahil ux-contract ve visual QA 31/31), `karne:visual-contract:check` |
| `CI` | PR CI; Linux golden'ları CI `actual` çıktısından alınacak |
| `EXTERNAL_NOT_RUN` | Linux golden'ları (docker yok) |

Değişen darwin golden'ları (11): kurum rail 1440, login 414, rapor durum 1440, devamsızlık 414,
parola 414, dashboard 1440, landing 1280, rapor 1440, öğrenci detay 768, öğrenci portal 414,
öğrenci listesi 414. Karne golden'ı değişmedi.

Görsel kanıt: `artifacts/ui-ux-redesign/berrak/g2/before` (açık) ve `after` (açık + koyu), 375/1440.

Review (read-only): API/DB/yetki değişikliği yok. Token-storage istisnası yalnız tema tercihi;
inline script CSP'de izinli (`script-src 'unsafe-inline'`). P0/P1 yok.

## G3 — Runtime route manifest (UI-02, §3)

- Hedef: nav, breadcrumb, komut paleti ve hub için tek kaynak.
- Sahip olunan yollar: `apps/web/src/route-manifest.js` (+ `.d.ts`; `e2e-next/route-architecture-manifest.*`
  buraya taşındı), `(app)/_shared/navigation.ts`, `(app)/app-shell.tsx` (palette aksiyonları),
  `scripts/check-route-manifest.mjs`, `scripts/check-web-ux-baseline.mjs` (pin taşıma),
  `scripts/almanac-foundation-digest.mjs` (dosya yolu), ADR-0005.
- Yasak yollar: görsel CSS.
- Kabul: `route-manifest:check`, `web:architecture:check`; görsel fark yok.

### G3 notları

- Manifest kayıtları: `href, label, group, iconName, capability, persona, hiddenFromRail, hub,
  keywords, breadcrumbLabel, detailParent, requiresSms, operationEvidence`; `family/boundary`
  `resolveRouteArchitecture(href)` ile aynı dosyadan gelir. `hub` değerleri §2 tablosundan (G5 kullanır).
- `navigation.ts` yalnız `iconName → lucide` eşlemesi ve menü şekli üretir; dışa aktarımları aynı
  kaldı. `staticBreadcrumbLabels`, `dynamicDetailParents` ve komut paleti aksiyonları manifestten.
- `check-route-manifest.mjs`: manifest route'ları page envanterinde, tekil, hub kökleri geçerli,
  palette hedefleri mevcut; `navigation.ts`/`app-shell.tsx` içinde elle href/breadcrumb/palette
  girdisi yasak.
- UX baseline'daki capability/persona pin'leri aynı anlamla manifest satırlarına taşındı
  (`audit:read` yasağı dahil).
- G2 tamamlayıcısı: karne kapsamında Almanac primitive renkleri sabitlendi (`KARNE-ALMANAC-PINS`,
  check'e eklendi); koyu temada da karne donmuş açık değerlerle çizilir. Print sıfırlaması tek blok.
- Ayrı iş olarak işaretlendi: `login-next` içindeki iki test `main`'de de kırmızı (CI alt kümesinde yok).

### G3 kanıt

| Sınıf | Sonuç |
|---|---|
| `LOCAL_STATIC` | PASS: `route-manifest:check`, `web:architecture:check`, `web:ux-baseline:check`, `web:design-tokens:check`, `web:measurement-baseline:check`, lint, web typecheck |
| `LOCAL_TEST` | PASS: app-context, route-family smoke (90), a11y, visual QA 31/31 (golden değişmedi), `web:auth-contract:check` (17), `ui-ux-redesign:local-gates` |
| `CI` | Beklenen: karne Linux alt-piksel nedeniyle kırmızı (ortak not) |

Görsel kanıt: görsel fark yok (visual QA golden'ları güncellenmeden geçti); ek ekran görüntüsü gerekmedi.
Review (read-only): yetki mantığı değişmedi; capability/persona alanları birebir taşındı ve pin'lendi. P0/P1 yok.

## G4 — Primitive konsolidasyonu (§6)

- Hedef: yerel primitive kopyalarını `packages/ui` bileşenlerine bağlamak.
- Sahip olunan yollar: `packages/ui/src/components/{toast,pagination}.tsx`, `packages/ui/src/index.ts`,
  `portals/_shared/portal-shell.tsx`, `portals/guardian-portal-page.tsx` (yalnız import adı),
  `src/list-controls.tsx`, `_shared/error-booklet-table.tsx` (yeni), rapor/öğrenci detay sayfaları,
  `evidence-panels.tsx`, `parser-config-page.tsx`, `employees-page.tsx`, `revealable-phone.tsx`,
  `exams-page.tsx`, `app/providers.tsx`, `_styles/30-primitives.css` (yeni), responsive/app CSS,
  ilgili e2e seçicileri ve UX baseline pin'leri.
- Yasak yollar: API, DB.
- Kabul: `ui-primitives-state-next`, `data-table-mobile-contract-next`, `list-url-state-next`.

### G4 notları

- `PortalStatePanel` çağrı yerleri korundu; içi `LoadingState` / `EmptyState` (durum etiketi `hint`)
  ile yeniden kuruldu, `Skeleton` kopyası kalktı. Veli ekranı içeriği değişmedi.
- Portal özet grid'i `@o-okul/ui` `MetricGrid`'ini gölgelemesin diye `PortalMetricGrid` adını aldı
  (zaten `MetricGrid` + `MetricCard` üzerine kurulu adaptör). UX pin'i gölgeleme dönüşünü yasaklar.
- Liste pager'ı `Pagination` (role=navigation) kullanır; `Pagination`'a opsiyonel `previousLabel`/
  `nextLabel` eklendi, liste bağlamında ikonlar korunur (erişilebilir adlar aynı). Mobilde tek satır.
- Rozetler: `next-reference-badge` (2 kullanım) ve çalışanlar sayfasındaki çip `StatusBadge`'e geçti;
  kullanılmayan `next-permission-badge` CSS'i silindi. Envanterdeki diğer "rozet" sınıfları ya
  `StatusBadge` kapsayıcısı ya da durum değil (kurs çipleri, adım numarası) — dokunulmadı.
- Ham tablolar: iki kopya `ErrorBookletTable` tek paylaşılan `DataTable` bileşenine indi. DataTable'ın
  kaydırma bölgesi adı kapsamsız `name: "Hata kitapçığı"` eşleşmesine takıldığı için o seçiciler
  `exact: true` ile sıkılaştırıldı (zayıflatma değil).
- Ham butonlar 17 → 15 (telefon göster/gizle, sınav katılımcı satır aksiyonu `Button`); kalanlar
  `SegmentedControl` çocukları veya app-shell (G5).
- Toast: `ToastProvider` + `useToast`, tek `aria-live="polite"` bölgesi (role eklenmedi; kapsamsız
  `getByRole("status")` testlerini bozmamak için). Çalışan oluşturma/davet bildirimleri toasta geçti;
  e2e'ye toast assert'i eklendi. Diğer `role="status"` kullanımları yükleme/ilerleme veya form içi
  durum olduğu için yerinde kaldı.
- Stepper G6'ya bırakıldı: kurulum sihirbazının `tablist` rolleri e2e sözleşmesidir.
- Test ortamı notu: Playwright webServer yalnız `.next/BUILD_ID` yoksa build alır; `web typecheck`
  `.next`'i siler. Doğrulamalar her kod değişikliğinden sonra typecheck → e2e sırasıyla koşuldu.

### G4 kanıt

| Sınıf | Sonuç |
|---|---|
| `LOCAL_STATIC` | PASS: `web:ux-baseline:check` (ham buton 15), `web:design-tokens:check`, `route-manifest:check`, lint, typecheck, measurement baseline |
| `LOCAL_TEST` | PASS: `ui-primitives-state-next`, `data-table-mobile-contract-next`, `list-url-state-next` (32), employee-access (toast), portal sözleşmeleri + route smoke (112), report-workspace, visual QA 31/31, `ui-ux-redesign:local-gates` |
| `CI` | Beklenen: karne Linux alt-piksel (ortak not) |

Görsel kanıt: `artifacts/ui-ux-redesign/berrak/g4/{before,after}` — öğrenci listesi, çalışanlar,
öğretmen portalı hata durumu; açık + koyu, 375/1440. Golden değişmedi (pager satır düzeni korundu).
Review (read-only): yetki/veri akışı değişmedi; toast bölgesi PII taşımaz (sabit bildirim metinleri). P0/P1 yok.

## G5 — Shell v3 + hub IA + ContextBar (§2–3)

- Hedef: menüde 19 hub, hub sekmeleri, interaktif çalışma bağlamı, shell bölme.
- Sahip olunan yollar: `app-shell.tsx` → `(app)/_shell/{command-palette,nav-sidebar,top-bar,push-devices,portal-bottom-nav}.tsx`,
  `packages/ui` (`PageHeader`, `HubTabs`, `ContextBar`), `(app)/_shared/page-frame.tsx` (PageFrame buraya taşındı;
  `kurum/_shared/page-frame.tsx` re-export), `_shared/navigation.ts`, `src/route-manifest.js` (menuLabel/tabLabel),
  `_styles/30-primitives.css` ve shell CSS'i, `check-web-architecture.mjs`, `check-web-ux-baseline.mjs`,
  `check-route-manifest.mjs`, sidebar'a dayanan e2e seçicileri.
- Yasak yollar: portal içerikleri, API.
- Kabul: kurum rail 1440 ve 414 drawer golden'ları; `persona-switch`, `app-context`, `a11y`.

### G5 notları

- Rail: her hub tek girdi; girdi kullanıcının erişebildiği ilk hub üyesine gider (hub köküne yetkisi
  olmayan ama sekmesine yetkisi olan kullanıcı erişimi kaybetmez) ve tüm hub üyelerinde aktif görünür.
  Kurum menüsü 19 girdi: Özet · Öğrenciler, Personel · Sınıf yapısı, Ders ve program, Yoklama, Takvim,
  Ödev ve materyal, Notlar · Sınavlar, Raporlar, Kazanımlar · Duyurular, Destek · Ödeme planları ·
  Kurulum, Lisans dönemleri, Rol önizleme, Operasyon ve kanıt. "Optik Okuma" menüden çıktı (palette'te
  duruyor; G6'da sınav çalışma alanına bağlanır).
- Menü etiketleri (`menuLabel`) bilinçli terminoloji birleştirmesidir; sayfa başlıkları, breadcrumb ve
  komut paleti route etiketlerini korur (e2e başlık sözleşmeleri değişmedi).
- `HubTabs` route tabanlı link listesidir (`nav` + `aria-current`), tablist değil; yetkiye göre süzülür,
  ≥2 erişilebilir üye varsa çizilir. `PageFrame` artık `(app)/_shared` katmanında: ADR-0003
  allowlist'inden `page-frame` çıktı (kalan: `evidence-panels`, `operation-summary`).
- ContextBar: kampüs/dönem `campusId`/`termId` URL parametresine yazılır (sayfalama sıfırlanır);
  bu parametreleri okuyan finans ve destek listelerinin query key'leri değişir ve yeniden sorgular.
  Seçenekler tembel yüklenir (URL'de bağlam varsa ya da seçiciye odaklanınca) — her kurum sayfasında
  gereksiz istek yok. Erişilebilir adlar "Çalışma kampüsü"/"Çalışma dönemi" (sayfa filtreleriyle çakışmaz).
- Portal alt sekme çubuğu (<1024 px, öğretmen/öğrenci): Özet · Ödevler · Raporlar · Duyurular ·
  Daha fazla. "Daha fazla" yeni route yerine mevcut mobil çekmeceyi açar (sapma: route envanteri sabit).
- Shell sürümü `data-shell-version="v3"`.
- Açık madde (düşük): 1024–1279 px'te 64 px ikon rail uygulanmadı. Rail'deki push-cihaz paneli,
  persona/çıkış metinli kontrolleri ayrı tasarım ister ve karne golden'ının 1024 px konumunu kaydırır;
  ayrı dilim olarak kaldı. Üst çubuk ayrı "kullanıcı menüsü" açılır listesine çevrilmedi; persona ve
  çıkış görünür butonlar olarak kaldı (e2e çıkış akışları buna dayanıyor), tema anahtarı G8'de buraya eklenir.
- `login-next` yardımcı `clickSidebarLink` hub modelini manifestten okur (hub girdisi → sekme; menüden
  çıkan route → palette). Büyük kurum yolculuğu yerelde 4954. satıra kadar geçiyor; oradaki
  `/kurum/denetim` beklentisi, önceden var olan palette "Denetim" hatasıyla aynı kök nedendir (ayrı iş).

### G5 kanıt

| Sınıf | Sonuç |
|---|---|
| `LOCAL_STATIC` | PASS: `web:ux-baseline:check` (shell pin'leri `_shell/*` birleşimine uygulanır), `web:architecture:check`, `route-manifest:check`, `web:token-storage:check`, `web:design-tokens:check`, lint, typecheck, measurement baseline |
| `LOCAL_TEST` | PASS: `ui-ux-redesign:local-gates` (ux-contract 87, auth-contract, visual QA 31/31), persona-switch, app-context, a11y, employee-access (hub → sekme), portal sözleşmeleri, list-url-state |
| `CI` | Beklenen: karne Linux alt-piksel (ortak not); yeni `institution-shell-drawer-414` Linux golden'ı final gate'te |

Golden'lar (darwin, bilinçli): dashboard 1440, rail 1440, öğrenci listesi 414, devamsızlık 414, öğrenci
detay 768, rapor 1440 + yeni `institution-shell-drawer-414`. Karne golden'ı değişmedi.
Görsel kanıt: `artifacts/ui-ux-redesign/berrak/g5/{before,after}` (dashboard, Personel hub'ı, öğretmen
portalı alt çubuğu; açık + koyu; 375/1440).
Review (read-only): rail temsilcisi capability süzgecinden geçmiş öğelerden seçilir; hub sekmeleri de
aynı `canAccessNavigationItem` ile süzülür (yalnız frontend ön kontrolü, backend guard'ları değişmedi).
ContextBar yalnız kimlikleri URL'e yazar, PII taşımaz. P0/P1 yok.
