import { randomUUID } from 'node:crypto';
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { ValidationIssue } from '../domain/errors';

export const CORRELATION_HEADER = 'x-correlation-id';

/** Reaproveita o x-correlation-id de quem chamou (o BFF manda) ou gera um novo. */
export function resolveCorrelationId(request: HttpRequest): string {
  return request.headers.get(CORRELATION_HEADER)?.trim() || randomUUID();
}

export function jsonResponse(status: number, body: unknown, correlationId: string): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      [CORRELATION_HEADER]: correlationId,
    },
  };
}

/** Erro no formato padrão do projeto: { error: { code, message, details?, correlationId } }. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  details?: ValidationIssue[],
): HttpResponseInit {
  const error = details ? { code, message, details, correlationId } : { code, message, correlationId };
  return jsonResponse(status, { error }, correlationId);
}
