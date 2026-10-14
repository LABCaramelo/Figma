import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { insertImages } from '../actions';
import { ensureFontFace } from '../fonts';
import { boundsOf, worldMatrix } from '../model/document';
import { store, useEditor } from '../store/store';
import { rgba } from './color';
import { CanvasController } from './controller';
import { setImageLoadListener } from './images';
import { drawOverlay } from './overlay';
import { drawNodeList } from './renderer';
import { fitTextBox, lineHeightPx } from './shapes';

export interface CanvasViewProps {
  className?: string;
}

/** The document surface, with a DOM text editor over the canvas while typing. */
export function CanvasView({ className = '' }: CanvasViewProps) {
  const state = useEditor();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [draggingImage, setDraggingImage] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!surface || !canvas || !context) return;

    let disposed = false;
    let frame = 0;
    let pixelRatio = window.devicePixelRatio || 1;
    let controller: CanvasController;
    const requestedFonts = new Set<string>();

    const render = () => {
      frame = 0;
      if (disposed) return;
      const s = store.state;
      const { width, height } = s.viewport;
      const dpr = window.devicePixelRatio || 1;
      if (pixelRatio !== dpr) {
        pixelRatio = dpr;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
      }
      const styles = getComputedStyle(surface);
      const background = store.page.background || styles.getPropertyValue('--canvas-bg').trim() || (s.ui.theme === 'dark' ? '#1E1E1E' : '#E5E5E5');
      const textColor = styles.getPropertyValue('--canvas-text').trim() || (s.ui.theme === 'dark' ? '#F5F5F5' : '#333333');
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      const camera = s.camera;
      context.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y);
      drawNodeList(context, { doc: s.doc, pxScale: dpr * camera.zoom, skipTextId: s.editingTextId }, store.page.children);
      drawOverlay(context, s, controller.overlay, dpr, textColor);
    };

    const requestRender = () => {
      if (!disposed && !frame) frame = window.requestAnimationFrame(render);
    };

    const update = () => {
      for (const node of Object.values(store.state.doc.nodes)) {
        if (node.type !== 'TEXT') continue;
        const family = node.fontFamily ?? 'Inter';
        const weight = node.fontWeight ?? 400;
        const key = `${family}:${weight}`;
        if (!requestedFonts.has(key)) {
          requestedFonts.add(key);
          void ensureFontFace(family, weight).then(requestRender);
        }
      }
      if (store.fitPending && store.state.viewport.width > 0 && store.state.viewport.height > 0) {
        store.fitPending = false;
        store.zoomToRect(boundsOf(store.state.doc, store.page.children), 1);
      }
      requestRender();
    };

    const resize = () => {
      const rect = surface.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      const previous = store.state.viewport;
      const changed = previous.width !== width || previous.height !== height;
      if (changed) {
        store.update((s) => {
          if (!store.fitPending) {
            s.camera.x += (width - previous.width) / 2;
            s.camera.y += (height - previous.height) / 2;
          }
          s.viewport = { width, height };
        });
      }
      update();
    };

    controller = new CanvasController(canvas, store, requestRender);
    const unsubscribe = store.subscribe(update);
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    window.addEventListener('resize', resize);
    document.fonts?.addEventListener('loadingdone', requestRender);
    setImageLoadListener(requestRender);
    resize();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      document.fonts?.removeEventListener('loadingdone', requestRender);
      setImageLoadListener(null);
      unsubscribe();
      controller.destroy();
    };
  }, []);

  const editingId = state.editingTextId;
  const textNode = editingId ? state.doc.nodes[editingId] : null;

  useEffect(() => {
    if (!editingId) return;
    textRef.current?.focus({ preventScroll: true });
    textRef.current?.select();
  }, [editingId]);

  const finishEditing = () => {
    store.finishTextEditing();
    canvasRef.current?.focus({ preventScroll: true });
  };

  const acceptsImages = (event: DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.items).some((item) => item.kind === 'file' && (item.type.startsWith('image/') || !item.type));

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingImage(false);
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const point = store.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    store.finishTextEditing();
    void insertImages(files, point).catch(() => store.toast('Não foi possível inserir a imagem'));
    canvasRef.current?.focus({ preventScroll: true });
  };

  let textStyle: CSSProperties | undefined;
  if (textNode?.type === 'TEXT') {
    const matrix = worldMatrix(state.doc, textNode.id);
    const { zoom, x, y } = state.camera;
    const fill = textNode.fills.find((paint) => paint.visible && paint.type === 'SOLID');
    textStyle = {
      position: 'absolute',
      left: 0,
      top: 0,
      transformOrigin: '0 0',
      transform: `matrix(${matrix[0] * zoom},${matrix[1] * zoom},${matrix[2] * zoom},${matrix[3] * zoom},${matrix[4] * zoom + x},${matrix[5] * zoom + y})`,
      width: Math.max(1, textNode.width),
      height: Math.max(textNode.height, lineHeightPx(textNode)),
      padding: 0,
      margin: 0,
      border: 0,
      borderRadius: 0,
      outline: 'none',
      boxSizing: 'border-box',
      resize: 'none',
      overflow: 'hidden',
      background: 'transparent',
      color: fill?.type === 'SOLID' ? rgba(fill.color, fill.opacity) : 'transparent',
      caretColor: '#0D99FF',
      fontFamily: `"${textNode.fontFamily ?? 'Inter'}", Inter, sans-serif`,
      fontSize: textNode.fontSize ?? 12,
      fontWeight: textNode.fontWeight ?? 400,
      lineHeight: `${lineHeightPx(textNode)}px`,
      letterSpacing: textNode.letterSpacing ?? 0,
      textAlign: textNode.textAlign === 'CENTER' ? 'center' : textNode.textAlign === 'RIGHT' ? 'right' : 'left',
      whiteSpace: textNode.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'pre' : 'pre-wrap',
      overflowWrap: 'normal',
      opacity: textNode.opacity,
      zIndex: 2,
    };
  }

  return (
    <div
      ref={surfaceRef}
      className={`canvas-view ${className}`.trim()}
      style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, minHeight: 0, overflow: 'hidden' }}
      onDragOver={(event) => {
        if (!acceptsImages(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDraggingImage(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingImage(false);
      }}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        className="editor-canvas"
        tabIndex={0}
        aria-label="Área de desenho. Use as ferramentas para criar e editar objetos."
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', outline: 'none', touchAction: 'none' }}
      />
      {textNode?.type === 'TEXT' && (
        <textarea
          key={textNode.id}
          ref={textRef}
          className="canvas-text-editor"
          aria-label="Editar texto"
          style={textStyle}
          spellCheck={false}
          wrap={textNode.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'off' : 'soft'}
          value={textNode.text ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value;
            store.update((s) => {
              const node = s.doc.nodes[textNode.id];
              if (!node) return;
              node.text = value;
              fitTextBox(node);
            });
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
              event.preventDefault();
              finishEditing();
            }
          }}
          onBlur={() => {
            if (store.state.editingTextId === textNode.id) store.finishTextEditing();
          }}
        />
      )}
      {draggingImage && (
        <div className="canvas-drop-hint" style={{ position: 'absolute', inset: 12, border: '2px solid #0D99FF', borderRadius: 8, background: 'rgba(13, 153, 255, 0.06)', display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 3 }}>
          <span style={{ background: '#0D99FF', color: '#FFFFFF', borderRadius: 6, padding: '10px 16px', fontSize: 13 }}>Solte para inserir a imagem</span>
        </div>
      )}
    </div>
  );
}

export default CanvasView;
