import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type { IUserInfoResource } from '@/resources/interfaces';
import type { UserInfo } from '@/types/index';
import { z } from 'zod';

const userInfoSchema = z
  .looseObject({
    email: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  })
  .transform(({ email, name, first_name, last_name, phone }) => ({
    email: email ?? null,
    name: name ?? null,
    first_name: first_name ?? null,
    last_name: last_name ?? null,
    phone: phone ?? null,
  }));

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

    return this.parseResponse('retrieve user info', status, () =>
      userInfoSchema.parse(data),
    );
  }
}
