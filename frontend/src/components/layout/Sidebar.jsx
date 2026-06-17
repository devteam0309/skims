import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FolderOpen, Banknote, FileText, BarChart3,
  Activity, Users, Bell, ChevronDown, ChevronRight, LogOut,
  BookOpen, Target, CreditCard, ClipboardList, Globe, UserCircle,
  TrendingUp, Megaphone, Shield,
} from 'lucide-react';
import useAuthStore from '../../store/authStore';
import { ROLE_LABELS } from '../../utils/constants';
import { getInitials } from '../../utils/formatters';
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
      { to: '/users', icon: Users, label: 'User Management', roles: ['super_admin', 'provincial_admin', 'municipal_admin'] },
      { to: '/audit-logs', icon: Shield, label: 'Audit Logs', roles: ['super_admin', 'provincial_admin', 'municipal_admin'] },
    ],
  },
];

export default function Sidebar({ isOpen, onClose }) {
  const { user, logout } = useAuthStore();
  const location = useLocation();

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
      {/* Mobile overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-20 lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-navy-900 text-white z-30 flex flex-col transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-navy-800">
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-white flex-shrink-0">
            <img src="/main_logo.jfif" alt="SKIMS" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="font-bold text-white text-sm leading-tight">SKIMS</div>
            <div className="text-navy-400 text-xs">Marinduque, Philippines</div>
          </div>
        </div>

        {/* User info */}
        {/* <div className="px-4 py-3 border-b border-navy-800">
          <NavLink to="/profile" className="flex items-center gap-3 hover:bg-navy-800 rounded-lg p-2 transition-colors">
            <div className="w-9 h-9 rounded-full bg-gold-500 flex items-center justify-center flex-shrink-0">
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
              ) : (
                <span className="text-navy-900 font-bold text-sm">
                  {getInitials(user?.firstName, user?.lastName)}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="text-xs text-navy-400 truncate">
                {ROLE_LABELS[user?.role]}
              </div>
            </div>
          </NavLink>
        </div> */}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {filteredGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-1.5 text-xs font-semibold text-navy-500 uppercase tracking-widest">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => window.innerWidth < 1024 && onClose()}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                        isActive
                          ? 'bg-gold-500 text-navy-900 shadow-md'
                          : 'text-navy-300 hover:bg-navy-800 hover:text-white'
                      }`
                    }
                  >
                    <item.icon size={17} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="px-3 py-4 border-t border-navy-800 space-y-1">
          <a href="/portal" target="_blank" rel="noreferrer"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:bg-navy-800 hover:text-white transition-all">
            <Globe size={17} />
            Public Portal
          </a>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-navy-300 hover:bg-red-900 hover:text-white transition-all"
          >
            <LogOut size={17} />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
