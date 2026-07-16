import { BrowserRouter, useLocation, NavLink, Navigate } from 'react-router-dom';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import styles from './App.module.css';

const NAV_ITEMS = [
  { to: '/search', label: 'Search', icon: '🔍' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

/** Inner app mounts all pages but hides inactive ones via CSS.
 *  This keeps React state (results, query, SSE) alive across tab switches. */
function AppInner() {
  const { pathname } = useLocation();

  return (
    <div className={styles.layout}>
      {/* ── Sidebar ───────────────────────────────────────── */}
      <aside className={styles.sidebar}>
        {/* Logo */}
        <div className={styles.logo}>
          <span className={styles.logoIcon}>🛒</span>
          <div>
            <div className={styles.logoTitle}>Marketplace AI</div>
            <div className={styles.logoSub}>Smart Search</div>
          </div>
        </div>

        {/* Nav */}
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className={styles.sidebarFooter}>
          <span className={styles.versionTag}>v1.0.0</span>
          <span className={styles.footerNote}>Personal use only</span>
        </div>
      </aside>

      {/* ── Main Content — always mounted, hidden via CSS ── */}
      <main className={styles.main}>
        {/* Redirect root to /search */}
        {pathname === '/' && <Navigate to="/search" replace />}

        {/* SearchPage: always mounted, hidden when not active */}
        <div style={{ display: pathname.startsWith('/search') ? 'contents' : 'none' }}>
          <SearchPage />
        </div>

        {/* SettingsPage: always mounted, hidden when not active */}
        <div style={{ display: pathname.startsWith('/settings') ? 'contents' : 'none' }}>
          <SettingsPage />
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
