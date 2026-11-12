import { z } from 'zod';
import { ValidationError } from '../../../domain/errors';
import { movementTypeFor, toStockMovements } from '../../../domain/orderEvent';
import type { Logger } from '../../ports/Logger';
import type { StockGateway } from '../../ports/StockGateway';
import { validate } from '../../validation';

// Só exigimos o que é usado para movimentar o estoque; o resto do evento passa direto.
export const orderEventSchema = z
  .object({
    eventId: z.string().min(1),
    type: z.string().min(1),
    correlationId: z.string().nullish(),
    data: z
      .object({
        orderId: z.string().min(1),
        items: z
          .array(
            z
              .object({
                productId: z.string().min(1),
                quantity: z.number().int().positive(),
              })
              .passthrough(),
          )
          .min(1),
      })
      .passthrough(),
  })
  .passthrough();

export interface ProcessOrderEventContext {
  logger: Logger;
  /** Id da mensagem na fila e quantas vezes ela já foi entregue (só para os logs). */
  messageId?: string;
  dequeueCount?: number;
}

export type ProcessOrderEventResult =
  | { status: 'discarded'; reason: string }
  | { status: 'ignored'; eventId: string; type: string }
  | { status: 'processed'; eventId: string; type: string; applied: number; duplicates: number; rejected: number };

export class ProcessOrderEventHandler {
  constructor(private readonly stock: StockGateway) {}

  /**
   * Regras de erro (seção 2.2 das decisões do projeto):
   *  - mensagem que não dá para entender → loga e descarta (reprocessar não conserta);
   *  - 404/409 do ms-produtos → warning e segue para os outros itens;
   *  - falha temporária → o erro sobe, o runtime reentrega e, depois de 5 tentativas,
   *    a mensagem vai para a fila `<fila>-poison`.
   */
  async execute(message: unknown, context: ProcessOrderEventContext): Promise<ProcessOrderEventResult> {
    const { logger } = context;

    const payload = decodeMessage(message);
    if (payload === undefined) {
      const reason = 'A mensagem não é um JSON válido.';
      logger.error(`Mensagem ${context.messageId ?? '(sem id)'} descartada: ${reason}`);
      return { status: 'discarded', reason };
    }

    let event: z.output<typeof orderEventSchema>;
    try {
      event = validate(orderEventSchema, payload);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      const reason = error.details.map((issue) => `${issue.field}: ${issue.message}`).join(' | ');
      logger.error(`Mensagem ${context.messageId ?? '(sem id)'} descartada, evento fora do contrato: ${reason}`);
      return { status: 'discarded', reason };
    }

    const prefix = `[evento ${event.eventId}]`;
    const movementType = movementTypeFor(event.type);
    if (!movementType) {
      logger.info(`${prefix} Tipo "${event.type}" não mexe no estoque, ignorado.`);
      return { status: 'ignored', eventId: event.eventId, type: event.type };
    }

    const movements = toStockMovements(event);
    const correlationId = event.correlationId || event.eventId;
    const attempt = context.dequeueCount ? ` (entrega nº ${context.dequeueCount})` : '';
    logger.info(
      `${prefix} ${event.type} do pedido ${event.data.orderId}: ${movements.length} movimentação(ões) de ${movementType}${attempt}.`,
    );

    let applied = 0;
    let duplicates = 0;
    let rejected = 0;

    for (const movement of movements) {
      // Se o gateway lançar (falha temporária), deixamos estourar de propósito.
      // Na reentrega, os itens já aplicados voltam como "duplicate" e nada é contado em dobro.
      const result = await this.stock.registerMovement(movement, correlationId);
      const what = `${movement.type} de ${movement.quantity} un. do produto ${movement.productId}`;

      if (result.status === 'applied') {
        applied += 1;
        logger.info(`${prefix} ${what} aplicada${formatBalance(result.balanceAfter)}.`);
      } else if (result.status === 'duplicate') {
        duplicates += 1;
        logger.info(`${prefix} ${what} já tinha sido aplicada antes, nada a fazer.`);
      } else {
        rejected += 1;
        logger.warn(
          `${prefix} ${what} recusada pelo ms-produtos (HTTP ${result.httpStatus} ${result.code}): ${result.message} Não será reprocessada.`,
        );
      }
    }

    logger.info(`${prefix} Concluído: ${applied} aplicada(s), ${duplicates} duplicada(s), ${rejected} recusada(s).`);
    return { status: 'processed', eventId: event.eventId, type: event.type, applied, duplicates, rejected };
  }
}

function formatBalance(balanceAfter: number | undefined): string {
  return balanceAfter === undefined ? '' : ` (saldo agora: ${balanceAfter})`;
}

/**
 * O trigger de fila normalmente já entrega o JSON parseado, mas dependendo da versão do
 * runtime/host.json pode vir como texto — ou até ainda em Base64, que é como o ms-pedidos publica.
 * Devolve undefined quando não dá para tirar um JSON dali.
 */
function decodeMessage(message: unknown): unknown {
  const raw = Buffer.isBuffer(message) ? message.toString('utf8') : message;
  if (typeof raw !== 'string') return raw ?? undefined;

  const text = raw.trim();
  const direct = tryParseJson(text);
  if (direct !== undefined) return direct;

  if (/^[A-Za-z0-9+/=\s]+$/.test(text)) {
    return tryParseJson(Buffer.from(text, 'base64').toString('utf8'));
  }
  return undefined;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
