import { PipelineStage, PriceCandidate } from '../pipeline.types';
import { DictionaryAnalyzedListing } from './dictionary-analyzer';
import { createLogger } from '../../utils/logger';

const log = createLogger('PriceDetectorStage');

export interface PriceDetectedListing extends DictionaryAnalyzedListing {
  parsedListedPrice: number | null;
  actualPriceAmount: number | null;
  actualPriceRaw: string;
  actualPriceSource: 'listed' | 'title' | 'description' | 'unknown';
  isPriceFake: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// KONFIGURASI PRICE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nilai harga (dalam Rupiah) yang pasti palsu/placeholder.
 * Seller sering mengisi harga Rp 1, Rp 123, dll agar listing tetap muncul.
 */
const OBVIOUS_FAKE_PRICES = new Set([
  0, 1, 2, 3, 4, 5, 10, 11, 12, 99, 100, 111, 123, 200, 222, 333,
  444, 500, 555, 666, 777, 888, 999, 1000, 1111, 1234, 1999, 2000,
  2222, 3333, 4444, 5555, 6666, 7777, 8888, 9999, 10000, 11111, 12345,
]);

/**
 * Harga yang TERLALU kecil untuk barang apapun di Marketplace Indonesia.
 * Di bawah ini hampir pasti placeholder.
 * Note: ada barang seharga Rp 5.000 (sticker, dll) — threshold konservatif.
 */
const FAKE_PRICE_THRESHOLD_IDR = 4999;

/**
 * Regex patterns untuk mendeteksi harga dalam teks Indonesia.
 * Diurutkan dari paling spesifik ke paling umum untuk mengurangi false positive.
 *
 * Capturing group 1 selalu berisi nilai numeriknya.
 */
const PRICE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  // "Rp 15.000.000" | "Rp15.000.000" | "Rp 15,000,000" | "IDR 15000000"
  {
    pattern: /(?:Rp\.?\s*|IDR\s*)(\d{1,3}(?:[.,]\d{3})+|\d{4,})/gi,
    type: 'rp_prefixed',
  },
  // "15.000.000" atau "1.500.000" — angka besar dengan titik sebagai separator
  // Minimal 2 grup separator untuk menghindari false positive dengan desimal
  {
    pattern: /(?<!\d)(\d{1,3}(?:\.\d{3}){2,})(?!\d)/g,
    type: 'formatted_large',
  },
  // "15jt" | "15 jt" | "15 juta" | "1.5jt" | "1,5 juta" | "1.5juta"
  {
    pattern: /(\d+[.,]?\d*)\s*(?:juta|jutaa?|jt)\b/gi,
    type: 'juta_suffix',
  },
  // "500rb" | "500 rb" | "500ribu" | "500 ribu"
  {
    pattern: /(\d+[.,]?\d*)\s*(?:ribu|rb[uw]?)\b/gi,
    type: 'ribu_suffix',
  },
  // "500k" | "500K" — kadang dipakai untuk ribuan
  {
    pattern: /(\d+[.,]?\d*)\s*[kK]\b/g,
    type: 'k_suffix',
  },
  // "harga 15000000" | "hrg 1500000" | "price 15000000" — keyword + angka panjang
  {
    pattern: /(?:harga|hrga?|price|jual|dijual|sell)\s*(?:Rp\.?\s*)?(\d{6,})/gi,
    type: 'keyword_prefixed',
  },
];

/**
 * Patterns yang mengindikasikan teks BUKAN harga — untuk filter false positive.
 * Test terhadap substring di sekitar angka yang ditemukan.
 */
const NOT_PRICE_PATTERNS: RegExp[] = [
  /^0[89]\d{8,}/,             // Nomor HP: 08xxx, 09xxx
  /^\+?62\d{8,}/,             // Nomor HP: +62xxx
  /\d+\s*m[aA][hH]\b/,        // Kapasitas baterai: 5000mAh
  /\d+\s*[gG][bB]\b/,         // Storage: 256GB
  /\d+\s*[tT][bB]\b/,         // Storage: 2TB
  /\d+\s*[mM][pP]\b/,         // Megapixel: 50MP
  /\d+\s*inch/i,              // Layar: 6.5 inch
  /\d+\s*[wW]att?\b/i,        // Watt: 65W
  /(?:RTX|GTX|RX)\s*\d+/i,    // GPU: RTX 4090
  /[Aa]\d{1,2}$/,             // Chip Apple: A16, A17
  /[Mm]\d{1}$/,               // Chip Apple: M2, M3
  /[Ss]\d{2}$/,               // Samsung: S24, S25
];

// ─────────────────────────────────────────────────────────────────────────────
// STAGE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage 3: Price Detector
 *
 * Tugas:
 * 1. Parse listed_price dari scraper ke angka
 * 2. Deteksi apakah listed_price palsu (placeholder)
 * 3. Ekstrak semua kandidat harga dari title dan description via regex
 * 4. Tentukan actual_price menggunakan heuristik prioritas
 *
 * Input: DictionaryAnalyzedListing
 * Output: PriceDetectedListing
 */
export class PriceDetectorStage
  implements PipelineStage<DictionaryAnalyzedListing, PriceDetectedListing> {
  name = 'PriceDetector';

  async process(input: DictionaryAnalyzedListing): Promise<PriceDetectedListing> {
    const listedPrice = this.parseListedPrice(input.listedPriceStr);
    const isFake = this.isFakePrice(listedPrice);

    // Ekstrak kandidat harga dari teks
    const titleCandidates = this.extractPricesFromText(input.normalizedTitle, 'title');
    const descCandidates = this.extractPricesFromText(input.normalizedDescription, 'description');

    const { amount, raw, source } = this.determineActualPrice(
      listedPrice,
      isFake,
      titleCandidates,
      descCandidates
    );

    log.debug('Price detection selesai', {
      url: input.url,
      listed: input.listedPriceStr,
      listedParsed: listedPrice,
      isFake,
      actual: amount,
      source,
    });

    return {
      ...input,
      parsedListedPrice: listedPrice,
      actualPriceAmount: amount,
      actualPriceRaw: raw,
      actualPriceSource: source,
      isPriceFake: isFake,
    };
  }

  // ─── Step 1: Parse Listed Price ─────────────────────────────────────────

  private parseListedPrice(raw: string): number | null {
    if (!raw) return null;

    // Hapus semua karakter non-digit kecuali titik/koma (misal: US$, $, S$, RM, dll.)
    const cleanedDigitsOnly = raw.replace(/[^\d.,]/g, '');
    const cleaned = cleanedDigitsOnly
      .replace(/\./g, '')               // Hapus titik separator ribuan
      .replace(/,/g, '')                // Hapus koma
      .trim();

    let num = parseInt(cleaned, 10);
    if (isNaN(num)) return null;

    // Auto-scale clickbait prices standard in Indonesian FB Marketplace:
    // - Ribuan (1.000 - 9.999) -> dikalikan 1.000 menjadi Jutaan Rupiah (contoh: 1.500 -> 1.500.000)
    // - Ratusan (100 - 999) -> dikalikan 1.000 menjadi Ratus Ribuan Rupiah (contoh: 350 -> 350.000)
    if (num >= 100 && num <= 9999) {
      num = num * 1000;
    }

    return num;
  }

  // ─── Step 2: Detect Fake Price ──────────────────────────────────────────

  /**
   * Deteksi apakah harga adalah placeholder/palsu.
   * Heuristik:
   * 1. null → tidak ada harga → anggap palsu
   * 2. Di bawah threshold → pasti palsu
   * 3. Dalam daftar nilai yang jelas palsu
   * 4. Pola berulang: 1111, 2222, 3333, dll
   * 5. Pola sequential: 123, 1234, 12345
   */
  private isFakePrice(amount: number | null): boolean {
    if (amount === null) return true;
    if (amount <= FAKE_PRICE_THRESHOLD_IDR) return true;
    if (OBVIOUS_FAKE_PRICES.has(amount)) return true;

    const str = amount.toString();

    // Pola berulang: semua digit sama (1111, 2222, 9999999)
    if (str.length >= 3 && new Set(str.split('')).size === 1) return true;

    // Pola sequential naik: 123, 1234, 12345
    if (str.length >= 3) {
      const isAscending = str
        .split('')
        .every((d, i) => i === 0 || parseInt(d) === parseInt(str[i - 1]) + 1);
      if (isAscending) return true;
    }

    return false;
  }

  // ─── Step 3: Extract Prices from Text ───────────────────────────────────

  /**
   * Temukan semua kandidat harga dalam teks menggunakan regex patterns.
   * Filter false positive dengan NOT_PRICE_PATTERNS.
   */
  private extractPricesFromText(
    text: string,
    source: 'title' | 'description'
  ): PriceCandidate[] {
    if (!text) return [];

    const candidates: PriceCandidate[] = [];
    const seen = new Set<number>(); // Deduplicate berdasarkan amount

    for (const { pattern, type } of PRICE_PATTERNS) {
      // Reset lastIndex karena regex punya state
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const fullMatch = match[0];
        const numStr = match[1];

        // Cek apakah ini false positive
        if (this.isFalsePositive(fullMatch, text, match.index)) continue;

        const amount = this.normalizeAmount(numStr, type);
        if (amount === null) continue;

        // Range harga masuk akal untuk marketplace: Rp 5.000 - Rp 10 Miliar
        if (amount < 5_000 || amount > 10_000_000_000) continue;

        // Deduplicate
        if (seen.has(amount)) continue;
        seen.add(amount);

        candidates.push({
          raw: fullMatch.trim(),
          amount,
          source,
          confidence: this.calculateConfidence(fullMatch, type, amount, source),
        });
      }
    }

    // Sort dari confidence tertinggi
    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Cek apakah match adalah false positive.
   * Lihat konteks kiri dan kanan dari match untuk clue.
   */
  private isFalsePositive(match: string, fullText: string, index: number): boolean {
    // Cek match sendiri terhadap not-price patterns
    if (NOT_PRICE_PATTERNS.some((p) => p.test(match))) return true;

    // Cek konteks kanan (10 karakter setelah match)
    const contextRight = fullText.slice(index + match.length, index + match.length + 10);

    // Jika diikuti satuan teknis → bukan harga
    if (/^\s*(?:mah|gb|tb|mp|inch|watt|w\b|hz|px)/i.test(contextRight)) return true;

    return false;
  }

  /**
   * Normalisasi nilai numerik dari match ke integer Rupiah.
   * Handle suffix juta/ribu/k dan format berbeda.
   */
  private normalizeAmount(numStr: string, type: string): number | null {
    if (!numStr) return null;

    // Normalize decimal separator: "1,5" atau "1.5" → 1.5
    const normalized = numStr.replace(',', '.');

    switch (type) {
      case 'juta_suffix': {
        // 15 → 15.000.000, 1.5 → 1.500.000
        const n = parseFloat(normalized);
        return isNaN(n) ? null : Math.round(n * 1_000_000);
      }
      case 'ribu_suffix': {
        // 500 → 500.000
        const n = parseFloat(normalized);
        return isNaN(n) ? null : Math.round(n * 1_000);
      }
      case 'k_suffix': {
        // 500k → 500.000
        const n = parseFloat(normalized);
        return isNaN(n) ? null : Math.round(n * 1_000);
      }
      default: {
        // Hapus semua non-digit (titik dan koma sudah di-handle)
        const cleaned = numStr.replace(/[.,]/g, '');
        const n = parseInt(cleaned, 10);
        return isNaN(n) ? null : n;
      }
    }
  }

  /**
   * Hitung confidence score kandidat harga (0.0 - 1.0).
   * Semakin tinggi → semakin yakin ini adalah harga yang benar.
   */
  private calculateConfidence(
    raw: string,
    type: string,
    amount: number,
    source: 'title' | 'description'
  ): number {
    let conf = 0.4; // Base confidence

    // Bonus: ada prefix "Rp" atau "IDR" → sangat confident ini harga
    if (/^(?:Rp\.?\s*|IDR\s*)/i.test(raw)) conf += 0.25;

    // Bonus: format standar dengan separator ribuan → lebih reliable
    if (/\d{1,3}\.\d{3}/.test(raw)) conf += 0.10;

    // Bonus: suffix juta/ribu jelas menyatakan ini harga
    if (type === 'juta_suffix' || type === 'ribu_suffix') conf += 0.10;

    // Bonus: keyword "harga/jual" di sekitar angka
    if (type === 'keyword_prefixed') conf += 0.15;

    // Bonus kecil: dari title sedikit lebih reliable daripada description
    if (source === 'title') conf += 0.05;

    // Bonus: range harga paling umum untuk barang elektronik bekas (100rb - 50jt)
    if (amount >= 100_000 && amount <= 50_000_000) conf += 0.05;

    return Math.min(conf, 1.0);
  }

  // ─── Step 4: Determine Actual Price ─────────────────────────────────────

  /**
   * Tentukan actual_price menggunakan heuristik prioritas:
   *
   * CASE 1: Listed price valid (tidak palsu) DAN tidak ada harga teks yang jauh lebih besar
   *   → gunakan listed price (paling reliable)
   *
   * CASE 2: Listed price valid TAPI ada harga teks yang >> listed price
   *   → listed price mungkin palsu (misal Rp 500 tapi di desc "15 juta")
   *   → gunakan harga teks
   *
   * CASE 3: Listed price palsu/tidak ada
   *   → cari di title dulu (biasanya lebih padat), lalu description
   *
   * CASE 4: Tidak ada harga di manapun
   *   → kembalikan null
   */
  private determineActualPrice(
    listedPrice: number | null,
    isFake: boolean,
    titleCandidates: PriceCandidate[],
    descCandidates: PriceCandidate[]
  ): { amount: number | null; raw: string; source: 'listed' | 'title' | 'description' | 'unknown' } {
    const bestTitle = titleCandidates[0] ?? null;
    const bestDesc = descCandidates[0] ?? null;
    const bestText = this.pickBestCandidate(bestTitle, bestDesc);

    // CASE 1 & 2: Listed price ada dan valid
    if (!isFake && listedPrice !== null) {
      if (bestText && bestText.amount > listedPrice * 5) {
        // Harga di teks jauh lebih besar → listed price kemungkinan palsu atau salah
        log.debug('Listed price jauh lebih kecil dari teks — pakai harga teks', {
          listed: listedPrice,
          text: bestText.amount,
        });
        return { amount: bestText.amount, raw: bestText.raw, source: bestText.source };
      }
      return {
        amount: listedPrice,
        raw: `Rp ${listedPrice.toLocaleString('id-ID')}`,
        source: 'listed',
      };
    }

    // CASE 3: Listed palsu/tidak ada — cari di teks
    if (bestText) {
      return { amount: bestText.amount, raw: bestText.raw, source: bestText.source };
    }

    // CASE 4: Tidak ada harga sama sekali
    // Kembalikan listed price (walaupun mungkin palsu) daripada null kosong
    return {
      amount: listedPrice,
      raw: listedPrice ? `Rp ${listedPrice.toLocaleString('id-ID')}` : '',
      source: 'unknown',
    };
  }

  /**
   * Pilih kandidat harga terbaik dari title vs description.
   * Prioritas: confidence tertinggi. Tie-break: title menang.
   */
  private pickBestCandidate(
    titleBest: PriceCandidate | null,
    descBest: PriceCandidate | null
  ): PriceCandidate | null {
    if (!titleBest && !descBest) return null;
    if (!titleBest) return descBest;
    if (!descBest) return titleBest;
    return titleBest.confidence >= descBest.confidence ? titleBest : descBest;
  }
}
