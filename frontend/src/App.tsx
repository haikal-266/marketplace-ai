import { BrowserRouter, useLocation, NavLink, Navigate } from 'react-router-dom';
import { Search, Settings } from 'lucide-react';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import styles from './App.module.css';

const NAV_ITEMS = [
  { to: '/search', label: 'Search', icon: Search },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function AppInner() {
  const { pathname } = useLocation();

  return (
    <div className={styles.layout}>
      {/* ── Sidebar (Desktop Only) ── */}
      <aside className={styles.sidebar}>
        {/* Logo */}
        <div className={styles.logo}>
          <div className={styles.logoIconContainer}>
            <span className={styles.logoBullet}></span>
          </div>
          <div className={styles.logoText}>
            <div className={styles.logoTitle}>Marketplace AI</div>
            <div className={styles.logoSub}>Smart Search</div>
          </div>
        </div>

        {/* Nav */}
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
                }
              >
                <Icon className={styles.navIcon} size={18} />
                <span className={styles.navLabel}>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={styles.sidebarFooter}>
          <span className={styles.versionTag}>v1.0.0</span>
        </div>
      </aside>

      {/* ── Bottom Navigation (Mobile Only) ── */}
      <nav className={styles.bottomNav}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `${styles.bottomNavItem} ${isActive ? styles.bottomNavItemActive : ''}`
              }
            >
              <Icon size={20} className={styles.bottomNavIcon} />
              <span className={styles.bottomNavLabel}>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* ── Main Content ── */}
      <main className={styles.main}>
        {pathname === '/' && <Navigate to="/search" replace />}

        <div style={{ display: pathname.startsWith('/search') ? 'contents' : 'none' }}>
          <SearchPage />
        </div>

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
