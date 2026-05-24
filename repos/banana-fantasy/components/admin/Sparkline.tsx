'use client';

/**
 * Tiny inline SVG sparkline. No external dep, no Canvas — just a polyline
 * sized to the parent's font (default 28×8 px) so it sits next to a KPI
 * number without throwing the layout off.
 *
 * Pass a flat number array (oldest → newest). Heights auto-scale to the
 * series min/max. Renders nothing when fewer than 2 points exist.
 *
 * The visual is intentionally subtle — banana-yellow stroke at low
 * opacity, no fill, no axis. Reading the trend is the only job; the
 * actual values live in the KPI label next to it.
 */

interface Props {
  values: number[];
  width?: number;
  height?: number;
  /** Stroke color (CSS color). Default banana yellow at 80% opacity. */
  color?: string;
  className?: string;
}

export function Sparkline({
  values,
  width = 56,
  height = 16,
  color = 'rgba(251, 191, 36, 0.8)',
  className = '',
}: Props) {
  if (!Array.isArray(values) || values.length < 2) {
    return <span className={`inline-block ${className}`} style={{ width, height }} />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  // Map each value → (x, y). y inverts because SVG origin is top-left.
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block align-middle ${className}`}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
