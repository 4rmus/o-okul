# Kurum Subdomaini ve Giriş Mimarisi

## Karar

Her kurum tek paylaşımlı uygulama ve veritabanı üzerinde `{tenantSlug}.o-okul.com` adresinde
çalışır. `o-okul.com` tanıtım ve kurum adresi bulma, `sistem.o-okul.com` platform yönetimi için
ayrılır. Kampüsler subdomain olmaz; özel kurum domainleri v1 kapsamı dışındadır.

Kurum hostu tenant bağlamını belirler. Öğrenci, öğrenci numarası veya doğrulanmış e-posta;
çalışan ve öğretmen, personel numarası veya doğrulanmış e-posta ile giriş yapar. Yönetici MFA
kuralları değişmez. Global kullanıcı adı/e-posta tekilliği veya tenant başına deployment eklenmez.

## Güvenlik sözleşmesi

- Tenant slug tek DNS etiketi, `3-63` karakter ve `a-z0-9` ile iç konumda `-` kullanır.
- `www`, `sistem`, `system`, `api`, `admin`, `ops`, `evidence`, `status`, `staging`, `mail`, `support`,
  `cdn` ve `assets` ayrılmıştır.
- Slug oluşturulduktan sonra değiştirilemez; mevcut sluglar canlı aktivasyon öncesi
  `pnpm tenant-subdomain:preflight` ile doğrulanır.
- API forwarded hostu yalnız exact trusted proxy adresinden kabul eder; diğer isteklerde doğrudan
  `Host` kullanır. Bilinmeyen veya ayrılmış host varsayılan tenant'a düşmez.
- Tenant hostu ile access/refresh session tenantı eşleşmek zorundadır. RLS ve request tenant
  context'i asıl veri izolasyonu olmaya devam eder.
- Refresh ve CSRF cookie'leri host-only kalır; `Domain=.o-okul.com` kullanılmaz.
- Tarayıcı API çağrıları same-origin `/api/v1` yolunu kullanır; production wildcard CORS açılmaz.
- Evidence ve operasyon yüzeyleri yalnız exact host kurallarıyla yayınlanır.

## Geçiş sözleşmesi

Canonical login isteği `{ loginName, password }` biçimindedir. `tenantSlug`, geçiş süresince
opsiyonel ve deprecated kalır: tenant hostunda verilirse hostla eşleşir; root hostunda yalnız
`LEGACY_TENANT_LOGIN_CUTOFF_AT` tarihine kadar kabul edilir. Aynı kural parola sıfırlama ve öğrenci
aktivasyonunda uygulanır.

Eski `/k/{slug}/giris` ve `/sistem/giris` rotaları canlı aktivasyondan itibaren 30 gün yeni hosta
`307` yönlendirir; kesim sonrasında `410 LEGACY_TENANT_LOGIN_RETIRED` döner. Davet, aktivasyon ve
reset linkleri doğrulanmış tenant slugı ile merkezi origin builder üzerinden üretilir.

## Edge ve sertifika

Production sertifikası `o-okul.com` ve `*.o-okul.com`; staging sertifikası `staging.o-okul.com` ve
`*.staging.o-okul.com` isimlerini kapsar. Traefik ACME HTTP-01 yerine Cloudflare DNS-01 kullanır.
`CF_DNS_API_TOKEN` yalnız `o-okul.com` zone DNS yetkisiyle secret olarak verilir; repo, log ve
evidence artifact'ine yazılmaz.

## Kabul ve kanıt

Host parser; yanlış suffix, çok seviyeli host, port, büyük harf, Unicode/punycode, ayrılmış slug ve
sahte forwarded host negatiflerini kapsar. API iki tenantta aynı login kimliğini ayırmalı, A tokenını
B hostunda reddetmeli, sistem/tenant hostlarını ayırmalı ve cookie'de `Domain` üretmemelidir.

Yerel typecheck/test/OpenAPI, web a11y/UX, RLS, token-storage, MFA, rate-limit, security ve ops
kapıları gerçek wildcard DNS/TLS kanıtı değildir. Staging/canlı kapanış exact SHA, çalışan image,
gerçek sertifika SAN/yenileme, iki tenant hostu, cross-host `403`, legacy `307/410` ve rollback
kanıtını ayrı toplar.

Kaynaklar: [Traefik ACME DNS challenge](https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/),
[Cloudflare API token kapsamı](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/),
[RFC 6265](https://www.rfc-editor.org/info/rfc6265/).
