import { describe, expect, it } from 'vitest';
import { ProcessOrderEventHandler } from '../../../src/application/features/ProcessOrderEvent/ProcessOrderEvent';
import { StockServiceUnavailableError } from '../../../src/application/ports/StockGateway';
import { buildOrderEvent, FakeStockGateway, MemoryLogger } from '../../helpers/fakes';

function setup(initialStock: Record<string, number> = { cafe: 10, caneca: 4 }) {
  const gateway = new FakeStockGateway(initialStock);
  const logger = new MemoryLogger();
  const handler = new ProcessOrderEventHandler(gateway);
  return { gateway, logger, handler };
}

describe('ProcessOrderEventHandler', () => {
  it('order.created registra uma SAÍDA por item e repassa o correlationId do evento', async () => {
    const { gateway, logger, handler } = setup();

    const result = await handler.execute(buildOrderEvent(), { logger });

    expect(result).toEqual({ status: 'processed', eventId: 'evt-1', type: 'order.created', applied: 2, duplicates: 0, rejected: 0 });
    expect(gateway.calls).toEqual([
      {
        command: { productId: 'cafe', type: 'SAIDA', quantity: 2, reason: 'Pedido order-1 criado', eventId: 'evt-1:cafe' },
        correlationId: 'corr-123',
      },
      {
        command: { productId: 'caneca', type: 'SAIDA', quantity: 1, reason: 'Pedido order-1 criado', eventId: 'evt-1:caneca' },
        correlationId: 'corr-123',
      },
    ]);
    expect(gateway.stockOf('cafe')).toBe(8);
    expect(gateway.stockOf('caneca')).toBe(3);
  });

  it('order.cancelled devolve o estoque com ENTRADA', async () => {
    const { gateway, logger, handler } = setup();
    await handler.execute(buildOrderEvent(), { logger });

    const result = await handler.execute(buildOrderEvent({ eventId: 'evt-2', type: 'order.cancelled' }), { logger });

    expect(result).toMatchObject({ status: 'processed', type: 'order.cancelled', applied: 2 });
    expect(gateway.calls.at(-1)?.command).toEqual({
      productId: 'caneca',
      type: 'ENTRADA',
      quantity: 1,
      reason: 'Pedido order-1 cancelado (devolução)',
      eventId: 'evt-2:caneca',
    });
    expect(gateway.stockOf('cafe')).toBe(10);
    expect(gateway.stockOf('caneca')).toBe(4);
  });

  it('é idempotente: a mesma mensagem entregue duas vezes não baixa o estoque em dobro', async () => {
    const { gateway, logger, handler } = setup();

    await handler.execute(buildOrderEvent(), { logger });
    const second = await handler.execute(buildOrderEvent(), { logger, dequeueCount: 2 });

    expect(second).toMatchObject({ status: 'processed', applied: 0, duplicates: 2, rejected: 0 });
    expect(gateway.stockOf('cafe')).toBe(8);
    expect(gateway.stockOf('caneca')).toBe(3);
  });

  it('entende a mensagem como texto JSON e também ainda em Base64', async () => {
    const { gateway, logger, handler } = setup();
    const json = JSON.stringify(buildOrderEvent());
    const base64 = Buffer.from(JSON.stringify(buildOrderEvent({ eventId: 'evt-b64' })), 'utf8').toString('base64');

    const fromText = await handler.execute(json, { logger });
    const fromBase64 = await handler.execute(base64, { logger });

    expect(fromText).toMatchObject({ status: 'processed', eventId: 'evt-1', applied: 2 });
    expect(fromBase64).toMatchObject({ status: 'processed', eventId: 'evt-b64', applied: 2 });
    expect(gateway.stockOf('cafe')).toBe(6);
  });

  it.each([
    ['texto que não é JSON', 'olá, fila!'],
    ['null', null],
    ['JSON sem eventId', { type: 'order.created', data: { orderId: 'o1', items: [{ productId: 'cafe', quantity: 1 }] } }],
    ['pedido sem itens', buildOrderEvent({ data: { orderId: 'o1', items: [] } })],
    ['quantidade inválida', buildOrderEvent({ data: { orderId: 'o1', items: [{ productId: 'cafe', quantity: 0 }] } })],
    ['evento sem data', { eventId: 'evt-1', type: 'order.created' }],
  ])('mensagem inválida (%s) é logada e descartada, sem lançar erro', async (_label, message) => {
    const { gateway, logger, handler } = setup();

    const result = await handler.execute(message, { logger, messageId: 'msg-42' });

    expect(result.status).toBe('discarded');
    expect(gateway.calls).toHaveLength(0);
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('msg-42');
  });

  it('tipo de evento desconhecido é ignorado sem chamar o ms-produtos', async () => {
    const { gateway, logger, handler } = setup();

    const result = await handler.execute(buildOrderEvent({ type: 'order.paid' }), { logger });

    expect(result).toEqual({ status: 'ignored', eventId: 'evt-1', type: 'order.paid' });
    expect(gateway.calls).toHaveLength(0);
    expect(logger.errors).toHaveLength(0);
  });

  it('404 (produto removido) gera warning, não relança e os outros itens seguem', async () => {
    const { gateway, logger, handler } = setup({ caneca: 4 }); // "cafe" não existe mais

    const result = await handler.execute(buildOrderEvent(), { logger });

    expect(result).toMatchObject({ status: 'processed', applied: 1, rejected: 1 });
    expect(gateway.stockOf('caneca')).toBe(3);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain('404');
    expect(logger.warnings[0]).toContain('PRODUCT_NOT_FOUND');
  });

  it('409 (estoque insuficiente) gera warning, não relança e os outros itens seguem', async () => {
    const { gateway, logger, handler } = setup({ cafe: 1, caneca: 4 });

    const result = await handler.execute(buildOrderEvent(), { logger });

    expect(result).toMatchObject({ status: 'processed', applied: 1, rejected: 1 });
    expect(gateway.stockOf('cafe')).toBe(1);
    expect(gateway.stockOf('caneca')).toBe(3);
    expect(logger.warnings[0]).toContain('INSUFFICIENT_STOCK');
  });

  it('falha temporária (5xx/rede) é relançada para o runtime reentregar a mensagem', async () => {
    const { gateway, logger, handler } = setup();
    gateway.failNext(1);

    await expect(handler.execute(buildOrderEvent(), { logger })).rejects.toBeInstanceOf(StockServiceUnavailableError);
    expect(gateway.stockOf('cafe')).toBe(10);
  });

  it('se falhar no meio, a reentrega completa o que faltou sem repetir o que já foi aplicado', async () => {
    const { gateway, logger, handler } = setup();
    gateway.failOnProduct = 'caneca';

    await expect(handler.execute(buildOrderEvent(), { logger })).rejects.toThrow('HTTP 500');
    expect(gateway.stockOf('cafe')).toBe(8);
    expect(gateway.stockOf('caneca')).toBe(4);

    gateway.failOnProduct = undefined;
    const retry = await handler.execute(buildOrderEvent(), { logger, dequeueCount: 2 });

    expect(retry).toMatchObject({ status: 'processed', applied: 1, duplicates: 1 });
    expect(gateway.stockOf('cafe')).toBe(8);
    expect(gateway.stockOf('caneca')).toBe(3);
  });

  it('usa o eventId como correlationId quando o evento não traz um', async () => {
    const { gateway, logger, handler } = setup();

    await handler.execute(buildOrderEvent({ correlationId: undefined }), { logger });

    expect(gateway.calls[0]?.correlationId).toBe('evt-1');
  });
});
