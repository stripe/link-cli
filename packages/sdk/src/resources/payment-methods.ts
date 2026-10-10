import { z } from 'zod';
import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type {
  IPaymentMethodsResource,
  UpdatePaymentMethodParams,
} from '@/resources/interfaces';
import type { PaymentMethod, PaymentMethodsListResponse } from '@/types/index';

const balanceDetailsSchema = z.looseObject({
  available_balance: z
    .looseObject({
      amount: z.number().int(),
      currency: z.string(),
    })
    .optional(),
});

const paymentMethodSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  is_default: z.boolean(),
  name: z.string(),
  nickname: z.optional(z.string().nullable()),
  balance_details: balanceDetailsSchema.nullable().optional(),
});
const paymentMethodsResponseSchema = z.looseObject({
  payment_details: z.array(paymentMethodSchema),
  unavailable_count: z.number().int().nonnegative(),
});

export class PaymentMethodsResource
  extends BaseResource
  implements IPaymentMethodsResource
{
  constructor(options: LinkOptions) {
    super(options, '/payment-details');
  }

  async list(): Promise<PaymentMethod[]> {
    return (await this.listWithMetadata()).payment_details;
  }

  async listWithMetadata(): Promise<PaymentMethodsListResponse> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.endpoint,
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('list payment methods', status, data, rawBody);
    }

    return this.parseResponse('list payment methods', status, () => {
      const response = paymentMethodsResponseSchema.parse(data);
      return {
        payment_details: response.payment_details as PaymentMethod[],
        unavailable_count: response.unavailable_count,
      };
    });
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

  async update(
    id: string,
    params: UpdatePaymentMethodParams,
  ): Promise<PaymentMethod> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'POST',
      url: `${this.endpoint}/${encodeURIComponent(id)}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: params.nickname }),
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('update payment method', status, data, rawBody);
    }

    return this.parseResponse(
      'update payment method',
      status,
      () => paymentMethodSchema.parse(data) as PaymentMethod,
    );
  }
}
