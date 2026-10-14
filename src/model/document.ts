import {
  IDENTITY,
  type Mat,
  type Pt,
  type Rect,
  applyMat,
  determinant,
  invert,
  multiply,
  rectFromPoints,
  rotationMat,
  scaling,
  toDeg,
  toRad,
  translation,
  unionRects,
} from '../canvas/geometry';
import { TYPE_LABELS, uid } from './defaults';
import type { DocumentData, NodeType, Page, SceneNode } from './types';

// ---------- consultas na árvore ----------

export const getPage = (doc: DocumentData, id: string): Page | undefined => doc.pages.find((p) => p.id === id);

export const isPage = (doc: DocumentData, id: string) => doc.pages.some((p) => p.id === id);

/** Lista de filhos (mutável) de uma página ou de um nó contêiner. */
export function childrenOf(doc: DocumentData, parentId: string): string[] {
  const page = getPage(doc, parentId);
  if (page) return page.children;
  const n = doc.nodes[parentId];
  if (n && !n.children) n.children = [];
  return n?.children ?? [];
}

export function parentNode(doc: DocumentData, id: string): SceneNode | null {
  const n = doc.nodes[id];
  if (!n) return null;
  return doc.nodes[n.parentId] ?? null;
}

export function pageIdOf(doc: DocumentData, id: string): string {
  let cur = doc.nodes[id];
  while (cur && doc.nodes[cur.parentId]) cur = doc.nodes[cur.parentId];
  return cur ? cur.parentId : id;
}

/** Ancestrais do nó, do pai imediato para cima (sem a página). */
export function ancestors(doc: DocumentData, id: string): SceneNode[] {
  const out: SceneNode[] = [];
  let p = parentNode(doc, id);
  while (p) {
    out.push(p);
    p = parentNode(doc, p.id);
  }
  return out;
}

export function isDescendant(doc: DocumentData, id: string, ancestorId: string): boolean {
  let p: string | undefined = doc.nodes[id]?.parentId;
  while (p) {
    if (p === ancestorId) return true;
    p = doc.nodes[p]?.parentId;
  }
  return false;
}

export function paintOrder(doc: DocumentData, pageId: string): string[] {
  const out: string[] = [];
  const visit = (ids: string[]) => {
    for (const id of ids) {
      out.push(id);
      const n = doc.nodes[id];
      if (n?.children) visit(n.children);
    }
  };
  visit(getPage(doc, pageId)?.children ?? []);
  return out;
}

export function sortByPaintOrder(doc: DocumentData, ids: string[]): string[] {
  if (ids.length < 2) return [...ids];
  const order = paintOrder(doc, pageIdOf(doc, ids[0]));
  const idx = new Map(order.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => (idx.get(a) ?? 0) - (idx.get(b) ?? 0));
}

/** Remove da lista os ids que já têm um ancestral na própria lista. */
export function topLevelIds(doc: DocumentData, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => doc.nodes[id] && !ancestors(doc, id).some((a) => set.has(a.id)));
}

export function nextName(doc: DocumentData, type: NodeType): string {
  if (type === 'TEXT') return TYPE_LABELS.TEXT;
  let count = 0;
  for (const n of Object.values(doc.nodes)) if (n.type === type) count++;
  return `${TYPE_LABELS[type]} ${count + 1}`;
}

// ---------- geometria ----------

export function localMatrix(n: SceneNode): Mat {
  return multiply(
    multiply(
      multiply(translation(n.x + n.width / 2, n.y + n.height / 2), rotationMat(-toRad(n.rotation))),
      scaling(n.flipX ? -1 : 1, n.flipY ? -1 : 1),
    ),
    translation(-n.width / 2, -n.height / 2),
  );
}

export function worldMatrix(doc: DocumentData, id: string): Mat {
  const n = doc.nodes[id];
  if (!n) return IDENTITY;
  const local = localMatrix(n);
  return doc.nodes[n.parentId] ? multiply(worldMatrix(doc, n.parentId), local) : local;
}

export function parentWorldMatrix(doc: DocumentData, id: string): Mat {
  const n = doc.nodes[id];
  return n && doc.nodes[n.parentId] ? worldMatrix(doc, n.parentId) : IDENTITY;
}

export const boxCorners = (w: number, h: number): Pt[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

export function worldCorners(doc: DocumentData, id: string): Pt[] {
  const n = doc.nodes[id];
  const m = worldMatrix(doc, id);
  return boxCorners(n.width, n.height).map((p) => applyMat(m, p));
}

export const worldBounds = (doc: DocumentData, id: string): Rect => rectFromPoints(worldCorners(doc, id));

export const worldCenter = (doc: DocumentData, id: string): Pt => {
  const n = doc.nodes[id];
  return applyMat(worldMatrix(doc, id), { x: n.width / 2, y: n.height / 2 });
};

export function boundsOf(doc: DocumentData, ids: string[]): Rect | null {
  return unionRects(ids.filter((id) => doc.nodes[id]).map((id) => worldBounds(doc, id)));
}

/** Caixa alinhada aos eixos do nó nas coordenadas do pai. */
export function parentBounds(n: SceneNode): Rect {
  const m = localMatrix(n);
  return rectFromPoints(boxCorners(n.width, n.height).map((p) => applyMat(m, p)));
}

export function normalizeRotation(deg: number): number {
  let r = deg % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return Math.abs(r) < 1e-9 ? 0 : r;
}

/**
 * Ajusta x/y/rotação/espelhamento do nó para que sua matriz local seja `m`
 * (mantendo largura/altura atuais). Supõe que `m` não tem cisalhamento.
 */
export function applyLocalMatrix(n: SceneNode, m: Mat) {
  let a = multiply(m, translation(n.width / 2, n.height / 2));
  a = multiply(a, scaling(n.flipX ? -1 : 1, n.flipY ? -1 : 1));
  if (determinant(a) < 0) {
    a = multiply(a, scaling(1, -1));
    n.flipY = !n.flipY;
  }
  const theta = Math.atan2(a[1], a[0]);
  n.rotation = normalizeRotation(-toDeg(theta));
  n.x = a[4] - n.width / 2;
  n.y = a[5] - n.height / 2;
}

/** Define uma linha pelos pontos inicial e final (coordenadas do pai). */
export function setLineEndpoints(n: SceneNode, a: Pt, b: Pt) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const theta = Math.atan2(b.y - a.y, b.x - a.x);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  n.width = len;
  n.height = 0;
  n.flipX = false;
  n.flipY = false;
  n.rotation = normalizeRotation(-toDeg(theta));
  n.x = cx - len / 2;
  n.y = cy;
}

// ---------- mutações ----------

export function insertNode(doc: DocumentData, node: SceneNode, parentId: string, index?: number) {
  node.parentId = parentId;
  doc.nodes[node.id] = node;
  const list = childrenOf(doc, parentId);
  if (index === undefined || index >= list.length) list.push(node.id);
  else list.splice(Math.max(0, index), 0, node.id);
}

export function detachNode(doc: DocumentData, id: string) {
  const n = doc.nodes[id];
  if (!n) return;
  const list = childrenOf(doc, n.parentId);
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
}

export function deleteNode(doc: DocumentData, id: string) {
  const n = doc.nodes[id];
  if (!n) return;
  const parentId = n.parentId;
  detachNode(doc, id);
  const remove = (nid: string) => {
    const x = doc.nodes[nid];
    if (!x) return;
    x.children?.forEach(remove);
    delete doc.nodes[nid];
  };
  remove(id);
  cleanupGroup(doc, parentId);
}

/** Grupos vazios são removidos; os demais têm a caixa recalculada. */
export function cleanupGroup(doc: DocumentData, groupId: string) {
  const g = doc.nodes[groupId];
  if (!g || g.type !== 'GROUP') return;
  if (!g.children?.length) deleteNode(doc, g.id);
  else normalizeGroupChain(doc, g.id);
}

/** Inclui referências a componentes para impedir ciclos que não aparecem na árvore de pais. */
function referencesNode(doc: DocumentData, startId: string, targetId: string): boolean {
  const pending = [startId];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = doc.nodes[id];
    if (!n) continue;
    pending.push(...(n.children ?? []));
    if (n.type === 'INSTANCE' && n.componentId) pending.push(n.componentId);
  }
  return false;
}

/**
 * Move o nó para outro pai mantendo a posição visual. `beforeId` indica o
 * irmão (na ordem de pintura) antes do qual inserir; null = no topo.
 */
export function moveToParent(doc: DocumentData, id: string, newParentId: string, beforeId: string | null = null) {
  const n = doc.nodes[id];
  if (!n || id === newParentId || isDescendant(doc, newParentId, id)) return;
  if (doc.nodes[newParentId] && referencesNode(doc, id, newParentId)) return;
  const world = worldMatrix(doc, id);
  const oldParent = n.parentId;
  detachNode(doc, id);
  const list = childrenOf(doc, newParentId);
  const idx = beforeId ? list.indexOf(beforeId) : -1;
  insertNode(doc, n, newParentId, idx >= 0 ? idx : undefined);
  const pw = doc.nodes[newParentId] ? worldMatrix(doc, newParentId) : IDENTITY;
  applyLocalMatrix(n, multiply(invert(pw), world));
  if (oldParent !== newParentId) cleanupGroup(doc, oldParent);
}

/** Recalcula a caixa de um grupo para envolver exatamente os filhos. */
export function normalizeGroup(doc: DocumentData, gid: string) {
  const g = doc.nodes[gid];
  if (!g || g.type !== 'GROUP' || !g.children?.length) return;
  const pts: Pt[] = [];
  for (const cid of g.children) {
    const c = doc.nodes[cid];
    if (!c) continue;
    const m = localMatrix(c);
    for (const p of boxCorners(c.width, c.height)) pts.push(applyMat(m, p));
  }
  if (!pts.length) return;
  const r = rectFromPoints(pts);
  const eps = 1e-6;
  if (Math.abs(r.x) < eps && Math.abs(r.y) < eps && Math.abs(r.width - g.width) < eps && Math.abs(r.height - g.height) < eps)
    return;
  const newMat = multiply(localMatrix(g), translation(r.x, r.y));
  for (const cid of g.children) {
    const c = doc.nodes[cid];
    if (!c) continue;
    c.x -= r.x;
    c.y -= r.y;
  }
  g.width = r.width;
  g.height = r.height;
  applyLocalMatrix(g, newMat);
}

/** Normaliza o nó (se for grupo) e todos os grupos ancestrais. */
export function normalizeGroupChain(doc: DocumentData, id: string) {
  let cur: SceneNode | undefined = doc.nodes[id];
  while (cur) {
    if (cur.type === 'GROUP') normalizeGroup(doc, cur.id);
    cur = doc.nodes[cur.parentId];
  }
}

/** Escala recursivamente os filhos de um grupo. */
export function scaleChildren(doc: DocumentData, g: SceneNode, sx: number, sy: number) {
  for (const cid of g.children ?? []) {
    const c = doc.nodes[cid];
    if (!c) continue;
    c.x *= sx;
    c.y *= sy;
    if (c.type === 'GROUP') scaleChildren(doc, c, sx, sy);
    c.width *= sx;
    c.height *= sy;
  }
}

export interface BoxSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function snapshotDescendants(doc: DocumentData, id: string, out = new Map<string, BoxSnapshot>()) {
  for (const cid of doc.nodes[id]?.children ?? []) {
    const c = doc.nodes[cid];
    if (!c) continue;
    out.set(cid, { x: c.x, y: c.y, width: c.width, height: c.height });
    snapshotDescendants(doc, cid, out);
  }
  return out;
}

export function restoreDescendants(doc: DocumentData, snap: Map<string, BoxSnapshot>) {
  for (const [id, b] of snap) {
    const c = doc.nodes[id];
    if (c) Object.assign(c, b);
  }
}

/** Clona a subárvore com ids novos. O primeiro item é a raiz. */
export function cloneNodeTree(doc: DocumentData, id: string): SceneNode[] {
  const src = doc.nodes[id];
  const copy: SceneNode = structuredClone(src);
  copy.id = uid();
  const out = [copy];
  if (src.children) {
    copy.children = [];
    for (const cid of src.children) {
      if (!doc.nodes[cid]) continue;
      const sub = cloneNodeTree(doc, cid);
      sub[0].parentId = copy.id;
      copy.children.push(sub[0].id);
      out.push(...sub);
    }
  }
  return out;
}

export function imageIdsOf(doc: DocumentData, ids: string[]): string[] {
  const out = new Set<string>();
  const visit = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE') out.add(p.imageId);
    n.children?.forEach(visit);
  };
  ids.forEach(visit);
  return [...out];
}

/** Recalcula posições e dimensões para nós com Auto Layout. */
export function applyAutoLayout(doc: DocumentData, frameId: string): void {
  const frame = doc.nodes[frameId];
  if (!frame || frame.type !== 'FRAME' || !frame.layoutMode || frame.layoutMode === 'NONE') return;

  const children = (frame.children ?? []).map((id) => doc.nodes[id]).filter(Boolean);
  if (!children.length) return;

  // Primeiro aplica recursivamente nos filhos que forem auto layout
  for (const child of children) {
    if (child.type === 'FRAME' && child.layoutMode && child.layoutMode !== 'NONE') {
      applyAutoLayout(doc, child.id);
    }
  }

  const isHoriz = frame.layoutMode === 'HORIZONTAL';
  const padT = frame.paddingTop ?? 0;
  const padR = frame.paddingRight ?? 0;
  const padB = frame.paddingBottom ?? 0;
  const padL = frame.paddingLeft ?? 0;
  const gap = frame.itemSpacing ?? 0;
  const alignPrimary = frame.primaryAxisAlignItems ?? 'MIN';
  const alignCounter = frame.counterAxisAlignItems ?? 'MIN';

  const visibleChildren = children.filter((c) => c.visible);
  if (!visibleChildren.length) return;

  if (isHoriz) {
    const totalChildWidth = visibleChildren.reduce((sum, c) => sum + c.width, 0);
    const totalGaps = gap * Math.max(0, visibleChildren.length - 1);
    const contentWidth = totalChildWidth + totalGaps;
    const maxChildHeight = Math.max(0, ...visibleChildren.map((c) => c.height));

    const innerWidth = Math.max(0, frame.width - padL - padR);
    const innerHeight = Math.max(0, frame.height - padT - padB);

    let currentX = padL;
    let actualGap = gap;

    if (alignPrimary === 'CENTER') {
      currentX = padL + Math.max(0, (innerWidth - contentWidth) / 2);
    } else if (alignPrimary === 'MAX') {
      currentX = padL + Math.max(0, innerWidth - contentWidth);
    } else if (alignPrimary === 'SPACE_BETWEEN' && visibleChildren.length > 1) {
      actualGap = Math.max(0, (innerWidth - totalChildWidth) / (visibleChildren.length - 1));
      currentX = padL;
    }

    for (const c of visibleChildren) {
      c.x = Math.round(currentX);
      if (alignCounter === 'CENTER') {
        c.y = Math.round(padT + (innerHeight - c.height) / 2);
      } else if (alignCounter === 'MAX') {
        c.y = Math.round(padT + innerHeight - c.height);
      } else {
        c.y = Math.round(padT);
      }
      currentX += c.width + actualGap;
    }
  } else {
    // VERTICAL
    const totalChildHeight = visibleChildren.reduce((sum, c) => sum + c.height, 0);
    const totalGaps = gap * Math.max(0, visibleChildren.length - 1);
    const contentHeight = totalChildHeight + totalGaps;
    const maxChildWidth = Math.max(0, ...visibleChildren.map((c) => c.width));

    const innerWidth = Math.max(0, frame.width - padL - padR);
    const innerHeight = Math.max(0, frame.height - padT - padB);

    let currentY = padT;
    let actualGap = gap;

    if (alignPrimary === 'CENTER') {
      currentY = padT + Math.max(0, (innerHeight - contentHeight) / 2);
    } else if (alignPrimary === 'MAX') {
      currentY = padT + Math.max(0, innerHeight - contentHeight);
    } else if (alignPrimary === 'SPACE_BETWEEN' && visibleChildren.length > 1) {
      actualGap = Math.max(0, (innerHeight - totalChildHeight) / (visibleChildren.length - 1));
      currentY = padT;
    }

    for (const c of visibleChildren) {
      c.y = Math.round(currentY);
      if (alignCounter === 'CENTER') {
        c.x = Math.round(padL + (innerWidth - c.width) / 2);
      } else if (alignCounter === 'MAX') {
        c.x = Math.round(padL + innerWidth - c.width);
      } else {
        c.x = Math.round(padL);
      }
      currentY += c.height + actualGap;
    }
  }
}

