import type { Pt } from './geometry';
import type { SceneNode, VectorPathCommand } from '../model/types';

export function polygonPoints(n: SceneNode): Pt[] {
  const count = Math.max(3, Math.round(n.pointCount ?? 3));
  const raw: Pt[] = [];
  if (n.type === 'STAR') {
    const ir = n.innerRadius ?? 0.38;
    for (let i = 0; i < count * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / count;
      const r = i % 2 ? ir : 1;
      raw.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
  } else {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
      raw.push({ x: Math.cos(a), y: Math.sin(a) });
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of raw) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const sw = maxX - minX || 1;
  const sh = maxY - minY || 1;
  return raw.map((p) => ({ x: ((p.x - minX) / sw) * n.width, y: ((p.y - minY) / sh) * n.height }));
}

export function vectorPoints(n: SceneNode): Pt[] {
  return (n.points ?? []).map((p) => ({ x: p.x * n.width, y: p.y * n.height }));
}

/** Geometria exata para achatar primitivas sem suavizar seus vértices. */
export function flattenPath(n: SceneNode): VectorPathCommand[] | null {
  const w = n.width;
  const h = n.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h < 0) return null;
  if (n.type === 'LINE') {
    // A ponta de seta é um segundo traço com estilo próprio no renderizador.
    if (n.arrowEnd) return null;
    return [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 1, y: 0 }];
  }
  if (h <= 0) return null;
  if (n.type === 'ELLIPSE') {
    return [
      { type: 'M', x: 1, y: 0.5 },
      { type: 'A', rx: 0.5, ry: 0.5, largeArc: true, sweep: true, x: 0, y: 0.5 },
      { type: 'A', rx: 0.5, ry: 0.5, largeArc: true, sweep: true, x: 1, y: 0.5 },
    ];
  }
  if (n.type === 'POLYGON' || n.type === 'STAR') {
    return polygonPoints(n).map((p, i) => ({ type: i ? 'L' : 'M', x: p.x / w, y: p.y / h }));
  }
  if (n.type !== 'RECTANGLE') return null;
  const r = Math.max(0, Math.min(n.cornerRadius || 0, w / 2, h / 2));
  if (!r) {
    return [
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: 1, y: 0 },
      { type: 'L', x: 1, y: 1 }, { type: 'L', x: 0, y: 1 },
    ];
  }
  const rx = r / w;
  const ry = r / h;
  const arc = (x: number, y: number): VectorPathCommand => ({ type: 'A', rx, ry, largeArc: false, sweep: true, x, y });
  return [
    { type: 'M', x: rx, y: 0 }, { type: 'L', x: 1 - rx, y: 0 }, arc(1, ry),
    { type: 'L', x: 1, y: 1 - ry }, arc(1 - rx, 1),
    { type: 'L', x: rx, y: 1 }, arc(0, 1 - ry),
    { type: 'L', x: 0, y: ry }, arc(rx, 0),
  ];
}

/** Caminho exato achatado ou caminho suavizado do lápis. */
export function vectorPathData(n: SceneNode): string {
  if (n.vectorPath) {
    // Expande ao tamanho atual, preservando também curvas em resize não uniforme.
    const d = n.vectorPath.map((c) => {
      const end = `${c.x * n.width} ${c.y * n.height}`;
      if (c.type === 'A') return `A${c.rx * n.width} ${c.ry * n.height} 0 ${+c.largeArc} ${+c.sweep} ${end}`;
      return `${c.type}${end}`;
    }).join(' ');
    return d && n.closed ? `${d} Z` : d;
  }
  const pts = vectorPoints(n);
  if (!pts.length) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  if (pts.length < 3) {
    for (const p of pts.slice(1)) d += ` L${f(p.x)} ${f(p.y)}`;
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q${f(pts[i].x)} ${f(pts[i].y)} ${f(mx)} ${f(my)}`;
    }
    const last = pts[pts.length - 1];
    d += ` L${f(last.x)} ${f(last.y)}`;
  }
  if (n.closed) d += ' Z';
  return d;
}

export function isOpenPath(n: SceneNode) {
  return n.type === 'LINE' || (n.type === 'VECTOR' && !n.closed);
}

export function shapePath(n: SceneNode): Path2D {
  const w = n.width;
  const h = n.height;
  switch (n.type) {
    case 'ELLIPSE': {
      const p = new Path2D();
      p.ellipse(w / 2, h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
      return p;
    }
    case 'POLYGON':
    case 'STAR': {
      const p = new Path2D();
      polygonPoints(n).forEach((pt, i) => (i ? p.lineTo(pt.x, pt.y) : p.moveTo(pt.x, pt.y)));
      p.closePath();
      return p;
    }
    case 'LINE': {
      const p = new Path2D();
      p.moveTo(0, 0);
      p.lineTo(w, 0);
      return p;
    }
    case 'VECTOR':
      return new Path2D(vectorPathData(n));
    default: {
      const p = new Path2D();
      const r = Math.max(0, Math.min(n.cornerRadius || 0, w / 2, h / 2));
      if (r > 0) p.roundRect(0, 0, w, h, r);
      else p.rect(0, 0, w, h);
      return p;
    }
  }
}

// ---------- texto ----------

let measureContext: CanvasRenderingContext2D | null = null;
function measureCtx() {
  if (!measureContext) measureContext = document.createElement('canvas').getContext('2d')!;
  return measureContext;
}

export const fontCss = (n: SceneNode) =>
  `${n.fontWeight ?? 400} ${n.fontSize ?? 12}px "${n.fontFamily ?? 'Inter'}", "Inter", sans-serif`;

export const lineHeightPx = (n: SceneNode) => n.lineHeight ?? Math.round((n.fontSize ?? 12) * 1.21 * 100) / 100;

export interface TextLine {
  text: string;
  width: number;
}
export interface TextLayout {
  lines: TextLine[];
  lineHeight: number;
  width: number;
  height: number;
}

export function applyTextStyle(ctx: CanvasRenderingContext2D, n: SceneNode) {
  ctx.font = fontCss(n);
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${n.letterSpacing ?? 0}px`;
}

export function layoutText(n: SceneNode): TextLayout {
  const ctx = measureCtx();
  applyTextStyle(ctx, n);
  const lh = lineHeightPx(n);
  const wrap = n.textAutoResize !== 'WIDTH_AND_HEIGHT';
  const maxW = n.width;
  const lines: TextLine[] = [];
  const measure = (s: string) => ctx.measureText(s).width;
  for (const para of (n.text ?? '').split('\n')) {
    if (!wrap) {
      lines.push({ text: para, width: measure(para) });
      continue;
    }
    const tokens = para.split(/(\s+)/);
    let line = '';
    for (const tok of tokens) {
      if (!tok) continue;
      const cand = line + tok;
      if (line.trim() && measure(cand.trimEnd()) > maxW + 0.01) {
        const t = line.trimEnd();
        lines.push({ text: t, width: measure(t) });
        line = tok.trimStart();
      } else line = cand;
    }
    lines.push({ text: line, width: measure(line) });
  }
  const width = wrap ? maxW : Math.max(1, ...lines.map((l) => l.width));
  return { lines, lineHeight: lh, width, height: Math.max(lh, lines.length * lh) };
}

/** Ajusta a caixa do texto conforme o modo de redimensionamento automático. */
export function fitTextBox(n: SceneNode) {
  if (n.type !== 'TEXT') return;
  const mode = n.textAutoResize ?? 'WIDTH_AND_HEIGHT';
  if (mode === 'NONE') return;
  const layout = layoutText(n);
  if (mode === 'WIDTH_AND_HEIGHT') n.width = Math.ceil(layout.width);
  n.height = layout.height;
}

export function lineX(n: SceneNode, lineWidth: number) {
  if (n.textAlign === 'CENTER') return (n.width - lineWidth) / 2;
  if (n.textAlign === 'RIGHT') return n.width - lineWidth;
  return 0;
}
