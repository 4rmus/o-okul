/Users/arair/works/des-otomasyon reposunda çalış.

Amaç: Öğrenci detay sayfasında ve sınav raporlarında kullanılan grafikleri daha profesyonel, okunur, tutarlı ve sayfa/component yapısına uyumlu hale getir. Sadece grafik ve grafikle doğrudan ilişkili UI alanlarına dokun. Hesaplama mantığını, sınav sonucu verisini, rapor üretim iş akışını veya yetki yapısını değiştirme.

Önce varsayımlarını açık yaz. Belirsiz kalan bir şey varsa kod yazmadan sor. Birden fazla çözüm yolu varsa kısa tradeoff ver. Daha basit bir çözüm yeterliyse onu seç.

Çalışma kuralları:
- Tahmin etme; repo gerçeğini oku.
- Gereksiz refactor yapma.
- Yeni grafik kütüphanesi ekleme kararı verme; önce mevcut dependency ve chart kullanımını kontrol et.
- Mevcut stil, component ve sayfa düzenine uy.
- Her değişen satır bu hedefle doğrudan ilişkili olmalı.
- Türkçe, sade ve kanıt odaklı ilerle.

Başlangıç analizi:
1. `git status --short` ile çalışma ağacını kontrol et; benden gelmeyen değişikliklere dokunma.
2. Grafiklerin geçtiği dosyaları bul:
   - `rg -n "Chart|chart|react-chartjs|Bar|Line|Doughnut|Pie|radar|rapor|sınav|sinav|exam" apps/web packages/ui`
3. Özellikle şuraları incele:
   - `apps/web/app/(app)/kurum/ogrenciler/student-detail-page.tsx`
   - sınav/rapor route ve component dosyaları
   - ortak UI/chart/table componentleri
   - `apps/web/package.json`
   - `packages/ui/package.json`
4. Mevcut chart stack’ini doğrula. `chart.js` / `react-chartjs-2` varsa onu kullanmaya devam et. Repoda olmayan `recharts`, `echarts`, `tremor` gibi çözümleri varsayılan kabul etme.

Tarayıcı analizi:
1. Uygulamayı mevcut repo scriptleriyle yerelde çalıştır.
2. Login gerekiyorsa sadece repo/env/seed içinde kanıtlı kullanıcı bilgilerini kullan; şifre tahmin etme.
3. Tarayıcıda öğrenci detay sayfasını ve sınav raporu ekranlarını aç.
4. Değişiklik öncesi sorunları kanıtla:
   - grafik okunurluğu
   - etiket/legend taşması
   - tooltip kalitesi
   - renk kontrastı
   - boş/yetersiz veri durumu
   - component hizası
   - sayfa içinde kart/panel/başlık uyumu
   - masaüstü görünüm
   - mümkünse dar ekran kırılma kontrolü
5. Bulguları kısa listele; sonra uygulama planını yaz.

Uygulama kapsamı:
- Öğrenci detay sayfasındaki sınav performansı grafiklerini düzenle.
- Sınav raporlarındaki grafiklerde okunurluk, başlık, açıklama, legend, axis label, tooltip ve renk tutarlılığını iyileştir.
- Aynı veri türü aynı görsel dille gösterilmeli.
- Grafik alanları sayfa layout’unu bozmayacak sabit/responsive ölçülere sahip olmalı.
- Uzun ders/sınav/alan adları taşmamalı.
- Boş veri, az veri ve çok veri durumları profesyonel görünmeli.
- Renkler eğitim/rapor bağlamına uygun, sakin ve ayırt edilebilir olmalı.
- Grafikler kart, tablo, başlık ve filtrelerle görsel olarak uyumlu olmalı.
- Print/export veya rapor ekranı varsa grafiklerin orada da kırılmadığını kontrol et.

Başarı ölçütleri:
- Öğrenci detay sayfasındaki grafikler okunur ve hizalı.
- Sınav raporu grafiklerinde tooltip, legend ve label’lar anlaşılır.
- Sayfa/component uyumu bozulmadı.
- Yeni gereksiz dependency eklenmedi.
- Yetki, route, veri hesaplama ve rapor üretim mantığı değişmedi.
- Boş/az/çok veri durumları kırılmıyor.
- Tarayıcıda önce/sonra farkı doğrulandı.
- İlgili test/build/lint komutları çalıştırıldı veya neden çalıştırılamadığı açıklandı.

Uygulama sonrası doğrulama:
1. İlgili unit/component testleri varsa çalıştır.
2. En azından ilgili package için typecheck/lint/build veya repo standardındaki en yakın doğrulama komutunu çalıştır.
3. Tarayıcıda öğrenci detay ve sınav raporu ekranlarını tekrar aç.
4. Screenshot veya açık gözlemle doğrula:
   - taşma yok
   - yazılar üst üste binmiyor
   - grafikler boş değil
   - tooltip/legend çalışıyor
   - sayfa düzeni bozulmamış
5. Final yanıtta şunları ver:
   - değişen dosyalar
   - yapılan kısa iyileştirmeler
   - çalıştırılan doğrulamalar ve sonuçları
   - varsa kalan riskler veya bilinçli kapsam dışı bırakılan noktalar

Kod yazmaya başlamadan önce kısa planını şu formatta paylaş:
1. Analiz → verify: dosya/route/component kanıtı
2. Uygulama → verify: dar kapsamlı diff
3. Tarayıcı/test → verify: ekran ve komut sonucu