import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { CalculateIndicatorsHandler } from '../../../application/features/CalculateIndicators/CalculateIndicators';
import { ValidationError } from '../../../domain/errors';
import { errorResponse, jsonResponse, resolveCorrelationId } from '../../http';

export type CalculateIndicatorsEndpoint = (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>;

/** POST /api/indicators — adaptador fino: lê o JSON, chama o caso de uso e traduz erro em HTTP. */
export function createCalculateIndicatorsEndpoint(handler: CalculateIndicatorsHandler): CalculateIndicatorsEndpoint {
  return async (request, context) => {
    const correlationId = resolveCorrelationId(request);

    let body: unknown;
    try {
      body = JSON.parse(await request.text()) as unknown;
    } catch {
      return errorResponse(400, 'INVALID_JSON', 'O corpo da requisição não é um JSON válido.', correlationId);
    }

    try {
      const indicators = handler.execute(body);
      context.log(
        `[${correlationId}] Indicadores calculados: ${indicators.products.total} produto(s), ${indicators.orders.total} pedido(s), ${indicators.alerts.length} alerta(s).`,
      );
      return jsonResponse(200, indicators, correlationId);
    } catch (error) {
      if (error instanceof ValidationError) {
        context.warn(`[${correlationId}] Entrada inválida em /indicators (${error.details.length} problema(s)).`);
        return errorResponse(400, error.code, error.message, correlationId, error.details);
      }
      context.error(`[${correlationId}] Erro inesperado ao calcular indicadores:`, error);
      return errorResponse(500, 'INTERNAL_ERROR', 'Erro inesperado ao calcular os indicadores.', correlationId);
    }
  };
}
