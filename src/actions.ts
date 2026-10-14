import {
  IDENTITY,
  type Pt,
  type Rect,
  applyMat,
  applyVec,
  invert,
  multiply,
  rectFromPoints,
  rectsIntersect,
  scaling,
  translation,
} from './canvas/geometry';
import { deepestFrameAt } from './canvas/hitTest';
import { imageSize, readFileAsDataURL } from './canvas/images';
import { fitTextBox, flattenPath } from './canvas/shapes';
import { createNode, createPage, DEFAULT_SHAPE_FILL, solid, uid } from './model/defaults';
import {
  ancestors,
  applyAutoLayout,
  applyLocalMatrix,
  boundsOf,
  childrenOf,
  cloneNodeTree,
  deleteNode,
  getPage,
  insertNode,
  isPage,
  localMatrix,
  moveToParent,
  nextName,
  normalizeGroupChain,
  normalizeRotation,
  pageIdOf,
  parentBounds,
  parentWorldMatrix,
  scaleChildren,
  sortByPaintOrder,
  topLevelIds,
  worldBounds,
  worldCorners,
  worldMatrix,
} from './model/document';
import type { BooleanOperationType, DocumentData, ImagePaint, SceneNode } from './model/types';
import { store } from './store/store';

const S = () => store.state;
const D = () => store.state.doc;

/** Aplica uma alteração ao documento, criando um ponto de desfazer. */
export function commit(fn: (doc: DocumentData) => void, checkpoint = true) {
  if (checkpoint) store.checkpoint();
  fn(store.state.doc);
  store.emit();
}

/** Ids selecionados sem ancestral selecionado, em ordem de pintura. */
export function selectedTop(): string[] {
  const doc = D();
  return sortByPaintOrder(doc, topLevelIds(doc, S().selection.filter((id) => doc.nodes[id])));
}

const unlocked = (id: string) => !D().nodes[id]?.locked;

/** Move o nó por um deslocamento dado em coordenadas do mundo. */
function moveWorld(doc: DocumentData, id: string, dx: number, dy: number) {
  const n = doc.nodes[id];
  if (!n || (!dx && !dy)) return;
  const v = applyVec(invert(parentWorldMatrix(doc, id)), { x: dx, y: dy });
  n.x += v.x;
  n.y += v.y;
}

// ---------- duplicar e excluir ----------

/**
 * Duplica os nós logo acima dos originais. Com `offset`, frames de nível
 * superior vão para a direita do original (como no Figma); o resto fica no
 * mesmo lugar. Não cria ponto de desfazer nem emite: quem chama decide.
 */
export function duplicateNodes(ids: string[], offset: boolean): string[] {
  const doc = D();
  const out: string[] = [];
  for (const id of sortByPaintOrder(doc, topLevelIds(doc, ids))) {
    const src = doc.nodes[id];
    if (!src) continue;
    const tree = cloneNodeTree(doc, id);
    const root = tree[0];
    for (const n of tree.slice(1)) doc.nodes[n.id] = n;
    const list = childrenOf(doc, src.parentId);
    insertNode(doc, root, src.parentId, list.indexOf(id) + 1);
    if (offset && src.type === 'FRAME' && isPage(doc, src.parentId)) {
      const gap = 40;
      const sib = childrenOf(doc, src.parentId)
        .filter((s) => s !== root.id && doc.nodes[s])
        .map((s) => parentBounds(doc.nodes[s]));
      const b = parentBounds(src);
      let x = b.x + b.width + gap;
      for (let guard = 0; guard < 500; guard++) {
        const cand: Rect = { x, y: b.y, width: b.width, height: b.height };
        const hit = sib.find((r) => rectsIntersect(cand, r));
        if (!hit) break;
        x = hit.x + hit.width + gap;
      }
      root.x += x - b.x;
    }
    out.push(root.id);
  }
  return out;
}

export function duplicateSelection() {
  const ids = selectedTop();
  if (!ids.length) return;
  store.checkpoint();
  S().selection = duplicateNodes(ids, true);
  store.emit();
}

export function deleteSelection() {
  const ids = selectedTop();
  if (!ids.length) return;
  commit((doc) => {
    for (const id of ids) deleteNode(doc, id);
    S().selection = [];
    S().hoverId = null;
  });
}

// ---------- agrupar ----------

export function groupSelection() {
  const ids = selectedTop();
  if (!ids.length) return;
  commit((doc) => {
    const top = ids[ids.length - 1];
    const parentId = doc.nodes[top].parentId;
    const g = createNode('GROUP', { name: nextName(doc, 'GROUP'), width: 0, height: 0 });
    insertNode(doc, g, parentId, childrenOf(doc, parentId).indexOf(top) + 1);
    for (const id of ids) moveToParent(doc, id, g.id, null);
    normalizeGroupChain(doc, g.id);
    S().selection = [g.id];
  });
}

export function ungroupSelection() {
  const doc = D();
  const ids = selectedTop().filter((id) => doc.nodes[id].type === 'GROUP' || doc.nodes[id].type === 'FRAME');
  if (!ids.length) return;
  commit((doc) => {
    const sel: string[] = [];
    for (const id of ids) {
      const g = doc.nodes[id];
      if (!g) continue;
      const parentId = g.parentId;
      const list = childrenOf(doc, parentId);
      const before = list[list.indexOf(id) + 1] ?? null;
      for (const k of [...(g.children ?? [])]) {
        moveToParent(doc, k, parentId, before);
        sel.push(k);
      }
      if (doc.nodes[id]) deleteNode(doc, id);
      normalizeGroupChain(doc, parentId);
    }
    S().selection = sel.filter((id) => doc.nodes[id]);
  });
}

/** Envolve a seleção num frame do tamanho exato dela (Ctrl+Alt+G). */
export function frameSelection() {
  const ids = selectedTop();
  if (!ids.length) return;
  commit((doc) => {
    const top = ids[ids.length - 1];
    const parentId = doc.nodes[top].parentId;
    const pInv = invert(doc.nodes[parentId] ? worldMatrix(doc, parentId) : IDENTITY);
    const r = rectFromPoints(ids.flatMap((id) => worldCorners(doc, id).map((p) => applyMat(pInv, p))));
    const f = createNode('FRAME', { name: nextName(doc, 'FRAME'), x: r.x, y: r.y, width: r.width, height: r.height });
    insertNode(doc, f, parentId, childrenOf(doc, parentId).indexOf(top) + 1);
    for (const id of ids) moveToParent(doc, id, f.id, null);
    normalizeGroupChain(doc, parentId);
    S().ui.expanded[f.id] = true;
    S().selection = [f.id];
  });
}

/** Adiciona ou altera Auto Layout na seleção (Shift+A). */
export function autoLayoutSelection() {
  const ids = selectedTop();
  if (!ids.length) return;
  commit((doc) => {
    // Se selecionou um único frame
    if (ids.length === 1 && doc.nodes[ids[0]]?.type === 'FRAME') {
      const f = doc.nodes[ids[0]];
      if (!f.layoutMode || f.layoutMode === 'NONE') {
        f.layoutMode = 'VERTICAL';
        f.itemSpacing = f.itemSpacing ?? 10;
        f.paddingTop = f.paddingTop ?? 10;
        f.paddingRight = f.paddingRight ?? 10;
        f.paddingBottom = f.paddingBottom ?? 10;
        f.paddingLeft = f.paddingLeft ?? 10;
        f.primaryAxisAlignItems = f.primaryAxisAlignItems ?? 'MIN';
        f.counterAxisAlignItems = f.counterAxisAlignItems ?? 'MIN';
      } else {
        f.layoutMode = f.layoutMode === 'VERTICAL' ? 'HORIZONTAL' : 'NONE';
      }
      applyAutoLayout(doc, f.id);
      return;
    }

    // Se selecionou múltiplos objetos ou outro tipo: cria frame em volta com Auto Layout!
    const top = ids[ids.length - 1];
    const parentId = doc.nodes[top].parentId;
    const pInv = invert(doc.nodes[parentId] ? worldMatrix(doc, parentId) : IDENTITY);
    const r = rectFromPoints(ids.flatMap((id) => worldCorners(doc, id).map((p) => applyMat(pInv, p))));
    const f = createNode('FRAME', {
      name: nextName(doc, 'FRAME'),
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 10,
      paddingTop: 10,
      paddingRight: 10,
      paddingBottom: 10,
      paddingLeft: 10,
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
    });
    insertNode(doc, f, parentId, childrenOf(doc, parentId).indexOf(top) + 1);
    for (const id of ids) moveToParent(doc, id, f.id, null);
    normalizeGroupChain(doc, parentId);
    applyAutoLayout(doc, f.id);
    S().ui.expanded[f.id] = true;
    S().selection = [f.id];
  });
}

// ---------- operações booleanas e componentes ----------

export function createBooleanOperation(op: BooleanOperationType = 'UNION') {
  const ids = selectedTop();
  if (ids.length < 2) return store.toast('Selecione 2 ou mais formas para operação booleana');
  commit((doc) => {
    const top = ids[ids.length - 1];
    const parentId = doc.nodes[top].parentId;
    const pInv = invert(doc.nodes[parentId] ? worldMatrix(doc, parentId) : IDENTITY);
    const r = rectFromPoints(ids.flatMap((id) => worldCorners(doc, id).map((p) => applyMat(pInv, p))));

    const opNames: Record<BooleanOperationType, string> = {
      UNION: 'União',
      SUBTRACT: 'Subtração',
      INTERSECT: 'Interseção',
      EXCLUDE: 'Exclusão',
    };

    const firstFills = doc.nodes[ids[0]]?.fills ?? [solid(DEFAULT_SHAPE_FILL)];
    const node = createNode('BOOLEAN_OPERATION', {
      name: `${opNames[op]} 1`,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      booleanOperation: op,
      fills: structuredClone(firstFills),
    });

    insertNode(doc, node, parentId, childrenOf(doc, parentId).indexOf(top) + 1);
    for (const id of ids) moveToParent(doc, id, node.id, null);
    normalizeGroupChain(doc, parentId);
    S().ui.expanded[node.id] = true;
    S().selection = [node.id];
  });
  store.toast('Operação booleana criada');
}

export function flattenSelection() {
  const ids = selectedTop();
  if (!ids.length) return;
  if (ids.length !== 1) return store.toast('Achatar múltiplas camadas ainda não é suportado. As camadas foram preservadas.');
  const original = D().nodes[ids[0]];
  if (original.locked) return store.toast('Desbloqueie a camada antes de achatar');
  if (original.type === 'VECTOR') return store.toast('A camada selecionada já é um vetor');
  const path = flattenPath(original);
  if (!path) return store.toast('Achatar esta camada ainda não é suportado. A camada foi preservada.');
  commit((doc) => {
    // Converte no mesmo nó: mantém matriz local, estilo, ordem e referências.
    const node = doc.nodes[ids[0]];
    node.closed = node.type !== 'LINE';
    node.type = 'VECTOR';
    node.vectorPath = path;
    node.vectorStrokeCap = 'butt';
    node.vectorStrokeJoin = 'miter';
    delete node.points;
  });
  store.toast('Camada achatada em vetor');
}

export function createComponentFromSelection() {
  const ids = selectedTop();
  if (!ids.length) return store.toast('Selecione ao menos um item');
  commit((doc) => {
    if (ids.length === 1) {
      const n = doc.nodes[ids[0]];
      if (n.type === 'COMPONENT') return;
      if (n.type === 'FRAME' || n.type === 'GROUP') {
        n.type = 'COMPONENT';
        n.name = n.name || nextName(doc, 'COMPONENT');
        S().selection = [n.id];
        return;
      }
    }

    const top = ids[ids.length - 1];
    const parentId = doc.nodes[top].parentId;
    const pInv = invert(doc.nodes[parentId] ? worldMatrix(doc, parentId) : IDENTITY);
    const r = rectFromPoints(ids.flatMap((id) => worldCorners(doc, id).map((p) => applyMat(pInv, p))));
    const comp = createNode('COMPONENT', {
      name: nextName(doc, 'COMPONENT'),
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    });
    insertNode(doc, comp, parentId, childrenOf(doc, parentId).indexOf(top) + 1);
    for (const id of ids) moveToParent(doc, id, comp.id, null);
    normalizeGroupChain(doc, parentId);
    S().ui.expanded[comp.id] = true;
    S().selection = [comp.id];
  });
  store.toast('Componente principal criado');
}

export function createInstance(componentId: string) {
  const doc = D();
  const comp = doc.nodes[componentId];
  if (!comp || comp.type !== 'COMPONENT') return;

  const center = store.viewportCenterWorld();
  const pageId = S().pageId;
  const instance = createNode('INSTANCE', {
    name: comp.name,
    componentId: comp.id,
    x: Math.round(center.x - comp.width / 2),
    y: Math.round(center.y - comp.height / 2),
    width: comp.width,
    height: comp.height,
    fills: structuredClone(comp.fills),
    strokes: structuredClone(comp.strokes),
    strokeWeight: comp.strokeWeight,
    cornerRadius: comp.cornerRadius,
  });

  commit((d) => {
    insertNode(d, instance, pageId);
    S().selection = [instance.id];
  });
  store.toast(`Instância de "${comp.name}" criada`);
}

export function detachInstance(instanceId?: string) {
  const doc = D();
  const id = instanceId ?? selectedTop().find((nid) => doc.nodes[nid]?.type === 'INSTANCE');
  if (!id) return;
  const inst = doc.nodes[id];
  if (!inst || inst.type !== 'INSTANCE' || !inst.componentId) return;
  const master = doc.nodes[inst.componentId];

  commit((d) => {
    inst.type = 'FRAME';
    if (master?.children) {
      inst.children = [];
      for (const cid of master.children) {
        if (!d.nodes[cid]) continue;
        const sub = cloneNodeTree(d, cid);
        sub[0].parentId = inst.id;
        inst.children.push(sub[0].id);
        for (const n of sub) d.nodes[n.id] = n;
      }
    }
    delete inst.componentId;
  });
  store.toast('Instância separada');
}

export function resetInstanceOverrides(instanceId?: string) {
  const doc = D();
  const id = instanceId ?? selectedTop().find((nid) => doc.nodes[nid]?.type === 'INSTANCE');
  if (!id) return;
  const inst = doc.nodes[id];
  if (!inst || inst.type !== 'INSTANCE' || !inst.componentId) return;
  const master = doc.nodes[inst.componentId];
  if (!master) return;

  commit(() => {
    inst.width = master.width;
    inst.height = master.height;
    inst.fills = structuredClone(master.fills);
    inst.strokes = structuredClone(master.strokes);
    inst.strokeWeight = master.strokeWeight;
    inst.cornerRadius = master.cornerRadius;
    inst.opacity = master.opacity;
  });
  store.toast('Alterações da instância redefinidas');
}

export function goToComponent(componentId: string) {
  const doc = D();
  const comp = doc.nodes[componentId];
  if (!comp) return store.toast('Componente principal não encontrado');
  const pid = pageIdOf(doc, comp.id);
  if (pid !== S().pageId) store.setPage(pid);
  store.setSelection([comp.id]);
  const b = worldBounds(doc, comp.id);
  if (b) store.zoomToRect(b);
}

// ---------- ordem ----------

export type ReorderKind = 'front' | 'back' | 'forward' | 'backward';

export function reorderSelection(kind: ReorderKind) {
  const ids = selectedTop();
  if (!ids.length) return;
  commit((doc) => {
    const byParent = new Map<string, Set<string>>();
    for (const id of ids) {
      const p = doc.nodes[id].parentId;
      if (!byParent.has(p)) byParent.set(p, new Set());
      byParent.get(p)!.add(id);
    }
    for (const [pid, set] of byParent) {
      const list = childrenOf(doc, pid);
      const moved = list.filter((x) => set.has(x));
      const rest = list.filter((x) => !set.has(x));
      if (kind === 'front') list.splice(0, list.length, ...rest, ...moved);
      else if (kind === 'back') list.splice(0, list.length, ...moved, ...rest);
      else if (kind === 'forward') {
        for (let i = list.length - 2; i >= 0; i--)
          if (set.has(list[i]) && !set.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
      } else {
        for (let i = 1; i < list.length; i++)
          if (set.has(list[i]) && !set.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
      }
    }
  });
}

// ---------- espelhar e girar ----------

/** Entre as duas representações equivalentes de giro+espelho, usa a de menor ângulo. */
function canonicalizeFlip(n: SceneNode) {
  if (Math.abs(n.rotation) > 90 + 1e-9) {
    n.rotation = normalizeRotation(n.rotation + 180);
    n.flipX = !n.flipX;
    n.flipY = !n.flipY;
  }
}

export function flipSelection(axis: 'x' | 'y') {
  const ids = selectedTop().filter(unlocked);
  if (!ids.length) return;
  commit((doc) => {
    const b = boundsOf(doc, ids)!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const R = multiply(
      multiply(translation(cx, cy), axis === 'x' ? scaling(-1, 1) : scaling(1, -1)),
      translation(-cx, -cy),
    );
    for (const id of ids) {
      const n = doc.nodes[id];
      applyLocalMatrix(n, multiply(invert(parentWorldMatrix(doc, id)), multiply(R, worldMatrix(doc, id))));
      canonicalizeFlip(n);
    }
    for (const id of ids) normalizeGroupChain(doc, doc.nodes[id].parentId);
  });
}

/** Gira a seleção em torno do centro dela (graus, anti-horário). */
export function rotateSelection(deg: number) {
  const ids = selectedTop().filter(unlocked);
  if (!ids.length) return;
  commit((doc) => {
    const b = boundsOf(doc, ids)!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const rad = (-deg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const R = multiply(multiply(translation(cx, cy), [c, s, -s, c, 0, 0]), translation(-cx, -cy));
    for (const id of ids) {
      const n = doc.nodes[id];
      applyLocalMatrix(n, multiply(invert(parentWorldMatrix(doc, id)), multiply(R, worldMatrix(doc, id))));
      canonicalizeFlip(n);
    }
    for (const id of ids) normalizeGroupChain(doc, doc.nodes[id].parentId);
  });
}

// ---------- visibilidade e trava ----------

export function toggleVisible(ids = selectedTop()) {
  const doc = D();
  ids = ids.filter((id) => doc.nodes[id]);
  if (!ids.length) return;
  const show = !ids.some((id) => doc.nodes[id].visible);
  commit((doc) => ids.forEach((id) => (doc.nodes[id].visible = show)));
}

export function toggleLocked(ids = selectedTop()) {
  const doc = D();
  ids = ids.filter((id) => doc.nodes[id]);
  if (!ids.length) return;
  const lock = !ids.some((id) => doc.nodes[id].locked);
  commit((doc) => ids.forEach((id) => (doc.nodes[id].locked = lock)));
}

// ---------- alinhar e distribuir ----------

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function alignSelection(kind: AlignKind) {
  const doc = D();
  const ids = selectedTop().filter(unlocked);
  if (!ids.length) return;
  let target: Rect;
  if (ids.length === 1) {
    // um só objeto: alinha em relação ao frame que o contém
    const frame = ancestors(doc, ids[0]).find((a) => a.type === 'FRAME');
    if (!frame) return;
    target = worldBounds(doc, frame.id);
  } else target = boundsOf(doc, ids)!;
  commit((doc) => {
    for (const id of ids) {
      const b = worldBounds(doc, id);
      let dx = 0;
      let dy = 0;
      if (kind === 'left') dx = target.x - b.x;
      else if (kind === 'right') dx = target.x + target.width - (b.x + b.width);
      else if (kind === 'hcenter') dx = target.x + target.width / 2 - (b.x + b.width / 2);
      else if (kind === 'top') dy = target.y - b.y;
      else if (kind === 'bottom') dy = target.y + target.height - (b.y + b.height);
      else dy = target.y + target.height / 2 - (b.y + b.height / 2);
      moveWorld(doc, id, dx, dy);
    }
    for (const id of ids) normalizeGroupChain(doc, doc.nodes[id].parentId);
  });
}

export function distributeSelection(axis: 'x' | 'y') {
  const ids = selectedTop().filter(unlocked);
  if (ids.length < 3) return;
  commit((doc) => {
    const items = ids.map((id) => ({ id, b: worldBounds(doc, id) }));
    const pos = (r: Rect) => (axis === 'x' ? r.x : r.y);
    const size = (r: Rect) => (axis === 'x' ? r.width : r.height);
    items.sort((a, b) => pos(a.b) - pos(b.b));
    const first = items[0].b;
    const last = items[items.length - 1].b;
    const span = pos(last) + size(last) - pos(first);
    const gap = (span - items.reduce((s, it) => s + size(it.b), 0)) / (items.length - 1);
    let p = pos(first);
    for (const it of items) {
      const d = p - pos(it.b);
      moveWorld(doc, it.id, axis === 'x' ? d : 0, axis === 'y' ? d : 0);
      p += size(it.b) + gap;
    }
    for (const id of ids) normalizeGroupChain(doc, doc.nodes[id].parentId);
  });
}

// ---------- setas ----------

let lastNudge = { time: 0, key: '' };

export function nudgeSelection(dx: number, dy: number) {
  const ids = selectedTop().filter(unlocked);
  if (!ids.length) return;
  // toques seguidos nas setas viram um único passo de desfazer
  const key = ids.join(',');
  const now = Date.now();
  commit((doc) => {
    for (const id of ids) moveWorld(doc, id, dx, dy);
    for (const id of ids) normalizeGroupChain(doc, doc.nodes[id].parentId);
  }, now - lastNudge.time > 800 || lastNudge.key !== key);
  lastNudge = { time: now, key };
}

// ---------- navegação na seleção ----------

export function selectAll() {
  const doc = D();
  const sel = S().selection.filter((id) => doc.nodes[id]);
  const parentId = sel.length ? doc.nodes[sel[0]].parentId : S().pageId;
  store.setSelection(childrenOf(doc, parentId).filter((id) => doc.nodes[id] && !doc.nodes[id].locked));
}

export function selectChildren() {
  const doc = D();
  const sel = S().selection.filter((id) => doc.nodes[id]);
  if (sel.length === 1 && doc.nodes[sel[0]].type === 'TEXT') {
    store.startTextEditing(sel[0]);
    return;
  }
  const kids = sel.flatMap((id) => doc.nodes[id].children ?? []).filter((id) => doc.nodes[id]);
  if (kids.length) {
    for (const id of sel) S().ui.expanded[id] = true;
    store.setSelection(kids);
  }
}

export function selectParent() {
  const doc = D();
  const parents = new Set<string>();
  for (const id of S().selection) {
    const n = doc.nodes[id];
    if (n && doc.nodes[n.parentId]) parents.add(n.parentId);
  }
  if (parents.size) store.setSelection([...parents]);
}

/** Tab / Shift+Tab: próximo ou anterior irmão na lista de camadas. */
export function selectSibling(dir: 1 | -1) {
  const doc = D();
  const sel = S().selection.filter((id) => doc.nodes[id]);
  const list = sel.length ? childrenOf(doc, doc.nodes[sel[0]].parentId) : childrenOf(doc, S().pageId);
  if (!list.length) return;
  if (!sel.length) return store.setSelection([list[list.length - 1]]);
  const i = list.indexOf(sel[0]);
  // a lista de camadas mostra o topo primeiro, então "próximo" desce na ordem de pintura
  const j = (i - dir + list.length) % list.length;
  store.setSelection([list[j]]);
}

export function escapeSelection() {
  const doc = D();
  const sel = S().selection.filter((id) => doc.nodes[id]);
  if (!sel.length) return;
  if (sel.some((id) => doc.nodes[doc.nodes[id].parentId])) selectParent();
  else store.setSelection([]);
}

// ---------- propriedades ----------

/** Altera os nós indicados; `checkpoint=false` durante arrastes contínuos. */
export function editNodes(ids: string[], fn: (n: SceneNode, doc: DocumentData) => void, checkpoint = true) {
  const doc = D();
  const list = ids.filter((id) => doc.nodes[id]);
  if (!list.length) return;
  commit((doc) => {
    for (const id of list) {
      const n = doc.nodes[id];
      fn(n, doc);
      if (n.type === 'TEXT') fitTextBox(n);
    }
    for (const id of list) if (doc.nodes[id]) normalizeGroupChain(doc, doc.nodes[id].parentId);
  }, checkpoint);
}

export function setSelectionOpacity(v: number) {
  editNodes(selectedTop(), (n) => (n.opacity = v));
}

/** Frame mais próximo acima do nó (os grupos são "transparentes" no painel). */
function referenceFrame(doc: DocumentData, id: string): string | null {
  return ancestors(doc, id).find((a) => a.type === 'FRAME')?.id ?? null;
}

/** X/Y mostrados no painel: canto de origem relativo ao frame que contém o nó. */
export function getPanelXY(doc: DocumentData, id: string): Pt {
  const ref = referenceFrame(doc, id);
  const m = multiply(invert(ref ? worldMatrix(doc, ref) : IDENTITY), worldMatrix(doc, id));
  return applyMat(m, { x: 0, y: 0 });
}

export function setPanelXY(doc: DocumentData, id: string, x: number | null, y: number | null) {
  const cur = getPanelXY(doc, id);
  const ref = referenceFrame(doc, id);
  const d = { x: x === null ? 0 : x - cur.x, y: y === null ? 0 : y - cur.y };
  const toParent = multiply(invert(parentWorldMatrix(doc, id)), ref ? worldMatrix(doc, ref) : IDENTITY);
  const v = applyVec(toParent, d);
  const n = doc.nodes[id];
  n.x += v.x;
  n.y += v.y;
}

/** Muda largura/altura mantendo fixo o canto de origem (como o painel do Figma). */
export function setNodeSize(doc: DocumentData, n: SceneNode, w: number | null, h: number | null) {
  const origin = applyMat(localMatrix(n), { x: 0, y: 0 });
  let nw = w ?? n.width;
  let nh = h ?? n.height;
  if (n.constrainProportions && n.width > 0 && n.height > 0) {
    if (w !== null && h === null) nh = (nw / n.width) * n.height;
    else if (h !== null && w === null) nw = (nh / n.height) * n.width;
  }
  nw = Math.max(n.type === 'LINE' ? 0 : 0.01, nw);
  nh = n.type === 'LINE' ? 0 : Math.max(0.01, nh);
  if (n.type === 'GROUP') scaleChildren(doc, n, nw / Math.max(n.width, 1e-6), nh / Math.max(n.height, 1e-6));
  if (n.type === 'TEXT') {
    if (h !== null) n.textAutoResize = 'NONE';
    else if (n.textAutoResize === 'WIDTH_AND_HEIGHT') n.textAutoResize = 'HEIGHT';
  }
  n.width = nw;
  n.height = nh;
  const now = applyMat(localMatrix(n), { x: 0, y: 0 });
  n.x += origin.x - now.x;
  n.y += origin.y - now.y;
}

// ---------- copiar/colar propriedades ----------

type StyleProps = Pick<SceneNode, 'fills' | 'strokes' | 'strokeWeight' | 'strokeAlign' | 'effects' | 'opacity'> &
  Partial<SceneNode>;
let copiedStyle: StyleProps | null = null;

export function copyProperties() {
  const id = selectedTop()[0];
  const n = id ? D().nodes[id] : null;
  if (!n) return;
  copiedStyle = structuredClone({
    fills: n.fills,
    strokes: n.strokes,
    strokeWeight: n.strokeWeight,
    strokeAlign: n.strokeAlign,
    effects: n.effects,
    opacity: n.opacity,
    ...(n.type === 'RECTANGLE' || n.type === 'FRAME' ? { cornerRadius: n.cornerRadius } : {}),
    ...(n.type === 'TEXT'
      ? {
          fontFamily: n.fontFamily,
          fontSize: n.fontSize,
          fontWeight: n.fontWeight,
          lineHeight: n.lineHeight,
          letterSpacing: n.letterSpacing,
          textAlign: n.textAlign,
        }
      : {}),
  });
  store.toast('Propriedades copiadas');
}

export function pasteProperties() {
  if (!copiedStyle) return store.toast('Nenhuma propriedade copiada');
  const style = copiedStyle;
  editNodes(selectedTop(), (n) => {
    const s = structuredClone(style);
    if (n.type !== 'TEXT')
      for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign'] as const) delete s[k];
    if (n.type !== 'RECTANGLE' && n.type !== 'FRAME') delete s.cornerRadius;
    Object.assign(n, s);
  });
}

// ---------- texto ----------

export function textSelection(): string[] {
  const doc = D();
  const out: string[] = [];
  const visit = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    if (n.type === 'TEXT') out.push(id);
    n.children?.forEach(visit);
  };
  S().selection.forEach(visit);
  return out;
}

export function toggleBold() {
  const ids = textSelection();
  if (!ids.length) return;
  const bold = ids.every((id) => (D().nodes[id].fontWeight ?? 400) >= 700);
  editNodes(ids, (n) => (n.fontWeight = bold ? 400 : 700));
}

export function bumpFontSize(dir: 1 | -1) {
  editNodes(textSelection(), (n) => {
    const s = n.fontSize ?? 12;
    n.fontSize = Math.max(1, dir > 0 ? s + 1 : s - 1);
  });
}

export function setTextAlign(align: 'LEFT' | 'CENTER' | 'RIGHT') {
  editNodes(textSelection(), (n) => (n.textAlign = align));
}

/** Reajusta todas as caixas de texto (ex.: depois que uma fonte termina de carregar). */
export function refitAllText() {
  const doc = D();
  for (const n of Object.values(doc.nodes)) {
    if (n.type !== 'TEXT' || n.textAutoResize === 'NONE') continue;
    const w = n.width;
    const h = n.height;
    fitTextBox(n);
    if (w !== n.width || h !== n.height) normalizeGroupChain(doc, n.parentId);
  }
}

// ---------- vetor ----------

export function setPathClosed(closed: boolean) {
  const ids = selectedTop().filter((id) => D().nodes[id].type === 'VECTOR');
  editNodes(ids, (n) => (n.closed = closed));
}

// ---------- imagens ----------

export function addImageToDoc(doc: DocumentData, src: string): string {
  for (const [id, s] of Object.entries(doc.images)) if (s === src) return id;
  const id = uid();
  doc.images[id] = src;
  return id;
}

export const imagePaint = (imageId: string): ImagePaint => ({
  type: 'IMAGE',
  imageId,
  scaleMode: 'FILL',
  opacity: 1,
  visible: true,
});

/** Cria retângulos com preenchimento de imagem, centralizados no ponto. */
export async function insertImages(files: File[], at?: Pt): Promise<string[]> {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) return [];
  const loaded = await Promise.all(
    images.map(async (f) => {
      const src = await readFileAsDataURL(f);
      const size = await imageSize(src);
      return { name: f.name.replace(/\.[^.]+$/, '') || 'Imagem', src, size };
    }),
  );
  const doc = D();
  const center = at ?? store.viewportCenterWorld();
  const parentId = deepestFrameAt(doc, S().pageId, center) ?? S().pageId;
  const local = applyMat(invert(doc.nodes[parentId] ? worldMatrix(doc, parentId) : IDENTITY), center);
  const sized = loaded.map((it) => {
    const k = Math.min(1, 1000 / Math.max(it.size.width, it.size.height));
    return { ...it, w: Math.round(it.size.width * k), h: Math.round(it.size.height * k) };
  });
  const gap = 20;
  const total = sized.reduce((s, it) => s + it.w, 0) + gap * (sized.length - 1);
  let x = Math.round(local.x - total / 2);
  const ids: string[] = [];
  store.checkpoint();
  for (const it of sized) {
    const imageId = addImageToDoc(doc, it.src);
    const n = createNode('RECTANGLE', {
      name: it.name,
      x,
      y: Math.round(local.y - it.h / 2),
      width: it.w,
      height: it.h,
      fills: [imagePaint(imageId)],
    });
    insertNode(doc, n, parentId);
    ids.push(n.id);
    x += it.w + gap;
  }
  S().selection = ids;
  S().tool = 'MOVE';
  store.emit();
  return ids;
}

export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

export async function placeImage() {
  const files = await pickFiles('image/*', true);
  if (files.length) await insertImages(files);
}

// ---------- frames prontos ----------

export interface FramePreset {
  name: string;
  w: number;
  h: number;
}

export const FRAME_PRESETS: { group: string; items: FramePreset[] }[] = [
  {
    group: 'Celular',
    items: [
      { name: 'iPhone 16', w: 393, h: 852 },
      { name: 'iPhone 16 Pro', w: 402, h: 874 },
      { name: 'iPhone 16 Pro Max', w: 440, h: 956 },
      { name: 'iPhone 16 Plus', w: 430, h: 932 },
      { name: 'iPhone SE', w: 320, h: 568 },
      { name: 'Android Compacto', w: 412, h: 917 },
      { name: 'Android Médio', w: 700, h: 840 },
    ],
  },
  {
    group: 'Tablet',
    items: [
      { name: 'iPad mini 8.3', w: 744, h: 1133 },
      { name: 'iPad Pro 11"', w: 834, h: 1194 },
      { name: 'iPad Pro 12.9"', w: 1024, h: 1366 },
      { name: 'Surface Pro 8', w: 1440, h: 960 },
    ],
  },
  {
    group: 'Desktop',
    items: [
      { name: 'MacBook Air', w: 1280, h: 832 },
      { name: 'MacBook Pro 14"', w: 1512, h: 982 },
      { name: 'MacBook Pro 16"', w: 1728, h: 1117 },
      { name: 'Desktop', w: 1440, h: 1024 },
      { name: 'TV', w: 1280, h: 720 },
    ],
  },
  {
    group: 'Apresentação',
    items: [
      { name: 'Slide 16:9', w: 1920, h: 1080 },
      { name: 'Slide 4:3', w: 1024, h: 768 },
    ],
  },
  {
    group: 'Redes sociais',
    items: [
      { name: 'Post do Instagram', w: 1080, h: 1350 },
      { name: 'Story do Instagram', w: 1080, h: 1920 },
      { name: 'Post do Facebook', w: 1200, h: 630 },
      { name: 'Post do X', w: 1200, h: 675 },
    ],
  },
  {
    group: 'Papel',
    items: [
      { name: 'A4', w: 595, h: 842 },
      { name: 'Carta', w: 612, h: 792 },
    ],
  },
];

export function createFramePreset(p: FramePreset) {
  const doc = D();
  const center = store.viewportCenterWorld();
  let x = Math.round(center.x - p.w / 2);
  let y = Math.round(center.y - p.h / 2);
  const sel = S().selection.map((id) => doc.nodes[id]).filter(Boolean);
  if (sel.length === 1 && sel[0].type === 'FRAME' && isPage(doc, sel[0].parentId)) {
    x = Math.round(sel[0].x + sel[0].width + 100);
    y = Math.round(sel[0].y);
  }
  store.checkpoint();
  const n = createNode('FRAME', { name: p.name, x, y, width: p.w, height: p.h });
  insertNode(doc, n, S().pageId);
  S().selection = [n.id];
  S().tool = 'MOVE';
  store.emit();
  const v = store.viewportWorldRect();
  const b = worldBounds(doc, n.id);
  if (b.x < v.x || b.y < v.y || b.x + b.width > v.x + v.width || b.y + b.height > v.y + v.height) store.zoomToRect(b);
}

// ---------- páginas ----------

export function addPage() {
  const page = createPage(`Página ${D().pages.length + 1}`);
  commit((doc) => doc.pages.push(page));
  store.setPage(page.id);
  store.update((s) => (s.ui.renamingId = page.id));
}

export function renamePage(id: string, name: string) {
  const p = getPage(D(), id);
  if (!p || !name.trim() || p.name === name.trim()) return;
  commit(() => (p.name = name.trim()));
}

export function deletePage(id: string) {
  const doc = D();
  if (doc.pages.length <= 1) return store.toast('O arquivo precisa ter pelo menos uma página');
  const idx = doc.pages.findIndex((p) => p.id === id);
  if (idx < 0) return;
  commit((doc) => {
    for (const cid of [...doc.pages[idx].children]) deleteNode(doc, cid);
    doc.pages.splice(idx, 1);
  });
  if (S().pageId === id) store.setPage(doc.pages[Math.max(0, idx - 1)].id);
}

export function duplicatePage(id: string) {
  const doc = D();
  const src = getPage(doc, id);
  if (!src) return;
  const page = createPage(`${src.name} (cópia)`);
  page.background = src.background;
  commit((doc) => {
    doc.pages.splice(doc.pages.indexOf(src) + 1, 0, page);
    for (const cid of src.children) {
      if (!doc.nodes[cid]) continue;
      const tree = cloneNodeTree(doc, cid);
      for (const n of tree.slice(1)) doc.nodes[n.id] = n;
      insertNode(doc, tree[0], page.id);
    }
  });
  store.setPage(page.id);
}

export function goToPage(dir: 1 | -1) {
  const doc = D();
  const i = doc.pages.findIndex((p) => p.id === S().pageId);
  const j = i + dir;
  if (j >= 0 && j < doc.pages.length) store.setPage(doc.pages[j].id);
}

export function renameNode(id: string, name: string) {
  const n = D().nodes[id];
  if (!n || !name.trim() || n.name === name.trim()) return;
  commit(() => {
    n.name = name.trim();
    n.autoName = false;
  });
}

// ---------- câmera ----------

export function zoomToFit() {
  store.zoomToRect(boundsOf(D(), store.page.children));
}

export function zoomToSelection() {
  const r = boundsOf(D(), S().selection);
  if (r) store.zoomToRect(r);
  else zoomToFit();
}
