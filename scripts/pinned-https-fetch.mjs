import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export async function pinnedHttpsFetch(value, {
  headers = {},
  maxBytes = 20 * 1024 * 1024,
  signal = AbortSignal.timeout(10_000),
  validateAddress,
  validateUrl,
} = {}) {
  const url = value instanceof URL ? value : new URL(value);
  const urlFailure = validateUrl?.(url);
  if (urlFailure) throw new Error(urlFailure);

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => validateAddress?.(entry.address))) {
    throw new Error(`host public IP'ye çözülmeli: ${url.hostname}`);
  }
  const pinnedAddress = addresses[0];
  const pinnedLookup = createPinnedLookup(pinnedAddress);

  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers,
      lookup: pinnedLookup,
      signal,
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new Error(`redirect reddedildi: HTTP ${status}`));
        return;
      }

      const chunks = [];
      let byteSize = 0;
      response.on("data", (chunk) => {
        byteSize += chunk.byteLength;
        if (byteSize > maxBytes) {
          req.destroy(new Error("uzak yanıt 20 MiB sınırını aşıyor"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        const responseHeaders = new Headers();
        for (const [name, headerValue] of Object.entries(response.headers)) {
          if (Array.isArray(headerValue)) {
            for (const item of headerValue) responseHeaders.append(name, item);
          } else if (headerValue !== undefined) {
            responseHeaders.set(name, headerValue);
          }
        }
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: responseHeaders,
          body: { cancel: async () => {} },
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
          json: async () => JSON.parse(body.toString("utf8")),
          text: async () => body.toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export function createPinnedLookup(pinnedAddress) {
  return function lookupPinnedAddress(_hostname, options, callback) {
    if (options?.all) {
      callback(null, [pinnedAddress]);
      return;
    }
    callback(null, pinnedAddress.address, pinnedAddress.family);
  };
}
