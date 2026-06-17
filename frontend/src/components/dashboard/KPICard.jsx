import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function KPICard({ title, value, subtitle, icon: Icon, color = 'navy', trend, trendValue, delay = 0 }) {
  const colors = {
    navy: { bg: 'bg-navy-900', icon: 'bg-navy-800', text: 'text-white', sub: 'text-navy-300' },
    gold: { bg: 'bg-gold-500', icon: 'bg-gold-400', text: 'text-navy-900', sub: 'text-navy-700' },
    green: { bg: 'bg-emerald-600', icon: 'bg-emerald-500', text: 'text-white', sub: 'text-emerald-100' },
    red: { bg: 'bg-red-600', icon: 'bg-red-500', text: 'text-white', sub: 'text-red-100' },
    blue: { bg: 'bg-blue-600', icon: 'bg-blue-500', text: 'text-white', sub: 'text-blue-100' },
    purple: { bg: 'bg-purple-600', icon: 'bg-purple-500', text: 'text-white', sub: 'text-purple-100' },
    white: { bg: 'bg-white dark:bg-gray-800', icon: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-900 dark:text-white', sub: 'text-gray-500 dark:text-gray-400' },
  };

  const c = colors[color] || colors.white;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className={`${c.bg} rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow duration-200`}
    >
      <div className="flex items-start justify-between mb-3">
        <p className={`text-sm font-medium ${c.sub}`}>{title}</p>
        {Icon && (
          <div className={`w-9 h-9 ${c.icon} rounded-lg flex items-center justify-center flex-shrink-0`}>
            <Icon size={18} className={c.text} />
          </div>
        )}
      </div>
      <p className={`text-2xl font-bold ${c.text} mb-1`}>{value}</p>
      {subtitle && <p className={`text-xs ${c.sub}`}>{subtitle}</p>}
      {trend !== undefined && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${c.sub}`}>
          {trend > 0 ? <TrendingUp size={12} /> : trend < 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
          <span>{trendValue || `${Math.abs(trend)}%`} vs last month</span>
        </div>
      )}
    </motion.div>
  );
}
