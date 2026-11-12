import type { InvocationContext } from '@azure/functions';
import type { ProcessOrderEventHandler } from '../../../application/features/ProcessOrderEvent/ProcessOrderEvent';
import { toLogger } from '../../invocationLogger';

export type ProcessOrderEventEndpoint = (queueItem: unknown, context: InvocationContext) => Promise<void>;

/**
 * Queue Trigger da fila de eventos de pedido.
 * Não tem try/catch de propósito: se o caso de uso lançar (falha temporária no ms-produtos),
 * a exceção precisa chegar ao runtime para a mensagem voltar para a fila.
 */
export function createProcessOrderEventEndpoint(handler: ProcessOrderEventHandler): ProcessOrderEventEndpoint {
  return async (queueItem, context) => {
    const metadata = context.triggerMetadata ?? {};

    await handler.execute(queueItem, {
      logger: toLogger(context),
      messageId: typeof metadata.id === 'string' ? metadata.id : undefined,
      dequeueCount: toNumber(metadata.dequeueCount),
    });
  };
}

function toNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}
