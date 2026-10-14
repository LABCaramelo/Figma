import { useEffect, useRef, useState } from 'react';
import { commit, refitAllText } from './actions';
import { CanvasView } from './canvas/CanvasView';
import { contextMenu, installKeyboard, mainMenu } from './commands';
import { ensureDocFonts, ensureFontFace } from './fonts';
import { installClipboard } from './io/clipboard';
import { saveLocalCopy, startAutosave } from './io/persist';
import { store, useEditor } from './store/store';
import { LeftPanel } from './ui/LeftPanel';
import { MenuPopup } from './ui/Menu';
import { QuickActionsModal } from './ui/QuickActionsModal';
import { RightPanel } from './ui/RightPanel';
import { ShortcutsModal } from './ui/ShortcutsModal';
import { Toolbar } from './ui/Toolbar';
import { IconCheck, IconChevronDown, IconExport, IconKeyboard, IconMoon, IconSun, Logo } from './ui/icons';

function FileName() {
  const { doc } = useEditor();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(doc.name);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const finish = () => {
    if (!cancelled.current && name.trim() && name.trim() !== doc.name) commit((d) => { d.name = name.trim(); });
    cancelled.current = false;
    setEditing(false);
  };
  return editing ? (
    <input ref={input} className="file-name-input" aria-label="Nome do arquivo" value={name}
      onChange={(e) => setName(e.target.value)} onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); }
      }} />
  ) : (
    <button className="file-name" title="Renomear arquivo" onClick={() => { setName(doc.name); setEditing(true); }}>
      {doc.name}<IconChevronDown size={14} />
    </button>
  );
}

function Header() {
  const s = useEditor();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <header className="app-header">
      <button className="app-menu-button" aria-label="Menu principal" title="Menu principal" data-menu-anchor=""
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}>
        <Logo size={25} /><IconChevronDown size={14} />
      </button>
      <div className="header-divider" />
      <span className="file-location">Rascunhos<span>/</span></span>
      <FileName />
      <span className="local-badge" title="Este arquivo é salvo automaticamente neste navegador"><IconCheck size={14} />Local</span>
      <div className="header-spacer" />
      <button className="icon-btn" aria-label="Atalhos de teclado" title="Atalhos de teclado (Ctrl+Shift+?)"
        onClick={() => store.update((state) => { state.ui.showShortcuts = true; })}><IconKeyboard /></button>
      <button className="icon-btn" aria-label={s.ui.theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'} title="Alterar tema"
        onClick={() => store.setTheme(s.ui.theme === 'dark' ? 'light' : 'dark')}>
        {s.ui.theme === 'dark' ? <IconSun /> : <IconMoon />}
      </button>
      <button className="btn primary save-copy" onClick={saveLocalCopy}><IconExport size={16} />Salvar cópia</button>
      {anchor && <MenuPopup x={anchor.left} y={anchor.bottom + 6} items={mainMenu()} onClose={() => setAnchor(null)} />}
    </header>
  );
}

export function App() {
  const s = useEditor();
  useEffect(() => {
    const offKeyboard = installKeyboard();
    const offClipboard = installClipboard();
    const offSave = startAutosave();
    let currentDoc = store.state.doc;
    ensureDocFonts(currentDoc);
    void ensureFontFace('Inter', 400);
    const offFonts = store.subscribe(() => {
      if (currentDoc !== store.state.doc) {
        currentDoc = store.state.doc;
        ensureDocFonts(currentDoc);
      }
      document.title = `${store.state.doc.name} · Prancheta`;
    });
    const fontsLoaded = () => { refitAllText(); store.emit(); };
    document.fonts.addEventListener('loadingdone', fontsLoaded);
    document.title = `${currentDoc.name} · Prancheta`;
    return () => {
      offKeyboard(); offClipboard(); offSave(); offFonts();
      document.fonts.removeEventListener('loadingdone', fontsLoaded);
    };
  }, []);

  return (
    <div className={'app' + (s.ui.hidden ? ' ui-hidden' : '')}>
      {!s.ui.hidden && <Header />}
      <main className="editor-layout">
        {!s.ui.hidden && <LeftPanel />}
        <div className="canvas-area">
          <CanvasView />
          {!s.ui.hidden && <>
            <div className="canvas-page-label">{store.page.name}</div>
            <Toolbar />
            <button className="canvas-help" title="Atalhos de teclado" aria-label="Ajuda e atalhos"
              onClick={() => store.update((state) => { state.ui.showShortcuts = true; })}>?</button>
          </>}
        </div>
        {!s.ui.hidden && <RightPanel />}
      </main>
      {s.ui.hidden && <button className="restore-ui btn secondary" onClick={() => store.update((state) => { state.ui.hidden = false; })}>Mostrar interface <kbd>Ctrl+\</kbd></button>}
      {s.ui.contextMenu && <MenuPopup x={s.ui.contextMenu.x} y={s.ui.contextMenu.y} items={contextMenu()}
        onClose={() => store.update((state) => { state.ui.contextMenu = null; })} />}
      {s.ui.showShortcuts && <ShortcutsModal />}
      {s.ui.showQuickActions && <QuickActionsModal />}
      {s.ui.toast && <div className="toast" key={s.ui.toast.key} role="status">{s.ui.toast.message}</div>}
    </div>
  );
}
