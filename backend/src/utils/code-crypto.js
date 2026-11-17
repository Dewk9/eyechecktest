/**
 * Reversible encryption for staff registration codes (admin "show / copy code").
 *
 * - AES-256-GCM, random 12-byte IV, auth tag → tampering is detected.
 * - The code row id is bound as AAD, so a ciphertext copied onto another row will not decrypt.
 * - Key: REGISTRATION_CODE_KEY (dedicated, recommended) or, if it is not set, a key derived
 *   with HKDF from JWT_SECRET (label "eyecheck/staff-code/v1"). The key id is stored in the
 *   value (e = env key, j = JWT-derived), so setting REGISTRATION_CODE_KEY later does not break
 *   codes encrypted before — as long as JWT_SECRET is unchanged.
 * - Login/registration never decrypt: registration still matches the HMAC hash (code_hash).
 *
 * Stored format:  v1.<keyId>.<iv b64url>.<tag b64url>.<ciphertext b64url>
 */
import crypto from 'node:crypto';
import { config } from '../config/env.js';

const keys = new Map();
function keyFor(id) {
  if (keys.has(id)) return keys.get(id);
  let key = null;
  if (id === 'e' && config.registrationCodeKey) {
    key = crypto.createHash('sha256').update(config.registrationCodeKey).digest();
  } else if (id === 'j' && config.jwtSecret) {
    key = Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, 'eyecheck-staff-code-salt', 'eyecheck/staff-code/v1', 32));
  }
  if (key) keys.set(id, key);
  return key;
}
const currentKeyId = () => (config.registrationCodeKey ? 'e' : 'j');

export function encryptRegistrationCode(code, rowId) {
  const id = currentKeyId();
  const key = keyFor(id);
  if (!key) throw new Error('No encryption key for registration codes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`staff-code:${rowId}`));
  const ct = Buffer.concat([cipher.update(String(code), 'utf8'), cipher.final()]);
  return ['v1', id, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/** Returns the plain code, or null when it cannot be decrypted (wrong key / tampered / bad format). */
export function decryptRegistrationCode(value, rowId) {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const key = keyFor(parts[1]);
  if (!key) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64url'));
    decipher.setAAD(Buffer.from(`staff-code:${rowId}`));
    decipher.setAuthTag(Buffer.from(parts[3], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
