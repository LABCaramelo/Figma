import { type Rect, fmtNum } from '../canvas/geometry';
import { ensureImagesLoaded } from '../canvas/images';
import { drawNode } from '../canvas/renderer';
import { isOpenPath, layoutText, lineHeightPx, lineX, polygonPoints, vectorPathData } from '../canvas/shapes';
import {
  boundsOf,
  imageIdsOf,
  localMatrix,
  parentWorldMatrix,
  sortByPaintOrder,
  topLevelIds,
} from '../model/document';
import type { DocumentData, Effect, SceneNode, SolidPaint } from '../model/types';
import { store } from '../store/store';

export type ExportFormat = 'PNG' | 'JPG' | 'SVG';

export interface ExportSetting {
  format: ExportFormat;
  scale: number;
}

/** Última configuração usada (painel de exportação e Ctrl+Shift+E). */
export const exportPrefs: ExportSetting = { format: 'PNG', scale: 1 };

const MAX_CANVAS = 16384;

/** Margem extra para que sombras, desfoque e traços externos não sejam cortados. */
function effectMargin(doc: DocumentData, id: string): number {
  const n = doc.nodes[id];
  if (!n || !n.visible) return 0;
  let m = 0;
  if (n.strokes.some((s) => s.visible) && n.strokeWeight > 0) {
    const align = isOpenPath(n) ? 'CENTER' : n.strokeAlign;
    m = Math.max(m, align === 'OUTSIDE' ? n.strokeWeight : align === 'CENTER' ? n.strokeWeight / 2 : 0);
    if (n.type === 'LINE' && n.arrowEnd) m = Math.max(m, n.strokeWeight * 3);
  }
  for (const e of n.effects) {
    if (!e.visible) continue;
    if (e.type === 'DROP_SHADOW') m = Math.max(m, Math.max(Math.abs(e.x), Math.abs(e.y)) + e.radius + Math.max(0, e.spread));
    if (e.type === 'LAYER_BLUR') m = Math.max(m, e.radius);
  }
  if (n.type === 'GROUP' || (n.type === 'FRAME' && !n.clipsContent))
    for (const c of n.children ?? []) m = Math.max(m, effectMargin(doc, c));
  return Math.ceil(m);
}

function exportBounds(doc: DocumentData, ids: string[]): Rect | null {
  const b = boundsOf(doc, ids);
  if (!b) return null;
  const m = Math.max(0, ...ids.map((id) => effectMargin(doc, id)));
  return { x: b.x - m, y: b.y - m, width: b.width + m * 2, height: b.height + m * 2 };
}

function prepareIds(doc: DocumentData, ids: string[]) {
  return sortByPaintOrder(doc, topLevelIds(doc, ids)).filter((id) => doc.nodes[id]);
}

export async function renderToCanvas(ids: string[], scale: number, background?: string): Promise<HTMLCanvasElement | null> {
  const doc = store.state.doc;
  ids = prepareIds(doc, ids);
  const b = exportBounds(doc, ids);
  if (!b) return null;
  await ensureImagesLoaded(doc, imageIdsOf(doc, ids));
  await document.fonts.ready;
  const s = Math.min(scale, MAX_CANVAS / Math.max(b.width, 1), MAX_CANVAS / Math.max(b.height, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(b.width * s));
  canvas.height = Math.max(1, Math.ceil(b.height * s));
  const ctx = canvas.getContext('2d')!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (const id of ids) {
    ctx.save();
    ctx.setTransform(s, 0, 0, s, -b.x * s, -b.y * s);
    ctx.transform(...parentWorldMatrix(doc, id));
    drawNode(ctx, { doc, pxScale: s }, doc.nodes[id]);
    ctx.restore();
  }
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Sem título';

export async function exportBlob(ids: string[], setting: ExportSetting): Promise<Blob | null> {
  if (setting.format === 'SVG') {
    const svg = nodesToSvg(ids);
    return svg ? new Blob([svg], { type: 'image/svg+xml' }) : null;
  }
  const jpg = setting.format === 'JPG';
  const canvas = await renderToCanvas(ids, setting.scale, jpg ? '#FFFFFF' : undefined);
  if (!canvas) return null;
  return canvasToBlob(canvas, jpg ? 'image/jpeg' : 'image/png', jpg ? 0.92 : undefined);
}

/** Exporta cada camada selecionada num arquivo (como o Figma faz). */
export async function exportNodes(ids: string[], setting: ExportSetting) {
  const doc = store.state.doc;
  const list = prepareIds(doc, ids);
  if (!list.length) {
    store.toast('Selecione uma camada para exportar');
    return;
  }
  const suffix = setting.format === 'SVG' || setting.scale === 1 ? '' : `@${fmtNum(setting.scale)}x`;
  const ext = setting.format.toLowerCase();
  for (const id of list) {
    const blob = await exportBlob([id], setting);
    if (blob) downloadBlob(blob, `${safeFileName(doc.nodes[id].name)}${suffix}.${ext}`);
  }
  store.toast(list.length === 1 ? `Exportado: ${doc.nodes[list[0]].name}` : `${list.length} camadas exportadas`);
}

export async function copyAsPng(ids: string[]) {
  const canvas = await renderToCanvas(ids, 2);
  if (!canvas) return store.toast('Selecione uma camada para copiar');
  const blob = await canvasToBlob(canvas, 'image/png');
  try {
    if (!blob) throw new Error('sem imagem');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    store.toast('Copiado como PNG');
  } catch {
    store.toast('O navegador não permitiu copiar a imagem');
  }
}

// ---------- SVG ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => fmtNum(v);

interface SvgCtx {
  doc: DocumentData;
  defs: string[];
  seq: number;
  activeNodes: Set<string>;
}

const nextId = (c: SvgCtx, prefix: string) => `${prefix}${++c.seq}`;

function geometry(n: SceneNode, attrs: string): string {
  const w = num(n.width);
  const h = num(n.height);
  switch (n.type) {
    case 'ELLIPSE':
      return `<ellipse cx="${num(n.width / 2)}" cy="${num(n.height / 2)}" rx="${num(Math.abs(n.width / 2))}" ry="${num(Math.abs(n.height / 2))}" ${attrs}/>`;
    case 'POLYGON':
    case 'STAR':
      return `<polygon points="${polygonPoints(n).map((p) => `${num(p.x)},${num(p.y)}`).join(' ')}" ${attrs}/>`;
    case 'LINE':
      return `<line x1="0" y1="0" x2="${w}" y2="0" ${attrs}/>`;
    case 'VECTOR':
      return `<path d="${vectorPathData(n)}" ${attrs}/>`;
    default: {
      const r = Math.max(0, Math.min(n.cornerRadius || 0, n.width / 2, n.height / 2));
      return `<rect width="${w}" height="${h}"${r ? ` rx="${num(r)}"` : ''} ${attrs}/>`;
    }
  }
}

function clipFor(c: SvgCtx, n: SceneNode): string {
  const id = nextId(c, 'clip');
  c.defs.push(`<clipPath id="${id}">${geometry(n, '')}</clipPath>`);
  return id;
}

function effectFilter(c: SvgCtx, effects: Effect[]): string | null {
  const list = effects.filter((e) => e.visible);
  if (!list.length) return null;
  const id = nextId(c, 'fx');
  const parts: string[] = [];
  const merge: string[] = [];
  let k = 0;
  for (const e of list) {
    const r = `r${k++}`;
    if (e.type === 'DROP_SHADOW') {
      parts.push(
        `<feMorphology in="SourceAlpha" operator="${e.spread >= 0 ? 'dilate' : 'erode'}" radius="${num(Math.abs(e.spread))}" result="${r}m"/>`,
        `<feOffset in="${r}m" dx="${num(e.x)}" dy="${num(e.y)}" result="${r}o"/>`,
        `<feGaussianBlur in="${r}o" stdDeviation="${num(e.radius / 2)}" result="${r}b"/>`,
        `<feFlood flood-color="${e.color}" flood-opacity="${num(e.opacity)}"/>`,
        `<feComposite in2="${r}b" operator="in" result="${r}"/>`,
      );
      merge.unshift(`<feMergeNode in="${r}"/>`);
    }
  }
  merge.push('<feMergeNode in="SourceGraphic"/>');
  for (const e of list) {
    const r = `r${k++}`;
    if (e.type === 'INNER_SHADOW') {
      parts.push(
        `<feOffset in="SourceAlpha" dx="${num(e.x)}" dy="${num(e.y)}" result="${r}o"/>`,
        `<feGaussianBlur in="${r}o" stdDeviation="${num(e.radius / 2)}" result="${r}b"/>`,
        `<feComposite in="SourceAlpha" in2="${r}b" operator="arithmetic" k2="1" k3="-1" result="${r}i"/>`,
        `<feFlood flood-color="${e.color}" flood-opacity="${num(e.opacity)}"/>`,
        `<feComposite in2="${r}i" operator="in" result="${r}"/>`,
      );
      merge.push(`<feMergeNode in="${r}"/>`);
    }
  }
  let body = parts.join('') + `<feMerge result="all">${merge.join('')}</feMerge>`;
  const blur = list.find((e) => e.type === 'LAYER_BLUR');
  if (blur && blur.radius > 0) body += `<feGaussianBlur in="all" stdDeviation="${num(blur.radius / 2)}"/>`;
  c.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${body}</filter>`);
  return id;
}

function textSvg(n: SceneNode, fill: string, opacity: number): string {
  const layout = layoutText(n);
  const lh = lineHeightPx(n);
  const tspans = layout.lines
    .map((l, i) => `<tspan x="${num(lineX(n, l.width))}" y="${num(i * lh + lh / 2)}">${esc(l.text) || ' '}</tspan>`)
    .join('');
  const family = esc(`'${n.fontFamily ?? 'Inter'}', sans-serif`);
  return `<text font-family="${family}" font-size="${num(n.fontSize ?? 12)}" font-weight="${n.fontWeight ?? 400}" letter-spacing="${num(
    n.letterSpacing ?? 0,
  )}" dominant-baseline="central" xml:space="preserve" fill="${fill}"${opacity < 1 ? ` fill-opacity="${num(opacity)}"` : ''}>${tspans}</text>`;
}

function fillsSvg(c: SvgCtx, n: SceneNode): string {
  if (isOpenPath(n)) return '';
  let out = '';
  for (const f of n.fills) {
    if (!f.visible) continue;
    if (n.type === 'TEXT') {
      if (f.type === 'SOLID') out += textSvg(n, f.color, f.opacity);
      continue;
    }
    if (f.type === 'SOLID') {
      out += geometry(n, `fill="${f.color}"${f.opacity < 1 ? ` fill-opacity="${num(f.opacity)}"` : ''}`);
    } else if (f.type === 'IMAGE') {
      const src = c.doc.images[f.imageId];
      if (!src) continue;
      const clip = clipFor(c, n);
      const par = f.scaleMode === 'FILL' ? 'xMidYMid slice' : f.scaleMode === 'FIT' ? 'xMidYMid meet' : 'none';
      out += `<image href="${src}" width="${num(n.width)}" height="${num(n.height)}" preserveAspectRatio="${par}" clip-path="url(#${clip})"${
        f.opacity < 1 ? ` opacity="${num(f.opacity)}"` : ''
      }/>`;
    }
  }
  return out;
}

function strokesSvg(c: SvgCtx, n: SceneNode): string {
  if (n.type === 'TEXT' || n.strokeWeight <= 0) return '';
  const strokes = n.strokes.filter((s): s is SolidPaint => s.visible && s.type === 'SOLID');
  if (!strokes.length) return '';
  const open = isOpenPath(n);
  const align = open ? 'CENTER' : n.strokeAlign;
  const width = align === 'CENTER' ? n.strokeWeight : n.strokeWeight * 2;
  const cap = n.type === 'VECTOR' ? ` stroke-linecap="${n.vectorStrokeCap ?? 'round'}" stroke-linejoin="${n.vectorStrokeJoin ?? 'round'}"` : '';
  let wrapAttr = '';
  if (align === 'INSIDE') wrapAttr = ` clip-path="url(#${clipFor(c, n)})"`;
  else if (align === 'OUTSIDE') {
    const id = nextId(c, 'mask');
    c.defs.push(
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000"><rect x="-100000" y="-100000" width="200000" height="200000" fill="#fff"/>${geometry(
        n,
        'fill="#000"',
      )}</mask>`,
    );
    wrapAttr = ` mask="url(#${id})"`;
  }
  let out = '';
  for (const s of strokes) {
    const attrs = `fill="none" stroke="${s.color}"${s.opacity < 1 ? ` stroke-opacity="${num(s.opacity)}"` : ''} stroke-width="${num(width)}"${cap}`;
    out += geometry(n, attrs);
    if (n.type === 'LINE' && n.arrowEnd) {
      const size = Math.max(6, n.strokeWeight * 3);
      out += `<path d="M${num(n.width - size)} ${num(-size * 0.6)} L${num(n.width)} 0 L${num(n.width - size)} ${num(size * 0.6)}" ${attrs} stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }
  return wrapAttr ? `<g${wrapAttr}>${out}</g>` : out;
}

function nodeSvg(c: SvgCtx, n: SceneNode): string {
  if (!n.visible || c.activeNodes.has(n.id)) return '';
  c.activeNodes.add(n.id);
  try {
    return nodeSvgContents(c, n);
  } finally {
    c.activeNodes.delete(n.id);
  }
}

function nodeSvgContents(c: SvgCtx, n: SceneNode): string {
  const m = localMatrix(n).map(num).join(' ');
  let attrs = ` transform="matrix(${m})"`;
  if (n.opacity < 1) attrs += ` opacity="${num(n.opacity)}"`;
  const name = ` data-name="${esc(n.name)}"`;
  if (n.type === 'GROUP' || n.type === 'BOOLEAN_OPERATION') return `<g${name}${attrs}>${childrenSvg(c, n)}</g>`;
  if (n.type === 'INSTANCE') {
    const master = n.componentId ? c.doc.nodes[n.componentId] : null;
    let inner = fillsSvg(c, n);
    const kids = master ? childrenSvg(c, master) : childrenSvg(c, n);
    if (kids) inner += (n.clipsContent || master?.clipsContent) ? `<g clip-path="url(#${clipFor(c, n)})">${kids}</g>` : kids;
    inner += strokesSvg(c, n);
    return `<g${name}${attrs}>${inner}</g>`;
  }
  const filter = effectFilter(c, n.effects);
  if (filter) attrs += ` filter="url(#${filter})"`;
  let inner = fillsSvg(c, n);
  if (n.type === 'FRAME' || n.type === 'COMPONENT') {
    const kids = childrenSvg(c, n);
    if (kids) inner += n.clipsContent ? `<g clip-path="url(#${clipFor(c, n)})">${kids}</g>` : kids;
  }
  inner += strokesSvg(c, n);
  return `<g${name}${attrs}>${inner}</g>`;
}

function childrenSvg(c: SvgCtx, n: SceneNode): string {
  return (n.children ?? [])
    .map((id) => c.doc.nodes[id])
    .filter(Boolean)
    .map((k) => nodeSvg(c, k))
    .join('');
}

export function nodesToSvg(ids: string[]): string | null {
  const doc = store.state.doc;
  ids = prepareIds(doc, ids);
  const b = exportBounds(doc, ids);
  if (!b) return null;
  const c: SvgCtx = { doc, defs: [], seq: 0, activeNodes: new Set<string>() };
  const body = ids
    .map((id) => {
      const pw = parentWorldMatrix(doc, id).map(num).join(' ');
      return `<g transform="matrix(${pw})">${nodeSvg(c, doc.nodes[id])}</g>`;
    })
    .join('');
  const w = num(b.width);
  const h = num(b.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${num(b.x)} ${num(b.y)} ${w} ${h}" fill="none">${
    c.defs.length ? `<defs>${c.defs.join('')}</defs>` : ''
  }${body}</svg>`;
}

/** Miniatura em data URL (usada na prévia do painel de exportação). */
export async function thumbnail(ids: string[], maxSize = 200): Promise<string | null> {
  const doc = store.state.doc;
  const b = boundsOf(doc, ids);
  if (!b) return null;
  const s = Math.min(2, maxSize / Math.max(b.width, b.height, 1));
  const canvas = await renderToCanvas(ids, s);
  return canvas ? canvas.toDataURL('image/png') : null;
}

