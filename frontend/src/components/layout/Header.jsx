import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Bell, Search, Sun, Moon, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { notificationService } from '../../services/documentService';
import useAuthStore from '../../store/authStore';
import { getRelativeTime } from '../../utils/formatters';
import { ROLE_LABELS } from '../../utils/constants';

export default function Header({ onMenuClick }) {
  const { user } = useAuthStore();
  const [showNotifs, setShowNotifs] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');

  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationService.getUnreadCount().then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: notifsData } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => notificationService.getAll({ limit: 5, isRead: false }).then((r) => r.data),
    enabled: showNotifs,
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  const unreadCount = unreadData?.data?.count || 0;

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 lg:px-6 h-16 flex items-center justify-between sticky top-0 z-10 shadow-sm">
      {/* Left */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Menu size={20} />
        </button>

        {/* Search */}
        <div className="hidden md:flex items-center gap-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 w-72">
          <Search size={16} className="text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder="Search programs, documents..."
            className="bg-transparent text-sm outline-none flex-1 text-gray-600 dark:text-gray-300 placeholder-gray-400"
          />
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        {/* Dark mode toggle */}
        <button
          onClick={() => setDark(!dark)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowNotifs(!showNotifs)}
            className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {showNotifs && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl z-50"
              >
                <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Notifications</h3>
                  <Link to="/notifications" onClick={() => setShowNotifs(false)}
                    className="text-xs text-navy-700 hover:underline">View all</Link>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifsData?.data?.length ? (
                    notifsData.data.map((n) => (
                      <div key={n._id} className="p-3 border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{n.title}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{getRelativeTime(n.createdAt)}</p>
                      </div>
                    ))
                  ) : (
                    <div className="py-8 text-center text-gray-400 text-sm">No new notifications</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User menu */}
        <Link to="/profile" className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <div className="w-8 h-8 rounded-full bg-navy-900 flex items-center justify-center">
            <span className="text-gold-500 text-xs font-bold">
              {(user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')}
            </span>
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{ROLE_LABELS[user?.role]}</p>
          </div>
        </Link>
      </div>
    </header>
  );
}
