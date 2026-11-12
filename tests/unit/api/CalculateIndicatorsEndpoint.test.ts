import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it } from 'vitest';
import { createCalculateIndicatorsEndpoint } from '../../../src/api/features/CalculateIndicators/CalculateIndicatorsEndpoint';
import { openApiExamples } from '../../../src/api/openapi';
import { CalculateIndicatorsHandler } from '../../../src/application/features/CalculateIndicators/CalculateIndicators';

// Aqui usamos o HttpRequest e o InvocationContext de verdade do SDK @azure/functions,
// do mesmo jeito que o runtime entrega para a function.
const endpoint = createCalculateIndicatorsEndpoint(
  new CalculateIndicatorsHandler(() => new Date('2025-06-10T14:30:00.000Z')),
);

function post(body: string, headers: Record<string, string> = {}): HttpRequest {
  return new HttpRequest({
    method: 'POST',
    url: 'http://localhost:7071/api/indicators',
    headers: { 'content-type': 'application/json', ...headers },
    body: { string: body },
  });
}

function context(): InvocationContext {
  return new InvocationContext({ functionName: 'calculateIndicators', logHandler: () => undefined });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('POST /api/indicators (adaptador HTTP)', () => {
  it('responde 200 com os indicadores no formato do contrato', async () => {
    const body = JSON.stringify({ products: openApiExamples.products, orders: openApiExamples.orders });

    const response = await endpoint(post(body), context());

    expect(response.status).toBe(200);
    // O exemplo publicado no Swagger é exatamente o resultado do cálculo para a entrada de exemplo.
    expect(response.jsonBody).toEqual(openApiExamples.indicators);
    expect(Object.keys(response.jsonBody as object)).toEqual(['products', 'orders', 'topProducts', 'alerts', 'generatedAt', 'computedBy']);
  });

  it('devolve o mesmo x-correlation-id que recebeu', async () => {
    const response = await endpoint(post('{"products":[],"orders":[]}', { 'x-correlation-id': 'bff-abc-123' }), context());

    expect(response.status).toBe(200);
    expect((response.headers as Record<string, string>)['x-correlation-id']).toBe('bff-abc-123');
  });

  it('gera um x-correlation-id quando a requisição não traz', async () => {
    const response = await endpoint(post('{"products":[],"orders":[]}'), context());

    expect((response.headers as Record<string, string>)['x-correlation-id']).toMatch(UUID);
  });

  it('JSON malformado → 400 INVALID_JSON no formato de erro padrão', async () => {
    const response = await endpoint(post('{ "products": [', { 'x-correlation-id': 'corr-1' }), context());

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({
      error: { code: 'INVALID_JSON', message: 'O corpo da requisição não é um JSON válido.', correlationId: 'corr-1' },
    });
  });

  it('corpo vazio também é 400', async () => {
    const response = await endpoint(post(''), context());

    expect(response.status).toBe(400);
    expect((response.jsonBody as { error: { code: string } }).error.code).toBe('INVALID_JSON');
  });

  it('campos inválidos → 400 VALIDATION_ERROR com details e correlationId', async () => {
    const body = JSON.stringify({ products: [{ id: 'p1', sku: 'X', name: 'X', price: 'caro', stock: 2 }], orders: [] });

    const response = await endpoint(post(body, { 'x-correlation-id': 'corr-2' }), context());

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos.',
        details: [{ field: 'products.0.price', message: 'Deve ser número (veio texto).' }],
        correlationId: 'corr-2',
      },
    });
    expect((response.headers as Record<string, string>)['x-correlation-id']).toBe('corr-2');
  });
});
