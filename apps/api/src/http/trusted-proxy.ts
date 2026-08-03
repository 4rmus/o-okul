import { BlockList, isIP } from "node:net";
import type { Request } from "express";

type IpFamily = "ipv4" | "ipv6";

export function createTrustedProxyPredicate(env: NodeJS.ProcessEnv = process.env): (address: string) => boolean {
  const entries = readTrustedProxyCidrs(env);
  if (env.NODE_ENV === "production" && entries.length === 0) {
    throw new Error("TRUSTED_PROXY_CIDRS_REQUIRED");
  }

  const trusted = new BlockList();
  for (const entry of entries) {
    trusted.addSubnet(entry.address, entry.prefix, entry.family);
  }

  return (address: string) => {
    const family = ipFamily(address);
    return family ? trusted.check(address, family) : false;
  };
}

export function resolveClientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

function readTrustedProxyCidrs(env: NodeJS.ProcessEnv): Array<{ address: string; prefix: number; family: IpFamily }> {
  const values = (env.TRUSTED_PROXY_CIDRS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return values.map((value) => {
    const [address, rawPrefix, extra] = value.split("/");
    const family = address ? ipFamily(address) : undefined;
    const prefix = Number(rawPrefix);
    const maxPrefix = family === "ipv4" ? 32 : 128;
    if (!address || !family || !rawPrefix || extra || !Number.isInteger(prefix) || prefix < 1 || prefix > maxPrefix) {
      throw new Error("TRUSTED_PROXY_CIDRS_INVALID");
    }
    if (prefix !== maxPrefix) {
      throw new Error("TRUSTED_PROXY_CIDRS_MUST_USE_EXACT_IPS");
    }
    return { address, prefix, family };
  });
}

function ipFamily(address: string): IpFamily | undefined {
  const type = isIP(address);
  if (type === 4) return "ipv4";
  if (type === 6) return "ipv6";
  return undefined;
}
