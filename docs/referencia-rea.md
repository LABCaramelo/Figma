# Prancheta: referência levantada com o REA e plano de continuação

## Alvo analisado
- Figma Desktop 126.10.7 (`%LOCALAPPDATA%\Figma\app-126.10.7\resources\app.asar`), Electron, `package.json` → `main.js`.
- O ASAR tem uma entrada-sentinela `.codesign` com tamanho -1000. O REA recusa o arquivo por isso, então ele foi extraído manualmente (ignorando essa entrada) e analisado como diretório.
- Evidence REA (parcial; o worker ficou sem heap em `main.js`, `desktop_shell.js` e `lazy/external/*`): `ev_cf50fa1add67b689fa3e2333e84beb8f34cb88f7b9a6ffaacfdf53889f86587a`
  - 4 BrowserWindows, 2 preloads, 4 APIs via contextBridge, 28 operações IPC, 1 utility process.
- O editor (canvas C++/WASM) **não** está no app local: ele é carregado de figma.com. O clone foi escrito do zero.

## O que foi aproveitado como referência (sem copiar código)
- Menus (rótulos pt-BR de `i18n/pt-br.json`): Arquivo, Editar, Visualizar, Objeto, Vetor, Texto, Organizar, Plugins, Widgets, Janela, Ajuda.
- Atalhos do casco (`main.js`): Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Shift+N, Ctrl+Tab etc.
- Tokens UI3 (`desktop_shell.css`): azul `#0d99ff`, cinzas `#f5f5f5/#e6e6e6/#2c2c2c/#1e1e1e`, menu escuro `#1e1e1e`, raios 2/5/13px, fonte Inter 11px/16px (pesos 450/550), elevações 100–500.

## Continuação em 14/10/2026

O aplicativo foi integrado: entrada React, layout, canvas, barra de ferramentas, páginas/camadas, inspetor, atalhos e busca de comandos. A interface aplica os tokens da referência e a fonte Inter local. O projeto compila e abre no navegador.

Correções de integridade:
- Normalização de arquivos aceita todos os tipos registrados em `TYPE_LABELS`, incluindo COMPONENT, INSTANCE e BOOLEAN_OPERATION, preservando filhos.
- Salvamentos entram em uma fila com snapshots imutáveis, comunicam falhas corretamente e detectam mudanças no conteúdo de imagens. Mover o mouse não adia o autosave.
- Reparenting impede ciclos de dependência entre componentes; canvas e SVG protegem a cadeia de renderização de arquivos com referências cíclicas.
- Achatar uma primitiva mantém contorno, transformação, identidade e estilos. Elipses e cantos arredondados usam arcos exatos que acompanham o redimensionamento. Casos ainda não suportados preservam a seleção e exibem um aviso.

### Nova evidência MCP REA

A evidência histórica anterior não estava retida na nova sessão. Foi usado o recorte já existente `.figma-shell-ref`, sem executar o Figma. A análise chegou ao limite de 20s em `desktop_shell.js`; o resultado parcial foi recuperado por `inspect_analysis_view`, sem repetir a mesma análise:
- Parent: `ev_16c3e83a244e96def9990907dce11bd714b45768e516cafdb66990bcd1ec7add`.
- Vista: `ev_e809d28b804509aa93b2ff58fad273cdf69197b8b1bf598a3036e73a1b1edeb7`.
- SHA-256 do recorte: `9256bab2319b2be047587771eea7bc1b5a9cb599e1af686952fbcbc44fa21b4a`.
- Cobertura parcial: 2 arquivos JS processados; ausência de achados em outros arquivos não indica ausência de comportamento.

Para responder à questão específica das pontes Electron, foram copiados cinco bindings existentes para um diretório temporário e analisados separadamente: `web_app_binding_renderer.js`, `shell_app_binding_renderer.js`, `popout_binding_renderer.js`, `overlay_window_binding_renderer.js` e `detached_window_binding_renderer.js`.
- Parent: `ev_3ceb8908542a46b7a4fd133824038b5e5ee66eb37ba7d36817e2b001086ae2f5`.
- Vista de resumo: `ev_da890fbee037abc52618739e8d7447e8eb809d9e9980babf5bf388bc2e0c7f11`.
- SHA-256 do subconjunto: `6fa1b66529eb5b4a216a1c6955061ffda40f8f9cdb065dfaded1a17dc50a4bf5`.
- 5 arquivos JS / 42.066 bytes, sem falha de parsing; 40 achados, 4 APIs contextBridge e 21 operações IPC (9 canais literais e 12 operações com canal dinâmico).
- Observações estáticas: não demonstram execução, registro em runtime ou comportamento do editor remoto. O subconjunto não inclui handlers do processo principal. A cobertura do aplicativo permanece parcial e existem relações sem resolução.

Resumo portátil: `docs/rea-bindings-summary.json`. Bundle completo local: `docs/rea-evidence.json` (12,7 MB, ignorado pelo Git), exportado com 4 registros. Recursos originais ficam fora do código distribuído da aplicação.

### Tokens conferidos nos recursos locais

`node scripts/inspect-figma-tokens.mjs` usa PostCSS e mantém o escopo dos seletores `[data-preferred-theme=light][data-editor-theme=design]` e `[data-preferred-theme=dark][data-editor-theme=design]`, com defaults de `:root`. Componentes, whiteboard, contraste reforçado e regras condicionais não são mesclados. Isso é leitura direta do recurso extraído, separada dos achados de código do REA.

| Token | Claro | Escuro |
|---|---|---|
| Fundo | #fff | #2c2c2c |
| Fundo secundário | #f5f5f5 | #383838 |
| Fundo terciário | #e6e6e6 | #444 |
| Cor da marca | #0d99ff | #0c8ce9 |
| Seleção | #e5f4ff | #394360 |
| Texto | #000000e5 | #fff |

Valores sem definição e referências cíclicas são relatados explicitamente. O script aceita caminho CSS opcional e funciona a partir de outros diretórios.

### Validação

- Build de produção: TypeScript e Vite aprovados.
- `node scripts/verify-persistence.mjs`: 13/13 verificações aprovadas para os 12 tipos de nós, hierarquias, arquivos, imagens, concorrência e falhas de gravação.
- Verificações focadas: ciclos diretos/indiretos rejeitados, instâncias irmãs mantidas, renderização/SVG de referências cíclicas termina; achatamento preserva dados, permite desfazer/refazer e redimensiona curvas.
- Navegador: desenho de retângulo, medida `120*2` → 240, cor hexadecimal, duplicação/desfazer, texto, criação de componente/instância, salvamento e recarga, busca de comandos e filtro de atalhos.
- Exportação real de elipse achatada: SVG mantém `A80 50` (160×100) e PNG inspecionado visualmente. Console sem erros durante o fluxo.
- Captura de validação do editor desktop: `docs/validation/editor-desktop.jpg`. Objetos temporários de teste foram removidos da página Rascunhos e o arquivo foi salvo.

## Próximos limites

Ainda não há leitura de `.fig`, colaboração, comentários, plugins ou protótipos navegáveis. Auto layout e componentes são parciais. Achatar grupos/booleanos/múltiplos objetos ainda não é suportado. O SVG de booleanos atualmente agrupa os filhos e não reproduz a composição booleana; o PNG/JPG usa o renderizador do canvas.
