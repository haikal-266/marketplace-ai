import { PipelineStage, DictionaryMatch } from '../pipeline.types';
import { NormalizedListing } from './normalizer';
import { createLogger } from '../../utils/logger';

const log = createLogger('DictionaryAnalyzerStage');

/** Shape istilah dari database atau seed file */
export interface DictionaryTermInput {
  term: string;
  meaning: string;
  category: string;
}

/** Output stage ini — extend NormalizedListing dengan hasil analisis dictionary */
export interface DictionaryAnalyzedListing extends NormalizedListing {
  detectedKeywords: DictionaryMatch[];
  isBarter: boolean;
  isTradeIn: boolean;
  isNett: boolean;
}

/**
 * Stage 2: Dictionary Analyzer
 *
 * Tugas:
 * - Scan title dan description untuk istilah marketplace Indonesia
 * - Deteksi flag: is_barter (BT), is_trade_in (TT), is_nett (Nett/Net/Pas/Slag)
 * - Kumpulkan semua match untuk metadata detected_keywords
 *
 * Menerima terms dari database — bisa diupdate runtime tanpa restart.
 *
 * Input: NormalizedListing
 * Output: DictionaryAnalyzedListing
 */
export class DictionaryAnalyzerStage
  implements PipelineStage<NormalizedListing, DictionaryAnalyzedListing> {
  name = 'DictionaryAnalyzer';

  constructor(private terms: DictionaryTermInput[]) {}

  /** Update terms tanpa restart (dipanggil setelah user menambah term baru) */
  updateTerms(terms: DictionaryTermInput[]): void {
    this.terms = terms;
    log.info('Dictionary terms diperbarui', { count: terms.length });
  }

  async process(input: NormalizedListing): Promise<DictionaryAnalyzedListing> {
    const fullText = `${input.normalizedTitle} ${input.normalizedDescription}`;
    const matches = this.findMatches(fullText);

    // ── Hardcoded keyword detection dengan negasi-awareness ─────────────────
    // Pola negasi yang didukung:
    //   - Prefix negasi : no, not, tidak, ga, gak, ngga, nggak, bukan, tanpa, without
    //   - Suffix penolakan: up (tolak), skip (lewati)
    //
    // Contoh yang TIDAK akan ter-flag:
    //   "no bt", "no tt", "tidak tt", "ga nego", "bukan barter",
    //   "nego up", "tt up", "bt skip", "nego skip", "tt skip"
    //
    // Contoh yang TETAP ter-flag:
    //   "bisa tt", "mau nego", "bt ok", "barter boleh"

    // Catatan: 'tukar' di-split dari 'tukar tambah' (yang masuk isTradeIn)
    // hasTermWithoutNegation akan cek word boundary, jadi 'tukar' tidak match 'tukar tambah'
    const isBarterHardcoded = this.hasTermWithoutNegation(fullText, [
      'bt', 'barter', 'tuker',
    ]) || this.hasTukarBarter(fullText);
    const isTradeInHardcoded = this.hasTermWithoutNegation(fullText, [
      'tt', 'tukar tambah', 'trade in', 'trade-in',
    ]);
    const isNettHardcoded = this.hasTermWithoutNegation(fullText, [
      'nett', 'net', 'harga pas', 'harga fix', 'fix price',
    ]);
    // "pas" saja terlalu pendek dan bisa jadi kata lain, tangani terpisah
    const isPasNett = /(?:^|[\s/,.-])(pas)(?:[\s/,.-]|$)/i.test(fullText)
      && !this.isNegated(fullText, 'pas');

    return {
      ...input,
      detectedKeywords: matches,
      isBarter: isBarterHardcoded || this.hasCategory(matches, 'trade', ['BT', 'BARTER']),
      isTradeIn: isTradeInHardcoded || this.hasCategory(matches, 'trade', ['TT']),
      isNett: isNettHardcoded || isPasNett || this.hasCategory(matches, 'pricing', ['NETT', 'NET', 'PAS', 'SLAG']),
    };
  }

  /**
   * Cek apakah salah satu term ada dalam teks TANPA didahului/diikuti negasi.
   *
   * Kata negasi prefix: no, not, tidak, ga, gak, ngga, nggak, gak, nggak,
   *                     bukan, tanpa, without, ga ada, kagak
   * Kata penolakan suffix: up (ditolak), skip (dilewati)
   *
   * Contoh match yang DITOLAK:
   *   "no bt", "no tt / no bt", "tidak tt", "ga nego", "bukan barter",
   *   "nego up", "tt up", "bt skip", "nego skip"
   */
  private hasTermWithoutNegation(text: string, keywords: string[]): boolean {
    for (const kw of keywords) {
      const escaped = this.escapeRegex(kw);

      // Word boundary: karakter sebelum/sesudah keyword harus BUKAN huruf atau ANGKA
      // Ini mencegah match pada kode produk seperti "ath-anc700bt" or "bt600"
      // [^a-zA-Z0-9] = bukan huruf dan bukan digit
      const pattern = new RegExp(
        `(?:^|[^a-zA-Z0-9])` +
        `(no|not|tidak|ga|gak|ngga|nggak|kagak|bukan|tanpa|without)?` +
        `[\\s]*(?:terima|melayani|bisa|untuk)?[\\s]*` +
        `(?:(?:bt|tt|barter|tuker|tukar tambah|trade in|trade-in)[\\s]*[\\/\\&,.-]+[\\s]*)?` +
        `(${escaped})` +
        `(?:[\\s]*(up|skip|ditolak|tolak|gak|tidak|no))?` +
        `(?:[^a-zA-Z0-9]|$)`,
        'gi'
      );

      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const prefixNeg = match[1]; // kata negasi sebelum keyword
        const suffixRej = match[3]; // kata penolakan setelah keyword

        // Jika ada negasi/penolakan → skip match ini
        if (prefixNeg || suffixRej) continue;

        // Match valid tanpa negasi ditemukan
        return true;
      }
    }
    return false;
  }

  /**
   * Cek apakah sebuah keyword tertentu dalam teks dinegasikan.
   * Digunakan untuk validasi tambahan pada kata pendek seperti "pas".
   */
  private isNegated(text: string, keyword: string): boolean {
    const escaped = this.escapeRegex(keyword);
    const pattern = new RegExp(
      `(no|not|tidak|ga|gak|ngga|nggak|kagak|bukan|tanpa|without)\\s+(?:terima|melayani|bisa|untuk)?\\s*${escaped}` +
      `|${escaped}\\s+(up|skip|ditolak|tolak)`,
      'gi'
    );
    return pattern.test(text);
  }

  /**
   * Cek kata 'tukar' HANYA jika tidak diikuti kata 'tambah'.
   * Ini mencegah 'tukar tambah' (TT) salah terhitung sebagai BT.
   * Tetap aware negasi.
   */
  private hasTukarBarter(text: string): boolean {
    // Match 'tukar' yang BUKAN diikuti 'tambah'
    // [^a-zA-Z0-9] memastikan 'tukar' tidak embedded dalam kata/kode lain
    const pattern = /(?:^|[^a-zA-Z0-9])(no|not|tidak|ga|gak|ngga|nggak|kagak|bukan|tanpa|without)?[\s]*(?:terima|melayani|bisa|untuk)?[\s]*(tukar)(?![\s]*tambah)(?:[\s]*(up|skip|ditolak|tolak))?(?:[^a-zA-Z0-9]|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const prefixNeg = match[1];
      const suffixRej = match[3];
      if (!prefixNeg && !suffixRej) return true;
    }
    return false;
  }

  /**
   * Word boundary (\b) memastikan "BU" tidak match "BUKAN" atau "BULE".
   */
  private findMatches(text: string): DictionaryMatch[] {
    const matches: DictionaryMatch[] = [];
    const seen = new Set<string>(); // Deduplicate term yang sama

    for (const { term, meaning, category } of this.terms) {
      try {
        const escaped = this.escapeRegex(term);

        // Pattern regex aware negasi (mirip hasTermWithoutNegation)
        // Group 1: prefix negasi
        // Group 2: keyword itu sendiri
        // Group 3: suffix penolakan
        const pattern = new RegExp(
          `(?:^|[^a-zA-Z0-9])` +
          `(no|not|tidak|ga|gak|ngga|nggak|kagak|bukan|tanpa|without)?` +
          `[\\s]*(?:terima|melayani|bisa|untuk)?[\\s]*` +
          `(?:(?:bt|tt|barter|tuker|tukar tambah|trade in|trade-in)[\\s]*[\\/\\&,.-]+[\\s]*)?` +
          `(${escaped})` +
          `(?:[\\s]*(up|skip|ditolak|tolak|gak|tidak|no))?` +
          `(?:[^a-zA-Z0-9]|$)`,
          'gi'
        );

        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
          const prefixNeg = match[1];
          const suffixRej = match[3];

          // Cek jika term-nya sendiri sudah diawali kata negasi (e.g. "No Minus")
          const termStartsWithNegation = /^(no|not|tidak|ga|gak|ngga|nggak|kagak|bukan|tanpa|without)\b/i.test(term.trim());

          // Jika ada negasi prefix atau penolakan suffix, DAN kata itu sendiri BUKAN bermula negasi
          // maka ini adalah negasi (e.g. "NO TT", "NO BT", "NO MINUS" untuk term "Minus") -> SKIP!
          if ((prefixNeg || suffixRej) && !termStartsWithNegation) {
            continue;
          }

          const key = term.toUpperCase();
          if (!seen.has(key)) {
            seen.add(key);
            matches.push({
              term,
              meaning,
              category,
              position: match.index,
            });
          }
        }
      } catch (err) {
        log.warn(`Invalid regex untuk term "${term}"`, err);
      }
    }

    return matches;
  }


  /**
   * Cek apakah ada match dalam kategori tertentu dengan term yang spesifik.
   * Normalisasi ke uppercase untuk komparasi case-insensitive.
   */
  private hasCategory(
    matches: DictionaryMatch[],
    category: string,
    allowedTerms: string[]
  ): boolean {
    return matches.some(
      (m) =>
        m.category === category && allowedTerms.includes(m.term.toUpperCase())
    );
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
