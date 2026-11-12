import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/infrastructure/config';

describe('loadConfig', () => {
  it('usa os padrões quando as app settings não foram definidas', () => {
    expect(loadConfig({})).toEqual({
      produtosApiUrl: 'http://localhost:3001',
      produtosApiKey: undefined,
      produtosTimeoutMs: 8000,
      orderEventsQueue: 'order-events',
    });
  });

  it('lê as app settings, tira a barra do final da URL e ignora valores em branco', () => {
    const config = loadConfig({
      PRODUTOS_API_URL: ' https://ms-produtos.exemplo.com/ ',
      PRODUTOS_API_KEY: 'chave-de-teste',
      PRODUTOS_API_TIMEOUT_MS: '2500',
      ORDER_EVENTS_QUEUE: '   ',
    });

    expect(config).toEqual({
      produtosApiUrl: 'https://ms-produtos.exemplo.com',
      produtosApiKey: 'chave-de-teste',
      produtosTimeoutMs: 2500,
      orderEventsQueue: 'order-events',
    });
  });
});
