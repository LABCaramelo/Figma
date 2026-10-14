import { useSyncExternalStore } from 'react';
import { type Pt, type Rect, clamp } from '../canvas/geometry';
import { fitTextBox } from '../canvas/shapes';
import { createEmptyDocument } from '../model/defaults';
import { deleteNode, getPage, normalizeGroupChain } from '../model/document';
import type { DocumentData, Page, Tool } from '../model/types';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface ContextMenuState {
  x: number;
  y: number;
  world: Pt;
}

export type Theme = 'light' | 'dark';

export interface UIState {
  contextMenu: ContextMenuState | null;
  renamingId: string | null;
  expanded: Record<string, boolean>;
  showShortcuts: boolean;
  showQuickActions: boolean;
  toast: { message: string; key: number } | null;
  hidden: boolean;
  theme: Theme;
}

export interface EditorState {
  doc: DocumentData;
  pageId: string;
  selection: string[];
  hoverId: string | null;
  tool: Tool;
  camera: Camera;
  pageCameras: Record<string, Camera>;
  editingTextId: string | null;
  viewport: { width: number; height: number };
  ui: UIState;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;
const MAX_HISTORY = 150;

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('prancheta.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* sem armazenamento */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export class EditorStore {
  state: EditorState;
  version = 0;
  /** Pede ao canvas para enquadrar o conteúdo assim que souber seu tamanho. */
  fitPending = true;
  private listeners = new Set<() => void>();
  private past: string[] = [];
  private future: string[] = [];
  private toastTimer: number | undefined;

  constructor() {
    this.state = this.makeState(createEmptyDocument(), initialTheme(), { width: 800, height: 600 });
  }

  private makeState(doc: DocumentData, theme: Theme, viewport: { width: number; height: number }): EditorState {
    const expanded: Record<string, boolean> = {};
    for (const p of doc.pages) for (const id of p.children) if (doc.nodes[id]?.type === 'FRAME') expanded[id] = true;
    return {
      doc,
      pageId: doc.pages[0].id,
      selection: [],
      hoverId: null,
      tool: 'MOVE',
      camera: { x: 0, y: 0, zoom: 1 },
      pageCameras: {},
      editingTextId: null,
      viewport,
      ui: { contextMenu: null, renamingId: null, expanded, showShortcuts: false, showQuickActions: false, toast: null, hidden: false, theme },
    };
  }

  load(doc: DocumentData) {
    this.state = this.makeState(doc, this.state.ui.theme, this.state.viewport);
    this.past = [];
    this.future = [];
    this.fitPending = true;
    this.emit();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  update(fn: (s: EditorState) => void) {
    fn(this.state);
    this.emit();
  }

  get page(): Page {
    return getPage(this.state.doc, this.state.pageId) ?? this.state.doc.pages[0];
  }

  // ---------- histórico ----------

  private snapshot(): string {
    const { doc, selection, pageId } = this.state;
    return JSON.stringify({ name: doc.name, pages: doc.pages, nodes: doc.nodes, selection, pageId });
  }

  private restore(json: string) {
    const s = JSON.parse(json);
    const doc = this.state.doc;
    doc.name = s.name;
    doc.pages = s.pages;
    doc.nodes = s.nodes;
    this.state.pageId = doc.pages.some((p) => p.id === s.pageId) ? s.pageId : doc.pages[0].id;
    this.state.selection = (s.selection as string[]).filter((id) => doc.nodes[id]);
    this.state.editingTextId = null;
    this.state.hoverId = null;
  }

  /** Salva o estado atual no histórico. Chame ANTES de modificar o documento. */
  checkpoint() {
    const snap = this.snapshot();
    if (this.past[this.past.length - 1] !== snap) {
      this.past.push(snap);
      if (this.past.length > MAX_HISTORY) this.past.shift();
    }
    this.future = [];
  }

  canUndo = () => this.past.length > 0;
  canRedo = () => this.future.length > 0;

  undo() {
    const cur = this.snapshot();
    while (this.past.length) {
      const s = this.past.pop()!;
      if (s !== cur) {
        this.future.push(cur);
        this.restore(s);
        this.emit();
        return true;
      }
    }
    return false;
  }

  redo() {
    const cur = this.snapshot();
    while (this.future.length) {
      const s = this.future.pop()!;
      if (s !== cur) {
        this.past.push(cur);
        this.restore(s);
        this.emit();
        return true;
      }
    }
    return false;
  }

  // ---------- seleção e ferramentas ----------

  setSelection(ids: string[]) {
    this.state.selection = ids;
    this.emit();
  }

  setHover(id: string | null) {
    if (this.state.hoverId === id) return;
    this.state.hoverId = id;
    this.emit();
  }

  setTool(tool: Tool) {
    this.finishTextEditing();
    this.state.tool = tool;
    this.emit();
  }

  setPage(id: string) {
    if (id === this.state.pageId || !getPage(this.state.doc, id)) return;
    this.finishTextEditing();
    this.state.pageCameras[this.state.pageId] = { ...this.state.camera };
    this.state.pageId = id;
    this.state.selection = [];
    this.state.hoverId = null;
    const cam = this.state.pageCameras[id];
    if (cam) this.state.camera = { ...cam };
    else this.fitPending = true;
    this.emit();
  }

  toast(message: string) {
    const key = Date.now();
    this.state.ui.toast = { message, key };
    this.emit();
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      if (this.state.ui.toast?.key === key) {
        this.state.ui.toast = null;
        this.emit();
      }
    }, 2600);
  }

  setTheme(theme: Theme) {
    this.state.ui.theme = theme;
    try {
      localStorage.setItem('prancheta.theme', theme);
    } catch {
      /* ignora */
    }
    document.documentElement.dataset.theme = theme;
    this.emit();
  }

  // ---------- edição de texto ----------

  startTextEditing(id: string) {
    const n = this.state.doc.nodes[id];
    if (!n || n.type !== 'TEXT' || n.locked) return;
    this.checkpoint();
    this.state.editingTextId = id;
    this.state.selection = [id];
    this.state.tool = 'MOVE';
    this.emit();
  }

  finishTextEditing() {
    const id = this.state.editingTextId;
    if (!id) return;
    this.state.editingTextId = null;
    const doc = this.state.doc;
    const n = doc.nodes[id];
    if (n) {
      if (!(n.text ?? '').trim()) {
        deleteNode(doc, id);
        this.state.selection = this.state.selection.filter((x) => x !== id);
      } else {
        if (n.autoName) n.name = (n.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
        fitTextBox(n);
        normalizeGroupChain(doc, n.parentId);
      }
    }
    this.emit();
  }

  // ---------- câmera ----------

  screenToWorld(p: Pt): Pt {
    const c = this.state.camera;
    return { x: (p.x - c.x) / c.zoom, y: (p.y - c.y) / c.zoom };
  }

  viewportWorldRect(): Rect {
    const { width, height } = this.state.viewport;
    const a = this.screenToWorld({ x: 0, y: 0 });
    const z = this.state.camera.zoom;
    return { x: a.x, y: a.y, width: width / z, height: height / z };
  }

  viewportCenterWorld(): Pt {
    const { width, height } = this.state.viewport;
    return this.screenToWorld({ x: width / 2, y: height / 2 });
  }

  zoomAt(sp: Pt, zoom: number) {
    const c = this.state.camera;
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const wx = (sp.x - c.x) / c.zoom;
    const wy = (sp.y - c.y) / c.zoom;
    this.state.camera = { zoom: z, x: sp.x - wx * z, y: sp.y - wy * z };
    this.emit();
  }

  zoomBy(factor: number) {
    const { width, height } = this.state.viewport;
    this.zoomAt({ x: width / 2, y: height / 2 }, this.state.camera.zoom * factor);
  }

  zoomTo(zoom: number) {
    const { width, height } = this.state.viewport;
    this.zoomAt({ x: width / 2, y: height / 2 }, zoom);
  }

  zoomToRect(r: Rect | null, maxZoom = MAX_ZOOM) {
    const { width, height } = this.state.viewport;
    if (!r) {
      this.state.camera = { zoom: 1, x: width / 2, y: height / 2 };
      this.emit();
      return;
    }
    const pad = 64;
    const z = clamp(
      Math.min((width - pad * 2) / Math.max(r.width, 1), (height - pad * 2) / Math.max(r.height, 1)),
      MIN_ZOOM,
      maxZoom,
    );
    this.state.camera = {
      zoom: z,
      x: width / 2 - (r.x + r.width / 2) * z,
      y: height / 2 - (r.y + r.height / 2) * z,
    };
    this.emit();
  }

  panBy(dx: number, dy: number) {
    this.state.camera.x += dx;
    this.state.camera.y += dy;
    this.emit();
  }
}

export const store = new EditorStore();

/** Assina o store; o componente re-renderiza a cada mudança. */
export function useEditor(): EditorState {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.state;
}
