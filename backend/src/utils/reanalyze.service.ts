import prisma from '../config/database';
import { DictionaryAnalyzerStage } from '../pipeline/stages/dictionary-analyzer';
import { createLogger } from './logger';

const log = createLogger('ReanalyzeService');

/**
 * Re-analisis semua listing di database dengan rule dictionary terupdate.
 * Ini berguna ketika ada perubahan pola deteksi negasi agar data lama langsung terupdate.
 */
export async function reanalyzeAllListings(): Promise<void> {
  try {
    log.info('Memulai re-analisis seluruh data listing di database...');
    
    // Load terms dari database
    const terms = await prisma.dictionaryTerm.findMany({
      select: {
        term: true,
        meaning: true,
        category: true,
      },
    });
    
    log.info(`Loaded ${terms.length} istilah kamus.`);
    
    // Instansiasi analyzer
    const analyzer = new DictionaryAnalyzerStage(terms);
    
    // Load all listings
    const listings = await prisma.listing.findMany({
      select: {
        id: true,
        title: true,
        description: true,
        normalizedTitle: true,
        normalizedDescription: true,
      },
    });
    
    log.info(`Ditemukan ${listings.length} listing di database untuk dire-analisis.`);
    
    let updatedCount = 0;
    for (const listing of listings) {
      const mockNormalized = {
        normalizedTitle: listing.normalizedTitle || '',
        normalizedDescription: listing.normalizedDescription || '',
      } as any;
      
      const result = await analyzer.process(mockNormalized);
      
      // Update data di database
      await prisma.listing.update({
        where: { id: listing.id },
        data: {
          isBarter: result.isBarter,
          isTradeIn: result.isTradeIn,
          isNett: result.isNett,
          detectedKeywords: result.detectedKeywords as any,
        },
      });
      updatedCount++;
    }
    
    log.info(`Re-analisis selesai. Berhasil memperbarui ${updatedCount}/${listings.length} listing.`);
  } catch (error) {
    log.error('Gagal menjalankan re-analisis listing', error);
  }
}
