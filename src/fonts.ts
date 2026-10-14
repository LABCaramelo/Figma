import type { DocumentData } from './model/types';

export interface FontDef {
  family: string;
  axis: string | null; // parâmetro de pesos da API do Google Fonts
  weights: number[];
}

const range = (a: number, b: number) => [100, 200, 300, 400, 500, 600, 700, 800, 900].filter((w) => w >= a && w <= b);

export const FONTS: FontDef[] = [
  { family: 'Inter', axis: 'wght@100..900', weights: range(100, 900) },
  { family: 'Roboto', axis: 'wght@100..900', weights: range(100, 900) },
  { family: 'Open Sans', axis: 'wght@300..800', weights: range(300, 800) },
  { family: 'Montserrat', axis: 'wght@100..900', weights: range(100, 900) },
  { family: 'Poppins', axis: 'wght@100;200;300;400;500;600;700;800;900', weights: range(100, 900) },
  { family: 'Lato', axis: 'wght@100;300;400;700;900', weights: [100, 300, 400, 700, 900] },
  { family: 'Raleway', axis: 'wght@100..900', weights: range(100, 900) },
  { family: 'Nunito', axis: 'wght@200..900', weights: range(200, 900) },
  { family: 'DM Sans', axis: 'wght@100..900', weights: range(100, 900) },
  { family: 'Space Grotesk', axis: 'wght@300..700', weights: range(300, 700) },
  { family: 'Oswald', axis: 'wght@200..700', weights: range(200, 700) },
  { family: 'Playfair Display', axis: 'wght@400..900', weights: range(400, 900) },
  { family: 'Source Code Pro', axis: 'wght@200..900', weights: range(200, 900) },
  { family: 'Bebas Neue', axis: null, weights: [400] },
];

export const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

export const fontDef = (family: string) => FONTS.find((f) => f.family === family);

const links = new Map<string, Promise<void>>();

export function ensureFont(family: string): Promise<void> {
  // Inter is bundled for the interface and canvas; avoid a second remote face.
  if (family === 'Inter') return Promise.resolve();
  const existing = links.get(family);
  if (existing) return existing;
  const def = fontDef(family);
  if (!def) return Promise.resolve();
  const p = new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}${
      def.axis ? ':' + def.axis : ''
    }&display=swap`;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
  links.set(family, p);
  return p;
}

export async function ensureFontFace(family: string, weight: number) {
  await ensureFont(family);
  try {
    await document.fonts.load(`${weight} 16px "${family}"`);
  } catch {
    /* fonte indisponível: o canvas usa a alternativa */
  }
}

export function ensureDocFonts(doc: DocumentData) {
  const seen = new Set<string>();
  for (const n of Object.values(doc.nodes)) {
    if (n.type !== 'TEXT') continue;
    const key = `${n.fontFamily}|${n.fontWeight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    void ensureFontFace(n.fontFamily ?? 'Inter', n.fontWeight ?? 400);
  }
}
