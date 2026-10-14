import { type CSSProperties, type DragEvent, type MouseEvent, useEffect, useRef, useState } from 'react';
import * as A from '../actions';
import { boundsOf, childrenOf, isDescendant, moveToParent, normalizeGroupChain, topLevelIds } from '../model/document';
import type { NodeType, SceneNode } from '../model/types';
import type { MenuEntry } from '../commands';
import { store, useEditor } from '../store/store';
import * as I from './icons';
import { MenuPopup } from './Menu';

/** Same node glyphs in the layer tree and the property inspector. */
export function NodeIcon({ node, type, size = 16 }: { node?: SceneNode; type?: NodeType; size?: number }) {
  if (node?.fills.some((paint) => paint.type === 'IMAGE')) return <I.IconImage size={size} />;
  const t = node?.type ?? type ?? 'RECTANGLE';
  if (t === 'COMPONENT') return <span style={{ color: '#9747FF', display: 'inline-flex' }}><I.IconComponent size={size} /></span>;
  if (t === 'INSTANCE') return <span style={{ color: '#9747FF', display: 'inline-flex' }}><I.IconInstance size={size} /></span>;
  if (t === 'BOOLEAN_OPERATION') {
    const op = node?.booleanOperation ?? 'UNION';
    if (op === 'SUBTRACT') return <I.IconSubtract size={size} />;
    if (op === 'INTERSECT') return <I.IconIntersect size={size} />;
    if (op === 'EXCLUDE') return <I.IconExclude size={size} />;
    return <I.IconUnion size={size} />;
  }
  const glyphs = {
    FRAME: I.IconFrame,
    GROUP: I.IconGroup,
    RECTANGLE: I.IconRect,
    ELLIPSE: I.IconEllipse,
    POLYGON: I.IconPolygon,
    STAR: I.IconStar,
    LINE: node?.arrowEnd ? I.IconArrow : I.IconLine,
    TEXT: I.IconText,
    VECTOR: I.IconVector,
  };
  const Glyph = (glyphs as Record<string, React.ComponentType<{ size?: number }>>)[t] ?? I.IconRect;
  return <Glyph size={size} />;
}

function RenameInput({ id, name, page = false }: { id: string; name: string; page?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) (page ? A.renamePage : A.renameNode)(id, value);
    store.update((s) => (s.ui.renamingId = null));
  };
  return (
    <input
      ref={ref}
      className="rename-input"
      aria-label={page ? 'Nome da página' : 'Nome da camada'}
      value={value}
      maxLength={200}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      }}
    />
  );
}

type DropTarget = { id: string; position: 'before' | 'after' | 'inside' };
type LayerEntry = { node: SceneNode; depth: number };
const searchText = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

export function LeftPanel() {
  const s = useEditor();
  const [tab, setTab] = useState<'layers' | 'assets'>('layers');
  const [pagesOpen, setPagesOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [pageMenu, setPageMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const dragIds = useRef<string[]>([]);
  const anchorId = useRef<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const page = store.page;
  const needle = searchText(query.trim());
  const entries: LayerEntry[] = [];
  const matches = (id: string): boolean => {
    const n = s.doc.nodes[id];
    return !!n && (searchText(n.name).includes(needle) || (n.children ?? []).some(matches));
  };
  const visit = (ids: string[], depth: number) => {
    for (const id of [...ids].reverse()) {
      const node = s.doc.nodes[id];
      if (!node || (needle && !matches(id))) continue;
      entries.push({ node, depth });
      if (node.children?.length && (needle || s.ui.expanded[id])) visit(node.children, depth + 1);
    }
  };
  visit(page.children, 0);

  // Selecting a nested object on the canvas reveals its ancestors in the tree.
  const selectionKey = s.selection.join('|');
  useEffect(() => {
    let changed = false;
    for (const id of store.state.selection) {
      let parent = store.state.doc.nodes[id]?.parentId;
      while (parent && store.state.doc.nodes[parent]) {
        if (!store.state.ui.expanded[parent]) { store.state.ui.expanded[parent] = true; changed = true; }
        parent = store.state.doc.nodes[parent]?.parentId;
      }
    }
    if (changed) store.emit();
  }, [selectionKey]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  function selectLayer(event: MouseEvent, id: string) {
    store.finishTextEditing();
    if (event.shiftKey && anchorId.current) {
      const from = entries.findIndex((entry) => entry.node.id === anchorId.current);
      const to = entries.findIndex((entry) => entry.node.id === id);
      if (from >= 0 && to >= 0) {
        const range = entries.slice(Math.min(from, to), Math.max(from, to) + 1).map((entry) => entry.node.id);
        store.setSelection(event.ctrlKey || event.metaKey ? [...new Set([...s.selection, ...range])] : range);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      store.setSelection(s.selection.includes(id) ? s.selection.filter((value) => value !== id) : [...s.selection, id]);
    } else store.setSelection([id]);
    anchorId.current = id;
  }

  function startDrag(event: DragEvent, id: string) {
    const ids = s.selection.includes(id) ? topLevelIds(s.doc, s.selection) : [id];
    dragIds.current = ids;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-prancheta-layers', JSON.stringify(ids));
    event.dataTransfer.setData('text/plain', s.doc.nodes[id].name);
    if (!s.selection.includes(id)) store.setSelection([id]);
  }

  function dropOn(event: DragEvent, target: DropTarget | null) {
    event.preventDefault();
    event.stopPropagation();
    setDrop(null);
    const ids = dragIds.current;
    dragIds.current = [];
    if (!ids.length) return;
    const targetNode = target ? s.doc.nodes[target.id] : undefined;
    const parentId = target?.position === 'inside' ? target.id : targetNode?.parentId ?? page.id;
    if (ids.some((id) => id === parentId || isDescendant(s.doc, parentId, id) || id === target?.id)) return;
    A.commit((doc) => {
      let beforeId: string | null = null;
      if (target && target.position !== 'inside' && targetNode) {
        const siblings = childrenOf(doc, parentId).filter((id) => !ids.includes(id));
        // The layer list is reversed relative to painting order.
        beforeId = target.position === 'after' ? target.id : siblings[siblings.indexOf(target.id) + 1] ?? null;
      }
      const paintOrdered = [...ids].sort((a, b) => {
        const siblings = childrenOf(doc, doc.nodes[a].parentId);
        return siblings.indexOf(a) - siblings.indexOf(b);
      });
      for (const id of paintOrdered) moveToParent(doc, id, parentId, beforeId);
      normalizeGroupChain(doc, parentId);
      if (target?.position === 'inside') store.state.ui.expanded[parentId] = true;
      store.state.selection = ids.filter((id) => doc.nodes[id]);
    });
  }

  const openPageMenu = (event: MouseEvent, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setPageMenu({ id, x: event.type === 'contextmenu' ? event.clientX : rect.left, y: event.type === 'contextmenu' ? event.clientY : rect.bottom + 4 });
  };
  const pageMenuItems: MenuEntry[] = pageMenu ? [
    { kind: 'item', label: 'Renomear página', run: () => store.update((state) => (state.ui.renamingId = pageMenu.id)) },
    { kind: 'item', label: 'Duplicar página', run: () => A.duplicatePage(pageMenu.id) },
    { kind: 'separator' },
    { kind: 'item', label: 'Excluir página', danger: true, disabled: s.doc.pages.length <= 1, run: () => A.deletePage(pageMenu.id) },
  ] : [];

  return (
    <aside className="panel left-panel" aria-label="Páginas e camadas">
      <div className="lp-tabs" role="tablist" aria-label="Navegação do arquivo">
        <button role="tab" aria-selected={tab === 'layers'} className={'lp-tab' + (tab === 'layers' ? ' active' : '')} onClick={() => setTab('layers')}>Camadas</button>
        <button role="tab" aria-selected={tab === 'assets'} className={'lp-tab' + (tab === 'assets' ? ' active' : '')} onClick={() => setTab('assets')}>Ativos</button>
        <button className={'icon-btn lp-search-toggle' + (searchOpen ? ' active' : '')} aria-label="Pesquisar camadas" title="Pesquisar camadas" onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setQuery(''); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4.5 4.5" /></svg>
        </button>
      </div>
      {searchOpen && <div className="layer-search"><input ref={searchRef} placeholder="Pesquisar por nome…" aria-label="Pesquisar por nome" value={query} onChange={(e) => setQuery(e.target.value)} /><button className="icon-btn" title="Limpar pesquisa" aria-label="Limpar pesquisa" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><I.IconClose size={16} /></button></div>}
      <section className="lp-pages" aria-label="Páginas">
        <div className="lp-section-head">
          <button className="lp-section-toggle" aria-expanded={pagesOpen} onClick={() => setPagesOpen(!pagesOpen)}><I.IconChevronDown size={16} style={{ transform: pagesOpen ? undefined : 'rotate(-90deg)' }} /><span>Páginas</span></button>
          <button className="icon-btn" title="Adicionar página" aria-label="Adicionar página" onClick={A.addPage}><I.IconPlus size={16} /></button>
        </div>
        {pagesOpen && s.doc.pages.map((p) => <div key={p.id} className={'page-row' + (p.id === s.pageId ? ' selected' : '')} onClick={() => store.setPage(p.id)} onDoubleClick={() => store.update((state) => (state.ui.renamingId = p.id))} onContextMenu={(e) => openPageMenu(e, p.id)}>
          <span className="page-check">{p.id === s.pageId ? <I.IconCheck size={16} /> : <I.IconPage size={16} />}</span>
          {s.ui.renamingId === p.id ? <RenameInput key={p.id} id={p.id} name={p.name} page /> : <button className="page-name" onClick={() => store.setPage(p.id)}>{p.name}</button>}
          <button className="icon-btn page-more" data-menu-anchor="" aria-label={'Opções de ' + p.name} title="Opções da página" onClick={(e) => openPageMenu(e, p.id)}><span aria-hidden="true">⋯</span></button>
        </div>)}
      </section>
      {tab === 'layers' ? <>
        <div className="lp-section-head lp-layers-head"><span>Camadas</span><span className="layer-count">{Object.values(s.doc.nodes).filter((node) => node.parentId === page.id).length}</span></div>
        <div ref={treeRef} className={'layer-tree' + (drop?.id === page.id ? ' dropping-root' : '')} role="tree" aria-label="Camadas da página" aria-multiselectable="true" onDragOver={(e) => { if (!dragIds.current.length) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (e.target === e.currentTarget) setDrop({ id: page.id, position: 'inside' }); }} onDrop={(e) => dropOn(e, null)} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }}>
          {entries.map(({ node, depth }) => {
            const selected = s.selection.includes(node.id);
            const expanded = !!s.ui.expanded[node.id] || !!needle;
            const hasChildren = !!node.children?.length;
            const position = drop?.id === node.id ? drop.position : null;
            return <div key={node.id} role="treeitem" aria-selected={selected} aria-expanded={hasChildren ? expanded : undefined} aria-level={depth + 1} data-node-id={node.id} tabIndex={0} className={'layer-row' + (selected ? ' selected' : '') + (!node.visible ? ' is-hidden' : '') + (s.hoverId === node.id ? ' hovered' : '') + (position ? ' layer-drop-' + position : '')} style={{ '--depth': depth } as CSSProperties} draggable={s.ui.renamingId !== node.id} onClick={(e) => selectLayer(e, node.id)} onDoubleClick={() => store.update((state) => (state.ui.renamingId = node.id))} onPointerEnter={() => store.setHover(node.id)} onPointerLeave={() => store.setHover(null)} onKeyDown={(e) => { if (s.ui.renamingId === node.id) return; if (e.key === 'F2') { e.preventDefault(); store.update((state) => (state.ui.renamingId = node.id)); } if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); store.setSelection([node.id]); } }} onContextMenu={(e) => { e.preventDefault(); if (!selected) store.setSelection([node.id]); store.update((state) => (state.ui.contextMenu = { x: e.clientX, y: e.clientY, world: store.viewportCenterWorld() })); }} onDragStart={(e) => startDrag(e, node.id)} onDragEnd={() => { dragIds.current = []; setDrop(null); }} onDragOver={(e) => {
              if (!dragIds.current.length || dragIds.current.some((id) => id === node.id || isDescendant(s.doc, node.id, id))) return;
              e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
              const r = e.currentTarget.getBoundingClientRect();
              const fraction = (e.clientY - r.top) / r.height;
              setDrop({ id: node.id, position: node.children && fraction > 0.25 && fraction < 0.75 ? 'inside' : fraction < 0.5 ? 'before' : 'after' });
              const tree = treeRef.current;
              if (tree) { const bounds = tree.getBoundingClientRect(); if (e.clientY < bounds.top + 24) tree.scrollTop -= 12; else if (e.clientY > bounds.bottom - 24) tree.scrollTop += 12; }
            }} onDrop={(e) => dropOn(e, drop)}>
              <button className="layer-caret" aria-label={expanded ? 'Recolher ' + node.name : 'Expandir ' + node.name} style={{ visibility: hasChildren ? undefined : 'hidden' }} onClick={(e) => { e.stopPropagation(); store.update((state) => (state.ui.expanded[node.id] = !expanded)); }}><I.IconChevronRight size={12} style={{ transform: expanded ? 'rotate(90deg)' : undefined }} /></button>
              <span className={'layer-icon' + (node.type === 'GROUP' ? ' is-group' : '')}><NodeIcon node={node} /></span>
              {s.ui.renamingId === node.id ? <RenameInput key={node.id} id={node.id} name={node.name} /> : <span className="layer-name" title={node.name}>{node.name}</span>}
              <span className="layer-actions">
                <button className={'icon-btn layer-lock' + (node.locked ? ' persistent' : '')} title={node.locked ? 'Desbloquear' : 'Bloquear'} aria-label={(node.locked ? 'Desbloquear ' : 'Bloquear ') + node.name} onClick={(e) => { e.stopPropagation(); A.toggleLocked([node.id]); }}>{node.locked ? <I.IconLock size={14} /> : <I.IconUnlock size={14} />}</button>
                <button className={'icon-btn layer-visibility' + (!node.visible ? ' persistent' : '')} title={node.visible ? 'Ocultar' : 'Mostrar'} aria-label={(node.visible ? 'Ocultar ' : 'Mostrar ') + node.name} onClick={(e) => { e.stopPropagation(); A.toggleVisible([node.id]); }}>{node.visible ? <I.IconEye size={14} /> : <I.IconEyeOff size={14} />}</button>
              </span>
            </div>;
          })}
          {!entries.length && <div className="lp-empty"><I.IconGroup size={28} /><strong>{needle ? 'Nenhuma camada encontrada' : 'Uma página, muitas ideias'}</strong><span>{needle ? 'Experimente outro nome.' : 'Escolha uma ferramenta e desenhe no canvas.'}</span></div>}
        </div>
      </> : <LocalAssets query={needle} />}
      <div className="lp-footer"><I.IconKeyboard size={16} /><button onClick={() => store.update((state) => (state.ui.showShortcuts = true))}>Atalhos de teclado</button><span>?</span></div>
      {pageMenu && <MenuPopup x={pageMenu.x} y={pageMenu.y} items={pageMenuItems} onClose={() => setPageMenu(null)} />}
    </aside>
  );
}

function LocalAssets({ query }: { query: string }) {
  const s = useEditor();
  const components = Object.values(s.doc.nodes).filter(
    (node) => node.type === 'COMPONENT' && (!query || searchText(node.name).includes(query)),
  );
  const otherAssets = Object.values(s.doc.nodes).filter(
    (node) =>
      (node.type === 'GROUP' || (node.type === 'FRAME' && s.doc.pages.some((p) => p.id === node.parentId))) &&
      (!query || searchText(node.name).includes(query)),
  );

  return (
    <div className="lp-assets">
      <div className="lp-section-head">
        <span>Componentes</span>
        <span className="layer-count">{components.length}</span>
      </div>
      <p className="lp-assets-description">Clique em um componente para inserir uma instância.</p>
      {components.length > 0 && (
        <div className="asset-grid">
          {components.map((comp) => (
            <button
              key={comp.id}
              className="asset-card"
              title={`Inserir instância de ${comp.name}`}
              onClick={() => A.createInstance(comp.id)}
            >
              <span className="asset-preview" style={{ color: '#9747FF' }}>
                <I.IconComponent size={28} />
                <span>{Math.round(comp.width)} × {Math.round(comp.height)}</span>
              </span>
              <span className="asset-name" style={{ color: '#9747FF' }}>❖ {comp.name}</span>
            </button>
          ))}
        </div>
      )}
      {otherAssets.length > 0 && (
        <>
          <div className="lp-section-head" style={{ marginTop: 16 }}>
            <span>Outros contêineres</span>
            <span className="layer-count">{otherAssets.length}</span>
          </div>
          <div className="asset-grid">
            {otherAssets.map((node) => (
              <button
                key={node.id}
                className="asset-card"
                title={`Inserir cópia de ${node.name}`}
                onClick={() => {
                  store.checkpoint();
                  const [copy] = A.duplicateNodes([node.id], false);
                  if (!copy) return;
                  const doc = store.state.doc;
                  moveToParent(doc, copy, store.page.id);
                  const bounds = boundsOf(doc, [copy]);
                  const center = store.viewportCenterWorld();
                  if (bounds) {
                    doc.nodes[copy].x += center.x - bounds.x - bounds.width / 2;
                    doc.nodes[copy].y += center.y - bounds.y - bounds.height / 2;
                  }
                  store.state.selection = [copy];
                  store.state.tool = 'MOVE';
                  store.emit();
                  store.toast('Cópia inserida no centro da tela');
                }}
              >
                <span className="asset-preview">
                  <NodeIcon node={node} size={32} />
                  <span>{Math.round(node.width)} × {Math.round(node.height)}</span>
                </span>
                <span className="asset-name">{node.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {!components.length && !otherAssets.length && (
        <div className="lp-empty">
          <I.IconComponent size={28} style={{ color: '#9747FF' }} />
          <strong>{query ? 'Nenhum ativo encontrado' : 'Nenhum componente criado'}</strong>
          <span>Selecione um frame ou grupo e aperte Ctrl+Alt+K para transformá-lo em componente.</span>
        </div>
      )}
    </div>
  );
}
