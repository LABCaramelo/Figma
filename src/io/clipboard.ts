import { IDENTITY, applyMat, invert, multiply, rectContains, rectFromPoints, rectsIntersect, translation } from '../canvas/geometry';
import { deepestFrameAt } from '../canvas/hitTest';
import { fitTextBox } from '../canvas/shapes';
import { addImageToDoc, deleteSelection, insertImages, selectedTop } from '../actions';
import { createNode, uid } from '../model/defaults';
import {
  applyLocalMatrix,
  boxCorners,
  childrenOf,
  imageIdsOf,
  insertNode,
  localMatrix,
  normalizeGroupChain,
  pageIdOf,
  sortByPaintOrder,
  worldBounds,
  worldMatrix,
} from '../model/document';
import type { SceneNode } from '../model/types';
import { store } from '../store/store';
import { copyAsPng } from './export';

const PREFIX = 'PRANCHETA/1:';

interface ClipData {
  roots: string[];
  /** Raízes já com a transformação do mundo aplicada (parentId vazio). */
  nodes: Record<string, SceneNode>;
  images: Record<string, string>;
  parents: string[];
}

/** Cópia em memória, usada quando o navegador não deixa ler a área de transferência. */
let memory: string | null = null;

export function isEditableTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function serializeSelection(): string | null {
  const doc = store.state.doc;
  const ids = selectedTop();
  if (!ids.length) return null;
  const nodes: Record<string, SceneNode> = {};
  const visit = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    nodes[id] = structuredClone(n);
    n.children?.forEach(visit);
  };
  for (const id of ids) {
    visit(id);
    applyLocalMatrix(nodes[id], worldMatrix(doc, id));
    nodes[id].parentId = '';
  }
  const images: Record<string, string> = {};
  for (const imgId of imageIdsOf(doc, ids)) if (doc.images[imgId]) images[imgId] = doc.images[imgId];
  const data: ClipData = { roots: ids, nodes, images, parents: ids.map((id) => doc.nodes[id].parentId) };
  return PREFIX + JSON.stringify(data);
}

function pasteData(data: ClipData) {
  const doc = store.state.doc;
  const pageId = store.state.pageId;
  const sel = store.state.selection.filter((id) => doc.nodes[id]);
  store.checkpoint();

  const idMap = new Map(Object.keys(data.nodes).map((k) => [k, uid()]));
  const imgMap = new Map<string, string>();
  for (const [k, src] of Object.entries(data.images ?? {})) imgMap.set(k, addImageToDoc(doc, src));
  const clone = (oldId: string): SceneNode => {
    const n: SceneNode = structuredClone(data.nodes[oldId]);
    n.id = idMap.get(oldId)!;
    if (n.children) n.children = n.children.filter((c) => data.nodes[c]).map((c) => idMap.get(c)!);
    for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE') p.imageId = imgMap.get(p.imageId) ?? p.imageId;
    return n;
  };

  // onde colar: dentro do frame selecionado, ao lado da seleção ou no pai original
  let parentId = pageId;
  let index: number | undefined;
  const single = sel.length === 1 ? doc.nodes[sel[0]] : null;
  if (single && single.type === 'FRAME' && !data.roots.includes(single.id)) parentId = single.id;
  else if (sel.length) {
    const top = sortByPaintOrder(doc, sel)[sel.length - 1];
    parentId = doc.nodes[top].parentId;
    index = childrenOf(doc, parentId).indexOf(top) + 1;
  } else {
    const p = data.parents[0];
    if (p && data.parents.every((x) => x === p) && doc.nodes[p] && pageIdOf(doc, p) === pageId) parentId = p;
  }

  const roots = data.roots.filter((r) => data.nodes[r]).map(clone);
  const others = Object.keys(data.nodes)
    .filter((k) => !data.roots.includes(k))
    .map((k) => {
      const n = clone(k);
      n.parentId = idMap.get(data.nodes[k].parentId) ?? n.parentId;
      return n;
    });

  // posição: mantém a original se couber; senão centraliza no frame ou na tela
  const b = rectFromPoints(roots.flatMap((n) => boxCorners(n.width, n.height).map((p) => applyMat(localMatrix(n), p))));
  let dx = 0;
  let dy = 0;
  const container = doc.nodes[parentId];
  const area = container?.type === 'FRAME' ? worldBounds(doc, parentId) : store.viewportWorldRect();
  const fits = container?.type === 'FRAME' ? rectContains(area, b) : rectsIntersect(area, b);
  if (!fits) {
    dx = Math.round(area.x + area.width / 2 - (b.x + b.width / 2));
    dy = Math.round(area.y + area.height / 2 - (b.y + b.height / 2));
  }
  const pInv = invert(container ? worldMatrix(doc, parentId) : IDENTITY);
  for (const n of others) doc.nodes[n.id] = n;
  for (const n of roots) {
    applyLocalMatrix(n, multiply(pInv, multiply(translation(dx, dy), localMatrix(n))));
    insertNode(doc, n, parentId, index === undefined ? undefined : index++);
  }
  normalizeGroupChain(doc, parentId);
  store.state.selection = roots.map((n) => n.id);
  store.state.tool = 'MOVE';
  store.emit();
}

function pasteText(text: string) {
  const doc = store.state.doc;
  const center = store.viewportCenterWorld();
  const parentId = deepestFrameAt(doc, store.state.pageId, center) ?? store.state.pageId;
  const local = applyMat(invert(doc.nodes[parentId] ? worldMatrix(doc, parentId) : IDENTITY), center);
  const n = createNode('TEXT', { text: text.replace(/\r\n?/g, '\n').slice(0, 20000), x: Math.round(local.x), y: Math.round(local.y) });
  n.name = (n.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 60) || 'Texto';
  fitTextBox(n);
  if (n.width > 600) {
    n.textAutoResize = 'HEIGHT';
    n.width = 600;
    fitTextBox(n);
  }
  n.x = Math.round(local.x - n.width / 2);
  n.y = Math.round(local.y - n.height / 2);
  store.checkpoint();
  insertNode(doc, n, parentId);
  normalizeGroupChain(doc, parentId);
  store.state.selection = [n.id];
  store.emit();
}

export function pasteString(text: string) {
  if (text.startsWith(PREFIX)) {
    try {
      pasteData(JSON.parse(text.slice(PREFIX.length)));
    } catch {
      store.toast('Não foi possível colar o conteúdo');
    }
  } else if (text.trim()) pasteText(text);
}

// ---------- comandos do menu ----------

export function copySelection(cut = false) {
  const s = serializeSelection();
  if (!s) return;
  memory = s;
  let ok = false;
  try {
    ok = document.execCommand(cut ? 'cut' : 'copy');
  } catch {
    ok = false;
  }
  if (!ok) {
    navigator.clipboard?.writeText(s).catch(() => undefined);
    if (cut) deleteSelection();
  }
}

export async function pasteFromMenu() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) return pasteString(text);
  } catch {
    /* sem permissão: usa a cópia em memória */
  }
  if (memory) pasteString(memory);
}

export function copySelectionAsPng() {
  void copyAsPng(store.state.selection);
}

// ---------- eventos nativos ----------

export function installClipboard(): () => void {
  const onCopy = (e: ClipboardEvent, cut: boolean) => {
    if (isEditableTarget(e.target) || store.state.editingTextId) return;
    const s = serializeSelection();
    if (!s) return;
    memory = s;
    e.clipboardData?.setData('text/plain', s);
    e.preventDefault();
    if (cut) deleteSelection();
  };
  const copy = (e: ClipboardEvent) => onCopy(e, false);
  const cut = (e: ClipboardEvent) => onCopy(e, true);
  const paste = (e: ClipboardEvent) => {
    if (isEditableTarget(e.target) || store.state.editingTextId) return;
    const dt = e.clipboardData;
    if (!dt) return;
    e.preventDefault();
    const text = dt.getData('text/plain');
    const files = [...dt.files].filter((f) => f.type.startsWith('image/'));
    if (text.startsWith(PREFIX)) pasteString(text);
    else if (files.length) void insertImages(files);
    else if (text) pasteString(text);
  };
  document.addEventListener('copy', copy);
  document.addEventListener('cut', cut);
  document.addEventListener('paste', paste);
  return () => {
    document.removeEventListener('copy', copy);
    document.removeEventListener('cut', cut);
    document.removeEventListener('paste', paste);
  };
}
