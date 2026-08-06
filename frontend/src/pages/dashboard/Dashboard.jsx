import { useQuery } from '@tanstack/react-query';
import {
  Target, Banknote, TrendingUp, FileText, AlertTriangle,
  CheckCircle2, Clock, Users,
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
      <AlertTriangle size={32} className="mb-3 text-red-400" aria-hidden="true" />
      <p className="font-semibold text-gray-700 dark:text-gray-300">Failed to load dashboard data</p>
      <p className="meta-text mt-1">Please refresh the page or try again later.</p>
    </div>
  );

  const kpis = data?.kpis || {};
  const greeting = new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="page-title">Good {greeting}, {user?.firstName}</h1>
        <p className="page-subtitle">
          {ROLE_LABELS[user?.role]} · {user?.municipality?.name || 'All Municipalities'} · {formatDate(new Date())}
        </p>
      </header>

      {/*
        The four figures a user acts on. Pending liquidations is the only one that can demand
        action, so it is the only one allowed to colour itself — and only when the count is
        non-zero. At zero it sits quietly with the rest instead of showing a reassuring green
        that competes with the numbers that matter.
      */}
      <section aria-labelledby="key-figures">
        <h2 id="key-figures" className="sr-only">Key figures</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KPICard title="Total Programs" value={kpis.totalPrograms || 0} subtitle={`${kpis.activePrograms || 0} active`} icon={Target} color="navy" />
          <KPICard title="Total Budget" value={formatCurrency(kpis.totalBudget)} subtitle={`${kpis.budgetUtilization || 0}% utilized`} icon={Banknote} color="navy" />
          <KPICard title="Expenses" value={formatCurrency(kpis.totalExpenses)} subtitle="Approved expenses" icon={TrendingUp} color="navy" />
          <KPICard
            title="Pending Liquidations"
            value={kpis.pendingLiquidations || 0}
            subtitle={kpis.pendingLiquidations > 0 ? 'Requires action' : 'Nothing outstanding'}
            icon={AlertTriangle}
            color={kpis.pendingLiquidations > 0 ? 'red' : 'navy'}
          />
        </div>
      </section>

      {/*
        Reference counts. These are looked up, not acted on, so they are a compact strip rather
        than four more full-size cards — which previously doubled the visual weight of the top
        of the page without adding a single decision. Delayed programs is the exception: it can
        indicate a problem, so it is allowed to turn red when non-zero.
      */}
      <section aria-labelledby="at-a-glance" className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <h2 id="at-a-glance" className="sr-only">At a glance</h2>
        <dl className="grid grid-cols-2 divide-gray-200 sm:grid-cols-4 sm:divide-x dark:divide-gray-700">
          {[
            { label: 'Completed Programs', value: kpis.completedPrograms || 0, icon: CheckCircle2, alert: false },
            { label: 'Delayed Programs', value: kpis.delayedPrograms || 0, icon: Clock, alert: (kpis.delayedPrograms || 0) > 0 },
            { label: 'Youth Members', value: kpis.totalYouth || 0, icon: Users, alert: false },
            { label: 'Documents', value: kpis.totalDocuments || 0, icon: FileText, alert: false },
          ].map((stat) => (
            <div key={stat.label} className="flex items-center gap-3 px-4 py-3">
              <stat.icon
                size={16}
                aria-hidden="true"
                className={stat.alert ? 'shrink-0 text-red-500' : 'shrink-0 text-gray-400 dark:text-gray-500'}
              />
              <div className="min-w-0">
                <dd className={`numeric text-lg font-semibold leading-none ${stat.alert ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                  {stat.value}
                </dd>
                <dt className="meta-text mt-1 truncate">{stat.label}</dt>
              </div>
            </div>
          ))}
        </dl>
      </section>

      {/*
        Budget position gets its own full-width block above the charts: it is the single most
        consequential number set on the page, and it was previously buried below two charts.
      */}
      <section aria-labelledby="budget-overview" className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="budget-overview" className="section-heading">Budget Overview</h2>
          <Link to="/budgets" className="text-xs font-medium text-navy-700 hover:underline dark:text-navy-300">
            View budgets
          </Link>
        </div>

        {/* Left-aligned, not centred: the eye scans a column of figures down a shared left edge
            far faster than it re-centres on each one. */}
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { label: 'Total Budget', value: formatCurrency(kpis.totalBudget), tone: 'text-gray-900 dark:text-white' },
            { label: 'Disbursed', value: formatCurrency(kpis.disbursedBudget), tone: 'text-gray-900 dark:text-white' },
            { label: 'Remaining', value: formatCurrency(kpis.remainingBudget), tone: 'text-gray-900 dark:text-white' },
          ].map((item) => (
            <div key={item.label}>
              <p className="meta-text">{item.label}</p>
              <p className={`numeric mt-1 text-lg font-semibold ${item.tone}`}>{item.value}</p>
            </div>
          ))}
        </div>

        <div
          className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
          role="progressbar"
          aria-valuenow={kpis.budgetUtilization || 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Budget utilization"
        >
          <div
            className="h-full rounded-full bg-navy-700 transition-[width] duration-700 dark:bg-navy-400"
            style={{ width: `${Math.min(kpis.budgetUtilization || 0, 100)}%` }}
          />
        </div>
        {/* The 0% / 100% end labels were removed: a full-width track already communicates the
            scale, and they crowded the one number that actually varies. */}
        <p className="meta-text mt-2">
          <span className="numeric font-medium text-gray-700 dark:text-gray-300">{kpis.budgetUtilization || 0}%</span> of budget utilized
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartPanel title="Programs by Status" to="/programs" linkLabel="View all programs">
          <ProgramStatusChart data={data?.programsByStatus} />
        </ChartPanel>
        <ChartPanel title="Monthly Expenses" to="/expenses" linkLabel="View all expenses">
          <MonthlyExpenseChart data={data?.monthlyExpenses} />
        </ChartPanel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartPanel title="Recent Programs" to="/programs" linkLabel="View all programs">
          <ul className="-mx-2 divide-y divide-gray-100 dark:divide-gray-700">
            {data?.recentPrograms?.length ? data.recentPrograms.map((p) => (
              <li key={p._id}>
                <Link
                  to={`/programs/${p._id}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{p.title}</span>
                    <span className="meta-text">{getRelativeTime(p.createdAt)}</span>
                  </span>
                  <StatusBadge status={p.status} />
                </Link>
              </li>
            )) : <li className="meta-text py-6 text-center">No programs yet</li>}
          </ul>
        </ChartPanel>

        <ChartPanel title="Recent Expenses" to="/expenses" linkLabel="View all expenses">
          {/* These rows previously carried a hover highlight but were not clickable — a false
              affordance that invites a click and does nothing. Presented as plain records. */}
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {data?.recentExpenses?.length ? data.recentExpenses.map((e) => (
              <li key={e._id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">{e.title}</span>
                  <span className="meta-text capitalize">{e.type?.replace(/_/g, ' ')}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="numeric block text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(e.amount)}</span>
                  <StatusBadge status={e.status} />
                </span>
              </li>
            )) : <li className="meta-text py-6 text-center">No expenses yet</li>}
          </ul>
        </ChartPanel>
      </div>
    </div>
  );
}

/** Shared panel chrome so the six blocks below the figures stay visually consistent. */
function ChartPanel({ title, to, linkLabel, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="section-heading">{title}</h2>
        <Link to={to} className="shrink-0 text-xs font-medium text-navy-700 hover:underline dark:text-navy-300">
          {/* Accessible name says which list, so it is unambiguous out of context for a
              screen-reader user tabbing through several "View all" links on one page. */}
          <span className="sr-only">{linkLabel}</span>
          <span aria-hidden="true">View all</span>
        </Link>
      </div>
      {children}
    </section>
  );
}
