import type { DocumentData } from '../model/types';

const cache = new Map<string, HTMLImageElement>();
let onLoad: (() => void) | null = null;

export function setImageLoadListener(fn: (() => void) | null) {
  onLoad = fn;
}

function element(doc: DocumentData, id: string): HTMLImageElement | null {
  const src = doc.images[id];
  if (!src) return null;
  let img = cache.get(id);
  if (!img || img.src !== src) {
    img = new Image();
    img.onload = () => onLoad?.();
    img.src = src;
    cache.set(id, img);
  }
  return img;
}

/** Imagem pronta para desenhar, ou null enquanto carrega. */
export function getImage(doc: DocumentData, id: string): HTMLImageElement | null {
  const img = element(doc, id);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

export async function ensureImagesLoaded(doc: DocumentData, ids: string[]) {
  await Promise.all(
    ids.map((id) => {
      const img = element(doc, id);
      return img ? img.decode().catch(() => undefined) : undefined;
    }),
  );
}

export function readFileAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 100, height: img.naturalHeight || 100 });
    img.onerror = () => resolve({ width: 100, height: 100 });
    img.src = src;
  });
}
