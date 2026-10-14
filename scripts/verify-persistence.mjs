import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Run with: node scripts/verify-persistence.mjs
// Execute the actual TypeScript modules in memory, without a browser or build.
const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = path.join(root, 'src');
const filename = (relative) => path.join(sourceRoot, relative);
const notifications = [];
const downloads = [];
const subscribers = new Set();
const browserStore = {
  state: { doc: null },
  load(doc) { this.state.doc = doc; },
  toast(message) { notifications.push(message); },
  subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
};
const browserWindow = {
  timers: new Map(),
  listeners: new Map(),
  nextTimer: 1,
  timerCalls: 0,
  clearCalls: 0,
  setTimeout(callback, delay) {
    const id = this.nextTimer++;
    this.timerCalls += 1;
    this.timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id) { this.clearCalls += 1; this.timers.delete(id); },
  addEventListener(event, callback) { this.listeners.set(event, callback); },
  removeEventListener(event, callback) {
    if (this.listeners.get(event) === callback) this.listeners.delete(event);
  },
};

// Model transaction completion separately from request creation, as IndexedDB does.
// Held writes make overlap/order bugs observable without timing-dependent sleeps.
const database = {
  value: undefined,
  writes: [],
  pending: [],
  held: false,
  failures: 0,
  activeWrites: 0,
  maximumActiveWrites: 0,
  reset() {
    assert.equal(this.activeWrites, 0, 'No previous write remains active');
    this.value = undefined;
    this.writes = [];
    this.pending = [];
    this.held = false;
    this.failures = 0;
    this.maximumActiveWrites = 0;
  },
  completeNext() {
    const complete = this.pending.shift();
    assert.ok(complete, 'A write is pending');
    complete();
  },
  open() {
    const request = {};
    request.result = {
      close() {},
      transaction(_storeName, mode) {
        const transaction = {
          objectStore: () => ({
            put(value, key) {
              assert.equal(mode, 'readwrite');
              assert.equal(key, 'current');
              const captured = structuredClone(value);
              database.writes.push(captured);
              database.activeWrites += 1;
              database.maximumActiveWrites = Math.max(database.maximumActiveWrites, database.activeWrites);
              const writeRequest = { result: key };
              const complete = () => {
                database.activeWrites -= 1;
                if (database.failures > 0) {
                  database.failures -= 1;
                  transaction.error = new Error('Simulated IndexedDB failure');
                  transaction.onerror();
                } else {
                  database.value = captured;
                  transaction.oncomplete();
                }
              };
              if (database.held) database.pending.push(complete);
              else queueMicrotask(complete);
              return writeRequest;
            },
            get(key) {
              assert.equal(mode, 'readonly');
              assert.equal(key, 'current');
              const readRequest = { result: structuredClone(database.value) };
              queueMicrotask(() => transaction.oncomplete());
              return readRequest;
            },
          }),
        };
        return transaction;
      },
    };
    queueMicrotask(() => request.onsuccess());
    return request;
  },
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const mocks = new Map([
  [filename('actions.ts'), { pickFiles: async () => [] }],
  [filename('store/store.ts'), { store: browserStore }],
  [filename('io/export.ts'), {
    downloadBlob: (blob, name) => downloads.push({ blob, name }),
    safeFileName: (name) => name,
  }],
]);
const modules = new Map();

function loadSource(modulePath) {
  if (mocks.has(modulePath)) return mocks.get(modulePath);
  if (modules.has(modulePath)) return modules.get(modulePath).exports;
  assert.ok(modulePath.startsWith(`${sourceRoot}${path.sep}`), 'Module stays within src');
  const source = fs.readFileSync(modulePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: modulePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const module = { exports: {} };
  modules.set(modulePath, module);
  const requireSource = (specifier) => {
    assert.ok(specifier.startsWith('.'), `Unexpected runtime dependency: ${specifier}`);
    const resolved = path.resolve(path.dirname(modulePath), specifier);
    return loadSource(path.extname(resolved) ? resolved : `${resolved}.ts`);
  };
  const run = new Function('exports', 'require', 'module', '__filename', '__dirname', 'indexedDB', 'window', outputText);
  run(module.exports, requireSource, module, modulePath, path.dirname(modulePath), database, browserWindow);
  return module.exports;
}

const { normalizeDocument, saveLocalCopy, openDocumentFile, saveNow, saveToBrowser, loadSaved, startAutosave } = loadSource(filename('io/persist.ts'));
const { createNode, TYPE_LABELS } = loadSource(filename('model/defaults.ts'));
const typesSource = ts.createSourceFile('types.ts', fs.readFileSync(filename('model/types.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const nodeTypeDeclaration = typesSource.statements.find((statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'NodeType');
assert.ok(nodeTypeDeclaration && ts.isUnionTypeNode(nodeTypeDeclaration.type), 'NodeType is a union');
const sceneTypes = nodeTypeDeclaration.type.types.map((type) => {
  assert.ok(ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal), 'NodeType member is a string');
  return type.literal.text;
});
assert.deepEqual([...sceneTypes].sort(), Object.keys(TYPE_LABELS).sort(), 'Fixtures cover the current NodeType union');

const jsonCopy = (value) => JSON.parse(JSON.stringify(value));
const documentWith = (nodes, children = Object.keys(nodes)) => ({
  version: 1,
  name: 'Persistence regression',
  pages: [{ id: 'page', name: 'Página 1', children, background: '#EDEDED' }],
  nodes,
  images: {},
});
const node = (type, id, extra = {}) => createNode(type, {
  id, parentId: 'page', name: `${type} fixture`, x: 12, y: -8,
  width: 180, height: 96, rotation: 15, opacity: 0.75, ...extra,
});

function assertHierarchy(doc) {
  const seen = new Set();
  const visit = (ids, parentId) => {
    for (const id of ids) {
      assert.ok(doc.nodes[id], `Referenced node ${id} exists`);
      assert.ok(!seen.has(id), `Node ${id} belongs to one parent and has no cycle`);
      seen.add(id);
      assert.equal(doc.nodes[id].parentId, parentId, `Parent of ${id} is rebuilt`);
      if (doc.nodes[id].children) visit(doc.nodes[id].children, id);
    }
  };
  for (const page of doc.pages) visit(page.children, page.id);
  assert.deepEqual([...seen].sort(), Object.keys(doc.nodes).sort(), 'No orphan nodes survive');
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('all current scene types survive JSON normalization with their properties', () => {
  const nodes = Object.fromEntries(sceneTypes.map((type) => {
    const id = type.toLowerCase();
    const extras = {
      INSTANCE: { componentId: 'component' },
      BOOLEAN_OPERATION: { booleanOperation: 'EXCLUDE' },
      TEXT: { text: 'Olá, Figma!\nSegunda linha', fontFamily: 'Inter', fontSize: 24 },
      VECTOR: {
        points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: true,
        vectorPath: [{ type: 'M', x: 0, y: 0 }, { type: 'A', rx: 0.5, ry: 0.5, largeArc: false, sweep: true, x: 1, y: 1 }],
        vectorStrokeCap: 'round', vectorStrokeJoin: 'bevel',
      },
      STAR: { pointCount: 7, innerRadius: 0.45 },
      POLYGON: { pointCount: 6 },
      LINE: { height: 0, arrowEnd: true },
    }[type] ?? {};
    return [id, node(type, id, extras)];
  }));
  const raw = jsonCopy(documentWith(nodes));
  const normalized = normalizeDocument(raw);
  assert.deepEqual(normalized, raw);
  assertHierarchy(normalized);
  assert.deepEqual(normalizeDocument(jsonCopy(normalized)), normalized, 'Normalization is idempotent');
});

test('nested components, instances and every boolean operation retain their subtrees', () => {
  const nodes = {
    frame: node('FRAME', 'frame', { children: ['group', 'instance', 'boolean-union'], layoutMode: 'VERTICAL', itemSpacing: 16 }),
    group: node('GROUP', 'group', { parentId: 'frame', children: ['master'] }),
    master: node('COMPONENT', 'master', { parentId: 'group', children: ['master-text', 'nested-master'] }),
    'master-text': node('TEXT', 'master-text', { parentId: 'master', text: 'Original' }),
    'nested-master': node('COMPONENT', 'nested-master', { parentId: 'master', children: ['master-star'] }),
    'master-star': node('STAR', 'master-star', { parentId: 'nested-master' }),
    instance: node('INSTANCE', 'instance', { parentId: 'frame', componentId: 'master', children: ['instance-text', 'nested-instance'] }),
    'instance-text': node('TEXT', 'instance-text', { parentId: 'instance', text: 'Override' }),
    'nested-instance': node('INSTANCE', 'nested-instance', { parentId: 'instance', componentId: 'nested-master', children: ['instance-star'] }),
    'instance-star': node('STAR', 'instance-star', { parentId: 'nested-instance', fills: [{ type: 'SOLID', color: '#FF7700', opacity: 1, visible: true }] }),
  };
  for (const [index, operation] of ['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE'].entries()) {
    const id = `boolean-${operation.toLowerCase()}`;
    const childId = index === 3 ? 'boolean-rectangle' : `boolean-${['SUBTRACT', 'INTERSECT', 'EXCLUDE'][index].toLowerCase()}`;
    nodes[id] = node('BOOLEAN_OPERATION', id, {
      parentId: index === 0 ? 'frame' : `boolean-${['UNION', 'SUBTRACT', 'INTERSECT'][index - 1].toLowerCase()}`,
      booleanOperation: operation, children: [childId, `${id}-ellipse`],
    });
    nodes[`${id}-ellipse`] = node('ELLIPSE', `${id}-ellipse`, { parentId: id });
  }
  nodes['boolean-rectangle'] = node('RECTANGLE', 'boolean-rectangle', { parentId: 'boolean-exclude' });
  const raw = jsonCopy(documentWith(nodes, ['frame']));
  const normalized = normalizeDocument(raw);
  assert.deepEqual(normalized, raw);
  assert.equal(normalized.nodes.instance.componentId, 'master');
  assert.equal(normalized.nodes['nested-instance'].componentId, 'nested-master');
  assertHierarchy(normalized);
});

test('broken references, duplicates, cycles, stale parents and orphans are normalized', () => {
  const raw = documentWith({
    component: node('COMPONENT', 'component', { parentId: 'wrong', children: ['instance', 'missing', 'instance'] }),
    instance: node('INSTANCE', 'instance', { parentId: 'wrong', componentId: 'component', children: ['boolean', 'component'] }),
    boolean: node('BOOLEAN_OPERATION', 'boolean', { parentId: 'wrong', children: ['leaf', 'boolean'] }),
    leaf: node('RECTANGLE', 'leaf', { parentId: 'wrong' }),
    orphan: node('TEXT', 'orphan'),
    unsupported: { id: 'unsupported', type: 'UNKNOWN' },
    empty: null,
  }, ['component', 'missing', 'component', 'leaf', 'unsupported', 'empty']);
  raw.pages.push({ id: 'other-page', name: 'Página 2', children: ['leaf', 'instance'], background: null });
  const normalized = normalizeDocument(raw);
  assert.deepEqual(Object.keys(normalized.nodes).sort(), ['boolean', 'component', 'instance', 'leaf']);
  assert.deepEqual(normalized.pages[0].children, ['component']);
  assert.deepEqual(normalized.pages[1].children, []);
  assert.deepEqual(normalized.nodes.component.children, ['instance']);
  assert.deepEqual(normalized.nodes.instance.children, ['boolean']);
  assert.deepEqual(normalized.nodes.boolean.children, ['leaf']);
  assertHierarchy(normalized);
});

test('containers with omitted or null child lists receive empty lists', () => {
  for (const children of [undefined, null]) {
    const nodes = Object.fromEntries(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'BOOLEAN_OPERATION'].map((type) => [type, { type, children }]));
    const normalized = normalizeDocument(documentWith(nodes));
    for (const type of Object.keys(nodes)) assert.deepEqual(normalized.nodes[type].children, [], `${type} defaults children`);
    assertHierarchy(normalized);
  }
});

test('invalid numeric values and paint/effect collections receive safe defaults', () => {
  const normalized = normalizeDocument(documentWith({
    damaged: {
      type: 'RECTANGLE', id: 'untrusted-id', parentId: 'untrusted-parent',
      x: NaN, y: Infinity, width: '100', height: null, rotation: -Infinity,
      opacity: NaN, strokeWeight: Infinity, cornerRadius: 'bad',
      fills: null, strokes: {}, effects: 'bad',
    },
  }));
  const damaged = normalized.nodes.damaged;
  assert.equal(damaged.id, 'damaged', 'Dictionary key is the canonical id');
  assert.equal(damaged.opacity, 1);
  for (const key of ['x', 'y', 'width', 'height', 'rotation', 'strokeWeight', 'cornerRadius']) assert.equal(damaged[key], 0, key);
  for (const key of ['fills', 'strokes', 'effects']) assert.deepEqual(damaged[key], [], key);
  assertHierarchy(normalized);
});

test('missing image fills and strokes become invisible without losing image references', () => {
  const paint = (imageId) => ({ type: 'IMAGE', imageId, scaleMode: 'FILL', opacity: 0.8, visible: true });
  const raw = documentWith({ image: node('RECTANGLE', 'image', { fills: [paint('present'), paint('missing')], strokes: [paint('missing-stroke')] }) });
  raw.images.present = 'data:image/png;base64,aW1hZ2U=';
  const normalized = normalizeDocument(raw);
  assert.equal(normalized.nodes.image.fills[0].visible, true);
  assert.equal(normalized.nodes.image.fills[1].visible, false);
  assert.equal(normalized.nodes.image.strokes[0].visible, false);
  assert.equal(normalized.nodes.image.fills[1].imageId, 'missing');
  assert.deepEqual(normalized.images, raw.images);
});

test('local file save/open round-trip preserves all types and compacts unused images', async () => {
  const nodes = Object.fromEntries(sceneTypes.map((type) => [type, node(type, type)]));
  nodes.RECTANGLE.fills = [{ type: 'IMAGE', imageId: 'used', scaleMode: 'FIT', opacity: 1, visible: true }];
  nodes.INSTANCE.componentId = 'COMPONENT';
  const source = documentWith(nodes);
  source.images = { used: 'data:image/png;base64,dXNlZA==', unused: 'data:image/png;base64,dW51c2Vk' };
  browserStore.state.doc = source;
  const before = jsonCopy(source);
  saveLocalCopy();
  const saved = downloads.at(-1);
  assert.equal(saved.name, 'Persistence regression.prancheta.json');
  assert.equal(saved.blob.type, 'application/json');
  const text = await saved.blob.text();
  const serialized = JSON.parse(text);
  assert.deepEqual(Object.keys(serialized.images), ['used']);
  assert.deepEqual(source, before, 'Saving does not mutate the active document');
  browserStore.state.doc = null;
  await openDocumentFile({ name: saved.name, text: async () => text });
  assert.deepEqual(browserStore.state.doc, { ...before, images: { used: source.images.used } });
  assertHierarchy(browserStore.state.doc);
  assert.equal(notifications.at(-1), 'Arquivo aberto: Persistence regression');
});

test('invalid documents are rejected and invalid file opening preserves the active document', async () => {
  for (const raw of [null, undefined, false, 'file', {}, { pages: [], nodes: null }, { pages: {}, nodes: {} }]) {
    assert.throws(() => normalizeDocument(raw), /Arquivo inválido/);
  }
  const before = browserStore.state.doc;
  await openDocumentFile({ name: 'invalid.json', text: async () => '{' });
  assert.equal(browserStore.state.doc, before);
  assert.equal(notifications.at(-1), 'Não foi possível abrir: arquivo inválido');
});

test('documents without usable pages receive one empty page', () => {
  const normalized = normalizeDocument({ pages: [null, { id: 12 }], nodes: { orphan: node('RECTANGLE', 'orphan') } });
  assert.equal(normalized.name, 'Sem título');
  assert.equal(normalized.pages.length, 1);
  assert.equal(typeof normalized.pages[0].id, 'string');
  assert.deepEqual(normalized.pages[0].children, []);
  assert.deepEqual(normalized.nodes, {});
});

test('concurrent browser saves serialize immutable snapshots and reload the newest document', async () => {
  database.reset();
  database.held = true;
  browserStore.state.doc = documentWith({ leaf: node('RECTANGLE', 'leaf', { x: 1 }) });
  const first = saveNow(true);
  browserStore.state.doc.nodes.leaf.x = 2;
  const second = saveNow();
  browserStore.state.doc.nodes.leaf.x = 3;
  const third = saveNow();
  browserStore.state.doc.nodes.leaf.x = 999;
  await settle();
  assert.equal(database.writes.length, 1, 'Only the first transaction starts');
  database.completeNext();
  await settle();
  assert.equal(database.writes.length, 2, 'The second starts after the first commits');
  database.completeNext();
  await settle();
  assert.equal(database.writes.length, 3, 'The third starts after the second commits');
  database.completeNext();
  assert.deepEqual(await Promise.all([first, second, third]), [true, true, true]);
  assert.equal(database.maximumActiveWrites, 1, 'Writes never overlap');
  assert.deepEqual(database.writes.map((doc) => doc.nodes.leaf.x), [1, 2, 3], 'Each request retains its call-time snapshot');
  const reloaded = await loadSaved();
  assert.equal(reloaded.nodes.leaf.x, 3, 'The final queued request wins');
  assertHierarchy(reloaded);
  database.held = false;
});

test('browser saving retries after failure and never announces a failed write as saved', async () => {
  database.reset();
  notifications.length = 0;
  browserStore.state.doc = documentWith({ retry: node('TEXT', 'retry', { text: 'Keep this edit' }) });
  database.failures = 1;
  await saveToBrowser();
  assert.deepEqual(notifications, ['Não foi possível salvar no navegador']);
  assert.equal(database.value, undefined);
  assert.equal(await saveNow(), true, 'A failed fingerprint can be retried');
  assert.equal(database.writes.length, 2);
  assert.equal(database.value.nodes.retry.text, 'Keep this edit');
  await saveToBrowser();
  assert.equal(notifications.at(-1), 'Salvo no navegador');
  assert.equal(database.writes.length, 3, 'Explicit save still forces a write');
});

test('unchanged queued documents are skipped and changing image data under the same key is saved', async () => {
  database.reset();
  browserStore.state.doc = documentWith({ image: node('RECTANGLE', 'image', {
    fills: [{ type: 'IMAGE', imageId: 'same-id', scaleMode: 'FILL', opacity: 1, visible: true }],
  }) });
  browserStore.state.doc.images['same-id'] = 'data:image/png;base64,Zmlyc3Q=';
  assert.deepEqual(await Promise.all([saveNow(), saveNow()]), [true, true]);
  assert.equal(database.writes.length, 1, 'Duplicate queue requests share the saved fingerprint');
  browserStore.state.doc.images['same-id'] = 'data:image/png;base64,c2Vjb25k';
  assert.equal(await saveNow(), true);
  assert.equal(database.writes.length, 2, 'Image contents are part of the fingerprint');
  assert.equal((await loadSaved()).images['same-id'], 'data:image/png;base64,c2Vjb25k');
});

test('hover-only notifications do not postpone autosave and cleanup removes listeners', async () => {
  database.reset();
  browserStore.state.doc = documentWith({ edited: node('RECTANGLE', 'edited', { x: 10 }) });
  const stop = startAutosave();
  const initialCalls = browserWindow.timerCalls;
  const initialClears = browserWindow.clearCalls;
  const emit = () => { for (const callback of subscribers) callback(); };
  emit();
  assert.equal(browserWindow.timerCalls, initialCalls, 'An unchanged document does not schedule saving');
  browserStore.state.doc.nodes.edited.x = 20;
  emit();
  assert.equal(browserWindow.timerCalls, initialCalls + 1);
  assert.equal(browserWindow.clearCalls, initialClears + 1);
  const [timerId, timer] = [...browserWindow.timers.entries()][0];
  assert.equal(timer.delay, 700);
  emit();
  emit();
  assert.equal(browserWindow.timerCalls, initialCalls + 1, 'Hover/selection notifications preserve the existing timer');
  assert.equal(browserWindow.clearCalls, initialClears + 1);
  browserWindow.timers.delete(timerId);
  timer.callback();
  await settle();
  assert.equal(database.writes.length, 1);
  assert.equal(database.value.nodes.edited.x, 20);
  assert.deepEqual([...browserWindow.listeners.keys()].sort(), ['beforeunload', 'pagehide']);
  stop();
  assert.equal(subscribers.size, 0);
  assert.equal(browserWindow.listeners.size, 0);
  assert.equal(browserWindow.timers.size, 0);
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} persistence checks passed (${sceneTypes.length} scene types).`);
if (failures) process.exitCode = 1;
