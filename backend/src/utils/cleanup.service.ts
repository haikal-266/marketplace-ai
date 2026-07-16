import prisma from '../config/database';
import { createLogger } from './logger';

const log = createLogger('CleanupService');

/**
 * Menghapus data listing yang sudah berumur di atas 24 jam.
 */
export async function cleanupOldListings(): Promise<number> {
  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 jam yang lalu
  
  try {
    log.info(`Memulai pembersihan data listing sebelum: ${threshold.toISOString()}`);
    
    const result = await prisma.listing.deleteMany({
      where: {
        scrapedAt: {
          lt: threshold,
        },
      },
    });
    
    log.info(`Pembersihan selesai. Berhasil menghapus ${result.count} listing lama.`);
    return result.count;
  } catch (error) {
    log.error('Gagal menjalankan pembersihan data listing', error);
    throw error;
  }
}

/**
 * Menjalankan pembersihan otomatis secara terjadwal (setiap 1 jam).
 */
export function startCleanupScheduler(intervalMs: number = 60 * 60 * 1000): NodeJS.Timeout {
  log.info('Scheduler pembersihan otomatis listing diaktifkan.');
  
  // Jalankan pembersihan pertama kali saat server menyala
  cleanupOldListings().catch((err) => {
    log.error('Pembersihan pertama saat startup gagal', err);
  });
  
  // Set interval pembersihan selanjutnya
  const timer = setInterval(async () => {
    try {
      await cleanupOldListings();
    } catch (err) {
      // Error logging sudah ditangani di dalam cleanupOldListings
    }
  }, intervalMs);
  
  return timer;
}
