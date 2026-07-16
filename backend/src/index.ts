import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { config, validateConfig } from './config';
import { errorHandler } from './utils/errors';
import { createLogger } from './utils/logger';

// ─── Route Controllers ────────────────────────────────────────────────────────
import authRouter from './modules/auth/auth.controller';
import scraperRouter from './modules/scraper/scraper.controller';
import searchRouter from './modules/search/search.controller';
import listingRouter from './modules/listing/listing.controller';
import dictionaryRouter from './modules/dictionary/dictionary.controller';

const log = createLogger('Server');

// Validasi config wajib sebelum start
validateConfig();

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet()); // Security headers
app.use(cors({
  origin: config.frontendUrl,
  credentials: false, // Tidak pakai cookies di transport — lebih aman
}));
app.use(morgan(config.isDev ? 'dev' : 'combined')); // HTTP request logging
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/scrape', scraperRouter);
app.use('/api/search', searchRouter);
app.use('/api/listings', listingRouter);
app.use('/api/dictionary', dictionaryRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' } });
});

// Error handler (HARUS di akhir)
app.use(errorHandler);

import { startCleanupScheduler } from './utils/cleanup.service';

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  log.info(`Server berjalan di http://localhost:${config.port}`);
  log.info(`Environment: ${config.nodeEnv}`);
  log.info(`Frontend URL: ${config.frontendUrl}`);
  
  // Jalankan scheduler pembersihan listing lama (> 24 jam)
  startCleanupScheduler();
});

export default app;
