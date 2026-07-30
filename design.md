# Design — O-Okul

O-Okul için kilitli, çok sayfalı tasarım sistemi. Her yeni web yüzeyi bu
dosyayı ve `tokens.css` değişkenlerini kullanır; route, yetki ve veri
sözleşmeleri görsel sistemden bağımsızdır.

## Genre

Modern-minimal; operasyonel, teknik ve sakin. Ekranlar dekoratif kart
duvarları değil, görev, durum ve sonraki aksiyon hiyerarşisi kurar.

## Macrostructure family

- Landing: Narrative Workflow. Optik → rapor → portal akışını gerçek ürün diliyle
  gösterir; uydurma metrik, logo, yorum veya sahte tarayıcı çerçevesi kullanmaz.
- App: component-scope. Shell, route ve yetki yapısı korunur; dashboard,
  liste, detay, iş akışı ve portal bileşenleri aynı tokenları ve eylem dilini
  paylaşır.
- Content/evidence: Index-first. Durum matrisi, zaman çizgisi ve kayıt önce
  gelir; local, staging ve canlı kanıt birbirine karıştırılmaz.

## Theme — Grafit + Mercan

Kanonik değerler bu dosyanın `### tokens.css` ihracındadır; kökteki
`tokens.css` bu bloğun birebir üretim kopyasıdır.

Mercan; birincil eylem, aktif öğe, link ve focus halkasıyla sınırlıdır.
Durumlar renk yanında ikon veya açık metin etiketi taşır.
Grafiklerin ana serisi grafit, seçili veya vurgulu serisi mercandır; başarı,
uyarı ve hata serileri kendi semantik tokenlarını kullanır.

## Typography

- Display: Space Grotesk, weight 600–700, normal.
- Body: IBM Plex Sans, weight 400–600.
- Mono: mevcut sistem monospace yığını.
- Display tracking: `-0.025em`.
- Ölçek: 12 / 14 / 16 / 20 / 28 px; landing display en fazla 48 px.
- Sayılar ve uygulama tabloları `font-variant-numeric: tabular-nums` kullanır.
  Dondurulmuş `.next-karne-sheet` tabloları Arial geometrisini korur ve bu
  genel sayı kuralını devralmaz.

Başlıklar hiçbir zaman italik değildir. Uzun başlıklar `overflow-wrap:
anywhere` ile kendi kolonunda kalır.

## Spacing and shape

4-point named scale `tokens.css` içindedir: 4 / 8 / 12 / 16 / 24 / 32 /
48 / 64 px. Kontroller en az 44 px, dokunmatik yüzeylerde 48 px olur.
Radius yalnız 6 / 10 / 14 px kullanır. Gölge dialog, popover ve geçici
katmanlarla sınırlıdır.

## Motion

- Süreler: 120 / 220 / 420 ms.
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

- Primary: mercan dolgu, kısa fiil + nesne; tek satır.
- Secondary: yükseltilmiş yüzey üzerinde grafit sınır; tek satır.
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

`/* Hallmark · pre-emit critique: P4 H4 E4 S5 R5 V4 */`

## Exports

Bu örnekler taşınabilir eşleştirmedir; O-Okul üretiminde Tailwind, DTCG veya
shadcn bağımlılığı kurmaz.

### tokens.css

```css
/* Hallmark · pre-emit critique: P4 H4 E4 S5 R5 V4 */
/* Hallmark · genre: modern-minimal · landing: Narrative Workflow · app: component-scope · theme: custom (Grafit + Mercan) */
:root {
  --color-paper: oklch(95.5% 0.012 70);
  --color-paper-raised: oklch(99% 0.004 70);
  --color-paper-muted: oklch(92.5% 0.014 70);
  --color-ink: oklch(21% 0.018 260);
  --color-ink-secondary: oklch(32% 0.02 260);
  --color-ink-chart-soft: oklch(32% 0.02 260 / 14%);
  --color-ink-muted: oklch(43% 0.02 260);
  --color-rule: oklch(84% 0.015 70);
  --color-rule-strong: oklch(73% 0.018 70);
  --color-rule-faint: oklch(90% 0.012 70);
  --color-accent: oklch(56% 0.17 35);
  --color-accent-hover: oklch(50% 0.17 35);
  --color-accent-strong: oklch(40% 0.16 35);
  --color-accent-soft: oklch(94% 0.035 35);
  --color-accent-chart-soft: oklch(56% 0.17 35 / 16%);
  --color-accent-ink: oklch(99% 0.004 70);
  --color-focus: oklch(56% 0.17 35);
  --color-success-token: oklch(43% 0.11 160);
  --color-success-soft-token: oklch(94% 0.035 160);
  --color-warning-token: oklch(48% 0.11 75);
  --color-warning-soft-token: oklch(95% 0.04 75);
  --color-danger-token: oklch(47% 0.17 20);
  --color-danger-soft-token: oklch(94% 0.035 20);
  --color-overlay-token: oklch(18% 0.02 260 / 46%);
  --color-shadow-soft: oklch(21% 0.018 260 / 6%);
  --color-shadow-medium: oklch(21% 0.018 260 / 12%);
  --color-shadow-strong: oklch(21% 0.018 260 / 22%);
  --color-chart-grid: oklch(21% 0.018 260 / 8%);

  --chart-accent: var(--color-accent);
  --chart-primary: var(--color-ink-secondary);
  --chart-primary-soft: var(--color-ink-chart-soft);
  --chart-success: var(--color-success-token);
  --chart-danger: var(--color-danger-token);
  --chart-neutral: var(--color-ink-muted);
  --chart-grid: var(--color-chart-grid);
  --chart-text: var(--color-ink-muted);
  --chart-surface: var(--color-paper-raised);

  --font-display: var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif;
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

  --radius-control: 6px;
  --radius-panel: 10px;
  --radius-dialog: 14px;
  --dur-instant: 120ms;
  --dur-short: 220ms;
  --dur-long: 420ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(95.5% 0.012 70);
  --color-paper-raised: oklch(99% 0.004 70);
  --color-paper-muted: oklch(92.5% 0.014 70);
  --color-ink: oklch(21% 0.018 260);
  --color-ink-secondary: oklch(32% 0.02 260);
  --color-ink-chart-soft: oklch(32% 0.02 260 / 14%);
  --color-ink-muted: oklch(43% 0.02 260);
  --color-rule: oklch(84% 0.015 70);
  --color-rule-strong: oklch(73% 0.018 70);
  --color-rule-faint: oklch(90% 0.012 70);
  --color-accent: oklch(56% 0.17 35);
  --color-accent-hover: oklch(50% 0.17 35);
  --color-accent-strong: oklch(40% 0.16 35);
  --color-accent-soft: oklch(94% 0.035 35);
  --color-accent-chart-soft: oklch(56% 0.17 35 / 16%);
  --color-accent-ink: oklch(99% 0.004 70);
  --color-focus: oklch(56% 0.17 35);
  --color-success-token: oklch(43% 0.11 160);
  --color-success-soft-token: oklch(94% 0.035 160);
  --color-warning-token: oklch(48% 0.11 75);
  --color-warning-soft-token: oklch(95% 0.04 75);
  --color-danger-token: oklch(47% 0.17 20);
  --color-danger-soft-token: oklch(94% 0.035 20);
  --color-overlay-token: oklch(18% 0.02 260 / 46%);
  --color-shadow-soft: oklch(21% 0.018 260 / 6%);
  --color-shadow-medium: oklch(21% 0.018 260 / 12%);
  --color-shadow-strong: oklch(21% 0.018 260 / 22%);
  --color-chart-grid: oklch(21% 0.018 260 / 8%);
  --chart-accent: var(--color-accent);
  --chart-primary: var(--color-ink-secondary);
  --chart-primary-soft: var(--color-ink-chart-soft);
  --chart-success: var(--color-success-token);
  --chart-danger: var(--color-danger-token);
  --chart-neutral: var(--color-ink-muted);
  --chart-grid: var(--color-chart-grid);
  --chart-text: var(--color-ink-muted);
  --chart-surface: var(--color-paper-raised);
  --font-display: var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif;
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
  --radius-control: 6px;
  --radius-panel: 10px;
  --radius-dialog: 14px;
  --duration-instant: 120ms;
  --duration-short: 220ms;
  --duration-long: 420ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper": { "$value": "oklch(95.5% 0.012 70)", "$type": "color" },
    "paperRaised": { "$value": "oklch(99% 0.004 70)", "$type": "color" },
    "paperMuted": { "$value": "oklch(92.5% 0.014 70)", "$type": "color" },
    "ink": { "$value": "oklch(21% 0.018 260)", "$type": "color" },
    "inkSecondary": { "$value": "oklch(32% 0.02 260)", "$type": "color" },
    "inkChartSoft": { "$value": "oklch(32% 0.02 260 / 14%)", "$type": "color" },
    "inkMuted": { "$value": "oklch(43% 0.02 260)", "$type": "color" },
    "rule": { "$value": "oklch(84% 0.015 70)", "$type": "color" },
    "ruleStrong": { "$value": "oklch(73% 0.018 70)", "$type": "color" },
    "ruleFaint": { "$value": "oklch(90% 0.012 70)", "$type": "color" },
    "accent": { "$value": "oklch(56% 0.17 35)", "$type": "color" },
    "accentHover": { "$value": "oklch(50% 0.17 35)", "$type": "color" },
    "accentStrong": { "$value": "oklch(40% 0.16 35)", "$type": "color" },
    "accentSoft": { "$value": "oklch(94% 0.035 35)", "$type": "color" },
    "accentChartSoft": { "$value": "oklch(56% 0.17 35 / 16%)", "$type": "color" },
    "accentInk": { "$value": "oklch(99% 0.004 70)", "$type": "color" },
    "focus": { "$value": "oklch(56% 0.17 35)", "$type": "color" },
    "success": { "$value": "oklch(43% 0.11 160)", "$type": "color" },
    "successSoft": { "$value": "oklch(94% 0.035 160)", "$type": "color" },
    "warning": { "$value": "oklch(48% 0.11 75)", "$type": "color" },
    "warningSoft": { "$value": "oklch(95% 0.04 75)", "$type": "color" },
    "danger": { "$value": "oklch(47% 0.17 20)", "$type": "color" },
    "dangerSoft": { "$value": "oklch(94% 0.035 20)", "$type": "color" },
    "overlay": { "$value": "oklch(18% 0.02 260 / 46%)", "$type": "color" },
    "shadowSoft": { "$value": "oklch(21% 0.018 260 / 6%)", "$type": "color" },
    "shadowMedium": { "$value": "oklch(21% 0.018 260 / 12%)", "$type": "color" },
    "shadowStrong": { "$value": "oklch(21% 0.018 260 / 22%)", "$type": "color" },
    "chartGrid": { "$value": "oklch(21% 0.018 260 / 8%)", "$type": "color" }
  },
  "chart": {
    "accent": { "$value": "{color.accent}", "$type": "color" },
    "primary": { "$value": "{color.inkSecondary}", "$type": "color" },
    "primarySoft": { "$value": "{color.inkChartSoft}", "$type": "color" },
    "success": { "$value": "{color.success}", "$type": "color" },
    "danger": { "$value": "{color.danger}", "$type": "color" },
    "neutral": { "$value": "{color.inkMuted}", "$type": "color" },
    "grid": { "$value": "{color.chartGrid}", "$type": "color" },
    "text": { "$value": "{color.inkMuted}", "$type": "color" },
    "surface": { "$value": "{color.paperRaised}", "$type": "color" }
  },
  "font": {
    "display": { "$value": "var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif", "$type": "fontFamily" },
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
    "control": { "$value": "6px", "$type": "dimension" },
    "panel": { "$value": "10px", "$type": "dimension" },
    "dialog": { "$value": "14px", "$type": "dimension" }
  },
  "duration": {
    "instant": { "$value": "120ms", "$type": "duration" },
    "short": { "$value": "220ms", "$type": "duration" },
    "long": { "$value": "420ms", "$type": "duration" }
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
  --background: 95.5% 0.012 70;
  --foreground: 21% 0.018 260;
  --primary: 56% 0.17 35;
  --primary-foreground: 99% 0.004 70;
  --muted: 95.5% 0.012 70;
  --muted-foreground: 43% 0.02 260;
  --border: 84% 0.015 70;
  --input: 84% 0.015 70;
  --ring: 56% 0.17 35;
  --radius: 6px;

  --o-okul-color-paper: oklch(95.5% 0.012 70);
  --o-okul-color-paper-raised: oklch(99% 0.004 70);
  --o-okul-color-paper-muted: oklch(92.5% 0.014 70);
  --o-okul-color-ink: oklch(21% 0.018 260);
  --o-okul-color-ink-secondary: oklch(32% 0.02 260);
  --o-okul-color-ink-chart-soft: oklch(32% 0.02 260 / 14%);
  --o-okul-color-ink-muted: oklch(43% 0.02 260);
  --o-okul-color-rule: oklch(84% 0.015 70);
  --o-okul-color-rule-strong: oklch(73% 0.018 70);
  --o-okul-color-rule-faint: oklch(90% 0.012 70);
  --o-okul-color-accent: oklch(56% 0.17 35);
  --o-okul-color-accent-hover: oklch(50% 0.17 35);
  --o-okul-color-accent-strong: oklch(40% 0.16 35);
  --o-okul-color-accent-soft: oklch(94% 0.035 35);
  --o-okul-color-accent-chart-soft: oklch(56% 0.17 35 / 16%);
  --o-okul-color-accent-ink: oklch(99% 0.004 70);
  --o-okul-color-focus: oklch(56% 0.17 35);
  --o-okul-color-success: oklch(43% 0.11 160);
  --o-okul-color-success-soft: oklch(94% 0.035 160);
  --o-okul-color-warning: oklch(48% 0.11 75);
  --o-okul-color-warning-soft: oklch(95% 0.04 75);
  --o-okul-color-danger: oklch(47% 0.17 20);
  --o-okul-color-danger-soft: oklch(94% 0.035 20);
  --o-okul-color-overlay: oklch(18% 0.02 260 / 46%);
  --o-okul-color-shadow-soft: oklch(21% 0.018 260 / 6%);
  --o-okul-color-shadow-medium: oklch(21% 0.018 260 / 12%);
  --o-okul-color-shadow-strong: oklch(21% 0.018 260 / 22%);
  --o-okul-color-chart-grid: oklch(21% 0.018 260 / 8%);
  --o-okul-chart-accent: var(--o-okul-color-accent);
  --o-okul-chart-primary: var(--o-okul-color-ink-secondary);
  --o-okul-chart-primary-soft: var(--o-okul-color-ink-chart-soft);
  --o-okul-chart-success: var(--o-okul-color-success);
  --o-okul-chart-danger: var(--o-okul-color-danger);
  --o-okul-chart-neutral: var(--o-okul-color-ink-muted);
  --o-okul-chart-grid: var(--o-okul-color-chart-grid);
  --o-okul-chart-text: var(--o-okul-color-ink-muted);
  --o-okul-chart-surface: var(--o-okul-color-paper-raised);
  --o-okul-font-display: var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif;
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
  --o-okul-radius-control: 6px;
  --o-okul-radius-panel: 10px;
  --o-okul-radius-dialog: 14px;
  --o-okul-duration-instant: 120ms;
  --o-okul-duration-short: 220ms;
  --o-okul-duration-long: 420ms;
  --o-okul-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --o-okul-ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```
