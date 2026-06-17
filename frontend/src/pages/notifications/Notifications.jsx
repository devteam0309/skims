import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Trash2, CheckCircle2, AlertTriangle, Info, Clock } from 'lucide-react';
import { notificationService } from '../../services/documentService';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { getRelativeTime } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import { motion } from 'framer-motion';

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

const PRIORITY_COLORS = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-400',
  medium: 'border-l-blue-400',
  low: 'border-l-gray-300',
};

export default function Notifications() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications-all'],
    queryFn: () => notificationService.getAll({ limit: 50 }).then((r) => r.data),
  });

  const markReadMutation = useMutation({
    mutationFn: (id) => notificationService.markAsRead(id),
    onSuccess: () => queryClient.invalidateQueries(['notifications-all']),
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationService.markAllAsRead(),
    onSuccess: () => { toast.success('All marked as read'); queryClient.invalidateQueries(['notifications-all']); queryClient.invalidateQueries(['notifications', 'unread']); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => notificationService.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['notifications-all']),
  });

  if (isLoading) return <PageLoader />;
  const notifications = data?.data || [];
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notifications</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{unreadCount} unread</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={() => markAllMutation.mutate()}
            className="flex items-center gap-2 text-sm text-navy-700 font-medium hover:text-navy-900">
            <CheckCheck size={16} />Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-16">
          <Bell size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-400 dark:text-gray-500">No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n, i) => {
            const Icon = TYPE_ICONS[n.type] || Info;
            return (
              <motion.div key={n._id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                className={`bg-white dark:bg-gray-800 rounded-xl border border-l-4 ${PRIORITY_COLORS[n.priority] || PRIORITY_COLORS.medium} border-gray-100 dark:border-gray-700 shadow-sm p-4 flex items-start gap-4 ${!n.isRead ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${!n.isRead ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                  <Icon size={16} className={!n.isRead ? 'text-blue-600' : 'text-gray-400 dark:text-gray-500'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-semibold ${!n.isRead ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>{n.title}</p>
                    {!n.isRead && <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1.5" />}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{n.message}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{getRelativeTime(n.createdAt)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!n.isRead && (
                    <button onClick={() => markReadMutation.mutate(n._id)} className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Mark as read">
                      <CheckCircle2 size={14} />
                    </button>
                  )}
                  <button onClick={() => deleteMutation.mutate(n._id)} className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
