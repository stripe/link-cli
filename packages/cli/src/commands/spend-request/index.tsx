import { LinkApiError, getDuplicateSpendRequest } from '@stripe/link-sdk';
import type {
  AuthStorage,
  CredentialType,
  ISpendRequestResource,
  LineItem,
  SpendRequest,
  Total,
} from '@stripe/link-sdk';
import { Cli, z } from 'incur';
import React from 'react';
import { writeCredentialFile } from '../../utils/credential-output';
import {
  parseKvString,
  parseLineItemFlag,
  parseTotalFlag,
} from '../../utils/line-item-parser';
import { pollUntil } from '../../utils/poll-until';
import { renderInteractive } from '../../utils/render-interactive';
import { requireAuth, requireAuthGuard } from '../../utils/require-auth';
import { CancelSpendRequest } from './cancel';
import { CreateSpendRequest } from './create';
import { SpendRequestList } from './list';
import { RequestApproval } from './request-approval';
import { RetrieveSpendRequest } from './retrieve';
import {
  createOptions,
  listOptions,
  retrieveOptions,
  updateOptions,
} from './schema';
import { UpdateSpendRequest } from './update';

function buildRequiresActionResult(request: SpendRequest) {
  const nextAction = request.status_details?.requires_action?.next_action;
  const isAutoResume = nextAction?.resolution === 'auto_resume';

  return {
    ...request,
    instruction: isAutoResume
      ? `The spend request requires 3D Secure verification. Present action_url (${nextAction?.action_url}) to the user, then call \`spend-request retrieve ${request.id} --interval 2 --max-attempts 300\` to poll until it resolves. Do not create a new spend request — this one resumes automatically once the challenge is completed.`
      : `The spend request requires action (${nextAction?.type}): ${nextAction?.display_message}${nextAction?.action_url ? ` URL: ${nextAction.action_url}` : ''} Have the user complete this, then create a new spend request.`,
    _next: isAutoResume
      ? {
          command: `spend-request retrieve ${request.id} --interval 2 --max-attempts 300`,
          until: 'status changes from requires_action',
        }
      : undefined,
  };
}

async function applyOutputFile(
  request: SpendRequest,
  outputFile: string | undefined,
  force: boolean,
): Promise<SpendRequest & { card_output_file?: string }> {
  if (!outputFile || !request.card) return request;

  const fileData = {
    spend_request_id: request.id,
    merchant_name: request.merchant_name,
    merchant_url: request.merchant_url,
    context: request.context,
    created_at: request.created_at,
    card: request.card,
  };
  const resolvedPath = await writeCredentialFile(outputFile, fileData, force);
  const { card: _, ...withoutCard } = request;
  return {
    ...withoutCard,
    card_output_file: resolvedPath,
  } as SpendRequest & { card_output_file?: string };
}

export function createSpendRequestCli(
  repository: ISpendRequestResource,
  authStorage?: AuthStorage,
  envAccessToken?: string,
) {
  const cli = Cli.create('spend-request', {
    description: 'Spend request management commands',
  });

  cli.command('list', {
    description:
      'List spend requests. By default returns only active requests (created, pending_approval, approved). Use --include-history to return all spend requests including expired and terminal states.',
    outputPolicy: 'agent-only' as const,
    options: listOptions,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const opts = { includeHistory: c.options.includeHistory ?? false };

      if (!c.agent && !c.formatExplicit) {
        return renderInteractive(
          <SpendRequestList
            repository={repository}
            includeHistory={opts.includeHistory}
            onComplete={() => {}}
          />,
          () => repository.listSpendRequests(opts),
        );
      }

      return repository.listSpendRequests(opts);
    },
  });

  cli.command('create', {
    description: 'Create a new spend request',
    options: createOptions,
    alias: { merchantName: 'm' },
    outputPolicy: 'agent-only' as const,
    async *run(c) {
      requireAuthGuard(c, authStorage, envAccessToken);

      const opts = c.options;
      const requestApproval = !!opts.requestApproval;
      const credentialType = opts.credentialType as CredentialType | undefined;
      const networkId = opts.networkId;
      const executionMethod = opts.executionMethod;
      const merchantAccountId = opts.merchantAccountId?.trim();
      const lptExecutionRequested =
        executionMethod !== undefined || merchantAccountId !== undefined;

      if (lptExecutionRequested) {
        if (executionMethod !== 'link_pay_token') {
          return c.error({
            code: 'INVALID_INPUT',
            message:
              'execution-method link_pay_token is required when merchant-account-id is provided',
          });
        }
        if (!merchantAccountId) {
          return c.error({
            code: 'INVALID_INPUT',
            message:
              'merchant-account-id is required when execution-method is link_pay_token',
          });
        }
        if (credentialType !== 'card') {
          return c.error({
            code: 'INVALID_INPUT',
            message:
              'credential-type must be card when execution-method is link_pay_token',
          });
        }
        if (networkId) {
          return c.error({
            code: 'INVALID_INPUT',
            message:
              'network-id cannot be used when execution-method is link_pay_token',
          });
        }
        if (opts.test) {
          return c.error({
            code: 'INVALID_INPUT',
            message:
              'test cannot be used when execution-method is link_pay_token',
          });
        }
        if (opts.approve) {
          return c.error({
            code: 'INVALID_INPUT',
            message:
              'approve cannot be used when execution-method is link_pay_token; use request-approval instead',
          });
        }
        if (opts.merchantName || opts.merchantUrl) {
          return c.error({
            code: 'INVALID_INPUT',
            message:
              'merchant-name and merchant-url cannot be used when execution-method is link_pay_token; Link resolves the merchant identity from merchant-account-id',
          });
        }
      }

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
      if (
        !lptExecutionRequested &&
        credentialType !== 'shared_payment_token' &&
        !opts.merchantName
      ) {
        return c.error({
          code: 'INVALID_INPUT',
          message: 'merchant-name is required when credential-type is card',
        });
      }
      if (
        !lptExecutionRequested &&
        credentialType !== 'shared_payment_token' &&
        !opts.merchantUrl
      ) {
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

      const approvalDetails =
        opts.approvalDetail !== undefined
          ? typeof opts.approvalDetail === 'string'
            ? JSON.parse(opts.approvalDetail as string)
            : opts.approvalDetail
          : undefined;

      // Merge repeatable metadata flags into a single flat object: strings from
      // flags are parsed as key:value, objects from MCP pass through.
      let metadata: Record<string, string> | undefined;
      if (opts.metadata?.length) {
        metadata = {};
        for (const item of opts.metadata as unknown[]) {
          Object.assign(
            metadata,
            typeof item === 'string'
              ? parseKvString(item)
              : (item as Record<string, string>),
          );
        }
      }

      const createParams = {
        payment_details: opts.paymentMethodId,
        credential_type: credentialType,
        network_id: networkId,
        execution_method: executionMethod,
        merchant_account_id: merchantAccountId,
        amount: opts.amount,
        currency: opts.currency,
        merchant_name: opts.merchantName,
        merchant_url: opts.merchantUrl,
        context: opts.context,
        line_items: lineItems as LineItem[] | undefined,
        totals: totals as Total[] | undefined,
        request_approval: requestApproval || undefined,
        test: opts.test ? true : undefined,
        approve: opts.approve ? true : undefined,
        approval_details: approvalDetails,
        metadata,
      };

      const outputFile = opts.outputFile;
      const forceOverwrite = opts.force;

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: SpendRequest | null | undefined = undefined;
        return renderInteractive(
          <CreateSpendRequest
            repository={repository}
            params={createParams}
            requestApproval={requestApproval}
            outputFile={outputFile}
            force={forceOverwrite}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (capturedResult === undefined)
              throw new Error('Component exited without producing a result');
            if (capturedResult === null) process.exit(1);
            return capturedResult;
          },
        );
      }

      // Agent mode: create, return immediately with _next polling hint.
      // The agent drives the polling loop via `spend-request retrieve`.
      let created: SpendRequest;
      try {
        created = await repository.createSpendRequest(createParams);
      } catch (err) {
        if (err instanceof LinkApiError) {
          const apiErr = err.details as {
            error?: {
              code?: string;
              verification_url?: string;
              support_url?: string;
            };
          };
          if (apiErr?.error?.verification_url) {
            return c.error({
              code: err.code,
              message: `${err.message} Verification URL: ${apiErr.error.verification_url}`,
            });
          }
          if (apiErr?.error?.support_url) {
            return c.error({
              code: err.code,
              message: `${err.message} Support URL: ${apiErr.error.support_url}`,
            });
          }
          const duplicate = getDuplicateSpendRequest(err);
          if (duplicate) {
            return c.error({
              code: apiErr?.error?.code ?? 'spend_request_rate_limited',
              message: `${err.message} A matching spend request already exists: ${duplicate.id} (status: ${duplicate.status}). Retrieve it to resume instead of creating a new one.`,
              cta: {
                description:
                  'Retrieve the conflicting spend request to inspect its status and resume it if valid.',
                commands: [
                  {
                    command: `spend-request retrieve ${duplicate.id}`,
                    description:
                      'Retrieve the conflicting spend request to resume it',
                  },
                ],
              },
            });
          }
        }
        throw err;
      }
      if (created.status === 'requires_action') {
        yield buildRequiresActionResult(created);
        return;
      }
      if (!requestApproval) {
        try {
          yield await applyOutputFile(created, outputFile, forceOverwrite);
        } catch (err) {
          const message = (err as Error).message;
          if (message.startsWith('OUTPUT_FILE_EXISTS')) {
            return c.error({ code: 'OUTPUT_FILE_EXISTS', message });
          }
          return c.error({ code: 'OUTPUT_FILE_WRITE_ERROR', message });
        }
        return;
      }
      yield {
        ...created,
        instruction: `Present the approval_url to the user and ask them to approve in the Link app. Then call \`spend-request retrieve ${created.id} --interval 2 --max-attempts 300\` to poll until approved. Do not wait for the user to reply — start polling immediately.`,
        _next: {
          command: `spend-request retrieve ${created.id} --interval 2 --max-attempts 300`,
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
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
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
        let capturedResult: SpendRequest | null = null;
        return renderInteractive(
          <UpdateSpendRequest
            repository={repository}
            id={id}
            params={params}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (!capturedResult)
              throw new Error('Component exited without producing a result');
            return capturedResult;
          },
        );
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
      requireAuthGuard(c, authStorage, envAccessToken);

      const id = c.args.id;

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: SpendRequest | null | undefined = undefined;
        return renderInteractive(
          <RequestApproval
            repository={repository}
            id={id}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (capturedResult === undefined)
              throw new Error('Component exited without producing a result');
            if (capturedResult === null) process.exit(1);
            return capturedResult;
          },
        );
      }

      // Agent mode: request approval, return immediately with _next polling hint.
      // The agent drives the polling loop via `spend-request retrieve`.
      let approval: Awaited<ReturnType<typeof repository.requestApproval>>;
      try {
        approval = await repository.requestApproval(id);
      } catch (err) {
        if (err instanceof LinkApiError) {
          const apiErr = err.details as {
            error?: {
              code?: string;
              verification_url?: string;
              support_url?: string;
            };
          };
          if (apiErr?.error?.verification_url) {
            return c.error({
              code: err.code,
              message: `${err.message} Verification URL: ${apiErr.error.verification_url}`,
            });
          }
          if (apiErr?.error?.support_url) {
            return c.error({
              code: err.code,
              message: `${err.message} Support URL: ${apiErr.error.support_url}`,
            });
          }
        }
        throw err;
      }
      yield {
        ...approval,
        instruction: `Present the approval_url to the user and ask them to approve in the Link app. Then call \`spend-request retrieve ${id} --interval 2 --max-attempts 300\` to poll until approved. Do not wait for the user to reply — start polling immediately.`,
        _next: {
          command: `spend-request retrieve ${id} --interval 2 --max-attempts 300`,
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
      requireAuthGuard(c, authStorage, envAccessToken);

      const id = c.args.id;
      const opts = c.options;
      const timeout = opts.timeout;
      const interval = opts.interval;
      const maxAttempts = opts.maxAttempts;
      const includeArr = opts.include;
      const include = includeArr?.length ? includeArr : undefined;
      const outputFile = opts.outputFile;
      const forceOverwrite = opts.force;

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: SpendRequest | null = null;
        return renderInteractive(
          <RetrieveSpendRequest
            repository={repository}
            id={id}
            timeout={timeout}
            include={include}
            outputFile={outputFile}
            force={forceOverwrite}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (!capturedResult)
              throw new Error('Component exited without producing a result');
            return capturedResult;
          },
        );
      }

      const terminalStatuses = new Set([
        'approved',
        'denied',
        'expired',
        'succeeded',
        'failed',
        'canceled',
      ]);

      // `requires_action` stops polling unless resolution is `auto_resume`
      // (e.g. 3D Secure), which resolves on its own — keep polling through it.
      const isPollTerminal = (req: SpendRequest): boolean => {
        if (terminalStatuses.has(req.status)) return true;
        if (req.status === 'requires_action') {
          return (
            req.status_details?.requires_action?.next_action?.resolution !==
            'auto_resume'
          );
        }
        return false;
      };

      for await (const result of pollUntil<SpendRequest | null>({
        fn: () => repository.getSpendRequest(id, { include }),
        isTerminal: (req) => req === null || isPollTerminal(req),
        interval,
        maxAttempts,
        timeout,
      })) {
        if (result.value === null) {
          return c.error({
            code: 'NOT_FOUND',
            message: `Spend request ${id} not found`,
          });
        }

        if (result.terminal) {
          if (result.value.status === 'requires_action' && !result.reason) {
            yield buildRequiresActionResult(result.value);
            return;
          }

          // Terminal due to isTerminal or interval <= 0 — apply output file
          if (terminalStatuses.has(result.value.status) || !result.reason) {
            try {
              yield await applyOutputFile(
                result.value,
                outputFile,
                forceOverwrite,
              );
            } catch (err) {
              const message = (err as Error).message;
              if (message.startsWith('OUTPUT_FILE_EXISTS')) {
                return c.error({ code: 'OUTPUT_FILE_EXISTS', message });
              }
              return c.error({ code: 'OUTPUT_FILE_WRITE_ERROR', message });
            }
            return;
          }

          // Terminal due to max_attempts or timeout
          const reason =
            result.reason === 'max_attempts'
              ? `max attempts (${maxAttempts}) exhausted`
              : `timeout (${timeout}s) reached`;
          return c.error({
            code: 'POLLING_TIMEOUT',
            message: `Polling stopped before spend request ${id} reached a terminal status: ${reason}; current status is ${result.value.status}.`,
            retryable: true,
          });
        }

        yield result.value;
      }
    },
  });

  cli.command('cancel', {
    description: 'Cancel a spend request',
    args: z.object({
      id: z.string().describe('Spend request ID'),
    }),
    outputPolicy: 'agent-only' as const,
    middleware: [requireAuth(authStorage, envAccessToken)],
    async run(c) {
      const id = c.args.id;

      if (!c.agent && !c.formatExplicit) {
        let capturedResult: SpendRequest | null = null;
        return renderInteractive(
          <CancelSpendRequest
            repository={repository}
            id={id}
            onComplete={(result) => {
              capturedResult = result;
            }}
          />,
          () => {
            if (!capturedResult)
              throw new Error('Component exited without producing a result');
            return capturedResult;
          },
        );
      }

      return repository.cancelSpendRequest(id);
    },
  });

  return cli;
}
