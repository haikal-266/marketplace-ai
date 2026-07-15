import { chromium, Browser, BrowserContext } from 'playwright';
import { cookieManager, FBCookie } from './cookie.manager';
import { createLogger } from '../../utils/logger';
import { AppError } from '../../utils/errors';

const log = createLogger('AuthService');

/** State login flow yang sedang berjalan */
type LoginState = 'idle' | 'waiting_user' | 'detecting' | 'success' | 'failed';

/**
 * Auth Service — mengelola login Facebook via Playwright browser.
 *
 * Flow:
 * 1. User trigger dari frontend → backend buka browser visible
 * 2. User login manual di browser
 * 3. Backend polling sampai login terdeteksi (cookie c_user muncul)
 * 4. Cookies di-extract, di-encrypt, disimpan ke database
 * 5. Browser ditutup
 *
 * Browser HANYA dibuka saat proses login.
 * Tidak ada browser yang jalan terus-menerus.
 */
class AuthService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private state: LoginState = 'idle';
  private loginPromise: Promise<void> | null = null;

  /** Dapatkan state login saat ini */
  getState(): LoginState {
    return this.state;
  }

  /**
   * Mulai login flow.
   * Buka browser visible, arahkan ke Facebook login.
   * Polling sampai login berhasil atau timeout.
   *
   * @param timeoutMs - Timeout menunggu user login (default: 5 menit)
   * @returns Promise yang resolve saat login berhasil atau reject saat timeout/gagal
   */
  async startLogin(timeoutMs = 5 * 60 * 1000): Promise<void> {
    if (this.state === 'waiting_user' || this.state === 'detecting') {
      throw new AppError('Login sudah sedang berjalan', 409);
    }

    this.state = 'waiting_user';
    log.info('Memulai Facebook login flow');

    // Jalankan login flow secara async
    this.loginPromise = this.runLoginFlow(timeoutMs);

    // Tidak di-await di sini — return langsung agar frontend bisa polling status
    this.loginPromise.catch((err) => {
      log.error('Login flow gagal', err);
      this.state = 'failed';
    });
  }

  /**
   * Login flow utama yang berjalan di background.
   * Dibuka dengan `--no-headless` (browser terlihat) agar user bisa login.
   */
  private async runLoginFlow(timeoutMs: number): Promise<void> {
    try {
      // Launch browser yang terlihat (headless: false)
      this.browser = await chromium.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--window-size=1024,768',
        ],
      });

      this.context = await this.browser.newContext({
        locale: 'id-ID',
        timezoneId: 'Asia/Jakarta',
        viewport: { width: 1024, height: 768 },
      });

      const page = await this.context.newPage();

      // Navigasi ke Facebook login
      await page.goto('https://www.facebook.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      log.info('Browser dibuka — menunggu user login...');

      // Polling setiap 2 detik sampai cookie c_user muncul (tanda login berhasil)
      const deadline = Date.now() + timeoutMs;
      let loggedIn = false;

      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const cookies = await this.context.cookies();
        const cUser = cookies.find((c) => c.name === 'c_user' && c.value);

        if (cUser) {
          log.info('Login terdeteksi!', { userId: cUser.value });
          loggedIn = true;
          this.state = 'detecting';

          // Tunggu sebentar agar semua cookie ter-set
          await new Promise((resolve) => setTimeout(resolve, 2000));
          break;
        }
      }

      if (!loggedIn) {
        throw new AppError('Timeout — user tidak login dalam waktu yang ditentukan', 408);
      }

      // Ambil semua cookies dan simpan
      const allCookies = await this.context!.cookies();
      const fbCookies = this.convertPlaywrightCookies(allCookies);
      await cookieManager.store(fbCookies);

      this.state = 'success';
      log.info('Login berhasil! Cookies tersimpan.');
    } finally {
      // Selalu tutup browser setelah selesai
      await this.cleanup();
    }
  }

  /**
   * Convert format cookie Playwright ke format FBCookie yang kita simpan.
   */
  private convertPlaywrightCookies(cookies: Awaited<ReturnType<BrowserContext['cookies']>>): FBCookie[] {
    return cookies
      .filter((c) => c.domain.includes('facebook.com'))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expires: c.expires > 0 ? c.expires : undefined,
      }));
  }

  /**
   * Batalkan login yang sedang berjalan dan tutup browser.
   */
  async cancelLogin(): Promise<void> {
    if (this.state === 'idle' || this.state === 'success' || this.state === 'failed') {
      return;
    }

    log.info('Login dibatalkan oleh user');
    await this.cleanup();
    this.state = 'idle';
  }

  /**
   * Reset state ke idle (dipanggil setelah state berhasil/gagal dibaca client).
   */
  resetState(): void {
    if (this.state === 'success' || this.state === 'failed') {
      this.state = 'idle';
    }
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    } catch (err) {
      log.warn('Error saat cleanup browser', err);
    }
  }
}

// Singleton
export const authService = new AuthService();
