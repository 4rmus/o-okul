# Faz 1 Durum Raporu

## Tamamlanan repo içi kapsam

- `classes`, `teachers`, `guardians` için tenant izole CRUD endpointleri eklendi.
- Class CRUD için `CLASS_STORE=postgres` ile açılan Postgres store kod yolu eklendi.
- Teacher/Guardian CRUD için `TEACHER_STORE=postgres` ve `GUARDIAN_STORE=postgres` ile açılan
  Postgres store kod yolu eklendi.
- `students` için tenant izole CRUD endpointleri ve tenant bazlı kota hard-block eklendi.
- Student CRUD ve Excel import/export için `STUDENT_STORE=postgres` ile açılan Postgres store kod
  yolu eklendi.
- Student Excel dry-run/import/export API eklendi; dry-run yazmadan satır-bazlı hata döner, import
  hata veya kota aşımında kayıt yazmadan durur.
- PR5 kalite kanıtı olarak student create/import kota `409`, dry-run kota raporu ve karışık
  geçerli+hatalı import dosyasında kısmi yazım olmaması e2e kapsamına alındı.
- `excel-import` worker handler eklendi; job payload doğrulama, job adı ayrımı ve tenant context
  içinde adapter çağırma davranışı testlendi.
- School API için Supertest e2e kapsamı eklendi.
- Web dashboard içine Class, Teacher, Guardian ve Student listeleme, oluşturma, düzenleme ve silme
  akışları eklendi.

## Çalıştırılan doğrulamalar

- `pnpm --filter @uzman-hocam/api typecheck`
- `pnpm --filter @uzman-hocam/api test`
- `pnpm --filter @uzman-hocam/api test -- student-store app school homework study-session`
- `pnpm --filter @uzman-hocam/web test`
- `pnpm --filter @uzman-hocam/web test:e2e`
- `pnpm --filter @uzman-hocam/web build`
- `pnpm postgres-stores:smoke`
- `pnpm --filter @uzman-hocam/worker typecheck`
- `pnpm --filter @uzman-hocam/worker test`
- `pnpm run ci`
- Canlı lokal Playwright smoke: login -> Class/Teacher/Guardian/Student listele -> create -> update ->
  delete.
- API Supertest: gerçek `.xlsx` ile Student dry-run, satır-bazlı hata, import rollback/kota ve export
  doğrulandı.
- API Supertest: student create kota hard-block ve karışık geçerli+hatalı import dosyasında kısmi
  yazım olmaması doğrulandı.

## Subagent notu

Subagent ilk güvenli dilimin DB-backed Class CRUD olmasını önerdi. Bu doğru hedef olarak kabul
edildi. Class için Postgres store kod yolu, SQL parametre testi ve canlı `pnpm postgres-stores:smoke`
kanıtı eklendi; Class CRUD tenant izolasyonuyla canlı DB üzerinde doğrulandı.

Sonraki subagent kontrolü Student CRUD için en küçük güvenli değişikliğin `PATCH /students/:id`,
`DELETE /students/:id` ve ardından web Student CRUD akışı olduğunu işaretledi. Bu dilim repo içinde
tamamlandı. Ardından Teacher, Guardian ve Student için opt-in Postgres store eklendi;
`pnpm postgres-stores:smoke` Teacher/Guardian/Student create/update/purge/soft-delete ve tenant
izolasyonunu canlı DB üzerinde doğrular.

PR4 için subagent kontrolü dış Postgres/Redis/Docker olmadan en küçük hizalı adımın Student Excel
dry-run karar motoru ve API kanıtı olduğunu belirtti. Bu turda gerçek `.xlsx` parse eden dry-run,
import ve export endpointleri eklendi; gerçek BullMQ worker ve Postgres transaction kanıtı sonraki
dilimde kalır.

Son worker subagent kontrolü, worker payload'una dosya/satır içeriği taşımadan sadece
`entityId + contentHash` referansıyla iş yürütülmesini önerdi. Worker handler bu sınıra göre
eklendi; gerçek Redis/BullMQ tüketimi `pnpm queue:smoke` ve `pnpm raw-import:smoke` ile lokal canlı
Redis/Postgres/MinIO üzerinde doğrulandı.

PR5 kalite kontrolünde subagent, create kota `409` kanıtının ana e2e içinde açık olmadığını ve
karışık geçerli+hatalı import dosyasında kısmi yazım riskinin testlenmesi gerektiğini belirtti.
Bu iki test eklendi.

## Sonradan kapanan işler

- Excel import API tarafında hata veya kota aşımında kısmi yazım yapmama e2e kapsamına alındı;
  `StudentStore.createMany` hata halinde tenant transaction rollback davranışını test ediyor.
- Veli-öğrenci bağlama kuralı `DEC-20260531-01` ile kapatıldı; kurum yöneticisi yazar, teacher
  sadece okur.
