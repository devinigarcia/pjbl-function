import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, posix, relative, sep } from 'node:path';

// Scanner caseiro (sem biblioteca): lê os .ts de src/, extrai os imports por regex e diz
// de qual camada e de qual feature cada arquivo é. As regras em si ficam em rules.ts.

export type Layer = 'domain' | 'application' | 'infrastructure' | 'api' | 'root';

const LAYERS: readonly Layer[] = ['domain', 'application', 'infrastructure', 'api'];

export interface ImportInfo {
  /** Texto do import como está no código (ex.: '../../domain/errors' ou 'zod'). */
  specifier: string;
  kind: 'relative' | 'package' | 'builtin';
  /** Para pacotes: nome do pacote ('zod', '@azure/functions'). Para builtins: 'node:crypto'. */
  packageName?: string;
  /** Para imports relativos: caminho resolvido a partir de src/ (ex.: 'domain/errors'). */
  target?: string;
  targetLayer?: Layer | 'outside';
  targetFeature?: string;
}

export interface SourceFile {
  /** Caminho a partir de src/, sempre com barra normal (ex.: 'api/features/X/XEndpoint.ts'). */
  path: string;
  layer: Layer;
  feature?: string;
  content: string;
  imports: ImportInfo[];
}

const IMPORT_PATTERNS: readonly RegExp[] = [
  // import x from 'a' | import { a, b } from 'a' | import type { T } from 'a' | import 'a'
  /\bimport\s+(?:type\s+)?(?:[\w*\s{},$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  // export { a } from 'a' | export * from 'a'
  /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  // require('a') e import('a')
  /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Remove comentários para um "import" comentado não contar como dependência. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

export function extractImportSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

export function layerOf(path: string): Layer {
  const first = path.split('/')[0] as Layer;
  return path.includes('/') && LAYERS.includes(first) ? first : 'root';
}

export function featureOf(path: string): string | undefined {
  return /(?:^|\/)features\/([^/]+)\//.exec(path)?.[1];
}

function isBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(specifier);
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

function describeImport(filePath: string, specifier: string): ImportInfo {
  if (specifier.startsWith('.')) {
    const target = posix.normalize(posix.join(posix.dirname(filePath), specifier));
    const outside = target.startsWith('..');
    return {
      specifier,
      kind: 'relative',
      target,
      targetLayer: outside ? 'outside' : layerOf(`${target}.ts`),
      targetFeature: outside ? undefined : featureOf(`${target}.ts`),
    };
  }
  if (isBuiltin(specifier)) {
    return { specifier, kind: 'builtin', packageName: specifier.startsWith('node:') ? specifier : `node:${specifier}` };
  }
  return { specifier, kind: 'package', packageName: packageNameOf(specifier) };
}

/** Monta a descrição de um arquivo a partir do conteúdo (dá para usar com código "plantado" nos testes). */
export function analyzeSource(path: string, content: string): SourceFile {
  return {
    path,
    layer: layerOf(path),
    feature: featureOf(path),
    content,
    imports: extractImportSpecifiers(content).map((specifier) => describeImport(path, specifier)),
  };
}

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(fullPath);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [fullPath] : [];
  });
}

/** Lê todos os .ts de uma pasta src/. */
export function scanSources(srcDir: string): SourceFile[] {
  return listTypeScriptFiles(srcDir)
    .map((fullPath) => analyzeSource(relative(srcDir, fullPath).split(sep).join('/'), readFileSync(fullPath, 'utf8')))
    .sort((a, b) => a.path.localeCompare(b.path));
}
