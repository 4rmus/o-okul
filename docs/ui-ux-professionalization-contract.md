# UI/UX Professionalization Contract

Tarih: 2026-06-17

Bu sozlesme o-okul arayuzunu operasyonel egitim SaaS'i olarak profesyonellestirmek icin
kilitlenen tasarim, guvenlik ve kabul kurallarini tanimlar. Kapsam; mevcut Next.js app router,
`packages/ui`, Chart.js rapor bilesenleri ve rol bazli portallar uzerinden ilerler. Yeni admin
template, shadcn/Tremor/Recharts/TanStack Table eklenmez. Urun/persona gercegi
`docs/product-journeys-v1.md`, kullaniciya donuk terimler ve iddialar `docs/marketing-claims.md`
ile birlikte okunur.

## Visual Direction

- Ton: operasyonel, veri yogun, sessiz ve karar odakli.
- Admin ekranlari: hizli taranabilir metrikler, yogun listeler, net aksiyonlar.
- Portal ekranlari: hedefte ogrenci ve ogretmen icin sade gunluk durum ve aksiyon ozeti; mevcut
  veli portali yalniz gecis guvenligi ve runtime uyumlulugu icin korunur.
- Rapor/karne: notr profesyonel sablon, kontrollu kurum logo/ad alani, `Basari %` ana metrik.
- Kart kullanimi: tekrar eden item, panel, modal ve gercek arac yuzeyleriyle sinirli kalir; tam
  sayfa kart gorunumu yeni ekranlarda kullanilmaz.

## Route And Persona Matrix

### Mevcut gecis runtime'i

| Persona | Primary routes | UX intent | Guardrail |
| --- | --- | --- | --- |
| `SYSTEM_ADMIN` | `/sistem`, `/sistem/kurumlar`, `/sistem/sistem-sagligi`, `/sistem/gozlemlenebilirlik`, `/sistem/denetim` | Platform, saglik, audit ve release durumu | Gecis yuzeyidir; musteri navigasyonuna girmez ve hedef control-plane tamamlanmis sayilmaz |
| `TENANT_OWNER` / `TENANT_ADMIN` | `/kurum/**` | Kurum operasyon merkezi | Her route/action shared capability ile eslesir |
| `ASSISTANT_ADMIN` / `OPERATIONS_STAFF` | Kisi, egitim, yoklama, duyuru, destek | Gunluk kurum operasyonu | Finans, kullanici, privacy, security ve platform alanlari gizli kalir |
| `FINANCE_STAFF` | Kurum finans yuzeyleri | Odeme plani ve taksit takibi | Akademik sonuc ve genis kisi verisi acilmaz |
| `TEACHER` | `/ogretmen`, atanmisc kapsam rapor/ogrenci okuma | Ders/sinif odakli isler | Assigned scope disi veri gorunmez |
| `STUDENT` | `/ogrenci` | Kendi profil, odev, devamsizlik, not ve rapor | Self-scope disina cikamaz |
| `GUARDIAN` | `/veli` | Gecis boyunca bagli ogrenci, izinli finans, duyuru ve destek | Yeni edinim/pazarlama yok; `canViewFinance` ve bagli ogrenci izni emeklilige kadar korunur |

### Hedef urun deneyimi

- Musteri personalari kurum sahibi, kurum yoneticisi, operasyon calisani, finans calisani,
  ogretmen ve ogrencidir. `ASSISTANT_ADMIN` yeni tasarim dili veya onboarding'de buyutulmez.
- `SYSTEM_ADMIN` kurum rolunden ayri control-plane hesabidir. Kurum verisine varsayilan erisimi
  yoktur; breakglass MFA, gerekce, sure ve audit ister. Bu yuzey landing veya musteri menusunde
  pazarlanmaz.
- `GUARDIAN` hedef persona degildir. `StudentContact`, ogrenciye ait hesapsiz iletisim kaydidir;
  login, session, navigation veya portal uretmez.

## Content And Terminology Contract

- UI ve pazarlama metninde `tenant` yerine **kurum**, `tenantSlug/subdomain` yerine **kurumun
  O-Okul adresi**, `loginName` yerine **kurum ici kullanici adi**, `capability/scope` yerine
  **yetki/gorev alani** kullanilir.
- `READY` kullaniciya **Rapor hazir** olarak gosterilir. `RawImport`, `snapshot`, `queue`, `worker`
  ve `control plane` normal kullanici metnine sizmaz.
- Finans yuzeyi **odeme plani, alacak ve taksit takibi** diye anlatilir. Online odeme alma, odeme
  saglayici, fatura veya makbuz vaadi verilmez; bunlar `V1_OUT` kalir.
- Basari ve guvenlik iddialari, kanit seviyesiyle sinirli `docs/marketing-claims.md` matrisinden
  secilir. "Tam guvenli", "KVKK uyumlu", "hatasiz", "anlik" veya "resmi sinav puani" gibi
  kosulsuz ifadeler kullanilmaz.
- Yeni landing, onboarding, help ve empty-state metni hedef personalari kullanir. Guardian dili
  yalniz mevcut kullanici yardimi, migration ve emeklilik iletisiminde kullanilir.

## Onayli Uygulama Dilimleri ve Teslim Durumu

`PR-0` urun plani degildir; completion kaydinin mevcut checker ile uyumlu tabanidir. Kullanici
tarafindan onaylanan uygulama dilimleri `PR-1`–`PR-6` arasindadir. Guncel teslim gercegi
`docs/ui-ux-professionalization-completion.json` icindeki `deliveryStatus` alanidir.

| Dilim | Gunluk kullanici sonucu | Durum | Dosya/test bagi | Acik kalan |
|---|---|---|---|---|
| `PR-1` | Urun dili, persona ve calisma baglami ayni sozlesmeden gelir | `COMPLETE` | `product-journeys-v1.md`, `marketing-claims.md`, `product-terms.ts`, `app-context-next.spec.ts` | Yok; hedefli yerel QA, CI/canli kanit degil |
| `PR-2` | Landing optik akisini anlatir; demo kisisel veri toplamadan e-postaya yonlendirir | `COMPLETE` | `page.tsx`, `iletisim/page.tsx`, `marketing-context-next.spec.ts` | Yok; hedefli yerel QA, CI/canli kanit degil |
| `PR-3` | Arama yazimi korunur; yukleme, hata ve bos durumlar ayrilir; kurulum bes adimdir | `COMPLETE` | `list-controls.tsx`, `crud-page.tsx`, `login-next.spec.ts`, `setup-wizard-contract-next.spec.ts` | Yok; hedefli yerel QA, CI/canli kanit degil |
| `PR-4` | Ana menu gorev odaklidir; uzman araclar ayri indekste; calisma seridi gercek kampus/donem adlarini, portal ozeti oncelikli karar bilgisini gosterir | `COMPLETE` | `navigation.ts`, `app-shell.tsx`, `operasyon-ve-kanit/page.tsx`, `list-url-state-next.spec.ts`, portal ve route-family testleri | Yok; hedefli yerel QA, CI/canli kanit degil |
| `PR-5` | Duyurular kurum genelinde yayinlanir ve kurum ana sayfasinda gorunur; SMS geri donusu zor islemlerden once acik onay ister ve alicilar guncel kurum/izin kapsamiyla yeniden dogrulanir | `COMPLETE` | Duyuru/SMS ekranlari, kurum dashboard'u, `sms-batch.service.ts`, API ve tarayici testleri | Yok; harici SMS ve bildirim saglayicisi canli kaniti ayri |
| `PR-6` | Stil dosyalari davranis degistirmeden temel, shell, portal, rapor, pazarlama ve responsive ailelerine ayrilir | `COMPLETE` | `globals.css`, `_styles/*.css`; token, a11y, UX, visual QA, karne ve performans kapilari | Yok; hedefli yerel QA, CI/canli kanit degil |

`COMPLETE` yalniz mevcut calisma agacindaki plan davranisi ve raporlanan hedefli yerel QA icindir;
GitHub CI, staging, provider veya canli ortam kaniti degildir. Duyuru kurum icinde yayimlanan bir
iceriktir; e-posta, push veya SMS teslimati degildir. Bu nedenle yayin oncesi alici sayisi yerine
kurum geneli gorunurluk ve acik final onayi kullanilir. SMS kendi izinli alici onizlemesi, sifir alici
engeli ve sunucu dogrulamasi ile ayri kalir. CSS ayrimi kaynak sirasini degistirmez.

## Token Contract

Tasarim kararlari icin kanonik kaynak kokteki `design.md`, uretim CSS
degiskenleri icin birebir kaynak `tokens.css` dosyasidir.
`apps/web/app/globals.css` bu tokenlari tuketir; bu sozlesme renk, tipografi,
aralik, radius, focus veya hareket degerlerini tekrar etmez.

- Density: comfortable ve compact table/list modlari.
- Chart: success-rate-first palette; `Basari %`, `Net`, `Soru` birlikte gosterilir.
- Print/PDF ve dondurulmus karne geometrisi `design.md` icindeki istisnayi korur.

## Component Contract

`packages/ui` bu profesyonel SaaS primitiflerini saglar:

- `Panel`, `MetricCard`, `StatusBadge`
- `FilterBar`, `Toolbar`, `Pagination`
- `Tabs`, `TabButton`, `SegmentedControl`
- `Field`, `Select`, `Textarea`
- `Alert`, `Skeleton`, `Tooltip`
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
- `Net / Soru` ikincil, `Deneme puani` ucuncul metriktir. Yeni raporlarda `Standart puan`,
  belirsiz `Genel sira` ve yuzdelik gosterilmez; yalniz `Kurum ici sira` ve `Sinif ici sira`
  kullanilir. Esit puanlar ayni sirayi paylasir.
- Deneme puani gosterilen web, PDF ve Excel yuzeylerinde
  `Standart sapma kullanilmadan hesaplanan deneme puanidir. Resmi MEB/OSYM sinav puani degildir.`
  uyarisi gorunur olur. Eski immutable snapshot'lar `Eski hesaplama` etiketiyle okunur ve yeni
  formulle tekrar hesaplanmaz.
- `/kurum/raporlar` dort gorev alanina iner: Genel Bakis, Ogrenciler, Karne ve Ciktilar. Sinav,
  kapsam ve AYT icin SAY/EA/SOZ secimi sayfa ustundeki kompakt kontrol alaninda tutulur.
- `/kurum/optik` sablon, parser, yukleme, karantina ve degerlendirme adimlariyla sinirlidir; rapor
  uretim ve cikti islemleri secili sinav baglamiyla `/kurum/raporlar` yuzeyine devredilir.
- Ogrenci ve ogretmen portallari yetkili `READY` rapor indeksinden gorunur sinav secimi yapar;
  mevcut veli portali ayni kurali gecis boyunca korur. Sabit demo sinav kimligi kullanilmaz.
- Queue isi (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`) ile immutable snapshot durumu ayri
  sozlesmelerdir. UI uretimi `jobId` ile izler, tamamlaninca donen snapshot'i yeniler.
- Karne ve rapor satirlarinda snapshot icindeki dondurulmus `displayName`/`studentNo` onceliklidir;
  guncel ogrenci kaydi yalniz eski snapshot'lar icin geri uyumlu yedektir.
- Export aksiyonlari yalniz `READY` snapshot icin etkin olur; `STALE`, `PENDING` ve `FAILED`
  durumlari acikca gosterilir. Portal dili `READY` yerine `Rapor hazir` der.
- Tekli karne hesaplama yapmaz; toplu immutable snapshot'taki ogrenci satirinin projeksiyonudur.
  Web, kurum PDF'i, iki sayfalik tekli PDF, toplu karneler PDF'i ve Excel ayni snapshot alanlarini
  okur. Sabit sinav adi bulunmadiginda notr `Sinav raporu` kullanilir.
- Yukleniyor, veri yok, filtrede sonuc yok ve hata durumlari ayri geri bildirimlerdir.
- Web karne ve worker PDF sablonlari ayni notr gorsel sozlesmeye yaklastirilir; yeni snapshot'lar
  `examType`, `examYear`, `scoringProfileId` ve `officialComparable:false` provenance'ini dondurur.

## Security And Privacy Contract

- UI tenant isolation kaynagi degildir; server context, API guard ve RLS kaynak olmaya devam eder.
- Kurum hostu tenant baglamini belirler. Kanonik giris formu `loginName + password` alir; kurum
  kodu, T.C. kimlik numarasi veya telefonla global hesap aramaz. Session tenant'i host tenant'iyla
  eslesir ve cookie host-only kalir.
- `SYSTEM_ADMIN` hedefte tenant rolune veya normal kurum session'ina eklenmez. Control-plane ve
  sureli breakglass siniri kurum UX'i tarafindan genisletilemez.
- Yeni dashboard, filtre, global search veya export client-supplied `tenantId` degerine guvenmez.
- Yeni `/kurum/*` route/action/command item shared capability veya hidden capability mapping
  olmadan eklenmez.
- Role preview salt-okuma, tenant-bound ve kisa omurlu kalir.
- TC, telefon, e-posta, veli finans izni ve role-preview ayrintilari screenshot/evidence, breadcrumb,
  empty state, command search veya log metninde ham olarak acilmaz.
- Ogrenci edit formlarinda kayitli telefon ve e-posta hintleri ham deger yerine maskeli deger
  gosterir; tam deger yalniz kullanicinin aktif girdisinde tutulur.

## Acceptance Gates

- Izlenebilirlik: `PR-0` ledger tabani ile gercek `PR-1`–`PR-6` dilimleri, mevcut dosyalar ve CI
  komutlari `docs/ui-ux-professionalization-completion.json` icinde baglanir. `deliveryStatus`
  teslim gercegidir. Checker'in zorunlu tuttugu `localStatus: PROVEN` yalniz listelenen
  `requirementEvidence` dosya/komut baginin yapisal olarak mevcut oldugunu soyler; dilimin
  tamamlandigi, komutun bu calisma agacinda gectigi veya acik maddelerin kapandigi anlamina gelmez.
- `pnpm ui-ux-professionalization:completion:contract` bu statik bagin semasini PR CI'da doğrular;
  davranis testlerini tek basina calistirmaz. `deliveryStatus: COMPLETE`, `openItems` bos ve
  ilgili hedefli yerel QA kaniti mevcut demektir; listelenen genis komutlarin, GitHub CI'nin veya
  dis ortam kanitinin gectigi anlamina gelmez.
- `pnpm ui-ux-professionalization:completion:check` ise başarılı `.github/workflows/ci.yml`
  kanıtını değişmeyen, symlink olmayan `file://` artifact ve exact kaynak SHA ile eşleştirmeden
  `PROVEN` sonucunu kabul etmez; örnek kanıt bypass bayrakları bu modda reddedilir. Yerel ve canlı
  kanıt durumları ayrı kalır; canlı `PROVEN` için aynı SHA'ya bağlı UI/UX redesign artifact'i gerekir.
- Foundation/UI: `pnpm --filter @o-okul/ui typecheck`, `pnpm --filter @o-okul/web typecheck`,
  `pnpm web:a11y:check`, `pnpm web:ux-baseline:check`.
- Report/karne: `pnpm --filter @o-okul/worker test`, `pnpm raw-import:smoke`,
  `pnpm report-generation:smoke`, takip edilen Playwright karne baseline'ını zorunlu karşılaştıran
  `pnpm karne:visual-contract:check`.
- Security/privacy: `pnpm db:rls:check`, `pnpm tenant-db:check`, `pnpm web:token-storage:check`,
  `pnpm admin-mfa:check`, `pnpm rate-limit:check`, `pnpm security:audit:check`,
  `pnpm privacy:inventory:check`.
- Evidence/release: `pnpm prod:evidence:templates:check`, `pnpm prod:plan:check`,
  `pnpm prod:env:check`.
