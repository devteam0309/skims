import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { formatCurrency } from '../../utils/formatters';
import { useChartTheme, srSummary } from '../../utils/chartTheme';
import { MONTH_NAMES } from '../../utils/constants';

const STATUS_COLORS = {
  ongoing: '#16a34a',
  completed: '#6b7280',
  planned: '#2563eb',
  delayed: '#dc2626',
  cancelled: '#d97706',
};

export function ProgramStatusChart({ data }) {
  const theme = useChartTheme();

  const chartData = Object.entries(data || {}).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
    fill: STATUS_COLORS[name] || '#94a3b8',
  }));

  if (!chartData.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-gray-500">
        No data available
      </div>
    );
  }

  return (
    <>
      {/* Recharts renders a bare <svg>, which conveys nothing to a screen reader. */}
      <p className="sr-only">{srSummary('Programs by status', chartData.map((d) => [d.name, d.value]))}</p>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
            {chartData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
          </Pie>
          <Tooltip formatter={(v) => [v, 'Programs']} {...theme.tooltip} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={theme.legend} />
        </PieChart>
      </ResponsiveContainer>
    </>
  );
}

export function MonthlyExpenseChart({ data }) {
  const theme = useChartTheme();

  const monthlyMap = {};
  (data || []).forEach((d) => { monthlyMap[d._id?.month] = d.total || 0; });
  const chartData = MONTH_NAMES.map((month, i) => ({ month, amount: monthlyMap[i + 1] || 0 }));

  return (
    <>
      <p className="sr-only">
        {srSummary('Monthly expenses', chartData.map((d) => [d.month, formatCurrency(d.amount)]))}
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
          <XAxis dataKey="month" tick={theme.tick} stroke={theme.axis} />
          <YAxis tick={theme.tick} stroke={theme.axis} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={(v) => [formatCurrency(v), 'Expenses']} {...theme.tooltip} />
          <Bar dataKey="amount" fill="#1e3a5f" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}
