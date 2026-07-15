/**
 * Types untuk pipeline data processing.
 * Setiap stage menerima RawListing dan menghasilkan ProcessedListing.
 */

/** Output mentah dari Python scraper (--api --details mode) */
export interface RawListing {
  title: string;
  price: string;
  location: string;
  url: string;
  image_url: string;
  seller: string;
  posted: string;
  condition: string;
  delivery: string;
  description: string;
  scraped_at: string;
}

/** Satu istilah marketplace yang terdeteksi dalam teks */
export interface DictionaryMatch {
  term: string;
  meaning: string;
  category: string;
  position: number;
}

/** Kandidat harga yang ditemukan dalam title atau description */
export interface PriceCandidate {
  raw: string;           // Teks asli: "15jt", "Rp 15.000.000"
  amount: number;        // Nilai dalam Rupiah: 15000000
  source: 'title' | 'description';
  confidence: number;    // 0.0 - 1.0
}

/** Data listing setelah melalui seluruh pipeline */
export interface ProcessedListing {
  // ─── Data Asli ─────────────────────────────────────────────────────────
  title: string;
  description: string;
  listedPrice: string;
  location: string;
  seller: string;
  sellerUrl: string;
  condition: string;
  delivery: string;
  url: string;
  imageUrl: string;
  postedAt: string;
  scrapedAt: string;

  // ─── Hasil Analisis Pipeline ─────────────────────────────────────────
  actualPriceAmount: number | null;
  actualPriceRaw: string;
  actualPriceSource: 'listed' | 'title' | 'description' | 'unknown';
  isPriceFake: boolean;
  isBarter: boolean;
  isTradeIn: boolean;
  isNett: boolean;
  detectedKeywords: DictionaryMatch[];
  confidenceScore: number;

  // ─── Search Fields ───────────────────────────────────────────────────
  normalizedTitle: string;
  normalizedDescription: string;
}

/** Interface wajib untuk setiap stage pipeline */
export interface PipelineStage<TIn, TOut> {
  name: string;
  process(input: TIn): Promise<TOut>;
}
