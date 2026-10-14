import { type PointerEvent as RPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { fmtNum } from '../../canvas/geometry';
import { store } from '../../store/store';

/** Avalia expressões simples como "100+20", "50*2" ou "(10+2)/3" sem usar eval. */
export function evaluate(expr: string): number | null {
  const src = expr.replace(/,/g, '.').replace(/\s+/g, '');
  let i = 0;
  const peek = () => src[i];
  const parseNumber = (): number | null => {
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = (): number | null => {
    if (peek() === '-') {
      i++;
      const v = factor();
      return v === null ? null : -v;
    }
    if (peek() === '+') {
      i++;
      return factor();
    }
    if (peek() === '(') {
      i++;
      const v = sum();
      if (peek() !== ')') return null;
      i++;
      return v;
    }
    return parseNumber();
  };
  const product = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = src[i++];
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : r === 0 ? null : v / r;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = src[i++];
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return v !== null && i === src.length && isFinite(v) ? v : null;
}

export interface NumberFieldProps {
  /** Rótulo à esquerda (letra ou ícone); arrastar sobre ele altera o valor. */
  label?: ReactNode;
  value: number | null;
  onChange: (v: number, live: boolean) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** Multiplicador entre o valor exibido e o valor real (ex.: 100 para porcentagem). */
  displayScale?: number;
  placeholder?: string;
  /** Texto exibido quando o valor é nulo e não é misto (ex.: "Auto"). */
  nullText?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export function NumberField({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  suffix = '',
  displayScale = 1,
  placeholder = 'Misto',
  nullText,
  disabled,
  title,
  className,
}: NumberFieldProps) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipCommit = useRef(false);
  const shown = value === null ? null : value * displayScale;
  const display = shown === null ? (nullText ?? '') : fmtNum(shown) + suffix;

  useEffect(() => {
    if (!focused) setText(display);
  }, [display, focused]);

  const clampV = (v: number) => Math.min(max, Math.max(min, v));
  const emit = (displayValue: number, live: boolean) => onChange(clampV(displayValue / displayScale), live);

  const commitText = () => {
    const raw = text.trim().replace(new RegExp(`${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '').trim();
    if (!raw || raw === display) return;
    let v: number | null = null;
    // "+10", "*2" e "/2" são relativos ao valor atual
    if (shown !== null && /^[+*/]/.test(raw)) v = evaluate(`${shown}${raw}`);
    else v = evaluate(raw);
    if (v !== null) emit(v, false);
  };

  // arrastar sobre o rótulo
  const scrub = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const onLabelDown = (e: RPointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrub.current = { x: e.clientX, start: shown ?? 0, moved: false };
  };
  const onLabelMove = (e: RPointerEvent) => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.moved) {
      if (Math.abs(dx) < 2) return;
      s.moved = true;
      store.checkpoint();
    }
    const k = e.shiftKey ? 10 : 1;
    const next = Math.round((s.start + dx * step * k) / step) * step;
    emit(next, true);
  };
  const onLabelUp = (e: RPointerEvent) => {
    const s = scrub.current;
    scrub.current = null;
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId))
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (s && !s.moved) inputRef.current?.focus();
  };

  return (
    <div className={'num-field' + (disabled ? ' disabled' : '') + (className ? ' ' + className : '')} title={title}>
      {label !== undefined && (
        <span className="num-label" onPointerDown={onLabelDown} onPointerMove={onLabelMove} onPointerUp={onLabelUp}>
          {label}
        </span>
      )}
      <input
        ref={inputRef}
        className="num-input"
        value={focused ? text : display}
        placeholder={value === null && !nullText ? placeholder : undefined}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          setText(display);
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => {
          if (!skipCommit.current) commitText();
          skipCommit.current = false;
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitText();
            skipCommit.current = true;
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            skipCommit.current = true;
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const next = clampV(((shown ?? 0) + d) / displayScale) * displayScale;
            emit(next, false);
            setText(fmtNum(next) + suffix);
          }
        }}
      />
    </div>
  );
}
