import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeSource, extractImportSpecifiers, scanSources } from './dependencyScanner';
import {
  apiDoesNotKnowInfrastructure,
  applicationIsIndependent,
  azureFunctionsSdkOnlyAtTheEdge,
  domainIsPure,
  everyFeatureHasHandlerAndEndpoint,
  featuresAreIsolated,
  featuresIn,
  infrastructureDoesNotKnowApi,
  mainIsTheOnlyCompositionRoot,
} from './rules';

const files = scanSources(resolve(__dirname, '../../src'));

describe('Arquitetura — camadas (Clean Architecture)', () => {
  it('o scanner encontrou arquivos em todas as camadas e o main.ts', () => {
    const layers = new Set(files.map((file) => file.layer));

    expect([...layers].sort()).toEqual(['api', 'application', 'domain', 'infrastructure', 'root']);
    expect(files.map((file) => file.path)).toContain('main.ts');
  });

  it('Domain é TypeScript puro: não importa outras camadas nem pacote nenhum', () => {
    expect(domainIsPure(files)).toEqual([]);
  });

  it('Application só depende do Domain e, de pacotes, só do zod', () => {
    expect(applicationIsIndependent(files)).toEqual([]);
  });

  it('Infrastructure não conhece a camada de API', () => {
    expect(infrastructureDoesNotKnowApi(files)).toEqual([]);
  });

  it('API não importa Infrastructure (quem liga as duas é o main.ts)', () => {
    expect(apiDoesNotKnowInfrastructure(files)).toEqual([]);
  });

  it('@azure/functions só é importado na API e no main.ts', () => {
    expect(azureFunctionsSdkOnlyAtTheEdge(files)).toEqual([]);

    // e é usado de fato onde deveria, senão a regra acima passaria "no vazio"
    const users = files.filter((file) => file.imports.some((imp) => imp.packageName === '@azure/functions'));
    expect(users.map((file) => file.path)).toContain('main.ts');
    expect(users.some((file) => file.layer === 'api')).toBe(true);
  });

  it('main.ts é o único composition root e ninguém o importa', () => {
    expect(mainIsTheOnlyCompositionRoot(files)).toEqual([]);
  });
});

describe('Arquitetura — features (Vertical Slice)', () => {
  it('as features existem nas duas camadas com os mesmos nomes', () => {
    expect(featuresIn(files, 'application')).toEqual(['CalculateIndicators', 'ProcessOrderEvent']);
    expect(featuresIn(files, 'api')).toEqual(featuresIn(files, 'application'));
  });

  it('uma feature não importa outra', () => {
    expect(featuresAreIsolated(files)).toEqual([]);
  });

  it('toda feature tem <Feature>.ts com a classe <Feature>Handler e o <Feature>Endpoint.ts', () => {
    expect(everyFeatureHasHandlerAndEndpoint(files)).toEqual([]);
  });
});

// Prova de que as regras pegam violação de verdade: aqui o "código errado" é plantado em memória,
// sem depender dos arquivos reais (se uma regra parar de funcionar, é este bloco que acusa).
// No README tem o passo a passo para plantar uma violação num arquivo real e ver o teste falhar.
describe('Arquitetura — as regras detectam violações plantadas', () => {
  const plant = (path: string, code: string) => [analyzeSource(path, code)];

  it('extrai imports nos formatos usados no projeto e ignora os comentados', () => {
    const specifiers = extractImportSpecifiers(`
      import { z } from 'zod';
      import type { Logger } from '../ports/Logger';
      import {
        a,
        b,
      } from "./varias-linhas";
      import 'node:fs';
      export * from './reexport';
      const lazy = require('express');
      const dynamic = await import('mongodb');
      // import { nada } from 'comentado';
    `);

    expect(specifiers.sort()).toEqual(['../ports/Logger', './reexport', './varias-linhas', 'express', 'mongodb', 'node:fs', 'zod']);
  });

  it('Domain usando um pacote ou outra camada', () => {
    expect(domainIsPure(plant('domain/errado.ts', "import { z } from 'zod';"))).toEqual([
      'domain/errado.ts (domain) não pode usar o pacote "zod"',
    ]);
    expect(domainIsPure(plant('domain/errado.ts', "import { validate } from '../application/validation';"))).toHaveLength(1);
    expect(domainIsPure(plant('domain/errado.ts', "import { randomUUID } from 'node:crypto';"))).toHaveLength(1);
  });

  it('Application importando Infrastructure ou um SDK', () => {
    const withInfra = plant(
      'application/features/ProcessOrderEvent/atalho.ts',
      "import { ProdutosHttpStockGateway } from '../../../infrastructure/ProdutosHttpStockGateway';",
    );
    const withSdk = plant('application/errado.ts', "import { app } from '@azure/functions';");

    expect(applicationIsIndependent(withInfra)).toHaveLength(1);
    expect(applicationIsIndependent(withSdk)).toEqual(['application/errado.ts (application) não pode usar o pacote "@azure/functions"']);
    expect(azureFunctionsSdkOnlyAtTheEdge(withSdk)).toHaveLength(1);
  });

  it('API importando Infrastructure e Infrastructure importando API', () => {
    expect(apiDoesNotKnowInfrastructure(plant('api/errado.ts', "import { loadConfig } from '../infrastructure/config';"))).toHaveLength(1);
    expect(infrastructureDoesNotKnowApi(plant('infrastructure/errado.ts', "import { healthEndpoint } from '../api/health';"))).toHaveLength(1);
  });

  it('uma feature importando outra', () => {
    const violations = featuresAreIsolated(
      plant(
        'application/features/ProcessOrderEvent/atalho.ts',
        "import { CalculateIndicatorsHandler } from '../CalculateIndicators/CalculateIndicators';",
      ),
    );

    expect(violations).toEqual([
      'application/features/ProcessOrderEvent/atalho.ts (feature ProcessOrderEvent) não pode importar a feature CalculateIndicators',
    ]);
  });

  it('feature sem Endpoint ou sem a classe Handler', () => {
    const semEndpoint = plant('application/features/CancelOrder/CancelOrder.ts', 'export class CancelOrderHandler {}');
    const semHandler = [
      ...plant('application/features/CancelOrder/CancelOrder.ts', 'export function cancelOrder() {}'),
      analyzeSource('api/features/CancelOrder/CancelOrderEndpoint.ts', ''),
    ];

    expect(everyFeatureHasHandlerAndEndpoint(semEndpoint)).toEqual([
      'A feature CancelOrder não tem api/features/CancelOrder/CancelOrderEndpoint.ts',
    ]);
    expect(everyFeatureHasHandlerAndEndpoint(semHandler)).toEqual([
      'application/features/CancelOrder/CancelOrder.ts precisa exportar a classe CancelOrderHandler',
    ]);
  });
});
