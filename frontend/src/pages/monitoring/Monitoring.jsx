import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertTriangle, Clock, CheckCircle2, XCircle, BarChart3, MapPin } from 'lucide-react';
import { monitoringService } from '../../services/documentService';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import StatusBadge from '../../components/shared/StatusBadge';
import { formatDate, formatCurrency } from '../../utils/formatters';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function Monitoring() {
  const { data, isLoading } = useQuery({
    queryKey: ['monitoring'],
    queryFn: () => monitoringService.getOverview().then((r) => r.data.data),
    refetchInterval: 60000,
  });

  const { data: compliance } = useQuery({
    queryKey: ['compliance'],
    queryFn: () => monitoringService.getComplianceStatus().then((r) => r.data.data),
  });

  const { data: munReport } = useQuery({
    queryKey: ['municipality-report'],
    queryFn: () => monitoringService.getMunicipalityReport().then((r) => r.data.data),
  });

  if (isLoading) return <PageLoader />;

  const complianceColor = compliance?.status === 'compliant' ? 'green' :
    compliance?.status === 'at_risk' ? 'yellow' : 'red';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Monitoring & Evaluation</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Real-time oversight of programs and compliance</p>
      </div>

      {/* Compliance score */}
      {compliance && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className={`bg-white dark:bg-gray-800 rounded-xl border-2 ${compliance.status === 'compliant' ? 'border-green-200 dark:border-green-800' : compliance.status === 'at_risk' ? 'border-yellow-200 dark:border-yellow-800' : 'border-red-200 dark:border-red-800'} shadow-sm p-5`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">Compliance Status</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Based on pending documents and program status</p>
            </div>
            <div className="text-right">
              <p className={`text-4xl font-black ${compliance.status === 'compliant' ? 'text-green-600' : compliance.status === 'at_risk' ? 'text-yellow-600' : 'text-red-600'}`}>
                {compliance.complianceScore}%
              </p>
              <StatusBadge status={compliance.status} />
            </div>
          </div>
          <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded-full mt-4 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${compliance.complianceScore}%` }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
              className={`h-full rounded-full ${compliance.status === 'compliant' ? 'bg-green-500' : compliance.status === 'at_risk' ? 'bg-yellow-500' : 'bg-red-500'}`}
            />
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 text-center">
            {[
              { label: 'Pending Liquidations', value: compliance.pendingLiquidations, color: 'text-red-600' },
              { label: 'Overdue Programs', value: compliance.overduePrograms, color: 'text-yellow-600' },
              { label: 'Missing Documents', value: compliance.missingDocuments, color: 'text-orange-600' },
            ].map((item) => (
              <div key={item.label} className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{item.label}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Alert grids */}
      <div className="grid lg:grid-cols-2 gap-5">
        {/* Delayed programs */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
              <AlertTriangle size={16} className="text-red-600" />
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Delayed Programs</h3>
            {data?.delayedPrograms?.length > 0 && (
              <span className="ml-auto bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">{data.delayedPrograms.length}</span>
            )}
          </div>
          <div className="space-y-3">
            {data?.delayedPrograms?.length ? data.delayedPrograms.map((p) => {
              const daysOverdue = p.endDate ? Math.ceil((Date.now() - new Date(p.endDate).getTime()) / 86400000) : null;
              return (
                <div key={p._id} className="flex items-start justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-900/40">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{p.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{p.municipality?.name} · Due: {formatDate(p.endDate)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-red-600 font-semibold">{p.completionRate}% done</p>
                    {daysOverdue > 0 && (
                      <p className="text-xs text-red-500 font-medium mt-0.5">{daysOverdue}d overdue</p>
                    )}
                  </div>
                </div>
              );
            }) : (
              <div className="text-center py-6">
                <CheckCircle2 size={28} className="mx-auto text-green-400 mb-2" />
                <p className="text-sm text-gray-400 dark:text-gray-500">No delayed programs</p>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming deadlines */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
              <Clock size={16} className="text-yellow-600" />
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Upcoming Deadlines (7 days)</h3>
            {data?.upcomingDeadlines?.length > 0 && (
              <span className="ml-auto bg-yellow-100 text-yellow-700 text-xs font-semibold px-2 py-0.5 rounded-full">{data.upcomingDeadlines.length}</span>
            )}
          </div>
          <div className="space-y-3">
            {data?.upcomingDeadlines?.length ? data.upcomingDeadlines.map((p) => (
              <div key={p._id} className="flex items-start justify-between p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-100 dark:border-yellow-900/40">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{p.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Ends: {formatDate(p.endDate)}</p>
                </div>
                <StatusBadge status={p.status} />
              </div>
            )) : (
              <div className="text-center py-6">
                <CheckCircle2 size={28} className="mx-auto text-green-400 mb-2" />
                <p className="text-sm text-gray-400 dark:text-gray-500">No upcoming deadlines</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Municipality comparison chart */}
      {munReport?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={18} className="text-navy-700" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Municipality Performance Comparison</h3>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={munReport.map((m) => ({
              name: m.name,
              total: m.programStats?.reduce((s, p) => s + p.count, 0) || 0,
              budget: m.budgetStats?.total || 0,
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${(v/1000).toFixed(0)}k`} />
              <Tooltip />
              <Bar yAxisId="left" dataKey="total" fill="#1e3a5f" name="Programs" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="right" dataKey="budget" fill="#f5c518" name="Budget" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
