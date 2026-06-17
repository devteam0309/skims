import { useQuery } from '@tanstack/react-query';
import { analyticsService } from '../../services/documentService';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { MONTH_NAMES } from '../../utils/constants';
import { formatCurrency } from '../../utils/formatters';

const COLORS = ['#1e3a5f', '#f5c518', '#16a34a', '#2563eb', '#dc2626', '#7c3aed', '#ea580c'];

export default function Analytics() {
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

  const fundChartData = (fundData || []).map((d) => ({
    month: MONTH_NAMES[d.month - 1],
    amount: d.total,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics & Insights</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Data-driven insights for better governance decisions</p>
      </div>

      {/* Fund utilization trend */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Fund Utilization Trend ({new Date().getFullYear()})</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={fundChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => [formatCurrency(v), 'Expenses']} />
            <Line type="monotone" dataKey="amount" stroke="#1e3a5f" strokeWidth={2.5} dot={{ fill: '#1e3a5f', r: 4 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Program success by category */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Program Success by Category</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={programData || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="_id" tick={{ fontSize: 10 }} tickFormatter={(v) => v?.replace(/_/g, ' ').slice(0, 8)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="total" fill="#1e3a5f" name="Total" radius={[4, 4, 0, 0]} />
              <Bar dataKey="completed" fill="#16a34a" name="Completed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Youth by gender */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Youth Engagement by Gender</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={(youthData?.byGender || []).map((g) => ({ name: g._id, value: g.count }))}
                cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {(youthData?.byGender || []).map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Youth by education */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Youth by Educational Attainment</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={(youthData?.byEducation || []).filter((d) => d._id)} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis dataKey="_id" type="category" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.replace(/_/g, ' ')} width={100} />
            <Tooltip />
            <Bar dataKey="count" fill="#f5c518" radius={[0, 4, 4, 0]} name="Youth" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Program performance table */}
      {programData?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Program Performance Summary</h3>
          <div className="overflow-x-auto">
            <table className="w-full data-table">
              <thead><tr>
                <th>Category</th><th>Total</th><th>Completed</th><th>Success Rate</th><th>Avg Completion</th><th>Total Budget</th>
              </tr></thead>
              <tbody>
                {programData.map((row) => (
                  <tr key={row._id}>
                    <td className="capitalize font-medium">{row._id?.replace(/_/g, ' ')}</td>
                    <td>{row.total}</td>
                    <td className="text-green-600">{row.completed}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${row.successRate?.toFixed(0) || 0}%` }} />
                        </div>
                        <span className="text-xs font-medium">{row.successRate?.toFixed(0) || 0}%</span>
                      </div>
                    </td>
                    <td>{row.avgCompletionRate?.toFixed(0) || 0}%</td>
                    <td>{formatCurrency(row.totalBudget)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
