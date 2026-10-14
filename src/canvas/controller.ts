import {
  type Mat,
  type Pt,
  type Rect,
  applyMat,
  applyVec,
  determinant,
  dist,
  distToSegment,
  invert,
  multiply,
  pointInPolygon,
  rectContains,
  rectFromPoints,
  rotateAround,
  toDeg,
  toRad,
} from './geometry';
import {
  deepestFrameAt,
  frameLabels,
  getSelectionFrame,
  hitFrameLabel,
  hitTest,
  pointInSelection,
  resolveSelectable,
  snapTargets,
  type SelectionFrame,
} from './hitTest';
import { fitTextBox, layoutText } from './shapes';
import { type Guide, snapPoint, snapRect } from './snapping';
import { duplicateNodes } from '../actions';
import { createNode } from '../model/defaults';
import {
  type BoxSnapshot,
  applyLocalMatrix,
  boundsOf,
  childrenOf,
  insertNode,
  isDescendant,
  isPage,
  localMatrix,
  moveToParent,
  nextName,
  normalizeGroupChain,
  normalizeRotation,
  parentWorldMatrix,
  restoreDescendants,
  scaleChildren,
  setLineEndpoints,
  snapshotDescendants,
  topLevelIds,
  worldBounds,
  worldCenter,
  worldMatrix,
} from '../model/document';
import type { NodeType, SceneNode, Tool } from '../model/types';
import type { EditorStore } from '../store/store';

export interface Measurement {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  distance: number;
}

export interface OverlayState {
  marquee: Rect | null;
  guides: Guide[];
  measurements?: Measurement[];
  pencil: Pt[] | null;
  label: { text: string; x: number; y: number } | null;
}

type HandleHit =
  | { kind: 'resize'; hx: number; hy: number; cursor: string }
  | { kind: 'rotate'; cursor: string }
  | { kind: 'endpoint'; which: 0 | 1 };

interface NodeStart {
  id: string;
  snap: SceneNode;
  parentWorld: Mat;
  parentInv: Mat;
  center: Pt;
  descendants: Map<string, BoxSnapshot>;
  childWorld: Map<string, Mat>;
}

type Drag =
  | { kind: 'none' }
  | { kind: 'pan'; startScreen: Pt; startCam: { x: number; y: number } }
  | {
      kind: 'pending';
      startScreen: Pt;
      startWorld: Pt;
      targetId: string;
      shift: boolean;
      wasSelected: boolean;
    }
  | {
      kind: 'move';
      startWorld: Pt;
      nodes: { id: string; x: number; y: number; parentInv: Mat }[];
      startBounds: Rect;
      targets: Rect[];
    }
  | { kind: 'marquee'; startWorld: Pt; base: string[]; container: string }
  | {
      kind: 'resize';
      hx: number;
      hy: number;
      single: NodeStart | null;
      multi: NodeStart[];
      bounds: Rect;
      targets: Rect[];
      canSnap: boolean;
    }
  | { kind: 'rotate'; center: Pt; startAngle: number; nodes: NodeStart[]; single: boolean }
  | { kind: 'endpoint'; id: string; which: 0 | 1; fixed: Pt; parentInv: Mat; targets: Rect[] }
  | {
      kind: 'create';
      tool: Tool;
      nodeId: string | null;
      parentId: string;
      parentInv: Mat;
      start: Pt;
      startScreen: Pt;
      moved: boolean;
      targets: Rect[];
    }
  | { kind: 'pencil'; parentId: string };

const TOOL_TYPES: Partial<Record<Tool, NodeType>> = {
  FRAME: 'FRAME',
  RECTANGLE: 'RECTANGLE',
  ELLIPSE: 'ELLIPSE',
  POLYGON: 'POLYGON',
  STAR: 'STAR',
  LINE: 'LINE',
  ARROW: 'LINE',
  TEXT: 'TEXT',
};

const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M7 16.5A6.5 6.5 0 1 1 13.5 18.5" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M7 16.5A6.5 6.5 0 1 1 13.5 18.5" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round"/><path d="M3.5 13.5 7 17.5l3.5-4z" fill="#000" stroke="#fff" stroke-width="1"/></svg>',
)}") 12 12, crosshair`;

const PEN_CURSOR = 'crosshair';

const roundPt = (p: Pt): Pt => ({ x: Math.round(p.x), y: Math.round(p.y) });

function snap45(a: Pt, b: Pt): Pt {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len };
}

export class CanvasController {
  overlay: OverlayState = { marquee: null, guides: [], pencil: null, label: null };
  private drag: Drag = { kind: 'none' };
  private spaceDown = false;
  private cleanup: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private store: EditorStore,
    private requestRender: () => void,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(canvas, 'pointerdown', (e) => this.onPointerDown(e));
    on(canvas, 'pointermove', (e) => this.onPointerMove(e));
    on(canvas, 'pointerup', (e) => this.onPointerUp(e));
    on(canvas, 'pointercancel', (e) => this.onPointerUp(e));
    on(canvas, 'pointerleave', () => {
      if (this.drag.kind === 'none') this.store.setHover(null);
    });
    on(canvas, 'dblclick', (e) => this.onDoubleClick(e));
    on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(canvas, 'contextmenu', (e) => this.onContextMenu(e));
    on(window, 'keydown', (e) => this.onKey(e, true));
    on(window, 'keyup', (e) => this.onKey(e, false));
    on(window, 'blur', () => {
      this.spaceDown = false;
      this.updateCursor();
    });
  }

  destroy() {
    this.cleanup.forEach((f) => f());
  }

  private get state() {
    return this.store.state;
  }
  private get doc() {
    return this.store.state.doc;
  }

  private screenPoint(e: MouseEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private toWorld(p: Pt): Pt {
    return this.store.screenToWorld(p);
  }
  private toScreen(p: Pt): Pt {
    const c = this.state.camera;
    return { x: p.x * c.zoom + c.x, y: p.y * c.zoom + c.y };
  }

  private setCursor(c: string) {
    if (this.canvas.style.cursor !== c) this.canvas.style.cursor = c;
  }

  private updateCursor(hit?: HandleHit | null) {
    if (this.drag.kind === 'pan') return this.setCursor('grabbing');
    if (this.spaceDown || this.state.tool === 'HAND') return this.setCursor('grab');
    const tool = this.state.tool;
    if (tool === 'TEXT') return this.setCursor('text');
    if (tool === 'PENCIL') return this.setCursor(PEN_CURSOR);
    if (tool !== 'MOVE') return this.setCursor('crosshair');
    if (hit?.kind === 'resize') return this.setCursor(hit.cursor);
    if (hit?.kind === 'rotate') return this.setCursor(ROTATE_CURSOR);
    if (hit?.kind === 'endpoint') return this.setCursor('move');
    this.setCursor('default');
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.code !== 'Space') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (this.state.editingTextId) return;
    e.preventDefault();
    if (this.spaceDown !== down) {
      this.spaceDown = down;
      this.updateCursor();
    }
  }

  // ---------- alças da seleção ----------

  private selectionFrame(): SelectionFrame {
    return getSelectionFrame(this.doc, this.state.selection);
  }

  private hitHandle(sp: Pt, sf: SelectionFrame): HandleHit | null {
    if (!sf || this.state.editingTextId) return null;
    if (sf.kind === 'line') {
      const a = this.toScreen(sf.a);
      const b = this.toScreen(sf.b);
      if (dist(sp, a) <= 7) return { kind: 'endpoint', which: 0 };
      if (dist(sp, b) <= 7) return { kind: 'endpoint', which: 1 };
      return null;
    }
    const cs = sf.corners.map((p) => this.toScreen(p));
    const center = { x: (cs[0].x + cs[2].x) / 2, y: (cs[0].y + cs[2].y) / 2 };
    const cursorFor = (p: Pt) => {
      const deg = toDeg(Math.atan2(p.y - center.y, p.x - center.x));
      const a = ((deg % 180) + 180) % 180;
      return RESIZE_CURSORS[Math.round(a / 45) % 4];
    };
    const fr = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (let i = 0; i < 4; i++)
      if (dist(sp, cs[i]) <= 6) return { kind: 'resize', hx: fr[i][0], hy: fr[i][1], cursor: cursorFor(cs[i]) };
    const edges = [
      [0.5, 0],
      [1, 0.5],
      [0.5, 1],
      [0, 0.5],
    ];
    for (let i = 0; i < 4; i++) {
      const a = cs[i];
      const b = cs[(i + 1) % 4];
      if (dist(a, b) > 12 && distToSegment(sp, a, b) <= 4) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return { kind: 'resize', hx: edges[i][0], hy: edges[i][1], cursor: cursorFor(mid) };
      }
    }
    const inside = pointInPolygon(sp, cs);
    if (!inside) for (let i = 0; i < 4; i++) if (dist(sp, cs[i]) <= 20) return { kind: 'rotate', cursor: ROTATE_CURSOR };
    return null;
  }

  private nodeStart(id: string): NodeStart {
    const doc = this.doc;
    const n = doc.nodes[id];
    const parentWorld = parentWorldMatrix(doc, id);
    const childWorld = new Map<string, Mat>();
    if (n.type === 'FRAME') {
      const w = worldMatrix(doc, id);
      for (const cid of n.children ?? []) {
        const c = doc.nodes[cid];
        if (c) childWorld.set(cid, multiply(w, localMatrix(c)));
      }
    }
    return {
      id,
      snap: structuredClone(n),
      parentWorld,
      parentInv: invert(parentWorld),
      center: worldCenter(doc, id),
      descendants: n.type === 'GROUP' ? snapshotDescendants(doc, id) : new Map(),
      childWorld,
    };
  }

  private movableSelection(): string[] {
    const doc = this.doc;
    return topLevelIds(doc, this.state.selection).filter((id) => doc.nodes[id] && !doc.nodes[id].locked);
  }

  // ---------- eventos ----------

  private onPointerDown(e: PointerEvent) {
    this.canvas.focus({ preventScroll: true });
    if (this.state.editingTextId) this.store.finishTextEditing();
    if (this.state.ui.contextMenu) this.store.update((s) => (s.ui.contextMenu = null));
    if (e.button === 2) return;
    const sp = this.screenPoint(e);
    const wp = this.toWorld(sp);
    this.canvas.setPointerCapture(e.pointerId);

    if (e.button === 1 || this.spaceDown || this.state.tool === 'HAND') {
      this.drag = { kind: 'pan', startScreen: sp, startCam: { x: this.state.camera.x, y: this.state.camera.y } };
      this.updateCursor();
      return;
    }
    if (e.button !== 0) return;

    const tool = this.state.tool;
    if (tool === 'MOVE') return this.downMove(e, sp, wp);
    if (tool === 'PENCIL') {
      this.drag = { kind: 'pencil', parentId: deepestFrameAt(this.doc, this.state.pageId, wp) ?? this.state.pageId };
      this.overlay.pencil = [wp];
      this.requestRender();
      return;
    }
    this.startCreate(tool, sp, wp);
  }

  private downMove(e: PointerEvent, sp: Pt, wp: Pt) {
    const doc = this.doc;
    const selection = this.state.selection;
    const sf = this.selectionFrame();
    const handle = this.hitHandle(sp, sf);
    if (handle) {
      if (handle.kind === 'resize') this.startResize(handle.hx, handle.hy, sf);
      else if (handle.kind === 'rotate') this.startRotate(wp, sf);
      else if (sf?.kind === 'line') this.startEndpoint(sf.id, handle.which);
      return;
    }

    let targetId: string | null = hitFrameLabel(frameLabels(doc, this.state.pageId, this.state.camera), sp);
    let marqueeContainer = this.state.pageId;
    if (!targetId) {
      const hit = hitTest(doc, this.state.pageId, wp, this.state.camera.zoom);
      if (hit) {
        if (hit.topFrameBg) {
          if (selection.includes(hit.id)) targetId = hit.id;
          else marqueeContainer = hit.id;
        } else {
          targetId = e.ctrlKey || e.metaKey ? hit.id : resolveSelectable(doc, hit.id, selection);
        }
      }
    }
    if (!targetId && selection.length > 1 && pointInSelection(sf, wp)) targetId = '__selection__';

    if (targetId) {
      const wasSelected = targetId === '__selection__' || selection.includes(targetId);
      if (targetId !== '__selection__') {
        if (e.shiftKey) {
          if (!wasSelected) this.store.setSelection([...selection, targetId]);
        } else if (!wasSelected) this.store.setSelection([targetId]);
      }
      this.drag = { kind: 'pending', startScreen: sp, startWorld: wp, targetId, shift: e.shiftKey, wasSelected };
      return;
    }
    if (!e.shiftKey && selection.length) this.store.setSelection([]);
    this.drag = { kind: 'marquee', startWorld: wp, base: e.shiftKey ? [...selection] : [], container: marqueeContainer };
  }

  private onPointerMove(e: PointerEvent) {
    const sp = this.screenPoint(e);
    const wp = this.toWorld(sp);
    const d = this.drag;
    switch (d.kind) {
      case 'none':
        if (e.buttons === 0) this.updateHover(sp, wp, e);
        return;
      case 'pan':
        this.state.camera.x = d.startCam.x + (sp.x - d.startScreen.x);
        this.state.camera.y = d.startCam.y + (sp.y - d.startScreen.y);
        this.store.emit();
        return;
      case 'pending':
        if (dist(sp, d.startScreen) < 3) return;
        this.beginMove(d.startWorld, e.altKey);
        this.updateMove(wp, e.shiftKey);
        return;
      case 'move':
        return this.updateMove(wp, e.shiftKey);
      case 'marquee':
        return this.updateMarquee(d, wp);
      case 'resize':
        return this.updateResize(d, wp, e.shiftKey, e.altKey);
      case 'rotate':
        return this.updateRotate(d, sp, wp, e.shiftKey);
      case 'endpoint':
        return this.updateEndpoint(d, wp, e.shiftKey);
      case 'create':
        return this.updateCreate(d, sp, wp, e.shiftKey, e.altKey);
      case 'pencil': {
        const pts = this.overlay.pencil!;
        const last = pts[pts.length - 1];
        if (dist(last, wp) * this.state.camera.zoom > 1.5) {
          pts.push(wp);
          this.requestRender();
        }
        return;
      }
    }
  }

  private onPointerUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = { kind: 'none' };
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const wp = this.toWorld(this.screenPoint(e));
    switch (d.kind) {
      case 'pending': {
        const sel = this.state.selection;
        if (d.targetId === '__selection__') break;
        if (d.shift && d.wasSelected) this.store.setSelection(sel.filter((id) => id !== d.targetId));
        else if (!d.shift && d.wasSelected && sel.length > 1) this.store.setSelection([d.targetId]);
        break;
      }
      case 'move':
        this.endMove(d, wp);
        break;
      case 'marquee':
        this.overlay.marquee = null;
        break;
      case 'resize':
      case 'rotate':
      case 'endpoint': {
        const ids = d.kind === 'resize' ? (d.single ? [d.single.id] : d.multi.map((m) => m.id)) : d.kind === 'rotate' ? d.nodes.map((n) => n.id) : [d.id];
        this.store.update((s) => ids.forEach((id) => s.doc.nodes[id] && normalizeGroupChain(s.doc, s.doc.nodes[id].parentId)));
        break;
      }
      case 'create':
        this.endCreate(d);
        break;
      case 'pencil':
        this.endPencil(d.parentId);
        break;
    }
    this.overlay.guides = [];
    this.overlay.label = null;
    this.updateCursor();
    this.requestRender();
  }

  private updateHover(sp: Pt, wp: Pt, e: PointerEvent) {
    const tool = this.state.tool;
    if (tool !== 'MOVE' || this.spaceDown) {
      this.store.setHover(null);
      this.updateCursor();
      return;
    }
    const sf = this.selectionFrame();
    const handle = this.hitHandle(sp, sf);
    this.updateCursor(handle);
    if (handle) {
      this.store.setHover(null);
      return;
    }
    const doc = this.doc;
    let id: string | null = hitFrameLabel(frameLabels(doc, this.state.pageId, this.state.camera), sp);
    if (!id) {
      const hit = hitTest(doc, this.state.pageId, wp, this.state.camera.zoom);
      if (hit && !hit.topFrameBg) id = e.ctrlKey || e.metaKey ? hit.id : resolveSelectable(doc, hit.id, this.state.selection);
    }
    this.store.setHover(id);
    if (e.altKey && this.state.selection.length > 0 && id && !this.state.selection.includes(id)) {
      this.updateMeasurements(this.state.selection[0], id);
    } else {
      this.overlay.measurements = [];
    }
    this.requestRender();
  }

  private updateMeasurements(selId: string, hoverId: string) {
    const doc = this.doc;
    const a = worldBounds(doc, selId);
    const b = worldBounds(doc, hoverId);
    if (!a || !b) {
      this.overlay.measurements = [];
      return;
    }

    const measurements: Measurement[] = [];

    // Horizontal distance
    if (b.x >= a.x + a.width) {
      const midY = (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2;
      measurements.push({
        x1: a.x + a.width,
        y1: midY,
        x2: b.x,
        y2: midY,
        distance: b.x - (a.x + a.width),
      });
    } else if (a.x >= b.x + b.width) {
      const midY = (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2;
      measurements.push({
        x1: b.x + b.width,
        y1: midY,
        x2: a.x,
        y2: midY,
        distance: a.x - (b.x + b.width),
      });
    }

    // Vertical distance
    if (b.y >= a.y + a.height) {
      const midX = (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2;
      measurements.push({
        x1: midX,
        y1: a.y + a.height,
        x2: midX,
        y2: b.y,
        distance: b.y - (a.y + a.height),
      });
    } else if (a.y >= b.y + b.height) {
      const midX = (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2;
      measurements.push({
        x1: midX,
        y1: b.y + b.height,
        x2: midX,
        y2: a.y,
        distance: a.y - (b.y + b.height),
      });
    }

    // If one is inside the other
    const aContainsB = a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
    const bContainsA = b.x <= a.x && b.y <= a.y && b.x + b.width >= a.x + a.width && b.y + b.height >= a.y + a.height;
    if (aContainsB || bContainsA) {
      const outer = aContainsB ? a : b;
      const inner = aContainsB ? b : a;
      const midX = inner.x + inner.width / 2;
      const midY = inner.y + inner.height / 2;
      measurements.push({ x1: midX, y1: outer.y, x2: midX, y2: inner.y, distance: inner.y - outer.y });
      measurements.push({ x1: midX, y1: inner.y + inner.height, x2: midX, y2: outer.y + outer.height, distance: (outer.y + outer.height) - (inner.y + inner.height) });
      measurements.push({ x1: outer.x, y1: midY, x2: inner.x, y2: midY, distance: inner.x - outer.x });
      measurements.push({ x1: inner.x + inner.width, y1: midY, x2: outer.x + outer.width, y2: midY, distance: (outer.x + outer.width) - (inner.x + inner.width) });
    }

    this.overlay.measurements = measurements.filter((m) => m.distance > 0);
  }

  // ---------- mover ----------

  private beginMove(startWorld: Pt, alt: boolean) {
    this.store.checkpoint();
    let ids = this.movableSelection();
    if (alt && ids.length) {
      ids = duplicateNodes(ids, false);
      this.state.selection = ids;
    }
    const doc = this.doc;
    const exclude = new Set(ids);
    this.drag = {
      kind: 'move',
      startWorld,
      nodes: ids.map((id) => ({
        id,
        x: doc.nodes[id].x,
        y: doc.nodes[id].y,
        parentInv: invert(parentWorldMatrix(doc, id)),
      })),
      startBounds: boundsOf(doc, ids) ?? { x: startWorld.x, y: startWorld.y, width: 0, height: 0 },
      targets: snapTargets(doc, this.state.pageId, exclude),
    };
    this.store.setHover(null);
  }

  private updateMove(wp: Pt, shift: boolean) {
    const d = this.drag;
    if (d.kind !== 'move') return;
    let dx = wp.x - d.startWorld.x;
    let dy = wp.y - d.startWorld.y;
    let allowX = true;
    let allowY = true;
    if (shift) {
      if (Math.abs(dx) > Math.abs(dy)) {
        dy = 0;
        allowY = false;
      } else {
        dx = 0;
        allowX = false;
      }
    }
    dx = Math.round(dx);
    dy = Math.round(dy);
    const moved = { ...d.startBounds, x: d.startBounds.x + dx, y: d.startBounds.y + dy };
    const snap = snapRect(moved, d.targets, 6 / this.state.camera.zoom, allowX, allowY);
    dx += snap.dx;
    dy += snap.dy;
    this.overlay.guides = snap.guides;
    const doc = this.doc;
    for (const n of d.nodes) {
      const node = doc.nodes[n.id];
      if (!node) continue;
      const v = applyVec(n.parentInv, { x: dx, y: dy });
      node.x = n.x + v.x;
      node.y = n.y + v.y;
    }
    this.store.emit();
  }

  private endMove(d: Extract<Drag, { kind: 'move' }>, wp: Pt) {
    const doc = this.doc;
    const ids = d.nodes.map((n) => n.id).filter((id) => doc.nodes[id]);
    const exclude = new Set(ids);
    const frameId = deepestFrameAt(doc, this.state.pageId, wp, exclude);
    this.store.update(() => {
      for (const id of ids) {
        const n = doc.nodes[id];
        const parent = doc.nodes[n.parentId];
        if (parent && parent.type === 'GROUP') continue;
        if (n.type === 'FRAME' && isPage(doc, n.parentId)) continue;
        const target = frameId ?? this.state.pageId;
        if (target !== n.parentId && !isDescendant(doc, target, id)) moveToParent(doc, id, target, null);
      }
      for (const id of ids) if (doc.nodes[id]) normalizeGroupChain(doc, doc.nodes[id].parentId);
    });
  }

  // ---------- seleção por área ----------

  private updateMarquee(d: Extract<Drag, { kind: 'marquee' }>, wp: Pt) {
    const r = rectFromPoints([d.startWorld, wp]);
    this.overlay.marquee = r;
    const doc = this.doc;
    const hits: string[] = [];
    for (const id of childrenOf(doc, d.container)) {
      const n = doc.nodes[id];
      if (!n || !n.visible || n.locked) continue;
      const b = worldBounds(doc, id);
      if (b.x <= r.x + r.width && r.x <= b.x + b.width && b.y <= r.y + r.height && r.y <= b.y + b.height) hits.push(id);
    }
    const next = [...d.base];
    for (const id of hits) if (!next.includes(id)) next.push(id);
    this.store.setSelection(next);
  }

  // ---------- redimensionar ----------

  private startResize(hx: number, hy: number, sf: SelectionFrame) {
    if (!sf || sf.kind !== 'box') return;
    this.store.checkpoint();
    const doc = this.doc;
    const ids = this.movableSelection();
    if (!ids.length) return;
    let canSnap = true;
    let single: NodeStart | null = null;
    if (sf.single && ids.length === 1) {
      single = this.nodeStart(ids[0]);
      const w = worldMatrix(doc, ids[0]);
      canSnap = Math.abs(w[1]) < 1e-9 && Math.abs(w[2]) < 1e-9 && w[0] > 0 && w[3] > 0;
    }
    this.drag = {
      kind: 'resize',
      hx,
      hy,
      single,
      multi: single ? [] : ids.map((id) => this.nodeStart(id)),
      bounds: boundsOf(doc, ids)!,
      targets: snapTargets(doc, this.state.pageId, new Set(ids)),
      canSnap,
    };
  }

  private snapResizePoint(d: Extract<Drag, { kind: 'resize' }>, wp: Pt): Pt {
    if (!d.canSnap) return wp;
    const res = snapPoint(wp, d.targets, 6 / this.state.camera.zoom, d.hx !== 0.5, d.hy !== 0.5);
    this.overlay.guides = res.guides;
    return res.point;
  }

  private updateResize(d: Extract<Drag, { kind: 'resize' }>, wpRaw: Pt, shift: boolean, alt: boolean) {
    const doc = this.doc;
    const wp = this.snapResizePoint(d, wpRaw);
    const { hx, hy } = d;

    const solve = (w0: number, h0: number, p: Pt, lock: boolean) => {
      let left = 0;
      let right = w0;
      let top = 0;
      let bottom = h0;
      if (hx === 0) left = p.x;
      else if (hx === 1) right = p.x;
      if (hy === 0) top = p.y;
      else if (hy === 1) bottom = p.y;
      if (alt) {
        if (hx === 0) right = w0 - left;
        else if (hx === 1) left = w0 - right;
        if (hy === 0) bottom = h0 - top;
        else if (hy === 1) top = h0 - bottom;
      }
      if (lock && w0 > 0 && h0 > 0) {
        const ratio = w0 / h0;
        let w = right - left;
        let h = bottom - top;
        if (hx !== 0.5 && hy !== 0.5) {
          if (Math.abs(w) / ratio > Math.abs(h)) h = (h < 0 ? -1 : 1) * (Math.abs(w) / ratio);
          else w = (w < 0 ? -1 : 1) * Math.abs(h) * ratio;
        } else if (hx !== 0.5) h = Math.abs(w) / ratio;
        else w = Math.abs(h) * ratio;
        if (alt || hx === 0.5) {
          left = w0 / 2 - w / 2;
          right = w0 / 2 + w / 2;
        } else if (hx === 0) left = right - w;
        else right = left + w;
        if (alt || hy === 0.5) {
          top = h0 / 2 - h / 2;
          bottom = h0 / 2 + h / 2;
        } else if (hy === 0) top = bottom - h;
        else bottom = top + h;
      }
      return { left, right, top, bottom };
    };

    if (d.single) {
      const s = d.single;
      const n = doc.nodes[s.id];
      if (!n) return;
      const snap = s.snap;
      const local0 = localMatrix(snap);
      let p = applyMat(invert(multiply(s.parentWorld, local0)), wp);
      if (d.canSnap) p = roundPt(p);
      const lock = shift || snap.constrainProportions;
      const { left, right, top, bottom } = solve(snap.width, snap.height, p, lock);
      const flipNowX = right < left;
      const flipNowY = bottom < top;
      const nl = Math.min(left, right);
      const nt = Math.min(top, bottom);
      const w = Math.max(Math.abs(right - left), 1);
      let h = Math.max(Math.abs(bottom - top), 1);
      n.width = w;
      n.flipX = snap.flipX !== flipNowX;
      n.flipY = snap.flipY !== flipNowY;
      if (n.type === 'TEXT') {
        n.textAutoResize = hy !== 0.5 ? 'NONE' : 'HEIGHT';
        if (n.textAutoResize === 'HEIGHT') h = layoutText(n).height;
      }
      n.height = h;
      const c = applyMat(local0, { x: nl + w / 2, y: nt + h / 2 });
      n.x = c.x - w / 2;
      n.y = c.y - h / 2;
      n.rotation = snap.rotation;
      if (n.type === 'GROUP') {
        restoreDescendants(doc, s.descendants);
        scaleChildren(doc, n, w / Math.max(snap.width, 1e-6), h / Math.max(snap.height, 1e-6));
      } else if (n.type === 'FRAME') {
        const inv = invert(multiply(s.parentWorld, localMatrix(n)));
        for (const [cid, cw] of s.childWorld) {
          const c2 = doc.nodes[cid];
          if (c2) applyLocalMatrix(c2, multiply(inv, cw));
        }
      }
      this.overlay.label = null;
      this.store.emit();
      return;
    }

    // seleção múltipla: escala em relação à caixa total
    const B = d.bounds;
    const p = roundPt({ x: wp.x - B.x, y: wp.y - B.y });
    const { left, right, top, bottom } = solve(B.width, B.height, p, shift);
    const sx = B.width ? (right - left) / B.width : 1;
    const sy = B.height ? (bottom - top) / B.height : 1;
    for (const s of d.multi) {
      const n = doc.nodes[s.id];
      if (!n) continue;
      const snap = s.snap;
      const cw = { x: B.x + left + (s.center.x - B.x) * sx, y: B.y + top + (s.center.y - B.y) * sy };
      const w = Math.max(snap.width * Math.abs(sx), n.type === 'LINE' ? 0 : 1);
      const h = n.type === 'LINE' ? 0 : Math.max(snap.height * Math.abs(sy), 1);
      n.width = w;
      n.height = h;
      if (Math.abs(snap.rotation) < 1e-6) {
        n.flipX = snap.flipX !== sx < 0;
        n.flipY = snap.flipY !== sy < 0;
      }
      if (n.type === 'GROUP') {
        restoreDescendants(doc, s.descendants);
        scaleChildren(doc, n, w / Math.max(snap.width, 1e-6), h / Math.max(snap.height, 1e-6));
      }
      if (n.type === 'TEXT') {
        n.textAutoResize = 'NONE';
      }
      const c = applyMat(s.parentInv, cw);
      n.x = c.x - w / 2;
      n.y = c.y - h / 2;
    }
    this.store.emit();
  }

  // ---------- girar ----------

  private startRotate(wp: Pt, sf: SelectionFrame) {
    if (!sf || sf.kind !== 'box') return;
    const ids = this.movableSelection();
    if (!ids.length) return;
    this.store.checkpoint();
    const cs = sf.corners;
    const center = { x: (cs[0].x + cs[2].x) / 2, y: (cs[0].y + cs[2].y) / 2 };
    this.drag = {
      kind: 'rotate',
      center,
      startAngle: Math.atan2(wp.y - center.y, wp.x - center.x),
      nodes: ids.map((id) => this.nodeStart(id)),
      single: ids.length === 1,
    };
  }

  private updateRotate(d: Extract<Drag, { kind: 'rotate' }>, sp: Pt, wp: Pt, shift: boolean) {
    const doc = this.doc;
    let delta = Math.atan2(wp.y - d.center.y, wp.x - d.center.x) - d.startAngle;
    if (shift) {
      if (d.single) {
        const target = d.nodes[0].snap.rotation - toDeg(delta);
        const snapped = Math.round(target / 15) * 15;
        delta = toRad(d.nodes[0].snap.rotation - snapped);
      } else delta = toRad(Math.round(toDeg(delta) / 15) * 15);
    }
    for (const s of d.nodes) {
      const n = doc.nodes[s.id];
      if (!n) continue;
      const sign = determinant(s.parentWorld) < 0 ? -1 : 1;
      const cw = rotateAround(s.center, d.center, delta);
      const c = applyMat(s.parentInv, cw);
      n.rotation = normalizeRotation(s.snap.rotation - toDeg(delta) * sign);
      n.x = c.x - n.width / 2;
      n.y = c.y - n.height / 2;
    }
    const shown = d.single ? doc.nodes[d.nodes[0].id]?.rotation ?? 0 : -toDeg(delta);
    this.overlay.label = { text: `${Math.round(normalizeRotation(shown))}°`, x: sp.x + 16, y: sp.y + 20 };
    this.store.emit();
  }

  // ---------- pontas da linha ----------

  private startEndpoint(id: string, which: 0 | 1) {
    const doc = this.doc;
    const n = doc.nodes[id];
    if (!n || n.locked) return;
    this.store.checkpoint();
    const m = localMatrix(n);
    const a = applyMat(m, { x: 0, y: 0 });
    const b = applyMat(m, { x: n.width, y: 0 });
    this.drag = {
      kind: 'endpoint',
      id,
      which,
      fixed: which === 0 ? b : a,
      parentInv: invert(parentWorldMatrix(doc, id)),
      targets: snapTargets(doc, this.state.pageId, new Set([id])),
    };
  }

  private updateEndpoint(d: Extract<Drag, { kind: 'endpoint' }>, wp: Pt, shift: boolean) {
    const n = this.doc.nodes[d.id];
    if (!n) return;
    const snapped = snapPoint(wp, d.targets, 6 / this.state.camera.zoom);
    this.overlay.guides = snapped.guides;
    let p = roundPt(applyMat(d.parentInv, snapped.point));
    if (shift) p = snap45(d.fixed, p);
    if (d.which === 0) setLineEndpoints(n, p, d.fixed);
    else setLineEndpoints(n, d.fixed, p);
    this.store.emit();
  }

  // ---------- criar formas ----------

  private startCreate(tool: Tool, sp: Pt, wp: Pt) {
    const doc = this.doc;
    const type = TOOL_TYPES[tool];
    if (!type) return;
    this.store.checkpoint();
    const parentId = deepestFrameAt(doc, this.state.pageId, wp) ?? this.state.pageId;
    const parentInv = invert(doc.nodes[parentId] ? worldMatrix(doc, parentId) : [1, 0, 0, 1, 0, 0]);
    const targets = snapTargets(doc, this.state.pageId, new Set());
    const snapped = snapPoint(wp, targets, 6 / this.state.camera.zoom).point;
    const start = roundPt(applyMat(parentInv, snapped));
    let nodeId: string | null = null;
    if (type !== 'TEXT') {
      const node = createNode(type, {
        x: start.x,
        y: start.y,
        width: 0,
        height: 0,
        name: nextName(doc, type),
        arrowEnd: tool === 'ARROW' ? true : undefined,
      });
      if (tool === 'ARROW') node.name = node.name.replace('Linha', 'Seta');
      this.store.update((s) => {
        insertNode(s.doc, node, parentId);
        s.selection = [node.id];
      });
      nodeId = node.id;
    }
    this.drag = { kind: 'create', tool, nodeId, parentId, parentInv, start, startScreen: sp, moved: false, targets };
  }

  private updateCreate(d: Extract<Drag, { kind: 'create' }>, sp: Pt, wpRaw: Pt, shift: boolean, alt: boolean) {
    if (!d.moved && dist(sp, d.startScreen) < 3) return;
    d.moved = true;
    const doc = this.doc;
    const snapRes = snapPoint(wpRaw, d.targets, 6 / this.state.camera.zoom);
    this.overlay.guides = snapRes.guides;
    const p = roundPt(applyMat(d.parentInv, snapRes.point));
    if (d.tool === 'TEXT' && !d.nodeId) {
      const node = createNode('TEXT', { x: d.start.x, y: d.start.y, textAutoResize: 'HEIGHT', width: 1 });
      fitTextBox(node);
      this.store.update((s) => {
        insertNode(s.doc, node, d.parentId);
        s.selection = [node.id];
      });
      d.nodeId = node.id;
    }
    const n = d.nodeId ? doc.nodes[d.nodeId] : null;
    if (!n) return;
    if (n.type === 'LINE') {
      setLineEndpoints(n, d.start, shift ? snap45(d.start, p) : p);
      this.store.emit();
      return;
    }
    let dx = p.x - d.start.x;
    let dy = p.y - d.start.y;
    if (shift) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx < 0 ? -1 : 1) * m;
      dy = (dy < 0 ? -1 : 1) * m;
    }
    if (alt) {
      n.x = d.start.x - Math.abs(dx);
      n.y = d.start.y - Math.abs(dy);
      n.width = Math.abs(dx) * 2;
      n.height = Math.abs(dy) * 2;
    } else {
      n.x = Math.min(d.start.x, d.start.x + dx);
      n.y = Math.min(d.start.y, d.start.y + dy);
      n.width = Math.abs(dx);
      n.height = Math.abs(dy);
    }
    if (n.type === 'TEXT') {
      n.width = Math.max(n.width, 1);
      fitTextBox(n);
    }
    this.store.emit();
  }

  private endCreate(d: Extract<Drag, { kind: 'create' }>) {
    const doc = this.doc;
    if (d.tool === 'TEXT') {
      let id = d.nodeId;
      if (!id) {
        const node = createNode('TEXT', { x: d.start.x, y: d.start.y });
        fitTextBox(node);
        this.store.update((s) => insertNode(s.doc, node, d.parentId));
        id = node.id;
      }
      this.state.tool = 'MOVE';
      this.state.editingTextId = id;
      this.state.selection = [id];
      this.store.emit();
      return;
    }
    const n = d.nodeId ? doc.nodes[d.nodeId] : null;
    if (!n) return;
    this.store.update((s) => {
      if (n.type === 'LINE') {
        if (n.width < 1) setLineEndpoints(n, d.start, { x: d.start.x + 100, y: d.start.y });
      } else if (n.width < 1 && n.height < 1) {
        n.width = 100;
        n.height = 100;
      } else {
        n.width = Math.max(n.width, 1);
        n.height = Math.max(n.height, 1);
      }
      // um frame desenhado em volta de objetos passa a contê-los
      if (n.type === 'FRAME' && d.moved) {
        const fb = worldBounds(s.doc, n.id);
        for (const sid of [...childrenOf(s.doc, n.parentId)]) {
          if (sid === n.id) continue;
          const sib = s.doc.nodes[sid];
          if (sib && rectContains(fb, worldBounds(s.doc, sid))) moveToParent(s.doc, sid, n.id, null);
        }
      }
      s.tool = 'MOVE';
    });
  }

  private endPencil(parentId: string) {
    const pts = this.overlay.pencil;
    this.overlay.pencil = null;
    if (!pts || pts.length < 2) return;
    const doc = this.doc;
    const parentInv = invert(doc.nodes[parentId] ? worldMatrix(doc, parentId) : [1, 0, 0, 1, 0, 0]);
    const local = pts.map((p) => applyMat(parentInv, p));
    const r = rectFromPoints(local);
    const w = Math.max(r.width, 1);
    const h = Math.max(r.height, 1);
    const ox = r.x - (w - r.width) / 2;
    const oy = r.y - (h - r.height) / 2;
    const node = createNode('VECTOR', {
      x: ox,
      y: oy,
      width: w,
      height: h,
      name: nextName(doc, 'VECTOR'),
      points: local.map((p) => ({ x: (p.x - ox) / w, y: (p.y - oy) / h })),
    });
    this.store.checkpoint();
    this.store.update((s) => {
      insertNode(s.doc, node, parentId);
      s.selection = [node.id];
    });
  }

  // ---------- outros eventos ----------

  private onDoubleClick(e: MouseEvent) {
    if (this.state.tool !== 'MOVE') return;
    const doc = this.doc;
    const wp = this.toWorld(this.screenPoint(e));
    const hit = hitTest(doc, this.state.pageId, wp, this.state.camera.zoom);
    if (!hit || hit.topFrameBg) return;
    const leaf = hit.id;
    const sel = this.state.selection;
    if (sel.length === 1 && sel[0] !== leaf && isDescendant(doc, leaf, sel[0])) {
      // entra um nível no grupo/frame selecionado
      let cur = leaf;
      while (doc.nodes[cur] && doc.nodes[cur].parentId !== sel[0]) cur = doc.nodes[cur].parentId;
      if (doc.nodes[cur]) this.store.setSelection([cur]);
      return;
    }
    if (doc.nodes[leaf]?.type === 'TEXT') this.store.startTextEditing(leaf);
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const sp = this.screenPoint(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.metaKey) {
      const dy = Math.max(-60, Math.min(60, e.deltaY * unit));
      this.store.zoomAt(sp, this.state.camera.zoom * Math.pow(2, -dy / 100));
      return;
    }
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    if (e.shiftKey && !dx) {
      dx = dy;
      dy = 0;
    }
    this.store.panBy(-dx, -dy);
  }

  private onContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (this.state.tool !== 'MOVE') this.store.setTool('MOVE');
    const sp = this.screenPoint(e);
    const wp = this.toWorld(sp);
    const doc = this.doc;
    const label = hitFrameLabel(frameLabels(doc, this.state.pageId, this.state.camera), sp);
    const hit = label ? { id: label, topFrameBg: false } : hitTest(doc, this.state.pageId, wp, this.state.camera.zoom);
    if (hit && !hit.topFrameBg) {
      const id = label ?? resolveSelectable(doc, hit.id, this.state.selection);
      if (!this.state.selection.includes(id)) this.state.selection = [id];
    }
    this.store.update((s) => (s.ui.contextMenu = { x: e.clientX, y: e.clientY, world: wp }));
  }
}
