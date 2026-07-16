import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import readline from 'readline';
import { EventEmitter } from 'events';
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
  minPrice?: number;    // Filter harga minimal
  maxPrice?: number;    // Filter harga maksimal
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
 * 3. Capture JSON output dari stdout per baris (JSON Lines)
 * 4. Emit event 'listing' setiap kali baris valid diparsing
 * 5. Cleanup temp file saat proses selesai / distop
 */
class ScraperService extends EventEmitter {
  private currentJob: ScrapeJob | null = null;
  private childProcess: ChildProcess | null = null;

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
      log.info('Scraping lama sedang berjalan. Menghentikan yang lama...');
      await this.stopScrape();
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
   * Menghentikan scraping secara manual.
   */
  async stopScrape(): Promise<void> {
    if (this.childProcess) {
      log.info('Menghentikan scraper process...');
      this.childProcess.kill('SIGINT');
      this.childProcess = null;
    }
    if (this.currentJob && this.currentJob.status === 'running') {
      this.currentJob.status = 'done';
    }
    this.emit('done');
  }

  /**
   * Jalankan scraping secara async.
   * Menangani temp cookie file lifecycle sepenuhnya.
   */
  private async runScrapeJob(options: ScrapeOptions): Promise<void> {
    let cookieTmpPath: string | null = null;

    try {
      cookieTmpPath = await cookieManager.writeTempFile();
      const args = this.buildArgs(options, cookieTmpPath);
      
      await this.spawnScraper(args);

      await cookieManager.updateFromFile(cookieTmpPath);

      if (this.currentJob && this.currentJob.status === 'running') {
        this.currentJob.status = 'done';
      }
      log.info('Scraping stream selesai / dihentikan');
      this.emit('done');
    } finally {
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

    if (options.minPrice !== undefined && options.minPrice !== null) {
      args.push(`--minPrice=${options.minPrice}`);
    }

    if (options.maxPrice !== undefined && options.maxPrice !== null) {
      args.push(`--maxPrice=${options.maxPrice}`);
    }

    // Path ke cookie temp file
    args.push(`--cookies=${cookieTmpPath}`);

    return args;
  }

  /**
   * Spawn Python process dan baca JSON Lines output dari stdout.
   * Setiap baris JSON valid akan di-emit sebagai event 'listing'.
   */
  private spawnScraper(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const pythonPath = path.resolve(config.pythonPath);
      log.debug('Spawn scraper', { pythonPath, args });

      this.childProcess = spawn(pythonPath, args, {
        cwd: path.dirname(path.resolve(config.scraperScriptPath)),
        env: { ...process.env },
      });

      if (!this.childProcess.stdout || !this.childProcess.stderr) {
        reject(new AppError('Gagal menginisialisasi stream stdout/stderr proses', 500));
        return;
      }

      const rl = readline.createInterface({
        input: this.childProcess.stdout,
        terminal: false,
      });

      rl.on('line', (line) => {
        const str = line.trim();
        if (!str) return;
        try {
          const parsed = JSON.parse(str);
          if (parsed && parsed.status === 'exhausted') {
            this.emit('exhausted');
            return;
          }
          const listing = parsed as RawListing;
          if (this.currentJob) {
            this.currentJob.totalFound = (this.currentJob.totalFound || 0) + 1;
          }
          this.emit('listing', listing);
        } catch (err) {
          log.debug('Output stdout bukan JSON (diabaikan)', { str: str.slice(0, 100) });
        }
      });

      this.childProcess.stderr.on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg) log.debug('[scraper stderr]', { msg });
      });

      this.childProcess.on('error', (err) => {
        log.error('Gagal spawn Python process', err);
        reject(new AppError(`Gagal menjalankan scraper: ${err.message}`, 500));
      });

      this.childProcess.on('close', (code) => {
        this.childProcess = null;
        if (code !== 0 && code !== null) {
          log.error('Scraper exit dengan kode error', { code });
          // Jangan reject jika user men-stop secara manual (SIGINT biasnya exit code null atau > 128)
        }
        resolve();
      });
    });
  }

  /**
   * (Deprecated for stream) Ambil hasil scraping terakhir.
   */
  popResult(): RawListing[] | null {
    return null; // Tidak digunakan lagi dengan arsitektur stream
  }
}

export const scraperService = new ScraperService();
