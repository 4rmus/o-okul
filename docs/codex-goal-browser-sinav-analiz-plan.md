# Codex Goal + Browser ile Sınav, Analiz, Öğrenci, Veli ve Sınıf Geliştirme Planı

## 1. Prompt Analizi

Kaynak prompt doğru hedefleri söylüyor, ancak uygulamaya geçmek için fazla geniş:

- Aynı anda analiz, uçtan uca test, veri doğrulama, mimari değerlendirme ve UI/UX iyileştirme istiyor.
- `admin@ara.com` kurum hesabıyla gerçek oturum doğrulaması istiyor; bu nedenle yalnız kod okumak yeterli değil.
- `ornek-veriler/` altındaki Excel/TXT dosyaları sınav ve öğrenci akışının gerçek kabul verisi olmalı.
- Sınav akışı UI, API, worker, DB ve rapor katmanlarını birlikte ilgilendiriyor.
- "Check et" ifadesi zayıf; her faz için net kanıt kapısı gerekiyor.

Bu planın amacı promptu Codex ile güvenli, kanıtlı ve mimari olarak doğru yürütülebilecek fazlara çevirmektir.

## 2. Ana Goal

Codex çalışması başlarken önerilen goal:

> `admin@ara.com` kurum hesabıyla giriş yaparak Öğrenciler, Veliler, Sınıflar, Sınavlar, Optik Okuma ve Raporlar yüzeylerini gerçek örnek verilerle uçtan uca doğrula; öğrenci-veli-sınıf bağlarını ve iSEM LGS optik/cevap anahtarı akışını API, worker, DB ve tarayıcı kanıtıyla test et; bulunan yüksek etkili UI/UX ve mimari sorunları cerrahi şekilde düzelt; sonucu test ve ekran kanıtıyla kapat.

Başarı koşulları:

- Login gerçek hesapla başarılı olmalı ve kurum paneline yönlenmeli.
- Hedef menüler görünür olmalı: Öğrenciler, Veliler, Sınıflar, Sınavlar, Optik Okuma, Raporlar, Kazanımlar.
- `ornek-veriler/ogrenci-aktarim-excel.xlsx` içeriğinden gelen öğrenci, veli ve sınıf ilişkileri API ve UI tarafında doğrulanmalı.
- `ornek-veriler/iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx` cevap anahtarı akışıyla uyumlu olmalı.
- `ornek-veriler/iSEM .txt` OPTİK-7108 parser akışında okunmalı, katılımcılarla eşleşmeli ve rapora kadar taşınmalı.
- UI/UX düzeltmeleri mevcut component ve stil düzenini bozmadan yapılmalı.
- Her kod değişikliği odaklı test, smoke veya tarayıcı kanıtıyla kapanmalı.

Güvenlik notu:

- Parola repo içindeki `.md`, test fixture veya log dosyalarına düz metin yazılmamalı.
- Parola yalnız çalışma sırasında sağlanan admin parolası olarak kullanılmalı.
- Test artifactlerinde token, cookie, refresh token veya ham kişisel veri saklanmamalı.

## 3. Mimari Harita

Öncelikli frontend dosyaları:

- `apps/web/app/(app)/_shared/navigation.ts`
- `apps/web/app/(app)/app-shell.tsx`
- `apps/web/app/(app)/kurum/sinavlar/exams-page.tsx`
- `apps/web/app/(app)/kurum/optik/parser-config-page.tsx`
- `apps/web/app/(app)/kurum/raporlar/reports-page.tsx`
- `apps/web/app/(app)/kurum/ogrenciler/students-page.tsx`
- `apps/web/app/(app)/kurum/ogrenciler/student-detail-page.tsx`
- `apps/web/app/(app)/kurum/veliler/guardians-page.tsx`
- `apps/web/app/(app)/kurum/veliler/guardian-detail-page.tsx`
- `apps/web/app/(app)/kurum/siniflar/classes-page.tsx`
- `apps/web/app/(app)/kurum/siniflar/class-detail-page.tsx`

Öncelikli API dosyaları:

- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/rbac/role-capabilities.ts`
- `apps/api/src/student/student.controller.ts`
- `apps/api/src/student/student-import.service.ts`
- `apps/api/src/student/student.service.ts`
- `apps/api/src/school/classes.controller.ts`
- `apps/api/src/school/guardians.controller.ts`
- `apps/api/src/school/school.service.ts`
- `apps/api/src/exam/exam.controller.ts`
- `apps/api/src/exam/answer-key.controller.ts`
- `apps/api/src/exam/raw-import.controller.ts`
- `apps/api/src/exam/parser-config.controller.ts`
- `apps/api/src/report/report-generation.controller.ts`

Öncelikli worker ve veri dosyaları:

- `apps/worker/src/jobs/optical-answer-parser.ts`
- `apps/worker/src/jobs/optical-parse-workflow.ts`
- `apps/worker/src/jobs/exam-evaluation-job.ts`
- `apps/worker/src/jobs/report-generation-job.ts`
- `apps/worker/src/jobs/optik-7108-real-pipeline.test.ts`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/seed-exams.ts`
- `packages/db/prisma/seed-exams.test.ts`

Gerçek örnek veri:

- `ornek-veriler/ogrenci-aktarim-excel.xlsx`
- `ornek-veriler/iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx`
- `ornek-veriler/iSEM .txt`

Mimari kural:

- Frontend parse veya scoring motoru olmamalı; sadece API akışlarını yönetmeli.
- Cevap anahtarı, optik parse, kitapçık hizalama, değerlendirme ve rapor üretimi backend/worker tarafında kalmalı.
- Öğrenci, veli ve sınıf bağları tenant, RBAC ve RLS sınırlarını korumalı.
- Yeni paket eklemek son seçenek olmalı; mevcut stack: Next.js, React Query, `@o-okul/ui`, lucide icons, Chart.js/report bileşenleri.

## 4. Faz 0 - Hazırlık ve Sınırları Netleştirme

Amaç: Kod yazmadan önce mevcut durumu kanıtlamak.

Adımlar:

1. `AGENTS.md` ve bu planı oku.
2. `git status --short` ile mevcut kullanıcı değişikliklerini kaydet.
3. Hedef dosya ve route'ların gerçekten var olduğunu doğrula.
4. Mevcut `ornek-veriler/` dosyalarının varlığını ve boyutunu kontrol et.
5. Parolanın hiçbir dosyaya yazılmayacağını teyit et.

Doğrulama:

- Hedef route dosyaları listelenmiş olmalı.
- Dirty worktree varsa sadece görevle ilgili dosyalar değiştirilmeli.
- Çelişkili veya eksik dosya varsa kullanıcıya sorulmalı.

Çıkış kriteri:

- Hangi sayfaların, endpointlerin ve örnek dosyaların kullanılacağı netleşmiş olmalı.

## 5. Faz 1 - Runtime, Login ve Yetki Kanıtı

Amaç: Uygulamanın gerçek çalışma davranışını görmek.

Adımlar:

1. Lokal servis durumunu kontrol et: web, API, worker, Postgres, Redis gerekiyorsa ayağa kaldır.
2. Migration gerekiyorsa interaktif olmayan güvenli yol kullan: Prisma migrate deploy veya repo standardı.
3. API health ve temel endpointleri kontrol et.
4. Sağlanan kurum admin hesabıyla login isteğini test et.
5. Login yanıtında şu alanları doğrula:
   - `accessToken`
   - `session.email`
   - `session.tenantId`
   - `session.roles`
   - `TENANT_ADMIN` veya kurum yönetimi için gerekli capability kapsamı
6. Browser ile `/login` üzerinden giriş yap.
7. Login sonrası `/kurum` sayfasına yönlenmeyi doğrula.

Tarayıcı kullanımı:

- In-app Browser veya Playwright ile gerçek UI açılmalı.
- Console error ve failed network request sayısı kaydedilmeli.
- İlk ekran görüntüsü alınmalı: login sonrası kurum paneli.

Doğrulama:

- `POST /api/v1/auth/login` tek başına yeterli sayılmamalı.
- Tarayıcıda doğru route, doğru menü ve doğru tenant görünmeli.

Çıkış kriteri:

- `admin@ara.com` hesabıyla kurum paneline gerçek giriş kanıtlanmış olmalı.

## 6. Faz 2 - Örnek Veri Sözleşmesi ve Import Gerçeği

Amaç: Örnek dosyaların backend sözleşmesiyle gerçekten uyumlu olup olmadığını görmek.

Adımlar:

1. `ogrenci-aktarim-excel.xlsx` dosyasını parser mantığıyla incele:
   - Header satırı doğru bulunuyor mu?
   - `ad`, `soyad`, `sınıf`, `okul_no`, veli ad/soyad/telefon alanları okunuyor mu?
   - Boş satır, açıklama satırı veya Türkçe karakterler sorun çıkarıyor mu?
2. Öğrenci import dry-run endpointini admin token ile çalıştır:
   - `POST /api/v1/students/imports/dry-run`
3. Import edilmiş veri zaten varsa UI/API üzerinden karşılaştır:
   - Öğrenci sayısı
   - Sınıf eşleşmesi
   - Okul numarası
   - Veli bağlantısı
   - Guardian phone üzerinden tekrar kullanım
4. `iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx` dosyasını answer-key dry-run ile test et:
   - 90 soru
   - A/B kitapçık desteği
   - Branş, kazanım, konu alanları
5. `iSEM .txt` dosyasını OPTİK-7108 preset ile kontrol et:
   - Satır sayısı
   - A/B kitapçık dağılımı
   - Okul no, TC hash varsa TC, kitapçık, cevap alanları

Doğrulama:

- Öğrenci import sonucu UI'da görünen kayıtlarla uyuşmalı.
- Cevap anahtarı dry-run DB'ye yazmadan anlamlı özet dönmeli.
- OPTİK-7108 fixture testi iSEM dosyası için geçmeli.

Çıkış kriteri:

- Örnek veri zincirinin nerede sağlam, nerede kırılgan olduğu netleşmeli.

## 7. Faz 3 - Öğrenci, Veli ve Sınıf Sayfaları

Amaç: Öğrenci-veli-sınıf ilişkisinin hem veri hem kullanıcı deneyimi olarak doğru set edildiğini kanıtlamak.

Sayfalar:

- `/kurum/ogrenciler`
- `/kurum/ogrenciler/[studentId]`
- `/kurum/veliler`
- `/kurum/veliler/[guardianId]`
- `/kurum/siniflar`
- `/kurum/siniflar/[classId]`

Kontrol listesi:

1. Öğrenciler listesi:
   - Okul no görünüyor mu?
   - Ad soyad doğru mu?
   - Sınıf ve sorumlu öğretmen map ediliyor mu?
   - Veli bağlantısı filtresi doğru çalışıyor mu?
   - Sayfalama, sıralama ve yoğunluk seçimi taşma yapıyor mu?
2. Öğrenci detay:
   - Profil, sınıf geçmişi, kayıt, veli, rapor ve not panelleri aynı öğrenciye mi ait?
   - Eksik veri durumları anlaşılır mı?
3. Veliler listesi:
   - Telefon görünür mü?
   - Detay linki doğru çalışır mı?
   - Bağlı öğrenci sayısı veya ilişki bilgisi kullanıcıya yeterince açık mı?
4. Veli detay:
   - Bağlı öğrenciler, ilişki tipi, izinler ve iletişim bilgisi tutarlı mı?
5. Sınıflar listesi:
   - Seviye, şube, kampüs ve sınıf adı doğru mu?
   - Sınıf boşsa boş durum açıklayıcı mı?
6. Sınıf detay:
   - Öğrenciler doğru sınıfta mı?
   - Sınıf değişimi veya kayıt geçmişi ile çelişki var mı?

Olası iyileştirme alanları:

- Veli listesine bağlı öğrenci sayısı veya kısa öğrenci özeti.
- Öğrenci listesine veli bağlantısı için net rozet veya filtre durumu.
- Sınıf detayında öğrenci sayısı, aktif/pasif ayrımı ve hızlı öğrenci linkleri.
- Boş/hata/yükleniyor durumlarının aynı dil ve component düzeniyle hizalanması.

Doğrulama:

- API verisi ile UI satırları karşılaştırılmalı.
- En az bir öğrenci, bir veli ve bir sınıf detay sayfası tarayıcıda açılmalı.
- Console error ve network error olmamalı.

Çıkış kriteri:

- Öğrenci-veli-sınıf zinciri gerçek admin hesabıyla uçtan uca tutarlı olmalı.

## 8. Faz 4 - Sınav, Optik ve Analiz Akışı

Amaç: iSEM LGS sınavını gerçek cevap anahtarı ve optik dosyayla rapora kadar yürütmek.

Sayfalar:

- `/kurum/sinavlar`
- `/kurum/optik`
- `/kurum/raporlar`
- `/kurum/kazanimlar`

Akış:

1. Sınav oluştur veya mevcut iSEM sınavını bul.
2. Sınavı yayınla.
3. Katılımcıları ekle:
   - Tekil öğrenci ekleme
   - Sınıf filtreli toplu öğrenci ekleme
   - Katılımcı no ile `studentNo` / optik okul no uyumu
   - Kitapçık A/B bilgisi
4. OPTİK-7108 parser config:
   - Preset önerisi al.
   - Config onayla.
   - Versiyonun raw import yüklemede kullanıldığını doğrula.
5. Cevap anahtarı:
   - Excel dry-run yap.
   - Soru sayısı, branşlar, kazanımlar ve B kitapçık permütasyonu doğrulansın.
   - Import et ve gerekirse publish et.
6. Optik TXT:
   - `iSEM .txt` dosyasını upload et.
   - Raw import id ve parse job id kaydedilsin.
   - Summary endpointinde matched/quarantined/total sayıları görülsün.
7. Karantina:
   - Eşleşmeyen satırlar varsa nedeni görülsün.
   - Öğrenciyle çözümleme yapılabiliyorsa çöz.
   - Çözümleme sonrası evaluation job oluştuğu doğrulansın.
8. Değerlendirme:
   - Exam evaluation job sonuç üretmeli.
   - `ExamResult` kayıtları idempotent olmalı.
9. Rapor:
   - Report generation job çalışmalı.
   - `ReportSnapshot` READY olmalı.
   - Raporlar sayfasında sınav özeti, öğrenci karne özeti, sınıf/branş/kazanım kırılımları görünmeli.

Mimari kontroller:

- Parser config frontendde elle yorumlanmamalı.
- Cevap anahtarı Excel parsing API servisinde kalmalı.
- Kitapçık hizalama worker scoring öncesi yapılmalı.
- Rapor sayfası `ReportSnapshot` ve öğrenci snapshot endpointlerini kullanmalı.

Doğrulama:

- `apps/worker/src/jobs/optik-7108-real-pipeline.test.ts` iSEM gerçek dosyalarıyla geçmeli.
- API e2e testleri answer key, raw import, parser config, report generation yollarını kapsamalı.
- Browser'da Sınavlar → Optik Okuma → Raporlar yolu gerçek admin hesabıyla doğrulanmalı.

Çıkış kriteri:

- iSEM LGS örnek sınavı cevap anahtarı, optik TXT, değerlendirme ve rapor görünümüyle tamamlanmış olmalı.

## 9. Faz 5 - UI/UX Denetimi ve Cerrahi İyileştirme

Amaç: İş akışını daha anlaşılır, daha az hataya açık ve daha profesyonel hale getirmek.

Genel UI/UX kontrol başlıkları:

- Menü ve breadcrumb tutarlılığı
- Sayfa başlığı ve açıklama netliği
- Boş, yükleniyor, hata ve başarılı durumlar
- Tablo yoğunluğu, kolon sırası ve aksiyon ikonları
- Form validasyonu ve hata mesajları
- Uzun metin ve mobil taşma
- İşlem sırası: kullanıcı bir sonraki adımı anlayabiliyor mu?
- Rapor ve analiz ekranlarında karar verilebilir özet var mı?

Öncelikli iyileştirme adayları:

- Sınavlar sayfasında katılımcı sayısı, yayın durumu ve "Optik akışa geç" aksiyonu.
- Optik Okuma sayfasında adım bazlı durum: format, cevap anahtarı, upload, karantina, değerlendirme, rapor.
- Raporlar sayfasında son snapshot durumu, READY/STALE/FAILED rozetleri ve öğrenci/sınıf hızlı seçimleri.
- Öğrenci listesinde veli bağlantısı ve sınıf bilgisini daha görünür hale getirme.
- Veli detayında bağlı öğrenci kartları ve ilişki izinlerini sade gösterme.
- Sınıf detayında öğrenci sayısı ve aktif öğrenci listesi.

Sınır:

- Sadece bulunan gerçek sorun veya akış sürtünmesi için kod yaz.
- Yeni tasarım sistemi kurma.
- Gereksiz refactor yapma.
- Pre-existing ilgisiz dead code silme.

Doğrulama:

- Değişen her sayfa tarayıcıda masaüstü ve dar viewport ile kontrol edilmeli.
- Console error, network error ve metin taşması kontrol edilmeli.
- Önemli iyileştirmeler screenshot ile kanıtlanmalı.

Çıkış kriteri:

- UI daha anlaşılır olmalı ve mevcut mimariyi bozmadığı testlerle kanıtlanmalı.

## 10. Faz 6 - Uygulama Döngüsü

Her bulgu için aynı küçük döngü uygulanmalı:

1. Reproduce:
   - Sorunu API, test veya tarayıcıda tekrar üret.
2. Sınıflandır:
   - Veri sorunu mu?
   - Backend kontrat sorunu mu?
   - Worker/queue sorunu mu?
   - UI mapping sorunu mu?
   - UX sunum sorunu mu?
3. Test ekle veya mevcut testi genişlet:
   - Backend davranışıysa API/unit/e2e.
   - Parser/scoring ise worker fixture testi.
   - UI davranışıysa Playwright veya en az tarayıcı kanıtı.
4. Cerrahi düzelt:
   - Mevcut component, store ve service desenini kullan.
5. Doğrula:
   - Odaklı testleri çalıştır.
   - Browser ile gerçek akışı tekrar kontrol et.

Çıkış kriteri:

- Her değişikliğin nedeni, dosyası ve doğrulaması final raporda yazılabilecek kadar net olmalı.

## 11. Faz 7 - Browser ve Playwright Kanıt Matrisi

Tarayıcıyla zorunlu kontrol edilecek akışlar:

| Akış | Kontrol | Kanıt |
|---|---|---|
| Login | `/login` → `/kurum` redirect | URL, kullanıcı/tenant, screenshot |
| Menü | Sınav ve Analiz + Kişiler grupları | Link görünürlüğü |
| Öğrenciler | Liste, filtre, detay | En az 1 öğrenci screenshot |
| Veliler | Liste, detay, bağlı öğrenci | En az 1 veli screenshot |
| Sınıflar | Liste, detay, öğrenci üyeleri | En az 1 sınıf screenshot |
| Sınavlar | Sınav oluştur/yayınla/katılımcı ekle | DOM ve network kanıtı |
| Optik | 7108 config, cevap anahtarı, TXT upload | Job/raw import id |
| Raporlar | Snapshot ve öğrenci karne özeti | READY durumu, screenshot |

Browser ölçümleri:

- Console error sayısı.
- Failed request listesi.
- Ana buton ve form label erişilebilirliği.
- 1440px desktop ve yaklaşık 390px mobil görünüm.
- Metin taşması veya üst üste binme kontrolü.

Playwright önerisi:

- Var olan `apps/web/e2e-next/login-next.spec.ts` akışını bozmadan genişlet.
- Canlı worker rapor kanıtı gerekiyorsa `apps/web/e2e-next/live-ui-worker-report-next.spec.ts` desenini kullan.
- E2E test credentiallarını dosyaya yazma; env veya runtime evidence JSON içinde güvenli şekilde kullan.

## 12. Faz 8 - Test ve Smoke Kapıları

Önce odaklı testler:

```bash
corepack pnpm --filter @o-okul/api exec vitest run src/student/student.service.test.ts src/school/guardian-store.test.ts src/school/class-store.test.ts
corepack pnpm --filter @o-okul/api exec vitest run src/exam/exam.controller.e2e.test.ts src/exam/answer-key-excel-import.service.test.ts src/exam/raw-import.controller.e2e.test.ts src/report/report-generation.controller.e2e.test.ts
corepack pnpm --filter @o-okul/worker exec vitest run src/jobs/optik-7108-real-pipeline.test.ts src/jobs/optical-parse-workflow.test.ts src/jobs/exam-evaluation-job.test.ts src/jobs/report-generation-job.test.ts
corepack pnpm --filter @o-okul/web typecheck
corepack pnpm --filter @o-okul/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts
```

Canlı veya lokal tam zincir gerekiyorsa:

```bash
corepack pnpm postgres-stores:smoke
corepack pnpm raw-import:smoke
corepack pnpm report-generation:smoke
corepack pnpm live:ui-worker:smoke
```

Risk genişse:

```bash
corepack pnpm run ci
```

Test seçimi kuralı:

- Sadece UI metni değiştiyse web typecheck + browser smoke yeterli olabilir.
- Öğrenci/veli/sınıf ilişki davranışı değiştiyse API testleri zorunlu.
- Optik/cevap anahtarı/scoring değiştiyse worker gerçek fixture testi zorunlu.
- Rapor kontratı değiştiyse API report testleri ve web rapor ekranı birlikte çalışmalı.

## 13. Faz 9 - Final Rapor Formatı

Final cevap kısa ama kanıtlı olmalı:

1. Varsayımlar:
   - Hangi hesapla, hangi ortamda, hangi dosyalarla çalışıldı?
2. Mevcut durum:
   - Login, menü, veri ve sınav akışı başlangıçta ne durumdaydı?
3. Bulgular:
   - Önem sırasına göre ana sorunlar.
4. Yapılan değişiklikler:
   - Dosya bazında kısa açıklama.
5. Doğrulama:
   - Çalışan komutlar ve sonuçları.
   - Browser ile doğrulanan sayfalar.
   - Screenshot veya DOM kanıtı varsa yolu.
6. Kalan risk:
   - Ortam, veri, queue, live smoke veya kapsam dışı kalanlar.

Finalde özellikle kaçınılacak dil:

- "Çalışıyor gibi görünüyor."
- "Muhtemelen."
- "Test etmedim ama..."

Yerine:

- "Şu komut geçti."
- "Şu URL admin hesabıyla açıldı."
- "Şu endpoint şu payload ile şu sonucu verdi."
- "Şu alanı doğrulayamadım, çünkü..."

## 14. Mimari Karar Notları

- `Student.studentNo` kanonik okul numarasıdır; yeni okul no alanı açılmamalı.
- Öğrenci importunda veli bilgisi ayrı bir sistemle değil, mevcut guardian provisioning yolu ile yürümeli.
- Aynı veli telefonu varsa mevcut veli tekrar kullanılabilir; bu davranış korunmalı.
- Sınıf bağlantısı `StudentClassHistory` ve `StudentEnrollment` ile uyumlu kalmalı.
- OPTİK-7108 için parser preset, cevap anahtarı importu, B kitapçık permütasyonu ve scoring worker tarafında kalmalı.
- Rapor ekranları mümkünse `ReportSnapshot` üzerinden çalışmalı; doğrudan ham scoring hesaplaması UI'a taşınmamalı.
- RBAC tarafında kurum admin için `student:*`, `class:*`, `academic:*` capability kapsamı beklenir.

## 15. Önerilen İlk Codex Mesajı

Bu planı uygulayacak Codex çalışmasına şu şekilde başlanabilir:

> Bu planı uygula: `docs/codex-goal-browser-sinav-analiz-plan.md`. Önce goal oluştur, git ve runtime durumunu kanıtla, sonra `admin@ara.com` kurum hesabıyla tarayıcıdan giriş yap. Parolayı dosyaya yazma. Öğrenci-veli-sınıf veri tutarlılığını ve iSEM LGS OPTİK-7108 sınav akışını gerçek `ornek-veriler/` dosyalarıyla uçtan uca doğrula. Bulduğun sorunları önem sırasına koy, yalnız yüksek etkili ve düşük riskli olanları cerrahi şekilde düzelt. Her fazı test, smoke veya tarayıcı kanıtıyla kapat; finalde dosya, komut ve browser kanıtlarını kısa raporla.
