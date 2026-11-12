import { describe, expect, it } from 'vitest';
import { movementTypeFor, toStockMovements, type OrderEvent } from '../../../src/domain/orderEvent';

function event(type: string, items = [{ productId: 'cafe', quantity: 2 }, { productId: 'caneca', quantity: 1 }]): OrderEvent {
  return { eventId: 'evt-1', type, correlationId: 'corr-1', data: { orderId: 'order-9', items } };
}

describe('tradução de evento de pedido em movimentações de estoque', () => {
  it('order.created vira uma SAÍDA por item, com eventId "<eventId>:<productId>"', () => {
    expect(toStockMovements(event('order.created'))).toEqual([
      { productId: 'cafe', type: 'SAIDA', quantity: 2, reason: 'Pedido order-9 criado', eventId: 'evt-1:cafe' },
      { productId: 'caneca', type: 'SAIDA', quantity: 1, reason: 'Pedido order-9 criado', eventId: 'evt-1:caneca' },
    ]);
  });

  it('order.cancelled vira uma ENTRADA por item (devolução)', () => {
    expect(toStockMovements(event('order.cancelled'))).toEqual([
      { productId: 'cafe', type: 'ENTRADA', quantity: 2, reason: 'Pedido order-9 cancelado (devolução)', eventId: 'evt-1:cafe' },
      { productId: 'caneca', type: 'ENTRADA', quantity: 1, reason: 'Pedido order-9 cancelado (devolução)', eventId: 'evt-1:caneca' },
    ]);
  });

  it('tipos de evento que não mexem em estoque não geram movimentação', () => {
    expect(movementTypeFor('order.paid')).toBeNull();
    expect(toStockMovements(event('order.paid'))).toEqual([]);
  });

  it('produto repetido no mesmo evento vira uma movimentação só, com as quantidades somadas', () => {
    const movements = toStockMovements(
      event('order.created', [
        { productId: 'cafe', quantity: 2 },
        { productId: 'caneca', quantity: 1 },
        { productId: 'cafe', quantity: 3 },
      ]),
    );

    expect(movements).toHaveLength(2);
    expect(movements[0]).toMatchObject({ productId: 'cafe', quantity: 5, eventId: 'evt-1:cafe' });
  });
});
