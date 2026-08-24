import type { LinkOptions } from '@/config';
import {
  BaseResource,
  requireArray,
  requireBoolean,
  requireRecord,
  requireString,
} from '@/resources/base';
import type { IShippingAddressResource } from '@/resources/interfaces';
import type { ShippingAddressRecord } from '@/types/index';

function requireNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requireString(value, field);
}

function parseShippingAddress(
  value: unknown,
  index: number,
): ShippingAddressRecord {
  const field = `shipping_addresses[${index}]`;
  const item = requireRecord(value, field);
  const address = item.address;
  if (address !== null) {
    requireRecord(address, `${field}.address`);
  }

  return {
    ...item,
    id: requireString(item.id, `${field}.id`),
    is_default: requireBoolean(item.is_default, `${field}.is_default`),
    nickname: requireNullableString(item.nickname, `${field}.nickname`),
    address: address as ShippingAddressRecord['address'],
  };
}

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

    return this.parseResponse('list shipping addresses', status, () => {
      const body = requireRecord(data);
      return requireArray(body.shipping_addresses, 'shipping_addresses').map(
        parseShippingAddress,
      );
    });
  }
}
