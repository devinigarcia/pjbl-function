import type { Layer, SourceFile } from './dependencyScanner';

// Cada regra recebe os arquivos escaneados e devolve a lista de violações em texto.
// Lista vazia = arquitetura respeitada. Assim a mensagem do teste já diz onde está o problema.

export type Rule = (files: readonly SourceFile[]) => string[];

/** Pacotes que a camada Application pode usar. O resto (SDKs, frameworks) fica fora. */
export const APPLICATION_ALLOWED_PACKAGES: readonly string[] = ['zod'];
export const APPLICATION_ALLOWED_BUILTINS: readonly string[] = ['node:crypto'];

/** Quem pode importar o SDK do Azure Functions: só os adaptadores (api) e o main. */
export const AZURE_FUNCTIONS_ALLOWED_LAYERS: readonly Layer[] = ['api', 'root'];

const inLayer = (files: readonly SourceFile[], layer: Layer) => files.filter((file) => file.layer === layer);

function forbidLayers(files: readonly SourceFile[], from: Layer, forbidden: readonly (Layer | 'outside')[]): string[] {
  return inLayer(files, from).flatMap((file) =>
    file.imports
      .filter((imp) => imp.targetLayer !== undefined && forbidden.includes(imp.targetLayer))
      .map((imp) => `${file.path} (${from}) não pode importar "${imp.specifier}" (${imp.targetLayer})`),
  );
}

/** Domain: TypeScript puro. Não importa outra camada, nenhum pacote e nenhum módulo do Node. */
export const domainIsPure: Rule = (files) => [
  ...forbidLayers(files, 'domain', ['application', 'infrastructure', 'api', 'root', 'outside']),
  ...inLayer(files, 'domain').flatMap((file) =>
    file.imports
      .filter((imp) => imp.kind !== 'relative')
      .map((imp) => `${file.path} (domain) não pode usar o pacote "${imp.packageName}"`),
  ),
];

/** Application: enxerga só o Domain e ela mesma; de pacote externo, só o zod. */
export const applicationIsIndependent: Rule = (files) => [
  ...forbidLayers(files, 'application', ['infrastructure', 'api', 'root', 'outside']),
  ...inLayer(files, 'application').flatMap((file) =>
    file.imports
      .filter(
        (imp) =>
          (imp.kind === 'package' && !APPLICATION_ALLOWED_PACKAGES.includes(imp.packageName ?? '')) ||
          (imp.kind === 'builtin' && !APPLICATION_ALLOWED_BUILTINS.includes(imp.packageName ?? '')),
      )
      .map((imp) => `${file.path} (application) não pode usar o pacote "${imp.packageName}"`),
  ),
];

/** Infrastructure implementa as portas da Application, mas não conhece os adaptadores da API. */
export const infrastructureDoesNotKnowApi: Rule = (files) => forbidLayers(files, 'infrastructure', ['api', 'root', 'outside']);

/** API não importa Infrastructure: quem liga as duas é só o main.ts. */
export const apiDoesNotKnowInfrastructure: Rule = (files) => forbidLayers(files, 'api', ['infrastructure', 'root', 'outside']);

/** O SDK @azure/functions só aparece nos adaptadores (api) e no composition root. */
export const azureFunctionsSdkOnlyAtTheEdge: Rule = (files) =>
  files.flatMap((file) =>
    file.imports
      .filter((imp) => imp.packageName === '@azure/functions' && !AZURE_FUNCTIONS_ALLOWED_LAYERS.includes(file.layer))
      .map(() => `${file.path} (${file.layer}) não pode importar "@azure/functions"`),
  );

/** Vertical slice: uma feature não importa código de outra feature. */
export const featuresAreIsolated: Rule = (files) =>
  files.flatMap((file) =>
    file.imports
      .filter((imp) => file.feature && imp.targetFeature && imp.targetFeature !== file.feature)
      .map((imp) => `${file.path} (feature ${file.feature}) não pode importar a feature ${imp.targetFeature}`),
  );

/** Lista as features declaradas em uma camada (pastas dentro de <camada>/features). */
export function featuresIn(files: readonly SourceFile[], layer: Layer): string[] {
  const names = inLayer(files, layer).flatMap((file) => (file.feature ? [file.feature] : []));
  return [...new Set(names)].sort();
}

/**
 * Cada feature tem as duas metades: o caso de uso em application/features/<F>/<F>.ts
 * (exportando a classe <F>Handler) e o adaptador em api/features/<F>/<F>Endpoint.ts.
 */
export const everyFeatureHasHandlerAndEndpoint: Rule = (files) => {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const features = new Set([...featuresIn(files, 'application'), ...featuresIn(files, 'api')]);
  const violations: string[] = [];

  for (const feature of features) {
    const handlerPath = `application/features/${feature}/${feature}.ts`;
    const endpointPath = `api/features/${feature}/${feature}Endpoint.ts`;

    const handlerFile = byPath.get(handlerPath);
    if (!handlerFile) {
      violations.push(`A feature ${feature} não tem ${handlerPath}`);
    } else if (!new RegExp(`export\\s+class\\s+${feature}Handler\\b`).test(handlerFile.content)) {
      violations.push(`${handlerPath} precisa exportar a classe ${feature}Handler`);
    }

    if (!byPath.has(endpointPath)) {
      violations.push(`A feature ${feature} não tem ${endpointPath}`);
    }
  }
  return violations;
};

/** O main.ts é o único arquivo solto na raiz de src e ninguém depende dele. */
export const mainIsTheOnlyCompositionRoot: Rule = (files) => [
  ...inLayer(files, 'root')
    .filter((file) => file.path !== 'main.ts')
    .map((file) => `${file.path} está fora das camadas (só o main.ts pode ficar na raiz de src)`),
  ...files.flatMap((file) =>
    file.imports
      .filter((imp) => imp.target === 'main')
      .map(() => `${file.path} não pode importar o main.ts`),
  ),
];
