import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FolderOpen, Banknote, FileText,
  Activity, Users, Bell, LogOut,
  Target, CreditCard, ClipboardList, Globe,
  TrendingUp, Megaphone, Shield, ExternalLink,
} from 'lucide-react';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';

const navGroups = [
  {
    label: 'Main',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/notifications', icon: Bell, label: 'Notifications' },
    ],
  },
  {
    label: 'Programs',
    items: [
      { to: '/programs', icon: Target, label: 'Programs' },
      { to: '/monitoring', icon: Activity, label: 'Monitoring' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/budgets', icon: Banknote, label: 'Budgets' },
      { to: '/expenses', icon: CreditCard, label: 'Expenses' },
      { to: '/liquidations', icon: ClipboardList, label: 'Liquidations' },
    ],
  },
  {
    label: 'Records',
    items: [
      { to: '/documents', icon: FolderOpen, label: 'Documents' },
      { to: '/youth', icon: Users, label: 'Youth Registry' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', icon: FileText, label: 'Reports' },
      { to: '/analytics', icon: TrendingUp, label: 'Analytics' },
    ],
  },
  {
    label: 'Admin',
    roles: ['super_admin', 'provincial_admin', 'municipal_admin', 'sk_chairperson', 'sk_secretary'],
    items: [
      { to: '/announcements', icon: Megaphone, label: 'Announcements', roles: ['super_admin', 'provincial_admin', 'municipal_admin', 'sk_chairperson', 'sk_secretary'] },
      { to: '/users', icon: Users, label: 'User Management', roles: ['super_admin'] },
      { to: '/audit-logs', icon: Shield, label: 'Audit Logs', roles: ['super_admin'] },
    ],
  },
];

export default function Sidebar({ isOpen, onClose }) {
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    const result = await confirm.logout();
    if (result.isConfirmed) logout();
  };

  const filteredGroups = navGroups
    .filter((g) => !g.roles || g.roles.includes(user?.role))
    .map((g) => ({ ...g, items: g.items.filter((item) => !item.roles || item.roles.includes(user?.role)) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-20 bg-gray-900/50 lg:hidden"
            onClick={onClose}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      <aside
        className={`fixed left-0 top-0 z-30 flex h-full w-64 flex-col bg-navy-900 text-white transition-transform duration-300 lg:static lg:z-auto lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 border-b border-navy-800 px-5 py-4">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white">
            <img src="/main_logo.jfif" alt="" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight text-white">SKIMS</div>
            {/* navy-400 rather than navy-500: the old value sat at roughly 2.9:1 against the
                navy-900 panel, below the 4.5:1 needed for text this size. */}
            <div className="truncate text-xs text-navy-300">Marinduque, Philippines</div>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {filteredGroups.map((group) => (
            <div key={group.label}>
              {/*
                Group headings were navy-500 on navy-900 — about 2.9:1, well under AA for
                small uppercase text, so the structure they provide was barely perceptible.
              */}
              <h2 className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-widest text-navy-300">
                {group.label}
              </h2>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={() => window.innerWidth < 1024 && onClose()}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-gold-500 text-navy-900'
                            : 'text-navy-200 hover:bg-navy-800 hover:text-white'
                        }`
                      }
                    >
                      {/* NavLink sets aria-current="page" itself, so the active state is
                          conveyed to assistive tech and not by colour alone. */}
                      <item.icon size={17} aria-hidden="true" className="shrink-0" />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="space-y-1 border-t border-navy-800 px-3 py-4">
          <a
            href="/portal"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-navy-200 transition-colors hover:bg-navy-800 hover:text-white"
          >
            <Globe size={17} aria-hidden="true" className="shrink-0" />
            <span className="flex-1">Public Portal</span>
            {/* This link opens a new tab. Previously nothing signalled that, so the back button
                appearing dead was the first the user knew of it. */}
            <ExternalLink size={13} aria-hidden="true" className="shrink-0 text-navy-400" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-navy-200 transition-colors hover:bg-red-900/70 hover:text-white"
          >
            <LogOut size={17} aria-hidden="true" className="shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
