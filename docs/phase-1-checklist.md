# Faz 1 Uygulama Checklist'i

Bu dosya Faz 1 okul yönetimi işini küçük ve doğrulanabilir parçalara böler. Canlı dış ortam
kanıtları ayrıca takip edilir.

## Varsayımlar

- Veli-öğrenci bağlama kuralı `DEC-20260531-01` ile netleşti: bağlantıyı kurum yöneticisi kurar ve
  kaldırır; öğretmen rolü yalnız okur.
- Lokal Compose/Postgres smoke kanıtı repo gate içinde takip edilir.
- `CLASS_STORE=postgres` Class CRUD için Postgres store yolunu açar; varsayılan `in-memory`
  demo/test yoludur.
- `STUDENT_STORE=postgres` Student CRUD ve Excel import/export için Postgres store yolunu açar;
  varsayılan `in-memory` demo/test yoludur.
- `TEACHER_STORE=postgres` ve `GUARDIAN_STORE=postgres` Teacher/Guardian CRUD için Postgres store
  yolunu açar; varsayılan `in-memory` demo/test yoludur.
- `GUARDIAN_STUDENT_STORE=postgres` veli-öğrenci bağlantıları için Postgres store yolunu açar;
  varsayılan `in-memory` demo/test yoludur.
- Faz 1'de tenant izolasyonu ve kota hard-block davranışı CI'da kırmızı çizgidir.

## PR Sırası

| PR | Hedef | Sahip | Değişecek alan | Kanıt |
|---|---|---|---|---|
| 1 | School CRUD API temeli | backend-architect | `apps/api/src/school`, `apps/api/src/student` | Kısmi: Class/Teacher/Guardian/Student CRUD endpointleri için opt-in Postgres store ve Student kota hard-block eklendi; `pnpm --filter @o-okul/api test` geçti |
| 2 | Class CRUD DB-backed geçiş | backend-architect | `apps/api/src/school/class-store.ts`, Postgres bağlantısı | Tamam: `CLASS_STORE=postgres` Postgres Class store, SQL parametre testi ve `pnpm postgres-stores:smoke` canlı DB/RLS kanıtı geçti |
| 3 | Web CRUD shell | frontend-architect | `apps/web` | Kısmi: login sonrası Class, Teacher, Guardian ve Student listele/create/update/delete ekranları eklendi; bearer token `/classes`, `/teachers`, `/guardians`, `/students` çağrıları Playwright ile doğrulandı; `pnpm --filter @o-okul/web test`, `pnpm --filter @o-okul/web test:e2e`, `pnpm run ci` geçti |
| 4 | Excel dry-run import/export | backend-architect | API + worker import job | Kısmi: Student Excel dry-run/import/export API eklendi; satır-bazlı hata, dry-run yazmama, kota 409, `createMany` transaction rollback ve worker tenant context testleri geçti; canlı BullMQ smoke kanıtı var |
| 5 | Kota ve kalite kapanışı | quality-engineer | testler, doküman | Kısmi: öğrenci kota aşımı create/import için 409, dry-run kota raporu, kısmi import rollback e2e kapsamı ve Teacher/Guardian Postgres store smoke kapsamı eklendi; CI yeşil |

## Bu Turun Kanıtı

- `GET /classes` tenant A için sadece tenant A kayıtlarını döner.
- Tenant A, tenant B class/teacher kaydına erişemez.
- Tenant admin kendi tenant'ında class create/update/delete yapabilir.
- Tenant admin başka `tenantId` ile class oluşturamaz.
- Guardian bağımsız create/update akışı çalışır.
- Student bağımsız create/update/delete akışı tenant içinde çalışır.
- Tenant A, tenant B student kaydını okuyamaz/güncelleyemez/silemez.
- Student create, tenant öğrenci kotasını aşınca `409 STUDENT_QUOTA_EXCEEDED` döner.
- Web login sonrası Class, Teacher, Guardian ve Student CRUD akışları bearer token ile çalışır.
- Student Excel dry-run gerçek `.xlsx` dosyasını okuyup satır-bazlı hata döner ve kayıt yazmaz.
- Student Excel import hata veya kota aşımında kayıt yazmadan durur; başarılı import sonrası tenant kotası korunur.
- Aynı Excel import dosyasında geçerli ve hatalı satır birlikte gelirse kısmi yazım yapılmaz.
- Student Excel export tenant öğrencilerini `.xlsx` içeriği olarak döner.
- `excel-import` worker handler eksik tenant payload'u ve yanlış job adını reddeder; adapter DB erişimini
  tenant context içinde yapar.
- `pnpm postgres-stores:smoke` Teacher, Guardian ve Student Postgres store create/update/purge/
  soft-delete ve tenant izolasyonunu canlı DB üzerinde doğrular; Student için `createMany`, Guardian
  için `GuardianStudent` bağlantısı da kapsanır.

## Kalan Riskler

- Class, Teacher, Guardian, GuardianStudent ve Student için Postgres store kod yolu ve canlı
  DB-backed CRUD/RLS smoke kanıtı var.
- Web CRUD shell şimdilik Class, Teacher, Guardian ve Student ekranlarını kapsıyor.
- Excel import/export Student Postgres store yoluyla çalışabilir; gerçek BullMQ tüketimi canlı smoke
  ile kanıtlıdır; `createMany` hata durumunda tenant transaction rollback testiyle korunur.
- Veli-öğrenci bağlantısı API ve Postgres store yolu eklendi; telefon doğrulama/self-service
  eşleştirme v1 kapsamı dışıdır.
