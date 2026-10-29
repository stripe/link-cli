import type {
  CreateUcpCheckoutParams,
  UcpBuyer,
  UcpLineItem,
} from '@stripe/link-sdk';
import { z } from 'incur';
import { parseKvString } from '../../utils/line-item-parser';
import type { checkoutCreateOptions } from './schema';

const lineItemSchema = z.strictObject({
  id: z.string().trim().nonempty('Each line item requires an id'),
  quantity: z
    .union([z.number(), z.string().regex(/^\d+$/)])
    .transform(Number)
    .pipe(z.number().int().positive().max(2_147_483_647))
    .default(1),
});

const buyerSchema = z.strictObject({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

function parseLineItem(item: unknown): UcpLineItem {
  const result = lineItemSchema.safeParse(
    typeof item === 'string' ? parseKvString(item) : item,
  );
  if (!result.success) {
    throw new Error(
      'Each line item requires an id and an optional positive int32 integer quantity (default 1). Allowed keys: id, quantity',
    );
  }
  return { item: { id: result.data.id }, quantity: result.data.quantity };
}

function parseBuyer(buyer: string | Record<string, unknown>): UcpBuyer {
  const result = buyerSchema.safeParse(
    typeof buyer === 'string' ? parseKvString(buyer) : buyer,
  );
  if (!result.success) {
    throw new Error(
      '--buyer accepts optional string fields: first_name, last_name, email, phone',
    );
  }
  const { phone, ...fields } = result.data;
  return { ...fields, ...(phone !== undefined ? { phone_number: phone } : {}) };
}

export function parseCheckoutInput(
  options: z.infer<typeof checkoutCreateOptions>,
): CreateUcpCheckoutParams {
  if (!options.lineItem.length) {
    throw new Error(
      'At least one --line-item is required (format: "id:sku_123,quantity:1")',
    );
  }
  if (options.fulfillment !== undefined && options.fullfilment !== undefined) {
    throw new Error('Supply only one of --fulfillment and --fullfilment');
  }
  const rawFulfillment = options.fulfillment ?? options.fullfilment;
  let fulfillment: Record<string, unknown> | undefined;
  if (rawFulfillment !== undefined) {
    let parsed: unknown;
    try {
      parsed =
        typeof rawFulfillment === 'string'
          ? JSON.parse(rawFulfillment)
          : rawFulfillment;
    } catch {
      throw new Error('--fulfillment must be a valid JSON object');
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new Error('--fulfillment must be a valid JSON object');
    }
    fulfillment = parsed as Record<string, unknown>;
  }
  return {
    business: options.business,
    line_items: options.lineItem.map(parseLineItem),
    ...(options.buyer !== undefined
      ? { buyer: parseBuyer(options.buyer) }
      : {}),
    ...(fulfillment !== undefined ? { fulfillment } : {}),
  };
}

export function checkoutId(positional?: string, option?: string): string {
  if (positional && option && positional !== option) {
    throw new Error('Positional checkout ID and --id must match');
  }
  const id = option ?? positional;
  if (!id?.trim()) throw new Error('Checkout ID is required (use --id <id>)');
  return id;
}
