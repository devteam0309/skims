import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * A single figure with its label.
 *
 * Previously each card was flood-filled with one of seven saturated colours. Two problems:
 * every tile competed for attention at equal volume, so the one that needed action read no
 * louder than a vanity count; and the colours were decorative — navy for programs, gold for
 * budget — encoding nothing a user could learn.
 *
 * Now the surface is neutral and colour is reserved for *state*. `color="red"` marks a figure
 * that needs attention and is the only variant that draws itself louder — via a left rule and
 * a tinted icon, not a flood fill, so the number itself stays the most legible thing.
 *
 * The prop API is unchanged so every existing call site keeps working.
 */
export default function KPICard({ title, value, subtitle, icon: Icon, color = 'navy', trend, trendValue }) {
  const needsAttention = color === 'red';

  return (
    <div
      className={`relative rounded-xl border bg-white p-4 transition-colors dark:bg-gray-800 ${
        needsAttention
          ? 'border-red-200 dark:border-red-900/60'
          : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
      }`}
    >
      {/* A rule rather than a fill: visible in peripheral vision, but it does not reduce the
          contrast of the value sitting next to it. */}
      {needsAttention && (
        <span aria-hidden="true" className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-red-500" />
      )}

      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</p>
        {Icon && (
          <Icon
            size={16}
            aria-hidden="true"
            className={needsAttention ? 'shrink-0 text-red-500' : 'shrink-0 text-gray-400 dark:text-gray-500'}
          />
        )}
      </div>

      {/* The value is the content. It gets the size, the weight and the contrast. */}
      <p
        className={`numeric mt-2 text-2xl font-semibold leading-none ${
          needsAttention ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-white'
        }`}
      >
        {value}
      </p>

      {subtitle && <p className="meta-text mt-1.5">{subtitle}</p>}

      {trend !== undefined && (
        <p
          className={`mt-2 flex items-center gap-1 text-xs font-medium ${
            trend > 0
              ? 'text-emerald-700 dark:text-emerald-400'
              : trend < 0
                ? 'text-red-700 dark:text-red-400'
                : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {trend > 0 ? <TrendingUp size={12} aria-hidden="true" /> : trend < 0 ? <TrendingDown size={12} aria-hidden="true" /> : <Minus size={12} aria-hidden="true" />}
          <span>{trendValue || `${Math.abs(trend)}%`} vs last month</span>
        </p>
      )}
    </div>
  );
}
