/** Shared types antara frontend dan API responses */

export interface Listing {
  id: string;
  title: string | null;
  description: string | null;
  listedPrice: string | null;
  actualPriceAmount: number | null;
  actualPriceRaw: string | null;
  actualPriceSource: 'listed' | 'title' | 'description' | 'unknown' | null;
  isPriceFake: boolean;
  isBarter: boolean;
  isTradeIn: boolean;
  isNett: boolean;
  location: string | null;
  seller: string | null;
  sellerUrl: string | null;
  condition: string | null;
  delivery: string | null;
  url: string;
  imageUrl: string | null;
  postedAt: string | null;
  scrapedAt: string;
  detectedKeywords: DictionaryMatch[] | null;
  confidenceScore: number;
  isDetailPending?: boolean;
  _rankScore?: number;
}

export interface DictionaryMatch {
  term: string;
  meaning: string;
  category: string;
  position: number;
}

export interface DictionaryTerm {
  id: string;
  term: string;
  meaning: string;
  category: string;
  isActive: boolean;
  createdAt: string;
}

export interface SearchResult {
  items: Listing[];
  total: number;
  page: number;
  limit: number;
  query: string;
  synonymsExpanded: string[];
}

export interface SearchOptions {
  q: string;
  location?: string;
  minPrice?: number;
  maxPrice?: number;
  excludeFakePrice?: boolean;
  isBarter?: boolean;
  isTradeIn?: boolean;
  isNett?: boolean;
  sortBy?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'confidence';
  page?: number;
  limit?: number;
}

export interface ScrapeOptions {
  query: string;
  city?: string;
  count?: number;
  headless?: boolean;
  details?: boolean;
  minPrice?: number;
  maxPrice?: number;
  allowedLocations?: string[];
}

export interface AuthStatus {
  loginState: 'idle' | 'waiting_user' | 'detecting' | 'success' | 'failed';
  isConnected: boolean;
  isSessionLikelyValid: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
