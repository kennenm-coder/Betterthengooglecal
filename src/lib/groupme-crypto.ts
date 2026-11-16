import crypto from "crypto";

/**
 * Encrypt/decrypt GroupMe access tokens before they touch the database.
 *
 * Why this exists: a GroupMe token has no scopes and no documented expiry or
 * revocation, so it is unlimited, permanent access to someone's whole GroupMe
 * account — every group plus their private DMs. Migration 025 keeps the table
 * out of reach of the Data API; this keeps the value useless even to someone
 * holding a database dump, because the key lives in the environment and never
 * in Postgres.
 *
 * AES-256-GCM, so the ciphertext is authenticated: a tampered row fails to
 * decrypt rather than silently yielding garbage we'd then send to GroupMe.
 *
 * Env:
 *   GROUPME_TOKEN_KEY  32 bytes, as 64 hex chars or base64. Generate with:
 *                        node -e "console.log(crypto.randomBytes(32).toString('hex'))"
 *                      Rotating it invalidates every stored token (users just
 *                      reconnect), so it is safe to rotate but not free.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.GROUPME_TOKEN_KEY;
  if (!raw) {
    throw new Error(
      "GROUPME_TOKEN_KEY is not set — refusing to store or read GroupMe tokens."
    );
  }
  // Accept hex or base64 so whichever way the key was generated works.
  const key = /^[0-9a-fA-F]{64}$/.test(raw.trim())
    ? Buffer.from(raw.trim(), "hex")
    : Buffer.from(raw.trim(), "base64");

  if (key.length !== 32) {
    throw new Error(
      `GROUPME_TOKEN_KEY must decode to 32 bytes, got ${key.length}.`
    );
  }
  return key;
}

/** Returns base64 of iv | authTag | ciphertext. */
export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/** Inverse of encryptToken. Throws if the key is wrong or the row was altered. */
export function decryptToken(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  if (buf.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("Stored GroupMe token is malformed.");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}

/** True when the server is configured to handle tokens at all. */
export function isTokenCryptoConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
