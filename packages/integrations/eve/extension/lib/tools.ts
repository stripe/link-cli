import { Link, LinkApiError } from '@stripe/link-sdk';
import { createLinkTools } from '@stripe/link-sdk/tools';
import type { ToolContext } from 'eve/tools';
import extension from '../extension';

// Read mount configuration only when a tool executes, not during discovery.
export const tools = createLinkTools<ToolContext>(async (ctx) => {
  const config = extension.config;
  const accessToken =
    'accessToken' in config
      ? config.accessToken
      : (await ctx.getToken(config.auth)).token;
  return new Link({ accessToken });
});

export async function executeLink<Output>(
  ctx: ToolContext,
  call: () => Promise<Output>,
): Promise<Output> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof LinkApiError && error.status === 401) {
      const config = extension.config;
      if ('auth' in config) ctx.requireAuth(config.auth);
      throw new Error(
        'Link access token is invalid or expired. Configure a new accessToken for the extension.',
      );
    }
    throw error;
  }
}
