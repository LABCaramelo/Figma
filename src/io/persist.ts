import { pickFiles } from '../actions';
import { TYPE_LABELS, createEmptyDocument, createNode, createPage } from '../model/defaults';
import { imageIdsOf } from '../model/document';
import type { DocumentData, NodeType, SceneNode } from '../model/types';
import { store } from '../store/store';
import { downloadBlob, safeFileName } from './export';

const DB_NAME = 'prancheta';
const STORE_NAME = 'docs';
const KEY = 'current';
const NODE_TYPES = Object.keys(TYPE_LABELS) as NodeType[];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const req = fn(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Valida e completa um documento vindo de fora (arquivo ou banco). Campos
 * ausentes recebem os valores padrão; referências quebradas são removidas.
 */
export function normalizeDocument(raw: unknown): DocumentData {
  const r = raw as Partial<DocumentData> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.pages) || typeof r.nodes !== 'object' || !r.nodes)
    throw new Error('Arquivo inválido');
  const doc: DocumentData = createEmptyDocument(typeof r.name === 'string' ? r.name : 'Sem título');
  doc.images = r.images && typeof r.images === 'object' ? { ...r.images } : {};
  const nodes: Record<string, SceneNode> = {};
  for (const [id, n] of Object.entries(r.nodes as Record<string, Partial<SceneNode>>)) {
    if (!n || !NODE_TYPES.includes(n.type as NodeType)) continue;
    const node = createNode(n.type as NodeType, { ...n, id });
    for (const k of ['fills', 'strokes', 'effects'] as const) if (!Array.isArray(node[k])) node[k] = [];
    for (const k of ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'strokeWeight', 'cornerRadius'] as const)
      if (typeof node[k] !== 'number' || !isFinite(node[k])) node[k] = k === 'opacity' ? 1 : 0;
    nodes[id] = node;
  }
  doc.nodes = nodes;
  doc.pages = r.pages
    .filter((p) => p && typeof p.id === 'string')
    .map((p) => ({ ...createPage(String(p.name ?? 'Página')), id: p.id, children: [...(p.children ?? [])], background: p.background ?? null }));
  if (!doc.pages.length) doc.pages = [createPage('Página 1')];
  // reconstrói a hierarquia a partir das listas de filhos
  const seen = new Set<string>();
  const adopt = (ids: string[], parentId: string): string[] =>
    ids.filter((id) => {
      const n = nodes[id];
      if (!n || seen.has(id)) return false;
      seen.add(id);
      n.parentId = parentId;
      if (n.children) n.children = adopt(n.children, id);
      else if (['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'BOOLEAN_OPERATION'].includes(n.type)) n.children = [];
      return true;
    });
  for (const p of doc.pages) p.children = adopt(p.children, p.id);
  for (const id of Object.keys(nodes)) if (!seen.has(id)) delete nodes[id];
  for (const n of Object.values(nodes))
    for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE' && !doc.images[p.imageId]) p.visible = false;
  return doc;
}

/** Cópia do documento só com as imagens realmente usadas. */
function compactDocument(doc: DocumentData): DocumentData {
  const used = new Set(imageIdsOf(doc, Object.keys(doc.nodes)));
  const images: Record<string, string> = {};
  for (const id of used) if (doc.images[id]) images[id] = doc.images[id];
  return { version: 1, name: doc.name, pages: doc.pages, nodes: doc.nodes, images };
}

export async function loadSaved(): Promise<DocumentData | null> {
  const raw = await idb<unknown>('readonly', (s) => s.get(KEY));
  if (!raw) return null;
  return compactDocument(normalizeDocument(raw));
}

let lastSaved = '';
let saving: Promise<boolean> = Promise.resolve(true);

const fingerprint = (doc: DocumentData) =>
  JSON.stringify({ n: doc.name, p: doc.pages, d: doc.nodes, i: doc.images });

export async function saveNow(force = false) {
  const snapshot = structuredClone(compactDocument(store.state.doc));
  const fp = fingerprint(snapshot);
  // Each request captures its own document and joins the queue immediately.
  // A later request must never be overwritten by an older pending write.
  const next = saving.then(async () => {
    if (!force && fp === lastSaved) return true;
    try {
      await idb('readwrite', (s) => s.put(snapshot, KEY));
      lastSaved = fp;
      return true;
    } catch {
      store.toast('Não foi possível salvar no navegador');
      return false;
    }
  });
  saving = next;
  return next;
}

/** Salva automaticamente um pouco depois de cada alteração. */
export function startAutosave(): () => void {
  let observed = fingerprint(store.state.doc);
  let timer: number | undefined;
  const unsub = store.subscribe(() => {
    const current = fingerprint(store.state.doc);
    if (current === observed) return;
    observed = current;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void saveNow(), 700);
  });
  const flush = () => void saveNow();
  window.addEventListener('beforeunload', flush);
  window.addEventListener('pagehide', flush);
  return () => {
    unsub();
    window.clearTimeout(timer);
    window.removeEventListener('beforeunload', flush);
    window.removeEventListener('pagehide', flush);
  };
}

// ---------- arquivos ----------

export async function saveToBrowser() {
  if (await saveNow(true)) store.toast('Salvo no navegador');
}

export function saveLocalCopy() {
  const doc = store.state.doc;
  const json = JSON.stringify(compactDocument(doc));
  downloadBlob(new Blob([json], { type: 'application/json' }), `${safeFileName(doc.name)}.prancheta.json`);
}

export async function openDocumentFile(file: File) {
  try {
    const doc = normalizeDocument(JSON.parse(await file.text()));
    if (doc.name === 'Sem título') doc.name = file.name.replace(/\.prancheta\.json$|\.json$/i, '') || doc.name;
    store.load(doc);
    store.toast(`Arquivo aberto: ${doc.name}`);
  } catch {
    store.toast('Não foi possível abrir: arquivo inválido');
  }
}

export async function openFileDialog() {
  const [file] = await pickFiles('.json,application/json', false);
  if (file) await openDocumentFile(file);
}

export function newFile() {
  const ok = window.confirm(
    'Criar um arquivo novo? O arquivo atual será substituído no navegador. Use “Salvar cópia local…” antes se quiser mantê-lo.',
  );
  if (!ok) return;
  store.load(createEmptyDocument());
}
