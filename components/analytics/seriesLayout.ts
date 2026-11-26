import { niceStep } from './analyticsUi';

// Geometry of the net worth line chart (pure; unit-tested). Days without a value are GAPS: the line stops and starts
// again, nothing is drawn there, and nothing is interpolated or set to zero. Time runs left to right like the other
// Analytics charts. Straight segments only (no smoothing that would imply values that never existed).

export interface SeriesValue {
  value: number | null;
}

export interface SeriesLayout {
  // One polyline per run of consecutive days with a value ("M x y L x y …"), and its area down to the bottom.
  lines: string[];
  areas: string[];
  // Days alone between two gaps: drawn as a dot (a one-point line is invisible).
  dots: { x: number; y: number }[];
  // The y of each day with a value (null in gaps), for the inspect marker.
  ys: (number | null)[];
  xs: number[];
  min: number;
  max: number;
  hasValues: boolean;
}

export function seriesLayout(points: readonly SeriesValue[], width: number, height: number, pad = 6): SeriesLayout {
  const values = points.map((p) => p.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const empty: SeriesLayout = { lines: [], areas: [], dots: [], ys: points.map(() => null), xs: [], min: 0, max: 0, hasValues: false };
  if (values.length === 0 || width <= 0 || height <= 0) return empty;
  let min = Math.min(...values);
  let max = Math.max(...values);
  // A flat series sits in the middle instead of on an edge.
  if (max - min < 1e-9) {
    const spread = Math.max(1, Math.abs(max) * 0.05);
    min -= spread;
    max += spread;
  }
  const n = points.length;
  const xs = points.map((_, i) => (n === 1 ? width / 2 : pad + ((width - 2 * pad) * i) / (n - 1)));
  const y = (v: number) => pad + (height - 2 * pad) * (1 - (v - min) / (max - min));
  const ys = points.map((p) => (p.value === null || !Number.isFinite(p.value) ? null : y(p.value)));
  const lines: string[] = [];
  const areas: string[] = [];
  const dots: { x: number; y: number }[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length === 1) dots.push({ x: xs[run[0]], y: ys[run[0]]! });
    else if (run.length > 1) {
      const line = run.map((i, k) => `${k === 0 ? 'M' : 'L'}${xs[i].toFixed(1)} ${ys[i]!.toFixed(1)}`).join(' ');
      lines.push(line);
      areas.push(`${line} L${xs[run[run.length - 1]].toFixed(1)} ${height.toFixed(1)} L${xs[run[0]].toFixed(1)} ${height.toFixed(1)} Z`);
    }
    run = [];
  };
  points.forEach((_, i) => {
    if (ys[i] === null) flush();
    else run.push(i);
  });
  flush();
  return { lines, areas, dots, ys, xs, min, max, hasValues: true };
}

// The day under a touch at `x` (nearest day, clamped).
export function indexAt(x: number, count: number, width: number, pad = 6): number {
  if (count <= 1) return 0;
  const ratio = (x - pad) / Math.max(1, width - 2 * pad);
  return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
}

// --- Grouped bars (income vs spending) -------------------------------------------------------------------------------

export interface BarSlot {
  // Left edge and width of the slot; the two bars inside it (income first, then spending, left to right).
  x: number;
  width: number;
  income: { x: number; y: number; h: number };
  expense: { x: number; y: number; h: number };
}

export interface BarsLayout {
  slots: BarSlot[];
  // Gridline values (0 at the bottom) and their y.
  ticks: { value: number; y: number }[];
  plotLeft: number;
  plotBottom: number;
  barWidth: number;
}

// Bars of two non-negative series in `width` × `height`, with a round axis (chartAxis-like steps) and room on the
// left for the tick labels. Time runs left to right. Zero heights stay zero (no minimum bar is invented).
export function groupedBars(rows: readonly { income: number; expense: number }[], width: number, height: number, axisWidth = 40): BarsLayout {
  const max = Math.max(0, ...rows.flatMap((r) => [r.income, r.expense]));
  const step = niceStep(max, 4);
  const top = Math.max(step, Math.ceil(max / step - 1e-9) * step);
  const plotLeft = axisWidth;
  const plotBottom = height;
  const plotHeight = height - 8;
  const scale = (v: number) => (top > 0 ? (Math.max(0, v) / top) * plotHeight : 0);
  const n = Math.max(1, rows.length);
  const slotWidth = (width - plotLeft) / n;
  const bar = Math.max(3, Math.min(18, slotWidth * 0.32));
  const gap = Math.min(4, slotWidth * 0.06);
  const slots = rows.map((r, i) => {
    const x = plotLeft + i * slotWidth;
    const mid = x + slotWidth / 2;
    const hi = scale(r.income);
    const he = scale(r.expense);
    return {
      x,
      width: slotWidth,
      income: { x: mid - gap / 2 - bar, y: plotBottom - hi, h: hi },
      expense: { x: mid + gap / 2, y: plotBottom - he, h: he },
    };
  });
  const ticks: { value: number; y: number }[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push({ value: v, y: plotBottom - scale(v) });
  return { slots, ticks, plotLeft, plotBottom, barWidth: bar };
}

// The bar under a touch at `x` (clamped).
export function slotAt(x: number, layout: Pick<BarsLayout, 'slots' | 'plotLeft'>): number {
  if (layout.slots.length === 0) return 0;
  const w = layout.slots[0].width;
  return Math.min(layout.slots.length - 1, Math.max(0, Math.floor((x - layout.plotLeft) / w)));
}

// --- Sparklines -----------------------------------------------------------------------------------------------------

export interface SparkLayout {
  lines: string[];
  // Lone closed values (a run of one).
  dots: { x: number; y: number }[];
  // The running last value, drawn hollow and NOT joined to the line.
  hollow: { x: number; y: number } | null;
}

// A sparkline on the scale of all values; gaps (null) break it; with `lastInProgress` the last value is a hollow dot.
export function sparkLayout(values: readonly (number | null)[], lastInProgress: boolean, width: number, height: number, pad = 3): SparkLayout {
  const all = seriesLayout(values.map((value) => ({ value })), width, height, pad);
  if (!all.hasValues) return { lines: [], dots: [], hollow: null };
  const last = values.length - 1;
  const end = lastInProgress ? last : values.length;
  const lines: string[] = [];
  const dots: { x: number; y: number }[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length === 1) dots.push({ x: all.xs[run[0]], y: all.ys[run[0]]! });
    else if (run.length > 1) lines.push(run.map((i, k) => `${k === 0 ? 'M' : 'L'}${all.xs[i].toFixed(1)} ${all.ys[i]!.toFixed(1)}`).join(' '));
    run = [];
  };
  for (let i = 0; i < end; i++) {
    if (all.ys[i] === null) flush();
    else run.push(i);
  }
  flush();
  const hollow = lastInProgress && all.ys[last] !== null ? { x: all.xs[last], y: all.ys[last]! } : null;
  return { lines, dots, hollow };
}

// --- Donut -----------------------------------------------------------------------------------------------------------

export interface DonutSlice {
  // SVG path of the ring segment.
  d: string;
  // Angles in radians, clockwise from 12 o'clock.
  start: number;
  end: number;
}

// Ring segments for `values` (non-negative), largest-first order kept, clockwise from the top. A single value is a full
// ring (two half arcs, since one arc can't close on itself). Zero values get no slice (an empty path).
export function donutSlices(values: readonly number[], cx: number, cy: number, outer: number, inner: number): DonutSlice[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (!(total > 0)) return values.map(() => ({ d: '', start: 0, end: 0 }));
  const point = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  const arc = (start: number, end: number) => {
    const large = end - start > Math.PI ? 1 : 0;
    return `M${point(outer, start)} A${outer} ${outer} 0 ${large} 1 ${point(outer, end)} L${point(inner, end)} A${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`;
  };
  let angle = 0;
  return values.map((v) => {
    const sweep = (Math.max(0, v) / total) * 2 * Math.PI;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    if (sweep <= 0) return { d: '', start, end };
    const d = sweep >= 2 * Math.PI - 1e-9 ? `${arc(0, Math.PI)} ${arc(Math.PI, 2 * Math.PI)}` : arc(start, end);
    return { d, start, end };
  });
}

// The slice under a touch at (x, y), or null outside the ring.
export function sliceAt(x: number, y: number, cx: number, cy: number, outer: number, inner: number, slices: readonly DonutSlice[]): number | null {
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  if (r < inner || r > outer) return null;
  let a = Math.atan2(dx, -dy);
  if (a < 0) a += 2 * Math.PI;
  const index = slices.findIndex((s) => s.end > s.start && a >= s.start && a < s.end);
  return index >= 0 ? index : null;
}

// --- Single-series bars with a reference line ---------------------------------------------------------------------------

export interface SingleBars {
  bars: { x: number; y: number; w: number; h: number }[];
  ticks: { value: number; y: number }[];
  // The y of the reference value (e.g. the average); null without one.
  refY: number | null;
  plotLeft: number;
  slotWidth: number;
}

export function singleBars(values: readonly number[], width: number, height: number, reference: number | null, axisWidth = 40): SingleBars {
  const max = Math.max(0, reference ?? 0, ...values);
  const step = niceStep(max, 4);
  const top = Math.max(step, Math.ceil(max / step - 1e-9) * step);
  const plotHeight = height - 8;
  const scale = (v: number) => (top > 0 ? (Math.max(0, v) / top) * plotHeight : 0);
  const n = Math.max(1, values.length);
  const slotWidth = (width - axisWidth) / n;
  const w = Math.max(1, Math.min(16, slotWidth * 0.7));
  const bars = values.map((v, i) => ({ x: axisWidth + i * slotWidth + (slotWidth - w) / 2, y: height - scale(v), w, h: scale(v) }));
  const ticks: { value: number; y: number }[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push({ value: v, y: height - scale(v) });
  return { bars, ticks, refY: reference === null ? null : height - scale(reference), plotLeft: axisWidth, slotWidth };
}
