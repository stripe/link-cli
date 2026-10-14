import { fileURLToPath } from 'node:url';
import { Tool, type ToolExecutionContext } from '@mastra/core/tools';
import { Link, LinkApiError } from '@stripe/link-sdk';
import {
  createLinkTools as createSdkTools,
  type LinkToolName,
} from '@stripe/link-sdk/tools';
import { z } from 'zod';

/** Directory of Link skills, for an agent's or workspace's `skills` paths. */
export const linkSkillsPath = fileURLToPath(
  new URL('../skills', import.meta.url),
);

export type LinkToolsOptions = (
  | { accessToken: string; getAccessToken?: never }
  | {
      accessToken?: never;
      getAccessToken: (
        context: ToolExecutionContext | undefined,
      ) => string | Promise<string>;
    }
) & {
  /** Require Mastra confirmation before creating a spend request. Defaults to true. */
  requireSpendApproval?: boolean;
};

const tokenSchema = z
  .string()
  .trim()
  .min(1, 'Provide a nonempty Link access token.');

/** Native Mastra tools. Credentials are resolved only when a tool executes. */
export function createLinkTools(options: LinkToolsOptions) {
  const { accessToken, getAccessToken, requireSpendApproval = true } = options;
  if (
    (accessToken !== undefined) === (getAccessToken !== undefined) ||
    (getAccessToken !== undefined && typeof getAccessToken !== 'function')
  ) {
    throw new Error('Configure exactly one of accessToken or getAccessToken.');
  }
  const staticToken =
    accessToken === undefined ? undefined : tokenSchema.parse(accessToken);
  const tools = createSdkTools<ToolExecutionContext | undefined>(
    async (context) => {
      const token = getAccessToken
        ? await getAccessToken(context)
        : staticToken;
      // A fresh client keeps credentials isolated across concurrent users and calls.
      return new Link({ accessToken: tokenSchema.parse(token) });
    },
  );

  function adapt<Input, Output>(
    name: LinkToolName,
    tool: {
      description: string;
      inputSchema: z.ZodType<Input, Input>;
      execute: (
        input: Input,
        context: ToolExecutionContext | undefined,
      ) => Promise<Output>;
    },
  ) {
    // Explicit generics preserve SDK response types without inventing output schemas.
    return new Tool<Input, Output>({
      id: name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      requireApproval: name === 'create_spend_request' && requireSpendApproval,
      execute: async (input, context) => {
        try {
          return await tool.execute(input, context);
        } catch (error) {
          if (error instanceof LinkApiError && error.status === 401) {
            throw new Error(
              'Link access token is invalid or expired. Configure a new accessToken or have getAccessToken return a valid token.',
            );
          }
          throw error;
        }
      },
    });
  }

  return {
    retrieve_user_info: adapt('retrieve_user_info', tools.retrieve_user_info),
    list_payment_methods: adapt(
      'list_payment_methods',
      tools.list_payment_methods,
    ),
    list_shipping_addresses: adapt(
      'list_shipping_addresses',
      tools.list_shipping_addresses,
    ),
    list_spend_requests: adapt(
      'list_spend_requests',
      tools.list_spend_requests,
    ),
    create_spend_request: adapt(
      'create_spend_request',
      tools.create_spend_request,
    ),
    retrieve_spend_request: adapt(
      'retrieve_spend_request',
      tools.retrieve_spend_request,
    ),
    update_spend_request: adapt(
      'update_spend_request',
      tools.update_spend_request,
    ),
    request_spend_approval: adapt(
      'request_spend_approval',
      tools.request_spend_approval,
    ),
    cancel_spend_request: adapt(
      'cancel_spend_request',
      tools.cancel_spend_request,
    ),
    list_transactions: adapt('list_transactions', tools.list_transactions),
    list_sources: adapt('list_sources', tools.list_sources),
    list_balances: adapt('list_balances', tools.list_balances),
    list_available_insight_types: adapt(
      'list_available_insight_types',
      tools.list_available_insight_types,
    ),
    list_insights: adapt('list_insights', tools.list_insights),
    create_report: adapt('create_report', tools.create_report),
  };
}

export type LinkTools = ReturnType<typeof createLinkTools>;
