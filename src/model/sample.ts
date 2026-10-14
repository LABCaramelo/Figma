import { fitTextBox } from '../canvas/shapes';
import { createEmptyDocument, createNode, createPage, solid } from './defaults';
import { insertNode } from './document';
import type { DocumentData, SceneNode } from './types';

const textName = (t: string) => t.trim().replace(/\s+/g, ' ').slice(0, 60);

function text(init: Partial<SceneNode>): SceneNode {
  const n = createNode('TEXT', { ...init, name: textName(init.text ?? '') });
  fitTextBox(n);
  return n;
}

/** Documento de boas-vindas mostrado na primeira abertura. */
export function createSampleDocument(): DocumentData {
  const doc = createEmptyDocument('Boas-vindas à Prancheta');
  const page = doc.pages[0];
  const add = (n: SceneNode, parentId: string) => {
    insertNode(doc, n, parentId);
    return n;
  };

  // ---------- frame "Boas-vindas" ----------
  const welcome = add(createNode('FRAME', { name: 'Boas-vindas', x: 0, y: 0, width: 960, height: 600, cornerRadius: 0 }), page.id);
  add(text({ text: 'Bem-vindo à Prancheta', x: 64, y: 72, fontSize: 44, fontWeight: 700, letterSpacing: -0.8 }), welcome.id);
  add(
    text({
      text: 'Um editor de design no estilo do Figma, escrito do zero. Desenhe formas, edite textos, organize camadas e exporte em PNG, JPG ou SVG.',
      x: 64,
      y: 140,
      width: 470,
      textAutoResize: 'HEIGHT',
      fontSize: 18,
      lineHeight: 28,
      fills: [solid('#444444')],
    }),
    welcome.id,
  );
  add(text({ text: 'PARA COMEÇAR', x: 64, y: 268, fontSize: 12, fontWeight: 600, letterSpacing: 1, fills: [solid('#0D99FF')] }), welcome.id);
  add(
    text({
      text: [
        'V  Mover e selecionar   ·   F  Frame',
        'R  Retângulo   ·   O  Elipse   ·   L  Linha',
        'T  Texto   ·   Shift+P  Lápis',
        'Espaço + arrastar: mover a tela',
        'Ctrl + roda do mouse: zoom',
        'Ctrl+Shift+?  mostra todos os atalhos',
      ].join('\n'),
      x: 64,
      y: 296,
      fontSize: 15,
      lineHeight: 26,
      fills: [solid('#1E1E1E')],
    }),
    welcome.id,
  );
  add(createNode('ELLIPSE', { name: 'Círculo', x: 660, y: 70, width: 180, height: 180, fills: [solid('#0D99FF')] }), welcome.id);
  add(
    createNode('RECTANGLE', {
      name: 'Cartão amarelo',
      x: 590,
      y: 300,
      width: 200,
      height: 140,
      rotation: 10,
      cornerRadius: 24,
      fills: [solid('#FFC700')],
    }),
    welcome.id,
  );
  add(createNode('STAR', { name: 'Estrela', x: 780, y: 250, width: 140, height: 140, fills: [solid('#F24822')] }), welcome.id);
  add(createNode('POLYGON', { name: 'Triângulo', x: 720, y: 440, width: 120, height: 104, fills: [solid('#14AE5C')] }), welcome.id);

  // ---------- frame "iPhone 16" ----------
  const phone = add(createNode('FRAME', { name: 'iPhone 16', x: 1040, y: 0, width: 393, height: 852, fills: [solid('#F5F5F5')] }), page.id);
  add(text({ text: '9:41', x: 32, y: 16, fontSize: 15, fontWeight: 600 }), phone.id);
  add(text({ text: 'Olá!', x: 24, y: 80, fontSize: 32, fontWeight: 700 }), phone.id);
  add(text({ text: 'Seu primeiro protótipo começa aqui.', x: 24, y: 126, fontSize: 16, fills: [solid('#757575')] }), phone.id);
  add(
    createNode('RECTANGLE', {
      name: 'Card',
      x: 24,
      y: 180,
      width: 345,
      height: 200,
      cornerRadius: 20,
      fills: [solid('#FFFFFF')],
      effects: [{ type: 'DROP_SHADOW', visible: true, color: '#000000', opacity: 0.08, x: 0, y: 4, radius: 16, spread: 0 }],
    }),
    phone.id,
  );
  add(text({ text: 'Projeto novo', x: 48, y: 204, fontSize: 18, fontWeight: 600 }), phone.id);
  add(
    text({
      text: 'Arraste, redimensione e gire os objetos. Dê dois cliques num texto para editá-lo.',
      x: 48,
      y: 236,
      width: 297,
      textAutoResize: 'HEIGHT',
      fontSize: 15,
      lineHeight: 22,
      fills: [solid('#5C5C5C')],
    }),
    phone.id,
  );

  const button = add(createNode('GROUP', { name: 'Botão', x: 24, y: 760, width: 345, height: 52 }), phone.id);
  add(createNode('RECTANGLE', { name: 'Fundo', x: 0, y: 0, width: 345, height: 52, cornerRadius: 12, fills: [solid('#0D99FF')] }), button.id);
  const label = text({
    text: 'Começar',
    width: 345,
    textAutoResize: 'HEIGHT',
    textAlign: 'CENTER',
    fontSize: 16,
    fontWeight: 600,
    fills: [solid('#FFFFFF')],
  });
  label.y = (52 - label.height) / 2;
  add(label, button.id);

  doc.pages.push(createPage('Rascunhos'));
  return doc;
}
