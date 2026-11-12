export type StockMovementType = 'ENTRADA' | 'SAIDA';

export const ORDER_CREATED = 'order.created';
export const ORDER_CANCELLED = 'order.cancelled';

export interface OrderEventItem {
  productId: string;
  quantity: number;
}

/** Só a parte do evento que interessa para mexer no estoque. */
export interface OrderEvent {
  eventId: string;
  type: string;
  correlationId?: string | null;
  data: {
    orderId: string;
    items: OrderEventItem[];
  };
}

/** Movimentação que será pedida ao ms-produtos (POST /products/{id}/stock-movements). */
export interface StockMovementCommand {
  productId: string;
  type: StockMovementType;
  quantity: number;
  reason: string;
  eventId: string;
}

/** Pedido criado tira do estoque; pedido cancelado devolve. Outros tipos não mexem em nada. */
export function movementTypeFor(eventType: string): StockMovementType | null {
  if (eventType === ORDER_CREATED) return 'SAIDA';
  if (eventType === ORDER_CANCELLED) return 'ENTRADA';
  return null;
}

/**
 * A chave de idempotência é por evento + produto. Assim, se a mensagem for entregue
 * de novo (a fila é at-least-once), o ms-produtos reconhece e não baixa duas vezes.
 */
export function movementEventId(eventId: string, productId: string): string {
  return `${eventId}:${productId}`;
}

export function movementReason(type: StockMovementType, orderId: string): string {
  return type === 'SAIDA' ? `Pedido ${orderId} criado` : `Pedido ${orderId} cancelado (devolução)`;
}

/**
 * Traduz o evento em uma movimentação por produto.
 * Devolve lista vazia quando o tipo do evento não afeta o estoque.
 */
export function toStockMovements(event: OrderEvent): StockMovementCommand[] {
  const type = movementTypeFor(event.type);
  if (!type) return [];

  // O ms-pedidos não deixa repetir produto no pedido, mas se um dia vier repetido
  // somamos as quantidades: duas movimentações com a mesma chave virariam "duplicada".
  const quantityByProduct = new Map<string, number>();
  for (const item of event.data.items) {
    quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? 0) + item.quantity);
  }

  const reason = movementReason(type, event.data.orderId);
  return [...quantityByProduct.entries()].map(([productId, quantity]) => ({
    productId,
    type,
    quantity,
    reason,
    eventId: movementEventId(event.eventId, productId),
  }));
}
