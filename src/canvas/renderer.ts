import { rgba } from './color';
import { getImage } from './images';
import { applyTextStyle, isOpenPath, layoutText, lineX, shapePath } from './shapes';
import { localMatrix } from '../model/document';
import type { DocumentData, Effect, Paint, SceneNode, SolidPaint } from '../model/types';

export interface DrawContext {
  doc: DocumentData;
  /** Quantos pixels do bitmap equivalem a uma unidade do mundo. */
  pxScale: number;
  skipTextId?: string | null;
  /** Apenas a cadeia atual: instâncias irmãs podem repetir o mesmo componente. */
  activeNodes?: Set<string>;
}

const OFFSCREEN = 50000;

export function drawNodeList(ctx: CanvasRenderingContext2D, dc: DrawContext, ids: string[]) {
  for (const id of ids) {
    const n = dc.doc.nodes[id];
    if (n) drawNode(ctx, dc, n);
  }
}

export function drawNode(ctx: CanvasRenderingContext2D, dc: DrawContext, n: SceneNode) {
  if (!n.visible) return;
  const active = (dc.activeNodes ??= new Set<string>());
  if (active.has(n.id)) return;
  active.add(n.id);
  try {
    drawNodeContents(ctx, dc, n);
  } finally {
    active.delete(n.id);
  }
}

function drawNodeContents(ctx: CanvasRenderingContext2D, dc: DrawContext, n: SceneNode) {
  ctx.save();
  ctx.transform(...localMatrix(n));
  ctx.globalAlpha *= n.opacity;

  if (n.type === 'GROUP') {
    drawNodeList(ctx, dc, n.children ?? []);
    ctx.restore();
    return;
  }

  if (n.type === 'BOOLEAN_OPERATION') {
    drawBooleanOperation(ctx, dc, n);
    ctx.restore();
    return;
  }

  if (n.type === 'INSTANCE') {
    drawInstance(ctx, dc, n);
    ctx.restore();
    return;
  }

  const path = shapePath(n);
  const effects = n.effects.filter((e) => e.visible);
  const blur = effects.find((e) => e.type === 'LAYER_BLUR');
  if (blur && blur.radius > 0) ctx.filter = `blur(${(blur.radius * dc.pxScale) / 2}px)`;

  for (const e of effects) if (e.type === 'DROP_SHADOW') drawDropShadow(ctx, dc, n, path, e);

  if (n.type === 'TEXT') {
    if (dc.skipTextId !== n.id) {
      for (const f of n.fills) if (f.visible && f.type === 'SOLID') drawTextGlyphs(ctx, n, rgba(f.color, f.opacity));
    }
  } else if (!isOpenPath(n)) {
    for (const f of n.fills) if (f.visible) paintFill(ctx, dc, n, path, f);
  }

  for (const e of effects) if (e.type === 'INNER_SHADOW' && n.type !== 'TEXT') drawInnerShadow(ctx, dc, path, e);

  if (n.type === 'FRAME' || n.type === 'COMPONENT') {
    ctx.save();
    if (n.clipsContent) ctx.clip(path);
    drawNodeList(ctx, dc, n.children ?? []);
    ctx.restore();
  }

  drawStrokes(ctx, n, path);
  ctx.restore();
}

function drawBooleanOperation(ctx: CanvasRenderingContext2D, dc: DrawContext, n: SceneNode) {
  const children = (n.children ?? []).map((id) => dc.doc.nodes[id]).filter(Boolean);
  if (!children.length) return;

  const w = Math.max(1, Math.ceil(n.width));
  const h = Math.max(1, Math.ceil(n.height));

  const offCanvas = document.createElement('canvas');
  offCanvas.width = Math.min(4096, Math.max(1, Math.round(w * dc.pxScale)));
  offCanvas.height = Math.min(4096, Math.max(1, Math.round(h * dc.pxScale)));
  const offCtx = offCanvas.getContext('2d');
  if (!offCtx) {
    drawNodeList(ctx, dc, n.children ?? []);
    return;
  }

  offCtx.scale(dc.pxScale, dc.pxScale);
  const op = n.booleanOperation ?? 'UNION';

  drawNode(offCtx, dc, children[0]);

  for (let i = 1; i < children.length; i++) {
    const child = children[i];
    offCtx.save();
    if (op === 'SUBTRACT') {
      offCtx.globalCompositeOperation = 'destination-out';
    } else if (op === 'INTERSECT') {
      offCtx.globalCompositeOperation = 'source-in';
    } else if (op === 'EXCLUDE') {
      offCtx.globalCompositeOperation = 'xor';
    } else {
      offCtx.globalCompositeOperation = 'source-over';
    }
    drawNode(offCtx, dc, child);
    offCtx.restore();
  }

  if (n.fills.length && n.fills.some((f) => f.visible)) {
    offCtx.save();
    offCtx.globalCompositeOperation = 'source-in';
    for (const f of n.fills) {
      if (!f.visible) continue;
      if (f.type === 'SOLID') {
        offCtx.fillStyle = rgba(f.color, f.opacity);
        offCtx.fillRect(0, 0, w, h);
      } else if (f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL') {
        const dummyPath = new Path2D();
        dummyPath.rect(0, 0, w, h);
        paintFill(offCtx, dc, n, dummyPath, f);
      }
    }
    offCtx.restore();
  }

  ctx.drawImage(offCanvas, 0, 0, w, h);

  if (n.strokes.length && n.strokeWeight > 0) {
    const path = shapePath(n);
    drawStrokes(ctx, n, path);
  }
}

function drawInstance(ctx: CanvasRenderingContext2D, dc: DrawContext, n: SceneNode) {
  const master = n.componentId ? dc.doc.nodes[n.componentId] : null;
  const path = shapePath(n);
  const fills = n.fills.length ? n.fills : (master?.fills ?? []);
  for (const f of fills) if (f.visible) paintFill(ctx, dc, n, path, f);

  if (master?.children?.length) {
    ctx.save();
    if (n.clipsContent || master.clipsContent) ctx.clip(path);
    drawNodeList(ctx, dc, master.children);
    ctx.restore();
  } else if (n.children?.length) {
    ctx.save();
    if (n.clipsContent) ctx.clip(path);
    drawNodeList(ctx, dc, n.children);
    ctx.restore();
  }

  drawStrokes(ctx, n, path);
}

function setupShadow(ctx: CanvasRenderingContext2D, dc: DrawContext, e: Effect) {
  ctx.shadowColor = rgba(e.color, e.opacity);
  ctx.shadowBlur = e.radius * dc.pxScale;
  ctx.shadowOffsetX = e.x * dc.pxScale - OFFSCREEN;
  ctx.shadowOffsetY = e.y * dc.pxScale;
}

/** Desenha a forma fora da tela e projeta só a sombra de volta. */
function drawDropShadow(ctx: CanvasRenderingContext2D, dc: DrawContext, n: SceneNode, path: Path2D, e: Effect) {
  const m = ctx.getTransform();
  ctx.save();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e + OFFSCREEN, m.f);
  setupShadow(ctx, dc, e);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  if (n.type === 'TEXT') {
    drawTextGlyphs(ctx, n, '#000');
  } else if (isOpenPath(n)) {
    ctx.lineWidth = n.strokeWeight;
    ctx.lineCap = n.type === 'VECTOR' ? (n.vectorStrokeCap ?? 'round') : 'round';
    if (n.type === 'VECTOR') ctx.lineJoin = n.vectorStrokeJoin ?? 'round';
    ctx.stroke(path);
  } else {
    ctx.fill(path);
    if (e.spread > 0) {
      ctx.lineWidth = e.spread * 2;
      ctx.lineJoin = n.type === 'VECTOR' ? (n.vectorStrokeJoin ?? 'round') : 'round';
      ctx.stroke(path);
    }
  }
  ctx.restore();
}

function drawInnerShadow(ctx: CanvasRenderingContext2D, dc: DrawContext, path: Path2D, e: Effect) {
  ctx.save();
  ctx.clip(path);
  const hole = new Path2D();
  hole.rect(-1e5, -1e5, 2e5, 2e5);
  hole.addPath(path);
  const m = ctx.getTransform();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e + OFFSCREEN, m.f);
  setupShadow(ctx, dc, e);
  ctx.fillStyle = '#000';
  ctx.fill(hole, 'evenodd');
  ctx.restore();
}

function paintFill(ctx: CanvasRenderingContext2D, dc: DrawContext, n: SceneNode, path: Path2D, f: Paint) {
  if (f.type === 'SOLID') {
    ctx.fillStyle = rgba(f.color, f.opacity);
    ctx.fill(path);
    return;
  }
  if (f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL') {
    ctx.save();
    ctx.clip(path);
    ctx.globalAlpha *= f.opacity;
    let grad: CanvasGradient;
    if (f.type === 'GRADIENT_LINEAR') {
      const angleRad = ((f.angle ?? 90) * Math.PI) / 180;
      const cx = n.width / 2;
      const cy = n.height / 2;
      const len = Math.max(n.width, n.height) / 2;
      const dx = Math.sin(angleRad) * len;
      const dy = Math.cos(angleRad) * len;
      grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    } else {
      const cx = n.width / 2;
      const cy = n.height / 2;
      const r = Math.max(n.width, n.height) / 2;
      grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    }
    for (const stop of f.stops) {
      grad.addColorStop(Math.min(1, Math.max(0, stop.position)), rgba(stop.color, stop.opacity));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, n.width, n.height);
    ctx.restore();
    return;
  }
  if (f.type !== 'IMAGE') return;
  ctx.save();
  ctx.clip(path);
  ctx.globalAlpha *= f.opacity;
  const img = getImage(dc.doc, f.imageId);
  if (!img) {
    ctx.fillStyle = '#E6E6E6';
    ctx.fill(path);
    ctx.restore();
    return;
  }
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  let dw = n.width;
  let dh = n.height;
  let dx = 0;
  let dy = 0;
  if (f.scaleMode !== 'STRETCH') {
    const s = f.scaleMode === 'FILL' ? Math.max(n.width / iw, n.height / ih) : Math.min(n.width / iw, n.height / ih);
    dw = iw * s;
    dh = ih * s;
    dx = (n.width - dw) / 2;
    dy = (n.height - dh) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

export function drawTextGlyphs(ctx: CanvasRenderingContext2D, n: SceneNode, style: string) {
  const layout = layoutText(n);
  applyTextStyle(ctx, n);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = style;
  layout.lines.forEach((line, i) => {
    ctx.fillText(line.text, lineX(n, line.width), i * layout.lineHeight + layout.lineHeight / 2);
  });
}

function drawStrokes(ctx: CanvasRenderingContext2D, n: SceneNode, path: Path2D) {
  if (n.type === 'TEXT' || n.strokeWeight <= 0) return;
  const strokes = n.strokes.filter((s): s is SolidPaint => s.visible && s.type === 'SOLID');
  if (!strokes.length) return;
  const open = isOpenPath(n);
  const align = open ? 'CENTER' : n.strokeAlign;
  ctx.save();
  ctx.lineJoin = n.type === 'VECTOR' ? (n.vectorStrokeJoin ?? 'round') : 'miter';
  ctx.lineCap = n.type === 'VECTOR' ? (n.vectorStrokeCap ?? 'round') : 'butt';
  if (align === 'INSIDE') {
    ctx.clip(path);
    ctx.lineWidth = n.strokeWeight * 2;
  } else if (align === 'OUTSIDE') {
    const outer = new Path2D();
    outer.rect(-1e6, -1e6, 2e6, 2e6);
    outer.addPath(path);
    ctx.clip(outer, 'evenodd');
    ctx.lineWidth = n.strokeWeight * 2;
  } else {
    ctx.lineWidth = n.strokeWeight;
  }
  for (const s of strokes) {
    ctx.strokeStyle = rgba(s.color, s.opacity);
    ctx.stroke(path);
    if (n.type === 'LINE' && n.arrowEnd) {
      const size = Math.max(6, n.strokeWeight * 3);
      const head = new Path2D();
      head.moveTo(n.width - size, -size * 0.6);
      head.lineTo(n.width, 0);
      head.lineTo(n.width - size, size * 0.6);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(head);
    }
  }
  ctx.restore();
}
