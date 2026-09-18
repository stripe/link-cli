import { z } from 'zod';
import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type { IPaymentMethodsResource } from '@/resources/interfaces';
import type { PaymentMethod } from '@/types/index';

const cardDetailsSchema = z.looseObject({
  brand: z.string(),
  last4: z.string(),
  exp_month: z.number().int(),
  exp_year: z.number().int(),
});

const bankAccountDetailsSchema = z.looseObject({
  last4: z.string(),
  bank_name: z.string().nullable().optional(),
});

const balanceDetailsSchema = z.looseObject({
  available_balance: z
    .looseObject({
      amount: z.number().int(),
      currency: z.string(),
    })
    .optional(),
});

const productCapabilitySchema = z.looseObject({
  eligible: z.boolean(),
  ineligibility_reasons: z.array(z.string()),
});

const paymentMethodSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  is_default: z.boolean(),
  name: z.string(),
  nickname: z.optional(z.string().nullable()),
  card_details: cardDetailsSchema.nullable().optional(),
  bank_account_details: bankAccountDetailsSchema.nullable().optional(),
  balance_details: balanceDetailsSchema.nullable().optional(),
  capabilities: z
    .record(z.string(), productCapabilitySchema)
    .nullable()
    .optional(),
});
const paymentMethodsResponseSchema = z.looseObject({
  payment_details: z.array(paymentMethodSchema),
});

export class PaymentMethodsResource
  extends BaseResource
  implements IPaymentMethodsResource
{
  constructor(options: LinkOptions) {
    super(options, '/payment-details');
  }

  async list(): Promise<PaymentMethod[]> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.endpoint,
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('list payment methods', status, data, rawBody);
    }

    return this.parseResponse(
      'list payment methods',
      status,
      () =>
        paymentMethodsResponseSchema.parse(data)
          .payment_details as PaymentMethod[],
    );
  }

  async retrieve(id: string): Promise<PaymentMethod | null> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: `${this.endpoint}/${encodeURIComponent(id)}`,
    });

    if (status === 404) return null;
    if (status < 200 || status >= 300) {
      this.throwApiError('retrieve payment method', status, data, rawBody);
    }

    return this.parseResponse(
      'retrieve payment method',
      status,
      () => paymentMethodSchema.parse(data) as PaymentMethod,
    );
  }
}
