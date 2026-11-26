import { z } from 'zod';
import type { LinkOptions } from '../config.js';
import type { ShippingAddressRecord } from '../types/index.js';
import { BaseResource } from './base.js';
import type { IShippingAddressResource } from './interfaces.js';

const shippingAddressSchema = z.looseObject({
  id: z.string(),
  is_default: z.boolean(),
  nickname: z.optional(z.string().nullable()),
  address: z.looseObject({}).nullable(),
});
const shippingAddressesResponseSchema = z.looseObject({
  shipping_addresses: z.array(shippingAddressSchema),
});

export class ShippingAddressResource
  extends BaseResource
  implements IShippingAddressResource
{
  constructor(options: LinkOptions) {
    super(options, '/shipping_addresses');
  }

  async list(): Promise<ShippingAddressRecord[]> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.endpoint,
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('list shipping addresses', status, data, rawBody);
    }

    return this.parseResponse(
      'list shipping addresses',
      status,
      () =>
        shippingAddressesResponseSchema.parse(data)
          .shipping_addresses as ShippingAddressRecord[],
    );
  }
}
