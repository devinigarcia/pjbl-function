export interface ValidationIssue {
  field: string;
  message: string;
}

/** Entrada fora do formato esperado. Na borda HTTP vira 400 VALIDATION_ERROR. */
export class ValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(
    readonly details: ValidationIssue[],
    message = 'Dados inválidos.',
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
