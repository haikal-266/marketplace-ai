import { spawn } from 'child_process';
import path from 'path';
import { config } from '../../config';
import { cookieManager } from '../auth/cookie.manager';
import { RawListing } from '../../pipeline/pipeline.types';
import { createLogger } from '../../utils/logger';
import { AppError } from '../../utils/errors';

const log = createLogger('ScraperService');

export interface ScrapeOptions {
  query: string;
  city?: string;        // City ID Facebook, kosong untuk auto-detect
  count?: number;       // Jumlah listing (default: 30)
  headless?: boolean;   // Headless mode (default: true)
  details?: boolean;    // Ambil detail page (default: true)
}

type ScrapeStatus = 'idle' | 'running' | 'done' | 'failed';

interface ScrapeJob {
  status: ScrapeStatus;
  startedAt: Date;
  options: ScrapeOptions;
  result?: RawListing[];
  error?: string;
  totalFound?: number;
}

/**
 * Scraper Service — bridge antara Node.js backend dan Python scraper.
 *
 * Flow:
 * 1. Decrypt cookies dari database → tulis ke temp file
 * 2. Spawn Python process dengan args dan path cookie
 * 3. Capture JSON output dari stdout
 * 4. Cleanup temp file
 * 5. Return raw listings untuk diproses pipeline
 *
 * Hanya satu scrape job yang bisa berjalan dalam satu waktu.
 */
class ScraperService {
  private currentJob: ScrapeJob | null = null;

  getStatus(): ScrapeJob | null {
    return this.currentJob;
  }

  /**
   * Mulai scraping — non-blocking, hasilnya bisa dipolling via getStatus().
   * @throws AppError jika Facebook belum login atau scraping sudah berjalan
   */
  async startScrape(options: ScrapeOptions): Promise<void> {
    if (!(await cookieManager.isConnected())) {
      throw new AppError('Facebook belum terkoneksi. Login terlebih dahulu.', 401);
    }

    if (this.currentJob?.status === 'running') {
      throw new AppError('Scraping sedang berjalan. Tunggu hingga selesai.', 409);
    }

    this.currentJob = {
      status: 'running',
      startedAt: new Date(),
      options,
    };

    log.info('Memulai scraping', options);

    // Jalankan async tanpa await
    this.runScrapeJob(options).catch((err) => {
      log.error('Scrape job gagal', err);
      if (this.currentJob) {
        this.currentJob.status = 'failed';
        this.currentJob.error = err instanceof Error ? err.message : String(err);
      }
    });
  }

  /**
   * Jalankan scraping secara async.
   * Menangani temp cookie file lifecycle sepenuhnya.
   */
  private async runScrapeJob(options: ScrapeOptions): Promise<void> {
    let cookieTmpPath: string | null = null;

    try {
      // 1. Tulis cookies ke temp file
      cookieTmpPath = await cookieManager.writeTempFile();

      // 2. Build args untuk Python scraper
      const args = this.buildArgs(options, cookieTmpPath);

      // 3. Jalankan scraper
      const rawListings = await this.spawnScraper(args);

      // 4. Update cookies baru yang mungkin di-refresh scraper
      await cookieManager.updateFromFile(cookieTmpPath);

      // 5. Update job result
      if (this.currentJob) {
        this.currentJob.status = 'done';
        this.currentJob.result = rawListings;
        this.currentJob.totalFound = rawListings.length;
      }

      log.info('Scraping selesai', { total: rawListings.length });
    } finally {
      // 6. Selalu cleanup temp file
      if (cookieTmpPath) {
        await cookieManager.cleanupTempFile(cookieTmpPath);
      }
    }
  }

  /**
   * Build command line args untuk Python scraper.
   *
   * Scraper signature: python scraper.py <city> <query> <count> [flags]
   */
  private buildArgs(options: ScrapeOptions, cookieTmpPath: string): string[] {
    const scraperPath = path.resolve(config.scraperScriptPath);
    const args: string[] = [
      scraperPath,
      options.city ?? '',              // city (kosong = auto-detect)
      options.query,                    // query
      String(options.count ?? 30),     // count
      '--api',                          // output JSON ke stdout
    ];

    if (options.headless !== false) {
      args.push('--headless');
    }

    if (options.details !== false) {
      args.push('--details');
    }

    // Path ke cookie temp file
    args.push(`--cookies=${cookieTmpPath}`);

    return args;
  }

  /**
   * Spawn Python process dan capture JSON output dari stdout.
   * stderr di-pipe ke logger (tanpa throw — stderr scraper berisi logs normal).
   */
  private spawnScraper(args: string[]): Promise<RawListing[]> {
    return new Promise((resolve, reject) => {
      const pythonPath = path.resolve(config.pythonPath);
      log.debug('Spawn scraper', { pythonPath, args });

      const child = spawn(pythonPath, args, {
        cwd: path.dirname(path.resolve(config.scraperScriptPath)),
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg) log.debug('[scraper stderr]', { msg });
        stderr += msg;
      });

      child.on('error', (err) => {
        log.error('Gagal spawn Python process', err);
        reject(new AppError(`Gagal menjalankan scraper: ${err.message}`, 500));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          log.error('Scraper exit dengan kode error', { code, stderr: stderr.slice(0, 500) });
          reject(new AppError(`Scraper gagal dengan exit code ${code}`, 500));
          return;
        }

        try {
          // Scraper output JSON array ke stdout
          const listings = JSON.parse(stdout.trim()) as RawListing[];
          resolve(listings);
        } catch {
          log.error('Gagal parse JSON output scraper', { stdout: stdout.slice(0, 200) });
          reject(new AppError('Output scraper bukan JSON yang valid', 500));
        }
      });
    });
  }

  /**
   * Ambil hasil scraping terakhir.
   * Setelah diambil, result di-clear dari memory.
   */
  popResult(): RawListing[] | null {
    if (this.currentJob?.status === 'done' && this.currentJob.result) {
      const result = this.currentJob.result;
      this.currentJob.result = undefined;
      return result;
    }
    return null;
  }
}

export const scraperService = new ScraperService();
