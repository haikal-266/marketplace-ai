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

    return {
      ...input,
      detectedKeywords: matches,
      isBarter: this.hasCategory(matches, 'trade', ['BT', 'BARTER']),
      isTradeIn: this.hasCategory(matches, 'trade', ['TT']),
      isNett: this.hasCategory(matches, 'pricing', ['NETT', 'NET', 'PAS', 'SLAG']),
    };
  }

  /**
   * Cari semua term dalam teks menggunakan word boundary regex.
   * Word boundary (\b) memastikan "BU" tidak match "BUKAN" atau "BULE".
   */
  private findMatches(text: string): DictionaryMatch[] {
    const matches: DictionaryMatch[] = [];
    const seen = new Set<string>(); // Deduplicate term yang sama

    for (const { term, meaning, category } of this.terms) {
      try {
        // Escape special regex chars dalam term (misal: "No Minus" → "No Minus")
        const escaped = this.escapeRegex(term);

        // \b untuk word boundary — tapi handle term multi-kata
        const pattern = new RegExp(`(?:^|\\s|[^a-zA-Z])${escaped}(?:\\s|[^a-zA-Z]|$)`, 'gi');

        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
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
