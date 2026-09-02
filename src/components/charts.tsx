import { useId, useMemo, useState } from "react";
import type { Tone } from "./ui";

const TONE_VAR: Record<Tone, string> = {
  good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)",
  neutral: "var(--text-faint)", info: "var(--info)", accent: "var(--accent)",
};

// --- gauge -------------------------------------------------------------------

/** Semicircular score dial. `value` is 0-100. */
export function Gauge({
  value, label, tone = "accent", size = 132,
}: { value: number; label?: string; tone?: Tone; size?: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const stroke = 11;
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  // Half circle: start bottom-left, sweep over the top to bottom-right.
  const path = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;
  const length = Math.PI * radius;

  return (
    <div className="gauge-wrap">
      <svg width={size} height={size / 2 + 6} viewBox={`0 0 ${size} ${size / 2 + 6}`} className="chart" role="img" aria-label={`${label ?? "score"}: ${Math.round(clamped)} de 100`}>
        <path d={path} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} strokeLinecap="round" />
        <path
          d={path} fill="none" stroke={TONE_VAR[tone]} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * length} ${length}`}
          style={{ transition: "stroke-dasharray 0.5s ease" }}
        />
      </svg>
      <div>
        <div className="gauge-value" style={{ color: TONE_VAR[tone] }}>{Math.round(clamped)}</div>
        {label ? <div className="gauge-label">{label}</div> : null}
      </div>
    </div>
  );
}

// --- bars --------------------------------------------------------------------

export interface BarDatum {
  label: string;
  value: number;
  tone?: Tone;
  hint?: string;
}

export function BarChart({
  data, height = 170, format = (v: number) => String(Math.round(v)), horizontal = false,
}: { data: BarDatum[]; height?: number; format?: (value: number) => string; horizontal?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hover, setHover] = useState<number | null>(null);

  if (!data.length) return <div className="empty small">Sin datos suficientes</div>;

  if (horizontal) {
    return (
      <div className="stack-sm">
        {data.map((datum, i) => (
          <div key={datum.label + i} title={datum.hint}>
            <div className="row small" style={{ justifyContent: "space-between", marginBottom: 3 }}>
              <span className="truncate" style={{ maxWidth: "70%" }}>{datum.label}</span>
              <span className="num faint">{format(datum.value)}</span>
            </div>
            <div className="meter">
              <span style={{ width: `${(datum.value / max) * 100}%`, background: TONE_VAR[datum.tone ?? "accent"] }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const gap = 6;
  const barWidth = 100 / data.length;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="chart" style={{ height }}>
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            key={fraction} className="grid-line" vectorEffect="non-scaling-stroke"
            x1={0} x2={100} y1={height - fraction * (height - 22)} y2={height - fraction * (height - 22)}
          />
        ))}
        {data.map((datum, i) => {
          const barHeight = (datum.value / max) * (height - 26);
          return (
            <rect
              key={datum.label + i} className="bar"
              x={i * barWidth + gap / 10} width={barWidth - gap / 5}
              y={height - 18 - barHeight} height={Math.max(1, barHeight)}
              fill={TONE_VAR[datum.tone ?? "accent"]} rx={0.6}
              opacity={hover === null || hover === i ? 1 : 0.42}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            >
              <title>{datum.hint ?? `${datum.label}: ${format(datum.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="row" style={{ gap: 0, marginTop: 2 }}>
        {data.map((datum, i) => (
          <div
            key={datum.label + i}
            className="tiny faint center truncate"
            style={{ width: `${barWidth}%`, opacity: hover === null || hover === i ? 1 : 0.45 }}
          >
            {datum.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- donut -------------------------------------------------------------------

export function Donut({
  segments, size = 108, centerLabel, centerValue,
}: {
  segments: Array<{ label: string; value: number; tone: Tone }>;
  size?: number; centerLabel?: string; centerValue?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const stroke = 13;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="row" style={{ gap: 16 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="chart" style={{ flex: "none" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        {total > 0 && segments.map((segment) => {
          const fraction = segment.value / total;
          const dash = fraction * circumference;
          const element = (
            <circle
              key={segment.label}
              cx={size / 2} cy={size / 2} r={radius} fill="none"
              stroke={TONE_VAR[segment.tone]} strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${segment.label}: ${Math.round(fraction * 100)}%`}</title>
            </circle>
          );
          offset += dash;
          return element;
        })}
        {centerValue ? (
          <>
            <text x="50%" y="47%" textAnchor="middle" style={{ fontSize: 17, fontWeight: 700, fill: "var(--text)" }}>{centerValue}</text>
            <text x="50%" y="62%" textAnchor="middle" style={{ fontSize: 8.5 }}>{centerLabel}</text>
          </>
        ) : null}
      </svg>
      <div className="stack-sm" style={{ minWidth: 0 }}>
        {segments.map((segment) => (
          <div key={segment.label} className="row-tight small">
            <span className="dot" style={{ background: TONE_VAR[segment.tone] }} />
            <span className="truncate">{segment.label}</span>
            <span className="faint num">{total > 0 ? `${Math.round((segment.value / total) * 100)}%` : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- line / sparkline --------------------------------------------------------

export interface SeriesPoint { x: number; y: number | null; }

/** Compact trend line. `invert` flips the axis for rank series, where down is good. */
export function Sparkline({
  points, width = 110, height = 30, tone = "info", invert = false,
}: { points: SeriesPoint[]; width?: number; height?: number; tone?: Tone; invert?: boolean }) {
  const valid = points.filter((p): p is { x: number; y: number } => p.y !== null);
  if (valid.length < 2) return <span className="faint tiny">sin histórico</span>;

  const xs = valid.map((p) => p.x);
  const ys = valid.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const path = valid.map((point, i) => {
    const x = ((point.x - minX) / spanX) * width;
    const ratio = (point.y - minY) / spanY;
    const y = (invert ? ratio : 1 - ratio) * (height - 4) + 2;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="chart" style={{ flex: "none" }}>
      <path d={path} fill="none" stroke={TONE_VAR[tone]} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Full-size chart with axes, used on the book detail page. */
export function LineChart({
  points, height = 220, invert = false, tone = "info", formatY = (v: number) => String(Math.round(v)), label,
}: {
  points: SeriesPoint[]; height?: number; invert?: boolean; tone?: Tone;
  formatY?: (value: number) => string; label?: string;
}) {
  const gradientId = useId();
  const valid = useMemo(
    () => points.filter((p): p is { x: number; y: number } => p.y !== null).sort((a, b) => a.x - b.x),
    [points],
  );

  if (valid.length < 2) {
    return <div className="empty small">Aún no hay suficiente histórico. Se toma una muestra al día.</div>;
  }

  const width = 640;
  const padL = 52, padR = 12, padT = 12, padB = 26;
  const xs = valid.map((p) => p.x), ys = valid.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minY === maxY) { minY = minY * 0.9; maxY = maxY * 1.1 || 1; }

  const px = (x: number) => padL + ((x - minX) / (maxX - minX || 1)) * (width - padL - padR);
  const py = (y: number) => {
    const ratio = (y - minY) / (maxY - minY || 1);
    return padT + (invert ? ratio : 1 - ratio) * (height - padT - padB);
  };

  const line = valid.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${px(valid[valid.length - 1].x).toFixed(1)},${height - padB} L${px(valid[0].x).toFixed(1)},${height - padB} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => minY + f * (maxY - minY));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" style={{ height, width: "100%" }} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TONE_VAR[tone]} stopOpacity="0.24" />
          <stop offset="100%" stopColor={TONE_VAR[tone]} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="grid-line" x1={padL} x2={width - padR} y1={py(tick)} y2={py(tick)} />
          <text x={padL - 7} y={py(tick) + 3} textAnchor="end">{formatY(tick)}</text>
        </g>
      ))}
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={TONE_VAR[tone]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {valid.map((point) => (
        <circle key={point.x} cx={px(point.x)} cy={py(point.y)} r={2.6} fill={TONE_VAR[tone]}>
          <title>{`${new Date(point.x).toLocaleDateString("es-ES")}: ${formatY(point.y)}`}</title>
        </circle>
      ))}
      <text x={padL} y={height - 8}>{new Date(minX).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</text>
      <text x={width - padR} y={height - 8} textAnchor="end">{new Date(maxX).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}</text>
    </svg>
  );
}

/** Bucket a numeric series into a histogram, e.g. review counts across the top 20. */
export function histogram(values: number[], buckets: Array<{ label: string; max: number; tone: Tone }>): BarDatum[] {
  return buckets.map((bucket, i) => {
    const min = i === 0 ? -Infinity : buckets[i - 1].max;
    const count = values.filter((v) => v > min && v <= bucket.max).length;
    return { label: bucket.label, value: count, tone: bucket.tone, hint: `${count} libros · ${bucket.label}` };
  });
}
