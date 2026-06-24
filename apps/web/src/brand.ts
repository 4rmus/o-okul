export const appBrand = {
  name: "o-okul",
  mark: "o-o",
  domain: "o-okul.com",
  siteUrl: "https://o-okul.com",
  demoEmail: "demo@o-okul.com",
} as const;

export const appBrandTitle = `${appBrand.name} | Eğitim Kurumu Yönetim Platformu`;
export const appBrandHomeAriaLabel = `${appBrand.name} ana sayfa`;

export const demoRequestHref = `mailto:${appBrand.demoEmail}?subject=${encodeURIComponent(
  `Demo iste - ${appBrand.name}`,
)}&body=${encodeURIComponent(`Merhaba, ${appBrand.name} için demo talep ediyoruz.`)}`;
