import { Link, NavLink } from 'react-router-dom';
import { LogOut, CalendarCheck, UserRound, Landmark } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';

/*
 * The signed-in surface for a youth member.
 *
 * Deliberately not DashboardLayout: that carries the staff sidebar — budgets, expenses,
 * liquidations, documents, reports — none of which a youth may open. Rendering it and hiding the
 * links would leave a nav that mostly disappears, and would rely on presentation for something the
 * API already enforces. This is the small surface that matches what the role can actually do.
 */
const LINKS = [
  ['/my/programs', 'Programs', CalendarCheck],
  ['/my/profile', 'My details', UserRound],
  /*
   * The transparency portal, reachable from inside the youth shell rather than only from the
   * signed-out site. It is NOT reproduced here: the portal and every /api/public/* endpoint are
   * open to anyone, so a second copy inside an authenticated layout would be two implementations
   * of identical views over identical data, and the second would drift.
   *
   * This is what replaced the `public_user` role. That account existed to see this page, and
   * granted nothing an anonymous visitor did not already have.
   */
  ['/portal', 'Transparency', Landmark],
];

export default function YouthLayout({ children }) {
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    const result = await confirm.logout();
    if (result.isConfirmed) logout();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <a href="#youth-content" className="skip-to-content">Skip to content</a>

      <header className="bg-navy-900 text-white shadow-lg">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link to="/my/programs" className="flex items-center gap-3">
            <span className="h-10 w-10 overflow-hidden rounded-lg bg-white">
              <img src="/main_logo.jfif" alt="" className="h-full w-full object-contain" />
            </span>
            <span>
              <span className="block text-lg font-bold leading-tight">SKIMS</span>
              <span className="block text-xs text-navy-200">
                {user?.municipality?.name ? `${user.municipality.name} — Youth` : 'Youth member'}
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <nav aria-label="Youth sections" className="flex items-center gap-1">
              {LINKS.map(([to, label, Icon]) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-navy-700 text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white'
                  }`}
                >
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </NavLink>
              ))}
            </nav>

            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-navy-200 transition-colors hover:bg-navy-800 hover:text-white"
            >
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main id="youth-content" className="mx-auto max-w-5xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
