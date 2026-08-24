import type { LinkOptions } from '@/config';
import { BaseResource, requireRecord, requireString } from '@/resources/base';
import type { IUserInfoResource } from '@/resources/interfaces';
import type { UserInfo } from '@/types/index';

function optionalNullableString(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  return requireString(value, field);
}

export class UserInfoResource
  extends BaseResource
  implements IUserInfoResource
{
  constructor(options: LinkOptions) {
    super(options, '/userinfo');
  }

  async retrieve(): Promise<UserInfo> {
    const { status, data, rawBody } = await this.apiFetch({
      method: 'GET',
      url: this.endpoint,
    });

    if (status < 200 || status >= 300) {
      this.throwApiError('retrieve user info', status, data, rawBody);
    }

    return this.parseResponse('retrieve user info', status, () => {
      const body = requireRecord(data);
      return {
        email: optionalNullableString(body.email, 'email') ?? null,
        name: optionalNullableString(body.name, 'name') ?? null,
        first_name:
          optionalNullableString(body.first_name, 'first_name') ?? null,
        last_name: optionalNullableString(body.last_name, 'last_name') ?? null,
        phone: optionalNullableString(body.phone, 'phone') ?? null,
      };
    });
  }
}
