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
| G5 Shell v3 + hub IA + ContextBar | `berrak/g5-shell` | Tamam | 4rmus/o-okul#114 |
| G6 Sınav çalışma alanı | `berrak/g6-sinav-calisma-alani` | Tamam | 4rmus/o-okul#115 |
| G7 Günlük özetler | `berrak/g7-gunluk-ozet` | Tamam | draft PR |

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
| `CI` | PASS: GitHub CI run 36780621229 (`a7c209c`, baseline düzeltmesi sonrası; ilk run yalnız measurement baseline nedeniyle kırmızıydı) |
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

## G6 — Sınav çalışma alanı (§4, EX-01/EX-02)

- Hedef: sunucuda hesaplanan hazırlık, 8 adımlı Stepper, optik/rapor sekmelerinin çalışma alanı
  route'larına bölünmesi, eski `?examId=` bağlantılarının yönlendirilmesi, bayrak cutover'ı.
- Sahip olunan yollar: `apps/api/src/exam/{exam.service.ts,exam.module.ts,exam-workspace-progress-store*.ts,exam-workspace-readiness*.ts,exam.controller.e2e.test.ts}`,
  `apps/api/src/feature-rollout/*` (+ testler), `packages/shared-types` (`domain.ts`, `feature-rollout.ts`),
  `apps/api/src/openapi-contracts.ts`, `scripts/generate-openapi.mjs`, `packages/ui` (`Stepper`),
  `kurum/sinavlar/[examId]/**` (layout, optik/*, rapor/*, degerlendirme), `kurum/sinavlar/{exam-workspace-*,exam-evaluation-page}.tsx`,
  `kurum/sinavlar/exams-page.tsx`, `kurum/optik/{parser-config-page,optical-workspace}.tsx`,
  `kurum/raporlar/{reports-page,report-workspace}.tsx`, `next.config.mjs`, `next-navigation.d.ts`,
  route manifest (segment etiketleri) + breadcrumb, smoke spec, ilgili e2e'ler, `.github/workflows/ci.yml`
  (Postgres testi), UX baseline/token-storage pin'leri, ADR-0008, `status.md`.
- Yasak yollar: karne, parser/skorlama mantığı.
- Kabul: API test + `openapi:generate`; `optik-workspace-contract`, `report-workspace-contract`,
  `gate-c-exam-workspace`; `karne:visual-contract:check`; UAT-KURUM-05/06 STAGING = `EXTERNAL_NOT_RUN`.

### G6 notları

- Sunucu hazırlığı 10 anahtar: mevcut 5 + `OPTICAL_LAYOUT` (onaylı parser config), `IMPORT` (son raw
  import), `MATCHING` (sınavda açık karantina = 0), `EVALUATION` (son importta eşleşen > 0 ve
  değerlendirilen ≥ eşleşen), `REPORT` (READY snapshot). Tek SQL (`ExamWorkspaceProgressStore`,
  `withTenantQuery` + RLS, her alt sorgu `tenantId` filtreli). `nextAction` 9 değer; read model'e yalnız
  sayım içeren `progress` eklendi (PII yok). Migration gerekmedi (mevcut tablo/indeksler).
- UI 8 adım: Sınav bilgisi (yayın) · Katılımcılar · Cevap anahtarı · Optik düzen · Yükleme ·
  Eşleşmeyenler · Değerlendirme · Rapor. "Sıradaki" adım sunucunun `nextAction`'ından türetilir; client
  hazırlık tahmini yapmaz. `exams-page`'deki ikinci hazırlık hesabı silindi; seçili sınav bölümü çalışma
  alanına yönlendirir, yeni sınav oluşturulunca çalışma alanı açılır (yetkisi olmayan rol listede kalır).
- Optik/rapor sekmeleri ayrı URL'lerdir; bileşen `optik/layout.tsx` ve `rapor/layout.tsx` içinde tutulur
  (sekmeler arası bellek durumu — yükleme → eşleşmeyenler — korunur), aktif sekme URL segmentinden gelir.
  Dev dosyalar yeniden yazılmadı; `ParserConfigPage`/`ReportsPage` route moduna prop ile girer.
- `next.config.mjs`: `/kurum/optik?examId=X[&tab=upload|quarantine]` → `…/optik/{duzen,yukleme,eslesmeyenler}`,
  `/kurum/raporlar?examId=X[&tab=students|karne|exports]` → `…/rapor/{genel,ogrenciler,karne,ciktilar}`.
  `examId` yakalaması `[A-Za-z0-9_-]+`. Parametresiz `/kurum/optik` ve `/kurum/raporlar` mevcut sınav
  seçicili ekranı korur (seçim URL'e yazılır; yenilemede çalışma alanına yönlenir). Karne golden testi bu
  dizin modunda koştuğu için etkilenmedi.
- Bayrak: `web.exam-workspace-v2` katalogdan kaldırıldı (ADR-0008 emsali, EX-02). Gate-C'nin bayrak-kapalı
  testleri yerine workspace hata/bozuk yanıt testleri kondu (güvenli hata, mutasyon yok, istek yok).
- Route sayısı 85 → 93. Ara breadcrumb segmentleri (`optik`, `rapor`) sayfası olmadığı için link değil.
- Test uyarlamaları: optik URL-state testi sekme = alt route davranışına göre; rapor popstate yarış
  testleri eski dizin modunu sayfa içi `replaceState` ile kurar (Next history senkronu sunucuya gitmez,
  yönlendirme olmaz); rapor el değiştirme linki kanonik route'a işaret eder.

### G6 kanıt

| Sınıf | Sonuç |
|---|---|
| `LOCAL_STATIC` | PASS: shared-types/api/web typecheck, lint, `openapi:generate` (+ output contract), `route-manifest:check` (93), `web:ux-baseline:check`, `web:architecture:check`, `web:token-storage:check`, `web:design-tokens:check`, `docker:check`, `ops:check`, `prod:plan:check`, measurement baseline |
| `LOCAL_TEST` | PASS: `@o-okul/api test` (1280), `feature-rollout:check` (46), readiness birim testleri, exam controller e2e, gate-c (6), optik + rapor sözleşmeleri, route smoke (95 dahil yeni 8 route), `ui-ux-redesign:local-gates` (visual QA 31/31, golden değişmedi) |
| `CI` | Postgres ilerleme testi (`exam-workspace-progress-store.postgres.test.ts`) yalnız CI Postgres işinde koşar (yerelde Postgres yok, atlandı) |
| `EXTERNAL_NOT_RUN` | `report-generation:smoke`, `raw-import:smoke` (yerelde Postgres yok); UAT-KURUM-05/06 staging |

Görsel kanıt: `artifacts/ui-ux-redesign/berrak/g6/before` (eski çalışma alanı ve `/kurum/optik`) ve
`after` (çalışma alanı + Stepper, eşleşmeyenler, değerlendirme; açık + koyu; 375/1440).

Review (`o-okul-pr-review` + `tenant_security_reviewer`, read-only): P0/P1 yok. SQL'in her alt sorgusu
`tenantId`+`examId` filtreli ve RLS altında; erişim sırası doğru (rol kontrolü → sınav 404 → sayım);
yönlendirmeler güvenli (`examId` regex ankrajlı, sabit iç hedef). Bulgular:
- P2 (açık, deploy riski): `web.exam-workspace-v2` artık katalogda yok; mevcut sözleşme emekli anahtarı
  fail-closed reddeder (`parseFeatureRolloutConfig` → `UNKNOWN_KEY`, API açılmaz). Sözleşme korunarak
  emekli anahtar reddetme testine eklendi. Staging/prod `FEATURE_ROLLOUTS_JSON` bu anahtarı içeriyorsa
  deploy öncesi çıkarılmalı (DEC-20260903-01'deki açık soru ile aynı prosedür). Staging config'i uzak
  host'ta; staging deploy sırasında doğrulanacak.
- P2 (karar): çalışma alanı alt route'ları (optik/rapor/değerlendirme) önceki `/kurum/optik`/`/kurum/raporlar`
  erişim kuralını izler; genel bakış ve çerçeve çalışma alanı rol/persona kuralına tabidir. Böylece
  `?examId=` yönlendirmesi mevcut kullanıcıların erişimini daraltmaz ya da genişletmez. Gate-C'ye bu
  eşitliği doğrulayan assert eklendi (operasyon çalışanı ve öğretmen personası).
- P3: açık karantina sayısı sınavdaki tüm importları, eşleşen/değerlendirilen yalnız son importu sayar;
  READY rapor eski bir importa ait olabilir. Muhafazakâr (engelleyici) tarafta hata yapar; iyileştirme ayrı.
- Test boşlukları: Postgres fixture'ında `ParsedAnswer`/`ExamResult` yok (sayılar 0'da doğrulanıyor);
  yönlendirme eşlemesi için ayrı e2e yok (optik tarafı kapsanıyor).

## G7 — Günlük özetler (§5)

- Hedef: kurum, öğretmen ve öğrenci ana sayfalarını "bugün → 1–3 aksiyon → detay" düzenine indirmek;
  öğretmen özeti için tek read model.
- Sahip olunan yollar: `apps/api/src/me/{me.controller.ts,me.module.ts,me-teacher-today.service*.ts,me-access-matrix.e2e.test.ts}`,
  `apps/api/src/openapi-contracts.ts`, `packages/shared-types` (`TeacherTodaySummary`),
  `kurum/kurum-dashboard.tsx`, `ogretmen/page.tsx`, `portals/{teacher-today-page,teacher-portal-page,student-portal-page}.tsx`,
  `_styles/72-almanac-portal.css`, ilgili e2e'ler + golden'lar, `scripts/check-web-ux-baseline.mjs`.
- Yasak yollar: veli portalı içeriği, karne, DB şeması.
- Kabul: API test + `openapi:generate`; öğretmen/öğrenci/veli portal sözleşmeleri; route smoke; visual QA;
  `web:ux-baseline:check`; `ui-ux-redesign:local-gates`.

### G7 notları

- `GET /me/teacher/today` (`@Roles("TEACHER")` + `assertTeacherContext`): bugünkü dersler (İstanbul günü),
  kontrol bekleyen ödevler (ilk 5 + toplam), son hazır sınav raporu. Mevcut `/me/teacher/*` uçlarının
  kullandığı servis çağrılarını (`findCurrentTeacher`, `listCurrentTeacherLessons`, `homework.list`,
  `reportIndex.listForTeacher`) birleştirir; kapsam ve RLS bu servislerde aynen kalır. Erişim matrisi
  testine eklendi; OpenAPI 256 path. Migration yok.
- `/ogretmen` artık `TeacherTodayPage`: "Bugün" özeti, "Öğretmen günlük aksiyonları" şeridi (Yoklama al →
  Ders akışı, Ödev kontrolü, Son sınav raporu), bugünkü dersler, bekleyen ödevler, son rapor. Rol önizlemesi
  `x-role-preview-token` ile salt okunur.
- `TeacherPortalPage`'in kullanılmayan `overview` görünümü silindi (eski "Günlük ders akışı" özeti ve 7
  maddelik şerit dahil — yeni özetle bilinçli terminoloji birleşmesi). Yazma formları, profil özeti ve seçili
  öğrenci özeti (Başarı % için rapor verisi) Ders akışında; materyal atama tablosu formla birlikte Ders
  akışında da görünür. Destek görünümü artık ders programını yükler: talep ders/dönem bağlamını programdan
  alıyordu, `/ogretmen/destek`'te bu alanlar boş gidiyordu (düzeltildi, login-next yolculuğu doğrular).
- `/ogrenci` özeti: Bugün teslim → Son sınav (Başarı %, gelişim özeti, net/soru) → Duyuru; şerit sırası
  ödev → rapor → duyuru. Profil, veliler, geçmiş, devamsızlık, notlar ve destek yalnız kendi route'larında.
  Öğrenci için ayrı read model eklenmedi (özet 3 mevcut çağrıyla yükleniyor; açık madde).
- `/kurum`: "Diğer kurum işlemleri" bağlantı duvarı kaldırıldı; sıra dikkat → metrikler → son sınav →
  duyurular.
- Testler rotalar arası yolculuğa dönüştü; eski assert'ler verinin taşındığı route'larda korunuyor.
  UX baseline pin'leri `teacher-today-page.tsx`'teki eşdeğer token'lara taşındı (silinmedi).
- G5'ten kalan `backup-restore` seçici çakışması (hub sekmesi + araç kartı aynı "Yedekleme" adı) araç
  kartına kapsandı.
- Güncellenen darwin golden'ları: `route-family-dashboard-1440`, `student-portal-actions-414`,
  `route-family-student-portal-414`.

### G7 kanıt

| Sınıf | Sonuç |
|---|---|
| `LOCAL_STATIC` | PASS: shared-types/api/web typecheck, `openapi:generate` (+ output contract), `route-manifest:check` (93), `web:ux-baseline:check`, `web:design-tokens:check`, measurement baseline |
| `LOCAL_TEST` | PASS: `@o-okul/api test` (1284), tüm e2e-next (340 geçti, 2 canlı test atlandı); `ui-ux-redesign:local-gates` (31/31). Kırmızı kalan 2 test main'de de kırmızı: login-next palet "Denetim" ve çıkış `/giris` (rol portalı yolculuğu çıkış beklentisi yerelde geçici gevşetilerek uçtan uca geçti; commit edilmedi) |
| `CI` | Karne Linux golden farkı G2'den beri bekleniyor (G10'da düzelecek) |
| `EXTERNAL_NOT_RUN` | `report-generation:smoke`, `raw-import:smoke` (yerelde Postgres yok); staging UAT |

Görsel kanıt: `artifacts/ui-ux-redesign/berrak/g7/{before,after}` (`/ogretmen`, `/ogrenci`, `/kurum`; açık +
koyu; 375/1440). Öğrenci ve kurum yakalamaları portal verisi için hata/boş durumdadır (yakalama mock'u).

Review (`o-okul-pr-review`, read-only): P0/P1 yok. Kapsam temiz (her alt çağrı tenant + öğretmen öznesini
yeniden doğrular; `latestReport` yalnız öğretmenin atanmış öğrencilerini içeren READY snapshot'lardan),
İstanbul gün sınırı doğru, rol önizlemesi salt okunur. Bulgular ve durum:
- P2 düzeltildi: Profil sayfasındaki seçili öğrenci özeti rapor/duyuru/ödev/devamsızlık/destek verisini
  yüklemiyordu ("-", "0 kayıt" gösteriyordu). Profil görünümü bu okumaları yapar; spec'e sayısal assert'ler
  (%81,7 / 30 / 24,5 / 1 okunmamış) geri kondu.
- P2 düzeltildi: rapor dizini hatası `/me/teacher/today`'i düşürüyordu; artık `latestReport: null` döner
  (eski yükleyicideki `apiRequestOrNull` davranışı). Birim testi eklendi.
- P2 düzeltildi: öğretmen olmayan erişimde genel hata yerine diğer portallar gibi `AccessPanel`.
- P3 düzeltildi: son rapor kartındaki totolojik "Başarı %" assert'i gerçek metinle değişti; kurum özeti
  için yorum-pin yerine `requireNoTokens` (link duvarı geri gelemez); `/me/teacher/today` OpenAPI
  tip-sapma + yasak alan (`tenantId`, `userId`, `studentId`, iletişim/kimlik) sözleşmesine eklendi
  (negatif denemeyle etkinliği doğrulandı).
- P3 açık (G8): `.next-dashboard-compact-links` ve `.next-institution-growth-side` CSS'i artık ölü; CSS
  pin'leri DEC-20260930-03 kapsamında G8'de temizlenecek.
- P3 açık: özet sayfası her ziyarette öğretmenin ödev/sınav/snapshot dizinlerini bellekte tarar (eski
  portal yükleyicisiyle aynı servisler); ölçek gerektiğinde sorgu seviyesinde sınır.

