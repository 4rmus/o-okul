# Cloudflare Tunnel değerlendirmesi

Tarih: 2026-10-22. Durum: Öneri; karar ürün sahibinde (`status.md` Açık İşler madde 6).

## Sorun

Cloudflare Origin Analytics'te `o-okul.com` için Cloudflare→origin TCP el sıkışması yaklaşık 1,2 sn; doğrudan
bağlantılar 30–70 ms. Sunucu her bağlantıda tek SYN görüp hemen yanıtlıyor, sunucuda düşürme yok. En tutarlı
açıklama Cloudflare'in ilk SYN'inin barındırma sağlayıcısının ağında düşmesi (UNPROVEN). Ürün sahibi
Cloudflare Tunnel'ın maliyetini ve süresini sordu.

## Maliyet

Belgede yazanlar (EXTERNAL, test edilmedi):

- Tunnel "Available on all plans"; fiyat sayfasında ayrı satır yok
  (<https://developers.cloudflare.com/tunnel/>, <https://www.cloudflare.com/plans/network-cdn/>).
- Hesap başına 1.000 tunnel, tunnel başına 25 replica; hostname sınırı yalnız 1 MB yapılandırma boyutu
  (<https://developers.cloudflare.com/cloudflare-one/account-limits/>).
- Kurulum için Cloudflare hesabı ve Cloudflare'deki domain yeterli
  (<https://developers.cloudflare.com/tunnel/get-started/>).
- Free/Pro/Business planlarında video ve büyük dosya trafiği ayrı servis şartlarına tabi
  (<https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/>).

Çıkarım: tunnel, bağlantı, bant genişliği veya istek başına belgelenmiş ücret yok; bu kullanımda ek maliyet
beklenmiyor. Belgede açık "ücretsiz" ifadesi bulunmadığı için UNPROVEN. `o-okul.com` zonu Free planda
(2026-10-22 panel). İstek gövdesi sınırı Free/Pro'da 100 MB; apex bugün de proxied olduğu için değişmez.

## Bu yapıya uyum

Repo durumu (LOCAL_STATIC):

- `docker-compose.traefik.yml`: Traefik 80/443'ü dışa açar, ACME DNS-01 (`dnschallenge.provider=cloudflare`),
  router `Host(DOMAIN) || Host(*.DOMAIN)`.
- Traefik `forwardedheaders.trustedips` varsayılanı `127.0.0.1/32`; API `TRUSTED_PROXY_CIDRS` yalnız Traefik IP'si.
  `scripts/check-prod-env.mjs` güvenilir forwarder olarak yalnız /32 veya /128 kabul eder.

Çıkarımlar:

- Wildcard tenant host'ları tunnel'dan geçerse proxied olmak zorunda; bu, `*.o-okul.com` ve
  `staging.o-okul.com`'un pilot edge kararına kadar DNS only kalması kararıyla (2026-10-15) çelişir. Bu yüzden
  kapsam yalnız `o-okul.com`; 80/443 açık kalır ve iki edge yolu birlikte bakılır.
- ACME DNS-01 etkilenmez.
- Origin TLS: `https://traefik:443` ve `originServerName=o-okul.com`, doğrulama açık.
- İstemci IP'si: `cloudflared` için sabit iç IP hem `TRAEFIK_TRUSTED_FORWARDER_CIDRS`'e hem `TRUSTED_PROXY_CIDRS`'e
  girer. `CF-Connecting-IP`'nin tunnel trafiğinde korunması belgede açık değil; staging'de ölçülmeli (UNPROVEN).
- Yan bulgu (UNPROVEN): apex bugün proxied geliyor ve Traefik Cloudflare IP'lerine güvenmiyor; API apex
  isteklerinde istemci IP'si olarak Cloudflare edge IP'sini görüyor ve hız sınırı bu IP'lere göre sayılıyor
  olabilir. Canlı env okunmadı.

## İş kalemleri

| # | Adım | Boyut | Onay |
|---|---|---|---|
| 1 | Cloudflare'de tunnel ve `o-okul.com` yayını | S | Evet (hesap ayarı) |
| 2 | Tunnel token'ı sunucuda ve GitHub environment'ta secret | S | Evet (secret) |
| 3 | `docker-compose.cloudflared.yml`: sabit sürüm imaj, sabit iç IP, `--no-autoupdate`, metrik, healthcheck | M | Hayır |
| 4 | Güvenilir proxy IP zinciri ve ilgili env/ops/readiness kontrolleri | M | Hayır |
| 5 | Hız sınırı ve IP çözümleme testleri, XFF sahteciliği | M | Hayır |
| 6 | `staging-deploy.yml` edge seçimine `cloudflared` | M | Deploy için evet |
| 7 | Traefik HTTPS smoke'a tunnel yolu kontrolü | S | Hayır |
| 8 | DNS: apex A kaydı yerine proxied CNAME `<UUID>.cfargotunnel.com` (eski kayıt geri dönüş için not edilir) | S | Evet (DNS) |
| 9 | Runbook, `status.md`, edge DEC kaydı | S | Hayır |
| 10 | Production deploy ve ölçüm | M | Evet |

Toplam tek milestone, birkaç gate. Saat tahmini verilmedi.

## Riskler

- `cloudflared` yeni bir tek hata noktası; tek VPS'te replica gerçek yüksek erişilebilirlik sağlamaz. Tunnel düşerse
  ziyaretçi 1016 hatası görür.
- Token sızarsa trafik başka origin'e yönlendirilebilir.
- Wildcard tenant'lar kapsam dışı kalır.

## Alternatifler

- Proxied origin korunur, sağlayıcıya Origin Analytics verisi ve sunucudaki tek-SYN `tcpdump` kaydıyla bildirim
  açılır. Kod değişikliği yok, maliyeti yok; süre sağlayıcıya bağlı.
- Sağlayıcı değiştirmek: en pahalısı; PO-2 TR barındırma kararlarıyla birlikte değerlendirilir.

## Başarı ölçütü

Origin Analytics el sıkışma süresi önce ve sonra aynı aralıkta; tunnel kalıcı bağlantı kullandığı için ek olarak
apex `/health` TTFB p50/p95 harici ölçümle karşılaştırılır. Bugün iki ölçüm de yok (EXTERNAL_NOT_RUN).

## Öneri

Önce sağlayıcıya SYN düşmesi bildirimi açılır. Bir hafta içinde düzelmezse Tunnel yalnız `o-okul.com` için, önce
staging'de IP zinciri doğrulanarak uygulanır.
