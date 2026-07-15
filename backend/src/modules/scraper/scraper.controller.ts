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
 * GET /api/scrape/status
 * Cek status scraping job yang sedang berjalan.
 * Jika status = done, otomatis jalankan pipeline untuk memproses hasil.
 */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const job = scraperService.getStatus();

    if (!job) {
      return res.json({ success: true, data: { status: 'idle' } });
    }

    // Jika done, ambil result dan proses via pipeline
    if (job.status === 'done') {
      const rawListings = scraperService.popResult();

      if (rawListings && rawListings.length > 0) {
        log.info('Memproses hasil scraping via pipeline', { count: rawListings.length });

        // Proses pipeline async — tidak tunggu selesai
        (async () => {
          try {
            const pipeline = await buildPipeline();
            const processed = await pipeline.runBatch(rawListings);
            log.info('Pipeline selesai', { processed: processed.length });
          } catch (err) {
            log.error('Pipeline gagal', err);
          }
        })();
      }
    }

    res.json({
      success: true,
      data: {
        status: job.status,
        startedAt: job.startedAt,
        options: job.options,
        totalFound: job.totalFound,
        error: job.error,
      },
    });
  })
);

export default router;
