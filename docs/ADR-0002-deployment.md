# ADR-0002: İlk Dağıtım Modeli

## Durum

Kabul edildi.

## Karar

İlk sürüm VPS üzerinde Docker Compose ile çalışır. Traefik TLS termination yapar; API, web, worker,
Postgres, Redis ve MinIO servisleri compose ile yönetilir.

## Gerekçe

Başlangıç için düşük operasyon karmaşıklığı ve KVKK/veri ikametgahı kontrolü önemlidir. TR
datacenter seçimi bu yüzden dağıtım kararının parçasıdır.

## Kaynak İzi

- Karar ID: DEC-20260529-02
- Kaynak: `docs/DECISIONS.md`
- Kanıt: `MASTER_PLAN.md` §2, §3.7

## Sonuçlar

- `frontend_net` ve `backend_net` ayrılır; web doğrudan DB/Redis/MinIO görmez.
- Her servis healthcheck üretir.
- Staging ve prod ortamları ayrı override dosyaları veya ayrı VPS ile ayrılır.
- Traefik v3.7.5 ACME HTTP-01, entrypoint ve Docker label sözdizimi resmi dokümanla doğrulandı;
  canlı HTTPS kanıtı staging domain gerektirir.
