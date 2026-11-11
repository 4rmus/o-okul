/** Browser push services supported by our VAPID sender. Endpoints are opaque capabilities; never log them. */
export interface TrustedWebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function parseWebPushSubscription(token: string): TrustedWebPushSubscription | undefined {
  if (token.length > 8192) return undefined;
  try {
    const value: unknown = JSON.parse(token);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const { endpoint, keys } = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    if (typeof endpoint !== "string" || endpoint.length > 2048 || !/^https:\/\//iu.test(endpoint) || /[\s\\]/u.test(endpoint)) return undefined;
    // Reject parser normalization tricks in the authority (escaped hosts, credentials, trailing dot, etc.).
    const authority = endpoint.slice(8).split(/[/?#]/u)[0]!;
    if (!/^[a-z0-9.-]+(?::443)?$/iu.test(authority)) return undefined;
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return undefined;
    const trusted = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname)
      || /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.notify\.windows\.com$/u.test(url.hostname);
    if (!trusted || (url.pathname === "/" && !url.search)) return undefined;
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) return undefined;
    if (![keys.auth, keys.p256dh].every((key) => typeof key === "string" && /^[a-z0-9_-]{1,1024}={0,2}$/iu.test(key))) return undefined;
    // Only delivery fields participate in identity; expirationTime and JSON property ordering do not.
    return { endpoint: url.href, keys: { p256dh: keys.p256dh as string, auth: keys.auth as string } };
  } catch {
    return undefined;
  }
}
