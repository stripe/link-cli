import type { LinkOptions } from '@/config';
import { BaseResource } from '@/resources/base';
import type { IUserInfoResource } from '@/resources/interfaces';
import type { UserInfo } from '@/types/index';
import { z } from 'zod';

const rollingSpendLimitSchema = z.object({
  limit: z.number().int().nullable(),
  used: z.number().int(),
  remaining: z.number().int().nullable(),
});

const agentWalletSpendLimitsSchema = z.object({
  per_transaction: z.object({
    limit: z.number().int().nullable(),
  }),
  daily: rollingSpendLimitSchema,
  thirty_day: rollingSpendLimitSchema,
});

const agentWalletStepUpSchema = z.object({
  status: z.enum([
    'not_required',
    'ssn_verification',
    'identity_verification',
    'contact_support',
    'complete',
  ]),
});

const userInfoSchema = z
  .looseObject({
    email: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    agent_wallet_spend_limits: agentWalletSpendLimitsSchema.optional(),
    agent_wallet_step_up: agentWalletStepUpSchema.optional(),
  })
  .transform(
    ({
      email,
      name,
      first_name,
      last_name,
      phone,
      agent_wallet_spend_limits,
      agent_wallet_step_up,
    }) => ({
      email: email ?? null,
      name: name ?? null,
      first_name: first_name ?? null,
      last_name: last_name ?? null,
      phone: phone ?? null,
      ...(agent_wallet_spend_limits === undefined
        ? {}
        : { agent_wallet_spend_limits }),
      ...(agent_wallet_step_up === undefined ? {} : { agent_wallet_step_up }),
    }),
  );

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
