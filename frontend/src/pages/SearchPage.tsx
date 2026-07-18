import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Search,
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
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { searchApi, scraperApi, listingsApi } from '../services/api';
import type { SearchResult, SearchOptions, Listing } from '../types';
import ListingCard, { hasMinus, overrideCurrencyToRupiah } from '../components/ListingCard/ListingCard';
import ReportModal from '../components/ReportModal/ReportModal';

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

const loadHtml2Pdf = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if ((window as any).html2pdf) {
      resolve((window as any).html2pdf);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    script.onload = () => resolve((window as any).html2pdf);
    script.onerror = (e) => reject(e);
    document.head.appendChild(script);
  });
};

/** Key untuk menyimpan session terakhir di localStorage */
const SESSION_KEY = 'marketplace_last_session';

interface SavedSession {
  query: string;
  sortBy: SearchOptions['sortBy'];
  minPrice: string;
  maxPrice: string;
  locations: string[];
  isBarter: boolean | undefined;
  isOpenNego: boolean | undefined;
  isNoMinus: boolean | undefined;
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session: SavedSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch { }
}

export default function SearchPage() {
  // Baca saved session untuk initial state — agar filter tersimpan saat refresh
  const _saved = loadSession();

  const [query, setQuery] = useState(_saved?.query ?? '');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [customAlert, setCustomAlert] = useState<{
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    title?: string;
  } | null>(null);
  const [showReportConfirm, setShowReportConfirm] = useState(false);
  const [showDescriptionWarning, setShowDescriptionWarning] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const restoredRef = useRef(false);
  // Ref mirrors isMonitoring so filter effects can read current value without it as a dependency
  const isMonitoringRef = useRef(false);
  useEffect(() => { isMonitoringRef.current = isMonitoring; }, [isMonitoring]);
  // Ref for latest results so stopMonitoring can access current live state
  const resultsRef = useRef<SearchResult | null>(null);
  useEffect(() => { resultsRef.current = results; }, [results]);
  // Ref for query so callbacks can read latest without stale closure
  const queryRef = useRef(query);
  useEffect(() => { queryRef.current = query; }, [query]);

  // Filters — diinisialisasi dari saved session jika ada
  const [sortBy, setSortBy] = useState<SearchOptions['sortBy']>(_saved?.sortBy ?? 'relevance');
  const [minPrice, setMinPrice] = useState(_saved?.minPrice ?? '');
  const [maxPrice, setMaxPrice] = useState(_saved?.maxPrice ?? '');
  const [locations, setLocations] = useState<string[]>(_saved?.locations ?? []);
  const [locationInput, setLocationInput] = useState('');
  const [isBarter, setIsBarter] = useState<boolean | undefined>(_saved?.isBarter);
  const [isOpenNego, setIsOpenNego] = useState<boolean | undefined>(_saved?.isOpenNego);
  const [isNoMinus, setIsNoMinus] = useState<boolean | undefined>(_saved?.isNoMinus);
  const [isNoService, setIsNoService] = useState<boolean | undefined>(undefined);
  const [completenessFilter, setCompletenessFilter] = useState<'all' | 'fullset' | 'unit_only'>('all');
  const [connectivityFilter, setConnectivityFilter] = useState<'all' | 'all_operator' | 'wifi_only'>('all');

  // Custom Select state
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Auto-restore: query DB saat page dimuat jika ada saved session ──────────
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const saved = loadSession();
    if (!saved?.query) return;

    // Ada session tersimpan — langsung ambil data dari DB (tanpa scraping)
    setScrapeStatus('Memuat data sesi terakhir dari database...');
    setLoading(true);

    const opts: SearchOptions = {
      q: saved.query,
      sortBy: saved.sortBy ?? 'relevance',
      page: 1,
      limit: 100,
      location: saved.locations?.join(',') || undefined,
      minPrice: saved.minPrice ? Number.parseInt(saved.minPrice, 10) : undefined,
      maxPrice: saved.maxPrice ? Number.parseInt(saved.maxPrice, 10) : undefined,
      isBarter: saved.isBarter,
    };

    searchApi.search(opts)
      .then((data) => {
        setResults(data);
        setScrapeStatus(`Sesi terakhir dipulihkan: "${saved.query}" (${data.total} listing dari database)`);
      })
      .catch(() => {
        setScrapeStatus(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const stopMonitoring = useCallback(() => {
    // Immediately update UI state — do not await stop API (would block UI for seconds)
    setIsMonitoring(false);
    setScrapeStatus('Monitoring dihentikan.');
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    // Fire-and-forget: signal backend to stop listing discovery
    scraperApi.stop().catch(() => {});
    // NOTE: We intentionally do NOT re-query the DB here.
    // Live results in memory are preserved as-is after stop.
    // The filter useEffect will sync with DB next time the user changes a filter.
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

    // Simpan session ke localStorage agar bisa di-restore saat refresh
    saveSession({ query: q, sortBy, minPrice, maxPrice, locations, isBarter, isOpenNego, isNoMinus });

    // 1. Ambil data dari database dulu
    try {
      const opts: SearchOptions = {
        q,
        sortBy,
        page: 1,
        limit: 100,
        excludeFakePrice: undefined,
        location: locations.join(',') || undefined,
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
        city: locations[0] || '', // Gunakan kota pertama untuk scraping FB
        minPrice: minPrice ? Number.parseInt(minPrice, 10) : undefined,
        maxPrice: maxPrice ? Number.parseInt(maxPrice, 10) : undefined,
        allowedLocations: locations.length > 0 ? locations : undefined
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
        setScrapeStatus('Semua produk terserap. Menunggu deskripsi selesai dimuat...');
        setCustomAlert({
          title: 'Data Habis Terserap',
          message: 'Semua produk di Facebook Marketplace sudah habis terserap! Sistem masih memuat deskripsi produk yang tampil...',
          type: 'warning'
        });
      } else if (data.status === 'facebook_blocked') {
        setScrapeStatus('Facebook Marketplace tidak tersedia untuk akun ini.');
        setCustomAlert({
          title: 'Akses Terblokir',
          message: 'Akun Facebook yang terhubung tidak memiliki akses ke Marketplace (Restricted / Blokir). Silakan hubungkan ulang dengan akun lain.',
          type: 'error'
        });
        setIsMonitoring(false);
        sse.close();
      }
    });

    sse.addEventListener('listing', (e) => {
      const newListing = JSON.parse(e.data) as any;

      let pass = true;

      // Filter out listings that are completely unrelated to the query (e.g. from Facebook feed redirects or recommended listings)
      const activeQ = queryRef.current.trim().toLowerCase();
      if (activeQ) {
        const qTokens = activeQ.split(/\s+/).filter(t => t.length >= 2);
        if (qTokens.length > 0) {
          const titleLower = (newListing.title || '').toLowerCase();
          const descLower = (newListing.description || '').toLowerCase();
          const match = qTokens.some(t => {
            if (titleLower.includes(t) || descLower.includes(t)) return true;
            if (t.length > 4) {
              let commonChars = 0;
              for (let i = 0; i < t.length; i++) {
                if (titleLower.includes(t[i])) commonChars++;
              }
              if (commonChars >= t.length - 2) return true;
            }
            return false;
          });
          if (!match) pass = false;
        }
      }

      const actPrice = newListing.actualPriceAmount;
      if (minPrice && (actPrice === null || actPrice === undefined || actPrice < Number.parseInt(minPrice, 10))) pass = false;
      if (maxPrice && (actPrice === null || actPrice === undefined || actPrice > Number.parseInt(maxPrice, 10))) pass = false;
      if (locations.length > 0) {
        const match = locations.some(loc => newListing.location && newListing.location.toLowerCase().indexOf(loc.toLowerCase()) !== -1);
        if (!match) pass = false;
      }

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
      } else {
        setResults((prev) => {
          if (!prev) return null;
          const index = prev.items.findIndex((i) => i.id === newListing.id);
          if (index !== -1) {
            return {
              ...prev,
              total: Math.max(0, prev.total - 1),
              items: prev.items.filter((i) => i.id !== newListing.id)
            };
          }
          return prev;
        });
      }
    });

    sse.onerror = () => {
      if (isMonitoringRef.current) {
        setScrapeStatus('Koneksi live terputus.');
        setIsMonitoring(false);
      }
      sse.close();
    };

  }, [query, sortBy, locations, minPrice, maxPrice, isBarter, isMonitoring, stopMonitoring]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') startMonitoring();
  };

  const handleLocationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = locationInput.trim();
      if (val) {
        if (!locations.includes(val)) {
          setLocations([...locations, val]);
        }
        setLocationInput('');
      }
    }
  };

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

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || window.innerWidth < 768) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [results]);

  const filteredItems = useMemo(() => {
    if (!results) return [];
    return results.items.filter((item) => {
      if (minPrice) {
        const min = Number.parseInt(minPrice, 10);
        if (item.actualPriceAmount !== null && item.actualPriceAmount < min) return false;
      }
      if (maxPrice) {
        const max = Number.parseInt(maxPrice, 10);
        if (item.actualPriceAmount !== null && item.actualPriceAmount > max) return false;
      }
      if (locations.length > 0) {
        if (!item.location) return false;
        const match = locations.some(loc => item.location!.toLowerCase().indexOf(loc.toLowerCase()) !== -1);
        if (!match) return false;
      }
      if (isBarter) {
        if (!item.isBarter && !item.isTradeIn) return false;
      }
      if (isOpenNego) {
        if (item.isNett === true) return false;
      }
      if (isNoMinus) {
        if (hasMinus(item.title || '', item.description || '')) return false;
      }
      return true;
    });
  }, [results, minPrice, maxPrice, locations, isBarter, isOpenNego, isNoMinus]);

  // Automatically query database on filter change (only when NOT actively scraping)
  // IMPORTANT: isMonitoring is NOT in the dependency array so this does NOT fire when stop is clicked.
  // isMonitoringRef is used to read the current value without triggering the effect.
  useEffect(() => {
    if (isMonitoringRef.current) return;
    const activeQuery = results?.query || '';
    if (!activeQuery) return;

    const delayDebounce = setTimeout(() => {
      if (isMonitoringRef.current) return; // double-check after debounce
      const opts: SearchOptions = {
        q: activeQuery,
        sortBy,
        page: 1,
        limit: 100,
        location: locations.join(',') || undefined,
        minPrice: minPrice ? Number.parseInt(minPrice, 10) : undefined,
        maxPrice: maxPrice ? Number.parseInt(maxPrice, 10) : undefined,
        isBarter: isBarter,
      };

      setLoading(true);
      searchApi.search(opts)
        .then((data) => {
          // Merge: preserve any descriptions/data already in live results that DB doesn't have yet
          setResults((prev) => {
            if (!prev) return data;
            const dbById = new Map(data.items.map(i => [i.id, i]));
            const merged = prev.items.map(liveItem => {
              const dbItem = dbById.get(liveItem.id);
              if (!dbItem) return liveItem; // not in DB yet, keep live
              // Prefer live description if DB still empty
              return {
                ...dbItem,
                description: dbItem.description || liveItem.description,
              };
            });
            // Add DB items that weren't in live state
            const liveIds = new Set(prev.items.map(i => i.id));
            data.items.forEach(dbItem => {
              if (!liveIds.has(dbItem.id)) merged.push(dbItem);
            });
            return { ...data, items: merged, total: merged.length };
          });
        })
        .catch((err) => {
          console.error('Failed to query DB on filter change:', err);
        })
        .finally(() => {
          setLoading(false);
        });
    }, 400);

    return () => clearTimeout(delayDebounce);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, minPrice, maxPrice, locations, isBarter, isOpenNego, isNoMinus, results?.query]);
  // ^ isMonitoring intentionally excluded — use isMonitoringRef instead

  const handlePriceChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void
  ) => {
    const input = e.target;
    const selectionEnd = input.selectionEnd || 0;
    const originalLength = input.value.length;
    const rawVal = input.value.replace(/\D/g, '');

    setter(rawVal);

    requestAnimationFrame(() => {
      const newFormatted = formatInputPrice(rawVal);
      const lengthDifference = newFormatted.length - originalLength;
      let newPosition = selectionEnd + lengthDifference;
      newPosition = Math.max(0, Math.min(newFormatted.length, newPosition));
      input.setSelectionRange(newPosition, newPosition);
    });
  };

  useEffect(() => {
    const handleReportTrigger = () => {
      if (!results || filteredItems.length === 0) {
        setCustomAlert({
          title: 'Belum Ada Data',
          message: 'Harap lakukan pencarian produk terlebih dahulu sebelum membuat laporan.',
          type: 'warning'
        });
        return;
      }
      setShowReportConfirm(true);
    };

    window.addEventListener('generate-report-click', handleReportTrigger);
    return () => window.removeEventListener('generate-report-click', handleReportTrigger);
  }, [results, filteredItems]);

  const handleConfirmReportClick = () => {
    setShowReportConfirm(false);
    const hasLoadingDesc = filteredItems.some(item => !item.description);
    if (hasLoadingDesc) {
      setShowDescriptionWarning(true);
    } else {
      handleGenerateReport();
    }
  };

  const handleGenerateReport = async () => {
    setShowReportConfirm(false);
    setShowDescriptionWarning(false);
    setGeneratingReport(true);

    let aiData: { macroSummary: string; briefSpecs?: string[]; recommendations: { id: string; recommendation: string; isRedFlag: boolean }[] } | null = null;

    let aiConfig = undefined;
    try {
      const savedConfig = localStorage.getItem('marketplace_ai_config');
      if (savedConfig) {
        aiConfig = JSON.parse(savedConfig);
      }
    } catch (e) {
      console.error('Failed to load AI config from local storage', e);
    }

    try {
      // Call backend API to analyze report using AI Config
      const response = await listingsApi.analyzeReport(query, filteredItems, aiConfig);
      if (response.isAi && response.data) {
        aiData = response.data;
      }
    } catch (err) {
      console.error('Failed to get AI report analysis, falling back to local analyzer', err);
    }

    try {
      const html2pdf = await loadHtml2Pdf();

      const totalItems = filteredItems.length;
      const itemsWithPrice = filteredItems.filter(item => item.actualPriceAmount !== null && item.actualPriceAmount !== undefined);
      const averagePrice = itemsWithPrice.length > 0
        ? Math.round(itemsWithPrice.reduce((sum, item) => sum + item.actualPriceAmount!, 0) / itemsWithPrice.length)
        : 0;

      const needsCheckCount = filteredItems.filter(item =>
        hasMinus(item.title || '', item.description || '') ||
        item.isPriceFake ||
        (item.confidenceScore < 0.7)
      ).length;


      let aiSummary = '';
      if (aiData?.macroSummary) {
        aiSummary = aiData.macroSummary;
      } else {
        const isHighFake = filteredItems.filter(item => item.isPriceFake).length > (totalItems * 0.3);
        const hasManyMinuses = needsCheckCount > (totalItems * 0.4);

        aiSummary = `Mayoritas listing untuk "${query}" terpantau berada dalam kondisi wajar dengan rata-rata harga pasar Rp ${averagePrice.toLocaleString('id-ID')}. `;
        if (isHighFake) {
          aiSummary += `Ditemukan banyak listing dengan indikasi harga palsu atau DP (down payment). Calon pembeli disarankan berhati-hati dan selalu mengonfirmasi harga asli sebelum transaksi. `;
        } else {
          aiSummary += `Skor deteksi harga menunjukkan kestabilan harga yang cukup konsisten di pasar. `;
        }

        if (hasManyMinuses) {
          aiSummary += `Sebagian besar barang (${needsCheckCount} dari ${totalItems} item) memiliki catatan minus atau kerusakan tertentu. Pastikan untuk melakukan cek fisik secara teliti.`;
        } else {
          aiSummary += `Sebagian besar listing berada dalam kondisi prima tanpa minus berarti, menjadikannya pilihan yang aman untuk dibeli.`;
        }
      }

      let briefSpecsHtml = '';
      if (aiData?.briefSpecs && aiData.briefSpecs.length > 0) {
        const specItems = aiData.briefSpecs.map(spec => `<li>${spec}</li>`).join('');
        briefSpecsHtml = `
          <section class="brief-specs-container">
            <div class="specs-title">Spesifikasi Singkat Produk</div>
            <ul class="specs-list">
              ${specItems}
            </ul>
          </section>
        `;
      }

      const formatRp = (priceStr: string | null | undefined) => {
        if (!priceStr) return '-';
        return overrideCurrencyToRupiah(priceStr);
      };

      const isAiActive = !!aiData;
      const recLabel = isAiActive ? 'Rekomendasi AI' : 'Rekomendasi';

      const itemsHtml = filteredItems.map((item, index) => {
        const scaledPrice = item.actualPriceAmount !== null && item.actualPriceAmount !== undefined
          ? (item.actualPriceAmount >= 100 && item.actualPriceAmount <= 9999
            ? item.actualPriceAmount * 1000
            : item.actualPriceAmount)
          : null;

        const hasMin = hasMinus(item.title || '', item.description || '');
        const isFake = item.isPriceFake;
        const isBtr = item.isBarter || item.isTradeIn;

        const titleText = item.title || '';
        const descText = item.description || '';
        const combinedText = (titleText + ' ' + descText).toLowerCase();
        
        // Red flag jika unit mati / rusak total
        const containsMatotOrMati = /\b(matot|mati)\b/i.test(combinedText) || combinedText.includes('mati total');

        let cardColorClass = '';
        if (containsMatotOrMati) {
          cardColorClass = 'red-flag';
        } else if (hasMin) {
          cardColorClass = 'minus-flag';
        }

        let recommendation = '';

        const aiRec = aiData?.recommendations?.find(r => r.id === item.id);
        if (aiRec) {
          recommendation = aiRec.recommendation;
        } else {
          if (containsMatotOrMati) {
            recommendation = 'Unit terdeteksi dalam kondisi rusak mati (MATOT). Hindari pembelian kecuali untuk keperluan kanibalan suku cadang.';
          } else if (isFake) {
            recommendation = 'Harga tertera terdeteksi tidak wajar (DP/Cicilan). Selalu negosiasikan harga riil sebelum melakukan transaksi tatap muka.';
          } else if (hasMin) {
            recommendation = 'Terdeteksi adanya minus atau kekurangan pada unit. Lakukan inspeksi fisik langsung dan ajukan penawaran harga 15% lebih rendah.';
          } else if (isBtr) {
            recommendation = 'Transaksi difokuskan untuk Tukar Tambah atau Barter. Siapkan unit Anda yang setara untuk negosiasi.';
          } else if (item.confidenceScore > 0.85) {
            recommendation = 'Listing dengan tingkat kepercayaan tinggi. Unit dilaporkan mulus dan terawat. Sangat layak untuk diprioritaskan.';
          } else {
            recommendation = 'Kondisi unit terpantau standar. Lakukan verifikasi fungsionalitas dan kelengkapan unit saat COD.';
          }
        }

        const badgesHtml = [
          hasMin ? `<span class="badge badge-minus">Minus</span>` : '',
          isFake ? `<span class="badge badge-fake">Bukan Harga Real</span>` : '',
          item.isBarter ? `<span class="badge badge-barter">Barter</span>` : '',
          item.isTradeIn ? `<span class="badge badge-barter">TT</span>` : '',
          item.isNett ? `<span class="badge badge-nett">Nett</span>` : ''
        ].filter(Boolean).join(' ');

        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(item.url)}`;

        return `
          <div class="product-item ${cardColorClass}">
            <div class="product-header">
              <div class="product-title-price">
                <span class="product-title">${index + 1}. ${item.title || '(Tanpa judul)'}</span>
                <span class="product-price">${scaledPrice !== null ? `Rp ${scaledPrice.toLocaleString('id-ID')}` : formatRp(item.listedPrice)}</span>
              </div>
              <div class="badges-row">
                ${badgesHtml || '<span class="badge badge-ok">Normal</span>'}
              </div>
            </div>
            <div class="product-body">
              <div class="product-info">
                <div class="metadata">
                  <span>Penjual: ${item.seller || 'Umum'}</span> &bull; 
                  <span>Lokasi: ${item.location || 'Tidak terdeteksi'}</span> &bull; 
                  <span>Waktu: ${item.postedAt || 'Tidak terdeteksi'}</span>
                </div>
                <div class="ai-recommendation">
                  <strong>${recLabel}:</strong> ${recommendation}
                </div>
                <div class="product-url-container">
                  <span class="url-label">Link Produk:</span>
                  <a href="${item.url}" class="product-url" target="_blank">${item.url}</a>
                </div>
              </div>
              <div class="product-qr">
                <img src="${qrUrl}" alt="QR Link" />
              </div>
            </div>
          </div>
        `;
      }).join('');

      const locationsStr = locations.length > 0 ? locations.join(', ') : 'Semua Lokasi';

      const formatIndonesianDate = (date: Date): string => {
        const months = [
          'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
          'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
        ];
        const day = date.getDate();
        const month = months[date.getMonth()];
        const year = date.getFullYear();
        return `${day} ${month} ${year}`;
      };

      const dateStr = formatIndonesianDate(new Date());
      const currentDateText = new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const element = document.createElement('div');
      element.innerHTML = `
        <style>
          .report-wrapper, .report-wrapper * {
            box-sizing: border-box;
          }
          .report-wrapper {
            font-family: 'Plus Jakarta Sans', sans-serif;
            background-color: #ffffff;
            color: #1e293b;
            line-height: 1.6;
            width: 100%;
            padding: 24px;
          }
          
          header {
            border-bottom: 2px solid #cbd5e1;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          
          .header-title {
            font-family: 'Outfit', sans-serif;
            font-size: 24px;
            font-weight: 800;
            color: #0f172a;
            margin: 0 0 8px 0;
          }
          
          .header-meta {
            font-size: 12px;
            color: #475569;
            font-weight: 500;
          }
          
          .brief-specs-container {
            background-color: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 20px;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          
          .specs-title {
            font-family: 'Outfit', sans-serif;
            font-size: 13px;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          
          .specs-list {
            margin: 0;
            padding-left: 18px;
            display: grid;
            grid-template-cols: 1fr 1fr;
            gap: 6px 20px;
          }
          
          .specs-list li {
            font-size: 12px;
            color: #334155;
            font-weight: 500;
          }
          
          .macro-summary {
            background-color: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 24px;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          
          .macro-summary-title {
            font-family: 'Outfit', sans-serif;
            font-size: 13px;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          
          .macro-summary-text {
            font-size: 12px;
            color: #334155;
            margin: 0;
            line-height: 1.6;
          }
          
          .section-title {
            font-family: 'Outfit', sans-serif;
            font-size: 14px;
            font-weight: 800;
            color: #0f172a;
            margin-bottom: 16px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          
          .product-item {
            padding: 20px 0;
            border-bottom: 1px solid #cbd5e1;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          
          .product-item.red-flag {
            border-left: 4px solid #0f172a;
            padding-left: 16px;
          }
          
          .product-item.minus-flag {
            border-left: 4px solid #64748b;
            padding-left: 16px;
          }
          
          .product-header {
            margin-bottom: 10px;
          }
          
          .product-title-price {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 20px;
          }
          
          .product-title {
            font-size: 14px;
            font-weight: 700;
            color: #0f172a;
            line-height: 1.4;
          }
          
          .product-price {
            font-size: 14px;
            font-weight: 800;
            color: #0f172a;
            white-space: nowrap;
          }
          
          .badges-row {
            display: flex;
            gap: 6px;
            margin-top: 8px;
          }
          
          .badge {
            font-size: 9px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 4px;
            text-transform: uppercase;
            background-color: #f1f5f9;
            color: #334155;
            border: 1px solid #e2e8f0;
          }
          
          .product-body {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 20px;
          }
          
          .product-info {
            flex-grow: 1;
          }
          
          .metadata {
            font-size: 10px;
            color: #64748b;
            margin-bottom: 10px;
            font-weight: 500;
          }
          
          .ai-recommendation {
            font-size: 11px;
            color: #334155;
            background-color: #f8fafc;
            padding: 8px 12px;
            border-radius: 4px;
            border-left: 3px solid #475569;
            margin-top: 6px;
            line-height: 1.5;
          }
          
          .product-url-container {
            margin-top: 8px;
            font-size: 10px;
            color: #64748b;
          }
          
          .url-label {
            font-weight: 700;
            color: #334155;
            margin-right: 4px;
          }
          
          .product-url {
            color: #1e40af;
            text-decoration: underline;
            word-break: break-all;
          }
          
          .product-qr {
            width: 60px;
            height: 60px;
            flex-shrink: 0;
            border: 1px solid #cbd5e1;
            padding: 2px;
            background: #ffffff;
          }
          
          .card-qr img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
        </style>
        <div class="report-wrapper">
          <header>
            <h1 class="header-title">Laporan Analisis Produk: "${query}"</h1>
            <div class="header-meta">
              Dibuat pada: ${currentDateText} &bull; Lokasi: ${locationsStr} &bull; 
              <strong>${totalItems} listing ditemukan</strong> &bull; 
              <strong>Rata-rata harga: Rp ${averagePrice.toLocaleString('id-ID')}</strong>
            </div>
          </header>
          
          ${briefSpecsHtml}
          
          <section class="macro-summary">
            <div class="macro-summary-title">Ringkasan Analisis Pasar</div>
            <p class="macro-summary-text">${aiSummary}</p>
          </section>
          
          <section>
            <div class="section-title">Detail Listing Barang</div>
            ${itemsHtml}
          </section>
        </div>
      `;

      const opt = {
        margin: [15, 15, 15, 15],  // top, right, bottom, left in mm
        filename: `laporan-marketplace-${query}-${dateStr}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      };

      // Create a hidden wrapper container that prevents rendering cutoff
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-9999px'; // Position far off-screen
      container.style.top = '0px';
      container.style.width = '680px';  // Must match the target element width
      container.style.height = 'auto';
      container.style.overflow = 'visible';
      container.style.zIndex = '-9999';

      // Keep element as a normal block layout child with explicit width
      element.style.position = 'relative';
      element.style.width = '680px';
      element.style.background = '#ffffff';

      container.appendChild(element);
      document.body.appendChild(container);

      await html2pdf().set(opt).from(element).save();

      document.body.removeChild(container);
    } catch (err) {
      console.error('Error generating PDF:', err);
      setCustomAlert({
        title: 'Error Pembuatan PDF',
        message: 'Gagal membuat file PDF. Silakan coba kembali.',
        type: 'error'
      });
    } finally {
      setGeneratingReport(false);
    }
  };

  const hasActiveFilters = minPrice || maxPrice || locations.length > 0 || isBarter !== undefined || isOpenNego !== undefined || isNoMinus !== undefined || sortBy !== 'relevance';

  const handleResetFilters = () => {
    setMinPrice('');
    setMaxPrice('');
    setLocations([]);
    setLocationInput('');
    setIsBarter(undefined);
    setIsOpenNego(undefined);
    setIsNoMinus(undefined);
    setSortBy('relevance');
  };

  const renderFiltersContent = () => (
    <>
      {/* Custom Dropdown Select */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Urutan</label>
        <div className="relative w-full" ref={dropdownRef}>
          <button
            type="button"
            className="w-full h-[38px] bg-bg-primary border border-border-subtle rounded-lg text-text-primary font-sans text-xs px-3 flex items-center justify-between cursor-pointer outline-none transition-colors duration-120 focus:border-accent-primary"
            onClick={() => setIsSortDropdownOpen((prev) => !prev)}
          >
            <span>{SORT_OPTIONS.find((o) => o.value === sortBy)?.label}</span>
            {isSortDropdownOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {isSortDropdownOpen && (
            <ul className="absolute top-[42px] left-0 right-0 bg-bg-secondary border border-border-normal rounded-lg shadow-lg p-1 m-0 list-none z-50 max-h-[200px] overflow-y-auto">
              {SORT_OPTIONS.map((o) => (
                <li
                  key={o.value}
                  className={`text-[13px] text-text-secondary px-3 py-2 rounded cursor-pointer flex items-center justify-between transition-all duration-120 hover:bg-bg-tertiary hover:text-text-primary ${sortBy === o.value ? 'bg-accent-primary/12 text-text-primary font-semibold' : ''
                    }`}
                  onClick={() => {
                    setSortBy(o.value as SearchOptions['sortBy']);
                    setIsSortDropdownOpen(false);
                  }}
                >
                  {o.label}
                  {sortBy === o.value && <Check size={14} className="text-accent-primary" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Min Price Custom Input */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Min Harga</label>
        <div className="relative flex items-center w-full">
          <span className="absolute left-3 text-xs font-semibold text-text-muted select-none">Rp</span>
          <input
            className="w-full h-[38px] bg-bg-primary border border-border-subtle rounded-lg text-text-primary font-sans text-xs pl-8 pr-3 outline-none transition-colors duration-120 focus:border-accent-primary"
            type="text"
            placeholder="0"
            value={formatInputPrice(minPrice)}
            onChange={(e) => handlePriceChange(e, setMinPrice)}
          />
        </div>
      </div>

      {/* Max Price Custom Input */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Max Harga</label>
        <div className="relative flex items-center w-full">
          <span className="absolute left-3 text-xs font-semibold text-text-muted select-none">Rp</span>
          <input
            className="w-full h-[38px] bg-bg-primary border border-border-subtle rounded-lg text-text-primary font-sans text-xs pl-8 pr-3 outline-none transition-colors duration-120 focus:border-accent-primary"
            type="text"
            placeholder="0"
            value={formatInputPrice(maxPrice)}
            onChange={(e) => handlePriceChange(e, setMaxPrice)}
          />
        </div>
      </div>

      {/* Location Custom Tag Input */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Lokasi</label>
        <div className="relative flex items-center bg-bg-primary border border-border-subtle rounded-lg px-3 h-[38px] w-full transition-colors focus-within:border-accent-primary overflow-hidden">
          <MapPin size={14} className="text-info opacity-70 shrink-0 mr-2" />
          <div className="flex flex-row overflow-x-auto whitespace-nowrap scrollbar-none items-center gap-1.5 flex-1 h-full py-1">
            {locations.map((loc, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-accent-tertiary/10 border border-accent-tertiary/20 rounded px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary shrink-0">
                {loc}
                <button
                  type="button"
                  className="bg-transparent border-none p-0.5 rounded-full hover:bg-accent-tertiary/20 text-text-muted hover:text-text-primary cursor-pointer shrink-0"
                  onClick={() => setLocations(locations.filter((_, idx) => idx !== i))}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              className="bg-transparent border-none outline-none text-text-primary font-sans text-xs min-w-[120px] placeholder:text-text-muted h-full flex-grow shrink-0"
              type="text"
              placeholder={locations.length === 0 ? "Semua Kota (Enter)" : ""}
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              onKeyDown={handleLocationKeyDown}
            />
          </div>
        </div>
      </div>

      {/* Custom Checkbox - Barter/TT */}
      <div className="flex flex-col gap-1.5">
        <div
          className="flex items-center gap-2 cursor-pointer select-none py-1"
          onClick={() => setIsBarter(isBarter === true ? undefined : true)}
        >
          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-120 shrink-0 ${isBarter === true ? 'border-accent-primary bg-accent-primary text-white' : 'border-border-subtle bg-bg-primary'
            }`}>
            {isBarter === true && <Check size={12} strokeWidth={3} className="text-white" />}
          </div>
          <span className="text-xs font-medium text-text-secondary">Khusus Tukar (BT / TT)</span>
        </div>
      </div>

      {/* Custom Checkbox - Open Nego */}
      <div className="flex flex-col gap-1.5">
        <div
          className="flex items-center gap-2 cursor-pointer select-none py-1"
          onClick={() => setIsOpenNego(isOpenNego === true ? undefined : true)}
        >
          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-120 shrink-0 ${isOpenNego === true ? 'border-accent-primary bg-accent-primary text-white' : 'border-border-subtle bg-bg-primary'
            }`}>
            {isOpenNego === true && <Check size={12} strokeWidth={3} className="text-white" />}
          </div>
          <span className="text-xs font-medium text-text-secondary">Bisa Nego (Open Nego)</span>
        </div>
      </div>

      {/* Custom Checkbox - No Minus */}
      <div className="flex flex-col gap-1.5">
        <div
          className="flex items-center gap-2 cursor-pointer select-none py-1"
          onClick={() => setIsNoMinus(isNoMinus === true ? undefined : true)}
        >
          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-120 shrink-0 ${isNoMinus === true ? 'border-accent-primary bg-accent-primary text-white' : 'border-border-subtle bg-bg-primary'
            }`}>
            {isNoMinus === true && <Check size={12} strokeWidth={3} className="text-white" />}
          </div>
          <span className="text-xs font-medium text-text-secondary">Tanpa Minus (No Minus)</span>
        </div>
      </div>

      {hasActiveFilters && (
        <button
          className="w-full h-8 rounded border border-border-subtle bg-transparent text-[11px] font-semibold text-text-secondary cursor-pointer transition-colors duration-120 hover:bg-bg-tertiary hover:text-text-primary"
          onClick={handleResetFilters}
        >
          Reset Semua Filter
        </button>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-4 w-full max-w-full m-0 h-auto md:h-full md:max-h-full overflow-visible md:overflow-hidden pb-20 md:pb-0">
      {/* ── Header ── */}
      <header className="flex flex-col gap-1">
        <h1 className="text-xl md:text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-text-primary to-accent-tertiary tracking-tight">Dashboard Analitik</h1>
        <p className="text-[13px] text-text-secondary">Pantau dan filter data Facebook Marketplace secara cerdas secara real-time.</p>
      </header>
      {/* ── Bento Layout Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] md:grid-rows-[auto_1fr] gap-4 items-stretch flex-1 min-h-0 overflow-visible md:overflow-hidden h-auto md:h-full">
        {/* Bento Box 1: Search Panel */}
        <section className="bg-bg-card border border-border-subtle rounded-xl flex flex-row items-center gap-3 p-4 md:px-5 md:py-4 hover:border-border-normal hover:shadow-[0_4px_20px_rgba(9,13,27,0.4)] transition-all duration-200 col-span-1 md:col-span-2 min-w-0">
          <div className="flex-1 flex items-center gap-2 bg-bg-primary border border-border-subtle rounded-lg px-3 h-11 transition-all duration-200 focus-within:border-accent-primary focus-within:shadow-[0_0_0_3px_rgba(55,98,200,0.15)] min-w-0">
            <Search className="text-info opacity-80 shrink-0" size={18} />
            <input
              ref={searchInputRef}
              id="search-input"
              className="flex-grow bg-transparent border-none outline-none text-text-primary font-sans text-sm placeholder:text-text-muted w-full min-w-0"
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
                className="bg-transparent border-none text-text-muted cursor-pointer flex items-center justify-center p-1 rounded-full transition-all duration-200 hover:bg-bg-tertiary hover:text-text-primary"
                onClick={() => { setQuery(''); setResults(null); clearSession(); searchInputRef.current?.focus(); }}
                title="Hapus"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            className={`h-11 inline-flex items-center justify-center gap-2 px-5 text-[13px] font-semibold cursor-pointer border rounded-lg whitespace-nowrap transition-all duration-200 ${isMonitoring
              ? 'bg-bg-tertiary border-border-normal text-text-primary'
              : 'bg-accent-primary border-transparent text-text-primary hover:bg-accent-secondary'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            onClick={startMonitoring}
            disabled={!query.trim()}
          >
            {isMonitoring ? (
              <>
                <Square size={14} fill="currentColor" />
                <span>Stop Search</span>
              </>
            ) : (
              <>
                <Play size={14} fill="currentColor" />
                <span>Search</span>
              </>
            )}
          </button>
        </section>

        {/* Bento Box 3: Filters (Desktop View only) */}
        <section className="bg-bg-card border border-border-subtle rounded-xl p-5 flex flex-col gap-4 hover:border-border-normal hover:shadow-[0_4px_20px_rgba(9,13,27,0.4)] transition-all duration-200 col-span-1 row-start-2 h-full overflow-hidden hidden md:flex">
          <div className="flex items-center gap-2 pb-3 border-b border-border-subtle">
            <SlidersHorizontal size={14} className="text-text-secondary" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-primary">Penyaringan Lanjutan</span>
          </div>
          <div className="flex flex-col gap-4 flex-grow overflow-y-auto pr-1 thin-scrollbar">
            {renderFiltersContent()}
          </div>
        </section>

        {/* Mobile Filter Toggle Bar (Mobile View only) */}
        <div className="flex md:hidden items-center justify-between w-full border border-border-subtle rounded-lg bg-bg-card p-3 shadow-md">
          <button
            className="relative flex items-center gap-2 text-xs font-semibold text-text-secondary bg-transparent border-none cursor-pointer py-1"
            onClick={() => setIsFilterDrawerOpen(true)}
          >
            <SlidersHorizontal size={14} />
            <span>Filter & Urutan</span>
            {hasActiveFilters && <span className="absolute top-0.5 -right-1 w-2 h-2 rounded-full bg-accent-primary shadow-[0_0_6px_rgba(55,98,200,0.5)]"></span>}
          </button>
        </div>

        {/* Bento Box 5: Main Results Container */}
        <div className="col-span-1 md:row-start-2 md:col-span-1 flex flex-col gap-3 h-auto md:h-full overflow-visible md:overflow-hidden self-start md:self-auto w-full">
          {/* Informative Stats & Active Filter Chips Bar */}
          {results && (
            <div className="flex items-center gap-3 bg-bg-card/40 border border-border-subtle/80 rounded-xl p-3 min-w-0">
              <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-bold uppercase tracking-wider text-text-secondary whitespace-nowrap">
                <span className="text-sm font-extrabold text-text-primary">{results ? filteredItems.length : 0}</span>
                <span>Listing ditemukan</span>
              </div>

              {/* Vertical Divider */}
              <div className="w-[1px] h-4 bg-border-normal shrink-0 hidden md:block"></div>

              {/* Render Active Filter Chips */}
              <div className="flex-grow flex flex-nowrap gap-1.5 overflow-x-auto whitespace-nowrap py-0.5 min-w-0 justify-start scrollbar-none hidden md:flex">
                {results && results.query && (
                  <div className="inline-flex items-center bg-bg-tertiary border border-border-subtle/60 rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-secondary" title="Pencarian Utama">
                    <span>Query: "{results.query}"</span>
                  </div>
                )}

                {sortBy !== 'relevance' && (
                  <div className="inline-flex items-center gap-1.5 bg-bg-tertiary border border-border-subtle rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:border-border-normal">
                    <span>Urutan: {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}</span>
                    <button className="bg-transparent border-none p-0.5 rounded-full hover:bg-border-normal text-text-muted hover:text-text-primary cursor-pointer" onClick={() => setSortBy('relevance')}>
                      <X size={10} />
                    </button>
                  </div>
                )}

                {minPrice && (
                  <div className="inline-flex items-center gap-1.5 bg-bg-tertiary border border-border-subtle rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:border-border-normal">
                    <span>Min: Rp {Number(minPrice).toLocaleString('id-ID')}</span>
                    <button className="bg-transparent border-none p-0.5 rounded-full hover:bg-border-normal text-text-muted hover:text-text-primary cursor-pointer" onClick={() => setMinPrice('')}>
                      <X size={10} />
                    </button>
                  </div>
                )}

                {maxPrice && (
                  <div className="inline-flex items-center gap-1.5 bg-bg-tertiary border border-border-subtle rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:border-border-normal">
                    <span>Max: Rp {Number(maxPrice).toLocaleString('id-ID')}</span>
                    <button className="bg-transparent border-none p-0.5 rounded-full hover:bg-border-normal text-text-muted hover:text-text-primary cursor-pointer" onClick={() => setMaxPrice('')}>
                      <X size={10} />
                    </button>
                  </div>
                )}

                {locations.length > 0 && (
                  <div className="inline-flex items-center gap-1.5 bg-bg-tertiary border border-border-subtle rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:border-border-normal">
                    <span>Lokasi: {locations.map(l => `"${l}"`).join(', ')}</span>
                    <button className="bg-transparent border-none p-0.5 rounded-full hover:bg-border-normal text-text-muted hover:text-text-primary cursor-pointer" onClick={() => setLocations([])}>
                      <X size={10} />
                    </button>
                  </div>
                )}

                {isBarter === true && (
                  <div className="inline-flex items-center gap-1.5 bg-bg-tertiary border border-border-subtle rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:border-border-normal">
                    <span>Khusus Tukar (BT / TT)</span>
                    <button className="bg-transparent border-none p-0.5 rounded-full hover:bg-border-normal text-text-muted hover:text-text-primary cursor-pointer" onClick={() => setIsBarter(undefined)}>
                      <X size={10} />
                    </button>
                  </div>
                )}

                {isOpenNego === true && (
                  <div className="inline-flex items-center gap-1.5 bg-bg-tertiary border border-border-subtle rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:border-border-normal">
                    <span>Bisa Nego</span>
                    <button className="bg-transparent border-none p-0.5 rounded-full hover:bg-border-normal text-text-muted hover:text-text-primary cursor-pointer" onClick={() => setIsOpenNego(undefined)}>
                      <X size={10} />
                    </button>
                  </div>
                )}

                {isNoMinus === true && (
                  <div className="inline-flex items-center gap-1.5 bg-bg-tertiary border border-border-subtle rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:border-border-normal">
                    <span>Tanpa Minus</span>
                    <button className="bg-transparent border-none p-0.5 rounded-full hover:bg-border-normal text-text-muted hover:text-text-primary cursor-pointer" onClick={() => setIsNoMinus(undefined)}>
                      <X size={10} />
                    </button>
                  </div>
                )}

                {isNoService === true && (
                  <div className="inline-flex items-center gap-1.5 bg-bg-tertiary border border-border-subtle rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:border-border-normal">
                    <span>Tanpa Servis</span>
                    <button className="bg-transparent border-none p-0.5 rounded-full hover:bg-border-normal text-text-muted hover:text-text-primary cursor-pointer" onClick={() => setIsNoService(undefined)}>
                      <X size={10} />
                    </button>
                  </div>
                )}

                {completenessFilter !== 'all' && (
                  <div className="inline-flex items-center gap-1.5 bg-bg-tertiary border border-border-subtle rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:border-border-normal">
                    <span>Kelengkapan: {completenessFilter === 'fullset' ? 'Fullset' : 'Unit Only'}</span>
                    <button className="bg-transparent border-none p-0.5 rounded-full hover:bg-border-normal text-text-muted hover:text-text-primary cursor-pointer" onClick={() => setCompletenessFilter('all')}>
                      <X size={10} />
                    </button>
                  </div>
                )}

                {connectivityFilter !== 'all' && (
                  <div className="inline-flex items-center gap-1.5 bg-bg-tertiary border border-border-subtle rounded-full px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:border-border-normal">
                    <span>Konektivitas: {connectivityFilter === 'all_operator' ? 'All Op' : 'WiFi Only'}</span>
                    <button className="bg-transparent border-none p-0.5 rounded-full hover:bg-border-normal text-text-muted hover:text-text-primary cursor-pointer" onClick={() => setConnectivityFilter('all')}>
                      <X size={10} />
                    </button>
                  </div>
                )}

                {results && results.synonymsExpanded.length > 0 && (
                  <div className="inline-flex items-center bg-accent-primary/10 border border-accent-primary/20 rounded-full px-2.5 py-1 text-[10px] font-semibold text-accent-tertiary" title="Keyword diperluas otomatis">
                    <span>Synonyms: {results.synonymsExpanded.slice(0, 2).join(', ')}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="flex-grow flex flex-col justify-center min-h-0 overflow-visible md:overflow-hidden bg-bg-card border border-border-subtle rounded-xl p-5 hover:border-border-normal hover:shadow-[0_4px_20px_rgba(9,13,27,0.4)] transition-all duration-200">
            {/* Error message banner */}
            {error && (
              <div className="flex items-center bg-[#a3988f]/10 border border-[#a3988f]/20 rounded-lg p-3 text-xs text-danger mb-4 animate-fade-in">
                <span>{error}</span>
              </div>
            )}

            {/* Loading indicator */}
            {loading && (
              <div className="relative w-full h-full overflow-hidden">
                {/* Left Fade Overlay */}
                <div className="absolute top-0 left-0 bottom-4 w-8 bg-gradient-to-r from-bg-bg-card to-transparent pointer-events-none z-10" />
                {/* Right Fade Overlay */}
                <div className="absolute top-0 right-0 bottom-4 w-8 bg-gradient-to-l from-bg-bg-card to-transparent pointer-events-none z-10" />

                <div className="grid grid-flow-col grid-rows-1 auto-cols-[310px] gap-4 overflow-x-auto overflow-y-hidden pb-4 w-full h-full max-h-[480px] thin-scrollbar">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={`skeleton-${i}`} className="bg-bg-card border border-border-subtle rounded-xl overflow-hidden flex flex-col h-full animate-pulse">
                      <div className="w-full aspect-video bg-bg-tertiary" />
                      <div className="p-4 flex flex-col gap-2">
                        <div className="h-3 w-1/4 bg-bg-tertiary rounded" />
                        <div className="h-4 w-3/4 bg-bg-tertiary rounded" />
                        <div className="h-3 w-1/2 bg-bg-tertiary rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live Monitoring Loader State */}
            {!loading && isMonitoring && filteredItems.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                <div className="relative w-16 h-16 rounded-full bg-accent-primary/10 border border-accent-primary/30 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border border-accent-primary/50 animate-ping" />
                  <Search size={32} className="text-accent-primary" />
                </div>
                <h3>Sedang Menyerap Data Live...</h3>
                <p className="text-text-secondary text-sm">{scrapeStatus || 'Menunggu data masuk dari Facebook Marketplace...'}</p>
                <div className="inline-flex items-center gap-2 bg-[#25d366]/10 border border-[#25d366]/20 rounded-full px-3 py-1 text-xs font-semibold text-[#25d366]">
                  <span className="w-2 h-2 rounded-full bg-[#25d366] animate-pulse" />
                  <span>Sistem Aktif & Memindai</span>
                </div>
              </div>
            )}

            {/* Empty State: No search query */}
            {!loading && !isMonitoring && !results && !error && (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
                <div className="w-14 h-14 rounded-full bg-bg-primary border border-border-subtle flex items-center justify-center text-text-secondary opacity-80">
                  <Search size={32} className="opacity-60" />
                </div>
                <h3>Mulai Pencarian Baru</h3>
                <p className="text-text-secondary text-sm max-w-md">Masukkan kata kunci produk di atas lalu klik Mulai Monitoring untuk menyerap data Marketplace Facebook secara langsung.</p>
              </div>
            )}

            {/* Empty State: Query has 0 results */}
            {!loading && !isMonitoring && results && filteredItems.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
                <div className="w-14 h-14 rounded-full bg-bg-primary border border-border-subtle flex items-center justify-center text-text-secondary opacity-80">
                  <SlidersHorizontal size={32} className="opacity-60" />
                </div>
                <h3>Tidak Ada Data Ditemukan</h3>
                <p className="text-text-secondary text-sm max-w-md">Tidak ada hasil yang sesuai dengan kriteria filter Anda saat ini. Coba perkecil batasan filter Anda.</p>
              </div>
            )}

            {/* Results Grid display: 1-Row Horizontal scrollable column flow */}
            {!loading && results && filteredItems.length > 0 && (
              <div className="relative w-full md:h-full overflow-visible md:overflow-hidden">
                {/* Left Fade Overlay */}
                <div className="absolute top-0 left-0 bottom-4 w-8 bg-gradient-to-r from-bg-bg-card to-transparent pointer-events-none z-10 hidden md:block" />
                {/* Right Fade Overlay */}
                <div className="absolute top-0 right-0 bottom-4 w-8 bg-gradient-to-l from-bg-bg-card to-transparent pointer-events-none z-10 hidden md:block" />

                <div
                  className="grid grid-cols-1 gap-4 overflow-visible md:grid-flow-col md:grid-rows-1 md:auto-cols-[310px] md:gap-4 md:overflow-x-auto md:overflow-y-hidden md:pb-4 smooth-scroll w-full h-auto md:h-full md:max-h-[480px] thin-scrollbar"
                  ref={scrollContainerRef}
                >
                  {filteredItems.map((listing) => (
                    <div key={listing.id} className="h-auto md:h-full w-full">
                      <ListingCard
                        listing={listing}
                        searchQuery={query}
                        isMonitoring={isMonitoring}
                        onClick={() => setSelectedListing(listing)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>



          {/* ── Mobile Filter Bottom Sheet Drawer ── */}
          {isFilterDrawerOpen && (
            <div className="fixed inset-0 bg-black/60 z-50 flex justify-end" onClick={() => setIsFilterDrawerOpen(false)}>
              <div className="w-[280px] bg-bg-secondary border-l border-border-subtle flex flex-col h-full shadow-2xl p-5 gap-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
                  <span className="text-sm font-bold text-text-primary uppercase tracking-wider">Pengaturan Filter</span>
                  <button className="bg-transparent border-none text-text-secondary hover:text-text-primary cursor-pointer" onClick={() => setIsFilterDrawerOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto flex flex-col gap-4 py-2">
                  {renderFiltersContent()}
                </div>
                <div className="pt-4 border-t border-border-subtle">
                  <button className="w-full h-10 bg-accent-primary text-text-primary rounded-lg text-xs font-bold hover:bg-accent-secondary cursor-pointer" onClick={() => setIsFilterDrawerOpen(false)}>
                    Terapkan Filter
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Detail Modal ── */}
          {selectedListing && (
            <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4" onClick={() => setSelectedListing(null)}>
              <div className="w-full max-w-4xl max-h-[90vh] bg-bg-secondary border border-border-subtle rounded-2xl overflow-y-auto md:overflow-hidden shadow-2xl animate-fade-in relative" onClick={(e) => e.stopPropagation()}>
                {/* Modal Close Button (Top Right of entire Modal) */}
                <button className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/40 border border-border-subtle flex items-center justify-center text-text-primary hover:text-white cursor-pointer transition-colors z-50 backdrop-blur" onClick={() => setSelectedListing(null)}>
                  <X size={16} />
                </button>

                {/* Modal Body */}
                <div className="flex flex-col md:flex-row h-auto md:h-full md:max-h-[85vh]">
                  {/* Left Column: Image Area */}
                  <div className="relative w-full md:w-1/2 aspect-video md:aspect-auto bg-bg-primary overflow-hidden flex items-center justify-center shrink-0">
                    {selectedListing.imageUrl ? (
                      <img
                        src={selectedListing.imageUrl}
                        alt={selectedListing.title || '(Tanpa judul)'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-5xl opacity-30">🖼️</div>
                    )}
                    <div className="absolute bottom-4 left-4 bg-black/60 border border-border-subtle text-[10px] text-text-primary font-semibold px-2 py-1 rounded backdrop-blur">
                      Confidence: {Math.round(selectedListing.confidenceScore * 100)}%
                    </div>
                  </div>

                  {/* Right Column: Detailed Info */}
                  <div className="w-full md:w-1/2 p-6 md:overflow-y-auto flex flex-col gap-5 thin-scrollbar shrink-0 md:shrink">
                    <h2 className="text-lg font-bold text-text-primary m-0 pr-8">{selectedListing.title || '(Tanpa judul)'}</h2>

                    {/* Price Display Block */}
                    <div className="bg-bg-primary/50 border border-border-subtle/80 rounded-xl p-4 flex flex-col gap-1">
                      {selectedListing.actualPriceAmount !== null ? (
                        (() => {
                          const scaledPrice = selectedListing.actualPriceAmount >= 100 && selectedListing.actualPriceAmount <= 9999
                            ? selectedListing.actualPriceAmount * 1000
                            : selectedListing.actualPriceAmount;
                          return (
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Harga Barang</span>
                              <span className="text-2xl font-black text-accent-primary">
                                Rp {scaledPrice.toLocaleString('id-ID')}
                              </span>
                              {selectedListing.isPriceFake && selectedListing.listedPrice && (
                                <span className="text-xs text-text-secondary">
                                  Harga Listed Facebook: {overrideCurrencyToRupiah(selectedListing.listedPrice)}
                                </span>
                              )}
                            </div>
                          );
                        })()
                      ) : selectedListing.listedPrice ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Harga Terdaftar</span>
                          <span className="text-2xl font-black text-accent-primary">{overrideCurrencyToRupiah(selectedListing.listedPrice)}</span>
                        </div>
                      ) : (
                        <span className="text-2xl font-black text-accent-primary font-bold">Hubungi Penjual</span>
                      )}
                    </div>

                    {/* Info List Items */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-bg-primary/30 border border-border-subtle/50 rounded-lg p-2.5 flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <MapPin size={14} className="text-info opacity-75" />
                          <span className="text-[10px] font-bold uppercase tracking-wider">Lokasi</span>
                        </div>
                        <span className="text-xs font-semibold text-text-primary">{selectedListing.location || '-'}</span>
                      </div>

                      <div className="bg-bg-primary/30 border border-border-subtle/50 rounded-lg p-2.5 flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Package size={14} className="text-info opacity-75" />
                          <span className="text-[10px] font-bold uppercase tracking-wider">Kondisi</span>
                        </div>
                        <span className="text-xs font-semibold text-text-primary">{selectedListing.condition || '-'}</span>
                      </div>

                      <div className="bg-bg-primary/30 border border-border-subtle/50 rounded-lg p-2.5 flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <User size={14} className="text-info opacity-75" />
                          <span className="text-[10px] font-bold uppercase tracking-wider">Penjual</span>
                        </div>
                        <span className="text-xs font-semibold text-text-primary">
                          {selectedListing.sellerUrl ? (
                            <a
                              href={formatExternalUrl(selectedListing.sellerUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent-primary hover:text-accent-secondary"
                            >
                              {selectedListing.seller || 'Buka Profil Penjual'}
                            </a>
                          ) : (
                            selectedListing.seller || '-'
                          )}
                        </span>
                      </div>

                      <div className="bg-bg-primary/30 border border-border-subtle/50 rounded-lg p-2.5 flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Clock size={14} className="text-info opacity-75" />
                          <span className="text-[10px] font-bold uppercase tracking-wider">Diposting</span>
                        </div>
                        <span className="text-xs font-semibold text-text-primary">{selectedListing.postedAt || '-'}</span>
                      </div>
                    </div>

                    {/* Flags/Tags section */}
                    {(selectedListing.isBarter || selectedListing.isTradeIn || selectedListing.isNett) && (
                      <div className="flex gap-2 flex-wrap">
                        {selectedListing.isBarter && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-500/10 border border-amber-500/30 text-amber-400">
                            🔄 Barter
                          </span>
                        )}
                        {selectedListing.isTradeIn && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
                            ↔️ Tukar Tambah
                          </span>
                        )}
                        {selectedListing.isNett && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-slate-500/10 border border-slate-500/30 text-slate-400">
                            🔒 Nett
                          </span>
                        )}
                      </div>
                    )}

                    {/* AI Detected Terms Keywords */}
                    {selectedListing.detectedKeywords && selectedListing.detectedKeywords.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary">Istilah Terdeteksi AI</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {selectedListing.detectedKeywords.map((kw, i) => {
                            const IconComponent = CATEGORY_ICONS[kw.category] || Sparkles;
                            return (
                              <div key={i} className="flex items-center gap-2.5 bg-bg-primary/45 border border-border-subtle/60 hover:border-border-normal rounded-lg px-3 py-2 text-xs text-text-secondary transition-all duration-150 hover:bg-bg-tertiary/30" title={kw.meaning}>
                                <IconComponent size={14} className="text-accent-primary shrink-0" />
                                <span className="font-mono font-bold text-[10px] uppercase text-text-primary bg-accent-primary/10 border border-accent-primary/20 px-1.5 py-0.5 rounded shrink-0">{kw.term}</span>
                                <span className="truncate text-text-primary/90">{kw.meaning}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Detailed Description */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary">Deskripsi Lengkap</h4>
                      <p className="text-xs text-text-secondary leading-relaxed bg-bg-primary/20 p-3 rounded-lg border border-border-subtle/40 whitespace-pre-wrap">
                        {selectedListing.description || '(Deskripsi gagal di load oleh sistem)'}
                      </p>
                    </div>


                    {/* Primary Redirect Action */}
                    <div className="flex gap-2">
                      {getWhatsAppLink(selectedListing.title, selectedListing.description) && (
                        <a
                          href={getWhatsAppLink(selectedListing.title, selectedListing.description)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 h-10 rounded-lg bg-[#25d366] text-white text-xs font-bold flex items-center justify-center transition-transform hover:scale-101 shadow-md shadow-[#25d366]/20"
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ marginRight: '6px' }}>
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.459h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                          </svg>
                          <span>Hub WA</span>
                        </a>
                      )}

                      <a
                        href={selectedListing.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 h-10 rounded-lg bg-accent-primary text-text-primary text-xs font-bold flex items-center justify-center gap-1.5 transition-transform hover:scale-101"
                      >
                        <span>Buka di FB Marketplace</span>
                        <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Custom Alert Modal ── */}
          {customAlert && (
            <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4" onClick={() => setCustomAlert(null)}>
              <div className="w-full max-w-sm bg-bg-secondary border border-border-subtle rounded-xl p-5 flex flex-col gap-4 shadow-2xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${customAlert.type === 'error' ? 'bg-danger/15 text-danger' :
                    customAlert.type === 'warning' ? 'bg-warning/15 text-accent-tertiary' :
                      customAlert.type === 'success' ? 'bg-green-500/15 text-green-500' :
                        'bg-accent-primary/15 text-accent-primary'
                    }`}>
                    <AlertTriangle size={18} />
                  </div>
                  <span className="text-sm font-bold text-text-primary">{customAlert.title || 'Pemberitahuan'}</span>
                </div>
                <div className="text-xs text-text-secondary leading-normal">
                  {customAlert.message}
                </div>
                <div className="flex justify-end">
                  <button className="h-8 px-4 bg-bg-tertiary text-text-primary border border-border-subtle rounded text-xs font-bold hover:bg-border-normal cursor-pointer" onClick={() => setCustomAlert(null)}>
                    OK
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Report Modals (Confirmation, Warning, Loading Overlay) ── */}
          <ReportModal
            showConfirm={showReportConfirm}
            showWarning={showDescriptionWarning}
            generating={generatingReport}
            itemCount={filteredItems.length}
            onConfirmClose={() => setShowReportConfirm(false)}
            onWarningClose={() => setShowDescriptionWarning(false)}
            onConfirmSubmit={handleConfirmReportClick}
            onWarningSubmit={handleGenerateReport}
          />
        </div>
      </div>
    </div>
  );
}
