import { HttpRequest } from '@azure/functions';
import { describe, expect, it } from 'vitest';
import { docsEndpoint } from '../../../src/api/docs';
import { healthEndpoint } from '../../../src/api/health';
import { buildOpenApiDocument, createOpenApiEndpoint } from '../../../src/api/openapi';

function get(path: string, headers: Record<string, string> = {}): HttpRequest {
  return new HttpRequest({ method: 'GET', url: `http://localhost:7071${path}`, headers });
}

/** Junta todos os "$ref" do documento para conferir se apontam para algo que existe. */
function collectRefs(node: unknown, refs: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectRefs(child, refs);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') refs.push(value);
      else collectRefs(value, refs);
    }
  }
  return refs;
}

describe('GET /api/health', () => {
  it('responde ok com o nome do serviço, como o contrato pede', async () => {
    const response = await healthEndpoint(get('/api/health', { 'x-correlation-id': 'corr-h' }));

    expect(response.status).toBe(200);
    expect(response.jsonBody).toEqual({ status: 'ok', service: 'pjbl-function', timestamp: expect.any(String) });
    expect(Number.isNaN(Date.parse((response.jsonBody as { timestamp: string }).timestamp))).toBe(false);
    expect((response.headers as Record<string, string>)['x-correlation-id']).toBe('corr-h');
  });
});

describe('GET /api/openapi.json', () => {
  const document = buildOpenApiDocument({ queueName: 'order-events' }) as {
    openapi: string;
    info: { description: string };
    paths: Record<string, Record<string, { security?: unknown[] }>>;
    components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
  };

  it('documenta as rotas HTTP e descreve o queue trigger', () => {
    expect(document.openapi).toMatch(/^3\.0\./);
    expect(Object.keys(document.paths)).toEqual(['/indicators', '/health', '/openapi.json', '/docs']);
    expect(document.paths['/indicators']?.post?.security).toEqual([{ functionKey: [] }]);
    expect(document.info.description).toContain('processOrderEvent');
    expect(document.info.description).toContain('order-events-poison');
  });

  it('todas as referências ($ref) apontam para schemas que existem', () => {
    const refs = collectRefs(document);

    expect(refs.length).toBeGreaterThan(5);
    for (const ref of refs) {
      const name = ref.replace('#/components/schemas/', '');
      expect(document.components.schemas, `schema ${ref} não existe`).toHaveProperty(name);
    }
  });

  it('o endpoint devolve o documento como JSON', async () => {
    const response = await createOpenApiEndpoint({ queueName: 'fila-de-teste' })(get('/api/openapi.json'));

    expect(response.status).toBe(200);
    expect((response.headers as Record<string, string>)['content-type']).toContain('application/json');
    expect(JSON.stringify(response.jsonBody)).toContain('fila-de-teste-poison');
  });
});

describe('GET /api/docs', () => {
  it('entrega a página do Swagger UI apontando para o openapi.json da própria Function', async () => {
    const response = await docsEndpoint(get('/api/docs'));

    expect(response.status).toBe(200);
    expect((response.headers as Record<string, string>)['content-type']).toContain('text/html');
    expect(response.body).toContain('https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js');
    expect(response.body).toContain('url: "/api/openapi.json"');
  });
});
