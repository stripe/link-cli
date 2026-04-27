import type {
  CredentialType,
  ISpendRequestResource,
  LineItem,
  Total,
} from '@stripe/link-sdk';
import { storage } from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import { render } from 'ink';
import React from 'react';
import {
  parseLineItemFlag,
  parseTotalFlag,
} from '../../utils/line-item-parser';
import { CreateSpendRequest } from './create';
import { RequestApproval } from './request-approval';
import { RetrieveSpendRequest } from './retrieve';
import { createOptions, retrieveOptions, updateOptions } from './schema';
import { UpdateSpendRequest } from './update';

export function createSpendRequestCli(repository: ISpendRequestResource) {
  const cli = Cli.create('spend-request', {
    description: 'Spend request management commands',
  });

  cli.command('create', {
    description: 'Create a new spend request',
    options: createOptions,
    alias: { merchantName: 'm' },
    outputPolicy: 'agent-only' as const,
    async *run(c) {
      if (!storage.isAuthenticated()) {
        return c.error({
          code: 'NOT_AUTHENTICATED',
          message: 'Not authenticated. Run "link-cli auth login" first.',
          cta: {
            commands: [
              { command: 'auth login', description: 'Log in to Link' },
            ],
          },
        });
      }

      const opts = c.options;
      const requestApproval = !!opts.requestApproval;
      const credentialType = opts.credentialType as CredentialType | undefined;
      const networkId = opts.networkId;

      if (credentialType === 'shared_payment_token' && !networkId) {
        return c.error({
          code: 'INVALID_INPUT',
          message:
            'network-id is required when credential-type is shared_payment_token',
          cta: {
            commands: [
              {
                command: 'mpp decode',
                description:
                  'Decode a WWW-Authenticate challenge to extract network-id',
              },
            ],
          },
        });
      }
      if (networkId && credentialType !== 'shared_payment_token') {
        return c.error({
          code: 'INVALID_INPUT',
          message:
            'network-id can only be used when credential-type is shared_payment_token',
        });
      }
      if (credentialType !== 'shared_payment_token' && !opts.merchantName) {
        return c.error({
          code: 'INVALID_INPUT',
          message: 'merchant-name is required when credential-type is card',
        });
      }
      if (credentialType !== 'shared_payment_token' && !opts.merchantUrl) {
        return c.error({
          code: 'INVALID_INPUT',
          message: 'merchant-url is required when credential-type is card',
        });
      }

      // Parse line items/totals: strings from flags need parsing, objects from MCP pass through
      const lineItems = opts.lineItem?.length
        ? opts.lineItem.map((item: unknown) =>
            typeof item === 'string' ? parseLineItemFlag(item) : item,
          )
        : undefined;
      const totals = opts.total?.length
        ? opts.total.map((item: unknown) =>
            typeof item === 'string' ? parseTotalFlag(item) : item,
          )
        : undefined;

      const createParams = {
        payment_details: opts.paymentMethodId,
        credential_type: credentialType,
        network_id: networkId,
        amount: opts.amount,
        currency: opts.currency,
        merchant_name: opts.merchantName,
        merchant_url: opts.merchantUrl,
        context: opts.context,
        line_items: lineItems as LineItem[] | undefined,
        totals: totals as Total[] | undefined,
        request_approval: requestApproval || undefined,
        test: opts.test ? true : undefined,
      };

      if (!c.agent && !c.formatExplicit) {
        return new Promise((resolve) => {
          const { waitUntilExit } = render(
            <CreateSpendRequest
              repository={repository}
              params={createParams}
              requestApproval={requestApproval}
              onComplete={() => {}}
            />,
          );
          waitUntilExit().then(async () => {
            const created = await repository.createSpendRequest(createParams);
            resolve(created);
          });
        });
      }

      // Agent mode: create, return immediately with _next polling hint.
      // The agent drives the polling loop via `spend-request retrieve`.
      const created = await repository.createSpendRequest(createParams);
      if (!requestApproval) {
        yield created;
        return;
      }
      yield {
        ...created,
        instruction: `Present the approval_url to the user and ask them to approve in the Link app. Then call \`spend-request retrieve ${created.id} --interval 2 --max-attempts 150\` to poll until approved. Do not wait for the user to reply — start polling immediately.`,
        _next: {
          command: `spend-request retrieve ${created.id} --interval 2 --max-attempts 150`,
          until: 'status changes from pending_approval',
        },
      };
    },
  });

  cli.command('update', {
    description: 'Update a spend request',
    args: z.object({
      id: z.string().describe('Spend request ID'),
    }),
    options: updateOptions,
    outputPolicy: 'agent-only' as const,
    async run(c) {
      if (!storage.isAuthenticated()) {
        return c.error({
          code: 'NOT_AUTHENTICATED',
          message: 'Not authenticated. Run "link-cli auth login" first.',
          cta: {
            commands: [
              { command: 'auth login', description: 'Log in to Link' },
            ],
          },
        });
      }

      const id = c.args.id;
      const opts = c.options;

      const params: Record<string, unknown> = {};
      if (opts.paymentMethodId !== undefined)
        params.payment_details = opts.paymentMethodId;
      if (opts.amount !== undefined) params.amount = opts.amount;
      if (opts.merchantUrl !== undefined)
        params.merchant_url = opts.merchantUrl;
      if (opts.profileId !== undefined) params.profile_id = opts.profileId;
      if (opts.merchantId !== undefined) params.merchant_id = opts.merchantId;
      if (opts.currency !== undefined) params.currency = opts.currency;
      if (opts.lineItem?.length)
        params.line_items = opts.lineItem.map((item: unknown) =>
          typeof item === 'string' ? parseLineItemFlag(item) : item,
        );
      if (opts.total?.length)
        params.totals = opts.total.map((item: unknown) =>
          typeof item === 'string' ? parseTotalFlag(item) : item,
        );

      if (!c.agent && !c.formatExplicit) {
        return new Promise((resolve) => {
          const { waitUntilExit } = render(
            <UpdateSpendRequest
              repository={repository}
              id={id}
              params={params}
              onComplete={() => {}}
            />,
          );
          waitUntilExit().then(async () => {
            resolve(await repository.updateSpendRequest(id, params));
          });
        });
      }

      return repository.updateSpendRequest(id, params);
    },
  });

  cli.command('request-approval', {
    description: 'Request approval for a spend request',
    args: z.object({
      id: z.string().describe('Spend request ID'),
    }),
    outputPolicy: 'agent-only' as const,
    async *run(c) {
      if (!storage.isAuthenticated()) {
        return c.error({
          code: 'NOT_AUTHENTICATED',
          message: 'Not authenticated. Run "link-cli auth login" first.',
          cta: {
            commands: [
              { command: 'auth login', description: 'Log in to Link' },
            ],
          },
        });
      }

      const id = c.args.id;

      if (!c.agent && !c.formatExplicit) {
        return new Promise((resolve) => {
          const { waitUntilExit } = render(
            <RequestApproval
              repository={repository}
              id={id}
              onComplete={() => {}}
            />,
          );
          waitUntilExit().then(async () => {
            const approval = await repository.requestApproval(id);
            resolve(approval);
          });
        });
      }

      // Agent mode: request approval, return immediately with _next polling hint.
      // The agent drives the polling loop via `spend-request retrieve`.
      const approval = await repository.requestApproval(id);
      yield {
        ...approval,
        instruction: `Present the approval_url to the user and ask them to approve in the Link app. Then call \`spend-request retrieve ${id} --interval 2 --max-attempts 150\` to poll until approved. Do not wait for the user to reply — start polling immediately.`,
        _next: {
          command: `spend-request retrieve ${id} --interval 2 --max-attempts 150`,
          until: 'status changes from pending_approval',
        },
      };
    },
  });

  cli.command('retrieve', {
    description: 'Retrieve a spend request',
    args: z.object({
      id: z.string().describe('Spend request ID'),
    }),
    options: retrieveOptions,
    outputPolicy: 'agent-only' as const,
    async *run(c) {
      if (!storage.isAuthenticated()) {
        return c.error({
          code: 'NOT_AUTHENTICATED',
          message: 'Not authenticated. Run "link-cli auth login" first.',
          cta: {
            commands: [
              { command: 'auth login', description: 'Log in to Link' },
            ],
          },
        });
      }

      const id = c.args.id;
      const opts = c.options;
      const timeout = opts.timeout;
      const interval = opts.interval;
      const maxAttempts = opts.maxAttempts;
      const includeArr = opts.include;
      const include = includeArr?.length ? includeArr : undefined;

      if (!c.agent && !c.formatExplicit) {
        return new Promise((resolve) => {
          const { waitUntilExit } = render(
            <RetrieveSpendRequest
              repository={repository}
              id={id}
              timeout={timeout}
              include={include}
              onComplete={() => {}}
            />,
          );
          waitUntilExit().then(async () => {
            const request = await repository.getSpendRequest(id, { include });
            resolve(request);
          });
        });
      }

      const terminalStatuses = new Set([
        'approved',
        'denied',
        'expired',
        'succeeded',
        'failed',
      ]);
      const deadline = Date.now() + timeout * 1000;
      let attempts = 0;

      while (true) {
        const request = await repository.getSpendRequest(id, { include });
        if (!request) {
          return c.error({
            code: 'NOT_FOUND',
            message: `Spend request ${id} not found`,
          });
        }

        if (terminalStatuses.has(request.status)) {
          yield request;
          return;
        }

        attempts++;
        const shouldStop =
          interval <= 0 ||
          (maxAttempts > 0 && attempts >= maxAttempts) ||
          Date.now() >= deadline;

        if (shouldStop) {
          yield request;
          return;
        }

        yield request;
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      }
    },
  });

  return cli;
}
