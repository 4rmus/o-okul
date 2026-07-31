# Design — O-Okul

O-Okul için kilitli, çok sayfalı tasarım sistemi. Her yeni web yüzeyi bu
dosyayı ve `tokens.css` değişkenlerini kullanır; route, yetki ve veri
sözleşmeleri görsel sistemden bağımsızdır.

## Genre

Editoryal ve teknik; serin kâğıt yüzey, koyu mürekkep, ölçülü çizgiler ve karar
odaklı hiyerarşi kullanır. Ekranlar dekoratif kart duvarları değil, görev,
durum ve sonraki aksiyon sırasını görünür kılan yaşayan bir okul almanağıdır.

## Macrostructure family

- Landing: Narrative Workflow. Optik → rapor → portal akışını gerçek ürün diliyle
  gösterir; uydurma metrik, logo, yorum veya sahte tarayıcı çerçevesi kullanmaz.
- App: Workbench. Shell, route ve yetki yapısı korunur; bağlam, öncelikli görev,
  operasyon alanı ve destekleyici kanıt sıralanır. Dashboard,
  liste, detay, iş akışı ve portal bileşenleri aynı tokenları ve eylem dilini
  paylaşır.
- Content/evidence: Index-first. Durum matrisi, zaman çizgisi ve kayıt önce
  gelir; local, staging ve canlı kanıt birbirine karıştırılmaz.

## Theme — Almanac

Kanonik değerler bu dosyanın `### tokens.css` ihracındadır; kökteki
`tokens.css` bu bloğun birebir üretim kopyasıdır.

Mürekkep mavisi birincil eylem, aktif öğe ve link ile sınırlıdır; teal
yalnız dekoratif karşılaştırma vurgusudur ve başarı rengi yerine kullanılmaz.
Durumlar renk yanında ikon veya açık metin etiketi taşır. Grafiklerin ana
`Başarı %` serisi mürekkep mavisi, karşılaştırma serisi teal, Net/Soru bağlamı nötrdür;
başarı, uyarı ve hata kendi semantik tokenlarını kullanır.

## Typography

- Display: Source Serif 4, weight 600–700, normal.
- Body: IBM Plex Sans, weight 400–600.
- Mono: mevcut sistem monospace yığını.
- Display tracking: `-0.018em`.
- Ölçek: 12 / 14 / 16 / 20 / 28 px; landing display en fazla 48 px.
- Sayılar ve uygulama tabloları `font-variant-numeric: tabular-nums` kullanır.
  Dondurulmuş `.next-karne-sheet` tabloları Arial geometrisini korur ve bu
  genel sayı kuralını devralmaz.

Başlıklar hiçbir zaman italik değildir. Uzun başlıklar `overflow-wrap:
anywhere` ile kendi kolonunda kalır.

## Spacing and shape

4-point named scale `tokens.css` içindedir: 4 / 8 / 12 / 16 / 24 / 32 /
48 / 64 px. Kontroller en az 44 px, dokunmatik yüzeylerde 48 px olur.
Radius kontrollerde 4, panellerde 2, dialoglarda 6 px; pill kontrollerde
`--radius-pill` kullanır. Gölge dialog, popover ve geçici katmanlarla sınırlıdır.

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

- Primary: mürekkep mavisi dolgu, kısa fiil + nesne; tek satır.
- Secondary: kâğıt yüzey üzerinde mürekkep sınırı; tek satır.
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
zenginlik kullanabilir; uygulama ekranlarında işlev sayfayı taşır. Print/PDF
ve mevcut karne geometrisi bu sistemden ayrı tutulur.

## Visual acceptance

- Tüm route envanteri 320 / 375 / 414 / 768 px'te doğrulanır. Aile
  temsilcileri ve mevcut geniş ekran sözleşmeleri 1024 / 1440 px'i; landing
  fold sözleşmesi ayrıca 1280 × 800 px'i kapsar.
- Login paneli (414), kurum rail'i (1440), öğrenci öncelikli aksiyon şeridi
  (414) ve rapor durum bölgesi (1440) Darwin ve Linux golden'larıyla korunur.
- Mevcut karne golden'ı ayrı sözleşmedir; bu web yeniden tasarımı onu
  topluca güncellemez.

## Hallmark

`/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */`

Slop test: `58 / 58 ✓`.

## Exports

Bu örnekler taşınabilir eşleştirmedir; O-Okul üretiminde Tailwind, DTCG veya
shadcn bağımlılığı kurmaz.

### tokens.css

```css
/* Hallmark · macrostructure: Narrative Workflow / Workbench · tone: technical-austere · anchor hue: ink-blue 230 */
/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
/* Hallmark · genre: editorial · landing: Narrative Workflow · app: Workbench · theme: Almanac */
:root {
  --color-paper: oklch(96.5% 0.012 220);
  --color-paper-raised: oklch(98.5% 0.007 220);
  --color-paper-muted: oklch(93% 0.018 220);
  --color-ink: oklch(20% 0.025 235);
  --color-ink-secondary: oklch(30% 0.025 235);
  --color-ink-chart-soft: oklch(30% 0.025 235 / 18%);
  --color-ink-muted: oklch(42% 0.025 235);
  --color-rule: oklch(80% 0.020 225);
  --color-rule-strong: oklch(66% 0.025 225);
  --color-rule-faint: oklch(89% 0.014 225);
  --color-accent: oklch(42% 0.150 230);
  --color-accent-hover: oklch(36% 0.135 230);
  --color-accent-strong: oklch(32% 0.120 230);
  --color-accent-soft: oklch(92% 0.035 230);
  --color-accent-secondary: oklch(44% 0.100 175);
  --color-accent-chart-soft: oklch(42% 0.150 230 / 18%);
  --color-accent-ink: oklch(98% 0.006 220);
  --color-focus: oklch(48% 0.180 245);
  --color-success-token: oklch(42% 0.120 155);
  --color-success-soft-token: oklch(93% 0.025 155);
  --color-warning-token: oklch(52% 0.120 80);
  --color-warning-soft-token: oklch(94% 0.025 85);
  --color-danger-token: oklch(48% 0.165 25);
  --color-danger-soft-token: oklch(94% 0.030 25);
  --color-overlay-token: oklch(18% 0.020 235 / 72%);
  --color-shadow-soft: oklch(18% 0.020 235 / 10%);
  --color-shadow-medium: oklch(18% 0.020 235 / 16%);
  --color-shadow-strong: oklch(18% 0.020 235 / 28%);
  --color-chart-grid: oklch(20% 0.025 235 / 12%);

  --chart-accent: var(--color-accent-secondary);
  --chart-primary: var(--color-accent);
  --chart-primary-soft: var(--color-accent-chart-soft);
  --chart-success: var(--color-success-token);
  --chart-danger: var(--color-danger-token);
  --chart-neutral: var(--color-ink-muted);
  --chart-grid: var(--color-chart-grid);
  --chart-text: var(--color-ink-muted);
  --chart-surface: var(--color-paper-raised);

  --font-display: var(--font-source-serif-4), ui-serif, Georgia, serif;
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
  --text-xl: 1.75rem;
  --text-display: clamp(2.25rem, 4vw, 3rem);

  --radius-control: 4px;
  --radius-panel: 2px;
  --radius-dialog: 6px;
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
  --color-paper: oklch(96.5% 0.012 220);
  --color-paper-raised: oklch(98.5% 0.007 220);
  --color-paper-muted: oklch(93% 0.018 220);
  --color-ink: oklch(20% 0.025 235);
  --color-ink-secondary: oklch(30% 0.025 235);
  --color-ink-chart-soft: oklch(30% 0.025 235 / 18%);
  --color-ink-muted: oklch(42% 0.025 235);
  --color-rule: oklch(80% 0.020 225);
  --color-rule-strong: oklch(66% 0.025 225);
  --color-rule-faint: oklch(89% 0.014 225);
  --color-accent: oklch(42% 0.150 230);
  --color-accent-hover: oklch(36% 0.135 230);
  --color-accent-strong: oklch(32% 0.120 230);
  --color-accent-soft: oklch(92% 0.035 230);
  --color-accent-secondary: oklch(44% 0.100 175);
  --color-accent-chart-soft: oklch(42% 0.150 230 / 18%);
  --color-accent-ink: oklch(98% 0.006 220);
  --color-focus: oklch(48% 0.180 245);
  --color-success-token: oklch(42% 0.120 155);
  --color-success-soft-token: oklch(93% 0.025 155);
  --color-warning-token: oklch(52% 0.120 80);
  --color-warning-soft-token: oklch(94% 0.025 85);
  --color-danger-token: oklch(48% 0.165 25);
  --color-danger-soft-token: oklch(94% 0.030 25);
  --color-overlay-token: oklch(18% 0.020 235 / 72%);
  --color-shadow-soft: oklch(18% 0.020 235 / 10%);
  --color-shadow-medium: oklch(18% 0.020 235 / 16%);
  --color-shadow-strong: oklch(18% 0.020 235 / 28%);
  --color-chart-grid: oklch(20% 0.025 235 / 12%);
  --chart-accent: var(--color-accent-secondary);
  --chart-primary: var(--color-accent);
  --chart-primary-soft: var(--color-accent-chart-soft);
  --chart-success: var(--color-success-token);
  --chart-danger: var(--color-danger-token);
  --chart-neutral: var(--color-ink-muted);
  --chart-grid: var(--color-chart-grid);
  --chart-text: var(--color-ink-muted);
  --chart-surface: var(--color-paper-raised);
  --font-display: var(--font-source-serif-4), ui-serif, Georgia, serif;
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
  --text-xl: 1.75rem;
  --text-display: clamp(2.25rem, 4vw, 3rem);
  --radius-control: 4px;
  --radius-panel: 2px;
  --radius-dialog: 6px;
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
    "paper": { "$value": "oklch(96.5% 0.012 220)", "$type": "color" },
    "paperRaised": { "$value": "oklch(98.5% 0.007 220)", "$type": "color" },
    "paperMuted": { "$value": "oklch(93% 0.018 220)", "$type": "color" },
    "ink": { "$value": "oklch(20% 0.025 235)", "$type": "color" },
    "inkSecondary": { "$value": "oklch(30% 0.025 235)", "$type": "color" },
    "inkChartSoft": { "$value": "oklch(30% 0.025 235 / 18%)", "$type": "color" },
    "inkMuted": { "$value": "oklch(42% 0.025 235)", "$type": "color" },
    "rule": { "$value": "oklch(80% 0.020 225)", "$type": "color" },
    "ruleStrong": { "$value": "oklch(66% 0.025 225)", "$type": "color" },
    "ruleFaint": { "$value": "oklch(89% 0.014 225)", "$type": "color" },
    "accent": { "$value": "oklch(42% 0.150 230)", "$type": "color" },
    "accentHover": { "$value": "oklch(36% 0.135 230)", "$type": "color" },
    "accentStrong": { "$value": "oklch(32% 0.120 230)", "$type": "color" },
    "accentSoft": { "$value": "oklch(92% 0.035 230)", "$type": "color" },
    "accentSecondary": { "$value": "oklch(44% 0.100 175)", "$type": "color" },
    "accentChartSoft": { "$value": "oklch(42% 0.150 230 / 18%)", "$type": "color" },
    "accentInk": { "$value": "oklch(98% 0.006 220)", "$type": "color" },
    "focus": { "$value": "oklch(48% 0.180 245)", "$type": "color" },
    "success": { "$value": "oklch(42% 0.120 155)", "$type": "color" },
    "successSoft": { "$value": "oklch(93% 0.025 155)", "$type": "color" },
    "warning": { "$value": "oklch(52% 0.120 80)", "$type": "color" },
    "warningSoft": { "$value": "oklch(94% 0.025 85)", "$type": "color" },
    "danger": { "$value": "oklch(48% 0.165 25)", "$type": "color" },
    "dangerSoft": { "$value": "oklch(94% 0.030 25)", "$type": "color" },
    "overlay": { "$value": "oklch(18% 0.020 235 / 72%)", "$type": "color" },
    "shadowSoft": { "$value": "oklch(18% 0.020 235 / 10%)", "$type": "color" },
    "shadowMedium": { "$value": "oklch(18% 0.020 235 / 16%)", "$type": "color" },
    "shadowStrong": { "$value": "oklch(18% 0.020 235 / 28%)", "$type": "color" },
    "chartGrid": { "$value": "oklch(20% 0.025 235 / 12%)", "$type": "color" }
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
    "display": { "$value": "var(--font-source-serif-4), ui-serif, Georgia, serif", "$type": "fontFamily" },
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
    "xl": { "$value": "1.75rem", "$type": "dimension" },
    "display": { "$value": "clamp(2.25rem, 4vw, 3rem)", "$type": "string" }
  },
  "radius": {
    "control": { "$value": "4px", "$type": "dimension" },
    "panel": { "$value": "2px", "$type": "dimension" },
    "dialog": { "$value": "6px", "$type": "dimension" },
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
  --background: 96.5% 0.012 220;
  --foreground: 20% 0.025 235;
  --primary: 42% 0.150 230;
  --primary-foreground: 98% 0.006 220;
  --muted: 96.5% 0.012 220;
  --muted-foreground: 42% 0.025 235;
  --border: 80% 0.020 225;
  --input: 80% 0.020 225;
  --ring: 48% 0.180 245;
  --radius: 4px;

  --o-okul-color-paper: oklch(96.5% 0.012 220);
  --o-okul-color-paper-raised: oklch(98.5% 0.007 220);
  --o-okul-color-paper-muted: oklch(93% 0.018 220);
  --o-okul-color-ink: oklch(20% 0.025 235);
  --o-okul-color-ink-secondary: oklch(30% 0.025 235);
  --o-okul-color-ink-chart-soft: oklch(30% 0.025 235 / 18%);
  --o-okul-color-ink-muted: oklch(42% 0.025 235);
  --o-okul-color-rule: oklch(80% 0.020 225);
  --o-okul-color-rule-strong: oklch(66% 0.025 225);
  --o-okul-color-rule-faint: oklch(89% 0.014 225);
  --o-okul-color-accent: oklch(42% 0.150 230);
  --o-okul-color-accent-hover: oklch(36% 0.135 230);
  --o-okul-color-accent-strong: oklch(32% 0.120 230);
  --o-okul-color-accent-soft: oklch(92% 0.035 230);
  --o-okul-color-accent-secondary: oklch(44% 0.100 175);
  --o-okul-color-accent-chart-soft: oklch(42% 0.150 230 / 18%);
  --o-okul-color-accent-ink: oklch(98% 0.006 220);
  --o-okul-color-focus: oklch(48% 0.180 245);
  --o-okul-color-success: oklch(42% 0.120 155);
  --o-okul-color-success-soft: oklch(93% 0.025 155);
  --o-okul-color-warning: oklch(52% 0.120 80);
  --o-okul-color-warning-soft: oklch(94% 0.025 85);
  --o-okul-color-danger: oklch(48% 0.165 25);
  --o-okul-color-danger-soft: oklch(94% 0.030 25);
  --o-okul-color-overlay: oklch(18% 0.020 235 / 72%);
  --o-okul-color-shadow-soft: oklch(18% 0.020 235 / 10%);
  --o-okul-color-shadow-medium: oklch(18% 0.020 235 / 16%);
  --o-okul-color-shadow-strong: oklch(18% 0.020 235 / 28%);
  --o-okul-color-chart-grid: oklch(20% 0.025 235 / 12%);
  --o-okul-chart-accent: var(--o-okul-color-accent-secondary);
  --o-okul-chart-primary: var(--o-okul-color-accent);
  --o-okul-chart-primary-soft: var(--o-okul-color-accent-chart-soft);
  --o-okul-chart-success: var(--o-okul-color-success);
  --o-okul-chart-danger: var(--o-okul-color-danger);
  --o-okul-chart-neutral: var(--o-okul-color-ink-muted);
  --o-okul-chart-grid: var(--o-okul-color-chart-grid);
  --o-okul-chart-text: var(--o-okul-color-ink-muted);
  --o-okul-chart-surface: var(--o-okul-color-paper-raised);
  --o-okul-font-display: var(--font-source-serif-4), ui-serif, Georgia, serif;
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
  --o-okul-text-xl: 1.75rem;
  --o-okul-text-display: clamp(2.25rem, 4vw, 3rem);
  --o-okul-radius-control: 4px;
  --o-okul-radius-panel: 2px;
  --o-okul-radius-dialog: 6px;
  --o-okul-radius-pill: 999px;
  --o-okul-duration-instant: 100ms;
  --o-okul-duration-short: 180ms;
  --o-okul-duration-long: 320ms;
  --o-okul-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --o-okul-ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```
