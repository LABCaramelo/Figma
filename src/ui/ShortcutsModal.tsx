import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { commands, formatKey, MOUSE_HINTS, SHORTCUT_GROUPS } from '../commands';
import { store, useEditor } from '../store/store';
import { IconClose, IconKeyboard } from './icons';

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
function Keycap({ value }: { value: string }) {
  return <span className="shortcut-keys">{formatKey(value).split('+').filter(Boolean).map((key, i) => <kbd key={i}>{key}</kbd>)}{value.endsWith('=') && <kbd>+</kbd>}</span>;
}

export function ShortcutsModal() {
  const s = useEditor();
  return s.ui.showShortcuts ? <ShortcutDialog /> : null;
}

function ShortcutDialog() {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => store.update((s) => (s.ui.showShortcuts = false));
  const needle = normalize(query);
  const groups = SHORTCUT_GROUPS.map((group) => ({ ...group, ids: group.ids.filter((id) => { const cmd = commands[id]; return cmd?.keys?.length && normalize(cmd.label + ' ' + group.title + ' ' + cmd.keys.join(' ')).includes(needle); }) })).filter((group) => group.ids.length);
  const mouseHints = MOUSE_HINTS.filter(([key, label]) => normalize(key + ' ' + label).includes(needle));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') {
        const focusable = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { window.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, []);
  return createPortal(<div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div ref={ref} className="shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <header className="shortcuts-header"><div><IconKeyboard size={24} /><h2 id="shortcuts-title">Atalhos de teclado</h2></div><button className="icon-btn" aria-label="Fechar atalhos" title="Fechar (Esc)" onClick={close}><IconClose size={20} /></button></header>
      <div className="shortcuts-search"><input ref={inputRef} placeholder="Encontrar um atalho…" aria-label="Pesquisar atalhos" value={query} onChange={(e) => setQuery(e.target.value)} /><kbd>Esc</kbd></div>
      <div className="shortcuts-groups">
        {groups.map((group) => <section className="shortcuts-group" key={group.title}><h3>{group.title}</h3>{group.ids.map((id) => { const command = commands[id]; return <div className="shortcuts-row" key={id}><span>{command.label.replace(/…$/, '')}</span><Keycap value={command.keys![0]} /></div>; })}</section>)}
        {!!mouseHints.length && <section className="shortcuts-group"><h3>Mouse e navegação</h3>{mouseHints.map(([key, label]) => <div className="shortcuts-row" key={key}><span>{label}</span><span className="shortcut-gesture">{key}</span></div>)}</section>}
        {!groups.length && !mouseHints.length && <div className="lp-empty"><strong>Nenhum atalho encontrado</strong><span>Experimente o nome de uma ferramenta ou ação.</span></div>}
      </div>
      <footer className="shortcuts-footer"><span>Mais fluidez para dar forma às suas ideias.</span><button className="secondary-button" onClick={close}>Concluído</button></footer>
    </div>
  </div>, document.body);
}
