import { type ReactNode, useEffect, useMemo, useState } from 'react';
import * as A from '../actions';
import { rgba } from '../canvas/color';
import { fitTextBox } from '../canvas/shapes';
import { item, sep, type MenuEntry } from '../commands';
import { FONTS, WEIGHT_NAMES, ensureFontFace, fontDef } from '../fonts';
import { type ExportFormat, type ExportSetting, exportNodes, exportPrefs } from '../io/export';
import { TYPE_LABELS, solid } from '../model/defaults';
import { applyAutoLayout, getPage } from '../model/document';
import type { BooleanOperationType, Effect, EffectType, Paint, SceneNode, StrokeAlign, TextAutoResize } from '../model/types';
import { store, useEditor } from '../store/store';
import { PaintPopover } from './controls/ColorPicker';
import { NumberField } from './controls/NumberField';
import * as I from './icons';
import { MenuPopup } from './Menu';
import { NodeIcon } from './LeftPanel';

// ---------- utilitários ----------

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Valor comum a todos os nós; `mixed` quando diferem. */
function common<T>(nodes: SceneNode[], get: (n: SceneNode) => T): { mixed: boolean; value: T | null } {
  if (!nodes.length) return { mixed: false, value: null };
  const first = get(nodes[0]);
  return nodes.every((n) => same(get(n), first)) ? { mixed: false, value: first } : { mixed: true, value: null };
}

const num = (nodes: SceneNode[], get: (n: SceneNode) => number) => common(nodes, get).value;

function Section({ title, actions, children, className }: { title: string; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={'rp-section' + (className ? ' ' + className : '')}>
      <div className="rp-section-head">
        <span className="rp-section-title">{title}</span>
        <span className="rp-section-actions">{actions}</span>
      </div>
      {children}
    </section>
  );
}

function IconButton({
  title,
  onClick,
  active,
  disabled,
  children,
  anchor,
}: {
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  anchor?: boolean;
}) {
  return (
    <button
      className={'icon-btn' + (active ? ' active' : '')}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-menu-anchor={anchor ? '' : undefined}
    >
      {children}
    </button>
  );
}

function docColors(): string[] {
  const out = new Set<string>();
  for (const n of Object.values(store.state.doc.nodes)) {
    for (const p of [...n.fills, ...n.strokes]) if (p.type === 'SOLID') out.add(p.color.toUpperCase());
    for (const e of n.effects) out.add(e.color.toUpperCase());
    if (out.size >= 24) break;
  }
  return [...out].slice(0, 24);
}

// ---------- painel ----------

export function RightPanel() {
  const s = useEditor();
  const nodes = s.selection.map((id) => s.doc.nodes[id]).filter(Boolean);
  return (
    <aside className="panel right-panel" aria-label="Propriedades">
      <header className="rp-header">
        <div className="rp-tabs">
          <span className="rp-tab active">Design</span>
        </div>
        <ZoomMenu zoom={s.camera.zoom} />
      </header>
      <div className="rp-body">
        {nodes.length ? (
          <SelectionPanels key={nodes.map((n) => n.id).join(',')} nodes={nodes} />
        ) : s.tool === 'FRAME' ? (
          <FramePresets />
        ) : (
          <PageSection />
        )}
      </div>
    </aside>
  );
}

function ZoomMenu({ zoom }: { zoom: number }) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const items: MenuEntry[] = [
    item('view.zoomIn'),
    item('view.zoomOut'),
    item('view.zoomFit'),
    item('view.zoomSelection'),
    sep,
    { kind: 'item', label: 'Zoom para 50%', run: () => store.zoomTo(0.5) },
    item('view.zoom100'),
    { kind: 'item', label: 'Zoom para 200%', run: () => store.zoomTo(2) },
  ];
  return (
    <>
      <button
        className={'zoom-btn' + (menu ? ' open' : '')}
        data-menu-anchor=""
        title="Opções de zoom"
        onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
      >
        {Math.round(zoom * 100)}%
        <I.IconChevronDown size={16} />
      </button>
      {menu && <MenuPopup x={menu.right - 220} y={menu.bottom + 4} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}

// ---------- sem seleção ----------

function PageSection() {
  const s = useEditor();
  const page = getPage(s.doc, s.pageId);
  const [pop, setPop] = useState<DOMRect | null>(null);
  if (!page) return null;
  const fallback = s.ui.theme === 'dark' ? '#1E1E1E' : '#F5F5F5';
  const color = page.background ?? fallback;
  const set = (c: string | null, live = false) => A.commit(() => (page.background = c), !live);
  return (
    <>
      <Section title="Página">
        <div className="rp-row">
          <button
            className="swatch"
            data-menu-anchor=""
            title="Cor de fundo"
            style={{ background: color }}
            onClick={(e) => setPop(pop ? null : e.currentTarget.getBoundingClientRect())}
          />
          <HexInput value={color} onCommit={(c) => set(c)} />
          {page.background && (
            <IconButton title="Usar a cor padrão do tema" onClick={() => set(null)}>
              <I.IconClose size={24} />
            </IconButton>
          )}
        </div>
      </Section>
      <Section title="Dica">
        <p className="rp-hint">
          Selecione uma camada para editar as propriedades. Com a ferramenta Frame (F) ativa, este painel mostra tamanhos prontos de
          telas.
        </p>
      </Section>
      {pop && (
        <PaintPopover
          anchor={pop}
          paint={solid(color)}
          allowImage={false}
          title="Fundo da página"
          docColors={docColors()}
          onClose={() => setPop(null)}
          onChange={(p, live) => p.type === 'SOLID' && set(p.color, live)}
        />
      )}
    </>
  );
}

function FramePresets() {
  const [open, setOpen] = useState<Record<string, boolean>>({ Celular: true, Desktop: true });
  return (
    <div className="presets">
      {A.FRAME_PRESETS.map((g) => (
        <div key={g.group} className="preset-group">
          <button className="preset-head" onClick={() => setOpen((o) => ({ ...o, [g.group]: !o[g.group] }))}>
            {open[g.group] ? <I.IconCaretDown size={16} /> : <I.IconCaretRight size={16} />}
            {g.group}
          </button>
          {open[g.group] &&
            g.items.map((p) => (
              <button key={p.name} className="preset-item" onClick={() => A.createFramePreset(p)}>
                <span>{p.name}</span>
                <span className="preset-size">
                  {p.w}×{p.h}
                </span>
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}

// ---------- com seleção ----------

function SelectionPanels({ nodes }: { nodes: SceneNode[] }) {
  const ids = nodes.map((n) => n.id);
  const doc = store.state.doc;
  const texts = A.textSelection().map((id) => doc.nodes[id]);
  return (
    <>
      <TypeHeader nodes={nodes} />
      {nodes.some((n) => n.type === 'INSTANCE') && <InstanceSection nodes={nodes.filter((n) => n.type === 'INSTANCE')} />}
      {nodes.some((n) => n.type === 'BOOLEAN_OPERATION') && <BooleanSection nodes={nodes.filter((n) => n.type === 'BOOLEAN_OPERATION')} />}
      <PositionSection nodes={nodes} ids={ids} />
      <LayoutSection nodes={nodes} ids={ids} />
      <AutoLayoutSection nodes={nodes} ids={ids} />
      <AppearanceSection nodes={nodes} ids={ids} />
      {texts.length > 0 && <TextSection nodes={texts} ids={texts.map((n) => n.id)} />}
      <PaintsSection kind="fills" nodes={nodes} ids={ids} />
      <PaintsSection kind="strokes" nodes={nodes} ids={ids} />
      <EffectsSection nodes={nodes} ids={ids} />
      <ExportSection nodes={nodes} />
    </>
  );
}

function InstanceSection({ nodes }: { nodes: SceneNode[] }) {
  const doc = store.state.doc;
  const single = nodes.length === 1 ? nodes[0] : null;
  const master = single?.componentId ? doc.nodes[single.componentId] : null;

  return (
    <Section title="Instância">
      <div className="rp-row spread" style={{ alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: '#9747FF', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <I.IconInstance size={16} />
          {master?.name ?? 'Componente mestre'}
        </span>
        {master && (
          <button
            className="btn secondary"
            style={{ fontSize: 11, padding: '2px 8px' }}
            title="Ir para o componente principal"
            onClick={() => A.goToComponent(master.id)}
          >
            Ir para mestre
          </button>
        )}
      </div>
      <div className="rp-row" style={{ gap: 6 }}>
        <button
          className="btn secondary"
          style={{ flex: 1, fontSize: 11 }}
          title="Separar instância (Ctrl+Alt+B)"
          onClick={() => single && A.detachInstance(single.id)}
        >
          Separar
        </button>
        <button
          className="btn secondary"
          style={{ flex: 1, fontSize: 11 }}
          title="Redefinir alterações da instância"
          onClick={() => single && A.resetInstanceOverrides(single.id)}
        >
          Redefinir
        </button>
      </div>
    </Section>
  );
}

function BooleanSection({ nodes }: { nodes: SceneNode[] }) {
  const single = nodes.length === 1 ? nodes[0] : null;
  const op = single?.booleanOperation ?? 'UNION';

  const setOp = (newOp: BooleanOperationType) => {
    A.editNodes(nodes.map((n) => n.id), (n) => {
      n.booleanOperation = newOp;
    });
  };

  return (
    <Section title="Operação Booleana">
      <div className="rp-row spread">
        <div className="btn-group">
          <IconButton title="União" active={op === 'UNION'} onClick={() => setOp('UNION')}>
            <I.IconUnion />
          </IconButton>
          <IconButton title="Subtração" active={op === 'SUBTRACT'} onClick={() => setOp('SUBTRACT')}>
            <I.IconSubtract />
          </IconButton>
          <IconButton title="Interseção" active={op === 'INTERSECT'} onClick={() => setOp('INTERSECT')}>
            <I.IconIntersect />
          </IconButton>
          <IconButton title="Exclusão" active={op === 'EXCLUDE'} onClick={() => setOp('EXCLUDE')}>
            <I.IconExclude />
          </IconButton>
        </div>
        <button
          className="btn secondary"
          style={{ fontSize: 11, padding: '2px 8px' }}
          title="Achatar em vetor (Ctrl+E)"
          onClick={() => A.flattenSelection()}
        >
          Achatar
        </button>
      </div>
    </Section>
  );
}

function TypeHeader({ nodes }: { nodes: SceneNode[] }) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const single = nodes.length === 1 ? nodes[0] : null;
  const isComponent = single?.type === 'COMPONENT';
  const isInstance = single?.type === 'INSTANCE';
  const label = single
    ? single.type === 'RECTANGLE' && single.fills.some((f) => f.type === 'IMAGE')
      ? 'Imagem'
      : isComponent
        ? 'Componente'
        : isInstance
          ? 'Instância'
          : single.type === 'BOOLEAN_OPERATION'
            ? 'Grupo booleano'
            : TYPE_LABELS[single.type]
    : `${nodes.length} camadas`;

  const presetItems: MenuEntry[] = A.FRAME_PRESETS.map((g) => ({
    kind: 'submenu',
    label: g.group,
    items: g.items.map((p) => ({
      kind: 'item',
      label: `${p.name}  ${p.w}×${p.h}`,
      run: () => A.editNodes([single!.id], (n, d) => A.setNodeSize(d, n, p.w, p.h)),
    })),
  }));
  return (
    <div className="rp-type" style={{ color: isComponent || isInstance ? '#9747FF' : undefined }}>
      {single?.type === 'FRAME' ? (
        <button className="rp-type-btn" data-menu-anchor="" onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}>
          <NodeIcon node={single} />
          <span>Frame</span>
          <I.IconChevronDown size={16} />
        </button>
      ) : (
        <span className="rp-type-label">
          {single && <NodeIcon node={single} />}
          {label}
        </span>
      )}
      {menu && <MenuPopup x={menu.left} y={menu.bottom + 4} items={presetItems} onClose={() => setMenu(null)} />}
    </div>
  );
}

function PositionSection({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const doc = store.state.doc;
  const xs = common(nodes, (n) => Math.round(A.getPanelXY(doc, n.id).x * 100) / 100);
  const ys = common(nodes, (n) => Math.round(A.getPanelXY(doc, n.id).y * 100) / 100);
  const rot = num(nodes, (n) => n.rotation);
  const many = A.selectedTop().length >= 3;
  const locked = nodes.every((n) => n.locked);
  return (
    <Section title="Posição">
      <div className="rp-row align-row">
        <div className="btn-group">
          <IconButton title="Alinhar à esquerda (Alt+A)" onClick={() => A.alignSelection('left')}>
            <I.IconAlignLeft />
          </IconButton>
          <IconButton title="Centralizar na horizontal (Alt+H)" onClick={() => A.alignSelection('hcenter')}>
            <I.IconAlignHCenter />
          </IconButton>
          <IconButton title="Alinhar à direita (Alt+D)" onClick={() => A.alignSelection('right')}>
            <I.IconAlignRight />
          </IconButton>
        </div>
        <div className="btn-group">
          <IconButton title="Alinhar ao topo (Alt+W)" onClick={() => A.alignSelection('top')}>
            <I.IconAlignTop />
          </IconButton>
          <IconButton title="Centralizar na vertical (Alt+V)" onClick={() => A.alignSelection('vcenter')}>
            <I.IconAlignVCenter />
          </IconButton>
          <IconButton title="Alinhar à base (Alt+S)" onClick={() => A.alignSelection('bottom')}>
            <I.IconAlignBottom />
          </IconButton>
        </div>
      </div>
      {many && (
        <div className="rp-row">
          <div className="btn-group">
            <IconButton title="Distribuir espaçamento horizontal (Alt+Shift+H)" onClick={() => A.distributeSelection('x')}>
              <I.IconDistH />
            </IconButton>
            <IconButton title="Distribuir espaçamento vertical (Alt+Shift+V)" onClick={() => A.distributeSelection('y')}>
              <I.IconDistV />
            </IconButton>
          </div>
        </div>
      )}
      <div className="rp-grid">
        <NumberField
          label="X"
          value={xs.value}
          disabled={locked}
          onChange={(v, live) => A.editNodes(ids, (n, d) => A.setPanelXY(d, n.id, v, null), !live)}
        />
        <NumberField
          label="Y"
          value={ys.value}
          disabled={locked}
          onChange={(v, live) => A.editNodes(ids, (n, d) => A.setPanelXY(d, n.id, null, v), !live)}
        />
      </div>
      <div className="rp-grid">
        <NumberField
          label={<I.IconRotate size={24} />}
          title="Rotação"
          value={rot}
          suffix="°"
          step={1}
          disabled={locked}
          onChange={(v, live) => A.editNodes(ids, (n) => (n.rotation = ((((v + 180) % 360) + 360) % 360) - 180), !live)}
        />
        <div className="btn-group">
          <IconButton title="Girar 90° à direita" onClick={() => A.rotateSelection(-90)}>
            <I.IconRotate90 />
          </IconButton>
          <IconButton title="Espelhar horizontalmente (Shift+H)" onClick={() => A.flipSelection('x')}>
            <I.IconFlipH />
          </IconButton>
          <IconButton title="Espelhar verticalmente (Shift+V)" onClick={() => A.flipSelection('y')}>
            <I.IconFlipV />
          </IconButton>
        </div>
      </div>
    </Section>
  );
}

function LayoutSection({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const w = num(nodes, (n) => n.width);
  const h = num(nodes, (n) => n.height);
  const linked = nodes.every((n) => n.constrainProportions);
  const frames = nodes.filter((n) => n.type === 'FRAME');
  const lineOnly = nodes.every((n) => n.type === 'LINE');
  const locked = nodes.every((n) => n.locked);
  return (
    <Section title="Dimensões">
      <div className="rp-grid with-trailing">
        <NumberField
          label="L"
          title="Largura"
          value={w}
          min={0.01}
          disabled={locked}
          onChange={(v, live) => A.editNodes(ids, (n, d) => A.setNodeSize(d, n, v, null), !live)}
        />
        <NumberField
          label="A"
          title="Altura"
          value={lineOnly ? 0 : h}
          min={0.01}
          disabled={lineOnly || locked}
          onChange={(v, live) => A.editNodes(ids, (n, d) => n.type !== 'LINE' && A.setNodeSize(d, n, null, v), !live)}
        />
        <IconButton
          title={linked ? 'Desvincular proporções' : 'Manter proporções'}
          active={linked}
          onClick={() => A.editNodes(ids, (n) => (n.constrainProportions = !linked))}
        >
          {linked ? <I.IconLink /> : <I.IconUnlink />}
        </IconButton>
      </div>
      {frames.length > 0 && (
        <label className="rp-check">
          <input
            type="checkbox"
            checked={frames.every((f) => f.clipsContent)}
            onChange={(e) => A.editNodes(frames.map((f) => f.id), (n) => (n.clipsContent = e.target.checked))}
          />
          Recortar conteúdo
        </label>
      )}
    </Section>
  );
}

function AutoLayoutSection({ nodes }: { nodes: SceneNode[]; ids: string[] }) {
  const frames = nodes.filter((n) => n.type === 'FRAME');
  const hasAL = frames.length > 0 && frames.some((f) => f.layoutMode && f.layoutMode !== 'NONE');

  const setAL = (patch: Partial<SceneNode>) => {
    A.editNodes(frames.map((f) => f.id), (n, d) => {
      Object.assign(n, patch);
      applyAutoLayout(d, n.id);
    });
  };

  if (!hasAL) {
    return (
      <Section
        title="Auto Layout"
        actions={
          <IconButton title="Adicionar auto layout (Shift+A)" onClick={A.autoLayoutSelection}>
            <I.IconPlus />
          </IconButton>
        }
      >
        <p className="rp-hint">Clique em + ou aperte Shift+A para organizar os itens em fluxo automático.</p>
      </Section>
    );
  }

  const first = frames.find((f) => f.layoutMode && f.layoutMode !== 'NONE')!;
  const mode = first.layoutMode ?? 'HORIZONTAL';
  const gap = first.itemSpacing ?? 10;
  const padT = first.paddingTop ?? 10;
  const padR = first.paddingRight ?? 10;
  const padB = first.paddingBottom ?? 10;
  const padL = first.paddingLeft ?? 10;
  const alignPrimary = first.primaryAxisAlignItems ?? 'MIN';
  const alignCounter = first.counterAxisAlignItems ?? 'MIN';

  return (
    <Section
      title="Auto Layout"
      actions={
        <IconButton title="Remover auto layout" onClick={() => setAL({ layoutMode: 'NONE' })}>
          <I.IconMinus />
        </IconButton>
      }
    >
      <div className="rp-row spread">
        <div className="btn-group">
          <IconButton
            title="Direção horizontal"
            active={mode === 'HORIZONTAL'}
            onClick={() => setAL({ layoutMode: 'HORIZONTAL' })}
          >
            <I.IconAutoLayoutH size={20} />
          </IconButton>
          <IconButton
            title="Direção vertical"
            active={mode === 'VERTICAL'}
            onClick={() => setAL({ layoutMode: 'VERTICAL' })}
          >
            <I.IconAutoLayoutV size={20} />
          </IconButton>
        </div>
        <NumberField
          label="Esp."
          title="Espaçamento entre itens"
          value={gap}
          min={0}
          onChange={(v) => setAL({ itemSpacing: v })}
        />
      </div>
      <div className="rp-grid">
        <NumberField
          label="Pad H"
          title="Preenchimento horizontal"
          value={padL}
          min={0}
          onChange={(v) => setAL({ paddingLeft: v, paddingRight: v })}
        />
        <NumberField
          label="Pad V"
          title="Preenchimento vertical"
          value={padT}
          min={0}
          onChange={(v) => setAL({ paddingTop: v, paddingBottom: v })}
        />
      </div>
      <div className="rp-row">
        <select
          className="select grow"
          value={`${alignPrimary}:${alignCounter}`}
          onChange={(e) => {
            const [p, c] = e.target.value.split(':') as [any, any];
            setAL({ primaryAxisAlignItems: p, counterAxisAlignItems: c });
          }}
        >
          <option value="MIN:MIN">Alinhar no início</option>
          <option value="CENTER:CENTER">Alinhar ao centro</option>
          <option value="MAX:MAX">Alinhar no fim</option>
          <option value="SPACE_BETWEEN:CENTER">Espaço entre itens</option>
        </select>
      </div>
    </Section>
  );
}


function AppearanceSection({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const opacity = num(nodes, (n) => n.opacity);
  const rounded = nodes.filter((n) => n.type === 'RECTANGLE' || n.type === 'FRAME');
  const radius = num(rounded, (n) => n.cornerRadius);
  const polys = nodes.filter((n) => n.type === 'POLYGON' || n.type === 'STAR');
  const stars = nodes.filter((n) => n.type === 'STAR');
  const visible = nodes.some((n) => n.visible);
  return (
    <Section
      title="Aparência"
      actions={
        <IconButton title={visible ? 'Ocultar (Ctrl+Shift+H)' : 'Mostrar (Ctrl+Shift+H)'} onClick={() => A.toggleVisible(A.selectedTop())}>
          {visible ? <I.IconEye /> : <I.IconEyeOff />}
        </IconButton>
      }
    >
      <div className="rp-grid">
        <NumberField
          label={<I.IconOpacity size={24} />}
          title="Opacidade"
          value={opacity}
          displayScale={100}
          suffix="%"
          min={0}
          max={1}
          onChange={(v, live) => A.editNodes(ids, (n) => (n.opacity = v), !live)}
        />
        {rounded.length > 0 && (
          <NumberField
            label={<I.IconCorner size={24} />}
            title="Raio dos cantos"
            value={radius}
            min={0}
            onChange={(v, live) => A.editNodes(rounded.map((n) => n.id), (n) => (n.cornerRadius = v), !live)}
          />
        )}
      </div>
      {polys.length > 0 && (
        <div className="rp-grid">
          <NumberField
            label="Nº"
            title="Número de pontas"
            value={num(polys, (n) => n.pointCount ?? 3)}
            min={3}
            max={60}
            onChange={(v, live) => A.editNodes(polys.map((n) => n.id), (n) => (n.pointCount = Math.round(v)), !live)}
          />
          {stars.length > 0 && (
            <NumberField
              label="%"
              title="Proporção do raio interno"
              value={num(stars, (n) => n.innerRadius ?? 0.38)}
              displayScale={100}
              suffix="%"
              min={0.01}
              max={1}
              onChange={(v, live) => A.editNodes(stars.map((n) => n.id), (n) => (n.innerRadius = v), !live)}
            />
          )}
        </div>
      )}
    </Section>
  );
}

const AUTO_RESIZE: { mode: TextAutoResize; title: string; icon: ReactNode }[] = [
  { mode: 'WIDTH_AND_HEIGHT', title: 'Largura automática', icon: <I.IconAutoWidth /> },
  { mode: 'HEIGHT', title: 'Altura automática', icon: <I.IconAutoHeight /> },
  { mode: 'NONE', title: 'Tamanho fixo', icon: <I.IconFixedSize /> },
];

function TextSection({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const family = common(nodes, (n) => n.fontFamily ?? 'Inter');
  const weight = common(nodes, (n) => n.fontWeight ?? 400);
  const size = num(nodes, (n) => n.fontSize ?? 12);
  const lh = common(nodes, (n) => n.lineHeight ?? null);
  const ls = num(nodes, (n) => n.letterSpacing ?? 0);
  const align = common(nodes, (n) => n.textAlign ?? 'LEFT').value;
  const resize = common(nodes, (n) => n.textAutoResize ?? 'WIDTH_AND_HEIGHT').value;
  const weights = fontDef(family.value ?? 'Inter')?.weights ?? [400];

  const refitWhenLoaded = (fam: string, w: number) =>
    void ensureFontFace(fam, w).then(() => {
      for (const id of ids) {
        const n = store.state.doc.nodes[id];
        if (n) fitTextBox(n);
      }
      store.emit();
    });

  return (
    <Section title="Tipografia">
      <div className="rp-row">
        <select
          className="select grow"
          value={family.value ?? ''}
          onChange={(e) => {
            const fam = e.target.value;
            const avail = fontDef(fam)?.weights ?? [400];
            A.editNodes(ids, (n) => {
              n.fontFamily = fam;
              const w = n.fontWeight ?? 400;
              if (!avail.includes(w)) n.fontWeight = avail.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), avail[0]);
            });
            refitWhenLoaded(fam, weight.value ?? 400);
          }}
        >
          {family.mixed && <option value="">Misto</option>}
          {FONTS.map((f) => (
            <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
              {f.family}
            </option>
          ))}
        </select>
      </div>
      <div className="rp-grid">
        <select
          className="select"
          value={weight.value ?? ''}
          onChange={(e) => {
            const w = Number(e.target.value);
            A.editNodes(ids, (n) => (n.fontWeight = w));
            refitWhenLoaded(family.value ?? 'Inter', w);
          }}
        >
          {weight.mixed && <option value="">Misto</option>}
          {weights.map((w) => (
            <option key={w} value={w}>
              {WEIGHT_NAMES[w]}
            </option>
          ))}
        </select>
        <NumberField
          title="Tamanho da fonte"
          value={size}
          min={1}
          max={1000}
          onChange={(v, live) => A.editNodes(ids, (n) => (n.fontSize = v), !live)}
        />
      </div>
      <div className="rp-grid">
        <NumberField
          label={<I.IconLineHeight size={24} />}
          title="Altura da linha (0 = automática)"
          value={lh.mixed ? null : lh.value}
          nullText={lh.mixed ? undefined : 'Auto'}
          min={0}
          onChange={(v, live) => A.editNodes(ids, (n) => (n.lineHeight = v > 0 ? v : null), !live)}
        />
        <NumberField
          label={<I.IconLetterSpacing size={24} />}
          title="Espaçamento entre letras (px)"
          value={ls}
          step={0.1}
          onChange={(v, live) => A.editNodes(ids, (n) => (n.letterSpacing = v), !live)}
        />
      </div>
      <div className="rp-row spread">
        <div className="btn-group">
          <IconButton title="Alinhar à esquerda (Ctrl+Alt+L)" active={align === 'LEFT'} onClick={() => A.setTextAlign('LEFT')}>
            <I.IconTextLeft />
          </IconButton>
          <IconButton title="Centralizar (Ctrl+Alt+T)" active={align === 'CENTER'} onClick={() => A.setTextAlign('CENTER')}>
            <I.IconTextCenter />
          </IconButton>
          <IconButton title="Alinhar à direita (Ctrl+Alt+R)" active={align === 'RIGHT'} onClick={() => A.setTextAlign('RIGHT')}>
            <I.IconTextRight />
          </IconButton>
        </div>
        <div className="btn-group">
          {AUTO_RESIZE.map((r) => (
            <IconButton
              key={r.mode}
              title={r.title}
              active={resize === r.mode}
              onClick={() => A.editNodes(ids, (n) => (n.textAutoResize = r.mode))}
            >
              {r.icon}
            </IconButton>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---------- preenchimento e traço ----------

function defaultPaint(n: SceneNode, kind: 'fills' | 'strokes'): Paint {
  if (kind === 'strokes') return solid('#000000');
  if (n.type === 'TEXT') return solid('#000000');
  if (n.type === 'FRAME') return solid('#FFFFFF');
  return solid('#D9D9D9');
}

function HexInput({ value, onCommit }: { value: string; onCommit: (hex: string) => void }) {
  const [text, setText] = useState(value.slice(1));
  useEffect(() => setText(value.slice(1)), [value]);
  return (
    <input
      className="hex-input"
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => {
        const s = text.trim().replace(/^#/, '');
        let h = s;
        if (/^[0-9a-f]{3}$/i.test(s)) h = s.split('').map((c) => c + c).join('');
        if (/^[0-9a-f]{6}$/i.test(h) && '#' + h.toUpperCase() !== value.toUpperCase()) onCommit('#' + h.toUpperCase());
        else setText(value.slice(1));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setText(value.slice(1));
          requestAnimationFrame(() => e.currentTarget?.blur());
        }
      }}
    />
  );
}

function Swatch({ paint, onClick }: { paint: Paint; onClick: (r: DOMRect) => void }) {
  const src = paint.type === 'IMAGE' ? store.state.doc.images[paint.imageId] : null;
  return (
    <button className="swatch checker" data-menu-anchor="" title="Editar" onClick={(e) => onClick(e.currentTarget.getBoundingClientRect())}>
      {paint.type === 'SOLID' ? (
        <span className="swatch-fill" style={{ background: `linear-gradient(to right, ${paint.color} 50%, ${rgba(paint.color, paint.opacity)} 50%)` }} />
      ) : (
        <span className="swatch-fill" style={{ backgroundImage: src ? `url(${src})` : undefined, backgroundSize: 'cover', opacity: paint.opacity }} />
      )}
    </button>
  );
}

function PaintsSection({ kind, nodes, ids }: { kind: 'fills' | 'strokes'; nodes: SceneNode[]; ids: string[] }) {
  const [pop, setPop] = useState<{ index: number; rect: DOMRect } | null>(null);
  const all = nodes.map((n) => n[kind]);
  const uniform = all.every((p) => same(p, all[0]));
  const paints = uniform ? all[0] : null;
  const isText = nodes.every((n) => n.type === 'TEXT');
  const title = kind === 'fills' ? (isText ? 'Preenchimento do texto' : 'Preenchimento') : 'Traço';

  const editPaints = (fn: (list: Paint[], n: SceneNode) => Paint[], live = false) =>
    A.editNodes(ids, (n) => (n[kind] = fn(structuredClone(n[kind]), n)), !live);
  const add = () => editPaints((list, n) => (uniform ? [...list, defaultPaint(n, kind)] : [defaultPaint(n, kind)]));

  const strokeNodes = nodes.filter((n) => n.type !== 'TEXT');
  const weight = num(strokeNodes, (n) => n.strokeWeight);
  const alignC = common(strokeNodes, (n) => n.strokeAlign);
  const lines = nodes.filter((n) => n.type === 'LINE');
  const vectors = nodes.filter((n) => n.type === 'VECTOR');
  const allOpen = strokeNodes.every((n) => n.type === 'LINE' || (n.type === 'VECTOR' && !n.closed));

  if (kind === 'strokes' && !strokeNodes.length) return null;

  return (
    <Section
      title={title}
      actions={
        <IconButton title={kind === 'fills' ? 'Adicionar preenchimento' : 'Adicionar traço'} onClick={add}>
          <I.IconPlus />
        </IconButton>
      }
    >
      {paints === null ? (
        <p className="rp-hint">Clique em + para substituir as pinturas mistas</p>
      ) : (
        paints
          .map((p, i) => ({ p, i }))
          .reverse()
          .map(({ p, i }) => (
            <div key={i} className={'paint-row' + (p.visible ? '' : ' hidden')}>
              <Swatch paint={p} onClick={(rect) => setPop(pop?.index === i ? null : { index: i, rect })} />
              {p.type === 'SOLID' ? (
                <HexInput value={p.color} onCommit={(c) => editPaints((l) => ((l[i] = { ...l[i], color: c } as Paint), l))} />
              ) : (
                <span className="paint-label">Imagem</span>
              )}
              <NumberField
                className="paint-opacity"
                value={p.opacity}
                displayScale={100}
                suffix="%"
                min={0}
                max={1}
                onChange={(v, live) => editPaints((l) => ((l[i] = { ...l[i], opacity: v }), l), live)}
              />
              <IconButton title={p.visible ? 'Ocultar' : 'Mostrar'} onClick={() => editPaints((l) => ((l[i] = { ...l[i], visible: !l[i].visible }), l))}>
                {p.visible ? <I.IconEye /> : <I.IconEyeOff />}
              </IconButton>
              <IconButton
                title="Remover"
                onClick={() => {
                  setPop(null);
                  editPaints((l) => l.filter((_, j) => j !== i));
                }}
              >
                <I.IconMinus />
              </IconButton>
            </div>
          ))
      )}
      {kind === 'strokes' && (paints === null || paints.length > 0) && (
        <>
          <div className="rp-grid">
            <NumberField
              label={<I.IconStrokeWeight size={24} />}
              title="Espessura do traço"
              value={weight}
              min={0}
              onChange={(v, live) => A.editNodes(strokeNodes.map((n) => n.id), (n) => (n.strokeWeight = v), !live)}
            />
            <select
              className="select"
              title="Posição do traço"
              disabled={allOpen}
              value={allOpen ? 'CENTER' : (alignC.value ?? '')}
              onChange={(e) => A.editNodes(strokeNodes.map((n) => n.id), (n) => (n.strokeAlign = e.target.value as StrokeAlign))}
            >
              {alignC.mixed && <option value="">Misto</option>}
              <option value="INSIDE">Dentro</option>
              <option value="CENTER">Centro</option>
              <option value="OUTSIDE">Fora</option>
            </select>
          </div>
          {lines.length > 0 && (
            <label className="rp-check">
              <input
                type="checkbox"
                checked={lines.every((n) => n.arrowEnd)}
                onChange={(e) => A.editNodes(lines.map((n) => n.id), (n) => (n.arrowEnd = e.target.checked))}
              />
              Seta no final
            </label>
          )}
          {vectors.length > 0 && (
            <label className="rp-check">
              <input
                type="checkbox"
                checked={vectors.every((n) => n.closed)}
                onChange={(e) => A.editNodes(vectors.map((n) => n.id), (n) => (n.closed = e.target.checked))}
              />
              Caminho fechado
            </label>
          )}
        </>
      )}
      {pop && paints?.[pop.index] && (
        <PaintPopover
          anchor={pop.rect}
          paint={paints[pop.index]}
          allowImage={kind === 'fills' && !isText}
          title={title}
          docColors={docColors()}
          onClose={() => setPop(null)}
          onChange={(p, live) => editPaints((l) => ((l[pop.index] = p), l), live)}
        />
      )}
    </Section>
  );
}

// ---------- efeitos ----------

const EFFECT_LABELS: Record<EffectType, string> = {
  DROP_SHADOW: 'Sombra projetada',
  INNER_SHADOW: 'Sombra interna',
  LAYER_BLUR: 'Desfoque de camada',
};

const defaultEffect = (type: EffectType = 'DROP_SHADOW'): Effect => ({
  type,
  visible: true,
  color: '#000000',
  opacity: 0.25,
  x: 0,
  y: type === 'LAYER_BLUR' ? 0 : 4,
  radius: 4,
  spread: 0,
});

function EffectsSection({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const [pop, setPop] = useState<{ index: number; rect: DOMRect } | null>(null);
  const all = nodes.map((n) => n.effects);
  const uniform = all.every((e) => same(e, all[0]));
  const effects = uniform ? all[0] : null;
  const editEffects = (fn: (list: Effect[]) => Effect[], live = false) =>
    A.editNodes(ids, (n) => (n.effects = fn(structuredClone(n.effects))), !live);
  const set = (i: number, patch: Partial<Effect>, live = false) => editEffects((l) => ((l[i] = { ...l[i], ...patch }), l), live);

  return (
    <Section
      title="Efeitos"
      actions={
        <IconButton title="Adicionar efeito" onClick={() => editEffects((l) => (uniform ? [...l, defaultEffect()] : [defaultEffect()]))}>
          <I.IconPlus />
        </IconButton>
      }
    >
      {effects === null ? (
        <p className="rp-hint">Clique em + para substituir os efeitos mistos</p>
      ) : (
        effects.map((e, i) => (
          <div key={i} className={'effect' + (e.visible ? '' : ' hidden')}>
            <div className="paint-row">
              <select className="select grow" value={e.type} onChange={(ev) => set(i, { type: ev.target.value as EffectType })}>
                {(Object.keys(EFFECT_LABELS) as EffectType[]).map((t) => (
                  <option key={t} value={t}>
                    {EFFECT_LABELS[t]}
                  </option>
                ))}
              </select>
              <IconButton title={e.visible ? 'Ocultar' : 'Mostrar'} onClick={() => set(i, { visible: !e.visible })}>
                {e.visible ? <I.IconEye /> : <I.IconEyeOff />}
              </IconButton>
              <IconButton
                title="Remover"
                onClick={() => {
                  setPop(null);
                  editEffects((l) => l.filter((_, j) => j !== i));
                }}
              >
                <I.IconMinus />
              </IconButton>
            </div>
            {e.type === 'LAYER_BLUR' ? (
              <div className="rp-grid">
                <NumberField label="D" title="Desfoque" value={e.radius} min={0} onChange={(v, live) => set(i, { radius: v }, live)} />
              </div>
            ) : (
              <>
                <div className="rp-grid">
                  <NumberField label="X" value={e.x} onChange={(v, live) => set(i, { x: v }, live)} />
                  <NumberField label="Y" value={e.y} onChange={(v, live) => set(i, { y: v }, live)} />
                </div>
                <div className="rp-grid">
                  <NumberField label="D" title="Desfoque" value={e.radius} min={0} onChange={(v, live) => set(i, { radius: v }, live)} />
                  <NumberField label="E" title="Expansão" value={e.spread} onChange={(v, live) => set(i, { spread: v }, live)} />
                </div>
                <div className="paint-row">
                  <Swatch paint={solid(e.color, e.opacity)} onClick={(rect) => setPop(pop?.index === i ? null : { index: i, rect })} />
                  <HexInput value={e.color} onCommit={(c) => set(i, { color: c })} />
                  <NumberField
                    className="paint-opacity"
                    value={e.opacity}
                    displayScale={100}
                    suffix="%"
                    min={0}
                    max={1}
                    onChange={(v, live) => set(i, { opacity: v }, live)}
                  />
                </div>
              </>
            )}
          </div>
        ))
      )}
      {pop && effects?.[pop.index] && (
        <PaintPopover
          anchor={pop.rect}
          paint={solid(effects[pop.index].color, effects[pop.index].opacity)}
          allowImage={false}
          title="Cor da sombra"
          docColors={docColors()}
          onClose={() => setPop(null)}
          onChange={(p, live) => p.type === 'SOLID' && set(pop.index, { color: p.color, opacity: p.opacity }, live)}
        />
      )}
    </Section>
  );
}

// ---------- exportar ----------

const SCALES = [0.5, 0.75, 1, 1.5, 2, 3, 4];

function ExportSection({ nodes }: { nodes: SceneNode[] }) {
  const [setting, setSetting] = useState<ExportSetting>({ ...exportPrefs });
  const update = (patch: Partial<ExportSetting>) => {
    const next = { ...setting, ...patch };
    Object.assign(exportPrefs, next);
    setSetting(next);
  };
  const label = useMemo(() => (nodes.length === 1 ? nodes[0].name : `${nodes.length} camadas`), [nodes]);
  return (
    <Section title="Exportar">
      <div className="rp-grid">
        <select
          className="select"
          value={setting.scale}
          disabled={setting.format === 'SVG'}
          onChange={(e) => update({ scale: Number(e.target.value) })}
        >
          {SCALES.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
        <select className="select" value={setting.format} onChange={(e) => update({ format: e.target.value as ExportFormat })}>
          <option value="PNG">PNG</option>
          <option value="JPG">JPG</option>
          <option value="SVG">SVG</option>
        </select>
      </div>
      <button className="btn secondary full" onClick={() => void exportNodes(store.state.selection, setting)}>
        Exportar {label}
      </button>
    </Section>
  );
}
