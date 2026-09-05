import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Bell, Sun, Moon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { notificationService } from '../../services/documentService';
import GlobalSearch from './GlobalSearch';
import useAuthStore from '../../store/authStore';
import { getRelativeTime } from '../../utils/formatters';
import { ROLE_LABELS } from '../../utils/constants';

export default function Header({ onMenuClick }) {
  const { user } = useAuthStore();
  const [showNotifs, setShowNotifs] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');

  const bellRef = useRef(null);
  const panelRef = useRef(null);

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

  /*
   * The panel previously had no dismissal path other than clicking the bell again, so it stayed
   * open while the user carried on working and covered the top-right of every page.
   * Both refs are checked, per the portaled-dropdown rule: a click inside the panel must not
   * count as "outside" or the panel unmounts before the item's own click handler runs.
   */
  useEffect(() => {
    if (!showNotifs) return undefined;

    const onPointerDown = (e) => {
      if (bellRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setShowNotifs(false);
    };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      setShowNotifs(false);
      bellRef.current?.focus();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showNotifs]);

  const unreadCount = unreadData?.data?.count || 0;

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 lg:px-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 lg:hidden dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <Menu size={20} aria-hidden="true" />
        </button>

        <GlobalSearch />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setDark(!dark)}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        </button>

        <div className="relative">
          <button
            ref={bellRef}
            type="button"
            onClick={() => setShowNotifs((v) => !v)}
            aria-expanded={showNotifs}
            aria-haspopup="true"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            className="relative rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <Bell size={18} aria-hidden="true" />
            {unreadCount > 0 && (
              // aria-hidden: the count is already in the button's accessible name above, so
              // exposing it twice makes the control read as "Notifications 4 unread 4".
              <span
                aria-hidden="true"
                className="numeric absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {showNotifs && (
              <motion.div
                ref={panelRef}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
                  <h2 className="section-heading">Notifications</h2>
                  <Link
                    to="/notifications"
                    onClick={() => setShowNotifs(false)}
                    className="text-xs font-medium text-navy-700 hover:underline dark:text-navy-300"
                  >
                    View all
                  </Link>
                </div>
                <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-700">
                  {notifsData?.data?.length ? (
                    notifsData.data.map((n) => (
                      <li key={n._id} className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{n.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-gray-600 dark:text-gray-400">{n.message}</p>
                        <p className="meta-text mt-1">{getRelativeTime(n.createdAt)}</p>
                      </li>
                    ))
                  ) : (
                    <li className="meta-text px-4 py-8 text-center">No new notifications</li>
                  )}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Link
          to="/profile"
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-gold-500">
            {(user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')}
          </span>
          <span className="hidden sm:block">
            <span className="block text-sm font-medium leading-tight text-gray-900 dark:text-white">
              {user?.firstName} {user?.lastName}
            </span>
            <span className="meta-text">{ROLE_LABELS[user?.role]}</span>
          </span>
        </Link>
      </div>
    </header>
  );
}
