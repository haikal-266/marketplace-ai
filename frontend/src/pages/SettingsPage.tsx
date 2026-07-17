import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Link, 
  Download, 
  Database, 
  BookOpen, 
  Trash2, 
  Plus, 
  Filter,
  DollarSign,
  Package,
  RefreshCw,
  Sparkles,
  Truck,
  ShieldCheck,
  Bookmark,
  ToggleLeft,
  ToggleRight,
  HelpCircle,
  AlertTriangle,
  Play,
  ChevronDown,
  ChevronUp,
  Check
} from 'lucide-react';
import { authApi, scraperApi, dictionaryApi, listingsApi } from '../services/api';
import type { AuthStatus, DictionaryTerm } from '../types';
import styles from './SettingsPage.module.css';

const CATEGORIES = [
  { value: 'pricing', label: 'Pricing', icon: DollarSign },
  { value: 'condition', label: 'Condition', icon: Package },
  { value: 'trade', label: 'Trade', icon: RefreshCw },
  { value: 'urgency', label: 'Urgency', icon: Sparkles },
  { value: 'delivery', label: 'Delivery', icon: Truck },
  { value: 'warranty', label: 'Warranty', icon: ShieldCheck },
  { value: 'other', label: 'Other', icon: Bookmark },
];

export default function SettingsPage() {
  // Auth state
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isPollingAuth, setIsPollingAuth] = useState(false);

  // Dictionary state
  const [terms, setTerms] = useState<DictionaryTerm[]>([]);
  const [termsLoading, setTermsLoading] = useState(true);
  const [newTerm, setNewTerm] = useState({ term: '', meaning: '', category: 'pricing' });
  const [addingTerm, setAddingTerm] = useState(false);
  const [termError, setTermError] = useState(false);
  const [meaningError, setMeaningError] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');


  // Export state
  const [exporting, setExporting] = useState(false);

  // ── Auth ──
  const fetchAuthStatus = useCallback(async () => {
    try {
      const status = await authApi.status();
      setAuthStatus(status);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Gagal cek status');
    }
  }, []);

  useEffect(() => { fetchAuthStatus(); }, [fetchAuthStatus]);

  // Poll auth status saat login flow berjalan
  useEffect(() => {
    if (!isPollingAuth) return;
    const interval = setInterval(async () => {
      try {
        const status = await authApi.status();
        setAuthStatus(status);
        if (status.loginState === 'success' || status.loginState === 'failed' || status.loginState === 'idle') {
          setIsPollingAuth(false);
          setAuthLoading(false);
          if (status.loginState === 'failed') {
            setAuthError('Login gagal atau timeout. Coba lagi.');
          }
        }
      } catch { setIsPollingAuth(false); setAuthLoading(false); }
    }, 2000);
    return () => clearInterval(interval);
  }, [isPollingAuth]);

  const handleConnect = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await authApi.connect();
      setIsPollingAuth(true);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Gagal membuka browser login');
      setAuthLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Hapus koneksi Facebook? Kamu perlu login lagi untuk scraping.')) return;
    try {
      await authApi.disconnect();
      await fetchAuthStatus();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Gagal disconnect');
    }
  };

  // ── Dictionary ──
  const fetchTerms = useCallback(async () => {
    setTermsLoading(true);
    try {
      const data = await dictionaryApi.getAll({ activeOnly: false });
      setTerms(data);
    } catch { /* ignore */ }
    finally { setTermsLoading(false); }
  }, []);

  useEffect(() => { fetchTerms(); }, [fetchTerms]);

  const handleAddTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    
    let hasError = false;
    if (!newTerm.term.trim()) {
      setTermError(true);
      hasError = true;
    } else {
      setTermError(false);
    }
    
    if (!newTerm.meaning.trim()) {
      setMeaningError(true);
      hasError = true;
    } else {
      setMeaningError(false);
    }
    
    if (hasError) return;
    
    setAddingTerm(true);
    try {
      await dictionaryApi.create(newTerm);
      setNewTerm({ term: '', meaning: '', category: 'pricing' });
      setTermError(false);
      setMeaningError(false);
      await fetchTerms();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal menambah istilah');
    } finally {
      setAddingTerm(false);
    }
  };

  const handleToggleTerm = async (term: DictionaryTerm) => {
    try {
      await dictionaryApi.update(term.id, { isActive: !term.isActive });
      await fetchTerms();
    } catch { /* ignore */ }
  };

  const handleDeleteTerm = async (term: DictionaryTerm) => {
    if (!confirm(`Hapus istilah "${term.term}"?`)) return;
    try {
      await dictionaryApi.delete(term.id);
      await fetchTerms();
    } catch { /* ignore */ }
  };

  const handleDeleteAllListings = async () => {
    if (!confirm('Hapus semua data listing yang tersimpan di database? Tindakan ini tidak bisa dibatalkan.')) return;
    try {
      await listingsApi.deleteAll();
      alert('Semua data listing berhasil dihapus.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal menghapus data.');
    }
  };

  // ── Export Database ──
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const link = document.createElement('a');
      link.href = '/api/listings/export';
      link.download = 'marketplace_listings_export.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      alert('Gagal mengekspor data');
    } finally {
      setExporting(false);
    }
  };

  const filteredTerms = filterCategory
    ? terms.filter((t) => t.category === filterCategory)
    : terms;

  const loginStateLabel: Record<string, string> = {
    idle: '',
    waiting_user: 'Menunggu login...',
    detecting: 'Mendeteksi session...',
    success: 'Login berhasil!',
    failed: 'Login gagal',
  };

  return (
    <div className={styles.page}>
      {/* Page Header */}
      <header className={styles.header}>
        <h1 className={styles.pageTitle}>Pengaturan Sistem</h1>
        <p className={styles.pageSubtitle}>Kelola integrasi Facebook, kamus pendeteksi AI, dan database.</p>
      </header>

      {/* Bento Layout sections */}
      <div className={styles.bentoLayout}>
        {/* Bento Card 1: Facebook Connection */}
        <section className={`${styles.bentoBox} ${styles.connectionBox}`}>
          <div className={styles.boxHeader}>
            <Link size={16} className={styles.boxIcon} />
            <h2 className={styles.boxTitle}>Koneksi Facebook</h2>
          </div>
          
          <div className={styles.authCard}>
            {authStatus ? (
              <div className={styles.authStatus}>
                <div className={styles.statusRow}>
                  <div className={`${styles.statusDot} ${authStatus.isConnected ? styles.statusDotGreen : styles.statusDotRed}`} />
                  <span className={styles.statusText}>
                    {authStatus.isConnected
                      ? authStatus.isSessionLikelyValid
                        ? 'Terkoneksi (Session Aktif)'
                        : 'Terkoneksi (Session Expired)'
                      : 'Belum Terkoneksi'
                    }
                  </span>
                </div>
                {authStatus.loginState !== 'idle' && (
                  <div className={styles.loginStateMsg}>
                    {loginStateLabel[authStatus.loginState]}
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.skeletonLine} />
            )}

            {authError && (
              <div className={styles.errorMsg}>
                <AlertTriangle size={14} />
                <span>{authError}</span>
              </div>
            )}

            <div className={styles.authActions}>
              {!authStatus?.isConnected ? (
                <button
                  className={styles.primaryBtn}
                  onClick={handleConnect}
                  disabled={authLoading}
                  id="btn-connect-facebook"
                >
                  {authLoading ? 'Membuka Browser...' : 'Hubungkan Facebook'}
                </button>
              ) : (
                <button
                  className={styles.dangerBtn}
                  onClick={handleDisconnect}
                  id="btn-disconnect-facebook"
                >
                  Disconnect Akun
                </button>
              )}
            </div>

            <div className={styles.infoNote}>
              <HelpCircle size={14} className={styles.infoIcon} />
              <p>Facebook cookies akan terenkripsi dan disimpan di backend Anda. Tidak pernah diteruskan ke client browser.</p>
            </div>
          </div>
        </section>

        {/* Bento Card 2: Export Database */}
        <section className={`${styles.bentoBox} ${styles.exportBox}`}>
          <div className={styles.boxHeader}>
            <Download size={16} className={styles.boxIcon} />
            <h2 className={styles.boxTitle}>Ekspor Data</h2>
          </div>

          <div className={styles.exportContent}>
            <p className={styles.exportDesc}>
              Unduh seluruh data hasil pencarian/scraping dari database PostgreSQL Anda langsung ke format tabel Excel (CSV).
            </p>
            <button
              className={styles.primaryBtn}
              onClick={handleExportExcel}
              disabled={exporting}
              id="btn-export-excel"
            >
              <Download size={14} />
              <span>{exporting ? 'Mengekspor...' : 'Ekspor Database ke Excel'}</span>
            </button>
          </div>
        </section>

        {/* Bento Card 3: Kelola Data */}
        <section className={`${styles.bentoBox} ${styles.dataBox}`}>
          <div className={styles.boxHeader}>
            <Database size={16} className={styles.boxIcon} />
            <h2 className={styles.boxTitle}>Manajemen Database</h2>
          </div>
          <div className={styles.dataContent}>
            <p className={styles.dataDesc}>
              Kosongkan semua data listings hasil scraping dari database PostgreSQL Anda secara permanen.
            </p>
            <button
              className={styles.dangerBtnOutline}
              onClick={handleDeleteAllListings}
              id="btn-clear-listings"
            >
              <Trash2 size={14} />
              <span>Hapus Seluruh Hasil Scraping</span>
            </button>
          </div>
        </section>

        {/* Bento Card 4: Dictionary */}
        <section className={`${styles.bentoBox} ${styles.dictionaryBox}`}>
          <div className={styles.boxHeader}>
            <BookOpen size={16} className={styles.boxIcon} />
            <h2 className={styles.boxTitle}>Kamus Istilah Marketplace</h2>
          </div>

          <p className={styles.dictionaryDesc}>
            Kata kunci yang ditambahkan di sini akan digunakan oleh pipeline AI untuk normalisasi & klasifikasi.
          </p>

          {/* Add Term Form */}
          <form className={styles.addTermForm} onSubmit={handleAddTerm} noValidate>
            <div className={styles.formFieldsRow}>
              <div className={`${styles.inputWrapper} ${styles.termInputWrapper}`}>
                <input
                  className={`${styles.input} ${termError ? styles.inputError : ''}`}
                  type="text"
                  placeholder="BU, TT, BT..."
                  value={newTerm.term}
                  onChange={(e) => {
                    setNewTerm((p) => ({ ...p, term: e.target.value }));
                    if (e.target.value.trim()) setTermError(false);
                  }}
                />
                {termError && (
                  <div className={styles.errorTooltip}>
                    <AlertTriangle size={12} />
                    <span>Wajib diisi</span>
                  </div>
                )}
              </div>
              
              <div className={`${styles.inputWrapper} ${styles.meaningInputWrapper}`}>
                <input
                  className={`${styles.input} ${meaningError ? styles.inputError : ''}`}
                  type="text"
                  placeholder="Arti (misal: Butuh Uang)"
                  value={newTerm.meaning}
                  onChange={(e) => {
                    setNewTerm((p) => ({ ...p, meaning: e.target.value }));
                    if (e.target.value.trim()) setMeaningError(false);
                  }}
                />
                {meaningError && (
                  <div className={styles.errorTooltip}>
                    <AlertTriangle size={12} />
                    <span>Wajib diisi</span>
                  </div>
                )}
              </div>

              <button
                type="submit"
                className={styles.addButtonSquare}
                disabled={addingTerm}
                id="btn-add-term"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className={styles.categorySliderSection}>
              <div className={styles.categorySliderLabel}>Pilih Kategori Istilah:</div>
              <div className={styles.categorySlider}>
                {CATEGORIES.map((c) => {
                  const IconComponent = c.icon;
                  const isSelected = newTerm.category === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      className={`${styles.categorySliderTab} ${isSelected ? styles.categorySliderTabActive : ''}`}
                      onClick={() => setNewTerm((p) => ({ ...p, category: c.value }))}
                    >
                      <IconComponent size={12} className={styles.categoryTabIcon} />
                      <span>{c.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </form>

          {/* Dictionary Filtering */}
          <div className={styles.dictionaryFilterBar}>
            <div className={styles.filterTitleRow}>
              <Filter size={12} className={styles.filterIcon} />
              <span className={styles.termsCount}>{filteredTerms.length} kata terdaftar</span>
            </div>
            <div className={styles.categoryFilters}>
              <button
                className={`${styles.filterTab} ${!filterCategory ? styles.filterTabActive : ''}`}
                onClick={() => setFilterCategory('')}
              >
                Semua
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  className={`${styles.filterTab} ${filterCategory === c.value ? styles.filterTabActive : ''}`}
                  onClick={() => setFilterCategory(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Terms List Grid */}
          {termsLoading ? (
            <div className={styles.termsGrid}>
              <div className={styles.skeletonItem} />
              <div className={styles.skeletonItem} />
              <div className={styles.skeletonItem} />
            </div>
          ) : (
            <div className={styles.termsGrid}>
              {filteredTerms.map((term) => {
                const catInfo = CATEGORIES.find((c) => c.value === term.category);
                const CatIcon = catInfo?.icon || Bookmark;
                return (
                  <div key={term.id} className={`${styles.termItem} ${!term.isActive ? styles.termInactive : ''}`}>
                    <div className={styles.termInfo}>
                      <code className={styles.termWord}>{term.term}</code>
                      <span className={styles.termMeaning}>{term.meaning}</span>
                    </div>
                    
                    <div className={styles.termActions}>
                      <span className={styles.categoryLabel} title={catInfo?.label}>
                        <CatIcon size={12} />
                      </span>
                      
                      <button
                        className={styles.iconActionBtn}
                        onClick={() => handleToggleTerm(term)}
                        title={term.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      >
                        {term.isActive ? (
                          <ToggleRight size={20} className={styles.activeToggle} />
                        ) : (
                          <ToggleLeft size={20} className={styles.inactiveToggle} />
                        )}
                      </button>

                      <button
                        className={styles.iconActionBtnDanger}
                        onClick={() => handleDeleteTerm(term)}
                        title="Hapus Istilah"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
