import { useState, useEffect, useCallback } from 'react';
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
  AlertTriangle
} from 'lucide-react';
import { authApi, dictionaryApi, listingsApi } from '../services/api';
import type { AuthStatus, DictionaryTerm } from '../types';

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
    <div className="flex flex-col gap-6 max-w-[900px] mx-auto pb-12 h-full overflow-y-auto pr-2 scrollbar-none">
      {/* Page Header */}
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-text-primary tracking-tight">Pengaturan Sistem</h1>
        <p className="text-[13px] text-text-secondary">Kelola integrasi Facebook, kamus pendeteksi AI, dan database.</p>
      </header>

      {/* Bento Layout sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Bento Card 1: Facebook Connection */}
        <section className="bg-bg-card border border-border-subtle rounded-xl p-5 flex flex-col gap-4 transition-colors duration-120 hover:border-border-normal col-span-1">
          <div className="flex items-center gap-2 pb-2">
            <Link size={16} className="text-info opacity-80" />
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-text-primary m-0">Koneksi Facebook</h2>
          </div>
          
          <div className="flex flex-col gap-4">
            {authStatus ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    authStatus.isConnected
                      ? 'bg-green-500 shadow-[0_0_6px_#22c55e]'
                      : 'bg-red-500 shadow-[0_0_6px_#ef4444]'
                  }`} />
                  <span className="text-[13px] font-semibold text-text-primary">
                    {authStatus.isConnected
                      ? authStatus.isSessionLikelyValid
                        ? 'Terkoneksi (Session Aktif)'
                        : 'Terkoneksi (Session Expired)'
                      : 'Belum Terkoneksi'
                    }
                  </span>
                </div>
                {authStatus.loginState !== 'idle' && (
                  <div className="text-xs text-accent-tertiary p-2 bg-bg-primary rounded border border-border-subtle">
                    {loginStateLabel[authStatus.loginState]}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-4 w-40 bg-bg-tertiary rounded animate-pulse" />
            )}

            {authError && (
              <div className="flex items-center gap-2 text-danger bg-[#a3988f]/10 border border-[#a3988f]/20 p-2 rounded text-xs">
                <AlertTriangle size={14} />
                <span>{authError}</span>
              </div>
            )}

            <div className="flex flex-col">
              {!authStatus?.isConnected ? (
                <button
                  className="h-[38px] rounded-lg text-[13px] font-semibold cursor-pointer flex items-center justify-center gap-2 transition-all duration-120 bg-accent-primary text-text-primary hover:bg-accent-secondary disabled:opacity-50"
                  onClick={handleConnect}
                  disabled={authLoading}
                  id="btn-connect-facebook"
                >
                  {authLoading ? 'Membuka Browser...' : 'Hubungkan Facebook'}
                </button>
              ) : (
                <button
                  className="h-[38px] rounded-lg text-[13px] font-semibold cursor-pointer flex items-center justify-center gap-2 transition-all duration-120 bg-bg-primary text-text-primary border border-border-normal hover:bg-bg-tertiary hover:border-border-strong"
                  onClick={handleDisconnect}
                  id="btn-disconnect-facebook"
                >
                  Disconnect Akun
                </button>
              )}
            </div>

            <div className="flex gap-2 bg-border-color/3 border border-border-subtle rounded-lg p-4">
              <HelpCircle size={14} className="text-text-secondary opacity-60 shrink-0 mt-0.5" />
              <p className="text-[11px] text-text-secondary m-0 leading-normal">Facebook cookies akan terenkripsi dan disimpan di backend Anda. Tidak pernah diteruskan ke client browser.</p>
            </div>
          </div>
        </section>

        {/* Bento Card 2: Export Database */}
        <section className="bg-bg-card border border-border-subtle rounded-xl p-5 flex flex-col gap-4 transition-colors duration-120 hover:border-border-normal col-span-1">
          <div className="flex items-center gap-2 pb-2">
            <Download size={16} className="text-info opacity-80" />
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-text-primary m-0">Ekspor Data</h2>
          </div>

          <div className="flex flex-col gap-3 flex-1 justify-between">
            <p className="text-[13px] text-text-secondary m-0 leading-relaxed">
              Unduh seluruh data hasil pencarian/scraping dari database PostgreSQL Anda langsung ke format tabel Excel (CSV).
            </p>
            <button
              className="h-[38px] rounded-lg text-[13px] font-semibold cursor-pointer flex items-center justify-center gap-2 transition-all duration-120 bg-accent-primary text-text-primary hover:bg-accent-secondary disabled:opacity-50"
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
        <section className="bg-bg-card border border-border-subtle rounded-xl p-5 flex flex-col gap-4 transition-colors duration-120 hover:border-border-normal col-span-1 md:col-span-2">
          <div className="flex items-center gap-2 pb-2">
            <Database size={16} className="text-info opacity-80" />
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-text-primary m-0">Manajemen Database</h2>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-text-secondary m-0 leading-relaxed">
              Kosongkan semua data listings hasil scraping dari database PostgreSQL Anda secara permanen.
            </p>
            <button
              className="h-[38px] rounded-lg text-[13px] font-semibold cursor-pointer flex items-center justify-center gap-2 transition-all duration-120 bg-transparent text-text-primary border border-border-subtle w-fit px-4 hover:border-border-strong hover:bg-bg-tertiary"
              onClick={handleDeleteAllListings}
              id="btn-clear-listings"
            >
              <Trash2 size={14} />
              <span>Hapus Seluruh Hasil Scraping</span>
            </button>
          </div>
        </section>

        {/* Bento Card 4: Dictionary */}
        <section className="bg-bg-card border border-border-subtle rounded-xl p-5 flex flex-col gap-4 transition-colors duration-120 hover:border-border-normal col-span-1 md:col-span-2">
          <div className="flex items-center gap-2 pb-2">
            <BookOpen size={16} className="text-info opacity-80" />
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-text-primary m-0">Kamus Istilah Marketplace</h2>
          </div>

          <p className="text-[13px] text-text-secondary m-0">
            Kata kunci yang ditambahkan di sini akan digunakan oleh pipeline AI untuk normalisasi & klasifikasi.
          </p>

          {/* Add Term Form */}
          <form className="flex flex-col gap-3 bg-bg-secondary border border-border-subtle rounded-xl p-4" onSubmit={handleAddTerm} noValidate>
            <div className="flex flex-col md:flex-row gap-2 w-full">
              <div className="relative flex flex-col w-full flex-1 md:flex-[0_0_160px]">
                <input
                  className={`w-full bg-bg-primary border rounded-md text-text-primary font-sans text-xs px-3 outline-none h-[38px] transition-colors focus:border-accent-primary ${
                    termError ? 'border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]' : 'border-border-subtle'
                  }`}
                  type="text"
                  placeholder="BU, TT, BT..."
                  value={newTerm.term}
                  onChange={(e) => {
                    setNewTerm((p) => ({ ...p, term: e.target.value }));
                    if (e.target.value.trim()) setTermError(false);
                  }}
                />
                {termError && (
                  <div className="absolute top-[42px] left-1 text-[11px] font-medium text-white bg-red-500 rounded px-2 py-1 z-50 shadow-[0_4px_12px_rgba(239,68,68,0.3)] flex items-center gap-1 pointer-events-none animate-fade-in before:content-[''] before:absolute before:bottom-full before:left-3 before:border-4 before:border-transparent before:border-b-red-500">
                    <AlertTriangle size={12} />
                    <span>Wajib diisi</span>
                  </div>
                )}
              </div>
              
              <div className="relative flex flex-col w-full flex-1">
                <input
                  className={`w-full bg-bg-primary border rounded-md text-text-primary font-sans text-xs px-3 outline-none h-[38px] transition-colors focus:border-accent-primary ${
                    meaningError ? 'border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]' : 'border-border-subtle'
                  }`}
                  type="text"
                  placeholder="Arti (misal: Butuh Uang)"
                  value={newTerm.meaning}
                  onChange={(e) => {
                    setNewTerm((p) => ({ ...p, meaning: e.target.value }));
                    if (e.target.value.trim()) setMeaningError(false);
                  }}
                />
                {meaningError && (
                  <div className="absolute top-[42px] left-1 text-[11px] font-medium text-white bg-red-500 rounded px-2 py-1 z-50 shadow-[0_4px_12px_rgba(239,68,68,0.3)] flex items-center gap-1 pointer-events-none animate-fade-in before:content-[''] before:absolute before:bottom-full before:left-3 before:border-4 before:border-transparent before:border-b-red-500">
                    <AlertTriangle size={12} />
                    <span>Wajib diisi</span>
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="h-[38px] w-full md:w-[42px] shrink-0 bg-accent-primary text-text-primary rounded-lg flex items-center justify-center cursor-pointer transition-colors duration-120 hover:bg-accent-secondary disabled:opacity-50"
                disabled={addingTerm}
                id="btn-add-term"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-text-secondary pl-0.5">Pilih Kategori Istilah:</div>
              <div className="flex gap-1.5 overflow-x-auto scrollbar-none w-full py-0.5">
                {CATEGORIES.map((c) => {
                  const IconComponent = c.icon;
                  const isSelected = newTerm.category === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      className={`inline-flex items-center gap-1.5 bg-bg-primary border text-text-secondary text-[11px] font-medium px-3 py-1.5 rounded cursor-pointer transition-all duration-120 whitespace-nowrap shrink-0 hover:text-text-primary hover:bg-bg-tertiary hover:border-border-normal ${
                        isSelected ? 'bg-accent-primary/12 text-text-primary border-accent-primary font-semibold' : 'border-border-subtle'
                      }`}
                      onClick={() => setNewTerm((p) => ({ ...p, category: c.value }))}
                    >
                      <IconComponent size={12} className={`transition-colors ${isSelected ? 'text-text-primary' : 'text-info opacity-80'}`} />
                      <span>{c.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </form>

          {/* Dictionary Filtering */}
          <div className="flex items-center justify-between border-b border-border-subtle pb-2 flex-wrap gap-3">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Filter size={12} className="opacity-70" />
              <span className="text-[11px] font-semibold">{filteredTerms.length} kata terdaftar</span>
            </div>
            <div className="flex gap-1 flex-wrap">
              <button
                className={`bg-transparent border border-transparent text-text-secondary text-[11px] font-medium px-2.5 py-1 rounded cursor-pointer transition-all duration-120 hover:text-text-primary hover:bg-bg-tertiary ${
                  !filterCategory ? 'bg-accent-primary/12 text-text-primary border-accent-primary' : ''
                }`}
                onClick={() => setFilterCategory('')}
              >
                Semua
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  className={`bg-transparent border border-transparent text-text-secondary text-[11px] font-medium px-2.5 py-1 rounded cursor-pointer transition-all duration-120 hover:text-text-primary hover:bg-bg-tertiary ${
                    filterCategory === c.value ? 'bg-accent-primary/12 text-text-primary border-accent-primary' : ''
                  }`}
                  onClick={() => setFilterCategory(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Terms List Grid */}
          {termsLoading ? (
            <div className="flex flex-col gap-2">
              <div className="h-12 bg-bg-tertiary rounded-lg animate-pulse" />
              <div className="h-12 bg-bg-tertiary rounded-lg animate-pulse" />
              <div className="h-12 bg-bg-tertiary rounded-lg animate-pulse" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredTerms.map((term) => {
                const catInfo = CATEGORIES.find((c) => c.value === term.category);
                const CatIcon = catInfo?.icon || Bookmark;
                return (
                  <div key={term.id} className={`flex items-center justify-between bg-bg-secondary border border-border-subtle rounded-lg px-4 py-3 transition-colors duration-120 hover:border-border-normal hover:bg-bg-card-hover ${
                    !term.isActive ? 'opacity-45' : ''
                  }`}>
                    <div className="flex flex-col md:flex-row items-start md:items-center gap-1.5 md:gap-4 min-w-0 flex-1">
                      <code className="font-mono text-xs font-bold text-accent-tertiary bg-accent-primary/8 border border-border-subtle px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">{term.term}</code>
                      <span className="text-[13px] text-text-primary whitespace-nowrap overflow-hidden text-ellipsis">{term.meaning}</span>
                    </div>
                    
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-bg-tertiary text-text-secondary" title={catInfo?.label}>
                        <CatIcon size={12} />
                      </span>
                      
                      <button
                        className="bg-transparent border-none cursor-pointer flex items-center justify-center p-1 rounded transition-colors duration-120 text-text-secondary"
                        onClick={() => handleToggleTerm(term)}
                        title={term.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      >
                        {term.isActive ? (
                          <ToggleRight size={20} className="text-accent-primary" />
                        ) : (
                          <ToggleLeft size={20} className="text-text-muted" />
                        )}
                      </button>

                      <button
                        className="bg-transparent border-none cursor-pointer flex items-center justify-center p-1 rounded transition-colors duration-120 text-danger opacity-60 hover:opacity-100 hover:bg-text-secondary/10"
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
