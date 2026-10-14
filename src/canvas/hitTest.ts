import { IDENTITY, type Mat, type Pt, applyMat, invert, multiply, pointInPolygon, rectFromPoints } from './geometry';
import { isOpenPath, shapePath } from './shapes';
import {
  ancestors,
  boundsOf,
  boxCorners,
  getPage,
  isDescendant,
  localMatrix,
  worldMatrix,
} from '../model/document';
import type { DocumentData, SceneNode } from '../model/types';

export interface Hit {
  id: string;
  /** Fundo de um frame de nível superior que tem filhos (clicar inicia seleção por área). */
  topFrameBg: boolean;
}

let hitContext: CanvasRenderingContext2D | null = null;
function hitCtx() {
  if (!hitContext) hitContext = document.createElement('canvas').getContext('2d')!;
  return hitContext;
}

export function hitShape(n: SceneNode, lp: Pt, tol: number): boolean {
  if (n.type === 'TEXT') return lp.x >= -tol && lp.y >= -tol && lp.x <= n.width + tol && lp.y <= n.height + tol;
  const ctx = hitCtx();
  const path = shapePath(n);
  const open = isOpenPath(n);
  const hasFill = !open && n.fills.some((f) => f.visible);
  if (hasFill && ctx.isPointInPath(path, lp.x, lp.y)) return true;
  const hasStroke = n.strokes.some((s) => s.visible) && n.strokeWeight > 0;
  if (open || hasStroke || !hasFill) {
    ctx.lineWidth = (open || hasStroke ? n.strokeWeight : 0) + tol * 2;
    return ctx.isPointInStroke(path, lp.x, lp.y);
  }
  return false;
}

function visit(doc: DocumentData, ids: string[], parentWorld: Mat, wp: Pt, tol: number, topLevel: boolean): Hit | null {
  for (let i = ids.length - 1; i >= 0; i--) {
    const n = doc.nodes[ids[i]];
    if (!n || !n.visible || n.locked) continue;
    const w = multiply(parentWorld, localMatrix(n));
    if (n.type === 'GROUP') {
      const h = visit(doc, n.children ?? [], w, wp, tol, false);
      if (h) return h;
      continue;
    }
    const lp = applyMat(invert(w), wp);
    if (n.type === 'FRAME') {
      const inside = lp.x >= 0 && lp.y >= 0 && lp.x <= n.width && lp.y <= n.height;
      if (!n.clipsContent || inside) {
        const h = visit(doc, n.children ?? [], w, wp, tol, false);
        if (h) return h;
      }
      if (inside) return { id: n.id, topFrameBg: topLevel && (n.children?.length ?? 0) > 0 };
      continue;
    }
    if (hitShape(n, lp, tol)) return { id: n.id, topFrameBg: false };
  }
  return null;
}

export function hitTest(doc: DocumentData, pageId: string, wp: Pt, zoom: number): Hit | null {
  const page = getPage(doc, pageId);
  if (!page) return null;
  return visit(doc, page.children, IDENTITY, wp, 4 / zoom, true);
}

/**
 * Converte o nó atingido no nó que deve ser selecionado: grupos capturam o
 * clique, a menos que a seleção atual já esteja dentro deles.
 */
export function resolveSelectable(doc: DocumentData, leafId: string, selection: string[]): string {
  const chain = [...ancestors(doc, leafId)].reverse();
  for (const node of chain) {
    if (node.type !== 'GROUP') continue;
    const entered = selection.some((s) => isDescendant(doc, s, node.id));
    if (!entered) return node.id;
  }
  return leafId;
}

/** Frame mais profundo (e mais acima) que contém o ponto. */
export function deepestFrameAt(doc: DocumentData, pageId: string, wp: Pt, exclude?: Set<string>): string | null {
  const page = getPage(doc, pageId);
  if (!page) return null;
  const walk = (ids: string[], parentWorld: Mat): string | null => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const n = doc.nodes[ids[i]];
      if (!n || !n.visible || exclude?.has(n.id)) continue;
      const w = multiply(parentWorld, localMatrix(n));
      if (n.type === 'GROUP') {
        const r = walk(n.children ?? [], w);
        if (r) return r;
        continue;
      }
      if (n.type !== 'FRAME') continue;
      const lp = applyMat(invert(w), wp);
      if (lp.x >= 0 && lp.y >= 0 && lp.x <= n.width && lp.y <= n.height) return walk(n.children ?? [], w) ?? n.id;
    }
    return null;
  };
  return walk(page.children, IDENTITY);
}

// ---------- moldura da seleção ----------

export type SelectionFrame =
  | null
  | { kind: 'line'; id: string; a: Pt; b: Pt }
  | { kind: 'box'; corners: Pt[]; single: string | null; width: number; height: number };

export function getSelectionFrame(doc: DocumentData, selection: string[]): SelectionFrame {
  const ids = selection.filter((id) => doc.nodes[id]);
  if (!ids.length) return null;
  if (ids.length === 1) {
    const n = doc.nodes[ids[0]];
    const m = worldMatrix(doc, n.id);
    if (n.type === 'LINE') return { kind: 'line', id: n.id, a: applyMat(m, { x: 0, y: 0 }), b: applyMat(m, { x: n.width, y: 0 }) };
    return {
      kind: 'box',
      corners: boxCorners(n.width, n.height).map((p) => applyMat(m, p)),
      single: n.id,
      width: n.width,
      height: n.height,
    };
  }
  const r = boundsOf(doc, ids)!;
  return {
    kind: 'box',
    corners: boxCorners(r.width, r.height).map((p) => ({ x: p.x + r.x, y: p.y + r.y })),
    single: null,
    width: r.width,
    height: r.height,
  };
}

export function pointInSelection(sf: SelectionFrame, wp: Pt): boolean {
  if (!sf || sf.kind !== 'box') return false;
  return pointInPolygon(wp, sf.corners);
}

// ---------- rótulos dos frames ----------

export interface FrameLabel {
  id: string;
  text: string;
  origin: Pt; // tela
  angle: number;
  width: number;
  poly: Pt[]; // tela
}

let labelCtx: CanvasRenderingContext2D | null = null;
export const LABEL_FONT = '450 11px Inter, "Segoe UI", sans-serif';

function truncate(text: string, maxWidth: number): { text: string; width: number } {
  if (!labelCtx) labelCtx = document.createElement('canvas').getContext('2d')!;
  labelCtx.font = LABEL_FONT;
  let w = labelCtx.measureText(text).width;
  if (w <= maxWidth) return { text, width: w };
  let t = text;
  while (t.length > 1 && labelCtx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  t += '…';
  w = labelCtx.measureText(t).width;
  return { text: t, width: w };
}

export function frameLabels(doc: DocumentData, pageId: string, cam: { x: number; y: number; zoom: number }): FrameLabel[] {
  const page = getPage(doc, pageId);
  if (!page) return [];
  const out: FrameLabel[] = [];
  const toScreen = (p: Pt) => ({ x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y });
  for (const id of page.children) {
    const n = doc.nodes[id];
    if (!n || n.type !== 'FRAME' || !n.visible) continue;
    const m = worldMatrix(doc, id);
    const p0 = toScreen(applyMat(m, { x: 0, y: 0 }));
    const p1 = toScreen(applyMat(m, { x: n.width, y: 0 }));
    const span = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (span < 12) continue;
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const t = truncate(n.name, span);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const local = [
      { x: 0, y: -20 },
      { x: t.width + 2, y: -20 },
      { x: t.width + 2, y: -2 },
      { x: 0, y: -2 },
    ];
    const poly = local.map((q) => ({ x: p0.x + q.x * cos - q.y * sin, y: p0.y + q.x * sin + q.y * cos }));
    out.push({ id, text: t.text, origin: p0, angle, width: t.width, poly });
  }
  return out;
}

export function hitFrameLabel(labels: FrameLabel[], sp: Pt): string | null {
  for (let i = labels.length - 1; i >= 0; i--) if (pointInPolygon(sp, labels[i].poly)) return labels[i].id;
  return null;
}

// Retângulos usados como alvo de alinhamento inteligente.
export function snapTargets(doc: DocumentData, pageId: string, exclude: Set<string>) {
  const page = getPage(doc, pageId);
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  if (!page) return rects;
  const walk = (ids: string[], parentWorld: Mat) => {
    for (const id of ids) {
      const n = doc.nodes[id];
      if (!n || !n.visible || exclude.has(id)) continue;
      const w = multiply(parentWorld, localMatrix(n));
      rects.push(rectFromPoints(boxCorners(n.width, n.height).map((p) => applyMat(w, p))));
      if (n.type === 'FRAME') walk(n.children ?? [], w);
    }
  };
  walk(page.children, IDENTITY);
  return rects;
}
