import { formatBRL, round2 } from './money';

// Mesma régua do ms-produtos: com 5 unidades ou menos o produto já é "estoque baixo".
export const LOW_STOCK_THRESHOLD = 5;
export const TOP_PRODUCTS_LIMIT = 5;
// Acima de 20% de pedidos cancelados a gente avisa no painel.
export const HIGH_CANCELLATION_RATE = 0.2;

export const ORDER_STATUSES = ['PENDENTE', 'PAGO', 'ENVIADO', 'ENTREGUE', 'CANCELADO'] as const;

// Só entra como faturamento o que já foi pago (mesmo que ainda esteja a caminho).
const REVENUE_STATUSES: ReadonlySet<string> = new Set(['PAGO', 'ENVIADO', 'ENTREGUE']);
const UNCATEGORIZED = 'Sem categoria';

/** O mínimo que precisamos saber de um produto para calcular os indicadores. */
export interface ProductSnapshot {
  id: string;
  sku: string;
  name: string;
  category?: string | null;
  price: number;
  stock: number;
}

export interface OrderItemSnapshot {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
}

export interface OrderSnapshot {
  status: string;
  total: number;
  items: OrderItemSnapshot[];
}

export interface LowStockProduct {
  id: string;
  sku: string;
  name: string;
  stock: number;
}

export interface CategorySummary {
  category: string;
  count: number;
  units: number;
  value: number;
}

export interface ProductIndicators {
  total: number;
  totalUnitsInStock: number;
  inventoryValue: number;
  lowStock: LowStockProduct[];
  outOfStock: number;
  byCategory: CategorySummary[];
}

export interface OrderIndicators {
  total: number;
  byStatus: Record<string, number>;
  revenue: number;
  averageTicket: number;
  pendingValue: number;
  cancellationRate: number;
}

export interface TopProduct {
  productId: string;
  productName: string;
  quantity: number;
  revenue: number;
}

export interface Indicators {
  products: ProductIndicators;
  orders: OrderIndicators;
  topProducts: TopProduct[];
  alerts: string[];
  generatedAt: string;
  computedBy: 'azure-function';
}

/**
 * Ponto de entrada do cálculo. Função pura: mesma entrada, mesma saída
 * (a data vem de fora justamente para dar para testar).
 */
export function calculateIndicators(
  products: readonly ProductSnapshot[],
  orders: readonly OrderSnapshot[],
  now: Date,
): Indicators {
  const productIndicators = summarizeProducts(products);
  const orderIndicators = summarizeOrders(orders);

  return {
    products: productIndicators,
    orders: orderIndicators,
    topProducts: rankTopProducts(orders),
    alerts: buildAlerts(productIndicators, orderIndicators),
    generatedAt: now.toISOString(),
    computedBy: 'azure-function',
  };
}

export function summarizeProducts(products: readonly ProductSnapshot[]): ProductIndicators {
  let totalUnitsInStock = 0;
  let inventoryValue = 0;
  let outOfStock = 0;
  const lowStock: LowStockProduct[] = [];
  const categories = new Map<string, CategorySummary>();

  for (const product of products) {
    const value = product.price * product.stock;
    totalUnitsInStock += product.stock;
    inventoryValue += value;

    if (product.stock === 0) outOfStock += 1;
    if (product.stock <= LOW_STOCK_THRESHOLD) {
      lowStock.push({ id: product.id, sku: product.sku, name: product.name, stock: product.stock });
    }

    const categoryName = product.category?.trim() || UNCATEGORIZED;
    const summary = categories.get(categoryName) ?? { category: categoryName, count: 0, units: 0, value: 0 };
    summary.count += 1;
    summary.units += product.stock;
    summary.value += value;
    categories.set(categoryName, summary);
  }

  // Os mais críticos primeiro; empate resolve pelo nome para a ordem ficar estável.
  lowStock.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, 'pt-BR'));

  const byCategory = [...categories.values()]
    .map((summary) => ({ ...summary, value: round2(summary.value) }))
    .sort((a, b) => a.category.localeCompare(b.category, 'pt-BR'));

  return {
    total: products.length,
    totalUnitsInStock,
    inventoryValue: round2(inventoryValue),
    lowStock,
    outOfStock,
    byCategory,
  };
}

export function summarizeOrders(orders: readonly OrderSnapshot[]): OrderIndicators {
  // Começa com todos os status zerados para o front não precisar tratar chave faltando.
  const byStatus: Record<string, number> = {};
  for (const status of ORDER_STATUSES) byStatus[status] = 0;

  let revenue = 0;
  let paidOrders = 0;
  let pendingValue = 0;

  for (const order of orders) {
    byStatus[order.status] = (byStatus[order.status] ?? 0) + 1;

    if (REVENUE_STATUSES.has(order.status)) {
      revenue += order.total;
      paidOrders += 1;
    } else if (order.status === 'PENDENTE') {
      pendingValue += order.total;
    }
  }

  const cancelled = byStatus['CANCELADO'] ?? 0;

  return {
    total: orders.length,
    byStatus,
    revenue: round2(revenue),
    averageTicket: paidOrders > 0 ? round2(revenue / paidOrders) : 0,
    pendingValue: round2(pendingValue),
    cancellationRate: orders.length > 0 ? round2(cancelled / orders.length) : 0,
  };
}

export function rankTopProducts(orders: readonly OrderSnapshot[]): TopProduct[] {
  const sales = new Map<string, TopProduct>();

  for (const order of orders) {
    // Pedido cancelado devolve o estoque, então não conta como venda.
    if (order.status === 'CANCELADO') continue;

    for (const item of order.items) {
      const entry = sales.get(item.productId) ?? {
        productId: item.productId,
        productName: item.productName,
        quantity: 0,
        revenue: 0,
      };
      entry.quantity += item.quantity;
      entry.revenue += item.unitPrice * item.quantity;
      sales.set(item.productId, entry);
    }
  }

  return [...sales.values()]
    .map((entry) => ({ ...entry, revenue: round2(entry.revenue) }))
    .sort(
      (a, b) =>
        b.quantity - a.quantity ||
        b.revenue - a.revenue ||
        a.productName.localeCompare(b.productName, 'pt-BR'),
    )
    .slice(0, TOP_PRODUCTS_LIMIT);
}

export function buildAlerts(products: ProductIndicators, orders: OrderIndicators): string[] {
  const alerts: string[] = [];

  const lowStockCount = products.lowStock.length;
  if (lowStockCount > 0) {
    alerts.push(
      lowStockCount === 1
        ? '1 produto está com estoque baixo.'
        : `${lowStockCount} produtos estão com estoque baixo.`,
    );
  }

  if (products.outOfStock > 0) {
    alerts.push(
      products.outOfStock === 1
        ? '1 produto está zerado no estoque.'
        : `${products.outOfStock} produtos estão zerados no estoque.`,
    );
  }

  const pending = orders.byStatus['PENDENTE'] ?? 0;
  if (pending > 0) {
    const value = formatBRL(orders.pendingValue);
    alerts.push(
      pending === 1
        ? `1 pedido pendente aguardando pagamento (${value}).`
        : `${pending} pedidos pendentes aguardando pagamento (${value}).`,
    );
  }

  if (orders.cancellationRate > HIGH_CANCELLATION_RATE) {
    const percent = Math.round(orders.cancellationRate * 100);
    alerts.push(`Taxa de cancelamento alta: ${percent}% dos pedidos foram cancelados.`);
  }

  return alerts;
}
