import { z } from 'zod';
import { ValidationError, type ValidationIssue } from '../domain/errors';

const TYPE_NAMES: Record<string, string> = {
  string: 'texto',
  number: 'número',
  integer: 'número inteiro',
  boolean: 'booleano',
  array: 'lista',
  object: 'objeto',
  null: 'nulo',
  nan: 'número inválido',
};

const typeName = (type: string): string => TYPE_NAMES[type] ?? type;

// As mensagens padrão do zod são em inglês; aqui ficam as traduções dos casos que usamos.
const portugueseErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'Campo obrigatório.' };
      }
      return { message: `Deve ser ${typeName(issue.expected)} (veio ${typeName(issue.received)}).` };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'number') {
        return { message: issue.inclusive ? `Deve ser maior ou igual a ${issue.minimum}.` : `Deve ser maior que ${issue.minimum}.` };
      }
      if (issue.type === 'array') return { message: `Deve ter pelo menos ${issue.minimum} item(ns).` };
      if (issue.type === 'string') return { message: 'Não pode ficar vazio.' };
      break;
    case z.ZodIssueCode.not_finite:
      return { message: 'Deve ser um número finito.' };
    default:
      break;
  }
  return { message: ctx.defaultError };
};

/**
 * Valida a entrada com o schema do caso de uso e devolve o dado já tipado.
 * Se não passar, lança ValidationError com a lista { field, message } do contrato.
 */
export function validate<TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown): z.output<TSchema> {
  const result = schema.safeParse(input, { errorMap: portugueseErrorMap });
  if (result.success) return result.data;

  const details: ValidationIssue[] = result.error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'body',
    message: issue.message,
  }));
  throw new ValidationError(details);
}
