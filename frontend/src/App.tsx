import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import styles from './App.module.css';

const NAV_ITEMS = [
  { to: '/search', label: 'Search', icon: '🔍' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  return (
    <BrowserRouter>
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

        {/* ── Main Content ──────────────────────────────────── */}
        <main className={styles.main}>
          <Routes>
            <Route path="/" element={<Navigate to="/search" replace />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
