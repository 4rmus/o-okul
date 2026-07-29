# Design — O-Okul

O-Okul için kilitli, çok sayfalı tasarım sistemi. Her yeni web yüzeyi bu
dosyayı ve `tokens.css` değişkenlerini kullanır; route, yetki ve veri
sözleşmeleri görsel sistemden bağımsızdır.

## Genre

Modern-minimal; operasyonel, teknik ve sakin. Ekranlar dekoratif kart
duvarları değil, görev, durum ve sonraki aksiyon hiyerarşisi kurar.

## Macrostructure family

- Marketing: Workbench. Optik → rapor → portal akışını gerçek ürün diliyle
  gösterir; uydurma metrik, logo, yorum veya sahte tarayıcı çerçevesi kullanmaz.
- App: Workbench. Shell içinde dashboard, liste, detay, iş akışı ve portal
  varyantları aynı tokenları ve eylem dilini paylaşır.
- Content/evidence: Index-first. Durum matrisi, zaman çizgisi ve kayıt önce
  gelir; local, staging ve canlı kanıt birbirine karıştırılmaz.

## Theme — Grafit + Mercan

- `--color-paper`: `oklch(95.5% 0.012 70)`
- `--color-paper-raised`: `oklch(99% 0.004 70)`
- `--color-ink`: `oklch(21% 0.018 260)`
- `--color-ink-muted`: `oklch(43% 0.020 260)`
- `--color-rule`: `oklch(84% 0.015 70)`
- `--color-accent`: `oklch(56% 0.170 35)`
- `--color-accent-hover`: `oklch(50% 0.170 35)`
- `--color-accent-strong`: `oklch(40% 0.160 35)`
- `--color-accent-soft`: `oklch(94% 0.035 35)`
- `--color-focus`: `oklch(56% 0.170 35)`

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
- Sayılar ve tablolar `font-variant-numeric: tabular-nums` kullanır.

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

- Responsive sözleşme 320 / 375 / 414 / 768 / 1024 / 1440 px'te; landing
  fold sözleşmesi ayrıca 1280 × 800 px'te doğrulanır.
- Login paneli (414), kurum rail'i (1440), öğrenci öncelikli aksiyon şeridi
  (414) ve rapor durum bölgesi (1440) Darwin ve Linux golden'larıyla korunur.
- Mevcut karne golden'ı ayrı sözleşmedir; bu web yeniden tasarımı onu
  topluca güncellemez.

## Hallmark

`/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */`

## Exports

Bu örnekler taşınabilir eşleştirmedir; O-Okul üretiminde Tailwind, DTCG veya
shadcn bağımlılığı kurmaz.

### tokens.css

```css
:root {
  --color-paper: oklch(95.5% 0.012 70);
  --color-paper-raised: oklch(99% 0.004 70);
  --color-ink: oklch(21% 0.018 260);
  --color-ink-muted: oklch(43% 0.020 260);
  --color-rule: oklch(84% 0.015 70);
  --color-accent: oklch(56% 0.170 35);
  --color-accent-hover: oklch(50% 0.170 35);
  --color-accent-strong: oklch(40% 0.160 35);
  --color-accent-soft: oklch(94% 0.035 35);
  --color-focus: oklch(56% 0.170 35);
  --font-display: var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif;
  --font-body: var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --space-md: 1.5rem;
  --radius-control: 6px;
  --dur-short: 220ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(95.5% 0.012 70);
  --color-paper-raised: oklch(99% 0.004 70);
  --color-ink: oklch(21% 0.018 260);
  --color-ink-muted: oklch(43% 0.020 260);
  --color-rule: oklch(84% 0.015 70);
  --color-accent: oklch(56% 0.170 35);
  --color-accent-hover: oklch(50% 0.170 35);
  --color-accent-strong: oklch(40% 0.160 35);
  --color-accent-soft: oklch(94% 0.035 35);
  --color-focus: oklch(56% 0.170 35);
  --font-display: var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif;
  --font-body: var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --spacing-md: 1.5rem;
  --radius-control: 6px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper": { "$value": "oklch(95.5% 0.012 70)", "$type": "color" },
    "paperRaised": { "$value": "oklch(99% 0.004 70)", "$type": "color" },
    "ink": { "$value": "oklch(21% 0.018 260)", "$type": "color" },
    "inkMuted": { "$value": "oklch(43% 0.020 260)", "$type": "color" },
    "rule": { "$value": "oklch(84% 0.015 70)", "$type": "color" },
    "accent": { "$value": "oklch(56% 0.170 35)", "$type": "color" },
    "accentHover": { "$value": "oklch(50% 0.170 35)", "$type": "color" },
    "accentStrong": { "$value": "oklch(40% 0.160 35)", "$type": "color" },
    "accentSoft": { "$value": "oklch(94% 0.035 35)", "$type": "color" },
    "focus": { "$value": "oklch(56% 0.170 35)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Space Grotesk", "$type": "fontFamily" },
    "body": { "$value": "IBM Plex Sans", "$type": "fontFamily" }
  },
  "space": {
    "md": { "$value": "1.5rem", "$type": "dimension" }
  },
  "radius": {
    "control": { "$value": "6px", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 95.5% 0.012 70;
  --foreground: 21% 0.018 260;
  --primary: 56% 0.170 35;
  --primary-foreground: 99% 0.004 70;
  --muted: 95.5% 0.012 70;
  --muted-foreground: 43% 0.020 260;
  --border: 84% 0.015 70;
  --input: 84% 0.015 70;
  --ring: 56% 0.170 35;
  --radius: 6px;
}
```
