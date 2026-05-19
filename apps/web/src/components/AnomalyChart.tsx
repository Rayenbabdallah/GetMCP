interface AnomalyPoint {
  id: string;
  timestamp: string;
  agentId: string | null;
  method: string;
  path: string;
  actionTaken: string;
  anomalyScore: number;
}

interface Props {
  data: AnomalyPoint[];
  windowHours: number;
  threshold?: number;     // visual reference line; default 0.95
  height?: number;
  onPointClick?: (p: AnomalyPoint) => void;
}

/**
 * Pure-SVG scatter of anomaly scores over time. No chart-library dep.
 * X axis = time, Y axis = score [0..1]. Points colored by actionTaken.
 * A reference line is drawn at `threshold` (default 0.95).
 *
 * Designed for the Dashboard: one glance tells you the noise floor and
 * whether anything pierced the threshold recently.
 */
export function AnomalyChart({ data, windowHours, threshold = 0.95, height = 220, onPointClick }: Props) {
  const PAD = { top: 16, right: 12, bottom: 28, left: 36 };
  const W = 800; // SVG viewBox width, scales responsively
  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const now = Date.now();
  const windowMs = windowHours * 60 * 60 * 1000;
  const xMin = now - windowMs;

  const x = (t: number) => PAD.left + ((t - xMin) / windowMs) * plotW;
  const y = (s: number) => PAD.top + (1 - Math.max(0, Math.min(1, s))) * plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];
  const xTickCount = Math.min(6, Math.max(2, Math.ceil(windowHours / 4)));
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) =>
    xMin + (windowMs * i) / xTickCount,
  );

  function colorFor(p: AnomalyPoint): string {
    if (p.actionTaken === 'BLOCKED') return '#dc2626';        // red-600
    if (p.actionTaken === 'AWAITING_APPROVAL') return '#d97706'; // amber-600
    return '#2f6364';                                          // brand-600
  }

  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">
        No scored requests in the last {windowHours}h. Configure a BEHAVIORAL_ANOMALY policy and
        send some traffic to populate this chart.
      </div>
    );
  }

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Anomaly scores over the last ${windowHours} hours`}
      >
        {/* Y grid + labels */}
        {yTicks.map((t) => (
          <g key={`y-${t}`}>
            <line
              x1={PAD.left}
              y1={y(t)}
              x2={W - PAD.right}
              y2={y(t)}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(t) + 3}
              textAnchor="end"
              fontSize="10"
              fill="#94a3b8"
            >
              {t.toFixed(2)}
            </text>
          </g>
        ))}

        {/* Threshold line */}
        <line
          x1={PAD.left}
          y1={y(threshold)}
          x2={W - PAD.right}
          y2={y(threshold)}
          stroke="#dc2626"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <text
          x={W - PAD.right - 4}
          y={y(threshold) - 4}
          textAnchor="end"
          fontSize="10"
          fill="#dc2626"
          fontWeight="600"
        >
          threshold {threshold}
        </text>

        {/* X ticks */}
        {xTicks.map((t, i) => (
          <g key={`x-${i}`}>
            <line
              x1={x(t)}
              y1={H - PAD.bottom}
              x2={x(t)}
              y2={H - PAD.bottom + 4}
              stroke="#cbd5e1"
              strokeWidth={1}
            />
            <text
              x={x(t)}
              y={H - PAD.bottom + 16}
              textAnchor="middle"
              fontSize="10"
              fill="#94a3b8"
            >
              {formatXTick(new Date(t), windowHours)}
            </text>
          </g>
        ))}

        {/* Axes */}
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={H - PAD.bottom}
          stroke="#cbd5e1"
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          y1={H - PAD.bottom}
          x2={W - PAD.right}
          y2={H - PAD.bottom}
          stroke="#cbd5e1"
          strokeWidth={1}
        />

        {/* Data points */}
        {data.map((p) => {
          const t = new Date(p.timestamp).getTime();
          if (t < xMin || t > now) return null;
          const cx = x(t);
          const cy = y(p.anomalyScore);
          const r = p.anomalyScore >= threshold ? 5 : 3.5;
          return (
            <circle
              key={p.id}
              cx={cx}
              cy={cy}
              r={r}
              fill={colorFor(p)}
              fillOpacity={p.anomalyScore >= threshold ? 0.9 : 0.55}
              stroke={p.anomalyScore >= threshold ? '#7f1d1d' : 'transparent'}
              strokeWidth={p.anomalyScore >= threshold ? 1 : 0}
              onClick={onPointClick ? () => onPointClick(p) : undefined}
              style={onPointClick ? { cursor: 'pointer' } : undefined}
            >
              <title>{`${p.method} ${p.path}\nscore ${p.anomalyScore.toFixed(2)} — ${p.actionTaken}\n${new Date(p.timestamp).toLocaleString()}`}</title>
            </circle>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-end gap-4 px-2 text-xs text-slate-500">
        <LegendDot color="#2f6364" label="executed / observed" />
        <LegendDot color="#d97706" label="approval requested" />
        <LegendDot color="#dc2626" label="blocked" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function formatXTick(d: Date, windowHours: number): string {
  if (windowHours <= 24) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
}
