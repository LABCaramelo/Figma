import type { ReactNode } from 'react';
import * as A from './actions';
import { copySelection, copySelectionAsPng, isEditableTarget, pasteFromMenu } from './io/clipboard';
import { exportNodes, exportPrefs } from './io/export';
import { newFile, openFileDialog, saveLocalCopy, saveToBrowser } from './io/persist';
import type { Tool } from './model/types';
import { store } from './store/store';

export interface Command {
  id: string;
  label: string;
  /** Atalhos no formato canônico: Ctrl, Alt, Shift e a tecla, nessa ordem. */
  keys?: string[];
  run: () => void;
  enabled?: () => boolean;
  checked?: () => boolean;
}

export interface MenuItemEntry {
  kind: 'item';
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  icon?: ReactNode;
  run: () => void;
}

export type MenuEntry =
  | MenuItemEntry
  | { kind: 'submenu'; label: string; items: MenuEntry[]; disabled?: boolean }
  | { kind: 'separator' };

const st = () => store.state;
const hasSel = () => st().selection.some((id) => st().doc.nodes[id]);
const selNodes = () => st().selection.map((id) => st().doc.nodes[id]).filter(Boolean);
const hasType = (...types: string[]) => () => selNodes().some((n) => types.includes(n.type));
const hasText = () => A.textSelection().length > 0;

const tool = (id: string, label: string, t: Tool, keys: string[]): Command => ({
  id,
  label,
  keys,
  run: () => store.setTool(t),
  checked: () => st().tool === t,
});

const list: Command[] = [
  // ferramentas
  tool('tool.move', 'Mover', 'MOVE', ['V']),
  tool('tool.hand', 'Mão', 'HAND', ['H']),
  tool('tool.frame', 'Frame', 'FRAME', ['F', 'A']),
  tool('tool.rectangle', 'Retângulo', 'RECTANGLE', ['R']),
  tool('tool.ellipse', 'Elipse', 'ELLIPSE', ['O']),
  tool('tool.line', 'Linha', 'LINE', ['L']),
  tool('tool.arrow', 'Seta', 'ARROW', ['Shift+L']),
  tool('tool.polygon', 'Polígono', 'POLYGON', []),
  tool('tool.star', 'Estrela', 'STAR', []),
  tool('tool.text', 'Texto', 'TEXT', ['T']),
  tool('tool.pencil', 'Lápis', 'PENCIL', ['Shift+P', 'P']),
  { id: 'tool.image', label: 'Inserir imagem…', keys: ['Ctrl+Shift+K'], run: () => void A.placeImage() },

  // arquivo
  { id: 'file.new', label: 'Novo arquivo', keys: ['Ctrl+Alt+N'], run: newFile },
  { id: 'file.open', label: 'Abrir arquivo…', keys: ['Ctrl+O'], run: () => void openFileDialog() },
  { id: 'file.save', label: 'Salvar no navegador', keys: ['Ctrl+S'], run: () => void saveToBrowser() },
  { id: 'file.saveCopy', label: 'Salvar cópia local…', keys: ['Ctrl+Shift+S'], run: saveLocalCopy },
  {
    id: 'file.export',
    label: 'Exportar seleção…',
    keys: ['Ctrl+Shift+E'],
    run: () => void exportNodes(st().selection, exportPrefs),
    enabled: hasSel,
  },
  {
    id: 'file.exportSvg',
    label: 'Exportar seleção como SVG',
    run: () => void exportNodes(st().selection, { format: 'SVG', scale: 1 }),
    enabled: hasSel,
  },

  // editar
  { id: 'edit.undo', label: 'Desfazer', keys: ['Ctrl+Z'], run: () => store.undo(), enabled: store.canUndo },
  { id: 'edit.redo', label: 'Refazer', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], run: () => store.redo(), enabled: store.canRedo },
  { id: 'edit.copy', label: 'Copiar', run: () => copySelection(false), enabled: hasSel },
  { id: 'edit.cut', label: 'Recortar', run: () => copySelection(true), enabled: hasSel },
  { id: 'edit.paste', label: 'Colar', run: () => void pasteFromMenu() },
  { id: 'edit.copyPng', label: 'Copiar como PNG', keys: ['Ctrl+Shift+C'], run: copySelectionAsPng, enabled: hasSel },
  { id: 'edit.duplicate', label: 'Duplicar', keys: ['Ctrl+D'], run: A.duplicateSelection, enabled: hasSel },
  { id: 'edit.delete', label: 'Excluir', keys: ['Delete', 'Backspace'], run: A.deleteSelection, enabled: hasSel },
  { id: 'edit.selectAll', label: 'Selecionar tudo', keys: ['Ctrl+A'], run: A.selectAll },
  { id: 'edit.selectNone', label: 'Limpar seleção', run: () => store.setSelection([]), enabled: hasSel },
  { id: 'edit.selectChildren', label: 'Selecionar filhos', keys: ['Enter'], run: A.selectChildren, enabled: hasSel },
  { id: 'edit.selectParent', label: 'Selecionar pai', keys: ['Shift+Enter', '\\'], run: A.selectParent, enabled: hasSel },
  { id: 'edit.nextSibling', label: 'Selecionar próxima camada', keys: ['Tab'], run: () => A.selectSibling(1) },
  { id: 'edit.prevSibling', label: 'Selecionar camada anterior', keys: ['Shift+Tab'], run: () => A.selectSibling(-1) },
  { id: 'edit.copyProps', label: 'Copiar propriedades', keys: ['Ctrl+Alt+C'], run: A.copyProperties, enabled: hasSel },
  { id: 'edit.pasteProps', label: 'Colar propriedades', keys: ['Ctrl+Alt+V'], run: A.pasteProperties, enabled: hasSel },

  // visualizar
  {
    id: 'view.toggleUI',
    label: 'Mostrar/ocultar interface',
    keys: ['Ctrl+\\'],
    run: () => store.update((s) => (s.ui.hidden = !s.ui.hidden)),
    checked: () => !st().ui.hidden,
  },
  { id: 'view.zoomIn', label: 'Ampliar', keys: ['Ctrl+=', '=', 'Shift+=', 'Ctrl+Shift+='], run: () => store.zoomBy(2) },
  { id: 'view.zoomOut', label: 'Reduzir', keys: ['Ctrl+-', '-'], run: () => store.zoomBy(0.5) },
  { id: 'view.zoom100', label: 'Zoom para 100%', keys: ['Shift+0', 'Ctrl+0'], run: () => store.zoomTo(1) },
  { id: 'view.zoomFit', label: 'Zoom para ajustar', keys: ['Shift+1'], run: A.zoomToFit },
  { id: 'view.zoomSelection', label: 'Zoom para a seleção', keys: ['Shift+2'], run: A.zoomToSelection, enabled: hasSel },
  { id: 'view.prevPage', label: 'Página anterior', keys: ['PageUp'], run: () => A.goToPage(-1) },
  { id: 'view.nextPage', label: 'Próxima página', keys: ['PageDown'], run: () => A.goToPage(1) },

  // objeto
  { id: 'object.group', label: 'Agrupar seleção', keys: ['Ctrl+G'], run: A.groupSelection, enabled: hasSel },
  { id: 'object.ungroup', label: 'Desagrupar', keys: ['Ctrl+Shift+G'], run: A.ungroupSelection, enabled: hasType('GROUP', 'FRAME') },
  { id: 'object.frame', label: 'Criar frame da seleção', keys: ['Ctrl+Alt+G'], run: A.frameSelection, enabled: hasSel },
  { id: 'object.autoLayout', label: 'Adicionar auto layout', keys: ['Shift+A'], run: A.autoLayoutSelection, enabled: hasSel },
  { id: 'object.front', label: 'Trazer para a frente', keys: [']'], run: () => A.reorderSelection('front'), enabled: hasSel },
  { id: 'object.forward', label: 'Trazer um nível para frente', keys: ['Ctrl+]'], run: () => A.reorderSelection('forward'), enabled: hasSel },
  { id: 'object.backward', label: 'Enviar um nível para trás', keys: ['Ctrl+['], run: () => A.reorderSelection('backward'), enabled: hasSel },
  { id: 'object.back', label: 'Enviar para trás', keys: ['['], run: () => A.reorderSelection('back'), enabled: hasSel },
  { id: 'object.flipH', label: 'Espelhar horizontalmente', keys: ['Shift+H'], run: () => A.flipSelection('x'), enabled: hasSel },
  { id: 'object.flipV', label: 'Espelhar verticalmente', keys: ['Shift+V'], run: () => A.flipSelection('y'), enabled: hasSel },
  { id: 'object.rotate90', label: 'Girar 90° à direita', run: () => A.rotateSelection(-90), enabled: hasSel },
  { id: 'object.toggleVisible', label: 'Mostrar/ocultar seleção', keys: ['Ctrl+Shift+H'], run: () => A.toggleVisible(), enabled: hasSel },
  { id: 'object.toggleLocked', label: 'Bloquear/desbloquear seleção', keys: ['Ctrl+Shift+L'], run: () => A.toggleLocked(), enabled: hasSel },
  {
    id: 'object.rename',
    label: 'Renomear',
    keys: ['Ctrl+R'],
    run: () => store.update((s) => (s.ui.renamingId = A.selectedTop()[0] ?? null)),
    enabled: hasSel,
  },
  { id: 'object.boolean.union', label: 'Unir seleção', keys: ['Ctrl+Alt+U'], run: () => A.createBooleanOperation('UNION'), enabled: () => selNodes().length >= 2 },
  { id: 'object.boolean.subtract', label: 'Subtrair seleção', run: () => A.createBooleanOperation('SUBTRACT'), enabled: () => selNodes().length >= 2 },
  { id: 'object.boolean.intersect', label: 'Interseção da seleção', run: () => A.createBooleanOperation('INTERSECT'), enabled: () => selNodes().length >= 2 },
  { id: 'object.boolean.exclude', label: 'Excluir seleção', run: () => A.createBooleanOperation('EXCLUDE'), enabled: () => selNodes().length >= 2 },
  { id: 'object.flatten', label: 'Achatar seleção', keys: ['Ctrl+E'], run: A.flattenSelection, enabled: hasSel },
  { id: 'component.create', label: 'Criar componente', keys: ['Ctrl+Alt+K'], run: A.createComponentFromSelection, enabled: hasSel },
  { id: 'component.detach', label: 'Separar instância', keys: ['Ctrl+Alt+B'], run: () => A.detachInstance(), enabled: () => selNodes().some((n) => n.type === 'INSTANCE') },
  { id: 'component.reset', label: 'Redefinir alterações da instância', run: () => A.resetInstanceOverrides(), enabled: () => selNodes().some((n) => n.type === 'INSTANCE') },

  // vetor
  { id: 'vector.close', label: 'Fechar caminho', run: () => A.setPathClosed(true), enabled: hasType('VECTOR') },
  { id: 'vector.open', label: 'Abrir caminho', run: () => A.setPathClosed(false), enabled: hasType('VECTOR') },

  // texto
  { id: 'text.bold', label: 'Negrito', keys: ['Ctrl+B'], run: A.toggleBold, enabled: hasText },
  { id: 'text.bigger', label: 'Aumentar tamanho da fonte', keys: ['Ctrl+Shift+.'], run: () => A.bumpFontSize(1), enabled: hasText },
  { id: 'text.smaller', label: 'Diminuir tamanho da fonte', keys: ['Ctrl+Shift+,'], run: () => A.bumpFontSize(-1), enabled: hasText },
  { id: 'text.left', label: 'Alinhar texto à esquerda', keys: ['Ctrl+Alt+L'], run: () => A.setTextAlign('LEFT'), enabled: hasText },
  { id: 'text.center', label: 'Centralizar texto', keys: ['Ctrl+Alt+T'], run: () => A.setTextAlign('CENTER'), enabled: hasText },
  { id: 'text.right', label: 'Alinhar texto à direita', keys: ['Ctrl+Alt+R'], run: () => A.setTextAlign('RIGHT'), enabled: hasText },

  // organizar
  { id: 'arrange.left', label: 'Alinhar à esquerda', keys: ['Alt+A'], run: () => A.alignSelection('left'), enabled: hasSel },
  { id: 'arrange.hcenter', label: 'Centralizar na horizontal', keys: ['Alt+H'], run: () => A.alignSelection('hcenter'), enabled: hasSel },
  { id: 'arrange.right', label: 'Alinhar à direita', keys: ['Alt+D'], run: () => A.alignSelection('right'), enabled: hasSel },
  { id: 'arrange.top', label: 'Alinhar ao topo', keys: ['Alt+W'], run: () => A.alignSelection('top'), enabled: hasSel },
  { id: 'arrange.vcenter', label: 'Centralizar na vertical', keys: ['Alt+V'], run: () => A.alignSelection('vcenter'), enabled: hasSel },
  { id: 'arrange.bottom', label: 'Alinhar à base', keys: ['Alt+S'], run: () => A.alignSelection('bottom'), enabled: hasSel },
  {
    id: 'arrange.distH',
    label: 'Distribuir espaçamento horizontal',
    keys: ['Alt+Shift+H'],
    run: () => A.distributeSelection('x'),
    enabled: () => A.selectedTop().length >= 3,
  },
  {
    id: 'arrange.distV',
    label: 'Distribuir espaçamento vertical',
    keys: ['Alt+Shift+V'],
    run: () => A.distributeSelection('y'),
    enabled: () => A.selectedTop().length >= 3,
  },

  // preferências e ajuda
  { id: 'prefs.light', label: 'Tema claro', run: () => store.setTheme('light'), checked: () => st().ui.theme === 'light' },
  { id: 'prefs.dark', label: 'Tema escuro', run: () => store.setTheme('dark'), checked: () => st().ui.theme === 'dark' },
  {
    id: 'help.shortcuts',
    label: 'Atalhos de teclado',
    keys: ['Ctrl+Shift+/'],
    run: () => store.update((s) => (s.ui.showShortcuts = !s.ui.showShortcuts)),
  },
  {
    id: 'help.actions',
    label: 'Ações rápidas…',
    keys: ['Ctrl+/', 'Ctrl+K'],
    run: () => store.update((s) => (s.ui.showQuickActions = !s.ui.showQuickActions)),
  },
  {
    id: 'help.about',
    label: 'Sobre a Prancheta',
    run: () => store.toast('Prancheta 0.1 — editor de design para estudo, escrito do zero'),
  },
];

export const commands: Record<string, Command> = Object.fromEntries(list.map((c) => [c.id, c]));

// ---------- atalhos ----------

const SHIFTED: Record<string, string> = { '{': '[', '}': ']', '+': '=', '?': '/', _: '-', '|': '\\', '<': ',', '>': '.', ':': ';' };

/** Converte o evento no formato canônico ("Ctrl+Shift+G"). Letras e números usam a posição física. */
export function eventKey(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return null;
  let k: string;
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) k = e.code.slice(5);
  else if (e.code === 'NumpadAdd') k = '=';
  else if (e.code === 'NumpadSubtract') k = '-';
  else if (/^Numpad[0-9]$/.test(e.code)) k = e.code.slice(6);
  else if (e.key.length === 1) k = SHIFTED[e.key] ?? e.key.toUpperCase();
  else k = e.key;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(k);
  return parts.join('+');
}

const DISPLAY: Record<string, string> = {
  Delete: 'Del',
  Backspace: '⌫',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

export function formatKey(key: string): string {
  const parts = key.split('+').filter(Boolean);
  if (key.endsWith('+=') || key === '=') parts[parts.length - 1] = '=';
  let last = parts[parts.length - 1];
  const shift = parts.includes('Shift');
  if (shift && last === '/') last = '?';
  else if (shift && last === '.') last = '>';
  else if (shift && last === ',') last = '<';
  else if (last === '=') last = '+';
  parts[parts.length - 1] = DISPLAY[last] ?? last;
  return parts.join('+');
}

export const shortcutOf = (id: string) => {
  const k = commands[id]?.keys?.[0];
  return k ? formatKey(k) : undefined;
};

const keymap = new Map<string, Command>();
for (const c of list) for (const k of c.keys ?? []) keymap.set(k, c);

export function runCommand(id: string) {
  const c = commands[id];
  if (c && (!c.enabled || c.enabled())) c.run();
}

export function installKeyboard(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    if (isEditableTarget(e.target) || st().editingTextId) return;
    const key = eventKey(e);
    if (!key) return;
    const s = st();

    if (key === 'Escape') {
      e.preventDefault();
      if (s.ui.contextMenu) return store.update((x) => (x.ui.contextMenu = null));
      if (s.ui.showShortcuts) return store.update((x) => (x.ui.showShortcuts = false));
      if (s.tool !== 'MOVE') return store.setTool('MOVE');
      return A.escapeSelection();
    }

    const arrow = /^(Shift\+)?Arrow(Up|Down|Left|Right)$/.exec(key);
    if (arrow) {
      if (!hasSel()) return;
      e.preventDefault();
      const step = arrow[1] ? 10 : 1;
      const dir = arrow[2];
      A.nudgeSelection(dir === 'Left' ? -step : dir === 'Right' ? step : 0, dir === 'Up' ? -step : dir === 'Down' ? step : 0);
      return;
    }

    // dígitos sozinhos definem a opacidade (1 = 10% … 0 = 100%)
    if (/^[0-9]$/.test(key) && hasSel()) {
      e.preventDefault();
      A.setSelectionOpacity(key === '0' ? 1 : Number(key) / 10);
      return;
    }

    const cmd = keymap.get(key);
    if (!cmd) return;
    e.preventDefault();
    if (cmd.enabled && !cmd.enabled()) return;
    if (s.ui.contextMenu) store.update((x) => (x.ui.contextMenu = null));
    cmd.run();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

// ---------- menus ----------

export function item(id: string, label?: string): MenuItemEntry {
  const c = commands[id];
  return {
    kind: 'item',
    label: label ?? c.label,
    shortcut: shortcutOf(id),
    disabled: c.enabled ? !c.enabled() : false,
    checked: c.checked?.(),
    run: c.run,
  };
}

export const sep: MenuEntry = { kind: 'separator' };
const sub = (label: string, items: MenuEntry[]): MenuEntry => ({ kind: 'submenu', label, items });
const empty: MenuEntry = { kind: 'item', label: '(vazio)', disabled: true, run: () => undefined };

/** Menu principal (rótulos de seção como no menu do Figma em pt-BR). */
export function mainMenu(): MenuEntry[] {
  return [
    sub('Arquivo', [
      item('file.new'),
      item('file.open'),
      sep,
      item('file.save'),
      item('file.saveCopy'),
      sep,
      item('tool.image'),
      item('file.export'),
      item('file.exportSvg'),
    ]),
    sub('Editar', [
      item('edit.undo'),
      item('edit.redo'),
      sep,
      { ...item('edit.copy'), shortcut: 'Ctrl+C' },
      { ...item('edit.cut'), shortcut: 'Ctrl+X' },
      { ...item('edit.paste'), shortcut: 'Ctrl+V' },
      item('edit.copyPng'),
      item('edit.duplicate'),
      item('edit.delete'),
      sep,
      item('edit.selectAll'),
      item('edit.selectNone'),
      item('edit.selectChildren'),
      item('edit.selectParent'),
      sep,
      item('edit.copyProps'),
      item('edit.pasteProps'),
    ]),
    sub('Visualizar', [
      item('view.toggleUI'),
      sep,
      item('view.zoomIn'),
      item('view.zoomOut'),
      item('view.zoom100'),
      item('view.zoomFit'),
      item('view.zoomSelection'),
      sep,
      item('view.prevPage'),
      item('view.nextPage'),
    ]),
    sub('Objeto', [
      item('object.group'),
      item('object.ungroup'),
      item('object.frame'),
      item('object.autoLayout'),
      sep,
      sub('Operações booleanas', [
        item('object.boolean.union'),
        item('object.boolean.subtract'),
        item('object.boolean.intersect'),
        item('object.boolean.exclude'),
        item('object.flatten'),
      ]),
      sub('Componentes', [
        item('component.create'),
        item('component.detach'),
        item('component.reset'),
      ]),
      sep,
      item('object.front'),
      item('object.forward'),
      item('object.backward'),
      item('object.back'),
      sep,
      item('object.flipH'),
      item('object.flipV'),
      item('object.rotate90'),
      sep,
      item('object.toggleVisible'),
      item('object.toggleLocked'),
      item('object.rename'),
    ]),
    sub('Vetor', [item('vector.close'), item('vector.open'), item('object.flatten')]),
    sub('Texto', [item('text.bold'), item('text.bigger'), item('text.smaller'), sep, item('text.left'), item('text.center'), item('text.right')]),
    sub('Organizar', [
      item('arrange.left'),
      item('arrange.hcenter'),
      item('arrange.right'),
      sep,
      item('arrange.top'),
      item('arrange.vcenter'),
      item('arrange.bottom'),
      sep,
      item('arrange.distH'),
      item('arrange.distV'),
    ]),
    sub('Plugins', [empty]),
    sub('Widgets', [empty]),
    sep,
    sub('Preferências', [item('prefs.light'), item('prefs.dark')]),
    sub('Ajuda', [item('help.actions'), item('help.shortcuts'), item('help.about')]),
  ];
}

/** Menu de contexto do canvas e da lista de camadas. */
export function contextMenu(): MenuEntry[] {
  if (!hasSel())
    return [
      { ...item('edit.paste'), shortcut: 'Ctrl+V' },
      sep,
      item('view.toggleUI'),
      item('view.zoomFit'),
      sep,
      item('edit.selectAll'),
      item('help.actions'),
      item('help.shortcuts'),
    ];
  const nodes = selNodes();
  const anyVisible = nodes.some((n) => n.visible);
  const anyLocked = nodes.some((n) => n.locked);
  return [
    { ...item('edit.copy'), shortcut: 'Ctrl+C' },
    { ...item('edit.cut'), shortcut: 'Ctrl+X' },
    { ...item('edit.paste'), shortcut: 'Ctrl+V' },
    item('edit.copyPng'),
    item('edit.duplicate'),
    item('edit.delete'),
    sep,
    item('component.create'),
    ...(nodes.some((n) => n.type === 'INSTANCE') ? [item('component.detach'), item('component.reset')] : []),
    ...(nodes.length >= 2
      ? [
          sub('Operações booleanas', [
            item('object.boolean.union'),
            item('object.boolean.subtract'),
            item('object.boolean.intersect'),
            item('object.boolean.exclude'),
            item('object.flatten'),
          ]),
        ]
      : []),
    sep,
    item('object.front'),
    item('object.back'),
    sep,
    item('object.group'),
    ...(hasType('GROUP', 'FRAME')() ? [item('object.ungroup')] : []),
    item('object.frame'),
    item('object.autoLayout'),
    sep,
    item('object.flipH'),
    item('object.flipV'),
    sep,
    item('object.toggleVisible', anyVisible ? 'Ocultar' : 'Mostrar'),
    item('object.toggleLocked', anyLocked ? 'Desbloquear' : 'Bloquear'),
    item('object.rename'),
    sep,
    item('edit.copyProps'),
    item('edit.pasteProps'),
    item('file.export', 'Exportar…'),
  ];
}

/** Grupos mostrados na janela de atalhos. */
export const SHORTCUT_GROUPS: { title: string; ids: string[] }[] = [
  {
    title: 'Ferramentas',
    ids: ['tool.move', 'tool.hand', 'tool.frame', 'tool.rectangle', 'tool.ellipse', 'tool.line', 'tool.arrow', 'tool.text', 'tool.pencil', 'tool.image'],
  },
  {
    title: 'Edição',
    ids: [
      'edit.undo',
      'edit.redo',
      'edit.copyPng',
      'edit.duplicate',
      'edit.delete',
      'edit.selectAll',
      'edit.selectChildren',
      'edit.selectParent',
      'edit.nextSibling',
      'edit.copyProps',
      'edit.pasteProps',
      'object.rename',
    ],
  },
  {
    title: 'Visualização',
    ids: ['view.toggleUI', 'view.zoomIn', 'view.zoomOut', 'view.zoom100', 'view.zoomFit', 'view.zoomSelection', 'view.nextPage', 'help.shortcuts'],
  },
  {
    title: 'Objeto',
    ids: [
      'object.group',
      'object.ungroup',
      'object.frame',
      'object.autoLayout',
      'object.boolean.union',
      'object.flatten',
      'component.create',
      'component.detach',
      'object.front',
      'object.forward',
      'object.backward',
      'object.back',
      'object.flipH',
      'object.flipV',
      'object.toggleVisible',
      'object.toggleLocked',
    ],
  },
  { title: 'Texto', ids: ['text.bold', 'text.bigger', 'text.smaller', 'text.left', 'text.center', 'text.right'] },
  {
    title: 'Organizar',
    ids: ['arrange.left', 'arrange.hcenter', 'arrange.right', 'arrange.top', 'arrange.vcenter', 'arrange.bottom', 'arrange.distH', 'arrange.distV'],
  },
  { title: 'Arquivo', ids: ['file.new', 'file.open', 'file.save', 'file.saveCopy', 'file.export'] },
];

/** Dicas de mouse que não são comandos. */
export const MOUSE_HINTS: [string, string][] = [
  ['Espaço + arrastar', 'Mover a tela'],
  ['Ctrl + roda', 'Zoom'],
  ['Shift + roda', 'Rolar na horizontal'],
  ['Shift ao arrastar', 'Travar eixo / proporção'],
  ['Alt ao redimensionar', 'A partir do centro'],
  ['Alt + arrastar', 'Duplicar'],
  ['Ctrl + clique', 'Selecionar dentro de grupos'],
  ['Shift ao girar', 'Passos de 15°'],
  ['Setas (Shift)', 'Deslocar 1 px (10 px)'],
  ['1 … 0', 'Opacidade 10% … 100%'],
];
