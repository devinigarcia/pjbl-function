import type { Logger } from '../../src/application/ports/Logger';
import {
  StockServiceUnavailableError,
  type StockGateway,
  type StockMovementResult,
} from '../../src/application/ports/StockGateway';
import type { StockMovementCommand } from '../../src/domain/orderEvent';

/**
 * "ms-produtos" de mentira, em memória. Imita as regras que importam para a Function:
 * idempotência por eventId, 404 para produto que não existe e 409 quando falta estoque.
 */
export class FakeStockGateway implements StockGateway {
  readonly calls: Array<{ command: StockMovementCommand; correlationId: string }> = [];
  private readonly stock = new Map<string, number>();
  private readonly appliedEventIds = new Set<string>();
  private failures: Error[] = [];

  constructor(initialStock: Record<string, number> = {}) {
    for (const [productId, quantity] of Object.entries(initialStock)) this.stock.set(productId, quantity);
  }

  stockOf(productId: string): number | undefined {
    return this.stock.get(productId);
  }

  /** As próximas chamadas falham como se o ms-produtos estivesse fora do ar. */
  failNext(times = 1, error: Error = new StockServiceUnavailableError('ms-produtos respondeu HTTP 503.', 503)): void {
    this.failures = Array.from({ length: times }, () => error);
  }

  /** Faz a chamada falhar só quando chegar em determinado produto (as anteriores passam). */
  failOnProduct?: string;

  async registerMovement(command: StockMovementCommand, correlationId: string): Promise<StockMovementResult> {
    this.calls.push({ command, correlationId });

    const failure = this.failures.shift();
    if (failure) throw failure;
    if (this.failOnProduct === command.productId) {
      throw new StockServiceUnavailableError('ms-produtos respondeu HTTP 500.', 500);
    }

    const current = this.stock.get(command.productId);
    if (current === undefined) {
      return { status: 'rejected', httpStatus: 404, code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado.' };
    }
    if (this.appliedEventIds.has(command.eventId)) {
      return { status: 'duplicate', balanceAfter: current };
    }
    if (command.type === 'SAIDA' && current < command.quantity) {
      return { status: 'rejected', httpStatus: 409, code: 'INSUFFICIENT_STOCK', message: 'Estoque insuficiente.' };
    }

    const balanceAfter = command.type === 'SAIDA' ? current - command.quantity : current + command.quantity;
    this.stock.set(command.productId, balanceAfter);
    this.appliedEventIds.add(command.eventId);
    return { status: 'applied', balanceAfter };
  }
}

export class MemoryLogger implements Logger {
  readonly infos: string[] = [];
  readonly warnings: string[] = [];
  readonly errors: string[] = [];

  info(message: string): void {
    this.infos.push(message);
  }
  warn(message: string): void {
    this.warnings.push(message);
  }
  error(message: string): void {
    this.errors.push(message);
  }
}

/** Evento no formato da seção 4 do contrato (docs/contratos.md do pjbl-arquitetura). */
export function buildOrderEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: 'evt-1',
    type: 'order.created',
    version: 1,
    source: 'ms-pedidos',
    occurredAt: '2025-06-10T14:29:58.120Z',
    correlationId: 'corr-123',
    data: {
      orderId: 'order-1',
      customerName: 'Ana Souza',
      customerEmail: 'ana@exemplo.com',
      status: 'PENDENTE',
      total: 84.8,
      items: [
        { productId: 'cafe', productName: 'Café torrado 500g', quantity: 2, unitPrice: 24.9 },
        { productId: 'caneca', productName: 'Caneca azul 300ml', quantity: 1, unitPrice: 35 },
      ],
    },
    ...overrides,
  };
}
