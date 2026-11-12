export interface AppConfig {
  /** URL base do ms-produtos, sem barra no final. */
  produtosApiUrl: string;
  /** Chave interna enviada em `x-api-key` (opcional em desenvolvimento). */
  produtosApiKey?: string;
  produtosTimeoutMs: number;
  /** Nome da fila de eventos de pedido. */
  orderEventsQueue: string;
}

export const DEFAULT_PRODUTOS_API_URL = 'http://localhost:3001';
export const DEFAULT_ORDER_EVENTS_QUEUE = 'order-events';
export const DEFAULT_PRODUTOS_TIMEOUT_MS = 8000;

type Env = Record<string, string | undefined>;

/**
 * Lê as app settings. Nada aqui é obrigatório de propósito: se faltar a URL do ms-produtos,
 * o health e o cálculo de indicadores continuam funcionando e só o consumo de eventos falha
 * (e a mensagem volta para a fila até alguém corrigir a configuração).
 */
export function loadConfig(env: Env = process.env): AppConfig {
  const timeout = Number(env.PRODUTOS_API_TIMEOUT_MS);

  return {
    produtosApiUrl: (clean(env.PRODUTOS_API_URL) ?? DEFAULT_PRODUTOS_API_URL).replace(/\/+$/, ''),
    produtosApiKey: clean(env.PRODUTOS_API_KEY),
    produtosTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_PRODUTOS_TIMEOUT_MS,
    orderEventsQueue: clean(env.ORDER_EVENTS_QUEUE) ?? DEFAULT_ORDER_EVENTS_QUEUE,
  };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
