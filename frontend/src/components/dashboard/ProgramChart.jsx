import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { formatCurrency } from '../../utils/formatters';

const STATUS_COLORS = {
  ongoing: '#16a34a',
  completed: '#6b7280',
  planned: '#2563eb',
  delayed: '#dc2626',
  cancelled: '#d97706',
};

export function ProgramStatusChart({ data }) {
  const chartData = Object.entries(data || {}).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
    fill: STATUS_COLORS[name] || '#94a3b8',
  }));

  if (!chartData.length) return <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data available</div>;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={chartData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => [v, 'Programs']} />
        <Legend iconType="circle" iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function MonthlyExpenseChart({ data }) {
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyMap = {};
  (data || []).forEach((d) => { monthlyMap[d._id?.month] = d.total || 0; });
  const chartData = MONTH_NAMES.map((month, i) => ({
    month,
    amount: monthlyMap[i + 1] || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(v) => [formatCurrency(v), 'Expenses']} />
        <Bar dataKey="amount" fill="#1e3a5f" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
