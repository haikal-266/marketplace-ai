import dotenv from 'dotenv';
import path from 'path';

// Load .env dari root backend
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const projectRoot = path.resolve(__dirname, '../../..');

const resolvePath = (p: string) => {
  if (path.isAbsolute(p)) return p;
  const cleanPath = p.replace(/^(\.\/|\.\.\/)?scraper/, 'scraper');
  return path.resolve(projectRoot, cleanPath);
};

// ─── Scraper Paths ────────────────────────────────────────────────────────
const rawPythonPath = process.env.PYTHON_PATH || './scraper/venv/bin/python';
const rawScraperScriptPath = process.env.SCRAPER_SCRIPT_PATH || './scraper/scraper.py';

/**
 * Konfigurasi aplikasi terpusat.
 * Semua env variable diakses dari sini — tidak ada process.env tersebar di seluruh codebase.
 */
export const config = {
  // ─── Server ──────────────────────────────────────────────────────────────
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',

  // ─── Database ─────────────────────────────────────────────────────────────
  databaseUrl: process.env.DATABASE_URL || '',

  // ─── Security ─────────────────────────────────────────────────────────────
  /**
   * Key untuk enkripsi AES-256-GCM cookies Facebook.
   * WAJIB diset di .env — jangan pernah hardcode.
   */
  cookieEncryptionKey: process.env.COOKIE_ENCRYPTION_KEY || '',

  // ─── Scraper ──────────────────────────────────────────────────────────────
  pythonPath: resolvePath(rawPythonPath),
  scraperScriptPath: resolvePath(rawScraperScriptPath),

  // ─── CORS ─────────────────────────────────────────────────────────────────
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
} as const;

/**
 * Validasi config kritis saat startup.
 * Aplikasi akan crash dengan pesan jelas jika config tidak lengkap.
 */
export function validateConfig(): void {
  const required: Array<[string, string]> = [
    ['DATABASE_URL', config.databaseUrl],
    ['COOKIE_ENCRYPTION_KEY', config.cookieEncryptionKey],
  ];

  const missing = required
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Copy .env.example ke .env dan isi nilainya.'
    );
  }

  if (config.cookieEncryptionKey.length < 32) {
    throw new Error('COOKIE_ENCRYPTION_KEY harus minimal 32 karakter.');
  }
}
