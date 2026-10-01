# Design — O-Okul

O-Okul için kilitli, çok sayfalı tasarım sistemi. Her yeni web yüzeyi bu
dosyayı ve `tokens.css` değişkenlerini kullanır; route, yetki ve veri
sözleşmeleri görsel sistemden bağımsızdır.

## Genre

Sakin ürün: nötr yüzeyler, koyu mürekkep, ince çizgiler ve tek bir indigo vurgu.
Ekranlar dekoratif kart duvarları değil; görev, durum ve sonraki aksiyon sırasını
görünür kılan sade bir çalışma alanıdır. Karar kaydı: DEC-20260930-01.

## Macrostructure family

- Landing: Narrative Workflow. Optik → rapor → portal akışını gerçek ürün diliyle
  gösterir; uydurma metrik, logo, yorum veya sahte tarayıcı çerçevesi kullanmaz.
- App: Workbench. Shell, route ve yetki yapısı korunur; bağlam, öncelikli görev,
  operasyon alanı ve destekleyici kanıt sıralanır. Dashboard,
  liste, detay, iş akışı ve portal bileşenleri aynı tokenları ve eylem dilini
  paylaşır.
- Content/evidence: Index-first. Durum matrisi, zaman çizgisi ve kayıt önce
  gelir; local, staging ve canlı kanıt birbirine karıştırılmaz.

## Theme — Berrak

Kanonik açık tema değerleri bu dosyanın `### tokens.css` ihracındadır; kökteki
`tokens.css` bu bloğun birebir üretim kopyasıdır. Token adları (`paper`, `ink`,
`rule`, `accent`) Almanac'tan korunur; yalnız değerler değişir.

İndigo birincil eylem, aktif öğe, odak ve link ile sınırlıdır; teal yalnız
grafik karşılaştırma serisidir ve başarı rengi yerine kullanılmaz. Durumlar
renk yanında ikon veya açık metin etiketi taşır. Grafiklerin ana `Başarı %`
serisi indigo, karşılaştırma serisi teal, Net/Soru bağlamı nötrdür; başarı,
uyarı ve hata kendi semantik tokenlarını kullanır.

### Koyu tema

- Seçim `<html data-theme="light|dark">` ile yapılır. Varsayılan
  `prefers-color-scheme`'dir; kullanıcı tercihi tarayıcıda `o-okul-theme`
  anahtarıyla saklanır ve paint öncesi `apps/web/app/layout.tsx` içindeki küçük
  script ile uygulanır.
- Koyu değerler `apps/web/app/_styles/01-theme-dark.css` içindedir ve aynı token
  adlarını kullanır: zemin `oklch(17% 0.010 265)`, kart `oklch(21% 0.012 265)`,
  mürekkep `oklch(96% 0.005 265)`, ikincil mürekkep `oklch(72% 0.015 265)`,
  çizgiler `oklch(30/38/26% 0.012 265)`, indigo `oklch(67% 0.180 277)`, teal
  `oklch(72% 0.110 185)`; başarı/uyarı/hata 400 tonları ve koyu soft zeminler.
- Karne ve baskı daima açık kâğıttır: `.next-karne-sheet` renk token'larını
  `tokens.css` açık değerlerine sabitler (`KARNE-PAPER-PINS`), `@media print` koyu
  temada açık değerleri geri yükler (`BERRAK-LIGHT-RESET`).
- Grafikler token'ları `html[data-theme]` değişiminde yeniden okur.

## Typography

- Tek aile: IBM Plex Sans (`latin-ext`), weight 400 / 500 / 600.
  `--font-display` aynı sans aileye eşlenir; serif kullanılmaz.
- Mono: mevcut sistem monospace yığını.
- Ölçek: 12 / 14 / 16 / 18 / 20 / 24 / 30 px. Kurum çalışma alanında gövde
  14 px (yoğun), portal ve auth ekranlarında 16 px (rahat).
- Landing başlığı `--text-display` (32–40 px, weight 600) tek istisnadır; marketing
  yüzeyi de 600 üstü ağırlık kullanmaz.
- Sayılar ve uygulama tabloları `font-variant-numeric: tabular-nums` kullanır;
  karne de dahil (DEC-20260930-04: IBM Plex, Arial yalnız yedek font).

Başlıklar hiçbir zaman italik değildir. Uzun başlıklar `overflow-wrap:
anywhere` ile kendi kolonunda kalır.

## Spacing and shape

4-point named scale `tokens.css` içindedir: 4 / 8 / 12 / 16 / 24 / 32 /
48 / 64 px. Kontroller en az 44 px, dokunmatik yüzeylerde 48 px olur.
Radius kontrollerde 6, panel ve kartlarda 8, dialoglarda 12 px; pill
kontrollerde `--radius-pill` kullanır. Gölge token'ları: `--shadow-xs` (kart:
ince çizgi + çok hafif gölge), `--shadow-sm` (popover), `--shadow-lg` (dialog).
Odak halkası 2 px `--color-focus` + 2 px zemin boşluğudur.

## Motion

- Süreler: 100 / 180 / 320 ms.
- Easing: `--ease-out` ve `--ease-standard`.
- Yalnız `transform` ve `opacity` hareket eder.
- Genel reveal yoktur; arayüz ilk anda okunur.
- `prefers-reduced-motion` altında geçiş ve animasyonlar kapanır.

## Microinteractions stance

- Başarı sakin ve metinle açıklanır; kutlama animasyonu yoktur.
- Focus gecikmesiz ve her zaman görünürdür.
- Loading, empty, error, success, validation ve disabled durumları ilgili
  bileşenin mevcut alanında gösterilir; yerleşim sıçraması yaratılmaz.

## CTA voice

- Primary: indigo dolgu, kısa fiil + nesne; tek satır.
- Secondary: yüzey üzerinde ince çizgi sınırı; tek satır.
- Ghost: yalnız düşük öncelikli veya geri dönüş eylemi.
- Aynı viewport içinde tek baskın primary eylem hedeflenir.

## Route-family rules

- Landing: gerçek ürün kabiliyeti ve doğrulanmış kapsam; sentetik kanıt yok.
- Auth: tek görevli form ve güven bağlamı; mevcut login/MFA/tenant akışı aynı.
- Dashboard: öncelikli işler → en fazla dört metrik → güncel operasyonlar.
- Lists: arama ve sıralama önde, tablo ilk viewport'a yakın.
- Detail: kimlik özeti → sekmeler → ana içerik + bağlamsal yan alan.
- Exam/optic/report: seçili sınav bağlamı → mevcut adım → sonraki aksiyon.
- Portals: bugün → 1–3 öncelikli aksiyon → detay.
- Evidence: seviye, durum ve zaman açıkça etiketlenir.

## Shared and differing rules

Tüm sayfalar wordmark, renkler, fontlar, focus, CTA ve bölüm başlığı ritmini
paylaşır. Yalnız route ailesinin içerik yapısı değişebilir. Marketing görsel
zenginlik kullanabilir; uygulama ekranlarında işlev sayfayı taşır. Karne aynı dili
A4 kâğıt geometrisinde (595 × 842 pt) kullanır; web sheet ve worker PDF şablonu
birlikte güncellenir.

## Visual acceptance

- Tüm route envanteri 320 / 375 / 414 / 768 px'te doğrulanır. Aile
  temsilcileri ve mevcut geniş ekran sözleşmeleri 1024 / 1440 px'i; landing
  fold sözleşmesi ayrıca 1280 × 800 px'i kapsar.
- Login paneli (414), kurum rail'i (1440), öğrenci öncelikli aksiyon şeridi
  (414) ve rapor durum bölgesi (1440) Darwin ve Linux golden'larıyla korunur.
- Karne golden'ı (`student-report-card-1024`, 595 × 842) ayrı sözleşmedir ve
  yalnız karne tasarımı değişirken bilinçli yenilenir (DEC-20260930-04).

## Hallmark

`/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */`

Slop test: `58 / 58 ✓`.

## Exports

Bu örnekler taşınabilir eşleştirmedir; O-Okul üretiminde Tailwind, DTCG veya
shadcn bağımlılığı kurmaz.

### tokens.css

```css
/* Hallmark · macrostructure: Narrative Workflow / Workbench · tone: calm-product · anchor hue: indigo 277 */
/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
/* Hallmark · genre: product · landing: Narrative Workflow · app: Workbench · theme: Berrak */
:root {
  --color-paper: oklch(98.3% 0.003 250);
  --color-paper-raised: oklch(99.9% 0.001 250);
  --color-paper-muted: oklch(96.5% 0.005 250);
  --color-ink: oklch(21% 0.020 265);
  --color-ink-secondary: oklch(35% 0.025 263);
  --color-ink-chart-soft: oklch(35% 0.025 263 / 18%);
  --color-ink-muted: oklch(51% 0.030 260);
  --color-rule: oklch(91% 0.008 255);
  --color-rule-strong: oklch(83% 0.008 255);
  --color-rule-faint: oklch(95% 0.008 255);
  --color-accent: oklch(51% 0.230 277);
  --color-accent-hover: oklch(46% 0.215 277);
  --color-accent-strong: oklch(41% 0.190 277);
  --color-accent-soft: oklch(96% 0.018 272);
  --color-accent-secondary: oklch(60% 0.118 185);
  --color-accent-chart-soft: oklch(51% 0.230 277 / 18%);
  --color-accent-ink: oklch(99% 0.003 270);
  --color-focus: oklch(51% 0.230 277);
  --color-success-token: oklch(50% 0.130 150);
  --color-success-soft-token: oklch(96.2% 0.044 157);
  --color-warning-token: oklch(52% 0.140 49);
  --color-warning-soft-token: oklch(96.2% 0.059 96);
  --color-danger-token: oklch(52% 0.215 27);
  --color-danger-soft-token: oklch(97.1% 0.013 17);
  --color-overlay-token: oklch(21% 0.020 265 / 50%);
  --color-shadow-soft: oklch(21% 0.020 265 / 6%);
  --color-shadow-medium: oklch(21% 0.020 265 / 10%);
  --color-shadow-strong: oklch(21% 0.020 265 / 18%);
  --color-chart-grid: oklch(21% 0.020 265 / 10%);

  --chart-accent: var(--color-accent-secondary);
  --chart-primary: var(--color-accent);
  --chart-primary-soft: var(--color-accent-chart-soft);
  --chart-success: var(--color-success-token);
  --chart-danger: var(--color-danger-token);
  --chart-neutral: var(--color-ink-muted);
  --chart-grid: var(--color-chart-grid);
  --chart-text: var(--color-ink-muted);
  --chart-surface: var(--color-paper-raised);

  --font-display: var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --font-body: var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Consolas, monospace;

  --space-3xs: 0.25rem;
  --space-2xs: 0.5rem;
  --space-xs: 0.75rem;
  --space-sm: 1rem;
  --space-md: 1.5rem;
  --space-lg: 2rem;
  --space-xl: 3rem;
  --space-2xl: 4rem;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.5rem;
  --text-display: clamp(2rem, 3.5vw, 2.5rem);

  --radius-control: 6px;
  --radius-panel: 8px;
  --radius-dialog: 12px;
  --radius-pill: 999px;
  --dur-instant: 100ms;
  --dur-short: 180ms;
  --dur-long: 320ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(98.3% 0.003 250);
  --color-paper-raised: oklch(99.9% 0.001 250);
  --color-paper-muted: oklch(96.5% 0.005 250);
  --color-ink: oklch(21% 0.020 265);
  --color-ink-secondary: oklch(35% 0.025 263);
  --color-ink-chart-soft: oklch(35% 0.025 263 / 18%);
  --color-ink-muted: oklch(51% 0.030 260);
  --color-rule: oklch(91% 0.008 255);
  --color-rule-strong: oklch(83% 0.008 255);
  --color-rule-faint: oklch(95% 0.008 255);
  --color-accent: oklch(51% 0.230 277);
  --color-accent-hover: oklch(46% 0.215 277);
  --color-accent-strong: oklch(41% 0.190 277);
  --color-accent-soft: oklch(96% 0.018 272);
  --color-accent-secondary: oklch(60% 0.118 185);
  --color-accent-chart-soft: oklch(51% 0.230 277 / 18%);
  --color-accent-ink: oklch(99% 0.003 270);
  --color-focus: oklch(51% 0.230 277);
  --color-success-token: oklch(50% 0.130 150);
  --color-success-soft-token: oklch(96.2% 0.044 157);
  --color-warning-token: oklch(52% 0.140 49);
  --color-warning-soft-token: oklch(96.2% 0.059 96);
  --color-danger-token: oklch(52% 0.215 27);
  --color-danger-soft-token: oklch(97.1% 0.013 17);
  --color-overlay-token: oklch(21% 0.020 265 / 50%);
  --color-shadow-soft: oklch(21% 0.020 265 / 6%);
  --color-shadow-medium: oklch(21% 0.020 265 / 10%);
  --color-shadow-strong: oklch(21% 0.020 265 / 18%);
  --color-chart-grid: oklch(21% 0.020 265 / 10%);
  --chart-accent: var(--color-accent-secondary);
  --chart-primary: var(--color-accent);
  --chart-primary-soft: var(--color-accent-chart-soft);
  --chart-success: var(--color-success-token);
  --chart-danger: var(--color-danger-token);
  --chart-neutral: var(--color-ink-muted);
  --chart-grid: var(--color-chart-grid);
  --chart-text: var(--color-ink-muted);
  --chart-surface: var(--color-paper-raised);
  --font-display: var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --font-body: var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Consolas, monospace;
  --spacing-3xs: 0.25rem;
  --spacing-2xs: 0.5rem;
  --spacing-xs: 0.75rem;
  --spacing-sm: 1rem;
  --spacing-md: 1.5rem;
  --spacing-lg: 2rem;
  --spacing-xl: 3rem;
  --spacing-2xl: 4rem;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.5rem;
  --text-display: clamp(2rem, 3.5vw, 2.5rem);
  --radius-control: 6px;
  --radius-panel: 8px;
  --radius-dialog: 12px;
  --radius-pill: 999px;
  --duration-instant: 100ms;
  --duration-short: 180ms;
  --duration-long: 320ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper": { "$value": "oklch(98.3% 0.003 250)", "$type": "color" },
    "paperRaised": { "$value": "oklch(99.9% 0.001 250)", "$type": "color" },
    "paperMuted": { "$value": "oklch(96.5% 0.005 250)", "$type": "color" },
    "ink": { "$value": "oklch(21% 0.020 265)", "$type": "color" },
    "inkSecondary": { "$value": "oklch(35% 0.025 263)", "$type": "color" },
    "inkChartSoft": { "$value": "oklch(35% 0.025 263 / 18%)", "$type": "color" },
    "inkMuted": { "$value": "oklch(51% 0.030 260)", "$type": "color" },
    "rule": { "$value": "oklch(91% 0.008 255)", "$type": "color" },
    "ruleStrong": { "$value": "oklch(83% 0.008 255)", "$type": "color" },
    "ruleFaint": { "$value": "oklch(95% 0.008 255)", "$type": "color" },
    "accent": { "$value": "oklch(51% 0.230 277)", "$type": "color" },
    "accentHover": { "$value": "oklch(46% 0.215 277)", "$type": "color" },
    "accentStrong": { "$value": "oklch(41% 0.190 277)", "$type": "color" },
    "accentSoft": { "$value": "oklch(96% 0.018 272)", "$type": "color" },
    "accentSecondary": { "$value": "oklch(60% 0.118 185)", "$type": "color" },
    "accentChartSoft": { "$value": "oklch(51% 0.230 277 / 18%)", "$type": "color" },
    "accentInk": { "$value": "oklch(99% 0.003 270)", "$type": "color" },
    "focus": { "$value": "oklch(51% 0.230 277)", "$type": "color" },
    "success": { "$value": "oklch(50% 0.130 150)", "$type": "color" },
    "successSoft": { "$value": "oklch(96.2% 0.044 157)", "$type": "color" },
    "warning": { "$value": "oklch(52% 0.140 49)", "$type": "color" },
    "warningSoft": { "$value": "oklch(96.2% 0.059 96)", "$type": "color" },
    "danger": { "$value": "oklch(52% 0.215 27)", "$type": "color" },
    "dangerSoft": { "$value": "oklch(97.1% 0.013 17)", "$type": "color" },
    "overlay": { "$value": "oklch(21% 0.020 265 / 50%)", "$type": "color" },
    "shadowSoft": { "$value": "oklch(21% 0.020 265 / 6%)", "$type": "color" },
    "shadowMedium": { "$value": "oklch(21% 0.020 265 / 10%)", "$type": "color" },
    "shadowStrong": { "$value": "oklch(21% 0.020 265 / 18%)", "$type": "color" },
    "chartGrid": { "$value": "oklch(21% 0.020 265 / 10%)", "$type": "color" }
  },
  "chart": {
    "accent": { "$value": "{color.accentSecondary}", "$type": "color" },
    "primary": { "$value": "{color.accent}", "$type": "color" },
    "primarySoft": { "$value": "{color.accentChartSoft}", "$type": "color" },
    "success": { "$value": "{color.success}", "$type": "color" },
    "danger": { "$value": "{color.danger}", "$type": "color" },
    "neutral": { "$value": "{color.inkMuted}", "$type": "color" },
    "grid": { "$value": "{color.chartGrid}", "$type": "color" },
    "text": { "$value": "{color.inkMuted}", "$type": "color" },
    "surface": { "$value": "{color.paperRaised}", "$type": "color" }
  },
  "font": {
    "display": { "$value": "var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif", "$type": "fontFamily" },
    "body": { "$value": "var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif", "$type": "fontFamily" },
    "mono": { "$value": "ui-monospace, \"SFMono-Regular\", Consolas, monospace", "$type": "fontFamily" }
  },
  "space": {
    "3xs": { "$value": "0.25rem", "$type": "dimension" },
    "2xs": { "$value": "0.5rem", "$type": "dimension" },
    "xs": { "$value": "0.75rem", "$type": "dimension" },
    "sm": { "$value": "1rem", "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem", "$type": "dimension" },
    "xl": { "$value": "3rem", "$type": "dimension" },
    "2xl": { "$value": "4rem", "$type": "dimension" }
  },
  "text": {
    "xs": { "$value": "0.75rem", "$type": "dimension" },
    "sm": { "$value": "0.875rem", "$type": "dimension" },
    "base": { "$value": "1rem", "$type": "dimension" },
    "lg": { "$value": "1.25rem", "$type": "dimension" },
    "xl": { "$value": "1.5rem", "$type": "dimension" },
    "display": { "$value": "clamp(2rem, 3.5vw, 2.5rem)", "$type": "string" }
  },
  "radius": {
    "control": { "$value": "6px", "$type": "dimension" },
    "panel": { "$value": "8px", "$type": "dimension" },
    "dialog": { "$value": "12px", "$type": "dimension" },
    "pill": { "$value": "999px", "$type": "dimension" }
  },
  "duration": {
    "instant": { "$value": "100ms", "$type": "duration" },
    "short": { "$value": "180ms", "$type": "duration" },
    "long": { "$value": "320ms", "$type": "duration" }
  },
  "easing": {
    "out": { "$value": [0.16, 1, 0.3, 1], "$type": "cubicBezier" },
    "standard": { "$value": [0.2, 0, 0, 1], "$type": "cubicBezier" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 98.3% 0.003 250;
  --foreground: 21% 0.020 265;
  --primary: 51% 0.230 277;
  --primary-foreground: 99% 0.003 270;
  --muted: 96.5% 0.005 250;
  --muted-foreground: 51% 0.030 260;
  --border: 91% 0.008 255;
  --input: 83% 0.008 255;
  --ring: 51% 0.230 277;
  --radius: 6px;

  --o-okul-color-paper: oklch(98.3% 0.003 250);
  --o-okul-color-paper-raised: oklch(99.9% 0.001 250);
  --o-okul-color-paper-muted: oklch(96.5% 0.005 250);
  --o-okul-color-ink: oklch(21% 0.020 265);
  --o-okul-color-ink-secondary: oklch(35% 0.025 263);
  --o-okul-color-ink-chart-soft: oklch(35% 0.025 263 / 18%);
  --o-okul-color-ink-muted: oklch(51% 0.030 260);
  --o-okul-color-rule: oklch(91% 0.008 255);
  --o-okul-color-rule-strong: oklch(83% 0.008 255);
  --o-okul-color-rule-faint: oklch(95% 0.008 255);
  --o-okul-color-accent: oklch(51% 0.230 277);
  --o-okul-color-accent-hover: oklch(46% 0.215 277);
  --o-okul-color-accent-strong: oklch(41% 0.190 277);
  --o-okul-color-accent-soft: oklch(96% 0.018 272);
  --o-okul-color-accent-secondary: oklch(60% 0.118 185);
  --o-okul-color-accent-chart-soft: oklch(51% 0.230 277 / 18%);
  --o-okul-color-accent-ink: oklch(99% 0.003 270);
  --o-okul-color-focus: oklch(51% 0.230 277);
  --o-okul-color-success: oklch(50% 0.130 150);
  --o-okul-color-success-soft: oklch(96.2% 0.044 157);
  --o-okul-color-warning: oklch(52% 0.140 49);
  --o-okul-color-warning-soft: oklch(96.2% 0.059 96);
  --o-okul-color-danger: oklch(52% 0.215 27);
  --o-okul-color-danger-soft: oklch(97.1% 0.013 17);
  --o-okul-color-overlay: oklch(21% 0.020 265 / 50%);
  --o-okul-color-shadow-soft: oklch(21% 0.020 265 / 6%);
  --o-okul-color-shadow-medium: oklch(21% 0.020 265 / 10%);
  --o-okul-color-shadow-strong: oklch(21% 0.020 265 / 18%);
  --o-okul-color-chart-grid: oklch(21% 0.020 265 / 10%);
  --o-okul-chart-accent: var(--o-okul-color-accent-secondary);
  --o-okul-chart-primary: var(--o-okul-color-accent);
  --o-okul-chart-primary-soft: var(--o-okul-color-accent-chart-soft);
  --o-okul-chart-success: var(--o-okul-color-success);
  --o-okul-chart-danger: var(--o-okul-color-danger);
  --o-okul-chart-neutral: var(--o-okul-color-ink-muted);
  --o-okul-chart-grid: var(--o-okul-color-chart-grid);
  --o-okul-chart-text: var(--o-okul-color-ink-muted);
  --o-okul-chart-surface: var(--o-okul-color-paper-raised);
  --o-okul-font-display: var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --o-okul-font-body: var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --o-okul-font-mono: ui-monospace, "SFMono-Regular", Consolas, monospace;
  --o-okul-space-3xs: 0.25rem;
  --o-okul-space-2xs: 0.5rem;
  --o-okul-space-xs: 0.75rem;
  --o-okul-space-sm: 1rem;
  --o-okul-space-md: 1.5rem;
  --o-okul-space-lg: 2rem;
  --o-okul-space-xl: 3rem;
  --o-okul-space-2xl: 4rem;
  --o-okul-text-xs: 0.75rem;
  --o-okul-text-sm: 0.875rem;
  --o-okul-text-base: 1rem;
  --o-okul-text-lg: 1.25rem;
  --o-okul-text-xl: 1.5rem;
  --o-okul-text-display: clamp(2rem, 3.5vw, 2.5rem);
  --o-okul-radius-control: 6px;
  --o-okul-radius-panel: 8px;
  --o-okul-radius-dialog: 12px;
  --o-okul-radius-pill: 999px;
  --o-okul-duration-instant: 100ms;
  --o-okul-duration-short: 180ms;
  --o-okul-duration-long: 320ms;
  --o-okul-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --o-okul-ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```
