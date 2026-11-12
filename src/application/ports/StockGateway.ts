import type { StockMovementCommand } from '../../domain/orderEvent';

export type StockMovementResult =
  /** 201 — a movimentação foi aplicada agora. */
  | { status: 'applied'; balanceAfter?: number }
  /** 200 duplicate:true — esse eventId já tinha sido aplicado antes (reentrega da fila). */
  | { status: 'duplicate'; balanceAfter?: number }
  /** 404/409 — o ms-produtos recusou e tentar de novo não muda nada. */
  | { status: 'rejected'; httpStatus: number; code: string; message: string };

/** Porta de saída: quem sabe falar com o serviço de estoque (ms-produtos). */
export interface StockGateway {
  registerMovement(command: StockMovementCommand, correlationId: string): Promise<StockMovementResult>;
}

/**
 * Falha temporária (rede, timeout, 5xx, 429...). Quem implementa a porta lança esse erro
 * e o caso de uso deixa subir, para o runtime do Functions reentregar a mensagem.
 */
export class StockServiceUnavailableError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'StockServiceUnavailableError';
  }
}
