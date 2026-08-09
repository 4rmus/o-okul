# ADR-0010: Control-Plane Mantıksal Ayrımı

## Durum

Kabul edildi.

## Karar

Control-plane ve tenant ürünü ilk aşamada aynı deployable modüler monolitte kalır; fakat hesap,
session, host, route, capability ve veri erişimi mantıksal olarak ayrılır. `SYSTEM_ADMIN` tenant
rolü değildir. Tenant verisine erişim yalnız süreli, MFA'lı, gerekçeli ve auditli breakglass ile
mümkündür.

## Gerekçe

Fiziksel servis ayrımı mevcut auth ve veri güven sınırını tek başına çözmez; önce aynı proses içinde
ölçülebilir ve test edilebilir realm ayrımı gerekir.

## Kaynak İzi

- Karar ID: DEC-20260809-01
- Kanıt: platform auth/RLS negatif testleri; sonraki `CP-01` dilimi

## Sonuçlar

- Tenant session control-plane route'unda reddedilir.
- Platform session tenant route'unda varsayılan olarak reddedilir.
- Ayrı deployable ancak ölçülmüş operasyon veya güven ihtiyacıyla değerlendirilir.
