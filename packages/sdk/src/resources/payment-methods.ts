import type { LinkOptions } from '@/config';
import {
  BaseResource,
  requireArray,
  requireBoolean,
  requireRecord,
  requireString,
} from '@/resources/base';
import type { IPaymentMethodsResource } from '@/resources/interfaces';
import type { PaymentMethod } from '@/types/index';

function parsePaymentMethod(value: unknown, index: number): PaymentMethod {
  const field = `payment_details[${index}]`;
  const item = requireRecord(value, field);
  return {
    ...item,
    id: requireString(item.id, `${field}.id`),
    type: requireString(item.type, `${field}.type`),
    is_default: requireBoolean(item.is_default, `${field}.is_default`),
  } as PaymentMethod;
}

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

    return this.parseResponse('list payment methods', status, () => {
      const body = requireRecord(data);
      return requireArray(body.payment_details, 'payment_details').map(
        parsePaymentMethod,
      );
    });
  }
}
