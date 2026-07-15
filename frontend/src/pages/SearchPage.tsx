import { useState, useCallback, useRef } from 'react';
import { searchApi, scraperApi } from '../services/api';
import type { SearchResult, SearchOptions } from '../types';
import ListingCard from '../components/ListingCard/ListingCard';
import styles from './SearchPage.module.css';

const SORT_OPTIONS = [
  { value: 'relevance', label: '⭐ Relevansi' },
  { value: 'newest', label: '🕐 Terbaru' },
  { value: 'price_asc', label: '💸 Harga Naik' },
  { value: 'price_desc', label: '💰 Harga Turun' },
  { value: 'confidence', label: '🎯 Kepercayaan' },
];

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null);

  // Filters
  const [sortBy, setSortBy] = useState<SearchOptions['sortBy']>('relevance');
  const [excludeFakePrice, setExcludeFakePrice] = useState(false);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [location, setLocation] = useState('');
  const [isBarter, setIsBarter] = useState<boolean | undefined>(undefined);

  const [currentPage, setCurrentPage] = useState(1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(async (page = 1) => {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setCurrentPage(page);

    try {
      const opts: SearchOptions = {
        q,
        sortBy,
        page,
        limit: 20,
        excludeFakePrice: excludeFakePrice || undefined,
        location: location || undefined,
        minPrice: minPrice ? Number.parseInt(minPrice, 10) : undefined,
        maxPrice: maxPrice ? Number.parseInt(maxPrice, 10) : undefined,
        isBarter: isBarter,
      };
      const data = await searchApi.search(opts);
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal melakukan pencarian');
    } finally {
      setLoading(false);
    }
  }, [query, sortBy, excludeFakePrice, location, minPrice, maxPrice, isBarter]);

  const handleScrapeAndSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setScrapeLoading(true);
    setScrapeStatus('Memulai scraping...');

    try {
      await scraperApi.start({ query: q, count: 30 });

      // Poll status
      const poll = setInterval(async () => {
        try {
          const status = await scraperApi.status();
          if (status.status === 'done') {
            clearInterval(poll);
            setScrapeStatus(`✅ ${status.totalFound ?? 0} listing berhasil diambil!`);
            setScrapeLoading(false);
            // Langsung search setelah scraping selesai
            setTimeout(() => {
              handleSearch(1);
              setScrapeStatus(null);
            }, 1500);
          } else if (status.status === 'failed') {
            clearInterval(poll);
            setScrapeStatus(`❌ Scraping gagal: ${status.error}`);
            setScrapeLoading(false);
          } else {
            setScrapeStatus('⏳ Scraping berjalan...');
          }
        } catch {
          clearInterval(poll);
          setScrapeLoading(false);
        }
      }, 3000);
    } catch (err) {
      setScrapeStatus(`❌ ${err instanceof Error ? err.message : 'Gagal memulai scraping'}`);
      setScrapeLoading(false);
    }
  }, [query, handleSearch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch(1);
  };

  return (
    <div className={styles.page}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>
            <span className="gradient-text">Smart Search</span>
          </h1>
          <p className={styles.subtitle}>
            Cari listing dengan AI — menembus title, deskripsi, dan harga tersembunyi
          </p>
        </div>
      </div>

      {/* ── Search Bar ──────────────────────────────────────── */}
      <div className={styles.searchSection}>
        <div className={styles.searchBar}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            ref={searchInputRef}
            id="search-input"
            className={styles.searchInput}
            type="text"
            placeholder="Cari MacBook M2, iPhone 15 Pro, PS5..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          {query && (
            <button
              className={styles.clearBtn}
              onClick={() => { setQuery(''); setResults(null); searchInputRef.current?.focus(); }}
              title="Hapus"
            >
              ✕
            </button>
          )}
          <button
            className={`btn btn-primary ${styles.searchBtn}`}
            onClick={() => handleSearch(1)}
            disabled={!query.trim() || loading}
          >
            {loading ? <span className="spinner" /> : 'Cari'}
          </button>
          <button
            className={`btn btn-secondary ${styles.scrapeBtn}`}
            onClick={handleScrapeAndSearch}
            disabled={!query.trim() || scrapeLoading}
            title="Ambil listing baru dari Facebook lalu cari"
          >
            {scrapeLoading ? <span className="spinner" /> : '🕷 Scrape'}
          </button>
        </div>

        {/* Scrape Status */}
        {scrapeStatus && (
          <div className={styles.scrapeStatus}>{scrapeStatus}</div>
        )}

        {/* Filters */}
        <div className={styles.filters}>
          <select
            className={styles.filterSelect}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SearchOptions['sortBy'])}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <input
            className={styles.filterInput}
            type="number"
            placeholder="Min Harga"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
          />
          <input
            className={styles.filterInput}
            type="number"
            placeholder="Max Harga"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
          />
          <input
            className={styles.filterInput}
            type="text"
            placeholder="Lokasi"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />

          <label className={styles.filterToggle}>
            <input
              type="checkbox"
              checked={excludeFakePrice}
              onChange={(e) => setExcludeFakePrice(e.target.checked)}
            />
            <span>Sembunyikan harga palsu</span>
          </label>

          <label className={styles.filterToggle}>
            <input
              type="checkbox"
              checked={isBarter === true}
              onChange={(e) => setIsBarter(e.target.checked ? true : undefined)}
            />
            <span>Barter only</span>
          </label>

          {(excludeFakePrice || minPrice || maxPrice || location || isBarter) && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setExcludeFakePrice(false);
                setMinPrice('');
                setMaxPrice('');
                setLocation('');
                setIsBarter(undefined);
              }}
            >
              Reset filter
            </button>
          )}
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────── */}
      <div className={styles.results}>
        {/* Error */}
        {error && (
          <div className={styles.errorBanner}>
            ⚠️ {error}
          </div>
        )}

        {/* Meta info */}
        {results && !loading && (
          <div className={styles.resultsMeta}>
            <span className={styles.resultCount}>
              {results.total.toLocaleString('id')} listing ditemukan
              {results.synonymsExpanded.length > 0 && (
                <span className={styles.synonymInfo}>
                  {' '}· Expanded ke: {results.synonymsExpanded.slice(0, 3).join(', ')}
                </span>
              )}
            </span>
            <span className={styles.pageInfo}>
              Halaman {currentPage} dari {Math.ceil(results.total / 20)}
            </span>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className={styles.grid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={`skeleton-${i}`} className={styles.skeletonCard}>
                <div className="skeleton" style={{ height: 200, borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }} />
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="skeleton" style={{ height: 16, width: '80%' }} />
                  <div className="skeleton" style={{ height: 12, width: '60%' }} />
                  <div className="skeleton" style={{ height: 20, width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && results?.items.length === 0 && (
          <div className="empty-state">
            <div style={{ fontSize: 64 }}>🔎</div>
            <h3>Tidak ada listing ditemukan</h3>
            <p>Coba keyword yang berbeda, atau klik 🕷 Scrape untuk mengambil data baru dari Facebook.</p>
          </div>
        )}

        {/* No search yet */}
        {!loading && !results && !error && (
          <div className="empty-state">
            <div style={{ fontSize: 64 }}>🛒</div>
            <h3>Mulai pencarian</h3>
            <p>Ketik keyword dan tekan Enter atau klik Cari.</p>
            <div className={styles.tips}>
              <div className={styles.tip}>💡 Cari "MBA M2" untuk menemukan "MacBook Air M2"</div>
              <div className={styles.tip}>💡 Listing dengan harga palsu (Rp 1, Rp 123) tetap ditampilkan</div>
              <div className={styles.tip}>💡 Aktifkan "Sembunyikan harga palsu" untuk filter heuristik</div>
            </div>
          </div>
        )}

        {/* Listing grid */}
        {!loading && results && results.items.length > 0 && (
          <>
            <div className={styles.grid}>
              {results.items.map((listing) => (
                <ListingCard key={listing.id} listing={listing} searchQuery={query} />
              ))}
            </div>

            {/* Pagination */}
            {results.total > 20 && (
              <div className={styles.pagination}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleSearch(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  ← Prev
                </button>
                <span className={styles.pageNum}>
                  {currentPage} / {Math.ceil(results.total / 20)}
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleSearch(currentPage + 1)}
                  disabled={currentPage >= Math.ceil(results.total / 20)}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
