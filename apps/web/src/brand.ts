export const appBrand = {
  name: "o-okul",
  mark: "o-o",
  domain: "o-okul.com",
  siteUrl: "https://o-okul.com",
  operationsEmail: "operasyon@o-okul.com",
  demoEmail: "demo@o-okul.com",
  supportEmail: "destek@o-okul.com",
  privacyEmail: "kvkk@o-okul.com",
  notificationEmail: "bildirim@o-okul.com",
} as const;

export const appBrandTitle = "O-Okul | Optik Sınav Raporlama ve Kurum Takibi";
export const appBrandHomeAriaLabel = `${appBrand.name} ana sayfa`;

export const demoRequestHref = mailtoHref(appBrand.demoEmail, `Demo talebi - ${appBrand.name}`, `Merhaba,

${appBrand.name} için demo talep ediyoruz.

Kurum türü:
Şube sayısı:
Yaklaşık öğrenci sayısı:
Öncelikli gelişim veya başarı takip ihtiyacımız:
Demo görüşmesinde görmek istediğimiz kullanıcı ekranları:

Not: İlk talepte öğrenci bilgisi, TCKN veya dosya göndermeyin.`);

export const platformSupportHref = mailtoHref(appBrand.supportEmail, `${appBrand.name} platform desteği`, `Merhaba,

Yaşadığınız sorunu kişisel veri içermeden kısaca açıklayın.

Kurum kodu (gerekirse):
Sorunun görüldüğü ekran:
Sorun özeti:

Not: Öğrenci bilgisi, TCKN, parola, aktivasyon kodu veya dosya göndermeyin.`);

export const privacyRequestHref = mailtoHref(appBrand.privacyEmail, `${appBrand.name} KVKK başvurusu`, `Merhaba,

KVKK başvurunuzun konusunu kişisel verileri gereksiz yere çoğaltmadan açıklayın.

Başvuru konusu:
Tercih edilen dönüş kanalı:

Not: İlk e-postada öğrenci dosyası, TCKN, parola veya aktivasyon kodu göndermeyin.`);

function mailtoHref(email: string, subject: string, body: string) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
