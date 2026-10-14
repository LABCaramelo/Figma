import type { DocumentData, NodeType, Page, SceneNode, SolidPaint } from './types';

let seq = 0;
export function uid(): string {
  seq = (seq + 1) % 46656;
  return (
    Date.now().toString(36).slice(-4) +
    Math.random().toString(36).slice(2, 7) +
    seq.toString(36).padStart(3, '0')
  );
}

export const TYPE_LABELS: Record<NodeType, string> = {
  FRAME: 'Frame',
  GROUP: 'Grupo',
  COMPONENT: 'Componente',
  INSTANCE: 'Instância',
  BOOLEAN_OPERATION: 'Grupo booleano',
  RECTANGLE: 'Retângulo',
  ELLIPSE: 'Elipse',
  POLYGON: 'Polígono',
  STAR: 'Estrela',
  LINE: 'Linha',
  TEXT: 'Texto',
  VECTOR: 'Vetor',
};

export const solid = (color: string, opacity = 1): SolidPaint => ({
  type: 'SOLID',
  color,
  opacity,
  visible: true,
});

export const DEFAULT_SHAPE_FILL = '#D9D9D9';

export function createNode(type: NodeType, init: Partial<SceneNode> = {}): SceneNode {
  const base: SceneNode = {
    id: uid(),
    type,
    name: TYPE_LABELS[type],
    parentId: '',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    flipX: false,
    flipY: false,
    visible: true,
    locked: false,
    opacity: 1,
    fills: [],
    strokes: [],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    effects: [],
    cornerRadius: 0,
    constrainProportions: false,
  };
  switch (type) {
    case 'FRAME':
    case 'COMPONENT':
      Object.assign(base, { fills: [solid('#FFFFFF')], children: [], clipsContent: true });
      break;
    case 'GROUP':
      Object.assign(base, { children: [] });
      break;
    case 'INSTANCE':
      Object.assign(base, { children: [] });
      break;
    case 'BOOLEAN_OPERATION':
      Object.assign(base, { fills: [solid(DEFAULT_SHAPE_FILL)], children: [], booleanOperation: 'UNION' });
      break;
    case 'RECTANGLE':
    case 'ELLIPSE':
      base.fills = [solid(DEFAULT_SHAPE_FILL)];
      break;
    case 'POLYGON':
      Object.assign(base, { fills: [solid(DEFAULT_SHAPE_FILL)], pointCount: 3 });
      break;
    case 'STAR':
      Object.assign(base, { fills: [solid(DEFAULT_SHAPE_FILL)], pointCount: 5, innerRadius: 0.38 });
      break;
    case 'LINE':
      Object.assign(base, { strokes: [solid('#000000')], strokeAlign: 'CENTER', height: 0, arrowEnd: false });
      break;
    case 'TEXT':
      Object.assign(base, {
        autoName: true,
        fills: [solid('#000000')],
        text: '',
        fontFamily: 'Inter',
        fontSize: 12,
        fontWeight: 400,
        lineHeight: null,
        letterSpacing: 0,
        textAlign: 'LEFT',
        textAutoResize: 'WIDTH_AND_HEIGHT',
      });
      break;
    case 'VECTOR':
      Object.assign(base, {
        strokes: [solid('#000000')],
        strokeWeight: 2,
        strokeAlign: 'CENTER',
        points: [],
        closed: false,
      });
      break;
  }
  return { ...base, ...init, id: init.id ?? base.id };
}

export const createPage = (name: string): Page => ({ id: uid(), name, children: [], background: null });

export function createEmptyDocument(name = 'Sem título'): DocumentData {
  return { version: 1, name, pages: [createPage('Página 1')], nodes: {}, images: {} };
}
