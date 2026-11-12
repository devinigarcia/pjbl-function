import { describe, expect, it } from 'vitest';
import { CalculateIndicatorsHandler } from '../../../src/application/features/CalculateIndicators/CalculateIndicators';
import { ValidationError } from '../../../src/domain/errors';

const fixedClock = () => new Date('2025-06-10T14:30:00.000Z');

describe('CalculateIndicatorsHandler', () => {
  it('aceita os objetos completos dos microserviços (campos extras passam direto)', () => {
    const handler = new CalculateIndicatorsHandler(fixedClock);

    const result = handler.execute({
      requestedBy: 'bff',
      products: [
        {
          id: 'p1',
          sku: 'CAFE-500G',
          name: 'Café torrado 500g',
          description: 'Torra média',
          category: 'Mercearia',
          price: 24.9,
          stock: 4,
          lowStock: true,
          createdAt: '2025-06-01T10:00:00.000Z',
          updatedAt: '2025-06-01T10:00:00.000Z',
        },
      ],
      orders: [
        {
          id: 'o1',
          customerName: 'Ana Souza',
          customerEmail: 'ana@exemplo.com',
          status: 'PAGO',
          items: [{ productId: 'p1', productName: 'Café torrado 500g', unitPrice: 24.9, quantity: 2, subtotal: 49.8 }],
          total: 49.8,
          itemCount: 2,
          notes: null,
          allowedTransitions: ['ENVIADO', 'CANCELADO'],
        },
      ],
    });

    expect(result.products.lowStock).toEqual([{ id: 'p1', sku: 'CAFE-500G', name: 'Café torrado 500g', stock: 4 }]);
    expect(result.orders.revenue).toBe(49.8);
    expect(result.topProducts).toEqual([{ productId: 'p1', productName: 'Café torrado 500g', quantity: 2, revenue: 49.8 }]);
    expect(result.generatedAt).toBe('2025-06-10T14:30:00.000Z');
    expect(result.computedBy).toBe('azure-function');
  });

  it('trata lista ausente ou null como vazia', () => {
    const handler = new CalculateIndicatorsHandler(fixedClock);

    const result = handler.execute({ products: null });

    expect(result.products.total).toBe(0);
    expect(result.orders.total).toBe(0);
    expect(result.alerts).toEqual([]);
  });

  it('recusa campos com tipo errado apontando o caminho de cada um', () => {
    const handler = new CalculateIndicatorsHandler(fixedClock);

    let caught: unknown;
    try {
      handler.execute({
        products: [{ id: 'p1', sku: 'X', name: 'Sem preço', stock: 1 }],
        orders: [{ status: 'PAGO', total: '49.80', items: [] }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).details).toEqual([
      { field: 'products.0.price', message: 'Campo obrigatório.' },
      { field: 'orders.0.total', message: 'Deve ser número (veio texto).' },
    ]);
  });

  it.each([
    ['um texto', 'isso não é um objeto'],
    ['uma lista', []],
    ['null', null],
    ['products que não é lista', { products: 'todos' }],
    ['estoque negativo', { products: [{ id: 'p1', sku: 'X', name: 'X', price: 1, stock: -1 }] }],
  ])('recusa corpo inválido: %s', (_label, body) => {
    const handler = new CalculateIndicatorsHandler(fixedClock);

    expect(() => handler.execute(body)).toThrow(ValidationError);
  });
});
