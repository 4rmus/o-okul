/Users/arair/works/des-otomasyon reposunda Sınav ve Analiz > Optik Okuma akışını gerçek iSEM verisiyle uçtan uca doğrula.
Dil: Türkçe, sade ve kanıt odaklı ilerle. Tahmin etme. Belirsizlik varsa önce durup sor. Gereksiz refactor yapma. Kod değişikliği yalnızca kanıtlanmış bir kırığı düzeltmek için, cerrahi ve testli olsun.
Kullanılacak gerçek dosyalar:
- ornek-veriler/iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx
- ornek-veriler/iSEM .txt
- Gerekirse öğrenci/veli eşleşmesi için ornek-veriler/ogrenci-aktarim-excel.xlsx
Başarı kriteri:
iSEM optik dosyası başarıyla okununca cevap anahtarı, parser config, raw import, değerlendirme job’u, ExamResult, ReportSnapshot ve kurum/öğrenci/veli görünümü aynı veriye işaret etmeli. Sonuçlar yalnız raporda kalmamalı; ilgili Student.studentNo, Student.userId varsa öğrenci hesabı, GuardianStudent bağı ve Guardian.userId varsa veli hesabı üzerinden erişilebilir olmalı.
Faz 0 - Repo ve mevcut durum
1. Önce şu dosya/alanları oku: apps/web/app/(app)/kurum/optik/parser-config-page.tsx, apps/api/src/exam, apps/api/src/report, apps/worker/src/jobs, packages/db/prisma/schema.prisma.
2. Mevcut endpointleri ve UI akışını çıkar: /kurum/sinavlar, /kurum/optik, /kurum/raporlar, /kurum/ogrenciler, /kurum/veliler.
3. Beklenen gerçek iSEM kanıtlarını kontrol et: 90 soru, A/B kitapçık, OPTİK-7108, TXT satırları, B permütasyonu. Mevcut testlerdeki beklentiler değişmişse repo gerçeğini esas al.
Faz 1 - Lokal çalışma kanıtı
1. API, web, Postgres, Redis ve worker durumunu doğrula.
2. Gerekirse corepack pnpm kullan; pnpm shim kırılırsa oyalanma.
3. Login bilgisi yoksa şifre tahmin etme; repo/env/seed/DB kanıtıyla doğrula veya kullanıcıdan iste.
4. /health ve /health/ready sonuçlarını, kullanılan portları ve env kaynağını not et.
Faz 2 - Öğrenci ve veli veri zemini
1. Örnek öğrencilerin sistemde var olup olmadığını API/DB/UI ile kontrol et.
2. studentNo ile optik öğrenci numarası eşleşmesini kanıtla.
3. Öğrenci yoksa import dry-run yap; gerekiyorsa gerçek importu mevcut sözleşmeyle uygula.
4. Veli için ayrı yol icat etme; mevcut guardian provisioning ve GuardianStudent bağını kullan.
5. Her kritik öğrenci için Student, Guardian, GuardianStudent ve varsa User bağını kanıtla.
Faz 3 - Cevap anahtarı
1. Excel dosyasını answer-key dry-run ile test et.
2. 90 soru, branşlar, kazanım/konu alanları, B kitapçığı permütasyonu ve yanlış ceza kuralını doğrula.
3. Dry-run başarılıysa import/publish akışını çalıştır.
4. Hata varsa önce dosya formatı mı kod mu ayrıştır; küçük testle kanıtlamadan patch yazma.
Faz 4 - Optik TXT ve parser
1. OPTİK-7108 parser config/preset önerisini doğrula ve onaylı config versiyonunu kullan.
2. iSEM .txt dosyasını raw-import endpointinden yükle.
3. rawImportId, parseJobId, total/matched/quarantined sayılarını kaydet.
4. Karantina varsa sebebini listele; eşleşebilen satırları doğru öğrenciyle çöz.
5. Çözüm sonrası evaluation job oluştuğunu doğrula.
Faz 5 - Değerlendirme ve rapor
1. Exam evaluation job’un ExamResult ürettiğini DB/API ile kanıtla.
2. Idempotency kontrolü yap: aynı veri tekrar işlendiğinde duplicate veya tutarsız sonuç oluşmamalı.
3. report-generation job çalıştır; ReportSnapshot READY olmalı.
4. Raporlar sayfasında sınav özeti, öğrenci sonuçları, sınıf/branş/kazanım kırılımları görünsün.
Faz 6 - Tarayıcı kanıtı
1. Browser/Playwright ile kurum hesabında şu yolu izle: Sınavlar -> Optik Okuma -> Raporlar.
2. Network ve console error kontrol et.
3. En az bir öğrenci detayında ve bir veli hesabı/veli görünümünde ilgili sınav sonucunun ilişkilendiğini göster.
4. Ekran görüntüsü veya net browser kanıtı üret; yalnız HTTP 200 yeterli sayılmasın.
Faz 7 - Test ve smoke kapıları
Önce odaklı testleri çalıştır:
- corepack pnpm --filter @o-okul/api exec vitest run src/exam/answer-key-excel-import.service.test.ts src/exam/raw-import.controller.e2e.test.ts src/report/report-generation.controller.e2e.test.ts
- corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/optik-7108-real-pipeline.test.ts src/jobs/exam-evaluation-job.test.ts src/jobs/report-generation-job.test.ts
- corepack pnpm raw-import:smoke
- corepack pnpm report-generation:smoke
Risk genişse corepack pnpm live:smoke veya pnpm run ci çalıştır.
Final raporda şunları ver:
- Ne doğrulandı, hangi dosya/veriyle doğrulandı
- Oluşan examId, answerKeyId, rawImportId, jobId, snapshotId
- Öğrenci ve veli hesap ilişki kanıtı
- Tarayıcı kanıtı ve varsa screenshot yolu
- Çalışan test/smoke komutları
- Kalan riskler ve önerilen en küçük sonraki adım