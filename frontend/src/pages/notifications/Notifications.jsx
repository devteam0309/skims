import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Trash2, CheckCircle2, AlertTriangle, Info, Clock } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { notificationService } from '../../services/documentService';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { getRelativeTime } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import { confirm } from '../../utils/confirm';

const TYPE_ICONS = {
  deadline_reminder: Clock,
  compliance_alert: AlertTriangle,
  approval_request: CheckCircle2,
  approval_granted: CheckCircle2,
  approval_rejected: AlertTriangle,
  budget_overrun: AlertTriangle,
  program_delay: Clock,
  liquidation_due: Clock,
  system: Info,
};

/*
 * Priority was carried by the left border alone. A colour with no text is invisible to anyone who
 * cannot distinguish it, and to anyone reading the page through a screen reader, so the two
 * levels that actually demand attention now say so in words as well.
 */
const PRIORITIES = {
  urgent: { border: 'border-l-red-500', label: 'Urgent', chip: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  high: { border: 'border-l-amber-500', label: 'High', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  medium: { border: 'border-l-blue-400', label: null, chip: '' },
  low: { border: 'border-l-gray-300 dark:border-l-gray-600', label: null, chip: '' },
};

export default function Notifications() {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications-all'],
    queryFn: () => notificationService.getAll({ limit: 50 }).then((r) => r.data),
  });

  const invalidate = () => {
    queryClient.invalidateQueries(['notifications-all']);
    /*
     * The header keeps its own two queries — ['notifications','unread'] for the badge and
     * ['notifications','recent'] for the dropdown. Only markAllAsRead refreshed the badge, and
     * nothing ever refreshed the dropdown, so deleting a notification here left it listed in the
     * bell menu until a reload. Invalidating the shared prefix covers both.
     */
    queryClient.invalidateQueries(['notifications']);
  };

  /*
   * All three mutations previously had no onError at all. A failed delete or mark-as-read did
   * nothing whatsoever on screen — the row stayed exactly as it was — so the natural response
   * was to click again, and again. Every other page in the app reports its failures.
   */
  const markReadMutation = useMutation({
    mutationFn: (id) => notificationService.markAsRead(id),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message || 'Could not mark as read'),
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationService.markAllAsRead(),
    onSuccess: () => { toast.success('All marked as read'); invalidate(); },
    onError: (e) => toast.error(e.message || 'Could not mark all as read'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => notificationService.delete(id),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message || 'Could not delete notification'),
  });

  const handleDelete = async (n) => {
    // Deleting is immediate and cannot be undone. Every other destructive action in the app asks
    // first; this one fired on a single click of a 14px icon sitting next to "mark as read".
    const result = await confirm.delete({ text: `"${n.title}" will be removed from your notifications.` });
    if (result.isConfirmed) deleteMutation.mutate(n._id);
  };

  if (isLoading) return <PageLoader />;

  const notifications = data?.data || [];
  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const total = data?.meta?.total ?? notifications.length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">
            <span className="numeric">{unreadCount}</span> unread
            {/* The count only ever covered the 50 rows fetched. Saying so is cheaper than
                implying the number is the whole picture. */}
            {total > notifications.length && ` · showing the ${notifications.length} most recent of ${total}`}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
            className="flex items-center gap-2 text-sm font-medium text-navy-700 transition-colors hover:text-navy-900 disabled:opacity-60 dark:text-navy-300 dark:hover:text-navy-200"
          >
            <CheckCheck size={16} aria-hidden="true" />
            {markAllMutation.isPending ? 'Marking...' : 'Mark all as read'}
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center dark:border-gray-700 dark:bg-gray-800">
          <Bell size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" aria-hidden="true" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">No notifications yet</p>
          <p className="meta-text mt-1">Approvals, deadlines and alerts will appear here.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n, i) => {
            const Icon = TYPE_ICONS[n.type] || Info;
            const priority = PRIORITIES[n.priority] || PRIORITIES.medium;

            return (
              <motion.li
                key={n._id}
                initial={reduceMotion ? false : { opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                // Staggering 50 rows at 30ms each ran for a second and a half before the list
                // settled. Capped, and skipped entirely when reduced motion is requested.
                transition={reduceMotion ? { duration: 0 } : { delay: Math.min(i, 10) * 0.03 }}
                className={`flex items-start gap-4 rounded-xl border border-l-4 border-gray-200 p-4 dark:border-gray-700 ${priority.border} ${
                  n.isRead ? 'bg-white dark:bg-gray-800' : 'bg-blue-50/40 dark:bg-blue-900/10'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    n.isRead ? 'bg-gray-100 dark:bg-gray-700' : 'bg-blue-100 dark:bg-blue-900/30'
                  }`}
                >
                  <Icon size={16} className={n.isRead ? 'text-gray-400 dark:text-gray-500' : 'text-blue-600 dark:text-blue-300'} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                    <p className={`text-sm font-semibold ${n.isRead ? 'text-gray-700 dark:text-gray-300' : 'text-gray-900 dark:text-white'}`}>
                      {n.title}
                    </p>
                    {priority.label && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${priority.chip}`}>
                        {priority.label}
                      </span>
                    )}
                    {/* Was a bare blue dot — meaningful only if you could see it. */}
                    {!n.isRead && (
                      <>
                        <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                        <span className="sr-only">Unread.</span>
                      </>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{n.message}</p>
                  <p className="meta-text mt-1">{getRelativeTime(n.createdAt)}</p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {!n.isRead && (
                    <button
                      type="button"
                      onClick={() => markReadMutation.mutate(n._id)}
                      disabled={markReadMutation.isPending}
                      aria-label={`Mark "${n.title}" as read`}
                      title="Mark as read"
                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40 dark:text-gray-500 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
                    >
                      <CheckCircle2 size={14} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(n)}
                    disabled={deleteMutation.isPending}
                    aria-label={`Delete "${n.title}"`}
                    title="Delete"
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
