# ADR-0007: Read Model Endpointleri ve Ayrı BFF Kurmama

## Durum

Kabul edildi.

## Karar

Karmaşık çalışma alanları mevcut API modüler monoliti içinde persona ve görev odaklı read model
endpointleri kullanır. İlk dönüşümde ayrı BFF servisi, GraphQL katmanı veya mikroservis eklenmez.
Controller ince kalır; domain otoritesi use-case/service katmanındadır.

## Gerekçe

Ayrı deployment sınırı mevcut sorunu çözmeden auth, tracing ve cache tutarlılığı maliyeti ekler.
Mevcut NestJS modülleri görev odaklı projection için yeterlidir.

## Kaynak İzi

- Karar ID: DEC-20260809-01
- Kanıt: API module yapısı; sonraki `EX-01` read model testleri

## Sonuçlar

- Client çoklu çağrı orkestrasyonu yerine gerektiğinde tek read model tüketir.
- Read model tenant/persona/scope'u sunucuda yeniden doğrular.
- Ayrı servis ancak ölçülmüş bağımsız ölçek veya güven sınırı gereksinimiyle değerlendirilir.
