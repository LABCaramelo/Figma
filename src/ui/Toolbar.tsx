import { type ComponentType, useState } from 'react';
import * as A from '../actions';
import { commands, item, shortcutOf, type MenuEntry } from '../commands';
import type { Tool } from '../model/types';
import { store, useEditor } from '../store/store';
import * as I from './icons';
import { MenuPopup } from './Menu';

type Glyph = ComponentType<{ size?: number }>;
const SHAPES: { tool: Tool; command: string; icon: Glyph }[] = [
  { tool: 'RECTANGLE', command: 'tool.rectangle', icon: I.IconRect },
  { tool: 'ELLIPSE', command: 'tool.ellipse', icon: I.IconEllipse },
  { tool: 'LINE', command: 'tool.line', icon: I.IconLine },
  { tool: 'ARROW', command: 'tool.arrow', icon: I.IconArrow },
  { tool: 'POLYGON', command: 'tool.polygon', icon: I.IconPolygon },
  { tool: 'STAR', command: 'tool.star', icon: I.IconStar },
];

export function Toolbar() {
  const s = useEditor();
  const [lastShape, setLastShape] = useState<Tool>('RECTANGLE');
  const [popup, setPopup] = useState<{ x: number; y: number; flipY: number; items: MenuEntry[] } | null>(null);
  const shape = SHAPES.find((entry) => entry.tool === s.tool) ?? SHAPES.find((entry) => entry.tool === lastShape)!;
  const ShapeIcon = shape.icon;
  const open = (button: HTMLButtonElement, items: MenuEntry[]) => {
    const rect = button.getBoundingClientRect();
    setPopup(popup ? null : { x: rect.left - 8, y: rect.bottom + 8, flipY: rect.top - 8, items });
  };
  const button = (command: string, Icon: Glyph) => {
    const cmd = commands[command];
    const shortcut = shortcutOf(command);
    return (
      <button
        className={'tool-button' + (cmd.checked?.() ? ' active' : '')}
        aria-label={cmd.label}
        aria-pressed={cmd.checked?.()}
        title={cmd.label + (shortcut ? ' (' + shortcut + ')' : '')}
        disabled={cmd.enabled ? !cmd.enabled() : false}
        onClick={() => {
          setPopup(null);
          cmd.run();
        }}
      >
        <Icon size={24} />
      </button>
    );
  };

  const selectedNodes = s.selection.map((id) => s.doc.nodes[id]).filter(Boolean);
  const canBoolean = selectedNodes.length >= 2 || (selectedNodes.length === 1 && selectedNodes[0].type === 'BOOLEAN_OPERATION');
  const canComponent = selectedNodes.length >= 1 && !(selectedNodes.length === 1 && selectedNodes[0].type === 'COMPONENT');

  const booleanMenuItems: MenuEntry[] = [
    {
      kind: 'item',
      label: 'Unir seleção',
      shortcut: 'Ctrl+Alt+U',
      icon: <I.IconUnion size={18} />,
      run: () => A.createBooleanOperation('UNION'),
    },
    {
      kind: 'item',
      label: 'Subtrair seleção',
      icon: <I.IconSubtract size={18} />,
      run: () => A.createBooleanOperation('SUBTRACT'),
    },
    {
      kind: 'item',
      label: 'Interseção da seleção',
      icon: <I.IconIntersect size={18} />,
      run: () => A.createBooleanOperation('INTERSECT'),
    },
    {
      kind: 'item',
      label: 'Excluir seleção',
      icon: <I.IconExclude size={18} />,
      run: () => A.createBooleanOperation('EXCLUDE'),
    },
    {
      kind: 'separator',
    },
    {
      kind: 'item',
      label: 'Achatar seleção',
      shortcut: 'Ctrl+E',
      icon: <I.IconVector size={18} />,
      run: () => A.flattenSelection(),
    },
  ];

  return (
    <>
      <div className="toolbar" role="toolbar" aria-label="Ferramentas de desenho">
        <div className="toolbar-group">
          {button('tool.move', I.IconMove)}
          {button('tool.hand', I.IconHand)}
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          {button('tool.frame', I.IconFrame)}
          <div className="toolbar-shape-group">
            <button
              className={'tool-button' + (SHAPES.some((entry) => entry.tool === s.tool) ? ' active' : '')}
              aria-label={commands[shape.command].label}
              aria-pressed={SHAPES.some((entry) => entry.tool === s.tool)}
              title={commands[shape.command].label + (shortcutOf(shape.command) ? ' (' + shortcutOf(shape.command) + ')' : '')}
              onClick={() => {
                setPopup(null);
                store.setTool(shape.tool);
              }}
            >
              <ShapeIcon size={24} />
            </button>
            <button
              className="tool-dropdown"
              data-menu-anchor=""
              aria-label="Mais formas"
              aria-haspopup="menu"
              title="Mais formas"
              onClick={(event) =>
                open(
                  event.currentTarget,
                  SHAPES.map((entry) => ({
                    ...item(entry.command),
                    icon: <entry.icon size={20} />,
                    run: () => {
                      setLastShape(entry.tool);
                      store.setTool(entry.tool);
                    },
                  })),
                )
              }
            >
              <I.IconChevronDown size={12} />
            </button>
          </div>
          {button('tool.pencil', I.IconPencil)}
          {button('tool.text', I.IconText)}
          {button('tool.image', I.IconImage)}
        </div>

        {(canComponent || canBoolean) && (
          <>
            <div className="toolbar-divider" />
            <div className="toolbar-group">
              {canComponent && (
                <button
                  className="tool-button"
                  aria-label="Criar componente (Ctrl+Alt+K)"
                  title="Criar componente (Ctrl+Alt+K)"
                  onClick={() => A.createComponentFromSelection()}
                  style={{ color: '#9747FF' }}
                >
                  <I.IconComponent size={22} />
                </button>
              )}
              {canBoolean && (
                <div className="toolbar-shape-group">
                  <button
                    className="tool-button"
                    aria-label="Unir seleção (Ctrl+Alt+U)"
                    title="Unir seleção (Ctrl+Alt+U)"
                    onClick={() => A.createBooleanOperation('UNION')}
                  >
                    <I.IconUnion size={22} />
                  </button>
                  <button
                    className="tool-dropdown"
                    data-menu-anchor=""
                    aria-label="Operações booleanas"
                    aria-haspopup="menu"
                    title="Operações booleanas"
                    onClick={(event) => open(event.currentTarget, booleanMenuItems)}
                  >
                    <I.IconChevronDown size={12} />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {popup && <MenuPopup {...popup} minWidth={220} onClose={() => setPopup(null)} />}
    </>
  );
}
