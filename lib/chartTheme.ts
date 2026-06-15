/**
 * Shared visual tokens for all Chart.js chart components.
 * Import these to ensure a consistent premium look across every chart.
 */

/** Base animation used by every chart */
export const CHART_ANIMATION = {
  duration: 450,
  easing: 'easeOutQuart' as const,
}

/** Dark-aware tooltip configuration */
export function tooltipCfg(isDark: boolean) {
  return {
    backgroundColor: isDark ? 'rgba(2,6,23,0.98)' : 'rgba(15,23,42,0.97)',
    titleColor: '#f8fafc',
    bodyColor: '#94a3b8',
    padding: { top: 12, right: 16, bottom: 12, left: 16 },
    cornerRadius: 14,
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
  }
}

/** Dark-aware Y-axis configuration */
export function yScaleCfg(
  isDark: boolean,
  opts?: {
    callback?: (v: number | string) => string | number | (string | number)[]
    maxTicksLimit?: number
    min?: number
    max?: number
  },
) {
  const txt  = isDark ? '#6b7280' : '#9ca3af'
  const grid = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'
  return {
    ...(opts?.min  !== undefined ? { min: opts.min }  : {}),
    ...(opts?.max  !== undefined ? { max: opts.max }  : {}),
    ticks: {
      ...(opts?.callback ? { callback: opts.callback } : {}),
      font: { size: 10 },
      maxTicksLimit: opts?.maxTicksLimit ?? 5,
      color: txt,
    },
    grid: { color: grid, lineWidth: 1 },
    border: { display: false },
  }
}

/** Dark-aware X-axis configuration */
export function xScaleCfg(
  isDark: boolean,
  opts?: { fontSize?: number; padding?: number },
) {
  return {
    ticks: {
      font: { size: opts?.fontSize ?? 11 },
      color: isDark ? '#6b7280' : '#9ca3af',
      padding: opts?.padding ?? 8,
    },
    grid: { display: false },
    border: { display: false },
  }
}

/** Legend config for line/bar charts — thin coloured line as indicator */
export function legendCfg(isDark: boolean) {
  return {
    position: 'bottom' as const,
    labels: {
      font: { size: 12 },
      boxWidth: 22,
      boxHeight: 2,
      padding: 20,
      usePointStyle: false,
      color: isDark ? '#6b7280' : '#9ca3af',
    },
  }
}
