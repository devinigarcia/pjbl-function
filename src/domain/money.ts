/**
 * Arredonda para 2 casas decimais (dinheiro e taxas).
 * O EPSILON evita o clássico 1.005 virar 1.00 por causa do ponto flutuante.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Formata um valor em reais do jeito que a gente escreve no Brasil: R$ 1.234,50 */
export function formatBRL(value: number): string {
  const [integerPart = '0', decimalPart = '00'] = round2(value).toFixed(2).split('.');
  const withThousands = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${withThousands},${decimalPart}`;
}
