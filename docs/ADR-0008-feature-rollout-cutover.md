# ADR-0008: Feature Rollout ve Cutover

## Durum

Kabul edildi.

## Karar

Almanak dönüşüm flag'leri kod sahibi, default-off bir katalogda tanımlanır. Tenant allowlist yalnız
sunucu ortamından okunur; bilinmeyen flag, eksik tenant, hatalı konfigürasyon ve süresi dolmuş kayıt
fail-closed davranır. Client yalnız kendi tenantı için çözülmüş boolean sonucu görür; allowlist'i,
tenant kimliklerini veya config kaynağını görmez.

Gate B'de runtime config mutationı ve rollout DB tablosu yoktur. Audit, enabled exposure kaydıdır;
config değişikliği deploy/config yönetimiyle izlenir. Yönetim UI'sı veya control-plane mutationı
gerektiğinde actor modeli, atomiklik, RLS ve step-up ayrı ADR/dilimle ele alınır.

## Gerekçe

İlk internal tenant rollout'u için kalıcı bir yönetim sistemi kurmak gereksiz güvenlik ve migration
yüzeyi açar. Server-only allowlist rollback ihtiyacını davranış açmadan karşılar.

## Kaynak İzi

- Karar ID: DEC-20260809-01
- Kanıt: `pnpm feature-rollout:check`, API negatif testleri

## Sonuçlar

- Her flag owner, expiry ve removal issue taşır.
- İlk catalog flag'lerinin tamamı default-off'tur.
- Staging/production tenant aktivasyonu ayrı dış ortam kararı ve kanıtıdır.
