import { useEffect, useMemo, useRef, useState } from 'react';
import { commands, shortcutOf } from '../commands';
import { store } from '../store/store';
import { IconClose } from './icons';

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function QuickActionsModal() {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const allCommands = useMemo(() => {
    return Object.values(commands).filter((cmd) => cmd.id !== 'help.actions');
  }, []);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return allCommands.slice(0, 15);
    return allCommands.filter((cmd) => {
      const matchLabel = norm(cmd.label).includes(q);
      const matchId = norm(cmd.id).includes(q);
      const matchKeys = (cmd.keys ?? []).some((k) => norm(k).includes(q));
      return matchLabel || matchId || matchKeys;
    });
  }, [allCommands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const close = () => {
    store.update((s) => (s.ui.showQuickActions = false));
  };

  const runItem = (index: number) => {
    const cmd = filtered[index];
    if (!cmd) return;
    if (cmd.enabled && !cmd.enabled()) return;
    close();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runItem(selectedIndex);
    }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="quick-actions-modal"
        role="dialog"
        aria-label="Ações rápidas"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="qa-input-wrapper">
          <input
            ref={inputRef}
            className="qa-input"
            placeholder="Pesquisar ações, comandos e ferramentas…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="icon-btn" title="Fechar (Esc)" onClick={close}>
            <IconClose size={20} />
          </button>
        </div>
        <div ref={listRef} className="qa-list">
          {filtered.length === 0 ? (
            <div className="qa-empty">Nenhuma ação encontrada para "{query}"</div>
          ) : (
            filtered.map((cmd, i) => {
              const disabled = cmd.enabled ? !cmd.enabled() : false;
              const shortcut = shortcutOf(cmd.id);
              return (
                <div
                  key={cmd.id}
                  className={
                    'qa-item' +
                    (selectedIndex === i ? ' selected' : '') +
                    (disabled ? ' disabled' : '')
                  }
                  onClick={() => !disabled && runItem(i)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className="qa-label">{cmd.label}</span>
                  {shortcut && <kbd className="qa-kbd">{shortcut}</kbd>}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
