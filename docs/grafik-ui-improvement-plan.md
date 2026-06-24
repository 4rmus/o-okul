Çalışma dizini: /Users/arair/works/des-otomasyon

Dil ve çalışma tarzı:
- Türkçe, sade ve net yaz.
- Kod yazmadan önce varsayımlarını açıkça belirt.
- Emin olmadığın yerde tahmin yürütme; repo içinden kanıt topla.
- Sadece istenen kapsamı değiştir. Alakasız refactor yapma.
- Her fazı test/kanıt ile kapat.
- Mevcut tasarım ve repo düzenine uy. Özellikle apps/web ve packages/ui yapısını önce oku.

Ana hedef:
Uygulamadaki grafik, tablo ve eğitim verisi görselleştirme alanlarını modern, profesyonel, hızlı ve erişilebilir hale getir. Özellikle şu yüzeyleri iyileştir:
- Kurum dashboard
- Öğrenci detay sayfası
- Öğrenci listesi
- Veli sayfası / veli detay sayfası
- Öğretmen sayfası / öğretmen detay sayfası
- Kurum / tenant sayfaları
- Müfredat, kazanım, öğrenci-veli-öğretmen ilişki görünümleri
- Öğrenci gelişim çizgisi, karne ve sınav raporu görünümleri

Başarı kriterleri:
- Grafikler sadece süs değil, eğitim kararını kolaylaştıran veri sunumları olmalı.
- Tablo/listeler büyük veriyle çalışabilecek şekilde sayfalama, sıralama, filtreleme ve kolon esnekliği sunmalı.
- Chart.js, React Flow gibi ağır kütüphaneler lazy loading ile yüklenmeli.
- Mobil ve masaüstünde metin taşması, üst üste binme, boş/bozuk grafik olmamalı.
- Her grafik için erişilebilir metin/tablo alternatifi korunmalı.
- Yeni kütüphane eklenirse gerekçesi açık olmalı ve bundle etkisi kontrol edilmeli.
- Typecheck, build ve ilgili e2e/smoke testleri geçmeli.

## 2026-06-04 Uygulama Notu

Faz 0/1 repo kararı:
- Mevcut grafik altyapısı `packages/ui/src/components/charts.tsx` içinde Chart.js + react-chartjs-2 kullanıyor.
- `apps/web/package.json` içinde Recharts, React Flow veya @tanstack/react-table yok; yeni paket eklenmedi.
- Dashboard, rapor ve öğrenci detayda mevcut chart bileşenleri kullanılıyor. Bu yüzden ilk adım mevcut Chart.js bileşenlerini iyileştirmek ve sayfa yükünden ayırmak oldu.
- Öğrenci listesi `ListControls` ile sayfalama, arama, sıralama ve filtreleme yapıyor. Bu aşamada @tanstack/react-table ertelendi; kolon görünürlüğü/yoğun görünüm ihtiyacı ayrı Faz 4 işi olarak kaldı.

Karar matrisi:
| Alan | Karar | Gerekçe |
| --- | --- | --- |
| Chart.js / react-chartjs-2 | Kullan | Zaten ortak UI paketinde var; aynı işi yapan ikinci grafik paketi eklemeye gerek yok. |
| Recharts | Kullanma | Mevcut grafik ihtiyacını karşılayan Chart.js varken bundle büyütür. |
| React Flow | Ertele | İlişki/müfredat haritası için değer kanıtı gerektiğinde lazy değerlendirilecek. |
| @tanstack/react-table | Ertele | Basit CRUD tablolarında mevcut DataTable yeterli; öğrenci listesinde Faz 4 ihtiyaçları netleşince değerlendirilecek. |
| shadcn/ui / Tremor | Kullanma | Mevcut `@o-okul/ui` yapısıyla çakışma riski var; ilk adımda faydası net değil. |

İlk uygulama:
- Chart bileşenleri boş veride artık boş canvas çizmez; anlaşılır empty state ve tablo satırı gösterir.
- Kurum dashboard, rapor sayfası ve öğrenci detay sayfası chart bileşenlerini lazy wrapper üzerinden yükler.
- Erişilebilir tablo alternatifi korunur.

Kanıt:
- `pnpm --filter @o-okul/ui typecheck`
- `pnpm --filter @o-okul/web typecheck`
- `pnpm --filter @o-okul/web next:build`
- 3011 production smoke: dashboard, rapor ve öğrenci detayda `canvasCount=4`, chart table caption'ları göründü, `consoleErrorCount=0`.
- Hedefli Playwright spec 3001'deki eski dev server beklemesi nedeniyle sonuç vermedi; geçildi sayılmadı.

Faz 4 başlangıç:
- Öğrenci listesine kolon görünürlük ayarı eklendi. `Ad Soyad` ve `İşlem` sabit kaldı; diğer kolonlar kullanıcı tarafından açılıp kapanabilir.
- Öğrenci listesine `Rahat / Yoğun` görünüm seçimi eklendi. Yoğun görünüm tablo hücre ve satır aksiyon aralıklarını daraltır.
- Liste durumu URL query'ye yazılır: `page`, `limit`, `q`, `sort`, filtreler, `density` ve görünür `columns`.
- @tanstack/react-table yine eklenmedi; bu fazdaki ihtiyaçlar mevcut `CrudPage` + `DataTable` ile temiz çözüldü.

Faz 4 kanıt:
- `pnpm --filter @o-okul/web typecheck`
- `pnpm --filter @o-okul/web next:build`
- 3011 production smoke: öğrenci listesinde kolon gizleme, `density=compact`, `classId=class-a`, `rowCount=1`, `consoleErrorCount=0`.

Faz 5 başlangıç:
- Veli detayında bağlı öğrenci satırları ilişki, sınıf, durum, portal ve izin bilgilerini birlikte gösterir hale getirildi. Mevcut `Ada A - Anne / Birincil` metni korundu.
- Veli detayında aktif bağlı öğrenci metriği eklendi; sınıf adı için mevcut `/classes` referansı kullanıldı.
- Öğretmen listesine detay bağlantısı eklendi.
- Öğretmen detayında atamalar rol, sınıf/öğrenci, ders ve dönem bilgisiyle ayrıştırıldı; sınıf/öğrenci sayısı metriği ve not/yoklama/materyal/rapor çalışma alanı bağlantıları eklendi.
- Yeni paket eklenmedi; mevcut API ve `@o-okul/ui` düzeni kullanıldı.

Faz 5 kanıt:
- `pnpm --filter @o-okul/ui typecheck`
- `pnpm --filter @o-okul/web typecheck`
- `pnpm --filter @o-okul/web next:build`
- Browser plugin `iab` bu oturumda uygun değildi; fallback olarak standalone Playwright kullanıldı.
- 3011 production smoke: veli detayda `Ada A - Anne / Birincil`, `8-A`, `Aktif`, izin rozetleri; öğretmen listesinde `Ayse detay`; öğretmen detayda `Sınıf öğretmeni · 8-A · Matematik · 2. Donem`, çalışma alanı bağlantıları ve `consoleErrorCount=0`.
- Smoke ekran görüntüleri: `artifacts/ui-smoke/faz5-guardian-detail.png`, `artifacts/ui-smoke/faz5-teacher-detail.png`.

Faz 6 başlangıç:
- Kurum dashboard verisine veli toplamı, son duyuru özeti ve temel sistem sağlık sinyali eklendi.
- Kurum panelindeki metrikler `Sınıf / Öğretmen / Öğrenci / Veli` olarak genişletildi.
- “Bugün dikkat gerektirenler” alanı eklendi; destek, ödeme, devamsızlık, optik, rapor ve sistem sinyallerini rol erişimine göre listeler.
- “Operasyon özeti” alanı eklendi; son sınav/rapor, son duyuru ve sistem sağlığı karar metinleriyle gösterilir.
- Mevcut Chart.js lazy grafik yapısı korundu; yeni paket eklenmedi.

Faz 6 kanıt:
- `npx --yes pnpm@11.5.0 --filter @o-okul/web typecheck`
- `npx --yes pnpm@11.5.0 --filter @o-okul/web next:build`
- 3011 production smoke: kurum dashboard’da `Bugün dikkat gerektirenler`, `Operasyon özeti`, `Veli`, `LGS veli bilgilendirmesi`, `Rapor hazır`; `canvasCount=4`, `consoleErrorCount=0`.
- Smoke ekran görüntüsü: `artifacts/ui-smoke/faz6-kurum-dashboard.png`.
- Not: Yerel `pnpm` shim’i 11.5.0 binary yolunu bulamadığı için doğrulamalar aynı sürümle `npx --yes pnpm@11.5.0` üzerinden çalıştırıldı.

Faz 7 başlangıç:
- React Flow değeri öğrenci - veli - öğretmen - sınıf ilişkisi için net görüldü; müfredat/kazanım flow’u bu aşamada ertelendi.
- Web paketine `@xyflow/react@12.11.0` eklendi; ortak UI paketine taşınmadı.
- Öğrenci detay sayfasına lazy yüklenen `LazyStudentRelationshipFlow` bağlandı.
- İlişki haritası öğrenci merkezli sınıf, veli ve öğretmen düğümlerini gösterir; aynı veri “İlişki haritası liste görünümü” altında metin olarak korunur.
- Mobilde React Flow alanı gizlenir; liste fallback görünür kalır.
- Öğrenci detayında rapor verisi, sınav listesi yüklenmeden eski demo sınav id’siyle çağrılmayacak şekilde düzeltildi.

Faz 7 kanıt:
- `pnpm --filter @o-okul/web typecheck`
- `pnpm --filter @o-okul/web build`
- `NEXT_E2E_PORT=3018 pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/a11y-next.spec.ts e2e-next/student-relationship-flow-next.spec.ts` -> 5 test geçti.
- Hedefli Playwright spec: öğrenci detay ilişki haritasında `nodeCount=6`, `edgeCount=5`; zoom kontrolü viewport transform değişimini doğrular; liste fallback veli/öğretmen metinlerini korur.
- Mobil spec: React Flow shell gizlenir, “İlişki haritası liste görünümü” görünür kalır ve yatay taşma `<=1px`.
- Smoke ekran görüntüleri: `artifacts/ui-smoke/faz7-student-relationship-flow.png`, `artifacts/ui-smoke/faz7-student-relationship-mobile.png`.

2026-06-17 devam notu:
- Öğrenci, veli ve öğretmen portal özetleri sınav rapor metriğini `Başarı`, `Net` ve `Soru` üçlüsüyle gösterir hale getirildi.
- Öğretmen portalındaki sınıf rapor tablosu `Soru` ve `Başarı` kolonlarıyla ham net karşılaştırmasına bağımlı kalmayacak şekilde genişletildi.
- Öğretmen portal öğrenci gelişim çağrısı tek sınavla sınırlı kalmaması için `progress?scope=all` kullanır.
- React Flow iddiası gerçek uygulamaya bağlandı: `@xyflow/react@12.11.0`, lazy `StudentRelationshipFlow`, mobil liste fallback ve hedefli Playwright kanıtı mevcut.
- Liste URL durumu ortak `useUrlListState` yardımcı hook’una taşındı; kullanıcı/öğretmen/veli/sınıf/ders/kampüs/seviye listeleri `page`, `limit`, `q` ve `sort` değerlerini URL’den okur ve URL’ye yazar.
- Öğrenci listesi URL durumu filtre, kolon görünürlüğü ve yoğunluk parametreleriyle genişletildi; `classId`, `level`, `responsibleTeacherId`, `status`, `guardianLinked`, `density` ve `columns` URL'den okunup URL'ye yazılır.
- Kurum dashboard "Operasyon özeti" alanı son rapor, son duyuru ve `/health` + `/health/ready` kaynaklı sistem sağlığı kartını birlikte gösterir.
- Öğrenci sınav detay ve rapor ekranlarındaki hata kitapçığı paragraf yerine okunabilir tablo olarak render edilir.
- Öğretmen portal sınıf raporu boş state'i artık boş `<tbody>` bırakmaz; "Hazır sınıf raporu yok." satırı gösterir.
- Liste URL kanıtı: `NEXT_E2E_PORT=3020 pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/list-url-state-next.spec.ts` -> 3 test geçti.
- Yerel plan kapıları staging/UAT/provider/pilot/go-live onaylarının yerine geçmez; bu kanıtlar üretim hazırlık planında ayrı kapı olarak kalır.

Faz 8 başlangıç:
- Chart bileşenleri `@o-okul/ui` ana exportundan ayrıldı; `@o-okul/ui/charts` ayrı girişinden lazy yükleniyor.
- `packages/ui/src/charts.ts` eklendi. `@o-okul/ui/charts` source girişine işaret eder; `dist/` ignore altında olduğu için temiz kurulumda ek dist dosyasına bağımlı kalmaz.
- Böylece chart kullanmayan normal UI importları Chart.js uygulama kodunu ilk yüke taşımıyor.
- React Flow lazy yapısı korundu; öğrenci listesinde flow chunk isteği oluşmadı.

Faz 8 kanıt:
- `pnpm --filter @o-okul/ui typecheck`
- `pnpm --filter @o-okul/web typecheck`
- `pnpm --filter @o-okul/web build`
- Build chunk kontrolü: Chart uygulama chunk’ı `0j827pnm5ks6q.js` yaklaşık 200 KB; React Flow / öğrenci ilişki haritası chunk’ları `0ngmsdsb.18zt.js` yaklaşık 171 KB ve `0o0a63.kau~c2.js` yaklaşık 37 KB; React Flow CSS `0v~wtps5j8c53.css` yaklaşık 91 KB global CSS içinde.
- Build manifest kontrolü: `rootMainFiles` içinde Chart/React Flow chunk isimleri yok; `apps/web/.next/server/app/page_client-reference-manifest.js` ve `apps/web/.next/server/app/page/build-manifest.json` içinde `0ngmsdsb.18zt.js`, `0j827pnm5ks6q.js`, `0o0a63.kau~c2.js` yok.
- Not: React Flow JS lazy yükleniyor; paket CSS'i global import edildiği için JS kadar ayrışmış değildir.

Faz 9 başlangıç:
- Browser plugin bu oturumda callable araç olarak görünmedi; görsel QA standalone Playwright ile yapıldı.
- Kurum paneli, öğrenci listesi, öğrenci detay ve rapor sayfası masaüstü/mobil viewportlarda mock API ile açıldı.
- Görsel QA kontrolü; yatay gövde taşması, boş canvas, konsol hatası ve erişilebilir label eksikliği ölçtü.

Faz 9 kanıt:
- `pnpm --filter @o-okul/web typecheck`
- `pnpm --filter @o-okul/web build`
- `NEXT_E2E_PORT=3023 pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/ui-visual-qa-next.spec.ts` -> 4 test geçti.
- Standalone Playwright QA: `faz9-dashboard-desktop`, `faz9-students-mobile`, `faz9-student-detail-desktop`, `faz9-student-detail-mobile`, `faz9-reports-desktop` senaryolarında `consoleErrorCount=0`, yatay taşma `<=1px`, `blankCanvasCount=0`, `unlabeledControls=0`.
- Dashboard desktop "Operasyon özeti / Sistem sağlığı" kartını; öğrenci sınav detay ve rapor desktop hata kitapçığı tablolarını; mobil öğrenci dashboard ilişki haritası liste fallback'ini doğrular.
- Mobil öğrenci listesi `390x844` viewportta URL'den gelen filtre, kolon ve yoğun görünüm state'iyle taşmadan kalır.
- Smoke ekran görüntüleri: `artifacts/ui-smoke/faz9-dashboard-desktop.png`, `artifacts/ui-smoke/faz9-students-mobile.png`, `artifacts/ui-smoke/faz9-student-detail-desktop.png`, `artifacts/ui-smoke/faz9-student-detail-mobile.png`, `artifacts/ui-smoke/faz9-reports-desktop.png`.

Faz 10 kapanış raporu:
- Değişen ana yüzeyler: kurum dashboard, öğrenci listesi, öğrenci detay, veli detay, öğretmen listesi/detayı ve rapor ekranı.
- Güncellenen/eklenen componentler: chart empty/table fallback iyileştirmeleri, `lazy-report-charts`, `ReportChartPanel`, dashboard metrik/karar alanları, öğrenci ilişki haritası için lazy React Flow bileşenleri, öğrenci listesi kolon/yoğunluk kontrolleri.
- Kütüphane kararı: mevcut Chart.js korundu; `@xyflow/react@12.11.0` sadece öğrenci ilişki haritası için eklendi; Recharts, shadcn/Tremor ve @tanstack/react-table eklenmedi.
- Lazy loading: Chart bileşenleri `@o-okul/ui/charts` ayrı girişinden lazy yükleniyor; React Flow öğrenci detayda lazy yükleniyor; mobilde flow yerine liste fallback korunuyor.
- Geçen doğrulamalar: UI ve web typecheck, web `build`, Faz 4/7/9 Playwright smoke/QA kontrolleri, `pnpm web:ux-baseline:check`, `pnpm karne:visual-contract:check`, `git diff --check`.
- Kalan bilinçli ertelemeler: müfredat/kazanım için React Flow haritası yapılmadı; @tanstack/react-table ihtiyacı mevcut öğrenci listesi davranışı yeterli olduğu için ertelendi; tam `pnpm run ci` bu fazda koşulmadı, odaklı web typecheck/build ve Playwright QA ile kapatıldı.

Faz 0 - Repo Gerçeğini Oku
1. apps/web/package.json, packages/ui/package.json, mevcut UI componentleri, öğrenci/veli/öğretmen/kurum sayfalarını incele.
2. Mevcut grafik altyapısını kontrol et: packages/ui/src/components/charts.tsx ve bu componentlerin nerelerde kullanıldığını çıkar.
3. Mevcut tablo altyapısını kontrol et: packages/ui/src/components/data-table.tsx, CrudPage kullanımları, öğrenci listesi ve diğer CRUD sayfaları.
4. Hangi kütüphaneler zaten var, hangileri yok, hangileri gerçekten gerekli raporla.
Verify:
- Dosya ve bağımlılık kanıtı ver.
- “Yeni paket gerekli mi?” kararını kısa gerekçeyle yaz.

Faz 1 - Tasarım ve Kütüphane Kararı
Aşağıdaki kararları repo gerçeklerine göre ver:
- Genel dashboard/layout: Mevcut @o-okul/ui yeterliyse onu geliştir. shadcn/ui veya Tremor sadece net fayda varsa ve mevcut stil sistemiyle çakışmayacaksa değerlendir.
- Grafikler: Chart.js zaten varsa önce onu iyileştir. Recharts eklemek için net gerekçe gerekir; aynı işi yapan iki grafik kütüphanesini gereksiz yere birlikte büyütme.
- Tablo: Öğrenci listeleri ve yoğun veri tabloları için @tanstack/react-table değerlendir. Basit CRUD tablolarında mevcut DataTable yeterliyse değiştirme.
- İlişki/müfredat haritaları: React Flow’u sadece gerçekten düğüm/kenar ilişkisi gereken yerlerde kullan.
Verify:
- Kütüphane karar matrisi çıkar: kullanılacak, ertelenecek, kullanılmayacak.

Faz 2 - Ortak Görsel Veri Bileşenleri
packages/ui içinde veya mevcut yapıya en uygun yerde tekrar kullanılabilir bileşenler tasarla:
- Metric card / KPI panel
- Eğitim odaklı chart panel
- Empty/loading/error durumları
- Veri yoğunluğu yüksek tablo wrapper’ı
- Grafik yanında küçük özet tablo
- Responsive grid yapısı
- Tooltip, legend ve renk standardı
- Erişilebilir caption/aria-label yapısı

Dikkat:
- Kart içinde kart kullanma.
- Tek renk ailesine sıkışma.
- Grafikleri gerçek eğitim verisi bağlamıyla adlandır: net, doğru, yanlış, boş, kazanım, branş, devamsızlık, ödeme, gelişim, sınıf ortalaması.
Verify:
- TypeScript typecheck.
- En az bir örnek sayfada componentlerin çalıştığını göster.

Faz 3 - Öğrenci Detay ve Karne Görselleri
Öğrenci detay sayfasını modernleştir:
- Üstte öğrenci özeti ve kritik metrikler.
- Sınav sonucu dağılımı.
- Branş bazlı net grafiği.
- Kazanım bazlı performans.
- Gelişim çizgisi: net ve/veya standart puan.
- Hata kitapçığı için okunabilir tablo.
- Veli, öğretmen, sınıf geçmişi ve kayıt geçmişini daha taranabilir hale getir.

Lazy loading:
- Chart.js tabanlı grafikler ilk sayfa yükünü gereksiz büyütüyorsa Next dynamic import veya uygun client-only lazy loading ile ayrıştır.
Verify:
- Öğrenci detay sayfası açılıyor.
- Grafikler boş/bozuk değil.
- Grafiklerin tablo alternatifi var.
- Typecheck/build geçiyor.

Faz 4 - Öğrenci Listeleri ve Performanslı Tablo
Öğrenci listesi için tablo deneyimini geliştir:
- Sayfalama
- Sıralama
- Arama/filtreleme
- Kolon görünürlük ayarı
- Yoğun/rahat görünüm modu
- Satır aksiyonları
- Boş ve yükleniyor durumları
- Mümkünse URL query ile sayfa/filtre durumunu koruma

@tanstack/react-table sadece bu ihtiyaçlar mevcut DataTable ile temiz çözülemiyorsa ekle.
Verify:
- Büyük liste davranışı makul.
- Klavye ve ekran okuyucu semantiği korunuyor.
- E2E veya component düzeyinde tablo akışı test ediliyor.

Faz 5 - Veli ve Öğretmen Sayfaları
Veli ve öğretmen yüzeylerini eğitim verisine göre düzenle:
- Veli için bağlı öğrenciler, izinler, ödeme/duyuru/SMS/destek erişimi, öğrencinin son akademik durumu.
- Öğretmen için sınıflar, atanmış öğrenciler, notlar, yoklama, ödev/materyal, sınıf raporları.
- Öğrenci seçimi yapılan yerlerde tablo/grafik/özet akışı sade ve hızlı olmalı.
Verify:
- Veli ve öğretmen demo kullanıcılarıyla ilgili sayfalar açılıyor.
- İlişki verisi anlaşılır biçimde görünüyor.

Faz 6 - Kurum Dashboard
Kurum panelini yönetici için karar ekranı haline getir:
- Öğrenci, öğretmen, veli, sınıf metrikleri.
- Son sınav/rapor üretim durumu.
- Devamsızlık, ödeme, destek, duyuru ve sistem sağlığı özetleri.
- “Bugün dikkat gerektirenler” alanı.
- Görseller yönetim kararı için anlamlı olmalı; dekoratif grafik ekleme.
Verify:
- Kurum paneli gerçek API/mock akışlarında bozulmuyor.
- Playwright ile temel görünürlük testi güncelleniyor.

Faz 7 - React Flow ile İlişki ve Müfredat Görünümü
React Flow’u şu iki alandan biri için değerlendir:
1. Öğrenci - veli - öğretmen - sınıf ilişkileri
2. Müfredat - ders - kazanım - sınav sorusu ilişkileri

Kurallar:
- React Flow’u lazy load et.
- Sadece ilişki haritası gerçekten değer katıyorsa uygula.
- Liste/tablo ile daha anlaşılır olan şeyi flow’a çevirme.
- Mobilde okunabilir fallback sağla.
Verify:
- Flow alanı boş değil.
- Zoom/pan temel çalışıyor.
- İlişki verisi tablo/listede de okunabiliyor.

Faz 8 - Performans ve Lazy Loading
Ağır görsel parçaları kontrol et:
- Chart.js / react-chartjs-2
- React Flow
- Recharts eklenirse Recharts
- Büyük tablo mantığı

Gereken yerlerde dynamic import kullan.
Verify:
- next build çıktısını kontrol et.
- İlk yüklemeye gereksiz büyük grafik/flow kodu binmediğini kanıtla.
- Grafik/flow lazy yüklendiğinde loading state düzgün görünsün.

Faz 9 - Görsel QA ve Test
Son doğrulama:
- pnpm --filter @o-okul/web typecheck
- pnpm --filter @o-okul/web next:build
- İlgili Playwright testleri
- Gerekirse pnpm run ci
- Browser/Playwright ekran görüntüsüyle masaüstü ve mobil kontrol

Kontrol listesi:
- Metin taşması yok.
- Grafikler boş canvas değil.
- Tablolar mobilde kullanılabilir.
- Butonlar ve filtreler erişilebilir.
- Hata/yükleniyor/boş durumları profesyonel görünüyor.
- Mevcut login ve rol bazlı erişim bozulmadı.

Faz 10 - Kapanış Raporu
Finalde şunları kısa ve kanıtlı yaz:
- Hangi sayfalar değişti?
- Hangi componentler eklendi/güncellendi?
- Hangi kütüphaneler eklendi veya özellikle eklenmedi?
- Lazy loading nerede uygulandı?
- Hangi testler geçti?
- Kalan risk veya bilinçli ertelenen işler neler?
