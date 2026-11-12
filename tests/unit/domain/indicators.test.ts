import { describe, expect, it } from 'vitest';
import {
  calculateIndicators,
  type OrderSnapshot,
  type ProductSnapshot,
} from '../../../src/domain/indicators';
import { formatBRL, round2 } from '../../../src/domain/money';

const NOW = new Date('2025-06-10T14:30:00.000Z');

function product(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return { id: 'p1', sku: 'SKU-1', name: 'Produto 1', category: 'Mercearia', price: 10, stock: 20, ...overrides };
}

function order(status: string, total: number, items: OrderSnapshot['items'] = []): OrderSnapshot {
  return { status, total, items };
}

function item(productId: string, quantity: number, unitPrice = 10): OrderSnapshot['items'][number] {
  return { productId, productName: `Produto ${productId}`, unitPrice, quantity };
}

describe('calculateIndicators', () => {
  it('devolve tudo zerado quando não há produtos nem pedidos', () => {
    const result = calculateIndicators([], [], NOW);

    expect(result).toEqual({
      products: { total: 0, totalUnitsInStock: 0, inventoryValue: 0, lowStock: [], outOfStock: 0, byCategory: [] },
      orders: {
        total: 0,
        byStatus: { PENDENTE: 0, PAGO: 0, ENVIADO: 0, ENTREGUE: 0, CANCELADO: 0 },
        revenue: 0,
        averageTicket: 0,
        pendingValue: 0,
        cancellationRate: 0,
      },
      topProducts: [],
      alerts: [],
      generatedAt: '2025-06-10T14:30:00.000Z',
      computedBy: 'azure-function',
    });
  });

  it('soma unidades e valor do estoque arredondando para 2 casas', () => {
    const result = calculateIndicators(
      [product({ price: 24.9, stock: 12 }), product({ id: 'p2', price: 0.1, stock: 3 }), product({ id: 'p3', price: 19.99, stock: 7 })],
      [],
      NOW,
    );

    expect(result.products.total).toBe(3);
    expect(result.products.totalUnitsInStock).toBe(22);
    // 298.8 + 0.3 + 139.93 — em ponto flutuante puro daria 439.03000000000003
    expect(result.products.inventoryValue).toBe(439.03);
  });

  it('lista estoque baixo (5 ou menos) do mais crítico para o menos e conta os zerados', () => {
    const result = calculateIndicators(
      [
        product({ id: 'a', sku: 'A', name: 'Abacaxi', stock: 5 }),
        product({ id: 'b', sku: 'B', name: 'Banana', stock: 6 }),
        product({ id: 'c', sku: 'C', name: 'Caju', stock: 0 }),
        product({ id: 'd', sku: 'D', name: 'Damasco', stock: 2 }),
      ],
      [],
      NOW,
    );

    expect(result.products.lowStock).toEqual([
      { id: 'c', sku: 'C', name: 'Caju', stock: 0 },
      { id: 'd', sku: 'D', name: 'Damasco', stock: 2 },
      { id: 'a', sku: 'A', name: 'Abacaxi', stock: 5 },
    ]);
    expect(result.products.outOfStock).toBe(1);
  });

  it('agrupa por categoria em ordem alfabética e junta quem não tem categoria', () => {
    const result = calculateIndicators(
      [
        product({ id: 'a', category: 'Utilidades', price: 35, stock: 3 }),
        product({ id: 'b', category: 'Mercearia', price: 24.9, stock: 12 }),
        product({ id: 'c', category: 'Mercearia', price: 6.5, stock: 0 }),
        product({ id: 'd', category: null, price: 1, stock: 1 }),
        product({ id: 'e', category: '  ', price: 2, stock: 2 }),
      ],
      [],
      NOW,
    );

    expect(result.products.byCategory).toEqual([
      { category: 'Mercearia', count: 2, units: 12, value: 298.8 },
      { category: 'Sem categoria', count: 2, units: 3, value: 5 },
      { category: 'Utilidades', count: 1, units: 3, value: 105 },
    ]);
  });

  it('conta pedidos por status mantendo os cinco status mesmo zerados', () => {
    const result = calculateIndicators([], [order('PENDENTE', 10), order('PENDENTE', 20), order('ENTREGUE', 30)], NOW);

    expect(result.orders.total).toBe(3);
    expect(result.orders.byStatus).toEqual({ PENDENTE: 2, PAGO: 0, ENVIADO: 0, ENTREGUE: 1, CANCELADO: 0 });
  });

  it('faturamento considera só PAGO, ENVIADO e ENTREGUE; ticket médio divide por esses pedidos', () => {
    const result = calculateIndicators(
      [],
      [order('PAGO', 100.1), order('ENVIADO', 50.2), order('ENTREGUE', 149.7), order('PENDENTE', 49.8), order('CANCELADO', 999)],
      NOW,
    );

    expect(result.orders.revenue).toBe(300);
    expect(result.orders.averageTicket).toBe(100);
    expect(result.orders.pendingValue).toBe(49.8);
    expect(result.orders.cancellationRate).toBe(0.2);
  });

  it('ticket médio é 0 quando ainda não há pedido pago e a taxa de cancelamento é arredondada', () => {
    const result = calculateIndicators([], [order('PENDENTE', 10), order('PENDENTE', 15.55), order('CANCELADO', 30)], NOW);

    expect(result.orders.revenue).toBe(0);
    expect(result.orders.averageTicket).toBe(0);
    expect(result.orders.pendingValue).toBe(25.55);
    expect(result.orders.cancellationRate).toBe(0.33);
  });

  it('top produtos ignora pedidos cancelados e soma o mesmo produto de pedidos diferentes', () => {
    const result = calculateIndicators(
      [],
      [
        order('PAGO', 0, [item('cafe', 2, 24.9), item('caneca', 1, 35)]),
        order('PENDENTE', 0, [item('cafe', 5, 24.9)]),
        order('CANCELADO', 0, [item('caneca', 50, 35), item('fantasma', 99, 1)]),
      ],
      NOW,
    );

    expect(result.topProducts).toEqual([
      { productId: 'cafe', productName: 'Produto cafe', quantity: 7, revenue: 174.3 },
      { productId: 'caneca', productName: 'Produto caneca', quantity: 1, revenue: 35 },
    ]);
  });

  it('top produtos fica limitado a 5, por quantidade, desempatando pelo faturamento', () => {
    const result = calculateIndicators(
      [],
      [
        order('PAGO', 0, [
          item('a', 1),
          item('b', 9),
          item('c', 4, 10),
          item('d', 4, 20),
          item('e', 7),
          item('f', 2),
          item('g', 3),
        ]),
      ],
      NOW,
    );

    expect(result.topProducts.map((top) => top.productId)).toEqual(['b', 'e', 'd', 'c', 'g']);
  });

  it('gera os alertas em português com singular e plural certos', () => {
    const result = calculateIndicators(
      [product({ id: 'a', stock: 0 }), product({ id: 'b', stock: 3 }), product({ id: 'c', stock: 50 })],
      [order('PENDENTE', 1234.5), order('CANCELADO', 10), order('PAGO', 10)],
      NOW,
    );

    expect(result.alerts).toEqual([
      '2 produtos estão com estoque baixo.',
      '1 produto está zerado no estoque.',
      '1 pedido pendente aguardando pagamento (R$ 1.234,50).',
      'Taxa de cancelamento alta: 33% dos pedidos foram cancelados.',
    ]);
  });

  it('não alerta cancelamento quando a taxa está em 20% ou menos, nem estoque quando está tudo bem', () => {
    const result = calculateIndicators(
      [product({ stock: 6 })],
      [order('CANCELADO', 10), order('PAGO', 10), order('PAGO', 10), order('ENVIADO', 10), order('ENTREGUE', 10)],
      NOW,
    );

    expect(result.orders.cancellationRate).toBe(0.2);
    expect(result.alerts).toEqual([]);
  });
});

describe('money', () => {
  it('round2 arredonda meio centavo para cima', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(10)).toBe(10);
  });

  it('formatBRL usa vírgula nos centavos e ponto no milhar', () => {
    expect(formatBRL(49.8)).toBe('R$ 49,80');
    expect(formatBRL(1234567.891)).toBe('R$ 1.234.567,89');
  });
});
