import { Link } from 'react-router-dom';
import { LayoutDashboard, LogIn, LogOut } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import { homeFor, homeLabelFor } from '../../utils/constants';
import { confirm } from '../../utils/confirm';

const SECTIONS = [
  ['#programs', 'Programs'],
  ['#budget', 'Budget'],
  ['#announcements', 'Announcements'],
];

/*
 * Light-only by design: this is the province's public face rather than part of the signed-in app,
 * and it renders before any theme preference is known.
 */
export default function PublicLayout({ children }) {
  const { isAuthenticated, user, logout } = useAuthStore();

  const handleLogout = async () => {
    const result = await confirm.logout();
    if (result.isConfirmed) logout();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* The dashboard has had a skip link since the accessibility baseline landed; the public
          side, which has more repeated header links than the app does, had none. */}
      <a href="#portal-content" className="skip-to-content">Skip to content</a>

      <header className="bg-navy-900 text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link to="/portal" className="flex items-center gap-3">
            {/* alt="" because the wordmark beside it already says SKIMS — otherwise a screen
                reader announces the name twice in a row. */}
            <span className="h-10 w-10 overflow-hidden rounded-lg bg-white">
              <img src="/main_logo.jfif" alt="" className="h-full w-full object-contain" />
            </span>
            <span>
              <span className="block text-lg font-bold leading-tight">SKIMS</span>
              {/* navy-300 on navy-900 sits under AA; navy-200 is the value the register header
                  was corrected to for the same reason. */}
              <span className="block text-xs text-navy-200">Sangguniang Kabataan — Marinduque</span>
            </span>
          </Link>

          <nav aria-label="Portal sections" className="hidden items-center gap-6 text-sm md:flex">
            <Link to="/portal" className="text-navy-200 transition-colors hover:text-white">Home</Link>
            {SECTIONS.map(([href, label]) => (
              <a key={href} href={href} className="text-navy-200 transition-colors hover:text-white">{label}</a>
            ))}
          </nav>

          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              {/*
                * Resolved per role rather than hard-coded to /dashboard. A youth may not open the
                * staff dashboard, so the old link bounced them off it and back to their own pages —
                * only reachable at all since the youth nav gained a link into this portal.
                */}
              <Link
                to={homeFor(user?.role)}
                className="flex items-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400"
              >
                <LayoutDashboard size={15} aria-hidden="true" />
                {homeLabelFor(user?.role)}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-2 rounded-lg border border-navy-600 px-4 py-2 text-sm font-semibold text-navy-200 transition-colors hover:bg-navy-800 hover:text-white"
              >
                <LogOut size={15} aria-hidden="true" />
                Sign Out
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400"
            >
              <LogIn size={15} aria-hidden="true" />
              Login
            </Link>
          )}
        </div>
      </header>

      <main id="portal-content">{children}</main>

      <footer className="mt-16 bg-navy-900 py-8 text-white">
        <div className="mx-auto max-w-7xl px-4 text-center">
          <p className="text-sm text-navy-200">
            © {new Date().getFullYear()} SKIMS — Sangguniang Kabataan Integrated Program and Fund Management System
          </p>
          <p className="mt-1 text-xs text-navy-300">Marinduque, Philippines</p>
        </div>
      </footer>
    </div>
  );
}
