import { Router } from 'express';
import { z } from 'zod';
import { scraperService } from './scraper.service';
import { asyncHandler, ValidationError } from '../../utils/errors';
import { buildPipeline } from '../../pipeline/pipeline.factory';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('ScraperController');

const ScrapeBodySchema = z.object({
  query: z.string().min(1, 'Query tidak boleh kosong').max(100),
  city: z.string().optional().default(''),
  count: z.number().int().min(1).max(100).optional().default(30),
  headless: z.boolean().optional().default(true),
  details: z.boolean().optional().default(true),
  minPrice: z.number().int().min(0).optional(),
  maxPrice: z.number().int().min(0).optional(),
  allowedLocations: z.array(z.string()).optional(),
});

/**
 * POST /api/scrape
 * Trigger scraping Facebook Marketplace.
 * Non-blocking — return segera, polling /status untuk progress.
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = ScrapeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
    }

    await scraperService.startScrape(parsed.data);

    res.json({
      success: true,
      message: 'Scraping dimulai. Poll /api/scrape/status untuk progress.',
      job: {
        status: scraperService.getStatus()?.status,
        startedAt: scraperService.getStatus()?.startedAt,
      },
    });
  })
);

/**
 * POST /api/scrape/stop
 * Menghentikan proses scraping yang sedang berjalan.
 */
router.post(
  '/stop',
  asyncHandler(async (_req, res) => {
    await scraperService.stopScrape();
    res.json({ success: true, message: 'Scraping dihentikan' });
  })
);

/**
 * GET /api/scrape/stream
 * Endpoint SSE untuk menerima data scraping secara real-time.
 */
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const sendEvent = (event: string, data: any) => {
    if (res.writableEnded) return; // Jangan kirim jika koneksi sudah ditutup
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('status', { status: 'connected' });

  // Counter untuk tracking listing yang masih diproses pipeline
  let pendingCount = 0;
  let scraperDone = false;

  // Fungsi untuk menutup koneksi hanya setelah semua listing selesai diproses
  const tryFinalize = () => {
    if (scraperDone && pendingCount === 0) {
      log.info('Semua listing selesai diproses pipeline, menutup SSE stream.');
      sendEvent('status', { status: 'done' });
      res.end();
    }
  };

  // Handle incoming listings from Python scraper
  const onListing = async (rawListing: any) => {
    pendingCount++;
    try {
      // Build pipeline on the fly (optimally, we'd cache it, but this is fine for now)
      const pipeline = await buildPipeline();
      const processed = await pipeline.run(rawListing);
      
      // Kirim hasil processed (yang udah di-upsert ke DB) ke UI
      sendEvent('listing', processed);
    } catch (err) {
      log.error('Pipeline gagal untuk 1 listing', err);
    } finally {
      pendingCount--;
      // Cek apakah ini listing terakhir dan scraper sudah selesai
      tryFinalize();
    }
  };

  const onDone = () => {
    // Scraper Python selesai, tapi mungkin masih ada listing yang diproses pipeline
    scraperDone = true;
    log.info(`Scraper Python selesai. Masih ada ${pendingCount} listing dalam antrian pipeline.`);
    tryFinalize(); // Langsung finalize jika tidak ada yang pending
  };

  const onExhausted = () => {
    sendEvent('status', { status: 'exhausted' });
    // Jangan tutup koneksi — scraperDone akan di-set saat event 'done' tiba dari scraper
  };

  const onFacebookBlocked = () => {
    sendEvent('status', { status: 'facebook_blocked' });
  };

  scraperService.on('listing', onListing);
  scraperService.on('done', onDone);
  scraperService.on('exhausted', onExhausted);
  scraperService.on('facebook_blocked', onFacebookBlocked);

  // Client disconnects
  req.on('close', () => {
    scraperService.off('listing', onListing);
    scraperService.off('done', onDone);
    scraperService.off('exhausted', onExhausted);
    scraperService.off('facebook_blocked', onFacebookBlocked);
    log.info('Client terputus dari stream SSE');
  });
});

export default router;
