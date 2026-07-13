# UI/UX Professionalization Contract

Tarih: 2026-06-17

Bu sozlesme o-okul arayuzunu operasyonel egitim SaaS'i olarak profesyonellestirmek icin
kilitlenen tasarim, guvenlik ve kabul kurallarini tanimlar. Kapsam; mevcut Next.js app router,
`packages/ui`, Chart.js rapor bilesenleri ve rol bazli portallar uzerinden ilerler. Yeni admin
template, shadcn/Tremor/Recharts/TanStack Table eklenmez.

## Visual Direction

- Ton: operasyonel, veri yogun, sessiz ve karar odakli.
- Admin ekranlari: hizli taranabilir metrikler, yogun listeler, net aksiyonlar.
- Portal ekranlari: ogrenci, veli ve ogretmen icin sade gunluk durum ve aksiyon ozeti.
- Rapor/karne: notr profesyonel sablon, kontrollu kurum logo/ad alani, `Basari %` ana metrik.
- Kart kullanimi: tekrar eden item, panel, modal ve gercek arac yuzeyleriyle sinirli kalir; tam
  sayfa kart gorunumu yeni ekranlarda kullanilmaz.

## Route And Persona Matrix

| Persona | Primary routes | UX intent | Guardrail |
| --- | --- | --- | --- |
| `SYSTEM_ADMIN` | `/sistem`, `/sistem/kurumlar`, `/sistem/sistem-sagligi`, `/sistem/gozlemlenebilirlik`, `/sistem/denetim` | Tenant, saglik, audit ve release durumu | Cross-tenant erisim yalniz API/RLS bypass guard ile |
| `TENANT_ADMIN` | `/kurum/**` | Kurum operasyon merkezi | Her route/action shared capability ile eslesir |
| `ASSISTANT_ADMIN` | Kisi, egitim, yoklama, duyuru, destek | Gunluk kurum operasyonu | Finans, kullanici, privacy, security, operation alanlari gizli kalir |
| `TEACHER` | `/ogretmen`, atanmisc kapsam rapor/ogrenci okuma | Ders/sinif odakli isler | Assigned scope disi veri gorunmez |
| `STUDENT` | `/ogrenci` | Kendi profil, odev, devamsizlik, not ve rapor | Self-scope disina cikamaz |
| `GUARDIAN` | `/veli` | Bagli ogrenci, izinli finans, duyuru, destek | `canViewFinance` ve bagli ogrenci izni korunur |

## Token Contract

Tokenlar CSS custom property olarak baslar ve `apps/web/app/globals.css` icinde uygulanir.

- Color: text, muted text, border, surface, background, primary, success, warning, danger, info.
- Type: body, compact label, panel heading, page heading; viewport genisligine gore font scale yok.
- Spacing: 4/6/8/10/12/16/20/24/32 px tabanli araliklar.
- Radius: default 7px, panel 8px; kartlar 8px ustune cikmaz.
- Focus: en az 2px gorunur outline, buton/input/select/table action kapsaminda tutarli.
- Density: comfortable ve compact table/list modlari.
- Chart: success-rate-first palette; `Basari %`, `Net`, `Soru` birlikte gosterilir.

## Component Contract

`packages/ui` bu profesyonel SaaS primitiflerini saglar:

- `Panel`, `MetricCard`, `StatusBadge`
- `FilterBar`, `Toolbar`, `Pagination`
- `Tabs`, `TabButton`, `SegmentedControl`
- `Field`, `Select`, `Textarea`
- `Alert`, `Skeleton`, `Drawer`, `Tooltip`
- Genişletilmis `DataTable`: caption, description, density, loading/error/empty rows, align,
  priority ve sticky column metadata.
- `CrudPage` kisi ve kurum operasyon listelerinde opsiyonel summary slotu ile tablo ustu sayisal
  baglam, masked PII durumu ve RBAC-derived aksiyon etiketlerini gosterebilir.
- Akademik yapi CRUD ekranlari (kampus, seviye, sinif, ders) ayni summary slotu, caption,
  tableDescription ve `Field`/`Select` form standardi ile ilerler.
- Her route icin tek sayfa basligi `PageFrame` tarafindan uretilir; ic `CrudPage` basligi opsiyoneldir.
- Devamsizlik, sinif+tarih secimi sonrasi o tarihteki enrollment kayitlarindan uretilen ogrenci
  listesini tek API cevabi ve tek kaydetme islemiyle yoneten gunluk yoklama yuzeyidir. Genel
  metrikler pagination satirlarindan hesaplanmaz; transfer gecmisi guncel sinifa tasinmaz.
- Ogrenci detay ve 360 yuzeyleri materyal basina istek acmaz; ogrenci-kapsamli toplu atama
  cevabini kullanir.

Eski `Button`, `Input`, `CrudPage`, `DataTable` kullanimlari geriye uyumlu kalir.

## Modernization Exception

`DEC-20260627-01` kapsaminda onaylanan modernizasyon dalgalari DB, API, OpenAPI ve
`packages/shared-types` sozlesmelerini birlikte degistirebilir. Bu istisna yalnız ilgili
migration/API dilimi ve kanit gate'leriyle kullanilir.

## Report And Karne Contract

- Rapor karsilastirmalarinda ana metrik `Basari %` olur.
- `Net`, `Soru`, standart puan, dogru/yanlis/bos ve siralama baglam olarak gorunur kalir.
- `/kurum/raporlar` gorev odakli workspace olarak calisir: Sorgu/Uretim, Kurum Analitigi,
  Ogrenci Sonuclari, Karne Onizleme, Ciktilar.
- `/kurum/optik` sablon, parser, yukleme, karantina ve degerlendirme adimlariyla sinirlidir; rapor
  uretim ve cikti islemleri secili sinav baglamiyla `/kurum/raporlar` yuzeyine devredilir.
- Ogrenci, veli ve ogretmen portallari yetkili `READY` rapor indeksinden gorunur sinav secimi yapar;
  sabit demo sinav kimligi kullanilmaz.
- Queue isi (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`) ile immutable snapshot durumu ayri
  sozlesmelerdir. UI uretimi `jobId` ile izler, tamamlaninca donen snapshot'i yeniler.
- Karne ve rapor satirlarinda snapshot icindeki dondurulmus `displayName`/`studentNo` onceliklidir;
  guncel ogrenci kaydi yalniz eski snapshot'lar icin geri uyumlu yedektir.
- Export aksiyonlari yalniz `READY` snapshot icin etkin olur; `STALE`, `PENDING` ve `FAILED`
  durumlari acikca gosterilir.
- Web karne ve worker PDF sablonlari ayni notr gorsel sozlesmeye yaklastirilir; hesaplama ve
  `ReportSnapshot` semantigi degismez.

## Security And Privacy Contract

- UI tenant isolation kaynagi degildir; server context, API guard ve RLS kaynak olmaya devam eder.
- Yeni dashboard, filtre, global search veya export client-supplied `tenantId` degerine guvenmez.
- Yeni `/kurum/*` route/action/command item shared capability veya hidden capability mapping
  olmadan eklenmez.
- Role preview salt-okuma, tenant-bound ve kisa omurlu kalir.
- TC, telefon, e-posta, veli finans izni ve role-preview ayrintilari screenshot/evidence, breadcrumb,
  empty state, command search veya log metninde ham olarak acilmaz.
- Ogrenci edit formlarinda kayitli telefon ve e-posta hintleri ham deger yerine maskeli deger
  gosterir; tam deger yalniz kullanicinin aktif girdisinde tutulur.

## Acceptance Gates

- Foundation/UI: `pnpm --filter @o-okul/ui typecheck`, `pnpm --filter @o-okul/web typecheck`,
  `pnpm web:a11y:check`, `pnpm web:ux-baseline:check`.
- Report/karne: `pnpm --filter @o-okul/worker test`, `pnpm raw-import:smoke`,
  `pnpm report-generation:smoke`, `pnpm karne:visual-contract:check`.
- Security/privacy: `pnpm db:rls:check`, `pnpm tenant-db:check`, `pnpm web:token-storage:check`,
  `pnpm admin-mfa:check`, `pnpm rate-limit:check`, `pnpm security:audit:check`,
  `pnpm privacy:inventory:check`.
- Evidence/release: `pnpm prod:evidence:templates:check`, `pnpm prod:plan:check`,
  `pnpm prod:env:check`.
