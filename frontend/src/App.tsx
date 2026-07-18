import { BrowserRouter, useLocation, NavLink, Navigate } from 'react-router-dom';
import { Search, Settings, FileText } from 'lucide-react';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';

const NAV_ITEMS = [
  { to: '/search', label: 'Search', icon: Search },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function AppInner() {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen md:h-screen w-screen overflow-y-auto md:overflow-hidden bg-bg-primary text-text-primary flex md:flex-row flex-col">
      {/* ── Sidebar (Desktop Only) ── */}
      <aside className="w-[240px] bg-bg-secondary border-r border-border-subtle flex flex-col fixed top-0 left-0 h-screen z-50 p-6 hidden md:flex">
        {/* Logo */}
        <div className="flex items-center gap-3 pb-6 border-b border-border-subtle mb-6">
          <img src="/icon.svg" className="w-6 h-6 shrink-0 rounded" alt="Logo" />
          <div className="flex flex-col">
            <div className="text-sm font-bold text-text-primary tracking-tight">Marketplace AI</div>
            <div className="text-[10px] text-text-secondary font-semibold">Smart Search</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-2 flex-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg text-text-secondary text-[13px] font-medium transition-all hover:bg-bg-tertiary hover:text-text-primary hover:border-border-subtle border border-transparent ${
                    isActive ? "bg-accent-primary/10 text-text-primary border-accent-primary" : ""
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`transition-colors ${isActive ? 'text-text-primary' : 'text-info'}`} size={18} />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('generate-report-click'))}
            className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-secondary text-[13px] font-medium transition-all hover:bg-bg-tertiary hover:text-text-primary hover:border-border-subtle border border-transparent cursor-pointer text-left w-full"
          >
            <FileText className="text-info" size={18} />
            <span>Laporan</span>
          </button>
        </nav>

        {/* Footer */}
        <div className="flex pt-4 border-t border-border-subtle">
          <span className="text-[10px] font-mono text-text-muted bg-bg-tertiary border border-border-subtle rounded px-1.5 py-0.5">v1.0.0</span>
        </div>
      </aside>

      {/* ── Bottom Navigation (Mobile Only) ── */}
      <nav className="flex md:hidden fixed bottom-0 left-0 right-0 h-16 bg-bg-glass backdrop-blur-md border-t border-border-subtle z-50 flex-row justify-around items-center px-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 text-text-secondary text-[10px] font-medium transition-colors py-2 px-4 ${
                  isActive ? "text-text-primary" : ""
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={20} className={`transition-colors ${isActive ? 'text-accent-primary' : 'text-info'}`} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('generate-report-click'))}
          className="flex flex-col items-center gap-1 text-text-secondary text-[10px] font-medium transition-colors py-2 px-4 cursor-pointer bg-transparent border-none"
        >
          <FileText size={20} className="text-info" />
          <span>Laporan</span>
        </button>
      </nav>

      {/* ── Main Content ── */}
      <main className="md:ml-[240px] ml-0 flex-1 flex flex-col p-6 h-auto max-h-none overflow-visible md:h-screen md:max-h-screen md:overflow-hidden pb-24 md:pb-6">
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
