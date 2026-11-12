import {
  StockServiceUnavailableError,
  type StockGateway,
  type StockMovementResult,
} from '../application/ports/StockGateway';
import type { StockMovementCommand } from '../domain/orderEvent';

export interface ProdutosHttpStockGatewayOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

interface MovementBody {
  duplicate?: unknown;
  movement?: { balanceAfter?: unknown };
  product?: { stock?: unknown };
}

/**
 * Cliente HTTP do ms-produtos (POST /products/{id}/stock-movements).
 * Traduz o status HTTP para o vocabulário da aplicação:
 *   201 → aplicada | 200 → duplicada | 404/409 → recusada | qualquer outra coisa → erro temporário.
 */
export class ProdutosHttpStockGateway implements StockGateway {
  private readonly baseUrl: string;

  constructor(private readonly options: ProdutosHttpStockGatewayOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async registerMovement(command: StockMovementCommand, correlationId: string): Promise<StockMovementResult> {
    const url = `${this.baseUrl}/products/${encodeURIComponent(command.productId)}/stock-movements`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-correlation-id': correlationId,
    };
    if (this.options.apiKey) headers['x-api-key'] = this.options.apiKey;

    let status: number;
    let body: unknown;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: command.type,
          quantity: command.quantity,
          reason: command.reason,
          eventId: command.eventId,
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      status = response.status;
      body = await readJson(response);
    } catch (error) {
      throw new StockServiceUnavailableError(describeNetworkError(error, this.options.timeoutMs));
    }

    if (status === 200 || status === 201) {
      const data = (body ?? {}) as MovementBody;
      const balanceAfter = firstNumber(data.movement?.balanceAfter, data.product?.stock);
      // Pelo contrato, 200 já significa "esse eventId foi aplicado antes"; o campo duplicate confirma.
      const duplicate = status === 200 || data.duplicate === true;
      return { status: duplicate ? 'duplicate' : 'applied', balanceAfter };
    }

    if (status === 404 || status === 409) {
      const error = ((body ?? {}) as ErrorBody).error;
      return {
        status: 'rejected',
        httpStatus: status,
        code: typeof error?.code === 'string' ? error.code : status === 404 ? 'PRODUCT_NOT_FOUND' : 'CONFLICT',
        message: typeof error?.message === 'string' ? error.message : 'Sem detalhes na resposta.',
      };
    }

    // 5xx e 429 são temporários. Para o resto (400, 401...) também preferimos relançar:
    // a mensagem acaba na fila poison em vez de sumir sem ninguém ver.
    throw new StockServiceUnavailableError(`ms-produtos respondeu HTTP ${status} em POST ${url}.`, status);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number');
}

function describeNetworkError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `ms-produtos não respondeu em ${timeoutMs} ms.`;
  }
  if (error instanceof Error) {
    // No fetch do Node o motivo real (ECONNREFUSED, ENOTFOUND...) fica em error.cause.
    const cause = (error as { cause?: { code?: unknown; message?: unknown } }).cause;
    const detail = typeof cause?.code === 'string' ? cause.code : typeof cause?.message === 'string' ? cause.message : '';
    return `Falha de rede ao chamar o ms-produtos: ${error.message}${detail ? ` (${detail})` : ''}`;
  }
  return 'Falha de rede ao chamar o ms-produtos.';
}
