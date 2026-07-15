import { PipelineStage, ProcessedListing } from '../pipeline.types';
import { PriceDetectedListing } from './price-detector';
import { createLogger } from '../../utils/logger';

const log = createLogger('MetadataExtractorStage');

/**
 * Stage 4: Metadata Extractor
 *
 * Tugas:
 * - Gabungkan semua hasil stage sebelumnya menjadi ProcessedListing final
 * - Hitung confidence_score berdasarkan kelengkapan data
 * - Bentuk object final yang siap dimasukkan ke database
 *
 * Input: PriceDetectedListing
 * Output: ProcessedListing
 */
export class MetadataExtractorStage
  implements PipelineStage<PriceDetectedListing, ProcessedListing> {
  name = 'MetadataExtractor';

  async process(input: PriceDetectedListing): Promise<ProcessedListing> {
    const confidence = this.calculateConfidence(input);

    log.debug('Metadata extraction selesai', {
      url: input.url,
      confidence,
      hasActualPrice: input.actualPriceAmount !== null,
    });

    return {
      // ─── Data Asli ─────────────────────────────────────────────────────
      title: input.title,
      description: input.description,
      listedPrice: input.listedPriceStr,
      location: input.location,
      seller: input.seller,
      sellerUrl: '',          // scraper tidak mengisi seller_url saat ini
      condition: input.condition,
      delivery: input.delivery,
      url: input.url,
      imageUrl: input.image_url,
      postedAt: input.posted,
      scrapedAt: input.scraped_at,

      // ─── Hasil Analisis ───────────────────────────────────────────────
      actualPriceAmount: input.actualPriceAmount,
      actualPriceRaw: input.actualPriceRaw,
      actualPriceSource: input.actualPriceSource,
      isPriceFake: input.isPriceFake,
      isBarter: input.isBarter,
      isTradeIn: input.isTradeIn,
      isNett: input.isNett,
      detectedKeywords: input.detectedKeywords,
      confidenceScore: confidence,

      // ─── Search Fields ────────────────────────────────────────────────
      normalizedTitle: input.normalizedTitle,
      normalizedDescription: input.normalizedDescription,
    };
  }

  /**
   * Hitung confidence score berdasarkan kelengkapan dan kualitas data.
   *
   * Faktor:
   * - Title ada dan tidak terlalu pendek
   * - Description ada
   * - Actual price berhasil dideteksi
   * - Seller info ada
   * - Location ada
   * - Harga tidak palsu
   *
   * Score 1.0 = semua data lengkap dan akurat.
   */
  private calculateConfidence(input: PriceDetectedListing): number {
    let score = 0;

    // Title ada dan informatif (lebih dari 5 karakter)
    if (input.title && input.title.length > 5) score += 0.25;
    else if (input.title) score += 0.10;

    // Description ada
    if (input.description && input.description.length > 10) score += 0.20;

    // Actual price berhasil dideteksi
    if (input.actualPriceAmount !== null) {
      score += 0.20;
      // Bonus jika sumber dari teks (lebih akurat daripada listed)
      if (input.actualPriceSource !== 'listed') score += 0.05;
    }

    // Location ada
    if (input.location) score += 0.10;

    // Seller info ada
    if (input.seller) score += 0.10;

    // Harga tidak palsu
    if (!input.isPriceFake) score += 0.10;

    return Math.min(Math.round(score * 100) / 100, 1.0);
  }
}
