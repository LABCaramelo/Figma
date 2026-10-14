# Prancheta

Editor de design local inspirado na interface do Figma Desktop, implementado em React, TypeScript e Canvas 2D. A referência estática foi investigada com o MCP REA; o motor do editor foi escrito neste projeto.

## Executar

```sh
npm install
npm run dev
```

Abra o endereço informado pelo Vite (normalmente http://localhost:5173). O documento de boas-vindas aparece na primeira abertura. Alterações são salvas no IndexedDB deste navegador. Use **Salvar cópia** para baixar um arquivo `.prancheta.json` e **Arquivo → Abrir arquivo** para restaurá-lo.

```sh
npm run build
npm run verify:persistence
npm run preview
```

## Recursos

- Canvas com pan, zoom, seleção, arraste, redimensionamento, rotação e guias de encaixe.
- Frames, retângulos, elipses, polígonos, estrelas, linhas, setas, lápis e texto editável.
- Páginas e árvore de camadas com pesquisa, renomeação, reordenação, grupos, bloqueio e visibilidade.
- Propriedades de posição, dimensão, tipografia, pinturas, traços e efeitos.
- Auto layout básico, componentes locais e instâncias, operações booleanas no canvas.
- Histórico, área de transferência, importação de imagens, exportação PNG/JPG/SVG e arquivo JSON.
- Temas claro/escuro, busca de comandos (`Ctrl+K`) e atalhos (`Ctrl+Shift+?`).

## Escopo atual

O editor funciona localmente e não abre arquivos `.fig`. Colaboração, comentários, prototipagem interativa, plugins e bibliotecas remotas ainda não foram implementados. O auto layout e as instâncias cobrem um subconjunto do comportamento do Figma. O achatamento preserva primitivas individuais; seleções compostas ainda não são convertidas. Na exportação SVG, grupos booleanos são emitidos como grupos de filhos; use PNG/JPG para preservar o resultado composto do canvas.

Inter está incluída no projeto; as outras fontes do seletor são carregadas pelo Google Fonts quando disponíveis.

## Referência e validação

Veja [referencia-rea.md](docs/referencia-rea.md) para alvos, Evidence IDs, limites da análise e verificações realizadas. O teste de persistência executa o código TypeScript real em memória e verifica os tipos de nós, hierarquias, arquivos, imagens, fila de gravação e falhas de armazenamento.
