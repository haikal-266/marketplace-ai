import prisma from '../../config/database';
import { createLogger } from '../../utils/logger';

const log = createLogger('SearchService');

export interface SearchOptions {
  query: string;
  location?: string;
  minPrice?: number;
  maxPrice?: number;
  isPriceFakeOnly?: boolean;      // Tampilkan hanya yang harganya palsu
  excludeFakePrice?: boolean;     // Sembunyikan listing dengan harga palsu
  isBarter?: boolean;
  isTradeIn?: boolean;
  isNett?: boolean;
  sortBy?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'confidence';
  page?: number;
  limit?: number;
}

export interface SearchResultItem {
  id: string;
  title: string | null;
  description: string | null;
  listedPrice: string | null;
  actualPriceAmount: number | null;
  actualPriceRaw: string | null;
  actualPriceSource: string | null;
  isPriceFake: boolean;
  isBarter: boolean;
  isTradeIn: boolean;
  isNett: boolean;
  location: string | null;
  seller: string | null;
  condition: string | null;
  url: string;
  imageUrl: string | null;
  postedAt: string | null;
  scrapedAt: Date;
  detectedKeywords: unknown;
  confidenceScore: number;
  // Ranking scores (debug info)
  _rankScore?: number;
  _ftsRank?: number;
  _fuzzyScore?: number;
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
  page: number;
  limit: number;
  query: string;
  synonymsExpanded: string[];
}

/**
 * Search Service — Smart Search dengan 3 layer:
 *
 * Layer 1: Full-Text Search (FTS) via PostgreSQL tsvector
 *   → Paling akurat untuk kata-kata utuh
 *
 * Layer 2: Trigram Fuzzy Search via pg_trgm
 *   → Menangkap typo, spasi yang salah, variasi spelling
 *
 * Layer 3: Synonym Expansion
 *   → "Macbook M2" → juga cari "MBA M2", "MacBook Air M2"
 *
 * Hasil ketiga layer digabung, deduplicate, lalu di-rank dengan multi-factor scoring.
 */
class SearchService {
  /**
   * Jalankan smart search.
   */
  async search(options: SearchOptions): Promise<SearchResult> {
    const {
      query,
      page = 1,
      limit = 20,
      sortBy = 'relevance',
    } = options;

    const offset = (page - 1) * limit;

    // Expand query dengan sinonim
    const synonymsExpanded = await this.expandWithSynonyms(query);
    log.debug('Query expansion', { original: query, expanded: synonymsExpanded });

    // Bangun WHERE clause dari filters
    const filters = this.buildFilters(options);

    if (sortBy !== 'relevance') {
      // Untuk non-relevance sort, gunakan simple filter + sort
      return this.simpleSearch(query, filters, sortBy, page, limit, offset, synonymsExpanded);
    }

    // Smart search dengan ranking
    return this.smartRankedSearch(query, synonymsExpanded, filters, page, limit, offset);
  }

  /**
   * Smart ranked search: FTS + fuzzy + synonym, kemudian re-rank.
   */
  private async smartRankedSearch(
    query: string,
    synonyms: string[],
    filters: string,
    page: number,
    limit: number,
    offset: number
  ): Promise<SearchResult> {
    const allQueries = [query, ...synonyms];

    // Build OR conditions untuk FTS dengan semua sinonim
    const tsvectorConditions = allQueries
      .map((q) => `search_vector @@ plainto_tsquery('simple', '${this.escapeSql(q)}')`)
      .join(' OR ');

    // FTS rank — rata-rata rank dari semua query terms
    const rankExpressions = allQueries
      .map((q) => `ts_rank(search_vector, plainto_tsquery('simple', '${this.escapeSql(q)}'))`)
      .join(' + ');

    const sql = `
      WITH ranked AS (
        SELECT
          id, title, description, listed_price, location, seller, seller_url,
          condition, delivery, url, image_url, posted_at, scraped_at,
          actual_price_amount, actual_price_raw, actual_price_source,
          is_price_fake, is_barter, is_trade_in, is_nett,
          detected_keywords, confidence_score,
          normalized_title, normalized_description,
          created_at, updated_at,
          search_vector::text as search_vector_text,
          -- FTS rank (normalized by number of queries)
          (${rankExpressions}) / ${allQueries.length} as fts_rank,
          -- Trigram similarity score (best of title or description)
          GREATEST(
            COALESCE(similarity(normalized_title, '${this.escapeSql(query)}'), 0),
            COALESCE(similarity(normalized_description, '${this.escapeSql(query)}'), 0)
          ) as fuzzy_score,
          -- Recency score: listing lebih baru mendapat bonus (decay over 30 days)
          GREATEST(
            0,
            1 - EXTRACT(EPOCH FROM (NOW() - scraped_at)) / (30 * 86400)
          ) as recency_score
        FROM listings
        WHERE
          (
            ${tsvectorConditions}
            OR normalized_title % '${this.escapeSql(query)}'
            OR normalized_description % '${this.escapeSql(query)}'
          )
          ${filters ? 'AND ' + filters : ''}
      ),
      total_count AS (
        SELECT COUNT(*) as total FROM ranked
      )
      SELECT
        ranked.*,
        total_count.total,
        -- Composite rank score
        (
          ranked.fts_rank * 0.35 +
          ranked.fuzzy_score * 0.20 +
          ranked.confidence_score * 0.20 +
          ranked.recency_score * 0.15 +
          (CASE WHEN ranked.is_price_fake THEN 0 ELSE 0.10 END)
        ) as rank_score
      FROM ranked, total_count
      ORDER BY rank_score DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql);

    const total = rows.length > 0 ? Number(rows[0].total) : 0;

    const items: SearchResultItem[] = rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      listedPrice: row.listed_price as string | null,
      actualPriceAmount: row.actual_price_amount as number | null,
      actualPriceRaw: row.actual_price_raw as string | null,
      actualPriceSource: row.actual_price_source as string | null,
      isPriceFake: row.is_price_fake as boolean,
      isBarter: row.is_barter as boolean,
      isTradeIn: row.is_trade_in as boolean,
      isNett: row.is_nett as boolean,
      location: row.location,
      seller: row.seller,
      condition: row.condition,
      url: row.url,
      imageUrl: row.image_url as string | null,
      postedAt: row.posted_at as string | null,
      scrapedAt: row.scraped_at as Date,
      detectedKeywords: row.detected_keywords,
      confidenceScore: row.confidence_score as number,
      _rankScore: row.rank_score,
      _ftsRank: row.fts_rank,
      _fuzzyScore: row.fuzzy_score,
    }));

    return {
      items,
      total,
      page,
      limit,
      query,
      synonymsExpanded: synonyms,
    };
  }

  /**
   * Simple search untuk sorting non-relevance (price, newest, dll).
   */
  private async simpleSearch(
    query: string,
    filters: string,
    sortBy: string,
    page: number,
    limit: number,
    offset: number,
    synonymsExpanded: string[]
  ): Promise<SearchResult> {
    const orderBy = this.buildOrderBy(sortBy);

    const whereConditions = [
      query
        ? `(search_vector @@ plainto_tsquery('simple', '${this.escapeSql(query)}') OR normalized_title % '${this.escapeSql(query)}')`
        : '1=1',
      filters,
    ].filter(Boolean).join(' AND ');

    const [items, total] = await Promise.all([
      prisma.$queryRawUnsafe<SearchResultItem[]>(`
        SELECT
          id, title, description, listed_price, location, seller, seller_url,
          condition, delivery, url, image_url, posted_at, scraped_at,
          actual_price_amount, actual_price_raw, actual_price_source,
          is_price_fake, is_barter, is_trade_in, is_nett,
          detected_keywords, confidence_score,
          normalized_title, normalized_description,
          created_at, updated_at
        FROM listings
        WHERE ${whereConditions}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `),
      prisma.$queryRawUnsafe<[{ count: bigint }]>(`
        SELECT COUNT(*) as count FROM listings WHERE ${whereConditions}
      `),
    ]);

    return {
      items: this.mapRows(items),
      total: Number(total[0]?.count ?? 0),
      page,
      limit,
      query,
      synonymsExpanded,
    };
  }

  /**
   * Expand query dengan sinonim dari database.
   * Contoh: "Macbook M2" → ["MBA M2", "MacBook Air M2"]
   */
  private async expandWithSynonyms(query: string): Promise<string[]> {
    const queryLower = query.toLowerCase();
    const expanded: string[] = [];

    try {
      const synonymGroups = await prisma.productSynonym.findMany({
        where: { isActive: true },
      });

      for (const group of synonymGroups) {
        const aliases = group.aliases as string[];
        const canonical = group.canonicalName.toLowerCase();

        // Cek apakah query mengandung canonical name atau salah satu alias
        const isMatch =
          queryLower.includes(canonical) ||
          aliases.some((alias) => queryLower.includes(alias.toLowerCase()));

        if (isMatch) {
          // Tambahkan semua alias sebagai expanded query
          for (const alias of aliases) {
            const expanded_query = query.toLowerCase().replace(
              queryLower.includes(canonical) ? canonical : aliases.find((a) => queryLower.includes(a.toLowerCase()))!.toLowerCase(),
              alias.toLowerCase()
            );
            if (expanded_query !== query.toLowerCase()) {
              expanded.push(expanded_query);
            }
          }
        }
      }
    } catch (err) {
      log.warn('Gagal expand synonyms', err);
    }

    return [...new Set(expanded)].slice(0, 5); // Max 5 expanded queries
  }

  private buildFilters(options: SearchOptions): string {
    const conditions: string[] = [];

    if (options.location) {
      conditions.push(`location ILIKE '%${this.escapeSql(options.location)}%'`);
    }
    if (options.minPrice !== undefined) {
      conditions.push(`actual_price_amount >= ${options.minPrice}`);
    }
    if (options.maxPrice !== undefined) {
      conditions.push(`actual_price_amount <= ${options.maxPrice}`);
    }
    if (options.excludeFakePrice) {
      conditions.push(`is_price_fake = false`);
    }
    if (options.isBarter !== undefined) {
      conditions.push(`is_barter = ${options.isBarter}`);
    }
    if (options.isTradeIn !== undefined) {
      conditions.push(`is_trade_in = ${options.isTradeIn}`);
    }
    if (options.isNett !== undefined) {
      conditions.push(`is_nett = ${options.isNett}`);
    }

    return conditions.join(' AND ');
  }

  private buildOrderBy(sortBy: string): string {
    switch (sortBy) {
      case 'price_asc':  return 'actual_price_amount ASC NULLS LAST';
      case 'price_desc': return 'actual_price_amount DESC NULLS LAST';
      case 'newest':     return 'scraped_at DESC';
      case 'confidence': return 'confidence_score DESC';
      default:           return 'scraped_at DESC';
    }
  }

  /** Escape single quotes untuk SQL safety (basic protection untuk raw queries) */
  private escapeSql(str: string): string {
    return str.replace(/'/g, "''").replace(/;/g, '').slice(0, 200);
  }

  private mapRows(rows: any[]): SearchResultItem[] {
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      listedPrice: row.listed_price,
      actualPriceAmount: row.actual_price_amount,
      actualPriceRaw: row.actual_price_raw,
      actualPriceSource: row.actual_price_source,
      isPriceFake: row.is_price_fake,
      isBarter: row.is_barter,
      isTradeIn: row.is_trade_in,
      isNett: row.is_nett,
      location: row.location,
      seller: row.seller,
      condition: row.condition,
      url: row.url,
      imageUrl: row.image_url,
      postedAt: row.posted_at,
      scrapedAt: row.scraped_at,
      detectedKeywords: row.detected_keywords,
      confidenceScore: row.confidence_score,
    }));
  }
}

export const searchService = new SearchService();
