import type { ApiResponse, SearchOptions, SearchResult, Listing, DictionaryTerm, ScrapeOptions, AuthStatus } from '../types';

const BASE = '/api';

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  const json: ApiResponse<T> = await res.json();

  if (!json.success || !res.ok) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }

  return json.data as T;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  connect: () =>
    request<{ status: string; message: string }>('/auth/connect', { method: 'POST' }),

  status: () =>
    request<AuthStatus>('/auth/status'),

  disconnect: () =>
    request<{ message: string }>('/auth/disconnect', { method: 'DELETE' }),

  cancel: () =>
    request<{ message: string }>('/auth/cancel', { method: 'DELETE' }),
};

// ─── Scraper ──────────────────────────────────────────────────────────────────
export const scraperApi = {
  start: (options: ScrapeOptions) =>
    request<{ status: string }>('/scrape', {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  status: () =>
    request<{
      status: 'idle' | 'running' | 'done' | 'failed';
      startedAt?: string;
      totalFound?: number;
      error?: string;
      options?: ScrapeOptions;
    }>('/scrape/status'),

  stop: () =>
    request<{ success: boolean; message: string }>('/scrape/stop', { method: 'POST' }),
};

// ─── Search ───────────────────────────────────────────────────────────────────
export const searchApi = {
  search: (options: SearchOptions) => {
    const params = new URLSearchParams();
    Object.entries(options).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        params.set(k, String(v));
      }
    });
    return request<SearchResult>(`/search?${params.toString()}`);
  },
};

// ─── Listings ─────────────────────────────────────────────────────────────────
export const listingsApi = {
  getAll: (params?: {
    page?: number;
    limit?: number;
    location?: string;
    sortBy?: string;
  }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
      )
    );
    return request<{ items: Listing[]; total: number; page: number; limit: number; totalPages: number }>(
      `/listings?${qs}`
    );
  },

  getById: (id: string) =>
    request<Listing>(`/listings/${id}`),

  delete: (id: string) =>
    request<{ message: string }>(`/listings/${id}`, { method: 'DELETE' }),

  deleteAll: () =>
    request<{ message: string }>('/listings', { method: 'DELETE' }),
};

// ─── Dictionary ───────────────────────────────────────────────────────────────
export const dictionaryApi = {
  getAll: (params?: { category?: string; activeOnly?: boolean }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
      )
    );
    return request<DictionaryTerm[]>(`/dictionary?${qs}`);
  },

  create: (data: { term: string; meaning: string; category: string }) =>
    request<DictionaryTerm>('/dictionary', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<{ term: string; meaning: string; category: string; isActive: boolean }>) =>
    request<DictionaryTerm>(`/dictionary/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/dictionary/${id}`, { method: 'DELETE' }),
};
