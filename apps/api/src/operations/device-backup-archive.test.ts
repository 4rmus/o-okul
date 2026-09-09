import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deviceBackupKeyId, deviceBackupSigningKeys, openDeviceBackup, sealDeviceBackup } from "./device-backup-archive.js";
const keys = generateKeyPairSync("ed25519");
const trusted = new Map([[deviceBackupKeyId(keys.publicKey), keys.publicKey]]);
const password = "a private backup password";
describe("device archive authentication and password recovery", () => {
  it("recovers with only the password and trusted PUBLIC key, without a server decryption secret", async () => {
    const data = Buffer.from('şifreli kurum dosyası');
    const file = await sealDeviceBackup(data, "tenant-a", password, keys.privateKey);
    expect(file.includes(data)).toBe(false);
    expect((await openDeviceBackup(file, "tenant-a", password, trusted)).payload).toEqual(data);
    expect(await sealDeviceBackup(data, "tenant-a", password, keys.privateKey)).not.toEqual(file);
  });
  it("rejects another tenant, unknown signer, corrupted signature/content, wrong password and truncated archive", async () => {
    const file = await sealDeviceBackup(Buffer.from('{"rows":[]}'), "tenant-a", password, keys.privateKey);
    await expect(openDeviceBackup(file, "tenant-b", password, trusted)).rejects.toThrow("DEVICE_BACKUP_TENANT_MISMATCH");
    await expect(openDeviceBackup(file, "tenant-a", password, new Map())).rejects.toThrow("DEVICE_BACKUP_UNTRUSTED_SIGNER");
    for (const offset of [file.length - 1, file.length - 90]) {
      const changed = Buffer.from(file); changed[offset]! ^= 1;
      await expect(openDeviceBackup(changed, "tenant-a", password, trusted)).rejects.toThrow("DEVICE_BACKUP_SIGNATURE_INVALID");
    }
    await expect(openDeviceBackup(file, "tenant-a", "wrong password long enough", trusted)).rejects.toThrow("DEVICE_BACKUP_PASSWORD_OR_CONTENT_INVALID");
    await expect(openDeviceBackup(file.subarray(0, 120), "tenant-a", password, trusted)).rejects.toThrow("DEVICE_BACKUP_FORMAT_INVALID");
  });
  it("rejects weak passwords and fails closed without signing configuration", async () => {
    await expect(sealDeviceBackup(Buffer.from('x'), "tenant-a", "short", keys.privateKey)).rejects.toThrow("DEVICE_BACKUP_PASSWORD_INVALID");
    expect(() => deviceBackupSigningKeys({})).toThrow("DEVICE_BACKUP_SIGNING_UNAVAILABLE");
  });
  it("verifies historical signers after key rotation", async () => {
    const next = generateKeyPairSync("ed25519");
    const config = deviceBackupSigningKeys({ TENANT_DEVICE_BACKUP_SIGNING_PRIVATE_KEY: next.privateKey.export({ format: "pem", type: "pkcs8" }).toString(), TENANT_DEVICE_BACKUP_TRUSTED_PUBLIC_KEYS: JSON.stringify([keys.publicKey.export({ format: "pem", type: "spki" }).toString()]) });
    const file = await sealDeviceBackup(Buffer.from('historical'), "tenant-a", password, keys.privateKey);
    expect((await openDeviceBackup(file, "tenant-a", password, config.publicKeys)).payload.toString()).toBe('historical');
  });
});
