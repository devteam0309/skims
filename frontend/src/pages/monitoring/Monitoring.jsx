import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Clock, CheckCircle2, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { monitoringService } from '../../services/documentService';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import StatusBadge from '../../components/shared/StatusBadge';
import { formatDate, formatCurrency } from '../../utils/formatters';
import { useChartTheme, srSummary } from '../../utils/chartTheme';

/** Compliance bands, keyed to the same vocabulary StatusBadge uses. */
const COMPLIANCE = {
  compliant: { border: 'border-green-200 dark:border-green-800', text: 'text-green-600 dark:text-emerald-400', bar: 'bg-green-500' },
  at_risk: { border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' },
  non_compliant: { border: 'border-red-200 dark:border-red-800', text: 'text-red-600 dark:text-red-400', bar: 'bg-red-500' },
};

export default function Monitoring() {
  const theme = useChartTheme();
  const reduceMotion = useReducedMotion();

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

  const band = COMPLIANCE[compliance?.status] || COMPLIANCE.non_compliant;
  const score = compliance?.complianceScore ?? 0;

  const chartData = (munReport || []).map((m) => ({
    name: m.name,
    total: m.programStats?.reduce((s, p) => s + p.count, 0) || 0,
    budget: m.budgetStats?.total || 0,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Monitoring &amp; Evaluation</h1>
        {/* The page silently refetches every minute; saying so explains figures changing under
            the reader without any action of theirs. */}
        <p className="page-subtitle">Real-time oversight of programs and compliance · refreshes every minute</p>
      </div>

      {compliance && (
        <motion.section
          aria-label="Compliance status"
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl border-2 bg-white p-5 dark:bg-gray-800 ${band.border}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="section-heading">Compliance Status</h2>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                Based on pending documents and program status
              </p>
            </div>
            <div className="text-right">
              <p className={`numeric text-4xl font-black ${band.text}`}>{score}%</p>
              <StatusBadge status={compliance.status} />
            </div>
          </div>

          <div
            className="mt-4 h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
            role="progressbar"
            aria-valuenow={score}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Compliance score"
          >
            {/* Framer animates in JS, so the reduced-motion rule in index.css never reached this
                1.5s sweep. */}
            <motion.div
              initial={reduceMotion ? false : { width: 0 }}
              animate={{ width: `${Math.min(score, 100)}%` }}
              transition={reduceMotion ? { duration: 0 } : { duration: 1.5, ease: 'easeOut' }}
              className={`h-full rounded-full ${band.bar}`}
            />
          </div>

          {/*
            Three counts of outstanding work, previously red, yellow and orange — three different
            colours implying a severity ranking that is nowhere defined, and orange belonging to
            no tone in the vocabulary at all. They are the same kind of thing, so they read the
            same, and the figure carries the weight.
          */}
          <dl className="mt-4 grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
            {[
              ['Pending Liquidations', compliance.pendingLiquidations],
              ['Overdue Programs', compliance.overduePrograms],
              ['Missing Documents', compliance.missingDocuments],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                <dd className={`numeric text-2xl font-bold ${value > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                  {value ?? 0}
                </dd>
                <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
              </div>
            ))}
          </dl>
        </motion.section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <AlertPanel
          icon={AlertTriangle}
          tone="danger"
          title="Delayed Programs"
          count={data?.delayedPrograms?.length}
          emptyText="No delayed programs"
        >
          {data?.delayedPrograms?.map((p) => {
            const daysOverdue = p.endDate
              ? Math.ceil((Date.now() - new Date(p.endDate).getTime()) / 86400000)
              : null;
            return (
              <li key={p._id} className="flex items-start justify-between gap-3 rounded-lg border border-red-100 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-900/20">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{p.title}</p>
                  <p className="meta-text">{p.municipality?.name} · Due: {formatDate(p.endDate)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="numeric text-xs font-semibold text-red-700 dark:text-red-300">{p.completionRate ?? 0}% done</p>
                  {daysOverdue > 0 && (
                    <p className="numeric mt-0.5 text-xs font-medium text-red-600 dark:text-red-400">{daysOverdue}d overdue</p>
                  )}
                </div>
              </li>
            );
          })}
        </AlertPanel>

        <AlertPanel
          icon={Clock}
          tone="warning"
          title="Upcoming Deadlines (7 days)"
          count={data?.upcomingDeadlines?.length}
          emptyText="No upcoming deadlines"
        >
          {data?.upcomingDeadlines?.map((p) => (
            <li key={p._id} className="flex items-start justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/20">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{p.title}</p>
                <p className="meta-text">Ends: {formatDate(p.endDate)}</p>
              </div>
              <StatusBadge status={p.status} />
            </li>
          ))}
        </AlertPanel>
      </div>

      {chartData.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 size={18} className="text-navy-700 dark:text-navy-300" aria-hidden="true" />
            <h2 className="section-heading">Municipality Performance Comparison</h2>
          </div>
          <p className="sr-only">
            {srSummary(
              'Programs and budget by municipality',
              chartData.map((m) => [m.name, `${m.total} programs, ${formatCurrency(m.budget)}`])
            )}
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
              <XAxis dataKey="name" tick={theme.tick} stroke={theme.axis} />
              <YAxis yAxisId="left" tick={theme.tick} stroke={theme.axis} />
              <YAxis yAxisId="right" orientation="right" tick={theme.tick} stroke={theme.axis} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                {...theme.tooltip}
                formatter={(v, name) => [name === 'Budget' ? formatCurrency(v) : v, name]}
              />
              {/* Two axes with no key left the reader guessing which bar belonged to which. */}
              <Legend wrapperStyle={theme.legend} />
              <Bar yAxisId="left" dataKey="total" fill="#1e3a5f" name="Programs" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="right" dataKey="budget" fill="#f5c518" name="Budget" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function AlertPanel({ icon: Icon, tone, title, count, emptyText, children }) {
  const tones = {
    danger: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    warning: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  };
  const chips = {
    danger: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon size={16} aria-hidden="true" />
        </span>
        <h2 className="section-heading">{title}</h2>
        {count > 0 && (
          <span className={`numeric ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${chips[tone]}`}>
            {count}
          </span>
        )}
      </div>

      {count > 0 ? (
        <ul className="space-y-3">{children}</ul>
      ) : (
        <div className="py-6 text-center">
          <CheckCircle2 size={28} className="mx-auto mb-2 text-green-500" aria-hidden="true" />
          <p className="text-sm text-gray-500 dark:text-gray-400">{emptyText}</p>
        </div>
      )}
    </section>
  );
}
