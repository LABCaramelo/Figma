import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MenuEntry } from '../commands';
import { IconCheck, IconChevronRight } from './icons';

interface PopupProps {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
  minWidth?: number;
  /** Se não couber abaixo, abre acima desta coordenada (ex.: topo do botão). */
  flipY?: number;
  className?: string;
}

/** Menu flutuante escuro (estilo UI3). Fecha ao clicar fora, com Esc ou ao escolher um item. */
export function MenuPopup({ x, y, items, onClose, minWidth = 220, flipY, className }: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, ready: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - 8 - r.width);
    if (ny + r.height > window.innerHeight - 8)
      ny = flipY !== undefined && flipY - r.height >= 8 ? flipY - r.height : Math.max(8, window.innerHeight - 8 - r.height);
    setPos({ x: nx, y: ny, ready: true });
  }, [x, y, flipY]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.menu') || t?.closest('[data-menu-anchor]')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const close = () => onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className={'menu' + (className ? ' ' + className : '')}
      role="menu"
      style={{ left: pos.x, top: pos.y, minWidth, visibility: pos.ready ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}

function Submenu({ items, onClose }: { items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: '100%', top: -8, visibility: 'hidden' });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next: CSSProperties = { left: '100%', top: -8, visibility: 'visible' };
    if (r.right > window.innerWidth - 8) {
      next.left = 'auto';
      next.right = '100%';
    }
    if (r.bottom > window.innerHeight - 8) next.top = -8 - (r.bottom - (window.innerHeight - 8));
    setStyle(next);
  }, []);
  return (
    <div ref={ref} className="menu submenu" role="menu" style={style}>
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}

function MenuList({ items, onClose }: { items: MenuEntry[]; onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const hasChecks = items.some((it) => it.kind === 'item' && it.checked !== undefined);
  const hasIcons = items.some((it) => it.kind === 'item' && it.icon);
  return (
    <>
      {items.map((it, i) => {
        if (it.kind === 'separator') {
          const prev = items[i - 1];
          if (!prev || prev.kind === 'separator' || i === items.length - 1) return null;
          return <div key={i} className="menu-sep" />;
        }
        if (it.kind === 'submenu')
          return (
            <div
              key={i}
              role="menuitem"
              aria-haspopup="menu"
              className={'menu-item' + (open === i ? ' open' : '') + (it.disabled ? ' disabled' : '')}
              onPointerEnter={() => setOpen(i)}
              onClick={() => setOpen(i)}
            >
              {hasChecks && <span className="menu-check" />}
              <span className="menu-label">{it.label}</span>
              <IconChevronRight size={16} className="menu-chevron" />
              {open === i && !it.disabled && <Submenu items={it.items} onClose={onClose} />}
            </div>
          );
        return (
          <div
            key={i}
            role="menuitem"
            aria-disabled={it.disabled || undefined}
            className={'menu-item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : '')}
            onPointerEnter={() => setOpen(null)}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.run();
            }}
          >
            {hasChecks && <span className="menu-check">{it.checked && <IconCheck size={16} />}</span>}
            {hasIcons && <span className="menu-icon">{it.icon}</span>}
            <span className="menu-label">{it.label}</span>
            {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
          </div>
        );
      })}
    </>
  );
}
