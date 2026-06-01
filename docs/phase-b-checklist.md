# Faz B Uygulama Checklist'i

Bu dosya `MASTER_PLAN.md` §10.6 Faz B kapsamını küçük, doğrulanabilir parçalara böler.

## Varsayımlar

- Faz A kapıları korunur; web regresyonları Next e2e üzerinden doğrulanır.
- Next kurum portalı artık gerçek auth store ve TanStack Query üzerinden ilerler.
- Chart wrapper'ları domain veri şekli alır; sayfa doğrudan Chart.js config'i üretmez.

## Kapsam Dışı

- Faz B tek başına öğretmen/öğrenci/veli portallarını tamamlamaz.
- Faz C backend boşlukları bu checklist'e dahil değildir.
- Vite artefakt sökümü Faz E'de tamamlandı.

## Faz B Durum Denetimi

| Alan | Mevcut durum | Sonraki kanıt |
|---|---|---|
| Kurum özet verisi | Başladı: Next `/kurum` ekranı sınıf/öğretmen/öğrenci listelerini bearer token ile okuyup özet sayıları gösteriyor | `pnpm --filter @uzman-hocam/web next:e2e` |
| Chart.js wrapper | Tamamlandı: `@uzman-hocam/ui` içinde `ExamResultDonut`, `ClassCompareBar`, `ProgressLineChart` ve `TopicRadarChart` eklendi; domain verisi alıyor ve erişilebilir tablo fallback'i render ediyor | `pnpm --filter @uzman-hocam/ui typecheck`, `pnpm --filter @uzman-hocam/ui build`, `pnpm --filter @uzman-hocam/web next:e2e` |
| Rapor özeti | Başladı: Next `/kurum` ekranı `exam-demo` snapshot verisinden donut özetini, sınıf net karşılaştırmasını, ilk öğrenci gelişim grafiğini ve branş net radarını gösteriyor | `pnpm --filter @uzman-hocam/web next:e2e` |
| Shared report tipi | Başladı: `ReportSnapshotRecord.snapshotData` içinde `correct/wrong/blank` alanları ortak tipe eklendi | `pnpm --filter @uzman-hocam/shared-types typecheck`, `pnpm typecheck` |
| Kalan Chart wrapper'ları | Tamamlandı: Faz B'deki 4 wrapper Next fixture'larıyla kanıtlandı | `pnpm --filter @uzman-hocam/web next:e2e` |
| CrudPage referansı | Başladı: `@uzman-hocam/ui` içinde `CrudPage`, `DataTable`, `FormModal` eklendi; Next `/kurum/siniflar`, `/kurum/ogretmenler`, `/kurum/veliler`, `/kurum/ogrenciler`, `/kurum/duyurular`, `/kurum/sablonlar`, `/kurum/denetim` ve `/kurum/kvkk` ekranları gerçek endpointleri kullanıyor | `pnpm --filter @uzman-hocam/web next:e2e` |
| Liste query/meta sözleşmesi | Genişletildi: Faz B tek sayfa `{ data, meta }` sözleşmesi korunuyor; `/classes`, `/teachers`, `/guardians`, `/students` için server-side `page/limit/q/sort` ve gerçek meta başladı | `docs/phase-b-list-query-contract.md`, `pnpm --filter @uzman-hocam/api exec vitest run src/http/api-version.e2e.test.ts src/school/school.e2e.test.ts` |

## Kalite Kapıları

| Kapı | Beklenen sonuç | Kanıt |
|---|---|---|
| Donut gerçek veri | Next kurum ekranı snapshot `correct/wrong/blank` verisinden toplam soru tablosu ve canvas render eder | `pnpm --filter @uzman-hocam/web next:e2e` |
| Sınıf karşılaştırması | Next kurum ekranı `snapshotData.classes[].averages.net` verisinden sınıf karşılaştırma tablosu ve canvas render eder | `pnpm --filter @uzman-hocam/web next:e2e` |
| Öğrenci gelişimi | Next kurum ekranı ilk snapshot öğrencisi için `student-progress.points[].total` verisinden gelişim tablosu ve canvas render eder | `pnpm --filter @uzman-hocam/web next:e2e` |
| Branş radar analizi | Next kurum ekranı `snapshotData.branches[].net` verisinden branş radar tablosu ve canvas render eder | `pnpm --filter @uzman-hocam/web next:e2e` |
| Sınıf CRUD referansı | Next `/kurum/siniflar` ekranı sınıf listeler, modal form ile ekler/günceller ve satır aksiyonuyla siler | `pnpm --filter @uzman-hocam/web next:e2e` |
| Öğretmen CRUD referansı | Next `/kurum/ogretmenler` ekranı öğretmen listeler, modal form ile ekler/günceller ve satır aksiyonuyla siler | `pnpm --filter @uzman-hocam/web next:e2e` |
| Veli CRUD referansı | Next `/kurum/veliler` ekranı veli listeler, modal form ile ekler/günceller ve satır aksiyonuyla siler | `pnpm --filter @uzman-hocam/web next:e2e` |
| Öğrenci CRUD referansı | Next `/kurum/ogrenciler` ekranı öğrenci listeler, modal form ile ekler/günceller ve satır aksiyonuyla siler | `pnpm --filter @uzman-hocam/web next:e2e` |
| Duyuru referansı | Next `/kurum/duyurular` ekranı duyuruları listeler ve modal form ile yeni duyuru yayınlar | `pnpm --filter @uzman-hocam/web next:e2e` |
| Şablon referansı | Next `/kurum/sablonlar` ekranı SMS mesaj şablonlarını listeler, modal form ile ekler/günceller ve satır aksiyonuyla siler | `pnpm --filter @uzman-hocam/web next:e2e` |
| Denetim referansı | Next `/kurum/denetim` ekranı audit log kayıtlarını salt okunur tabloda gösterir | `pnpm --filter @uzman-hocam/web next:e2e` |
| KVKK referansı | Next `/kurum/kvkk` ekranı öğrenci/öğretmen/veli PII temizleme aksiyonlarını gerçek purge endpointlerine bağlar | `pnpm --filter @uzman-hocam/web next:e2e` |
| Liste zarfı referansı | Liste endpointleri `{ data, meta }` zarfını korur; kişi çekirdeği listelerinde gerçek `page/limit/q/sort` metasını taşır | `docs/phase-b-list-query-contract.md`, `pnpm --filter @uzman-hocam/api exec vitest run src/http/api-version.e2e.test.ts src/school/school.e2e.test.ts` |
| Chart paket derlemesi | UI paketi Chart.js wrapper export'unu derler | `pnpm --filter @uzman-hocam/ui build` |
| Faz A regresyonu | Next login smoke ve single-flight refresh bozulmaz | `pnpm --filter @uzman-hocam/web test:e2e -- e2e-next/login-next.spec.ts`, `pnpm --filter @uzman-hocam/web test:e2e -- e2e-next/single-flight-refresh-next.spec.ts` |
| Token saklama | Next app ve e2e dosyaları dahil token storage yasağı sürer | `pnpm web:token-storage:check` |

## Sonraki Uygulama Sırası

Faz B için açık uygulama maddesi kalmadı. Sıradaki çalışma Faz C backend boşluklarıdır.
