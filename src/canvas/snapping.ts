import type { Pt, Rect } from './geometry';

export interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const xs = (r: Rect) => [r.x, r.x + r.width / 2, r.x + r.width];
const ys = (r: Rect) => [r.y, r.y + r.height / 2, r.y + r.height];

function bestDelta(sources: number[], targets: number[][], threshold: number): number {
  let best = Infinity;
  for (const t of targets)
    for (const tv of t)
      for (const sv of sources) {
        const d = tv - sv;
        if (Math.abs(d) <= threshold && Math.abs(d) < Math.abs(best)) best = d;
      }
  return isFinite(best) ? best : 0;
}

/** Guias para as bordas/centros que coincidem com algum alvo. */
export function guidesFor(r: Rect, targets: Rect[], allowX = true, allowY = true): Guide[] {
  const out: Guide[] = [];
  const eps = 0.01;
  for (const t of targets) {
    if (allowX)
      for (const tv of xs(t))
        if (xs(r).some((v) => Math.abs(v - tv) < eps))
          out.push({ x1: tv, y1: Math.min(r.y, t.y), x2: tv, y2: Math.max(r.y + r.height, t.y + t.height) });
    if (allowY)
      for (const tv of ys(t))
        if (ys(r).some((v) => Math.abs(v - tv) < eps))
          out.push({ x1: Math.min(r.x, t.x), y1: tv, x2: Math.max(r.x + r.width, t.x + t.width), y2: tv });
  }
  return out;
}

export function snapRect(r: Rect, targets: Rect[], threshold: number, allowX = true, allowY = true) {
  const dx = allowX ? bestDelta(xs(r), targets.map(xs), threshold) : 0;
  const dy = allowY ? bestDelta(ys(r), targets.map(ys), threshold) : 0;
  const moved = { ...r, x: r.x + dx, y: r.y + dy };
  return { dx, dy, guides: guidesFor(moved, targets, allowX, allowY) };
}

export function snapPoint(p: Pt, targets: Rect[], threshold: number, allowX = true, allowY = true) {
  const dx = allowX ? bestDelta([p.x], targets.map(xs), threshold) : 0;
  const dy = allowY ? bestDelta([p.y], targets.map(ys), threshold) : 0;
  const q = { x: p.x + dx, y: p.y + dy };
  const guides: Guide[] = [];
  for (const t of targets) {
    if (allowX && dx !== 0 && xs(t).some((v) => Math.abs(v - q.x) < 0.01))
      guides.push({ x1: q.x, y1: Math.min(q.y, t.y), x2: q.x, y2: Math.max(q.y, t.y + t.height) });
    if (allowY && dy !== 0 && ys(t).some((v) => Math.abs(v - q.y) < 0.01))
      guides.push({ x1: Math.min(q.x, t.x), y1: q.y, x2: Math.max(q.x, t.x + t.width), y2: q.y });
  }
  return { point: q, guides };
}
