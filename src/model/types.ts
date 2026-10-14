export type NodeType =
  | 'FRAME'
  | 'GROUP'
  | 'COMPONENT'
  | 'INSTANCE'
  | 'BOOLEAN_OPERATION'
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'POLYGON'
  | 'STAR'
  | 'LINE'
  | 'TEXT'
  | 'VECTOR';

export type BooleanOperationType = 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'EXCLUDE';

export interface SolidPaint {
  type: 'SOLID';
  color: string; // #RRGGBB
  opacity: number; // 0..1
  visible: boolean;
}

export type ScaleMode = 'FILL' | 'FIT' | 'STRETCH';

export interface ImagePaint {
  type: 'IMAGE';
  imageId: string;
  scaleMode: ScaleMode;
  opacity: number;
  visible: boolean;
}

export interface ColorStop {
  position: number; // 0..1
  color: string; // #RRGGBB
  opacity: number; // 0..1
}

export interface GradientPaint {
  type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL';
  stops: ColorStop[];
  angle?: number; // graus (90 = vertical cima para baixo, 0 = horizontal)
  opacity: number;
  visible: boolean;
}

export type Paint = SolidPaint | ImagePaint | GradientPaint;

export type EffectType = 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR';

export interface Effect {
  type: EffectType;
  visible: boolean;
  color: string;
  opacity: number;
  x: number;
  y: number;
  radius: number;
  spread: number;
}

export type StrokeAlign = 'CENTER' | 'INSIDE' | 'OUTSIDE';
export type TextAlign = 'LEFT' | 'CENTER' | 'RIGHT';
export type TextAutoResize = 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'NONE';

export type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL';
export type LayoutAlign = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
export type LayoutSizing = 'FIXED' | 'HUG' | 'FILL';

export interface VectorPoint {
  x: number; // normalizado 0..1 em relação à largura
  y: number; // normalizado 0..1 em relação à altura
}

/** Segmentos exatos; coordenadas e raios normalizados pela caixa do vetor. */
export type VectorPathCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'A'; rx: number; ry: number; largeArc: boolean; sweep: boolean; x: number; y: number };

/**
 * Nó da cena. x/y são o canto superior esquerdo da caixa sem rotação, nas
 * coordenadas do pai. A rotação (graus, anti-horária como no Figma) e os
 * espelhamentos são aplicados em torno do centro da caixa.
 */
export interface SceneNode {
  id: string;
  type: NodeType;
  name: string;
  autoName?: boolean;
  parentId: string; // id de página ou de nó
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  visible: boolean;
  locked: boolean;
  opacity: number;
  fills: Paint[];
  strokes: Paint[];
  strokeWeight: number;
  strokeAlign: StrokeAlign;
  effects: Effect[];
  cornerRadius: number;
  constrainProportions: boolean;
  // contêineres e auto layout
  children?: string[];
  clipsContent?: boolean;
  layoutMode?: LayoutMode;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: LayoutAlign;
  counterAxisAlignItems?: LayoutAlign;
  layoutGrow?: number;
  // operações booleanas
  booleanOperation?: BooleanOperationType;
  // componentes e instâncias
  componentId?: string; // id do COMPONENT mestre para nós INSTANCE
  // polígono / estrela
  pointCount?: number;
  innerRadius?: number;
  // linha
  arrowEnd?: boolean;
  // vetor (lápis)
  points?: VectorPoint[];
  closed?: boolean;
  vectorPath?: VectorPathCommand[];
  vectorStrokeCap?: 'butt' | 'round' | 'square';
  vectorStrokeJoin?: 'miter' | 'round' | 'bevel';
  // texto
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number | null; // px, null = automático
  letterSpacing?: number; // px
  textAlign?: TextAlign;
  textAutoResize?: TextAutoResize;
}

export interface Page {
  id: string;
  name: string;
  children: string[]; // ordem de pintura: o último fica por cima
  background: string | null; // null = cor padrão do tema
}

export interface DocumentData {
  version: 1;
  name: string;
  pages: Page[];
  nodes: Record<string, SceneNode>;
  images: Record<string, string>; // id -> data URL
}

export type Tool =
  | 'MOVE'
  | 'HAND'
  | 'FRAME'
  | 'RECTANGLE'
  | 'ELLIPSE'
  | 'POLYGON'
  | 'STAR'
  | 'LINE'
  | 'ARROW'
  | 'TEXT'
  | 'PENCIL';
