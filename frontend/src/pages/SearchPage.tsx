import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  Activity,
  SlidersHorizontal,
  X,
  MapPin,
  Clock,
  Package,
  User,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Sparkles,
  Check,
  Play,
  Square,
  RefreshCw
} from 'lucide-react';
import { searchApi, scraperApi } from '../services/api';
import type { SearchResult, SearchOptions, Listing } from '../types';
import ListingCard, { hasMinus, overrideCurrencyToRupiah } from '../components/ListingCard/ListingCard';
import styles from './SearchPage.module.css';

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevansi' },
  { value: 'newest', label: 'Terbaru' },
  { value: 'price_asc', label: 'Harga Terendah' },
  { value: 'price_desc', label: 'Harga Tertinggi' },
  { value: 'confidence', label: 'Skor Kepercayaan' },
];

const CATEGORY_ICONS: Record<string, any> = {
  pricing: DollarSign,
  condition: Package,
  trade: RefreshCw,
  urgency: Sparkles,
  delivery: ChevronRight,
  warranty: Check,
  other: Sparkles,
};

/** Helper to format input strings with Indonesian thousand separator */
function formatInputPrice(value: string): string {
  if (!value) return '';
  const cleanValue = value.replace(/\D/g, '');
  if (!cleanValue) return '';
  const num = Number.parseInt(cleanValue, 10);
  if (Number.isNaN(num)) return '';
  return num.toLocaleString('id-ID');
}

/** Helper to format profiles / URLs to point to external Facebook Marketplace */
function formatExternalUrl(url: string | null): string {
  if (!url) return '#';
  const cleanUrl = url.trim();
  if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
    return cleanUrl;
  }
  if (cleanUrl.startsWith('/')) {
    return `https://www.facebook.com${cleanUrl}`;
  }
  return `https://www.facebook.com/${cleanUrl}`;
}

/** Helper to extract WhatsApp number and build direct wa.me link */
function getWhatsAppLink(title: string | null, description: string | null): string | null {
  const t = title || '';
  const d = description || '';
  const text = `${t} ${d}`;
  const match = text.match(/08[0-9]{1,3}[-\s.]?[0-9]{3,4}[-\s.]?[0-9]{3,5}/g);
  if (!match) return null;
  for (const num of match) {
    const cleanNum = num.replace(/[-\s.]/g, '');
    if (cleanNum.length >= 10 && cleanNum.length <= 13) {
      return `https://wa.me/62${cleanNum.substring(1)}`;
    }
  }
  return null;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Filters
  const [sortBy, setSortBy] = useState<SearchOptions['sortBy']>('relevance');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [location, setLocation] = useState('');
  const [isBarter, setIsBarter] = useState<boolean | undefined>(undefined);
  const [isOpenNego, setIsOpenNego] = useState<boolean | undefined>(undefined);
  const [isNoMinus, setIsNoMinus] = useState<boolean | undefined>(undefined);
  const [isNoService, setIsNoService] = useState<boolean | undefined>(undefined);
  const [completenessFilter, setCompletenessFilter] = useState<'all' | 'fullset' | 'unit_only'>('all');
  const [connectivityFilter, setConnectivityFilter] = useState<'all' | 'all_operator' | 'wifi_only'>('all');

  // Custom Select state
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const stopMonitoring = useCallback(async () => {
    setIsMonitoring(false);
    setScrapeStatus('Monitoring dihentikan.');
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    try {
      await scraperApi.stop();
    } catch (e) { }
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
    setScrapeStatus('Mencari database lokal...');

    // 1. Ambil data dari database dulu
    try {
      const opts: SearchOptions = {
        q,
        sortBy,
        page: 1,
        limit: 100,
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
      await scraperApi.start({
        query: q,
        count: 100,
        details: true,
        city: location,
        minPrice: minPrice ? Number.parseInt(minPrice, 10) : undefined,
        maxPrice: maxPrice ? Number.parseInt(maxPrice, 10) : undefined
      });
    } catch (err) {
      setScrapeStatus(`Gagal memulai scraper: ${err instanceof Error ? err.message : String(err)}`);
      setIsMonitoring(false);
      return;
    }

    // 3. Connect ke SSE untuk live data
    const sse = new EventSource('/api/scrape/stream');
    eventSourceRef.current = sse;

    sse.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      if (data.status === 'connected') {
        setScrapeStatus('Live monitoring berjalan...');
      } else if (data.status === 'done') {
        setScrapeStatus('Scraper selesai.');
        setIsMonitoring(false);
        sse.close();
      } else if (data.status === 'exhausted') {
        setScrapeStatus('Semua produk telah habis diserap.');
        alert('Semua produk di Facebook Marketplace untuk pencarian ini sudah habis/terserap!');
        stopMonitoring();
      }
    });

    sse.addEventListener('listing', (e) => {
      const newListing = JSON.parse(e.data) as any;

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
            items: [...prev.items, newListing],
          };
        });
      }
    });

    sse.onerror = () => {
      setScrapeStatus('Koneksi live terputus.');
      setIsMonitoring(false);
      sse.close();
    };

  }, [query, sortBy, location, minPrice, maxPrice, isBarter, isMonitoring, stopMonitoring]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') startMonitoring();
  };

  // Close filter drawer on resize to desktop & Close select dropdown on click outside
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsFilterDrawerOpen(false);
      }
    };

    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsSortDropdownOpen(false);
      }
    }

    window.addEventListener('resize', handleResize);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Sideway wheel scrolling handler on product container
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [results]);

  // Local real-time filtering for display
  const filteredItems = useMemo(() => {
    if (!results) return [];
    return results.items.filter((item) => {
      // 1. Min Price Filter
      if (minPrice) {
        const min = Number.parseInt(minPrice, 10);
        if (item.actualPriceAmount !== null && item.actualPriceAmount < min) return false;
      }
      // 2. Max Price Filter
      if (maxPrice) {
        const max = Number.parseInt(maxPrice, 10);
        if (item.actualPriceAmount !== null && item.actualPriceAmount > max) return false;
      }
      // 3. Location Filter
      if (location) {
        if (!item.location || item.location.toLowerCase().indexOf(location.toLowerCase()) === -1) return false;
      }
      // 4. Barter / TradeIn Filter
      if (isBarter) {
        if (!item.isBarter && !item.isTradeIn) return false;
      }
      // 5. Open Nego Filter (Cari data yang flag nya tidak ada kata nett)
      if (isOpenNego) {
        if (item.isNett === true) return false;
      }
      // 6. No Minus Filter (Cari data yang tidak ada kerusakan/minus)
      if (isNoMinus) {
        if (hasMinus(item.title || '', item.description || '')) return false;
      }
      return true;
    });
  }, [results, minPrice, maxPrice, location, isBarter, isOpenNego, isNoMinus]);

  const hasActiveFilters = minPrice || maxPrice || location || isBarter !== undefined || isOpenNego !== undefined || isNoMinus !== undefined || sortBy !== 'relevance';

  const handleResetFilters = () => {
    setMinPrice('');
    setMaxPrice('');
    setLocation('');
    setIsBarter(undefined);
    setIsOpenNego(undefined);
    setIsNoMinus(undefined);
    setSortBy('relevance');
  };

  const renderFiltersContent = () => (
    <>
      {/* Custom Dropdown Select */}
      <div className={styles.filterGroup}>
        <label className={styles.filterLabel}>Urutan</label>
        <div className={styles.customSelectWrapper} ref={dropdownRef}>
          <button
            type="button"
            className={styles.customSelectBtn}
            onClick={() => setIsSortDropdownOpen((prev) => !prev)}
          >
            <span>{SORT_OPTIONS.find((o) => o.value === sortBy)?.label}</span>
            {isSortDropdownOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {isSortDropdownOpen && (
            <ul className={styles.customSelectDropdown}>
              {SORT_OPTIONS.map((o) => (
                <li
                  key={o.value}
                  className={`${styles.customSelectItem} ${sortBy === o.value ? styles.customSelectItemActive : ''}`}
                  onClick={() => {
                    setSortBy(o.value as SearchOptions['sortBy']);
                    setIsSortDropdownOpen(false);
                  }}
                >
                  {o.label}
                  {sortBy === o.value && <Check size={14} className={styles.selectCheckIcon} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Min Price Custom Input */}
      <div className={styles.filterGroup}>
        <label className={styles.filterLabel}>Min Harga</label>
        <div className={styles.customInputContainer}>
          <span className={styles.inputPrefix}>Rp</span>
          <input
            className={styles.customInput}
            type="text"
            placeholder="0"
            value={formatInputPrice(minPrice)}
            onChange={(e) => setMinPrice(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>

      {/* Max Price Custom Input */}
      <div className={styles.filterGroup}>
        <label className={styles.filterLabel}>Max Harga</label>
        <div className={styles.customInputContainer}>
          <span className={styles.inputPrefix}>Rp</span>
          <input
            className={styles.customInput}
            type="text"
            placeholder="0"
            value={formatInputPrice(maxPrice)}
            onChange={(e) => setMaxPrice(e.target.value.replace(/\D/g, ''))}
          />
        </div>
      </div>

      {/* Location Custom Input */}
      <div className={styles.filterGroup}>
        <label className={styles.filterLabel}>Lokasi</label>
        <div className={styles.customInputContainer}>
          <MapPin size={14} className={styles.inputIconPrefix} />
          <input
            className={styles.customInput}
            type="text"
            placeholder="Semua Kota"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            style={{ paddingLeft: '32px' }}
          />
        </div>
      </div>

      {/* Custom Checkbox - Barter/TT */}
      <div className={styles.filterGroup}>
        <div
          className={styles.customCheckboxContainer}
          onClick={() => setIsBarter(isBarter === true ? undefined : true)}
        >
          <div className={`${styles.customCheckbox} ${isBarter === true ? styles.customCheckboxChecked : ''}`}>
            {isBarter === true && <Check size={12} strokeWidth={3} className={styles.checkboxCheck} />}
          </div>
          <span className={styles.checkboxLabelText}>Khusus Tukar (BT / TT)</span>
        </div>
      </div>

      {/* Custom Checkbox - Open Nego */}
      <div className={styles.filterGroup}>
        <div
          className={styles.customCheckboxContainer}
          onClick={() => setIsOpenNego(isOpenNego === true ? undefined : true)}
        >
          <div className={`${styles.customCheckbox} ${isOpenNego === true ? styles.customCheckboxChecked : ''}`}>
            {isOpenNego === true && <Check size={12} strokeWidth={3} className={styles.checkboxCheck} />}
          </div>
          <span className={styles.checkboxLabelText}>Bisa Nego (Open Nego)</span>
        </div>
      </div>

      {/* Custom Checkbox - No Minus */}
      <div className={styles.filterGroup}>
        <div
          className={styles.customCheckboxContainer}
          onClick={() => setIsNoMinus(isNoMinus === true ? undefined : true)}
        >
          <div className={`${styles.customCheckbox} ${isNoMinus === true ? styles.customCheckboxChecked : ''}`}>
            {isNoMinus === true && <Check size={12} strokeWidth={3} className={styles.checkboxCheck} />}
          </div>
          <span className={styles.checkboxLabelText}>Tanpa Minus (No Minus)</span>
        </div>
      </div>

      {hasActiveFilters && (
        <button
          className={styles.resetBtn}
          onClick={handleResetFilters}
        >
          Reset Semua Filter
        </button>
      )}
    </>
  );

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <h1 className={styles.pageTitle}>Dashboard Analitik</h1>
        <p className={styles.pageSubtitle}>Pantau dan filter data Facebook Marketplace secara cerdas secara real-time.</p>
      </header>

      {/* ── Bento Layout Grid ── */}
      <div className={styles.bentoLayout}>
        {/* Bento Box 1: Search Panel */}
        <section className={`${styles.bentoBox} ${styles.searchPanel}`}>
          <div className={styles.searchBar}>
            <Search className={styles.searchIcon} size={18} />
            <input
              ref={searchInputRef}
              id="search-input"
              className={styles.searchInput}
              type="text"
              placeholder="Masukkan Barang Yang Ingin Dicari."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              autoComplete="off"
            />
            {query && (
              <button
                className={styles.clearBtn}
                onClick={() => { setQuery(''); setResults(null); searchInputRef.current?.focus(); }}
                title="Hapus"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            className={`${styles.monitorBtn} ${isMonitoring ? styles.monitorBtnActive : ''}`}
            onClick={startMonitoring}
            disabled={!query.trim()}
          >
            {isMonitoring ? (
              <>
                <Square size={14} fill="currentColor" />
                <span>Stop Monitoring</span>
              </>
            ) : (
              <>
                <Play size={14} fill="currentColor" />
                <span>Mulai Monitoring</span>
              </>
            )}
          </button>
        </section>

        {/* Bento Box 2: Live Status */}
        <section className={`${styles.bentoBox} ${styles.statusPanel}`}>
          <div className={styles.statusHeader}>
            <div className={styles.statusDotWrapper}>
              <span className={`${styles.statusDot} ${isMonitoring ? styles.statusDotActive : ''}`}></span>
              <Activity size={14} className={styles.activityIcon} />
            </div>
            <span className={styles.statusTitle}>Status Sistem</span>
          </div>
          <div className={styles.statusContent}>
            {scrapeStatus ? (
              <p className={styles.statusMessage}>{scrapeStatus}</p>
            ) : (
              <p className={styles.statusMessageMuted}>Sistem siap. Masukkan kata kunci untuk memulai.</p>
            )}
          </div>
        </section>

        {/* Bento Box 3: Filters (Desktop View only) */}
        <section className={`${styles.bentoBox} ${styles.filtersPanel}`}>
          <div className={styles.filtersHeader}>
            <SlidersHorizontal size={14} className={styles.sectionIcon} />
            <span className={styles.sectionTitle}>Penyaringan Lanjutan</span>
          </div>
          <div className={styles.filtersContent}>
            {renderFiltersContent()}
          </div>
        </section>

        {/* Mobile Filter Toggle Bar (Mobile View only) */}
        <div className={styles.mobileFilterBar}>
          <button
            className={styles.mobileFilterBtn}
            onClick={() => setIsFilterDrawerOpen(true)}
          >
            <SlidersHorizontal size={14} />
            <span>Filter & Urutan</span>
            {hasActiveFilters && <span className={styles.filterDot}></span>}
          </button>
        </div>

        {/* Bento Box 5: Main Results Container (Side-by-side matching filter panel height) */}
        <div className={styles.resultsContainer}>
          {/* Informative Stats & Active Filter Chips Bar */}
          <div className={styles.informativeBar}>
            <div className={styles.statCountBlock}>
              <span className={styles.statCountValue}>{results ? filteredItems.length : 0}</span>
              <span className={styles.statCountLabel}>Listing Ditemukan</span>
            </div>

            {/* Render Active Filter Chips */}
            <div className={styles.activeFiltersList}>
              {results && results.query && (
                <div className={styles.filterChipStatic} title="Pencarian Utama">
                  <span>Query: "{results.query}"</span>
                </div>
              )}

              {sortBy !== 'relevance' && (
                <div className={styles.filterChip}>
                  <span>Urutan: {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}</span>
                  <button className={styles.clearChipBtn} onClick={() => setSortBy('relevance')}>
                    <X size={10} />
                  </button>
                </div>
              )}

              {minPrice && (
                <div className={styles.filterChip}>
                  <span>Min: Rp {Number(minPrice).toLocaleString('id-ID')}</span>
                  <button className={styles.clearChipBtn} onClick={() => setMinPrice('')}>
                    <X size={10} />
                  </button>
                </div>
              )}

              {maxPrice && (
                <div className={styles.filterChip}>
                  <span>Max: Rp {Number(maxPrice).toLocaleString('id-ID')}</span>
                  <button className={styles.clearChipBtn} onClick={() => setMaxPrice('')}>
                    <X size={10} />
                  </button>
                </div>
              )}

              {location && (
                <div className={styles.filterChip}>
                  <span>Lokasi: "{location}"</span>
                  <button className={styles.clearChipBtn} onClick={() => setLocation('')}>
                    <X size={10} />
                  </button>
                </div>
              )}

              {isBarter === true && (
                <div className={styles.filterChip}>
                  <span>Khusus Tukar (BT / TT)</span>
                  <button className={styles.clearChipBtn} onClick={() => setIsBarter(undefined)}>
                    <X size={10} />
                  </button>
                </div>
              )}

              {isOpenNego === true && (
                <div className={styles.filterChip}>
                  <span>Bisa Nego</span>
                  <button className={styles.clearChipBtn} onClick={() => setIsOpenNego(undefined)}>
                    <X size={10} />
                  </button>
                </div>
              )}

              {isNoMinus === true && (
                <div className={styles.filterChip}>
                  <span>Tanpa Minus</span>
                  <button className={styles.clearChipBtn} onClick={() => setIsNoMinus(undefined)}>
                    <X size={10} />
                  </button>
                </div>
              )}

              {isNoService === true && (
                <div className={styles.filterChip}>
                  <span>Tanpa Servis</span>
                  <button className={styles.clearChipBtn} onClick={() => setIsNoService(undefined)}>
                    <X size={10} />
                  </button>
                </div>
              )}

              {completenessFilter !== 'all' && (
                <div className={styles.filterChip}>
                  <span>Kelengkapan: {completenessFilter === 'fullset' ? 'Fullset' : 'Unit Only'}</span>
                  <button className={styles.clearChipBtn} onClick={() => setCompletenessFilter('all')}>
                    <X size={10} />
                  </button>
                </div>
              )}

              {connectivityFilter !== 'all' && (
                <div className={styles.filterChip}>
                  <span>Konektivitas: {connectivityFilter === 'all_operator' ? 'All Op' : 'WiFi Only'}</span>
                  <button className={styles.clearChipBtn} onClick={() => setConnectivityFilter('all')}>
                    <X size={10} />
                  </button>
                </div>
              )}

              {results && results.synonymsExpanded.length > 0 && (
                <div className={styles.filterChipExpanded} title="Keyword diperluas otomatis">
                  <span>Synonyms: {results.synonymsExpanded.slice(0, 2).join(', ')}</span>
                </div>
              )}
            </div>
          </div>

          <div className={styles.scrollWrapper}>
            {/* Error message banner */}
            {error && (
              <div className={styles.errorBanner}>
                <span>{error}</span>
              </div>
            )}

            {/* Loading indicator */}
            {loading && (
              <div className={styles.grid}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={`skeleton-${i}`} className={styles.skeletonCard}>
                    <div className={styles.skeletonImage} />
                    <div className={styles.skeletonInfo}>
                      <div className={styles.skeletonLineShort} />
                      <div className={styles.skeletonLineLong} />
                      <div className={styles.skeletonLineMedium} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Live Monitoring Loader State (if monitoring is active and we haven't got data yet) */}
            {!loading && isMonitoring && filteredItems.length === 0 && (
              <div className={styles.monitoringLoaderContainer}>
                <div className={styles.radarRing}>
                  <div className={styles.radarPulse} />
                  <Search size={32} className={styles.radarIcon} />
                </div>
                <h3>Sedang Menyerap Data Live...</h3>
                <p>{scrapeStatus || 'Menunggu data masuk dari Facebook Marketplace...'}</p>
                <div className={styles.liveSpinnerBlock}>
                  <span className={styles.livePulseDot} />
                  <span>Sistem Aktif & Memindai</span>
                </div>
              </div>
            )}

            {/* Empty State: No search query */}
            {!loading && !isMonitoring && !results && !error && (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconContainer}>
                  <Search size={32} className={styles.emptyIcon} />
                </div>
                <h3>Mulai Pencarian Baru</h3>
                <p>Masukkan kata kunci produk di atas lalu klik Mulai Monitoring untuk menyerap data Marketplace Facebook secara langsung.</p>
              </div>
            )}

            {/* Empty State: Query has 0 results */}
            {!loading && !isMonitoring && results && filteredItems.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconContainer}>
                  <SlidersHorizontal size={32} className={styles.emptyIcon} />
                </div>
                <h3>Tidak Ada Data Ditemukan</h3>
                <p>Tidak ada hasil yang sesuai dengan kriteria filter Anda saat ini. Coba perkecil batasan filter Anda.</p>
              </div>
            )}

            {/* Results Grid display: 2-Row Horizontal scrollable column flow */}
            {!loading && results && filteredItems.length > 0 && (
              <div
                className={styles.grid}
                ref={scrollContainerRef}
              >
                {filteredItems.map((listing) => (
                  <div key={listing.id} className={styles.gridCardWrapper}>
                    <ListingCard
                      listing={listing}
                      searchQuery={query}
                      onClick={() => setSelectedListing(listing)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile Filter Bottom Sheet Drawer ── */}
      {isFilterDrawerOpen && (
        <div className={styles.drawerOverlay} onClick={() => setIsFilterDrawerOpen(false)}>
          <div className={styles.drawerContainer} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <span className={styles.drawerTitle}>Pengaturan Filter</span>
              <button className={styles.drawerCloseBtn} onClick={() => setIsFilterDrawerOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className={styles.drawerBody}>
              {renderFiltersContent()}
            </div>
            <div className={styles.drawerFooter}>
              <button className={styles.applyBtn} onClick={() => setIsFilterDrawerOpen(false)}>
                Terapkan Filter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal (Asymmetric split design) ── */}
      {selectedListing && (
        <div className={styles.modalOverlay} onClick={() => setSelectedListing(null)}>
          <div className={styles.modalContainer} onClick={(e) => e.stopPropagation()}>
            {/* Modal Body */}
            <div className={styles.modalBody}>
              {/* Left Column: Image Area */}
              <div className={styles.modalLeftColumn}>
                {selectedListing.imageUrl ? (
                  <img
                    src={selectedListing.imageUrl}
                    alt={selectedListing.title || '(Tanpa judul)'}
                    className={styles.modalImage}
                  />
                ) : (
                  <div className={styles.modalImagePlaceholder}>🖼️</div>
                )}
                <div className={styles.modalConfidenceTag}>
                  Confidence: {Math.round(selectedListing.confidenceScore * 100)}%
                </div>
                <button className={styles.modalCloseCircle} onClick={() => setSelectedListing(null)}>
                  <X size={16} />
                </button>
              </div>

              {/* Right Column: Detailed Info */}
              <div className={styles.modalRightColumn}>
                <h2 className={styles.modalTitle}>{selectedListing.title || '(Tanpa judul)'}</h2>

                {/* Price Display Block */}
                <div className={styles.modalPriceBlock}>
                  {selectedListing.actualPriceAmount !== null ? (
                    (() => {
                      const scaledPrice = selectedListing.actualPriceAmount >= 100 && selectedListing.actualPriceAmount <= 9999
                        ? selectedListing.actualPriceAmount * 1000
                        : selectedListing.actualPriceAmount;
                      return (
                        <div className={styles.modalActualPrice}>
                          <span className={styles.modalPriceHeading}>Harga Deteksi AI</span>
                          <span className={styles.modalPriceVal}>
                            Rp {scaledPrice.toLocaleString('id-ID')}
                          </span>
                          {selectedListing.isPriceFake && selectedListing.listedPrice && (
                            <span className={styles.modalRawPriceText}>
                              Harga Listed Facebook: {overrideCurrencyToRupiah(selectedListing.listedPrice)}
                            </span>
                          )}
                        </div>
                      );
                    })()
                  ) : selectedListing.listedPrice ? (
                    <div className={styles.modalListedOnlyPrice}>
                      <span className={styles.modalPriceHeading}>Harga Terdaftar</span>
                      <span className={styles.modalPriceVal}>{overrideCurrencyToRupiah(selectedListing.listedPrice)}</span>
                    </div>
                  ) : (
                    <span className={styles.modalPriceVal}>Hubungi Penjual</span>
                  )}
                </div>

                {/* Info List Items */}
                <div className={styles.modalDetailsList}>
                  <div className={styles.modalDetailItem}>
                    <div className={styles.modalItemHeader}>
                      <MapPin size={14} className={styles.modalItemIcon} />
                      <span className={styles.modalItemLabel}>Lokasi</span>
                    </div>
                    <span className={styles.modalItemValue}>{selectedListing.location || '-'}</span>
                  </div>

                  <div className={styles.modalDetailItem}>
                    <div className={styles.modalItemHeader}>
                      <Package size={14} className={styles.modalItemIcon} />
                      <span className={styles.modalItemLabel}>Kondisi</span>
                    </div>
                    <span className={styles.modalItemValue}>{selectedListing.condition || '-'}</span>
                  </div>

                  <div className={styles.modalDetailItem}>
                    <div className={styles.modalItemHeader}>
                      <User size={14} className={styles.modalItemIcon} />
                      <span className={styles.modalItemLabel}>Penjual</span>
                    </div>
                    <span className={styles.modalItemValue}>
                      {selectedListing.sellerUrl ? (
                        <a
                          href={formatExternalUrl(selectedListing.sellerUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.sellerLink}
                        >
                          {selectedListing.seller || 'Buka Profil Penjual'}
                        </a>
                      ) : (
                        selectedListing.seller || '-'
                      )}
                    </span>
                  </div>

                  <div className={styles.modalDetailItem}>
                    <div className={styles.modalItemHeader}>
                      <Clock size={14} className={styles.modalItemIcon} />
                      <span className={styles.modalItemLabel}>Diposting</span>
                    </div>
                    <span className={styles.modalItemValue}>{selectedListing.postedAt || '-'}</span>
                  </div>
                </div>

                {/* Flags/Tags section */}
                {(selectedListing.isBarter || selectedListing.isTradeIn || selectedListing.isNett) && (
                  <div className={styles.modalFlags}>
                    {selectedListing.isBarter && <span className={styles.flagPillBarter}>🔄 Barter</span>}
                    {selectedListing.isTradeIn && <span className={styles.flagPillTrade}>↔️ Tukar Tambah</span>}
                    {selectedListing.isNett && <span className={styles.flagPillNett}>🔒 Nett</span>}
                  </div>
                )}

                {/* AI Detected Terms Keywords */}
                {selectedListing.detectedKeywords && selectedListing.detectedKeywords.length > 0 && (
                  <div className={styles.modalKeywordsSection}>
                    <h4 className={styles.modalSectionTitle}>Istilah Terdeteksi AI</h4>
                    <div className={styles.modalKeywordsGrid}>
                      {selectedListing.detectedKeywords.map((kw, i) => {
                        const IconComponent = CATEGORY_ICONS[kw.category] || Sparkles;
                        return (
                          <div key={i} className={styles.keywordCard} title={kw.meaning}>
                            <IconComponent size={12} className={styles.keywordIcon} />
                            <span className={styles.keywordTerm}>{kw.term}</span>
                            <span className={styles.keywordDivider}>:</span>
                            <span className={styles.keywordMeaning}>{kw.meaning}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Detailed Description */}
                <div className={styles.modalDescSection}>
                  <h4 className={styles.modalSectionTitle}>Deskripsi Lengkap</h4>
                  <p className={styles.modalDescText}>
                    {selectedListing.description || '(Tidak ada deskripsi dari penjual)'}
                  </p>
                </div>

                {/* Primary Redirect Action */}
                <div className={styles.modalActions}>
                  {getWhatsAppLink(selectedListing.title, selectedListing.description) && (
                    <a
                      href={getWhatsAppLink(selectedListing.title, selectedListing.description)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.whatsappBtn}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ marginRight: '6px' }}>
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.459h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                      <span>Hub WA</span>
                    </a>
                  )}

                  <a
                    href={selectedListing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.primaryRedirectBtn}
                  >
                    <span>Buka di Facebook Marketplace</span>
                    <ExternalLink size={14} />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
