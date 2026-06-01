# Faz D Rol Portalları Checklist'i

Bu dosya `MASTER_PLAN.md` §10.6 Faz D kapsamını doğrulanabilir parçalara böler.

## Varsayımlar

- Faz C backend yüzeyleri korunur; rol portalları mevcut `/me/**` endpointlerini kullanır.
- Portal ekranları kişi hesabı ister; tenant admin oturumu rol portalı yerine kurum panelinde kalır.
- Kimlik-bağı davet/göç akışı ürün onayı beklediği için bu turda yeni davet sistemi eklenmez.

## Durum Denetimi

| Parça | Mevcut durum | Kanıt |
|---|---|---|
| `/me/**` envanteri | Başladı: öğrenci profil/devamsızlık/not, veli bağlı öğrenci profil/devamsızlık/not/ödeme, öğretmen profil/program yüzeyleri rol portallarında kullanılıyor | `pnpm --filter @uzman-hocam/web next:e2e` |
| Öğrenci portalı | Tamamlandı: Next `/ogrenci` profil, devamsızlık özeti/listesi ve öğretmen notlarını gerçek `/me/student/**` çağrılarıyla gösterir | `pnpm --filter @uzman-hocam/web next:e2e` |
| Öğretmen portalı | Tamamlandı: Next `/ogretmen` öğretmen bilgisi ve ders programını gerçek `/me/teacher/**` çağrılarıyla gösterir | `pnpm --filter @uzman-hocam/web next:e2e` |
| Veli portalı | Tamamlandı: Next `/veli` bağlı öğrenci seçimi, profil, devamsızlık, öğretmen notu ve ödeme planlarını gerçek `/me/guardian/**` çağrılarıyla gösterir | `pnpm --filter @uzman-hocam/web next:e2e` |
| Rol bazlı web menüsü | Tamamlandı: kurum admin yalnız kurum menüsünü, öğretmen/öğrenci/veli yalnız kendi portal menüsünü görür; yanlış başlangıç rotası role uygun ana ekrana yönlenir | `pnpm --filter @uzman-hocam/web test:e2e` |
| Kurum menü hiyerarşisi | Tamamlandı: kurum menüsü Kişiler, Akademik, Sınav/Rapor, İletişim ve Operasyon gruplarına ayrıldı | `pnpm --filter @uzman-hocam/web test:e2e` |
| Öğretmen kapsam guard'ı | Tamamlandı: öğretmen öğrenci listesi/veli bağlantısı/yoklama/not/ödev kontrolünde yalnız sorumlu öğrenci veya ders programı kapsamını görür | `pnpm --filter @uzman-hocam/api exec vitest run src/tenant/tenant-access.test.ts src/app.e2e.test.ts src/attendance/attendance.e2e.test.ts src/teacher-note/teacher-note.e2e.test.ts src/homework/homework.e2e.test.ts src/program/schedule.e2e.test.ts src/program/study-session.e2e.test.ts` |
| Geniş negatif erişim matrisi | Tamamlandı: öğrenci/veli/öğretmen `/me` yüzeyleri için yanlış rol, hiyerarşi tuzağı, bağlı olmayan öğrenci ve başka tenant denemeleri tek e2e matrisinde doğrulanıyor | `pnpm --filter @uzman-hocam/api exec vitest run src/me/me-access-matrix.e2e.test.ts src/app.e2e.test.ts src/student/student-profile.e2e.test.ts` |

## Sonraki Uygulama Sırası

1. Kimlik-bağı davet/göç akışı için ürün onayı.
2. `TeacherAssignment` ürünü: sorumlu öğrenci, ders programı ve etüt kapsamını kalıcı ders/şube/dönem modelinde birleştirme.
