# ADR-0011: Sürümlü ve Değişmez Okul Notu Yayını

## Durum

Kabul edildi (şema dilimi AK-2). API ve ekranlar AK-3/AK-4 ile gelir; o zamana kadar runtime durumu
`PARTIAL`dır.

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

## Sonuçlar

- Not ölçeği, ağırlıklar ve `kind` kümesi MEB yönetmeliğine karşı doğrulanmadı (UNPROVEN); ek tür
  gerekirse yalnız CHECK kısıtı genişler.
- `score <= maxScore` kontrolü AK-3'te API'de yapılır.
- Karne snapshot'ı `{gradeAssessmentId, version}` taşıyacaksa bu AK-3 sonrası ayrı dilimdir.
