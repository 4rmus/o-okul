import { isIP } from "node:net";

export interface SessionClientContext {
  deviceLabel?: string;
  clientIpPrefix?: string;
}

export function sessionClientContext(userAgent: string | undefined, clientIp: string | undefined): SessionClientContext {
  return {
    deviceLabel: deviceLabel(userAgent),
    clientIpPrefix: clientIpPrefix(clientIp),
  };
}

export function deviceLabel(userAgent: string | undefined): string | undefined {
  if (!userAgent?.trim()) return undefined;
  const browser = userAgent.includes("Edg/") ? "Edge"
    : userAgent.includes("Firefox/") ? "Firefox"
      : userAgent.includes("Chrome/") || userAgent.includes("CriOS/") ? "Chrome"
        : userAgent.includes("Safari/") ? "Safari"
          : "Tarayıcı";
  const device = userAgent.includes("iPhone") ? "iPhone"
    : userAgent.includes("iPad") ? "iPad"
      : userAgent.includes("Android") ? "Android"
        : userAgent.includes("Windows") ? "Windows"
          : userAgent.includes("Mac OS X") ? "macOS"
            : userAgent.includes("Linux") ? "Linux"
              : "Cihaz";
  return `${browser} · ${device}`;
}

export function clientIpPrefix(clientIp: string | undefined): string | undefined {
  const normalized = clientIp?.trim().replace(/^::ffff:/, "");
  if (!normalized) return undefined;
  if (isIP(normalized) === 4) return `${normalized.split(".").slice(0, 3).join(".")}.0/24`;
  if (isIP(normalized) === 6) return "IPv6 /64";
  return undefined;
}
