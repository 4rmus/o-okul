# Faz B Liste Query Sözleşmesi

Bu not `MASTER_PLAN.md` §3.4 ve §10.6 içindeki liste/meta beklentisini Faz B için netleştirir.

## Mevcut Durum

- Liste endpointleri `{ data, meta }` zarfı döner.
- `meta.total`, `meta.page`, `meta.limit` ve `meta.totalPages` alanları global response interceptor tarafından üretilir.
- Faz B kapanışında Next ekranları listeyi tek sayfa olarak okuyordu; sonraki dar kapsamta sınıf, öğretmen, veli ve öğrenci ekranları server-side sayfalama, arama ve sıralama parametresi göndermeye başladı.
- `CrudPage` ortak başlık, tablo, ana aksiyon ve modal düzenini korur; kişi çekirdeği ekranlarında ek liste kontrolleri kullanılır.

## Faz B Kararı

Faz B kalite kapısı için zorunlu sözleşme:

```txt
GET /api/v1/<resource>
200 { data: T[], meta: { total: number, page: 1, limit: number, totalPages: 0 | 1 } }
```

Boş liste için `totalPages=0`; dolu liste için `totalPages=1`.

## Faz B Sonrası Genişleme

Kişi çekirdeği listelerinde gerçek server-side listeleme başladı:

```txt
GET /api/v1/<resource>?page=1&limit=25&q=metin&sort=name:asc
```

- `page`: 1 tabanlı sayfa numarası.
- `limit`: sayfa boyutu.
- `q`: kaynak bazlı basit metin araması.
- `sort`: `field:asc` veya `field:desc`.
- Kaynak özel filtreler açık isimli query parametreleriyle eklenecek.

Bu genişleme şimdilik `/classes`, `/teachers`, `/guardians` ve `/students` ile sınırlıdır.
