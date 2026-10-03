# ADR-0011: Sürümlü ve Değişmez Okul Notu Yayını

## Durum

Kabul edildi. Şema (AK-2), API (AK-3) ve ekranlar (AK-4) uygulandı; kanıt LOCAL_TEST, STAGING
`EXTERNAL_NOT_RUN`.

## Karar

Okul notu (yazılı, performans, proje, derse katılım) optik deneme hattından ayrı bir bağlamdır.
`Exam`, `ExamResult`, `ReportSnapshot` (`examId` zorunlu) ve `RawImport` değişmez; sentetik `Exam`
kaydı açılmaz. Başarı % yalnız deneme serisinde kalır.

İki tablo eklenir:

- `GradeAssessment`: sınıf, ders ve dönem bileşik FK ile aynı tenant'a bağlıdır; `kind`
  `WRITTEN | PERFORMANCE | PROJECT | PARTICIPATION`, `maxScore` varsayılan 100. `publishedVersion`
  geçerli yayının (`max(version)`) önbelleğidir ve yayın transaction'ında yazılır; `notifiedVersion`
  bildirim dedupe'u içindir.
- `GradeEntry`: yalnız eklenir. Tekillik `(tenantId, assessmentId, studentId, version)`. Taslak satır
  düzenlenebilir; `publishedAt` dolduktan sonra satır değişmez. Düzeltme yeni `version` satırıdır.

Değişmezlik veritabanında zorlanır, uygulamaya bırakılmaz:

- `protect_grade_entry` BEFORE UPDATE/DELETE trigger'ı yayınlanmış satırı reddeder
  (`GRADE_ENTRY_PUBLISHED_IMMUTABLE`) ve kimlik kolonlarının değişmesini engeller. Tek istisna,
  hukuki onaylı ve çocuk-önce sırayla çalışan `o_okul_reset_worker`'dır. Öğrenci veya
  değerlendirme silindiğinde çalışan cascade tablo sahibi olarak koştuğu için o da reddedilir.
- `app` rolüne `GradeEntry` üzerinde DELETE yetkisi verilmez; `check-rls.mjs` bu profili
  (`SELECT, INSERT, UPDATE`) doğrular. Yazma politikası `app.bypass_rls`'i kabul etmez.
- `protect_grade_assessment`, yayınlanmış değerlendirmenin sınıf, ders, dönem, tür, tarih ve
  ölçeğini sabitler; `publishedVersion` yalnız ileri gider.

Cihaz yedeği iki tabloyu içerir; restore onları finans geçmişi gibi korur (PRESERVE) ve yeniden
yazmaz. Daha eski bir yedeği geri yüklemek, sonradan yayınlanmış not veya düzeltmeyi sessizce
silemez. Yayınlanmış notu olan öğrenciyi kaldıracak bir restore trigger'a takılır ve geri alınır.

## Gerekçe

Ürün tezi "yayınlanan hiçbir sayı sessizce değişmez" der. Bu ancak hatalı bir servis kodu veya
restore akışı da aynı garantiye tabi olursa savunulabilir. İki tablo ve `max(version)` modeli,
ayrı yayın tablosu, içerik hash'i veya STALE durumu kadar güçlü değişmezlik sağlar ve daha az
yüzey açar.

## Kaynak İzi

- Plan: `docs/ozel-k12-strateji-ve-yol-haritasi-plan.md` §4.5 ve §7.2 (AK-1 + AK-2); taslak DEC D4.
- Kanıt: `packages/db/prisma/migrations/20261003120000_gradebook/migration.sql`,
  `pnpm db:rls:check`, `apps/api/src/operations/tenant-table-coverage.test.ts`.

## Uygulama (AK-3, AK-4)

- `GET/POST /grade-assessments`, `GET /grade-assessments/:id` (bütün sürümler),
  `PUT /grade-assessments/:id/entries` (taslak), `POST /grade-assessments/:id/publish`.
- Tanım ve yayın `academic:manage` ister; yayında Idempotency-Key zorunludur (anahtarsız 400) ve aynı
  anahtar tek yayın üretir. Yayın, taslakları ve `publishedVersion`'ı tek transaction'da, değerlendirme
  satır kilidi altında yazar; `grade_assessment.published` audit kaydı düşer.
- Not girişi: sınıf, ders ve dönem için atanmış `CLASS_TEACHER`/`BRANCH_TEACHER` veya
  `academic:manage`. Yayınlanmış nota yazmak yeni taslak sürüm açar. Kampüs kapsamı dışındaki kayıt
  ve diğer tenant 404 alır; atanmamış öğretmen 403.
- Ekranlar: `/kurum/not-defteri` (tanım, not kontrolü, sürüm geçmişi, değişmezlik uyarılı yayın) ve
  `/ogretmen/not-defteri` (atanan değerlendirmelere taslak giriş). Yayınlanmış hücre salt okunurdur;
  "Düzelt" yeni sürüm taslağı açar.
- Öğretmen not defteri rol önizlemesinde açılmaz; API önizleme başlığını desteklemez.

## Sonuçlar

- Not ölçeği, ağırlıklar ve `kind` kümesi MEB yönetmeliğine karşı doğrulanmadı (UNPROVEN); ek tür
  gerekirse yalnız CHECK kısıtı genişler.
- Karne snapshot'ı `{gradeAssessmentId, version}` taşıyacaksa bu AK-3 sonrası ayrı dilimdir.
