import { type PointerEvent as RPointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addImageToDoc, imagePaint, pickFiles } from '../../actions';
import { type HSV, hexToRgb, hsvToRgb, normalizeHex, rgbToHex, rgbToHsv, rgba } from '../../canvas/color';
import { readFileAsDataURL } from '../../canvas/images';
import type { GradientPaint, Paint, ScaleMode, SolidPaint } from '../../model/types';
import { store } from '../../store/store';
import { IconClose } from '../icons';
import { NumberField } from './NumberField';

const WIDTH = 240;

function useDrag(onPoint: (fx: number, fy: number, live: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const at = (e: RPointerEvent, live: boolean) => {
    const r = ref.current!.getBoundingClientRect();
    onPoint(
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      live,
    );
  };
  return {
    ref,
    onPointerDown: (e: RPointerEvent) => {
      if (e.button !== 0) return;
      active.current = true;
      ref.current!.setPointerCapture(e.pointerId);
      at(e, false);
    },
    onPointerMove: (e: RPointerEvent) => active.current && at(e, true),
    onPointerUp: () => (active.current = false),
  };
}

interface SolidEditorProps {
  paint: SolidPaint;
  onChange: (p: SolidPaint, live: boolean) => void;
  docColors: string[];
}

function SolidEditor({ paint, onChange, docColors }: SolidEditorProps) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(paint.color)));
  const [hex, setHex] = useState(paint.color.slice(1));
  const current = rgbToHex(hsvToRgb(hsv));

  // cor alterada por fora (desfazer, outro campo): sincroniza mantendo o matiz quando possível
  useEffect(() => {
    if (normalizeHex(paint.color) !== current) setHsv(rgbToHsv(hexToRgb(paint.color)));
    setHex(paint.color.slice(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint.color]);

  const emitHsv = (next: HSV, live: boolean) => {
    setHsv(next);
    onChange({ ...paint, color: rgbToHex(hsvToRgb(next)) }, live);
  };

  const sv = useDrag((fx, fy, live) => emitHsv({ h: hsv.h, s: fx, v: 1 - fy }, live));
  const hue = useDrag((fx, _fy, live) => emitHsv({ ...hsv, h: Math.min(359.9, fx * 360) }, live));
  const alpha = useDrag((fx, _fy, live) => onChange({ ...paint, opacity: Math.round(fx * 100) / 100 }, live));
  const hueColor = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));

  return (
    <div className="cp-solid">
      <div
        className="cp-sv"
        {...sv}
        style={{ background: hueColor }}
      >
        <div className="cp-sv-white" />
        <div className="cp-sv-black" />
        <div className="cp-sv-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: current }} />
      </div>
      <div className="cp-sliders">
        <div className="cp-slider cp-hue" {...hue}>
          <div className="cp-slider-knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: hueColor }} />
        </div>
        <div className="cp-slider cp-alpha checker" {...alpha}>
          <div className="cp-alpha-fill" style={{ background: `linear-gradient(to right, ${rgba(current, 0)}, ${current})` }} />
          <div className="cp-slider-knob" style={{ left: `${paint.opacity * 100}%`, background: rgba(current, paint.opacity) }} />
        </div>
      </div>
      <div className="cp-row">
        <span className="cp-mode">Hex</span>
        <input
          className="cp-hex"
          value={hex}
          spellCheck={false}
          onChange={(e) => setHex(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => {
            const h = normalizeHex(hex);
            if (h && h !== paint.color) onChange({ ...paint, color: h }, false);
            else setHex(paint.color.slice(1));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setHex(paint.color.slice(1));
              e.currentTarget.blur();
            }
          }}
        />
        <NumberField
          className="cp-opacity"
          value={paint.opacity}
          displayScale={100}
          suffix="%"
          min={0}
          max={1}
          onChange={(v, live) => onChange({ ...paint, opacity: v }, live)}
        />
      </div>
      {docColors.length > 0 && (
        <div className="cp-doc">
          <div className="cp-doc-title">Neste arquivo</div>
          <div className="cp-swatches">
            {docColors.map((c) => (
              <button key={c} className="cp-swatch" title={c} style={{ background: c }} onClick={() => onChange({ ...paint, color: c }, false)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const SCALE_LABELS: Record<ScaleMode, string> = { FILL: 'Preencher', FIT: 'Ajustar', STRETCH: 'Esticar' };

async function chooseImage(): Promise<string | null> {
  const [file] = await pickFiles('image/*', false);
  if (!file) return null;
  const src = await readFileAsDataURL(file);
  return addImageToDoc(store.state.doc, src);
}

interface PaintPopoverProps {
  anchor: DOMRect;
  paint: Paint;
  onChange: (p: Paint, live: boolean) => void;
  onClose: () => void;
  allowImage?: boolean;
  docColors: string[];
  title?: string;
}

/** Janela de edição de uma pintura (cor sólida ou imagem), aberta ao lado do painel. */
export function PaintPopover({ anchor, paint, onChange, onClose, allowImage = true, docColors, title = 'Preenchimento' }: PaintPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchor.top - 8);

  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(anchor.top - 8, window.innerHeight - h - 8)));
  }, [anchor.top, paint.type]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('.paint-popover') || t?.closest('[data-menu-anchor]') || t?.closest('.menu')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input')) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  const switchType = async (type: string) => {
    if (type === paint.type) return;
    if (type === 'SOLID') {
      onChange({ type: 'SOLID', color: '#D9D9D9', opacity: paint.opacity, visible: true }, false);
    } else if (type === 'GRADIENT_LINEAR' || type === 'GRADIENT_RADIAL') {
      onChange(
        {
          type,
          stops: [
            { position: 0, color: '#0D99FF', opacity: 1 },
            { position: 1, color: '#000000', opacity: 1 },
          ],
          angle: 90,
          opacity: paint.opacity,
          visible: true,
        },
        false,
      );
    } else {
      const id = await chooseImage();
      if (id) onChange({ ...imagePaint(id), opacity: paint.opacity }, false);
    }
  };

  const left = Math.max(8, anchor.left - WIDTH - 16);
  const src = paint.type === 'IMAGE' ? store.state.doc.images[paint.imageId] : null;

  return createPortal(
    <div ref={ref} className="paint-popover" style={{ left, top, width: WIDTH }} onContextMenu={(e) => e.preventDefault()}>
      <div className="pp-header">
        {allowImage ? (
          <select className="pp-type" value={paint.type} onChange={(e) => void switchType(e.target.value)}>
            <option value="SOLID">Sólido</option>
            <option value="GRADIENT_LINEAR">Gradiente Linear</option>
            <option value="GRADIENT_RADIAL">Gradiente Radial</option>
            <option value="IMAGE">Imagem</option>
          </select>
        ) : (
          <span className="pp-title">{title}</span>
        )}
        <button className="icon-btn" title="Fechar" onClick={onClose}>
          <IconClose size={24} />
        </button>
      </div>
      {paint.type === 'SOLID' ? (
        <SolidEditor paint={paint} onChange={onChange} docColors={docColors} />
      ) : paint.type === 'IMAGE' ? (
        <div className="pp-image">
          <div className="pp-preview checker">
            {src && <img src={src} alt="" style={{ objectFit: paint.scaleMode === 'FILL' ? 'cover' : paint.scaleMode === 'FIT' ? 'contain' : 'fill' }} />}
          </div>
          <div className="cp-row">
            <select
              className="select grow"
              value={paint.scaleMode}
              onChange={(e) => onChange({ ...paint, scaleMode: e.target.value as ScaleMode }, false)}
            >
              {(Object.keys(SCALE_LABELS) as ScaleMode[]).map((m) => (
                <option key={m} value={m}>
                  {SCALE_LABELS[m]}
                </option>
              ))}
            </select>
            <NumberField
              className="cp-opacity"
              value={paint.opacity}
              displayScale={100}
              suffix="%"
              min={0}
              max={1}
              onChange={(v, live) => onChange({ ...paint, opacity: v }, live)}
            />
          </div>
          <button
            className="btn secondary full"
            onClick={async () => {
              const id = await chooseImage();
              if (id) onChange({ ...paint, imageId: id }, false);
            }}
          >
            Escolher outra imagem…
          </button>
        </div>
      ) : (
        <GradientEditor paint={paint} onChange={onChange} docColors={docColors} />
      )}
    </div>,
    document.body,
  );
}

function GradientEditor({
  paint,
  onChange,
  docColors,
}: {
  paint: GradientPaint;
  onChange: (p: Paint, live: boolean) => void;
  docColors: string[];
}) {
  const [stopIndex, setStopIndex] = useState(0);
  const stop = paint.stops[stopIndex] ?? paint.stops[0];

  const updateStop = (color: string, opacity: number, live: boolean) => {
    const nextStops = paint.stops.map((s, i) => (i === stopIndex ? { ...s, color, opacity } : s));
    onChange({ ...paint, stops: nextStops }, live);
  };

  return (
    <div className="cp-gradient">
      <div className="cp-row spread" style={{ padding: '0 12px', marginTop: 8 }}>
        <span style={{ color: 'var(--muted)', fontSize: 11 }}>
          Parada {stopIndex + 1} de {paint.stops.length}
        </span>
        <div className="btn-group">
          {paint.stops.map((_, i) => (
            <button
              key={i}
              className={'icon-btn' + (stopIndex === i ? ' active' : '')}
              onClick={() => setStopIndex(i)}
              style={{ width: 22, height: 22, fontSize: 10 }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>
      <SolidEditor
        paint={{ type: 'SOLID', color: stop.color, opacity: stop.opacity, visible: true }}
        docColors={docColors}
        onChange={(solidPaint, live) => {
          if (solidPaint.type === 'SOLID') {
            updateStop(solidPaint.color, solidPaint.opacity, live);
          }
        }}
      />
    </div>
  );
}

