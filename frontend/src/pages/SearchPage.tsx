import { useState, useCallback, useRef } from 'react';
import { searchApi, scraperApi } from '../services/api';
import type { SearchResult, SearchOptions, Listing } from '../types';
import ListingCard from '../components/ListingCard/ListingCard';
import styles from './SearchPage.module.css';

const SORT_OPTIONS = [
  { value: 'relevance', label: '⭐ Relevansi' },
  { value: 'newest', label: '🕐 Terbaru' },
  { value: 'price_asc', label: '💸 Harga Naik' },
  { value: 'price_desc', label: '💰 Harga Turun' },
  { value: 'confidence', label: '🎯 Kepercayaan' },
];

const CATEGORY_ICONS: Record<string, string> = {
  pricing: '💰', condition: '📦', trade: '🔄',
  urgency: '⚡', delivery: '🚚', warranty: '🛡️', other: '📌',
};

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Filters
  const [sortBy, setSortBy] = useState<SearchOptions['sortBy']>('relevance');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [location, setLocation] = useState('');
  const [isBarter, setIsBarter] = useState<boolean | undefined>(undefined);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const stopMonitoring = useCallback(async () => {
    setIsMonitoring(false);
    setScrapeStatus('Dihentikan.');
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    try {
      await scraperApi.stop();
    } catch (e) {}
  }, []);

  const startMonitoring = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    if (isMonitoring) {
      return stopMonitoring();
    }

    setLoading(true);
    setError(null);
    setIsMonitoring(true);
    setScrapeStatus('Mencari data lama...');

    // 1. Ambil data dari database dulu
    try {
      const opts: SearchOptions = {
        q,
        sortBy,
        page: 1,
        limit: 100, // Show more initially since we won't have pagination easily with stream
        excludeFakePrice: undefined,
        location: location || undefined,
        minPrice: minPrice ? Number.parseInt(minPrice, 10) : undefined,
        maxPrice: maxPrice ? Number.parseInt(maxPrice, 10) : undefined,
        isBarter: isBarter,
      };
      const data = await searchApi.search(opts);
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencari data');
    } finally {
      setLoading(false);
    }

    // 2. Mulai scraper
    setScrapeStatus('Memulai live scraping...');
    try {
      await scraperApi.start({ query: q, count: 100, details: true, city: location });
    } catch (err) {
      setScrapeStatus(`❌ ${err instanceof Error ? err.message : 'Gagal memulai scraper'}`);
      setIsMonitoring(false);
      return;
    }

    // 3. Connect ke SSE untuk live data
    const sse = new EventSource('/api/scrape/stream');
    eventSourceRef.current = sse;

    sse.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      if (data.status === 'connected') {
        setScrapeStatus('🟢 Live monitoring berjalan...');
      } else if (data.status === 'done') {
        setScrapeStatus('✅ Scraper selesai.');
        setIsMonitoring(false);
        sse.close();
      } else if (data.status === 'exhausted') {
        setScrapeStatus('ℹ️ Semua produk telah habis diserap.');
        alert('Semua produk di Facebook Marketplace untuk pencarian ini sudah habis/terserap!');
        stopMonitoring();
      }
    });

    sse.addEventListener('listing', (e) => {
      const newListing = JSON.parse(e.data) as any;
      // Filter the incoming listing dynamically to see if it matches UI filters
      // (The backend pipeline already checks dictionary, but UI filters like price/location are applied here)
      let pass = true;
      const actPrice = newListing.actualPriceAmount;
      if (minPrice && (actPrice === null || actPrice === undefined || actPrice < Number.parseInt(minPrice, 10))) pass = false;
      if (maxPrice && (actPrice === null || actPrice === undefined || actPrice > Number.parseInt(maxPrice, 10))) pass = false;
      if (location && (!newListing.location || newListing.location.toLowerCase().indexOf(location.toLowerCase()) === -1)) pass = false;
      
      if (pass) {
        setResults((prev) => {
          if (!prev) {
            return {
              items: [newListing],
              total: 1,
              page: 1,
              limit: 100,
              query: query,
              synonymsExpanded: [],
            };
          }
          // Avoid duplicate display (if it exists, replace it with the new/updated one)
          const index = prev.items.findIndex((i) => i.id === newListing.id);
          if (index !== -1) {
            const updatedItems = [...prev.items];
            updatedItems[index] = newListing;
            return {
              ...prev,
              items: updatedItems,
            };
          }
          return {
            ...prev,
            total: prev.total + 1,
            items: [newListing, ...prev.items],
          };
        });
      }
    });

    sse.onerror = () => {
      setScrapeStatus('❌ Koneksi live terputus.');
      setIsMonitoring(false);
      sse.close();
    };

  }, [query, sortBy, location, minPrice, maxPrice, isBarter, isMonitoring, stopMonitoring]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') startMonitoring();
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
            className={`btn ${isMonitoring ? 'btn-secondary' : 'btn-primary'} ${styles.searchBtn}`}
            onClick={startMonitoring}
            disabled={!query.trim()}
          >
            {isMonitoring ? '🛑 Stop Monitoring' : (loading ? <span className="spinner" /> : '📡 Mulai Monitoring')}
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
              checked={isBarter === true}
              onChange={(e) => setIsBarter(e.target.checked ? true : undefined)}
            />
            <span>Barter only</span>
          </label>

          {(minPrice || maxPrice || location || isBarter) && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
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
              {isMonitoring ? '🔴 LIVE STREAM' : `Menampilkan 100 terbaru`}
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
            <p>Coba keyword yang berbeda, atau klik 📡 Mulai Monitoring untuk mencari data baru secara live.</p>
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
              <div className={styles.tip}>💡 Harga terdeteksi otomatis dari judul & deskripsi jika seller memasang harga clickbait</div>
              <div className={styles.tip}>💡 Aktifkan "Barter only" untuk filter listing yang menawarkan tukar barang</div>
            </div>
          </div>
        )}

        {/* Listing grid */}
        {!loading && results && results.items.length > 0 && (
          <>
            <div className={styles.grid}>
              {results.items.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  searchQuery={query}
                  onClick={() => setSelectedListing(listing)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Detail Modal ────────────────────────────────────── */}
      {selectedListing && (
        <div className={styles.modalOverlay} onClick={() => setSelectedListing(null)}>
          <div className={styles.modalContainer} onClick={(e) => e.stopPropagation()}>
            <button className={styles.modalCloseBtn} onClick={() => setSelectedListing(null)}>
              ✕
            </button>
            <div className={styles.modalBody}>
              {/* Image section */}
              <div className={styles.modalImageSection}>
                {selectedListing.imageUrl ? (
                  <img
                    src={selectedListing.imageUrl}
                    alt={selectedListing.title || '(Tanpa judul)'}
                    className={styles.modalImage}
                  />
                ) : (
                  <div className={styles.modalImagePlaceholder}>🖼️</div>
                )}
                <div className={styles.modalConfidenceBadge}>
                  Confidence: {Math.round(selectedListing.confidenceScore * 100)}%
                </div>
              </div>

              {/* Content section */}
              <div className={styles.modalContentSection}>
                <h2 className={styles.modalTitle}>{selectedListing.title || '(Tanpa judul)'}</h2>

                {/* Price display */}
                <div className={styles.modalPrices}>
                  {selectedListing.actualPriceAmount !== null && (
                    <div className={styles.modalActualPrice}>
                      <span className={styles.modalActualPriceVal}>
                        Rp {selectedListing.actualPriceAmount.toLocaleString('id-ID')}
                      </span>
                      {/* Tampilkan listed price sebagai info sekunder jika merupakan harga clickbait */}
                      {selectedListing.isPriceFake && selectedListing.listedPrice && (
                        <span className={styles.modalPriceRaw}>
                          Listed Price: {selectedListing.listedPrice}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Jika tidak ada actual price, tampilkan listed price langsung */}
                  {selectedListing.actualPriceAmount === null && selectedListing.listedPrice && (
                    <div className={styles.modalListedPrice}>
                      Listed Price: {selectedListing.listedPrice}
                    </div>
                  )}
                </div>

                {/* Flags badges */}
                <div className={styles.modalFlags}>
                  {selectedListing.isBarter && <span className="badge badge-warning">🔄 Barter</span>}
                  {selectedListing.isTradeIn && <span className="badge badge-accent">↔️ Tukar Tambah (TT)</span>}
                  {selectedListing.isNett && <span className="badge badge-muted">🔒 Harga Nett</span>}
                </div>

                {/* Meta details */}
                <div className={styles.modalMetaGrid}>
                  <div className={styles.modalMetaItem}>
                    <span className={styles.modalMetaLabel}>📍 Lokasi</span>
                    <span className={styles.modalMetaValue}>{selectedListing.location || '-'}</span>
                  </div>
                  <div className={styles.modalMetaItem}>
                    <span className={styles.modalMetaLabel}>📦 Kondisi</span>
                    <span className={styles.modalMetaValue}>{selectedListing.condition || '-'}</span>
                  </div>
                  <div className={styles.modalMetaItem}>
                    <span className={styles.modalMetaLabel}>👤 Penjual</span>
                    <span className={styles.modalMetaValue}>
                      {selectedListing.sellerUrl ? (
                        <a href={selectedListing.sellerUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-tertiary)', textDecoration: 'underline' }}>
                          {selectedListing.seller || 'Link Profil'}
                        </a>
                      ) : (
                        selectedListing.seller || '-'
                      )}
                    </span>
                  </div>
                  <div className={styles.modalMetaItem}>
                    <span className={styles.modalMetaLabel}>🕐 Diposting</span>
                    <span className={styles.modalMetaValue}>{selectedListing.postedAt || '-'}</span>
                  </div>
                </div>

                {/* Keywords */}
                {selectedListing.detectedKeywords && selectedListing.detectedKeywords.length > 0 && (
                  <div className={styles.modalKeywordsSection}>
                    <span className={styles.modalKeywordsTitle}>🔑 Istilah Terdeteksi</span>
                    <div className={styles.modalKeywords}>
                      {selectedListing.detectedKeywords.map((kw, i) => (
                        <span key={i} className="tag-pill" title={kw.meaning}>
                          {CATEGORY_ICONS[kw.category] ?? '📌'} <strong>{kw.term}</strong>: {kw.meaning}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Description */}
                <div className={styles.modalDescriptionSection}>
                  <span className={styles.modalDescTitle}>📝 Deskripsi Lengkap</span>
                  <div className={styles.modalDescText}>
                    {selectedListing.description || '(Tidak ada deskripsi dari penjual)'}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer with Marketplace redirect action */}
            <div className={styles.modalFooter}>
              <button className="btn btn-ghost" onClick={() => setSelectedListing(null)}>
                Tutup
              </button>
              <a
                href={selectedListing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              >
                🌐 Buka di Facebook Marketplace
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
