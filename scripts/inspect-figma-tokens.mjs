import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(workspace, '.figma-reference', 'desktop_shell.css');
const tokens = [
  'color-bg', 'color-bg-secondary', 'color-bg-tertiary', 'color-bg-brand',
  'color-bg-selected', 'color-border', 'color-border-subtle',
  'color-border-selected', 'color-text', 'color-text-secondary',
  'color-text-tertiary', 'color-text-brand', 'color-icon',
  'color-icon-secondary', 'color-icon-brand',
];

// Only global defaults and the normal Design editor theme belong in this
// report. Component overrides, other products and enhanced contrast have
// separate scopes and must never be flattened into these maps.
const normalizeSelector = (selector) => selector
  .replace(/(["'])/g, '')
  .replace(/\s*=\s*/g, '=')
  .replace(/\s+/g, ' ')
  .trim();
function themeSpecificity(selector, theme) {
  const attribute = `[data-preferred-theme=${theme}]`;
  if (selector === attribute) return 1;
  if (selector === `${attribute}[data-editor-theme=design]`) return 2;
  if (selector === `:where(${attribute} [data-editor-theme=design])`) return 0;
  return -1;
}

function setDeclaration(map, declaration, specificity, selector) {
  const previous = map.get(declaration.prop);
  const entry = {
    raw: declaration.value,
    important: Boolean(declaration.important),
    specificity,
    selector,
  };
  if (!previous || Number(entry.important) > Number(previous.important)
    || (entry.important === previous.important
      && entry.specificity >= previous.specificity)) {
    map.set(declaration.prop, entry);
  }
}

// Find the end and optional fallback of var() without crossing nested
// parentheses or commas inside strings/functions.
function variableArguments(value, start) {
  let depth = 1;
  let quote = '';
  let comma = -1;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\\') { index += 1; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 1 && comma < 0) comma = index;
    if (depth === 0) {
      return {
        end: index,
        name: value.slice(start, comma < 0 ? index : comma).trim(),
        fallback: comma < 0 ? undefined : value.slice(comma + 1, index).trim(),
      };
    }
  }
  return undefined;
}

function findCycles(declarations) {
  const cycles = new Map();
  const visited = new Set();
  const visiting = [];
  function visit(name) {
    const cycleStart = visiting.indexOf(name);
    if (cycleStart >= 0) {
      const chain = [...visiting.slice(cycleStart), name].join(' -> ');
      visiting.slice(cycleStart).forEach((member) => cycles.set(member, chain));
      return;
    }
    if (visited.has(name) || !declarations.has(name)) return;
    visiting.push(name);
    // Fallback references also participate in CSS custom-property cycles.
    for (const reference of declarations.get(name).raw.matchAll(/var\(\s*(--[\w-]+)/g)) {
      visit(reference[1]);
    }
    visiting.pop();
    visited.add(name);
  }
  declarations.forEach((_, name) => visit(name));
  return cycles;
}

function resolve(value, declarations, cycles, stack = []) {
  let output = '';
  let cursor = 0;
  const issues = [];
  const variables = /var\(/g;
  let match;
  while ((match = variables.exec(value))) {
    output += value.slice(cursor, match.index);
    const args = variableArguments(value, variables.lastIndex);
    if (!args) return { value, issues: ['malformed var()'] };
    const entry = declarations.get(args.name);
    let result;
    if (cycles.has(args.name)) {
      result = { issues: [`cycle: ${cycles.get(args.name)}`] };
    } else if (stack.includes(args.name)) {
      result = { issues: [`cycle: ${[...stack, args.name].join(' -> ')}`] };
    } else if (!entry) {
      result = { issues: [`missing: ${args.name}`] };
    } else {
      result = resolve(entry.raw, declarations, cycles, [...stack, args.name]);
    }
    if (result.issues.length && args.fallback !== undefined) {
      result = resolve(args.fallback, declarations, cycles, stack);
    }
    output += result.issues.length
      ? value.slice(match.index, args.end + 1)
      : result.value;
    issues.push(...result.issues);
    cursor = args.end + 1;
    variables.lastIndex = cursor;
  }
  return { value: output + value.slice(cursor), issues: [...new Set(issues)] };
}

try {
  const css = postcss.parse(fs.readFileSync(source, 'utf8'), { from: source });
  const defaults = new Map();
  const themes = { light: new Map(), dark: new Map() };
  // Direct children exclude conditional @media/@supports/@layer rules: this
  // static report deliberately does not guess a runtime environment.
  for (const rule of css.nodes) {
    if (rule.type !== 'rule') continue;
    const selectors = rule.selectors.map((selector) => ({
      original: selector,
      normalized: normalizeSelector(selector),
    }));
    for (const declaration of rule.nodes) {
      if (declaration.type !== 'decl' || !declaration.prop.startsWith('--')) continue;
      const rootSelector = selectors.find(({ normalized }) => normalized === ':root');
      if (rootSelector) setDeclaration(defaults, declaration, 1, rootSelector.original);
      for (const [theme, declarations] of Object.entries(themes)) {
        const matching = selectors
          .map((selector) => ({ ...selector, specificity: themeSpecificity(selector.normalized, theme) }))
          .filter(({ specificity }) => specificity >= 0)
          .sort((a, b) => b.specificity - a.specificity)[0];
        if (matching) setDeclaration(declarations, declaration, matching.specificity, matching.original);
      }
    }
  }

  console.log(`Source: ${source}`);
  console.log('Scope: normal Design editor; :root defaults + explicit light/dark theme rules.');
  console.log('Component, other editor, enhanced contrast and conditional rules are excluded.');
  for (const [theme, overrides] of Object.entries(themes)) {
    const declarations = new Map([...defaults, ...overrides]);
    const cycles = findCycles(declarations);
    const selectors = [...new Set(tokens.map((name) => declarations.get(`--${name}`)?.selector).filter(Boolean))];
    console.log(`\n${theme.toUpperCase()} (${declarations.size} scoped custom properties)`);
    selectors.forEach((selector, index) => console.log(`  [${index + 1}] ${selector}`));
    for (const name of tokens) {
      const entry = declarations.get(`--${name}`);
      const result = cycles.has(`--${name}`)
        ? { value: '', issues: [`cycle: ${cycles.get(`--${name}`)}`] }
        : entry
        ? resolve(entry.raw, declarations, cycles, [`--${name}`])
        : { value: '', issues: [`missing: --${name}`] };
      const selector = entry ? ` [${selectors.indexOf(entry.selector) + 1}]` : '';
      const resolved = !entry ? 'NOT DECLARED in this scope' : result.issues.length
        ? `UNRESOLVED (${result.issues.join('; ')})`
        : result.value;
      console.log(`  --${name}: ${resolved}${selector}`);
      if (entry && result.issues.length) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(`Cannot inspect tokens: ${error.message}`);
  process.exitCode = 1;
}
