import type { LineItem, Total } from '@stripe/link-sdk';
import { z } from 'zod';

export const LineItemSchema = z
  .object({
    name: z.string(),
    url: z.string().optional(),
    image_url: z.string().optional(),
    description: z.string().optional(),
    sku: z.string().optional(),
    quantity: z.coerce.number().optional(),
    unit_amount: z.coerce.number().optional(),
    product_url: z.string().optional(),
  })
  .strict();

export const TotalSchema = z
  .object({
    type: z.string(),
    display_text: z.string(),
    amount: z.coerce.number(),
  })
  .strict();

export function parseKvString(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf(':');
    if (idx === -1) {
      throw new Error(`Invalid field (missing ':'): ${pair}`);
    }
    result[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return result;
}

function formatZodError(err: z.ZodError, prefix: string): Error {
  const messages = err.issues.map((issue) => {
    const key = issue.path[0]?.toString();
    return key
      ? `${prefix} ${key}: ${issue.message}`
      : `${prefix}: ${issue.message}`;
  });
  return new Error(messages.join('\n'));
}

export function parseLineItemFlag(raw: string): LineItem {
  const obj = parseKvString(raw);
  try {
    return LineItemSchema.parse(obj) as LineItem;
  } catch (err) {
    if (err instanceof z.ZodError) throw formatZodError(err, 'Line item');
    throw err;
  }
}

export function parseTotalFlag(raw: string): Total {
  const obj = parseKvString(raw);
  try {
    return TotalSchema.parse(obj) as Total;
  } catch (err) {
    if (err instanceof z.ZodError) throw formatZodError(err, 'Total');
    throw err;
  }
}
