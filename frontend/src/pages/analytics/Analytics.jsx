import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { analyticsService } from '../../services/documentService';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { MONTH_NAMES } from '../../utils/constants';
import { formatCurrency } from '../../utils/formatters';
import { useChartTheme, seriesColor, srSummary } from '../../utils/chartTheme';

export default function Analytics() {
  const theme = useChartTheme();

  const { data: fundData, isLoading: fl } = useQuery({
    queryKey: ['analytics-fund'],
    queryFn: () => analyticsService.getFundUtilization().then((r) => r.data.data),
  });

  const { data: programData, isLoading: pl } = useQuery({
    queryKey: ['analytics-program'],
    queryFn: () => analyticsService.getProgramSuccess().then((r) => r.data.data),
  });

  const { data: youthData, isLoading: yl } = useQuery({
    queryKey: ['analytics-youth'],
    queryFn: () => analyticsService.getYouthEngagement().then((r) => r.data.data),
  });

  if (fl || pl || yl) return <PageLoader />;

  const fundChartData = (fundData || []).map((d) => ({ month: MONTH_NAMES[d.month - 1], amount: d.total }));
  const genderData = (youthData?.byGender || []).map((g) => ({ name: g._id || 'Unspecified', value: g.count }));
  const educationData = (youthData?.byEducation || []).filter((d) => d._id);
  const programRows = programData || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Analytics &amp; Insights</h1>
        <p className="page-subtitle">Data-driven insights for better governance decisions</p>
      </div>

      <ChartCard
        title={`Fund Utilization Trend (${new Date().getFullYear()})`}
        isEmpty={!fundChartData.length}
        summary={srSummary('Fund utilization by month', fundChartData.map((d) => [d.month, formatCurrency(d.amount)]))}
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={fundChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
            <XAxis dataKey="month" tick={theme.tick} stroke={theme.axis} />
            <YAxis tick={theme.tick} stroke={theme.axis} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => [formatCurrency(v), 'Expenses']} {...theme.tooltip} />
            <Line type="monotone" dataKey="amount" stroke="#1e3a5f" strokeWidth={2.5} dot={{ fill: '#1e3a5f', r: 4 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard
          title="Program Success by Category"
          isEmpty={!programRows.length}
          summary={srSummary('Programs by category', programRows.map((d) => [d._id?.replace(/_/g, ' '), `${d.completed} of ${d.total} completed`]))}
        >
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={programRows}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
              <XAxis dataKey="_id" tick={theme.tickSmall} stroke={theme.axis} tickFormatter={(v) => v?.replace(/_/g, ' ').slice(0, 8)} />
              <YAxis tick={theme.tick} stroke={theme.axis} />
              <Tooltip {...theme.tooltip} />
              <Legend wrapperStyle={theme.legend} />
              <Bar dataKey="total" fill="#1e3a5f" name="Total" radius={[4, 4, 0, 0]} />
              <Bar dataKey="completed" fill="#16a34a" name="Completed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Youth Engagement by Gender"
          isEmpty={!genderData.length}
          summary={srSummary('Youth by gender', genderData.map((d) => [d.name, d.value]))}
        >
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={genderData}
                cx="50%"
                cy="50%"
                outerRadius={90}
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {/* seriesColor cycles, so a dataset larger than the palette no longer renders
                    slices with `fill: undefined`. */}
                {genderData.map((entry, i) => <Cell key={entry.name} fill={seriesColor(i)} />)}
              </Pie>
              <Tooltip {...theme.tooltip} />
              <Legend wrapperStyle={theme.legend} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard
        title="Youth by Educational Attainment"
        isEmpty={!educationData.length}
        summary={srSummary('Youth by educational attainment', educationData.map((d) => [d._id?.replace(/_/g, ' '), d.count]))}
      >
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={educationData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
            <XAxis type="number" tick={theme.tick} stroke={theme.axis} />
            <YAxis dataKey="_id" type="category" tick={theme.tick} stroke={theme.axis} tickFormatter={(v) => v?.replace(/_/g, ' ')} width={100} />
            <Tooltip {...theme.tooltip} />
            <Bar dataKey="count" fill="#f5c518" radius={[0, 4, 4, 0]} name="Youth" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {programRows.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="section-heading mb-4">Program Performance Summary</h2>
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <caption className="sr-only">Programs by category, with completion and budget totals</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="cell-numeric">Total</th>
                  <th scope="col" className="cell-numeric">Completed</th>
                  <th scope="col">Success Rate</th>
                  <th scope="col" className="cell-numeric">Avg Completion</th>
                  <th scope="col" className="cell-numeric">Total Budget</th>
                </tr>
              </thead>
              <tbody>
                {programRows.map((row) => {
                  const rate = Math.round(row.successRate || 0);
                  return (
                    <tr key={row._id}>
                      <td className="font-medium capitalize">{row._id?.replace(/_/g, ' ')}</td>
                      <td className="cell-numeric">{row.total}</td>
                      <td className="cell-numeric">{row.completed}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 w-16 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
                            role="progressbar"
                            aria-valuenow={rate}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${row._id?.replace(/_/g, ' ')} success rate`}
                          >
                            <div className="h-full rounded-full bg-green-500" style={{ width: `${Math.min(rate, 100)}%` }} />
                          </div>
                          <span className="numeric text-xs font-medium">{rate}%</span>
                        </div>
                      </td>
                      <td className="cell-numeric">{Math.round(row.avgCompletionRate || 0)}%</td>
                      <td className="cell-numeric">{formatCurrency(row.totalBudget)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Chart in a card, with the two states the originals lacked: an explicit empty case, and a text
 * equivalent for anyone who cannot see the drawing. An empty dataset previously rendered a pair
 * of bare axes, which reads as a broken chart rather than as "nothing recorded yet".
 */
function ChartCard({ title, isEmpty, summary, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="section-heading mb-4">{title}</h2>
      {isEmpty ? (
        <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">No data recorded yet.</p>
      ) : (
        <>
          <p className="sr-only">{summary}</p>
          {children}
        </>
      )}
    </div>
  );
}
