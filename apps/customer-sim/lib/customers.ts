import 'server-only';
import { z } from 'zod';

/**
 * The three test customers (DEV ONLY). Their addresses stay on the server: the browser only ever sends 1, 2 or 3.
 * Each tenant keeps its own customer record and conversation for each address.
 */
export const CUSTOMERS = [
  { number: 1, address: '+966511111111' },
  { number: 2, address: '+966522222222' },
  { number: 3, address: '+966533333333' },
] as const;

export type Customer = (typeof CUSTOMERS)[number];

export const customerNumberSchema = z.coerce.number().int().min(1).max(CUSTOMERS.length);

export function customerByNumber(value: unknown): Customer {
  const parsed = customerNumberSchema.safeParse(value);
  return CUSTOMERS[(parsed.success ? parsed.data : 1) - 1]!;
}
