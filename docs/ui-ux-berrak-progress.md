# Berrak UI/UX Yeniden Tasarım — İlerleme Kaydı

Plan: `docs/ui-ux-berrak-redesign-plan.md`. Her gate stacked branch'te yürür
(`berrak/gN-<ad>`), tek yazıcı kuralı geçerlidir. Kanıt sınıfları ayrı raporlanır:
`LOCAL_STATIC`, `LOCAL_TEST`, `CI`, `STAGING`, `PRODUCTION`, `EXTERNAL_NOT_RUN`, `UNPROVEN`.
Local PASS staging kanıtı değildir. Secret değerleri bu dosyaya yazılmaz; yalnız ad ve saklama yeri.

## Ortam notları

- `.codex/config.toml` kullanıcıya ait commit'lenmemiş değişiklik taşır (`network_access = true`).
  Bu nedenle çalışma ağacında `pnpm agents:check` kırmızıdır; committed config ile temiz worktree'de
  koşulur ve PASS verir. Dosya hiçbir gate'te commit'lenmez.
- Docker bu makinede yok: Linux golden'ları `EXTERNAL_NOT_RUN`.

## Gate durumu

| Gate | Branch | Durum | PR |
|---|---|---|---|
| G0 Plan ve karar kayıtları | `berrak/g0-plan-kararlar` | Tamam | draft PR |

## G0 — Plan ve karar kayıtları

- Hedef: Planı `docs/ui-ux-berrak-redesign-plan.md` olarak repoya koy; DEC-20260930-01/-02/-03
  yaz; ADR-0005'e runtime manifest notu ekle; UI/UX sözleşmesine "Berrak ile değişti" bölümü ekle.
- Sahip olunan yollar: `docs/**`.
- Yasak yollar: kod (`apps/**`, `packages/**`, `scripts/**`).
- Kabul: `pnpm agents:check`, `pnpm ui-ux-professionalization:completion:contract`.
- Doğrulama: yukarıdakiler + `pnpm ui-ux-redesign:local-gates`, `pnpm route-manifest:check`.

### G0 kanıt

| Sınıf | Sonuç |
|---|---|
| `LOCAL_STATIC` | PASS: `pnpm agents:check` (committed config, temiz worktree), `pnpm ui-ux-professionalization:completion:contract`, `pnpm route-manifest:check` (87 route) |
| `LOCAL_TEST` | PASS: `pnpm ui-ux-redesign:local-gates` (visual QA 31/31) |
| `CI` | PR CI'da izlenir |
| `STAGING` / `PRODUCTION` | `EXTERNAL_NOT_RUN` (yalnız doküman) |

Review (`o-okul-pr-review`, read-only): yalnız doküman değişikliği; P0/P1 bulgu yok.
Görsel kanıt: ekran değişmedi, gerekmez.
