import crypto from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 16; // bytes
const AUTH_TAG_LENGTH = 16; // bytes

/**
 * Derive encryption key dari COOKIE_ENCRYPTION_KEY menggunakan scrypt.
 * scrypt adalah key derivation function yang resistant terhadap brute force.
 * Lazy-initialized agar config sudah tervalidasi sebelum digunakan.
 */
let _encryptionKey: Buffer | null = null;

function getKey(): Buffer {
  if (!_encryptionKey) {
    // scrypt: password, salt, keylen
    // Salt di-hardcode karena ini bukan password hashing — key sudah kuat dari .env
    _encryptionKey = crypto.scryptSync(config.cookieEncryptionKey, 'marketplace-ai-salt-v1', 32);
  }
  return _encryptionKey;
}

/**
 * Enkripsi string menggunakan AES-256-GCM.
 * GCM mode memberikan authenticated encryption — data integrity terjamin.
 *
 * Format output: `iv_hex:authTag_hex:encrypted_hex`
 *
 * @param plaintext - String yang akan dienkripsi
 * @returns String terenkripsi dalam format hex
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext — semua dalam hex
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Dekripsi string yang dienkripsi dengan fungsi `encrypt`.
 * Akan throw error jika data corrupt atau auth tag tidak valid (tamper detection).
 *
 * @param ciphertext - String terenkripsi dalam format `iv:authTag:encrypted`
 * @returns String asli (plaintext)
 * @throws Error jika format invalid atau dekripsi gagal (data corrupt/tampered)
 */
export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Format ciphertext tidak valid — expected iv:authTag:encrypted');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
