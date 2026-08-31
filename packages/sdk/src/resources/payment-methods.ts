import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type { IPaymentMethodsResource } from '@/resources/interfaces';
import type { PaymentMethod } from '@/types/index';
import { z } from 'zod';

const paymentMethodSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  is_default: z.boolean(),
  name: z.string(),
  nickname: z.optional(z.string().nullable()),
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
}
