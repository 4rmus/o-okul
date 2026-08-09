# ADR-0009: PII-Safe Product Analytics

## Durum

Kabul edildi.

## Karar

Product event adı ve payload alanları allowlist ile doğrulanır. Ad/soyad, TCKN, telefon/e-posta,
öğrenci numarası, dosya adı/içeriği, cevap anahtarı, sonuç/net/puan, destek mesajı, ödeme tutarı/notu
ve kişisel query içeren URL event'e giremez. Route family, feature key ve her event property değeri
sonlu allowlist'ten gelir. Tenant yalnız sunucu tarafında en az 32 karakterlik gizli anahtarla
üretilmiş HMAC-SHA256 pseudonym olarak taşınabilir; ham 64-hex değer doğrulama bağlamı olmadan
kabul edilmez.

Gate B yalnız şema ve reddetme kontratını kurar; analytics vendor, gönderim transportu ve consent
yüzeyi eklemez.

Bu gate'teki güvenilir tenant pseudonym bağlamı yalnız doğrulama kontratıdır. HMAC üretimi, anahtar
saklama/rotasyon ve event transportu sonraki dilimdir; yerel şema kontrolü bunların çalıştığına dair
kanıt değildir.

Serbest `correlationId` ve `errorCode` alanları transport kurulana kadar event sözleşmesinde yoktur.
Sunucu üretimli opaque correlation ve sonlu hata kodu kataloğu ayrı bir şema değişikliği olmadan
eklenemez.

## Gerekçe

Event şemasını transporttan önce kilitlemek, PII'nin vendor veya log sistemine çıktıktan sonra
temizlenmesine güvenmekten daha güvenlidir.

## Kaynak İzi

- Karar ID: DEC-20260809-01
- Kanıt: `pnpm product-analytics-schema:check`

## Sonuçlar

- Bilinmeyen event ve property reddedilir.
- PII negatif fixture CI'ı kırar.
- Local schema PASS gerçek analytics teslimatı değildir.
