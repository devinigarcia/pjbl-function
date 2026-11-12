import { z } from 'zod';
import { calculateIndicators, type Indicators } from '../../../domain/indicators';
import { validate } from '../../validation';

// O BFF manda os objetos inteiros de produto e pedido. Validamos só o que entra na conta
// e deixamos o resto passar (.passthrough), assim um campo novo nos microserviços não quebra a Function.
const productSchema = z
  .object({
    id: z.string().min(1),
    sku: z.string(),
    name: z.string(),
    category: z.string().nullish(),
    price: z.number().finite().nonnegative(),
    stock: z.number().int().nonnegative(),
  })
  .passthrough();

const orderItemSchema = z
  .object({
    productId: z.string().min(1),
    productName: z.string(),
    unitPrice: z.number().finite().nonnegative(),
    quantity: z.number().int().nonnegative(),
  })
  .passthrough();

const orderSchema = z
  .object({
    status: z.string().min(1),
    total: z.number().finite().nonnegative(),
    items: z.array(orderItemSchema).default([]),
  })
  .passthrough();

// Lista ausente ou null conta como vazia: quando um dos microserviços está fora,
// o BFF ainda consegue pedir os indicadores só com o que tem em mãos.
export const calculateIndicatorsSchema = z
  .object({
    products: z
      .array(productSchema)
      .nullish()
      .transform((list) => list ?? []),
    orders: z
      .array(orderSchema)
      .nullish()
      .transform((list) => list ?? []),
  })
  .passthrough();

export type CalculateIndicatorsInput = z.input<typeof calculateIndicatorsSchema>;

export class CalculateIndicatorsHandler {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  execute(input: unknown): Indicators {
    const { products, orders } = validate(calculateIndicatorsSchema, input);
    return calculateIndicators(products, orders, this.clock());
  }
}
