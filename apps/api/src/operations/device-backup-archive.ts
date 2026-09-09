import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, randomBytes, scrypt, sign, verify, type KeyObject } from "node:crypto";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";

// ponytail: buffered packages stop at 32 MiB; use streaming before supporting larger archives.
export const deviceBackupPayloadLimit = 32 * 1024 * 1024;
export const deviceBackupFileLimit = deviceBackupPayloadLimit + 4096;
const magic = Buffer.from("OOKULB01");
const domain = Buffer.from("O_OKUL_DEVICE_BACKUP_V1\0");
const headerSchema = z.object({ version: z.literal(1), tenantId: z.string().min(1).max(128), backupId: z.string().regex(/^[a-f0-9]{32}$/), createdAt: z.iso.datetime(), keyId: z.string().regex(/^[a-f0-9]{64}$/), publicKey: z.string().min(1).max(128) }).strict();
export type DeviceBackupHeader = z.infer<typeof headerSchema>;
export const deviceBackupPasswordSchema = z.string().min(12).max(128).refine(value => value.trim().length >= 12 && Buffer.byteLength(value, "utf8") <= 256);
let deriving = false;

export function deviceBackupKeyId(key: KeyObject): string {
  const publicKey = key.type === "public" ? key : createPublicKey(key);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("DEVICE_BACKUP_SIGNING_KEY_INVALID");
  return createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
}
export function deviceBackupSigningKeys(env = process.env): { privateKey: KeyObject; publicKeys: Map<string, KeyObject> } {
  try {
    if (!env.TENANT_DEVICE_BACKUP_SIGNING_PRIVATE_KEY) throw new Error();
    const privateKey = createPrivateKey(env.TENANT_DEVICE_BACKUP_SIGNING_PRIVATE_KEY);
    const publicKeys = new Map([[deviceBackupKeyId(privateKey), createPublicKey(privateKey)]]);
    const historical = JSON.parse(env.TENANT_DEVICE_BACKUP_TRUSTED_PUBLIC_KEYS ?? "[]") as unknown;
    if (!Array.isArray(historical) || historical.length > 16 || historical.some(key => typeof key !== "string")) throw new Error();
    for (const pem of historical) { const key = createPublicKey(pem as string); publicKeys.set(deviceBackupKeyId(key), key); }
    return { privateKey, publicKeys };
  } catch { throw new ServiceUnavailableException("DEVICE_BACKUP_SIGNING_UNAVAILABLE"); }
}
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (!deviceBackupPasswordSchema.safeParse(password).success) throw new BadRequestException("DEVICE_BACKUP_PASSWORD_INVALID");
  if (deriving) throw new ServiceUnavailableException("DEVICE_BACKUP_BUSY");
  deriving = true;
  try { return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key))); }
  finally { deriving = false; }
}
export async function sealDeviceBackup(payload: Buffer, tenantId: string, password: string, privateKey: KeyObject): Promise<Buffer> {
  if (!payload.length || payload.length > deviceBackupPayloadLimit) throw new BadRequestException("DEVICE_BACKUP_TOO_LARGE");
  const header = headerSchema.parse({ version: 1, tenantId, backupId: randomBytes(16).toString("hex"), createdAt: new Date().toISOString(), keyId: deviceBackupKeyId(privateKey), publicKey: createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64") });
  const json = Buffer.from(JSON.stringify(header)), length = Buffer.alloc(4); length.writeUInt32BE(json.length);
  const salt = randomBytes(16), iv = randomBytes(12), prefix = Buffer.concat([magic, length, json, salt, iv]);
  const key = await derive(password, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(prefix);
    const signed = Buffer.concat([prefix, cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
    return Buffer.concat([signed, sign(null, Buffer.concat([domain, signed]), privateKey)]);
  } finally { key.fill(0); }
}
export async function openDeviceBackup(file: Buffer, tenantId: string, password: string, trustedKeys: Map<string, KeyObject>): Promise<{ header: DeviceBackupHeader; payload: Buffer }> {
  if (file.length > deviceBackupFileLimit) throw new BadRequestException("DEVICE_BACKUP_TOO_LARGE");
  if (file.length < 121 || !file.subarray(0, 8).equals(magic)) throw new BadRequestException("DEVICE_BACKUP_FORMAT_INVALID");
  const headerLength = file.readUInt32BE(8), prefixLength = 12 + headerLength + 28;
  if (!headerLength || headerLength > 2048 || prefixLength + 80 >= file.length) throw new BadRequestException("DEVICE_BACKUP_FORMAT_INVALID");
  let header: DeviceBackupHeader;
  try { header = headerSchema.parse(JSON.parse(file.subarray(12, 12 + headerLength).toString("utf8"))); }
  catch { throw new BadRequestException("DEVICE_BACKUP_FORMAT_INVALID"); }
  const publicKey = trustedKeys.get(header.keyId);
  if (!publicKey || deviceBackupKeyId(publicKey) !== header.keyId) throw new BadRequestException("DEVICE_BACKUP_UNTRUSTED_SIGNER");
  // Embedded public material helps disaster recovery, but never adds a key to the trusted keyring.
  if (publicKey.export({ type: "spki", format: "der" }).toString("base64") !== header.publicKey) throw new BadRequestException("DEVICE_BACKUP_UNTRUSTED_SIGNER");
  const signed = file.subarray(0, -64);
  if (!verify(null, Buffer.concat([domain, signed]), publicKey, file.subarray(-64))) throw new BadRequestException("DEVICE_BACKUP_SIGNATURE_INVALID");
  if (header.tenantId !== tenantId) throw new BadRequestException("DEVICE_BACKUP_TENANT_MISMATCH");
  if (Date.parse(header.createdAt) > Date.now() + 300_000) throw new BadRequestException("DEVICE_BACKUP_FORMAT_INVALID");
  const key = await derive(password, file.subarray(12 + headerLength, 28 + headerLength));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, file.subarray(28 + headerLength, prefixLength));
    decipher.setAAD(file.subarray(0, prefixLength)); decipher.setAuthTag(file.subarray(-80, -64));
    const payload = Buffer.concat([decipher.update(file.subarray(prefixLength, -80)), decipher.final()]);
    if (payload.length > deviceBackupPayloadLimit) throw new Error();
    return { header, payload };
  } catch { throw new BadRequestException("DEVICE_BACKUP_PASSWORD_OR_CONTENT_INVALID"); }
  finally { key.fill(0); }
}
