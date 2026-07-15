import { useState, useEffect, useCallback } from 'react';
import { authApi, scraperApi, dictionaryApi } from '../services/api';
import type { AuthStatus, DictionaryTerm } from '../types';
import styles from './SettingsPage.module.css';

const CATEGORIES = [
  { value: 'pricing', label: '💰 Pricing' },
  { value: 'condition', label: '📦 Condition' },
  { value: 'trade', label: '🔄 Trade' },
  { value: 'urgency', label: '⚡ Urgency' },
  { value: 'delivery', label: '🚚 Delivery' },
  { value: 'warranty', label: '🛡️ Warranty' },
  { value: 'other', label: '📌 Other' },
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
  const [filterCategory, setFilterCategory] = useState('');

  // Scrape test state
  const [testQuery, setTestQuery] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);

  // ── Auth ─────────────────────────────────────────────────────────────────
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

  // ── Dictionary ───────────────────────────────────────────────────────────
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
    if (!newTerm.term.trim() || !newTerm.meaning.trim()) return;
    setAddingTerm(true);
    try {
      await dictionaryApi.create(newTerm);
      setNewTerm({ term: '', meaning: '', category: 'pricing' });
      await fetchTerms();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gagal menambah istilah');
    } finally { setAddingTerm(false); }
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

  // ── Test Scrape ──────────────────────────────────────────────────────────
  const handleTestScrape = async () => {
    if (!testQuery.trim()) return;
    setTestLoading(true);
    setTestStatus('Memulai scraping...');
    try {
      await scraperApi.start({ query: testQuery, count: 10, headless: true });
      const poll = setInterval(async () => {
        const status = await scraperApi.status();
        if (status.status === 'done') {
          clearInterval(poll);
          setTestStatus(`✅ Selesai! ${status.totalFound ?? 0} listing ditemukan.`);
          setTestLoading(false);
        } else if (status.status === 'failed') {
          clearInterval(poll);
          setTestStatus(`❌ Gagal: ${status.error}`);
          setTestLoading(false);
        }
      }, 3000);
    } catch (err) {
      setTestStatus(`❌ ${err instanceof Error ? err.message : 'Error'}`);
      setTestLoading(false);
    }
  };

  const filteredTerms = filterCategory
    ? terms.filter((t) => t.category === filterCategory)
    : terms;

  const loginStateLabel: Record<string, string> = {
    idle: '',
    waiting_user: '⏳ Menunggu login...',
    detecting: '🔍 Mendeteksi session...',
    success: '✅ Login berhasil!',
    failed: '❌ Login gagal',
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>⚙️ Settings</h1>
        <p>Kelola koneksi Facebook, kamus istilah, dan pengaturan lainnya.</p>
      </div>

      <div className={styles.sections}>
        {/* ── Facebook Connection ────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>🔗 Koneksi Facebook</h2>
          <div className={styles.authCard}>
            {authStatus ? (
              <div className={styles.authStatus}>
                <div className={styles.statusRow}>
                  <div className={`${styles.statusDot} ${authStatus.isConnected ? styles.statusDotGreen : styles.statusDotRed}`} />
                  <span className={styles.statusText}>
                    {authStatus.isConnected
                      ? authStatus.isSessionLikelyValid
                        ? 'Terkoneksi (session aktif)'
                        : 'Terkoneksi (session mungkin expired)'
                      : 'Belum terkoneksi'
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
              <div className="skeleton" style={{ height: 24, width: 200 }} />
            )}

            {authError && (
              <div className={styles.errorMsg}>⚠️ {authError}</div>
            )}

            <div className={styles.authActions}>
              {!authStatus?.isConnected ? (
                <button
                  className="btn btn-primary"
                  onClick={handleConnect}
                  disabled={authLoading}
                  id="btn-connect-facebook"
                >
                  {authLoading ? <><span className="spinner" /> Membuka browser...</> : '🔑 Login Facebook'}
                </button>
              ) : (
                <button
                  className="btn btn-danger"
                  onClick={handleDisconnect}
                  id="btn-disconnect-facebook"
                >
                  Disconnect
                </button>
              )}
            </div>

            <div className={styles.authNote}>
              <strong>Cara kerja:</strong> Klik Login Facebook → browser akan terbuka → login seperti biasa →
              cookies tersimpan terenkripsi di database. Cookies tidak pernah dikirim ke browser kamu.
            </div>
          </div>
        </section>

        {/* ── Test Scraping ──────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>🕷 Test Scraping</h2>
          <div className={styles.testCard}>
            <div className={styles.testRow}>
              <input
                className="input"
                type="text"
                placeholder="Keyword test (contoh: iphone)"
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-secondary"
                onClick={handleTestScrape}
                disabled={testLoading || !testQuery.trim() || !authStatus?.isConnected}
                id="btn-test-scrape"
              >
                {testLoading ? <span className="spinner" /> : 'Test'}
              </button>
            </div>
            {testStatus && (
              <div className={styles.testStatus}>{testStatus}</div>
            )}
            {!authStatus?.isConnected && (
              <div className={styles.testNote}>⚠️ Login Facebook terlebih dahulu untuk test scraping.</div>
            )}
          </div>
        </section>

        {/* ── Dictionary ─────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>📖 Kamus Marketplace Indonesia</h2>
          <p className={styles.sectionDesc}>
            Tambah istilah baru yang akan otomatis terdeteksi di pipeline. Perubahan langsung efektif.
          </p>

          {/* Add Term Form */}
          <form className={styles.addTermForm} onSubmit={handleAddTerm}>
            <input
              className="input"
              type="text"
              placeholder="Istilah (BU, TT, Nett...)"
              value={newTerm.term}
              onChange={(e) => setNewTerm((p) => ({ ...p, term: e.target.value }))}
              required
              style={{ width: 140 }}
            />
            <input
              className="input"
              type="text"
              placeholder="Arti istilah"
              value={newTerm.meaning}
              onChange={(e) => setNewTerm((p) => ({ ...p, meaning: e.target.value }))}
              required
              style={{ flex: 1 }}
            />
            <select
              className="input"
              value={newTerm.category}
              onChange={(e) => setNewTerm((p) => ({ ...p, category: e.target.value }))}
              style={{ width: 150 }}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={addingTerm}
              id="btn-add-term"
            >
              {addingTerm ? <span className="spinner" /> : '+ Tambah'}
            </button>
          </form>

          {/* Filter */}
          <div className={styles.termsFilter}>
            <span className={styles.termsCount}>{filteredTerms.length} istilah</span>
            <div className={styles.categoryFilters}>
              <button
                className={`btn btn-sm ${!filterCategory ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilterCategory('')}
              >
                Semua
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  className={`btn btn-sm ${filterCategory === c.value ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFilterCategory(c.value)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Terms Table */}
          {termsLoading ? (
            <div className={styles.termsGrid}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 44, borderRadius: 'var(--radius-md)' }} />
              ))}
            </div>
          ) : (
            <div className={styles.termsGrid}>
              {filteredTerms.map((term) => (
                <div key={term.id} className={`${styles.termItem} ${!term.isActive ? styles.termInactive : ''}`}>
                  <div className={styles.termMain}>
                    <code className={styles.termWord}>{term.term}</code>
                    <span className={styles.termMeaning}>{term.meaning}</span>
                  </div>
                  <div className={styles.termActions}>
                    <span className={`badge badge-muted`} style={{ fontSize: 10 }}>
                      {CATEGORIES.find((c) => c.value === term.category)?.label ?? term.category}
                    </span>
                    <button
                      className={`btn btn-ghost btn-sm`}
                      onClick={() => handleToggleTerm(term)}
                      title={term.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                    >
                      {term.isActive ? '✅' : '⭕'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDeleteTerm(term)}
                      title="Hapus"
                      style={{ color: 'var(--color-danger)' }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
