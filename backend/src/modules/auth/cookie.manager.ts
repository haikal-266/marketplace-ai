import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import prisma from '../../config/database';
import { encrypt, decrypt } from '../../utils/crypto';
import { createLogger } from '../../utils/logger';
import { AppError } from '../../utils/errors';

const log = createLogger('CookieManager');

const SETTINGS_KEY = 'fb_cookies';

/** Shape cookie dari Playwright / EditThisCookie */
export interface FBCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  expires?: number;
}

/**
 * Cookie Manager — mengelola siklus hidup cookies Facebook secara aman.
 *
 * Prinsip keamanan:
 * - Cookies di-encrypt AES-256-GCM sebelum disimpan di database
 * - Cookies TIDAK pernah dikirim ke frontend
 * - Temp file cookie untuk scraper selalu dihapus setelah selesai
 * - Hanya method internal yang mengakses cookies plaintext
 */
export class CookieManager {
  /**
   * Simpan cookies Facebook ke database dalam bentuk terenkripsi.
   * Dipanggil setelah login berhasil via Playwright.
   */
  async store(cookies: FBCookie[]): Promise<void> {
    const plaintext = JSON.stringify(cookies);
    const encrypted = encrypt(plaintext);

    await prisma.appSetting.upsert({
      where: { key: SETTINGS_KEY },
      update: { value: encrypted, type: 'encrypted' },
      create: { key: SETTINGS_KEY, value: encrypted, type: 'encrypted' },
    });

    log.info('Cookies Facebook berhasil disimpan', { cookieCount: cookies.length });
  }

  /**
   * Ambil cookies dalam bentuk plaintext untuk digunakan oleh scraper.
   * @throws AppError jika cookies belum tersimpan
   */
  async getDecrypted(): Promise<FBCookie[]> {
    const setting = await prisma.appSetting.findUnique({
      where: { key: SETTINGS_KEY },
    });

    if (!setting) {
      throw new AppError('Facebook belum terkoneksi. Login terlebih dahulu.', 401);
    }

    try {
      const plaintext = decrypt(setting.value);
      return JSON.parse(plaintext) as FBCookie[];
    } catch {
      throw new AppError('Cookie data corrupt atau encryption key berubah.', 500);
    }
  }

  /**
   * Tulis cookies ke temporary file untuk digunakan oleh Python scraper.
   * Temp file path dikembalikan — WAJIB dipanggil cleanupTempFile() setelahnya.
   *
   * @returns Path ke temp file (dalam /tmp sistem)
   */
  async writeTempFile(): Promise<string> {
    const cookies = await this.getDecrypted();
    const tmpPath = path.join(os.tmpdir(), `mkai_fb_${Date.now()}_${process.pid}.json`);

    await fs.writeFile(tmpPath, JSON.stringify(cookies), { mode: 0o600 }); // owner-only read/write
    log.debug('Cookie temp file dibuat', { tmpPath });

    return tmpPath;
  }

  /**
   * Hapus temp file cookie setelah scraping selesai.
   * Dipanggil di finally block — tidak throw jika file sudah tidak ada.
   */
  async cleanupTempFile(tmpPath: string): Promise<void> {
    try {
      await fs.unlink(tmpPath);
      log.debug('Cookie temp file dihapus', { tmpPath });
    } catch {
      // Ignore jika file sudah tidak ada (misalnya di-cleanup sebelumnya)
    }
  }

  /**
   * Update cookies setelah scraper selesai (scraper mungkin me-refresh session).
   * Baca kembali dari temp file yang sudah diupdate oleh scraper.
   */
  async updateFromFile(tmpPath: string): Promise<void> {
    try {
      const content = await fs.readFile(tmpPath, 'utf-8');
      const cookies = JSON.parse(content) as FBCookie[];
      await this.store(cookies);
      log.info('Cookies diperbarui dari scraper session');
    } catch {
      log.warn('Gagal memperbarui cookies dari scraper — mungkin file tidak berubah');
    }
  }

  /**
   * Cek apakah Facebook sudah terkoneksi (cookies ada di database).
   * Tidak memvalidasi apakah cookies masih valid di server Facebook.
   */
  async isConnected(): Promise<boolean> {
    const setting = await prisma.appSetting.findUnique({
      where: { key: SETTINGS_KEY },
    });
    return setting !== null;
  }

  /**
   * Cek estimasi apakah session masih aktif berdasarkan expiry cookie xs.
   * Cookie xs adalah session token utama Facebook.
   */
  async isSessionLikelyValid(): Promise<boolean> {
    try {
      const cookies = await this.getDecrypted();
      const xs = cookies.find((c) => c.name === 'xs');

      if (!xs || !xs.expires) return false;

      // Anggap valid jika belum expired (dengan buffer 1 jam)
      const expiresMs = xs.expires * 1000;
      const bufferMs = 60 * 60 * 1000; // 1 jam
      return expiresMs > Date.now() + bufferMs;
    } catch {
      return false;
    }
  }

  /**
   * Hapus semua cookies dari database (disconnect).
   */
  async remove(): Promise<void> {
    await prisma.appSetting.deleteMany({
      where: { key: SETTINGS_KEY },
    });
    log.info('Cookies Facebook dihapus dari database');
  }
}

// Singleton — shared di seluruh app
export const cookieManager = new CookieManager();
