import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StockServiceUnavailableError } from '../../src/application/ports/StockGateway';
import type { StockMovementCommand } from '../../src/domain/orderEvent';
import { ProdutosHttpStockGateway } from '../../src/infrastructure/ProdutosHttpStockGateway';

// Sobe um servidor node:http fazendo o papel do ms-produtos e chama o cliente de verdade (fetch).

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

interface FakeReply {
  status: number;
  body?: unknown;
  rawBody?: string;
  delayMs?: number;
}

let server: Server;
let baseUrl: string;
let requests: RecordedRequest[];
let reply: FakeReply;

beforeEach(async () => {
  requests = [];
  reply = { status: 201, body: {} };

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: text ? JSON.parse(text) : undefined });

      const send = () => {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(reply.rawBody ?? (reply.body === undefined ? '' : JSON.stringify(reply.body)));
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const command: StockMovementCommand = {
  productId: 'prod-1',
  type: 'SAIDA',
  quantity: 2,
  reason: 'Pedido order-1 criado',
  eventId: 'evt-1:prod-1',
};

function gateway(options: { apiKey?: string; timeoutMs?: number; url?: string } = {}): ProdutosHttpStockGateway {
  return new ProdutosHttpStockGateway({
    baseUrl: options.url ?? baseUrl,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs ?? 2000,
  });
}

describe('ProdutosHttpStockGateway (contra um ms-produtos falso em node:http)', () => {
  it('faz o POST na rota do contrato com corpo, x-api-key e x-correlation-id', async () => {
    reply = {
      status: 201,
      body: { movement: { id: 'm1', balanceAfter: 10 }, product: { id: 'prod-1', stock: 10 }, duplicate: false },
    };

    const result = await gateway({ apiKey: 'chave-de-teste', url: `${baseUrl}/` }).registerMovement(command, 'corr-xyz');

    expect(result).toEqual({ status: 'applied', balanceAfter: 10 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/products/prod-1/stock-movements',
      body: { type: 'SAIDA', quantity: 2, reason: 'Pedido order-1 criado', eventId: 'evt-1:prod-1' },
    });
    expect(requests[0]?.headers['x-api-key']).toBe('chave-de-teste');
    expect(requests[0]?.headers['x-correlation-id']).toBe('corr-xyz');
    expect(requests[0]?.headers['content-type']).toBe('application/json');
  });

  it('não manda x-api-key quando a chave não está configurada', async () => {
    await gateway().registerMovement(command, 'corr-1');

    expect(requests[0]?.headers).not.toHaveProperty('x-api-key');
  });

  it('200 com duplicate:true vira "duplicate" (evento já aplicado)', async () => {
    reply = { status: 200, body: { movement: { balanceAfter: 8 }, product: { stock: 8 }, duplicate: true } };

    const result = await gateway().registerMovement(command, 'corr-1');

    expect(result).toEqual({ status: 'duplicate', balanceAfter: 8 });
  });

  it('404 vira "rejected" com o código de erro do ms-produtos', async () => {
    reply = { status: 404, body: { error: { code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado.', correlationId: 'corr-1' } } };

    const result = await gateway().registerMovement(command, 'corr-1');

    expect(result).toEqual({ status: 'rejected', httpStatus: 404, code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado.' });
  });

  it('409 vira "rejected" (estoque insuficiente)', async () => {
    reply = { status: 409, body: { error: { code: 'INSUFFICIENT_STOCK', message: 'Estoque insuficiente.' } } };

    const result = await gateway().registerMovement(command, 'corr-1');

    expect(result).toMatchObject({ status: 'rejected', httpStatus: 409, code: 'INSUFFICIENT_STOCK' });
  });

  it.each([500, 503, 429, 401])('HTTP %i é tratado como falha que precisa de retry', async (status) => {
    reply = { status, rawBody: '<html>erro</html>' };

    const promise = gateway().registerMovement(command, 'corr-1');

    await expect(promise).rejects.toBeInstanceOf(StockServiceUnavailableError);
    await expect(promise).rejects.toMatchObject({ httpStatus: status });
  });

  it('estoura o timeout quando o ms-produtos demora demais', async () => {
    reply = { status: 201, body: {}, delayMs: 500 };

    await expect(gateway({ timeoutMs: 50 }).registerMovement(command, 'corr-1')).rejects.toThrow('não respondeu em 50 ms');
  });

  it('falha de conexão vira StockServiceUnavailableError', async () => {
    // porta de um servidor que acabamos de fechar: ninguém escutando
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const deadUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const promise = gateway({ url: deadUrl }).registerMovement(command, 'corr-1');

    await expect(promise).rejects.toBeInstanceOf(StockServiceUnavailableError);
    await expect(promise).rejects.toThrow('Falha de rede');
  });
});
