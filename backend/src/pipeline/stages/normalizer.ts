import { RawListing, PipelineStage } from '../pipeline.types';
import { createLogger } from '../../utils/logger';

const log = createLogger('NormalizerStage');

/**
 * Intermediate type setelah normalisasi.
 * Extend RawListing dengan field normalized.
 */
export interface NormalizedListing extends RawListing {
  normalizedTitle: string;
  normalizedDescription: string;
  listedPriceStr: string; // Alias bersih dari price field scraper
}

/**
 * Stage 1: Normalizer
 *
 * Tugas:
 * - Lowercase title dan description untuk konsistensi search
 * - Strip whitespace berlebih
 * - Normalisasi unicode ke NFC
 * - Bersihkan karakter kontrol dan null bytes
 * - Normalize format Rupiah (untuk stage berikutnya)
 *
 * Input: RawListing dari scraper
 * Output: NormalizedListing
 */
export class NormalizerStage implements PipelineStage<RawListing, NormalizedListing> {
  name = 'Normalizer';

  async process(input: RawListing): Promise<NormalizedListing> {
    log.debug('Normalizing listing', { url: input.url });

    return {
      ...input,
      title: this.cleanText(input.title),
      description: this.cleanText(input.description),
      listedPriceStr: this.cleanText(input.price),
      normalizedTitle: this.normalizeForSearch(input.title),
      normalizedDescription: this.normalizeForSearch(input.description),
    };
  }

  /**
   * Bersihkan teks dari karakter noise tanpa mengubah case.
   * Digunakan untuk field yang ditampilkan ke user.
   */
  private cleanText(text: string | null | undefined): string {
    if (!text) return '';

    return text
      // Normalisasi unicode ke NFC (canonical decomposition + composition)
      .normalize('NFC')
      // Hapus null bytes dan karakter kontrol
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Normalize whitespace (multiple spaces, tabs, dll → satu spasi)
      .replace(/[ \t]+/g, ' ')
      // Normalize line breaks
      .replace(/\r\n|\r/g, '\n')
      // Hapus whitespace di awal dan akhir setiap baris
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n')
      .trim();
  }

  /**
   * Normalisasi teks untuk search index.
   * - Lowercase
   * - Hapus tanda baca berlebih
   * - Normalize singkatan umum
   *
   * Output digunakan untuk search index dan trigram matching.
   * Bukan untuk ditampilkan ke user.
   */
  private normalizeForSearch(text: string | null | undefined): string {
    if (!text) return '';

    let result = this.cleanText(text).toLowerCase();

    // Normalize beberapa simbol umum di marketplace ke bentuk yang mudah di-search
    result = result
      // Ganti "/" dengan spasi (contoh: "16/512" → "16 512")
      .replace(/\//g, ' ')
      // Ganti "+" dengan spasi (contoh: "iPhone+case" → "iPhone case")
      .replace(/\+/g, ' ')
      // Hapus tanda baca yang tidak berguna untuk search (kecuali titik dan koma untuk angka)
      .replace(/[()[\]{}<>|\\!?@#%^&*=~`'"]/g, ' ')
      // Multiple spaces → satu spasi
      .replace(/\s+/g, ' ')
      .trim();

    return result;
  }
}
