export const appBrand = {
  name: "o-okul",
  mark: "o-o",
  domain: "o-okul.com",
  siteUrl: "https://o-okul.com",
  demoEmail: "demo@o-okul.com",
} as const;

export const appBrandTitle = `${appBrand.name} | Öğrenci Gelişimi ve Sınav Başarı Takibi`;
export const appBrandHomeAriaLabel = `${appBrand.name} ana sayfa`;

export const demoRequestHref = `mailto:${appBrand.demoEmail}?subject=${encodeURIComponent(
  `Demo talebi - ${appBrand.name}`,
)}&body=${encodeURIComponent(`Merhaba,

${appBrand.name} için demo talep ediyoruz.

Kurum türü:
Şube sayısı:
Yaklaşık öğrenci sayısı:
Öncelikli gelişim veya başarı takip ihtiyacımız:
Demo görüşmesinde görmek istediğimiz kullanıcı ekranları:

Not: İlk talepte öğrenci bilgisi veya dosya göndermeyin.`)}`;
