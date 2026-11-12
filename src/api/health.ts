import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { jsonResponse, resolveCorrelationId } from './http';

export const SERVICE_NAME = 'pjbl-function';

/** GET /api/health — anônimo, usado pelo BFF e pelo roteiro de deploy para saber se a Function está no ar. */
export async function healthEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  return jsonResponse(
    200,
    { status: 'ok', service: SERVICE_NAME, timestamp: new Date().toISOString() },
    resolveCorrelationId(request),
  );
}
