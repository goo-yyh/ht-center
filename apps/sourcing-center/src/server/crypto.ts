import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { env } from "./env";

const scrypt = promisify(scryptCallback);

export type QuotePayload = { totalAmount: string; deliveryDays: number; remark: string };
export type SealedPayload = { ciphertext: Buffer; nonce: Buffer; authTag: Buffer; sha256: string; keyVersion: string };
export type SealedJsonSnapshot = {
  format: "aes-256-gcm+json";
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
};

export function quoteAad(workspaceId: string, rfqId: string, supplierId: string, quoteId: string) {
  return Buffer.from(`${workspaceId}:${rfqId}:${supplierId}:${quoteId}`, "utf8");
}

export function sealQuote(payload: QuotePayload, aad: Buffer): SealedPayload {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", env.quoteKey, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext,
    nonce,
    authTag: cipher.getAuthTag(),
    sha256: createHash("sha256").update(plaintext).digest("hex"),
    keyVersion: env.QUOTE_KEY_VERSION,
  };
}

export function openQuote(sealed: Pick<SealedPayload, "ciphertext" | "nonce" | "authTag">, aad: Buffer): QuotePayload {
  const decipher = createDecipheriv("aes-256-gcm", env.quoteKey, sealed.nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.authTag);
  return JSON.parse(Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8")) as QuotePayload;
}

export function idempotencyAad(workspaceId: string, scope: string, actor: string, key: string, requestHash: string) {
  return Buffer.from(JSON.stringify([workspaceId, scope, actor, key, requestHash]), "utf8");
}

export function sealJsonSnapshot(value: unknown, aad: Buffer): SealedJsonSnapshot {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", env.quoteKey, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    format: "aes-256-gcm+json",
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: env.QUOTE_KEY_VERSION,
  };
}

export function isSealedJsonSnapshot(value: unknown): value is SealedJsonSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<SealedJsonSnapshot>;
  return snapshot.format === "aes-256-gcm+json"
    && typeof snapshot.ciphertext === "string"
    && typeof snapshot.nonce === "string"
    && typeof snapshot.authTag === "string"
    && typeof snapshot.keyVersion === "string";
}

export function openJsonSnapshot<T>(snapshot: SealedJsonSnapshot, aad: Buffer): T {
  const decipher = createDecipheriv("aes-256-gcm", env.quoteKey, Buffer.from(snapshot.nonce, "base64"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(snapshot.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(snapshot.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as T;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [, saltB64, hashB64] = stored.split(":");
  if (!saltB64 || !hashB64) return false;
  const actual = (await scrypt(password, Buffer.from(saltB64, "base64"), 64)) as Buffer;
  const expected = Buffer.from(hashB64, "base64");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function contentHash(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
