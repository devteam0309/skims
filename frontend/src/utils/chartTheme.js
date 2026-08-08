import { useEffect, useState } from 'react';

/**
 * Chart colours that follow the active theme.
 *
 * Every Recharts view in the app hardcoded `stroke="#f0f0f0"` for the grid and left the axis
 * ticks to the library default of #666. In dark mode that renders a near-white grid across a
 * dark card, and axis labels dark enough to disappear into it — so the charts on the dashboard,
 * analytics and monitoring pages were all effectively unreadable with the theme switched. Charts
 * are SVG, so none of the `dark:` utilities used everywhere else reach inside them; the values
 * have to be passed as props, which means they have to come from somewhere shared.
 *
 * Recharts also gives assistive technology nothing at all — a chart is an unlabelled <svg>. Each
 * caller pairs its chart with a text summary; `srSummary` below is the helper for that.
 */

/** Tracks the `dark` class the header toggles on <html>. There is no theme store to read. */
export function useIsDark() {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(el.classList.contains('dark')));
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function useChartTheme() {
  const isDark = useIsDark();

  return {
    isDark,
    grid: isDark ? '#374151' : '#f0f0f0',
    axis: isDark ? '#4b5563' : '#d1d5db',
    tick: { fontSize: 11, fill: isDark ? '#9ca3af' : '#6b7280' },
    tickSmall: { fontSize: 10, fill: isDark ? '#9ca3af' : '#6b7280' },
    legend: { fontSize: 12, color: isDark ? '#d1d5db' : '#374151' },
    tooltip: {
      contentStyle: {
        backgroundColor: isDark ? '#1f2937' : '#ffffff',
        border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
        borderRadius: '0.75rem',
        fontSize: '0.8125rem',
        color: isDark ? '#f9fafb' : '#111827',
      },
      labelStyle: { color: isDark ? '#f9fafb' : '#111827', fontWeight: 600 },
      itemStyle: { color: isDark ? '#d1d5db' : '#374151' },
      cursor: { fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
    },
  };
}

/**
 * Categorical series colours.
 *
 * Held in one place so a chart cannot quietly introduce a hue the rest of the app does not use —
 * the audit log and announcement pages had both drifted into purple and teal that way. Ordered
 * so the first few stay distinguishable in the common two- and three-series cases.
 */
export const SERIES_COLORS = ['#1e3a5f', '#f5c518', '#16a34a', '#2563eb', '#dc2626', '#0891b2', '#7c3aed'];

/** Cycles rather than returning undefined once a dataset outgrows the palette. */
export const seriesColor = (i) => SERIES_COLORS[i % SERIES_COLORS.length];

/**
 * A one-line text equivalent of a chart, for screen readers.
 * `pairs` is [[label, value], ...] already formatted for display.
 */
export const srSummary = (title, pairs) =>
  `${title}: ${pairs.map(([label, value]) => `${label}, ${value}`).join('; ')}.`;
