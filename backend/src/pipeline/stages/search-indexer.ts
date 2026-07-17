import { PipelineStage, ProcessedListing } from '../pipeline.types';
import { createLogger } from '../../utils/logger';
import prisma from '../../config/database';

const log = createLogger('SearchIndexerStage');

/**
 * Stage 5: Search Indexer (Final Stage)
 *
 * Tugas:
 * - Upsert ProcessedListing ke database (berdasarkan URL yang unik)
 * - PostgreSQL trigger akan otomatis update search_vector (tsvector)
 * - Trigram index (pg_trgm) juga ter-update otomatis
 *
 * Mengembalikan ProcessedListing yang sama (passthrough) agar pipeline
 * bisa di-chain kalau diperlukan.
 *
 * Input: ProcessedListing
 * Output: ProcessedListing (passthrough)
 */
export class SearchIndexerStage
  implements PipelineStage<ProcessedListing, ProcessedListing> {
  name = 'SearchIndexer';

  async process(input: ProcessedListing): Promise<ProcessedListing> {
    const saved = await this.upsertListing(input);
    return {
      ...saved,
      isDetailPending: input.isDetailPending,
    } as any;
  }

  /**
   * Upsert listing ke database.
   * URL adalah unique key — jika listing sudah ada, data di-update.
   * Ini memastikan scraping berulang tidak menghasilkan duplikat.
   */
  private async upsertListing(listing: ProcessedListing): Promise<any> {
    try {
      const saved = await prisma.listing.upsert({
        where: { url: listing.url },
        update: {
          title: listing.title || undefined,
          description: listing.description || undefined,
          listedPrice: listing.listedPrice || undefined,
          location: listing.location || undefined,
          seller: listing.seller || undefined,
          sellerUrl: listing.sellerUrl || undefined,
          condition: listing.condition || undefined,
          delivery: listing.delivery || undefined,
          imageUrl: listing.imageUrl || undefined,
          postedAt: listing.postedAt || undefined,
          scrapedAt: listing.scrapedAt ? new Date(listing.scrapedAt) : new Date(),
          actualPriceAmount: listing.actualPriceAmount,
          actualPriceRaw: listing.actualPriceRaw || undefined,
          actualPriceSource: listing.actualPriceSource,
          isPriceFake: listing.isPriceFake,
          isBarter: listing.isBarter,
          isTradeIn: listing.isTradeIn,
          isNett: listing.isNett,
          detectedKeywords: listing.detectedKeywords as unknown as any,
          confidenceScore: listing.confidenceScore,
          normalizedTitle: listing.normalizedTitle || undefined,
          normalizedDescription: listing.normalizedDescription || undefined,
        },
        create: {
          title: listing.title || undefined,
          description: listing.description || undefined,
          listedPrice: listing.listedPrice || undefined,
          location: listing.location || undefined,
          seller: listing.seller || undefined,
          sellerUrl: listing.sellerUrl || undefined,
          condition: listing.condition || undefined,
          delivery: listing.delivery || undefined,
          url: listing.url,
          imageUrl: listing.imageUrl || undefined,
          postedAt: listing.postedAt || undefined,
          scrapedAt: listing.scrapedAt ? new Date(listing.scrapedAt) : new Date(),
          actualPriceAmount: listing.actualPriceAmount,
          actualPriceRaw: listing.actualPriceRaw || undefined,
          actualPriceSource: listing.actualPriceSource,
          isPriceFake: listing.isPriceFake,
          isBarter: listing.isBarter,
          isTradeIn: listing.isTradeIn,
          isNett: listing.isNett,
          detectedKeywords: listing.detectedKeywords as unknown as any,
          confidenceScore: listing.confidenceScore,
          normalizedTitle: listing.normalizedTitle || undefined,
          normalizedDescription: listing.normalizedDescription || undefined,
        },
      });

      log.debug('Listing berhasil di-upsert', { url: listing.url });
      return saved;
    } catch (err) {
      log.error('Gagal upsert listing', { url: listing.url, err });
      throw err;
    }
  }
}
