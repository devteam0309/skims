import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Target, Banknote, TrendingUp, FileText, AlertTriangle,
  CheckCircle2, Clock, Users, Activity, BarChart3,
} from 'lucide-react';
import { dashboardService } from '../../services/documentService';
import KPICard from '../../components/dashboard/KPICard';
import { ProgramStatusChart, MonthlyExpenseChart } from '../../components/dashboard/ProgramChart';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import StatusBadge from '../../components/shared/StatusBadge';
import { formatCurrency, formatDate, getRelativeTime } from '../../utils/formatters';
import useAuthStore from '../../store/authStore';
import { ROLE_LABELS } from '../../utils/constants';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { user } = useAuthStore();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardService.get().then((r) => r.data.data),
    refetchInterval: 60000,
  });

  if (isLoading) return <PageLoader />;
  if (isError) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <AlertTriangle size={40} className="text-red-400 mb-3" />
      <p className="font-semibold text-gray-700 dark:text-gray-300">Failed to load dashboard data</p>
      <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Please refresh the page or try again later.</p>
    </div>
  );

  const kpis = data?.kpis || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {user?.firstName}!
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            {ROLE_LABELS[user?.role]} · {user?.municipality?.name || 'All Municipalities'} · {formatDate(new Date())}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-medium text-green-700">System Online</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total Programs" value={kpis.totalPrograms || 0} subtitle={`${kpis.activePrograms || 0} active`} icon={Target} color="navy" delay={0} />
        <KPICard title="Total Budget" value={formatCurrency(kpis.totalBudget)} subtitle={`${kpis.budgetUtilization || 0}% utilized`} icon={Banknote} color="gold" delay={0.1} />
        <KPICard title="Expenses" value={formatCurrency(kpis.totalExpenses)} subtitle="Approved expenses" icon={TrendingUp} color="green" delay={0.2} />
        <KPICard title="Pending Liquidations" value={kpis.pendingLiquidations || 0} subtitle="Requires action" icon={AlertTriangle} color={kpis.pendingLiquidations > 0 ? 'red' : 'green'} delay={0.3} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Completed Programs" value={kpis.completedPrograms || 0} icon={CheckCircle2} color="white" delay={0.1} />
        <KPICard title="Delayed Programs" value={kpis.delayedPrograms || 0} icon={Clock} color="white" delay={0.1} />
        <KPICard title="Youth Members" value={kpis.totalYouth || 0} icon={Users} color="white" delay={0.2} />
        <KPICard title="Documents" value={kpis.totalDocuments || 0} icon={FileText} color="white" delay={0.3} />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white">Programs by Status</h3>
            <Link to="/programs" className="text-xs text-navy-700 hover:underline">View all</Link>
          </div>
          <ProgramStatusChart data={data?.programsByStatus} />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white">Monthly Expenses</h3>
            <Link to="/expenses" className="text-xs text-navy-700 hover:underline">View all</Link>
          </div>
          <MonthlyExpenseChart data={data?.monthlyExpenses} />
        </motion.div>
      </div>

      {/* Budget Utilization */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Budget Overview</h3>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {[
            { label: 'Total Budget', value: formatCurrency(kpis.totalBudget), color: 'text-gray-900 dark:text-white' },
            { label: 'Disbursed', value: formatCurrency(kpis.disbursedBudget), color: 'text-green-600' },
            { label: 'Remaining', value: formatCurrency(kpis.remainingBudget), color: 'text-blue-600' },
          ].map((item) => (
            <div key={item.label} className="text-center p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{item.label}</p>
              <p className={`text-sm font-bold ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>
        <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-navy-900 to-navy-700 rounded-full transition-all duration-1000"
            style={{ width: `${kpis.budgetUtilization || 0}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
          <span>0%</span>
          <span className="font-medium text-navy-700">{kpis.budgetUtilization || 0}% utilized</span>
          <span>100%</span>
        </div>
      </div>

      {/* Recent activity */}
      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
          className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white">Recent Programs</h3>
            <Link to="/programs" className="text-xs text-navy-700 hover:underline">View all</Link>
          </div>
          <div className="space-y-3">
            {data?.recentPrograms?.length ? data.recentPrograms.map((p) => (
              <Link to={`/programs/${p._id}`} key={p._id}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.title}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{getRelativeTime(p.createdAt)}</p>
                </div>
                <StatusBadge status={p.status} />
              </Link>
            )) : <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No programs yet</p>}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
          className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white">Recent Expenses</h3>
            <Link to="/expenses" className="text-xs text-navy-700 hover:underline">View all</Link>
          </div>
          <div className="space-y-3">
            {data?.recentExpenses?.length ? data.recentExpenses.map((e) => (
              <div key={e._id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{e.title}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{e.type?.replace(/_/g, ' ')}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(e.amount)}</p>
                  <StatusBadge status={e.status} />
                </div>
              </div>
            )) : <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No expenses yet</p>}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
